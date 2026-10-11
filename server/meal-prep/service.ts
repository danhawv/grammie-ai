// Orchestration: setup -> recipe facts -> (wishes) -> plan -> shopping list
// and session -> explanation, saved on the plan row. Everything it touches
// comes in through MealPrepDeps, so the routes can be tested with fakes.

import type {
  Adjuster, PlanWeights, PrepPlan, PrepSetup, RecipeFacts,
} from "@shared/meal-prep/contract";
import type { WishesResult } from "@shared/meal-prep/api";
import type { PrepPlanRow, PrepRecipes, PrepStore } from "./store";
import type { MealPrepAI } from "./ai";
import { DEFAULT_PLAN_WEIGHTS, type MealPrepEngines } from "./engines";
import { emptyWishes, validateWishes, wishCandidates } from "./wishes";
import { checkExplanation, explainInput, plainExplanation } from "./explain";

export interface MealPrepDeps {
  store: PrepStore;
  recipes: PrepRecipes;
  engines: () => MealPrepEngines | null;
  ai: MealPrepAI | null;
}

/** A problem we can show the family as is */
export class PrepProblem extends Error {
  constructor(message: string, readonly status = 422) {
    super(message);
  }
}

export const NOT_READY = "Meal prep isn't switched on yet. Please try again later.";

export function requireEngines(deps: MealPrepDeps): MealPrepEngines {
  const engines = deps.engines();
  if (!engines) throw new PrepProblem(NOT_READY, 503);
  return engines;
}

/** The setup the planner sees: the owner's exclusions plus the wishes' */
export function effectiveSetup(setup: PrepSetup, wishes: WishesResult | null): PrepSetup {
  if (!wishes || wishes.excludedRecipeIds.length === 0) return setup;
  const pinned = new Set(setup.pinnedRecipeIds ?? []);
  const excluded = new Set([...(setup.excludedRecipeIds ?? []), ...wishes.excludedRecipeIds.filter(id => !pinned.has(id))]);
  return { ...setup, excludedRecipeIds: Array.from(excluded) };
}

export async function poolFor(deps: MealPrepDeps, ownerId: string, setup: PrepSetup): Promise<string[]> {
  const base = setup.recipePool && setup.recipePool.length > 0 ? setup.recipePool : await deps.recipes.ownRecipeIds(ownerId);
  const ids = Array.from(new Set([...base, ...(setup.pinnedRecipeIds ?? [])]));
  if (ids.length === 0) throw new PrepProblem("Add a few of your recipes first, then we can plan a prep day from them.");
  return ids;
}

async function understandWishes(deps: MealPrepDeps, setup: PrepSetup, facts: RecipeFacts[], reuse: WishesResult | null): Promise<WishesResult | null> {
  const text = (setup.wishes ?? "").trim();
  if (!text) return null;
  if (reuse && reuse.wishes === text) return reuse;
  if (!deps.ai) return emptyWishes(text);
  const candidates = wishCandidates(facts.filter(f => !(setup.excludedRecipeIds ?? []).includes(f.recipeId)));
  try {
    return validateWishes(await deps.ai.wishes(text, candidates), text, candidates, setup.pinnedRecipeIds ?? []);
  } catch (err) {
    console.warn("[MealPrep] Wishes not understood:", (err as Error).message);
    return emptyWishes(text);
  }
}

export async function explain(deps: MealPrepDeps, setup: PrepSetup, plan: PrepPlan, titles: Record<string, string>): Promise<{ text: string; byAI: boolean }> {
  const input = explainInput(setup, plan, titles);
  if (deps.ai) {
    try {
      const text = checkExplanation(await deps.ai.explain(input), input);
      if (text) return { text, byAI: true };
    } catch (err) {
      console.warn("[MealPrep] Explanation fell back to plain text:", (err as Error).message);
    }
  }
  return { text: plainExplanation(input), byAI: false };
}

function titlesFor(facts: RecipeFacts[], plan: PrepPlan, extra: string[] = []): Record<string, string> {
  const wanted = new Set([...plan.batches.map(b => b.recipeId), ...extra]);
  const titles: Record<string, string> = {};
  for (const f of facts) if (wanted.has(f.recipeId)) titles[f.recipeId] = f.title;
  return titles;
}

