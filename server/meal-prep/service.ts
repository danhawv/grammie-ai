// Orchestration: setup -> recipe facts -> (wishes) -> plan -> shopping list
// and session -> explanation, saved on the plan row. Everything it touches
// comes in through MealPrepDeps, so the routes can be tested with fakes.

import type {
  Adjuster, PlanOption, PlanWeights, PrepPlan, PrepSetup, RecipeFacts,
} from "@shared/meal-prep/contract";
import type { StoredPlanOptions, WishesResult } from "@shared/meal-prep/api";
import { enrichSwaps, swapKey } from "@shared/meal-prep/callouts";
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

/**
 * The recipes to plan from: chosen cookbooks or favourites (setup.recipeSource),
 * else an explicit pool, else all the owner's own recipes. Must-haves are
 * always in.
 */
export async function poolFor(deps: MealPrepDeps, ownerId: string, setup: PrepSetup): Promise<string[]> {
  const source = setup.recipeSource;
  let base: string[];
  if (source?.kind === "cookbooks") {
    const ids = await deps.recipes.recipeIdsInCookbooks(ownerId, source.cookbookIds ?? []);
    base = await deps.recipes.usableRecipeIds(ownerId, ids);
    if (base.length === 0) {
      throw new PrepProblem("Those cookbooks don't have any recipes we can plan from yet. Pick other cookbooks, or plan from all your recipes.");
    }
  } else if (source?.kind === "favorites") {
    const ids = await deps.recipes.favoriteRecipeIds(ownerId);
    base = await deps.recipes.usableRecipeIds(ownerId, ids);
    if (base.length === 0) {
      throw new PrepProblem("You haven't saved any favourites yet. Tap the bookmark on a few recipes, or plan from all your recipes.");
    }
  } else {
    base = setup.recipePool && setup.recipePool.length > 0 ? setup.recipePool : await deps.recipes.ownRecipeIds(ownerId);
  }
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

export async function explain(
  deps: MealPrepDeps, setup: PrepSetup, plan: PrepPlan, titles: Record<string, string>, adjusters: Adjuster[] = [],
): Promise<{ text: string; byAI: boolean }> {
  const input = explainInput(setup, plan, titles, adjusters);
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
  const explanation = await explain(deps, setup, plan, titles, adjusters);
  return { shopping, session, titles, explanation };
}

/**
 * The owner's choices applied to what the planner may use, so they hold
 * whatever the planner does: swaps turned off (all, or "Keep it as written"
 * ones) are taken out of RecipeFacts.swaps, and protein top-ups not allowed
 * (or other shake brands than the chosen one) are taken out of the adjusters.
 */
export function applyPlanningChoices(setup: PrepSetup, facts: RecipeFacts[], adjusters: Adjuster[]) {
  const excluded = new Set(setup.excludedSwaps ?? []);
  const noSwaps = setup.allowSwaps === false;
  const usableFacts = facts.map(f => (!f.swaps?.length ? f : {
    ...f,
    swaps: noSwaps ? [] : f.swaps.filter(s => !excluded.has(swapKey(f.recipeId, s.id))),
  }));
  const topUps = setup.topUps ?? "both";
  const shakeChosen = !!setup.shakeId && adjusters.some(a => a.id === setup.shakeId && a.topUp === "shake");
  const usableAdjusters = adjusters.filter(a => {
    if (!a.topUp) return true;
    if (topUps === "none") return false;
    if (topUps === "chicken" && a.topUp === "shake") return false;
    if (topUps === "shake" && a.topUp === "chicken") return false;
    if (a.topUp === "shake" && shakeChosen && a.id !== setup.shakeId) return false;
    return true;
  });
  return { facts: usableFacts, adjusters: usableAdjusters };
}

export async function factsForPlan(deps: MealPrepDeps, ownerId: string, setup: PrepSetup) {
  const engines = requireEngines(deps);
  const pool = await poolFor(deps, ownerId, setup);
  const [allFacts, allAdjusters] = await Promise.all([engines.food.factsFor(pool), engines.food.adjusters()]);
  if (allFacts.length === 0) throw new PrepProblem("We couldn't read enough about your recipes to plan with them yet. Try again in a few minutes.");
  const { facts, adjusters } = applyPlanningChoices(setup, allFacts, allAdjusters);
  return { engines, facts, adjusters };
}

/** The plan with every swap it uses spelled out (notes and ingredient changes at the batch's scale) */
export function withSwapDetails(plan: PrepPlan, facts: RecipeFacts[]): PrepPlan {
  const swaps = enrichSwaps(plan, facts);
  if (swaps.length === 0 && !plan.swapsApplied) return plan;
  return { ...plan, swapsApplied: swaps };
}

/** Rough hands-on minutes for an option's card, from the recipes' own times (the real timeline is built only for the chosen plan) */
export function roughHandsOn(plan: PrepPlan, facts: RecipeFacts[], adjusters: Adjuster[]): number {
  const byId = new Map(facts.map(f => [f.recipeId, f]));
  let total = 0;
  for (const b of plan.batches) {
    const active = byId.get(b.recipeId)?.activeMinutes ?? 20;
    // Bigger batches take longer to chop, but not twice as long
    total += active * Math.max(0.75, 0.6 + 0.4 * b.scale);
  }
  const adj = new Map(adjusters.map(a => [a.id, a]));
  for (const id of Object.keys(plan.adjusterCooking ?? {})) if (adj.get(id)?.needsCooking) total += 10;
  return Math.round(total / 5) * 5;
}

/** Up to 3 different plans; falls back to one plan when the planner can't offer options */
async function planOptionsFor(
  deps: MealPrepDeps, setup: PrepSetup, facts: RecipeFacts[], adjusters: Adjuster[], weights?: PlanWeights,
): Promise<PlanOption[]> {
  const engines = requireEngines(deps);
  let options: PlanOption[] = [];
  if (typeof engines.planner.planOptions === "function") {
    try {
      options = await engines.planner.planOptions(setup, facts, adjusters, weights);
    } catch (err) {
      if (err instanceof PrepProblem) throw err;
      console.warn("[MealPrep] Plan options failed; planning one:", (err as Error).message);
    }
  }
  const seen = new Set<string>();
  options = options.filter(o => o?.plan && !seen.has(o.key) && seen.add(o.key)).slice(0, 3);
  if (options.length === 0) {
    const plan = await engines.planner.plan(setup, facts, adjusters, weights);
    options = [{ key: "balanced", label: "Best fit", summary: "The closest fit to everyone's goals.", plan }];
  }
  return options.map(o => ({ ...o, plan: withSwapDetails(o.plan, facts) }));
}

/**
 * The planner only estimates session time from hands-on minutes; the real
 * timeline (with washing up, cooling and portioning) comes from the session
 * builder. When that runs well over the time asked for, plan again against a
 * shorter budget so it picks fewer or simpler dishes. Up to two retries; the
 * shortest result wins, and an overrun left over is shown as a warning.
 * Options are planned each time, but only the first (best-fitting) one gets
 * a shopping list and timeline; the others are built if the owner picks them.
 */
async function planWithinSession(
  deps: MealPrepDeps, ownerId: string, setup: PrepSetup, facts: RecipeFacts[], adjusters: Adjuster[], weights?: PlanWeights,
) {
  const limit = setup.session.maxMinutes;
  let budget = limit;
  let best: { options: PlanOption[]; done: Awaited<ReturnType<typeof finishPlan>> } | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const planSetup = { ...setup, session: { ...setup.session, maxMinutes: Math.round(budget) } };
    const options = await planOptionsFor(deps, planSetup, facts, adjusters, weights);
    const plan = options[0].plan;
    const done = await finishPlan(deps, ownerId, setup, plan, facts, adjusters);
    const total = done.session.totalMinutes;
    if (!best || total < best.done.session.totalMinutes) best = { options, done };
    if (total <= limit * 1.1 || plan.fitScore < 50) break;
    budget = budget * (limit / total) * 0.95;
  }
  return best!;
}

/** What's kept on the row for the option cards */
export function storedOptions(options: PlanOption[], chosen: number, facts: RecipeFacts[], adjusters: Adjuster[]): StoredPlanOptions {
  return {
    chosenKey: options[chosen]?.key ?? null,
    items: options.map(option => ({
      option,
      handsOnMinutes: roughHandsOn(option.plan, facts, adjusters),
      titles: titlesFor(facts, option.plan),
      finished: null,
    })),
  };
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
    const { options, done } = await planWithinSession(deps, row.ownerUserId, setup, facts, adjusters, weights);
    const plan = options[0].plan;
    const stored = storedOptions(options, 0, facts, adjusters);
    const optionTitles = Object.assign({}, ...stored.items.map(i => i.titles)) as Record<string, string>;
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
      recipeTitles: { ...wishTitles, ...optionTitles, ...done.titles },
      swapOptions: null,
      options: stored,
    });
  } catch (err) {
    const message = err instanceof PrepProblem
      ? err.message
      : "Something went wrong while planning. Please try again.";
    if (!(err instanceof PrepProblem)) console.error(`[MealPrep] Planning ${row.id} failed:`, err);
    return deps.store.updatePlan(row.id, { buildStatus: "failed", buildError: message });
  }
}
