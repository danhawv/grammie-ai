import { getSharedPool } from "../../pg-pool";
import { heuristicSteps, validateSteps } from "./structure";
import { structureWithGemini, type AIStepsAnswer } from "./structure-ai";
import { STEPS_VERSION, type RecipeSource, type RecipeSteps } from "./types";

// Structured steps are worked out once per recipe version and kept in a
// sidecar table (recipe_prep_steps, migrations/2026-10-meal-prep-session.sql),
// keyed by recipe id + the recipe's updated_at + STEPS_VERSION. Editing the
// recipe changes updated_at, so the next session redoes it. The recipe row
// itself is never touched.

export interface StepStore {
  get(recipeId: string, updatedAt: string, version: number): Promise<RecipeSteps | null>;
  put(steps: RecipeSteps): Promise<void>;
}

export type StepStructurer = (recipe: RecipeSource) => Promise<AIStepsAnswer>;

export function memoryStepStore(): StepStore {
  const rows = new Map<string, RecipeSteps>();
  const key = (id: string, at: string, v: number) => `${id}|${at}|${v}`;
  return {
    async get(id, at, v) { return rows.get(key(id, at, v)) ?? null; },
    async put(s) { rows.set(key(s.recipeId, s.recipeUpdatedAt, s.version), s); },
  };
}

const TABLE = "recipe_prep_steps";

/**
 * The database store, with a memory cache in front. Until the migration is
 * applied the table is missing; then it quietly works from memory only.
 */
export function dbStepStore(): StepStore {
  const memory = memoryStepStore();
  let ready: boolean | null = null;
  let checkedAt = 0;
  async function tableReady(): Promise<boolean> {
    if (ready !== null && Date.now() - checkedAt < 5 * 60 * 1000) return ready;
    try {
      const { rows } = await getSharedPool().query(`SELECT to_regclass($1) AS t`, [TABLE]);
      ready = !!rows[0]?.t;
      if (!ready) console.log(`[MealPrep] ${TABLE} not found (migration not applied); structured steps kept in memory`);
    } catch {
      ready = false;
    }
    checkedAt = Date.now();
    return ready;
  }
  return {
    async get(id, at, v) {
      const cached = await memory.get(id, at, v);
      if (cached || !(await tableReady())) return cached;
      const { rows } = await getSharedPool().query(
        `SELECT data FROM ${TABLE} WHERE recipe_id = $1 AND recipe_updated_at = $2 AND version = $3`,
        [id, at, v],
      );
      const found = (rows[0]?.data as RecipeSteps | undefined) ?? null;
      if (found) await memory.put(found);
      return found;
    },
    async put(s) {
      await memory.put(s);
      if (!(await tableReady())) return;
      await getSharedPool().query(
        `INSERT INTO ${TABLE} (recipe_id, recipe_updated_at, version, source, model, data, cost_micros)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (recipe_id, recipe_updated_at, version)
         DO UPDATE SET source = EXCLUDED.source, model = EXCLUDED.model, data = EXCLUDED.data,
                       cost_micros = EXCLUDED.cost_micros, created_at = now()`,
        [s.recipeId, s.recipeUpdatedAt, s.version, s.source, s.model, JSON.stringify(s), s.costMicros],
      );
    },
  };
}

/**
 * Structured steps for one recipe: from the cache, else from the model
 * (checked by validateSteps), else built from the steps without AI. A
 * heuristic result isn't cached, so the model gets another try next time.
 */
export async function stepsFor(
  recipe: RecipeSource,
  store: StepStore,
  structurer: StepStructurer | null,
): Promise<RecipeSteps> {
  const cached = await store.get(recipe.id, recipe.updatedAt, STEPS_VERSION).catch(() => null);
  if (cached) return cached;
  const base = { recipeId: recipe.id, recipeUpdatedAt: recipe.updatedAt, version: STEPS_VERSION };
  if (structurer) {
    try {
      const answer = await structurer(recipe);
      const checked = validateSteps(answer.raw, recipe);
      if (checked) {
        const steps: RecipeSteps = { ...base, source: "ai", model: answer.model, ...checked, costMicros: answer.costMicros };
        await store.put(steps).catch((err) => console.error(`[MealPrep] Couldn't save steps for ${recipe.id}:`, err?.message));
        return steps;
      }
      console.warn(`[MealPrep] Step answer for ${recipe.id} had no usable tasks; using the recipe's steps`);
    } catch (err: any) {
      console.warn(`[MealPrep] Step structuring failed for ${recipe.id} (${err?.message}); using the recipe's steps`);
    }
  }
  return { ...base, source: "heuristic", model: null, ...heuristicSteps(recipe), costMicros: 0 };
}

export const geminiStructurer: StepStructurer = structureWithGemini;

/** Loads the recipe fields structuring needs (read-only) */
export async function loadRecipeSources(ids: string[]): Promise<RecipeSource[]> {
  if (!ids.length) return [];
  const { rows } = await getSharedPool().query(
    `SELECT id, title, servings, updated_at, ingredients, instructions, normalized_instructions,
            prep_time_minutes, cook_time_minutes, total_time_minutes
       FROM recipes WHERE id = ANY($1)`,
    [ids],
  );
  return rows.map(rowToSource);
}

export function rowToSource(r: any): RecipeSource {
  return {
    id: r.id,
    title: r.title,
    servings: Number(r.servings) || 1,
    updatedAt: new Date(r.updated_at ?? r.updatedAt ?? 0).toISOString(),
    ingredients: r.ingredients ?? [],
    instructions: r.instructions ?? [],
    normalizedInstructions: r.normalized_instructions ?? r.normalizedInstructions ?? null,
    prepTimeMinutes: r.prep_time_minutes ?? r.prepTimeMinutes ?? null,
    cookTimeMinutes: r.cook_time_minutes ?? r.cookTimeMinutes ?? null,
    totalTimeMinutes: r.total_time_minutes ?? r.totalTimeMinutes ?? null,
  };
}