/** Shopping list, session and explanation for a plan; nothing saved */
export async function finishPlan(
  deps: MealPrepDeps, ownerId: string, setup: PrepSetup, plan: PrepPlan, facts: RecipeFacts[], adjusters: Adjuster[],
) {
  const engines = requireEngines(deps);
  const pantry = await deps.recipes.pantryNames(ownerId);
  const [shopping, session] = await Promise.all([
    engines.session.shopping(plan, facts, adjusters, pantry, engines.food),
    engines.session.session(setup, plan, facts, adjusters),
  ]);
  const titles = titlesFor(facts, plan, setup.pinnedRecipeIds);
  const explanation = await explain(deps, setup, plan, titles);
  return { shopping, session, titles, explanation };
}

export async function factsForPlan(deps: MealPrepDeps, ownerId: string, setup: PrepSetup) {
  const engines = requireEngines(deps);
  const pool = await poolFor(deps, ownerId, setup);
  const [facts, adjusters] = await Promise.all([engines.food.factsFor(pool), engines.food.adjusters()]);
  if (facts.length === 0) throw new PrepProblem("We couldn't read enough about your recipes to plan with them yet. Try again in a few minutes.");
  return { engines, facts, adjusters };
}

/**
 * The planner only estimates session time from hands-on minutes; the real
 * timeline (with washing up, cooling and portioning) comes from the session
 * builder. When that runs well over the time asked for, plan again against a
 * shorter budget so it picks fewer or simpler dishes. Up to two retries; the
 * shortest result wins, and an overrun left over is shown as a warning.
 */
async function planWithinSession(
  deps: MealPrepDeps, ownerId: string, setup: PrepSetup, facts: RecipeFacts[], adjusters: Adjuster[], weights?: PlanWeights,
) {
  const engines = requireEngines(deps);
  const limit = setup.session.maxMinutes;
  let budget = limit;
  let best: { plan: PrepPlan; done: Awaited<ReturnType<typeof finishPlan>> } | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const planSetup = { ...setup, session: { ...setup.session, maxMinutes: Math.round(budget) } };
    const plan = await engines.planner.plan(planSetup, facts, adjusters, weights);
    const done = await finishPlan(deps, ownerId, setup, plan, facts, adjusters);
    const total = done.session.totalMinutes;
    if (!best || total < best.done.session.totalMinutes) best = { plan, done };
    if (total <= limit * 1.1 || plan.fitScore < 50) break;
    budget = budget * (limit / total) * 0.95;
  }
  return best!;
}

/**
 * Solves the plan for a row and saves the result (or a plain-words failure).
 * `reuseWishes` skips the model when the wishes text hasn't changed.
 */
export async function buildPlan(deps: MealPrepDeps, row: PrepPlanRow, reuseWishes: WishesResult | null): Promise<PrepPlanRow | null> {
  try {
    const { engines, facts, adjusters } = await factsForPlan(deps, row.ownerUserId, row.setup);
    const wishes = await understandWishes(deps, row.setup, facts, reuseWishes);
    const setup = effectiveSetup(row.setup, wishes);
    const bonus = wishes?.recipeBonus ?? {};
    const weights = Object.keys(bonus).length > 0 ? { ...DEFAULT_PLAN_WEIGHTS, recipeBonus: bonus } : undefined;
    const { plan, done } = await planWithinSession(deps, row.ownerUserId, setup, facts, adjusters, weights);
    const wishTitles = wishes ? Object.fromEntries(facts
      .filter(f => wishes.more.includes(f.recipeId) || wishes.less.includes(f.recipeId) || wishes.excludedRecipeIds.includes(f.recipeId))
      .map(f => [f.recipeId, f.title])) : {};
    return deps.store.updatePlan(row.id, {
      buildStatus: "ready",
      buildError: null,
      plan,
      shopping: done.shopping,
      session: done.session,
      explanation: done.explanation.text,
      explanationAi: done.explanation.byAI,
      wishesResult: wishes,
      recipeTitles: { ...wishTitles, ...done.titles },
      swapOptions: null,
    });
  } catch (err) {
    const message = err instanceof PrepProblem
      ? err.message
      : "Something went wrong while planning. Please try again.";
    if (!(err instanceof PrepProblem)) console.error(`[MealPrep] Planning ${row.id} failed:`, err);
    return deps.store.updatePlan(row.id, { buildStatus: "failed", buildError: message });
  }
}
