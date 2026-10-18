// Meal prep planner (part 2): PrepSetup + RecipeFacts + adjusters -> PrepPlan.
// Pure computation, no database. See model.ts for the optimization model and
// extract.ts for how the answer becomes plates and notes.

import type {
  Adjuster, MealSlot, PlanOption, PlanWeights, Planner, PrepPlan, PrepSetup, RecipeFacts,
} from "@shared/meal-prep/contract";
import { formatDuration } from "@shared/format";
import { buildModel, prepare, type PlanMode, type PrepareOptions } from "./model";
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
  /**
   * multiplies the session-time estimate; 1 (default) is the model calibrated
   * on real sessions (see SESSION_MODEL in model.ts). Raise it if real
   * sessions keep running long.
   */
  sessionTimeFactor?: number;
  /** weights used by swapOptions, which has no weights argument */
  weights?: PlanWeights;
  /** seconds per solve for plan options (default 2.5; three solves run one after another) */
  optionTimeLimit?: number;
  /** swap in another solver (tests) */
  solve?: (lp: string, opts: SolveOptions) => Promise<SolveResult>;
}

const SWAP_CHOICES = 3;
/** each plan option leaves out at least this many of every earlier option's dishes */
const OPTION_DROP = 2;

const OPTION_LABEL: Record<PlanMode, string> = {
  balanced: "Best fit",
  protein: "Most protein",
  variety: "Most variety",
  quick: "Least cooking",
};

export function createPlanner(options: PlannerOptions = {}): Planner {
  const timeLimit = options.timeLimit ?? 3;
  const mipGap = options.mipGap ?? 0.02;
  const solve = options.solve ?? solveLp;

  async function run(setup: PrepSetup, facts: RecipeFacts[], adjusters: Adjuster[], prep: PrepareOptions, limit: number): Promise<Extracted | null> {
    const t0 = Date.now();
    const P = prepare(setup, facts, adjusters, { slotShare: options.slotShare, sessionTimeFactor: options.sessionTimeFactor, ...prep });
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

    async planOptions(setup, facts, adjusters, weights) {
      const limit = options.optionTimeLimit ?? Math.min(timeLimit, 2.5);
      // all the solves together stay near this (they run one after another)
      const budget = Math.max(limit * 3, 1) + 0.5;
      const started = Date.now();
      const left = () => budget - (Date.now() - started) / 1000;
      const found: Array<{ key: PlanMode; out: Extracted; ids: string[] }> = [];
      const missing = (p: PrepPlan) => p.relaxed.filter((r) => r.includes("is left open")).length;
      // limits that gave way, other than the session running a little long
      const broken = (p: PrepPlan) => p.relaxed.filter((r) => !r.includes("fits in the session")).length;
      const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));

      const tryMode = async (key: PlanMode): Promise<boolean> => {
        // differ from every earlier option by at least two dishes; if that
        // can't be done, by one
        for (const drop of [OPTION_DROP, 1]) {
          const time = found.length ? Math.min(limit, left()) : limit;
          if (time < 0.5) return false;
          const cuts = found.map((f) => ({ ids: f.ids, drop }));
          const out = await run(setup, facts, adjusters, { weights, mode: key, cuts }, time);
          if (!out || !out.plan.plates.length) continue;
          const ids = out.plan.batches.map((b) => b.recipeId);
          if (found.some((f) => sameSet(f.ids, ids))) continue;
          // an option that leaves more meals open than the best one isn't worth offering
          // nor one that breaks clearly more of the rules (repeats, same dish twice a day…)
          if (found.length && (missing(out.plan) > missing(found[0].out.plan) || broken(out.plan) > broken(found[0].out.plan) + 1)) continue;
          // nor one that runs well past the session when the best one doesn't run as long
          const overSession = out.plan.relaxed.some((r) => r.includes("fits in the session"));
          if (found.length && overSession && out.handsOn > found[0].out.handsOn * 1.1 + 20) continue;
          found.push({ key, out, ids });
          return true;
        }
        return false;
      };

      if (!(await tryMode("balanced"))) {
        const t0 = Date.now();
        const empty = emptyPlan(facts, Date.now() - t0);
        return [{ key: "balanced", label: OPTION_LABEL.balanced, summary: "No plan could be made", plan: empty }];
      }
      await tryMode("protein");
      // the third option: more dishes if the first plan didn't use them all,
      // otherwise less cooking
      const maxDishes = prepare(setup, facts, adjusters, { slotShare: options.slotShare }).maxDishes;
      await tryMode(found[0].ids.length < maxDishes ? "variety" : "quick");

      const out: PlanOption[] = found.map(({ key, out }) => ({
        key,
        label: OPTION_LABEL[key],
        summary: optionSummary(out, setup),
        plan: out.plan,
      }));
      // best-fitting first (stable: balanced stays ahead on a tie)
      return out.map((o, i) => ({ o, i })).sort((a, b) => b.o.plan.fitScore - a.o.plan.fitScore || a.i - b.i).map(({ o }) => o);
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

/** "4 dishes · about 2 hr 10 min hands-on · 132 g protein/day avg · 1 swap" */
function optionSummary(out: Extracted, setup: PrepSetup): string {
  const p = out.plan;
  const parts = [`${p.batches.length} ${p.batches.length === 1 ? "dish" : "dishes"}`];
  parts.push(`about ${formatDuration(out.handsOn) ?? "a few minutes"} hands-on`);
  const withTargets = new Set(setup.people.filter((x) => x.targets).map((x) => x.id));
  const days = p.fit.filter((f) => withTargets.size === 0 || withTargets.has(f.personId));
  if (days.length) {
    const avg = days.reduce((a, f) => a + f.macros.protein, 0) / days.length;
    parts.push(`${Math.round(avg)} g protein/day avg`);
  }
  const swaps = p.swapsApplied?.length ?? 0;
  if (swaps) parts.push(`${swaps} recipe ${swaps === 1 ? "swap" : "swaps"}`);
  return parts.join(" · ");
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
