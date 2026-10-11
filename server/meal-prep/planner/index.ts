// Meal prep planner (part 2): PrepSetup + RecipeFacts + adjusters -> PrepPlan.
// Pure computation, no database. See model.ts for the optimization model and
// extract.ts for how the answer becomes plates and notes.

import type {
  Adjuster, MealSlot, PlanWeights, Planner, PrepPlan, PrepSetup, RecipeFacts,
} from "@shared/meal-prep/contract";
import { buildModel, prepare, type PrepareOptions } from "./model";
import { extractPlan, type Extracted } from "./extract";
import { solveLp, type SolveOptions, type SolveResult } from "./solver";
import { greedyStart } from "./start";

export interface PlannerOptions {
  /** seconds per solve (default 3) */
  timeLimit?: number;
  /** accepted relative MIP gap (default 2%) */
  mipGap?: number;
  /** share of a day's targets each slot carries (see DEFAULT_SLOT_SHARE) */
  slotShare?: Record<MealSlot, number>;
  /** weights used by swapOptions, which has no weights argument */
  weights?: PlanWeights;
  /** swap in another solver (tests) */
  solve?: (lp: string, opts: SolveOptions) => Promise<SolveResult>;
}

const SWAP_CHOICES = 3;

export function createPlanner(options: PlannerOptions = {}): Planner {
  const timeLimit = options.timeLimit ?? 3;
  const mipGap = options.mipGap ?? 0.02;
  const solve = options.solve ?? solveLp;

  async function run(setup: PrepSetup, facts: RecipeFacts[], adjusters: Adjuster[], prep: PrepareOptions, limit: number): Promise<Extracted | null> {
    const t0 = Date.now();
    const P = prepare(setup, facts, adjusters, { slotShare: options.slotShare, ...prep });
    if (!P.recipes.length || !P.occasions.length) return null;
    const B = buildModel(P);
    const res = await solve(B.lp.toString(), { timeLimit: limit, mipGap, start: greedyStart(P, B) });
    if (!res.values) return null;
    return extractPlan(P, B, res.values, Date.now() - t0, (res.objective ?? 0) + B.lp.objConstant);
  }

  return {
    async plan(setup, facts, adjusters, weights) {
      const t0 = Date.now();
      const out = await run(setup, facts, adjusters, { weights }, timeLimit);
      if (out) return out.plan;
      return emptyPlan(facts, Date.now() - t0);
    },

    async swapOptions(setup, plan, recipeId, facts, adjusters) {
      const others = plan.batches.map((b) => b.recipeId).filter((id) => id !== recipeId);
      const excluded = [...(setup.excludedRecipeIds ?? []), recipeId];
      const base: PrepSetup = {
        ...setup,
        pinnedRecipeIds: (setup.pinnedRecipeIds ?? []).filter((id) => id !== recipeId),
      };
      const found: Array<{ recipeId: string; plan: PrepPlan; objective: number }> = [];
      // Keep the other dishes, ask for the best replacement, then rule it out
      // and ask again: each answer is the next-best alternative.
      for (let i = 0; i < SWAP_CHOICES; i++) {
        const out = await run(
          { ...base, excludedRecipeIds: excluded },
          facts,
          adjusters,
          { weights: options.weights, forceRecipes: others, dishCount: Math.max(1, plan.batches.length) },
          Math.min(timeLimit, 1.5),
        );
        if (!out) break;
        const fresh = out.plan.batches.map((b) => b.recipeId).filter((id) => !others.includes(id));
        if (!fresh.length) break;
        found.push({ recipeId: fresh[0], plan: out.plan, objective: out.objective });
        excluded.push(...fresh);
      }
      return found.sort((a, b) => a.objective - b.objective).map(({ recipeId, plan }) => ({ recipeId, plan }));
    },
  };
}

function emptyPlan(facts: RecipeFacts[], ms: number): PrepPlan {
  const relaxed = facts.length
    ? ["No plan could be made from these recipes for this setup. Try adding recipes or loosening allergies, days or meals."]
    : ["There are no recipes to plan with yet."];
  return {
    batches: [], adjusterCooking: {}, plates: [],
    fit: [], fitScore: 0, notes: [], relaxed, solverMs: ms,
  };
}

export { DEFAULT_SLOT_SHARE, DEFAULT_WEIGHTS } from "./model";
export { stopSolver } from "./solver";
