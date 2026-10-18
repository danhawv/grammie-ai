// Cached ingredient swaps (meal_prep_recipe_swaps, migrations/2026-10-meal-prep-swaps.sql).
// The model's proposals are stored with the recipe version they were made
// for; the swaps themselves are recomputed in code whenever the food data
// changes, so only a changed recipe ever needs another AI call. factsFor()
// only reads this cache; ensureSwaps() fills it.

import type { IngredientSwap, RecipeFacts } from "@shared/meal-prep/contract";
import type { Catalog } from "./catalog";
import { buildSwaps, suggestionsFrom, swapPromptInput, swapPromptText, SWAPS_PROMPT, type SwapProposal } from "./swaps";
import type { ProposeSwaps } from "./swaps-ai";

export type Query = (sql: string, params?: unknown[]) => Promise<{ rows: any[] }>;

export async function swapsTableReady(query: Query): Promise<boolean> {
  try {
    const { rows } = await query(`SELECT to_regclass('public.meal_prep_recipe_swaps') IS NOT NULL AS ok`);
    return !!rows[0]?.ok;
  } catch {
    return false;
  }
}

const sameTime = (a: unknown, b: unknown) => a != null && b != null && new Date(a as any).getTime() === new Date(b as any).getTime();

/**
 * Swaps for these facts from the cache: rows for the current recipe version
 * only; computed with another food data version -> recomputed from the
 * stored proposals. Recipes without a usable row get none.
 */
export async function cachedSwaps(
  query: Query, facts: RecipeFacts[], updatedAt: Map<string, unknown>, catalog: Catalog, version: string,
): Promise<Map<string, IngredientSwap[]>> {
  const out = new Map<string, IngredientSwap[]>();
  if (!facts.length) return out;
  const { rows } = await query(
    `SELECT recipe_id, recipe_updated_at, version, swaps, proposals FROM meal_prep_recipe_swaps WHERE recipe_id = ANY($1::varchar[])`,
    [facts.map((f) => f.recipeId)],
  );
  const byId = new Map(facts.map((f) => [f.recipeId, f]));
  for (const row of rows) {
    const f = byId.get(row.recipe_id);
    if (!f || !sameTime(row.recipe_updated_at, updatedAt.get(row.recipe_id))) continue;
    out.set(row.recipe_id, row.version === version ? (row.swaps ?? []) : buildSwaps(f, (row.proposals ?? []) as SwapProposal[], catalog).swaps);
  }
  return out;
}

export interface EnsureSwapsResult {
  /** recipes looked at */
  checked: number;
  /** without a current cache row */
  missing: string[];
  /** filled now (0 on a dry run) */
  filled: number;
  failed: Array<{ recipeId: string; error: string }>;
  swaps: number;
  costMicros: number;
  /** dry run: rough cost to fill `missing` (input chars / 4 tokens, ~150 output tokens each, at gemini-3.5-flash-lite prices) */
  estimatedCostMicros: number;
}

export interface EnsureSwapsDeps {
  query: Query;
  catalog: Catalog;
  version: string;
  /** recipe rows -> facts (with the row's variations and tips) */
  load(recipeIds: string[]): Promise<Array<{ facts: RecipeFacts; updatedAt: unknown; variations: unknown; tips: unknown }>>;
  propose: ProposeSwaps;
}

export interface EnsureSwapsOptions {
  /** at most this many AI calls (default all missing) */
  limit?: number;
  /** parallel AI calls (default 4) */
  concurrency?: number;
  /** false = dry run: count and estimate, call nothing, write nothing */
  write?: boolean;
  onProgress?(done: number, total: number, recipe: RecipeFacts, swaps: IngredientSwap[]): void;
}

export async function ensureSwapsWith(deps: EnsureSwapsDeps, recipeIds: string[], opts: EnsureSwapsOptions = {}): Promise<EnsureSwapsResult> {
  const result: EnsureSwapsResult = { checked: 0, missing: [], filled: 0, failed: [], swaps: 0, costMicros: 0, estimatedCostMicros: 0 };
  if (!recipeIds.length) return result;
  const write = opts.write !== false;
  if (write && !(await swapsTableReady(deps.query))) throw new Error("meal_prep_recipe_swaps doesn't exist yet: apply migrations/2026-10-meal-prep-swaps.sql first");
  const recipes = await deps.load(recipeIds);
  result.checked = recipes.length;
  const current = new Map<string, unknown>();
  if (await swapsTableReady(deps.query)) {
    const { rows } = await deps.query(`SELECT recipe_id, recipe_updated_at FROM meal_prep_recipe_swaps WHERE recipe_id = ANY($1::varchar[])`, [recipes.map((r) => r.facts.recipeId)]);
    for (const r of rows) current.set(r.recipe_id, r.recipe_updated_at);
  }
  const todo = recipes.filter((r) => !sameTime(current.get(r.facts.recipeId), r.updatedAt) && r.facts.lines.length > 0);
  result.missing = todo.map((r) => r.facts.recipeId);
  for (const r of todo) {
    const chars = SWAPS_PROMPT.length + swapPromptText(swapPromptInput(r.facts, suggestionsFrom(r.variations, r.tips))).length;
    result.estimatedCostMicros += Math.round((chars / 4) * 0.3 + 150 * 2.5);
  }
  if (!write) return result;

  const queue = todo.slice(0, opts.limit ?? todo.length);
  let next = 0, done = 0;
  const worker = async () => {
    while (next < queue.length) {
      const r = queue[next++];
      try {
        const ans = await deps.propose(swapPromptInput(r.facts, suggestionsFrom(r.variations, r.tips)));
        const { swaps } = buildSwaps(r.facts, ans.proposals, deps.catalog);
        await deps.query(
          `INSERT INTO meal_prep_recipe_swaps (recipe_id, recipe_updated_at, version, swaps, proposals, model, cost_micros, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, now())
           ON CONFLICT (recipe_id) DO UPDATE SET recipe_updated_at = EXCLUDED.recipe_updated_at, version = EXCLUDED.version,
             swaps = EXCLUDED.swaps, proposals = EXCLUDED.proposals, model = EXCLUDED.model, cost_micros = EXCLUDED.cost_micros, created_at = now()`,
          [r.facts.recipeId, r.updatedAt, deps.version, JSON.stringify(swaps), JSON.stringify(ans.proposals), ans.model, ans.costMicros],
        );
        result.filled++;
        result.swaps += swaps.length;
        result.costMicros += ans.costMicros;
        opts.onProgress?.(++done, queue.length, r.facts, swaps);
      } catch (e: any) {
        result.failed.push({ recipeId: r.facts.recipeId, error: String(e?.message ?? e) });
        opts.onProgress?.(++done, queue.length, r.facts, []);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(opts.concurrency ?? 4, queue.length)) }, worker));
  return result;
}
