import type {
  Adjuster, FoodData, PrepPlan, PrepSession, PrepSetup, RecipeFacts, SessionBuilder, ShoppingList,
} from "@shared/meal-prep/contract";
import { buildGraph, type BatchInput } from "./merge";
import { beforeSessionList, buildLabels, containerSizes, equipmentList, safetyNotes } from "./portions";
import { schedule } from "./schedule";
import { buildShoppingList } from "./shopping";
import { factsAsCooked, swapUses } from "./swaps";
import { swapIdsFor } from "@shared/meal-prep/callouts";
import { dbStepStore, geminiStructurer, loadRecipeSources, stepsFor, type StepStore, type StepStructurer } from "./step-store";
import type { RecipeSource, RecipeSteps } from "./types";

// Part 3 of meal prep: PrepPlan + RecipeFacts -> shopping list, the merged
// prep timeline, portions and labels. See shared/meal-prep/contract.ts.

export interface SessionBuilderDeps {
  /** recipe rows for step structuring; default reads the recipes table */
  loadRecipes?: (ids: string[]) => Promise<RecipeSource[]>;
  /** where structured steps are cached; default the recipe_prep_steps table (memory until migrated) */
  stepStore?: StepStore;
  /** the AI step structurer; default Gemini (prepSteps job); null = build from the recipe's steps without AI */
  structurer?: StepStructurer | null;
  /** randomized scheduling attempts (default 300) */
  iterations?: number;
  seed?: number;
}

export interface SessionBuilderWithSteps extends SessionBuilder {
  /** structured steps for recipes (cached); lets the API warm the cache when a plan is made */
  steps(recipeIds: string[]): Promise<RecipeSteps[]>;
}

/** Runs at most `limit` at a time */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  }));
  return out;
}

const round5 = (n: number) => Math.ceil(n / 5) * 5;

function hoursText(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (!h) return `${m} min`;
  return m ? `${h} hr ${m} min` : `${h} ${h === 1 ? "hour" : "hours"}`;
}

export function createSessionBuilder(deps: SessionBuilderDeps = {}): SessionBuilderWithSteps {
  const loadRecipes = deps.loadRecipes ?? loadRecipeSources;
  const store = deps.stepStore ?? dbStepStore();
  const structurer = deps.structurer === undefined ? geminiStructurer : deps.structurer;

  async function steps(recipeIds: string[]): Promise<RecipeSteps[]> {
    const sources = await loadRecipes(Array.from(new Set(recipeIds)));
    return mapLimit(sources, 4, (r) => stepsFor(r, store, structurer));
  }

  return {
    steps,

    async shopping(plan: PrepPlan, facts: RecipeFacts[], adjusters: Adjuster[], pantry: string[], food: FoodData): Promise<ShoppingList> {
      return buildShoppingList(plan, facts, adjusters, pantry, food);
    },

    async session(setup: PrepSetup, plan: PrepPlan, facts: RecipeFacts[], adjusters: Adjuster[]): Promise<PrepSession> {
      const warnings: string[] = [];
      const factsById = new Map(facts.map((f) => [f.recipeId, f]));
      const structured = await steps(plan.batches.map((b) => b.recipeId));
      const stepsById = new Map(structured.map((s) => [s.recipeId, s]));
      const batches: BatchInput[] = [];
      for (const batch of plan.batches) {
        const f = factsById.get(batch.recipeId);
        const s = stepsById.get(batch.recipeId);
        if (!f || !s) {
          warnings.push(`One recipe in the plan couldn't be found, so it's left out of the timeline.`);
          continue;
        }
        const swapIds = swapIdsFor(plan, batch.recipeId);
        batches.push({ batch, facts: factsAsCooked(f, swapIds), steps: s, swapUses: swapUses(f, swapIds, batch.scale) });
      }
      const cooked = facts.map((f) => factsAsCooked(f, swapIdsFor(plan, f.recipeId)));

      const graph = buildGraph(setup, plan, batches, adjusters);
      const result = schedule(graph.tasks, {
        cooks: setup.session.cooks, kitchen: setup.kitchen, iterations: deps.iterations, seed: deps.seed,
      });
      warnings.push(...result.warnings);

      // A cushion for the unexpected: 10% of the session, at least 10 minutes
      const buffer = Math.max(10, round5(result.makespan * 0.1));
      const totalMinutes = round5(result.makespan + buffer);
      const max = setup.session.maxMinutes || 240;
      if (totalMinutes > max) {
        warnings.push(`This session takes about ${hoursText(totalMinutes)} (with ${buffer} min to spare), ${hoursText(totalMinutes - max)} more than the ${hoursText(max)} you set. Fewer dishes, a second cook or doing the marinating the night before would shorten it.`);
      }

      const start = new Map(result.tasks.map((t) => [t.id, t.start]));
      const misePlace = graph.mise
        .slice()
        .sort((a, b) => (start.get(a.id) ?? 0) - (start.get(b.id) ?? 0))
        .map(({ text, recipeIds }) => ({ text, recipeIds }));
      const labels = buildLabels(setup, plan, cooked, adjusters);
      const bySize = containerSizes(graph.containerGrams);
      return {
        tasks: result.tasks,
        totalMinutes,
        handsOnMinutes: result.tasks.reduce((s, t) => s + t.activeMin, 0),
        misePlace,
        equipment: equipmentList(setup, graph, result.tasks, graph.containers),
        beforeSession: beforeSessionList(setup, plan, cooked, structured, graph, bySize),
        labels,
        containers: { count: graph.containers, bySize },
        safety: safetyNotes(setup, plan, cooked, labels, graph),
        warnings,
      };
    },
  };
}

export type { RecipeSteps, RecipeSource } from "./types";
export { memoryStepStore, dbStepStore, type StepStore, type StepStructurer } from "./step-store";
