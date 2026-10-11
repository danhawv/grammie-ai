// The three meal-prep engines (food data, planner, session builder) are
// built separately; the API reaches them only through the contract. They
// are registered here at startup (see registerMealPrepEngines in
// server/routes.ts). Until then the planning routes answer 503.

import type { FoodData, Planner, PlanWeights, SessionBuilder } from "@shared/meal-prep/contract";

export interface MealPrepEngines {
  food: FoodData;
  planner: Planner;
  session: SessionBuilder;
}

let current: MealPrepEngines | null = null;

export function setMealPrepEngines(engines: MealPrepEngines | null): void {
  current = engines;
}

export function getMealPrepEngines(): MealPrepEngines | null {
  return current;
}

/**
 * Weights sent with a wish bonus. Without wishes the planner's own defaults
 * apply (weights are left out).
 */
export const DEFAULT_PLAN_WEIGHTS: Omit<PlanWeights, "recipeBonus"> = {
  macro: 1,
  preference: 0.5,
  cost: 0.2,
  handsOn: 0.3,
  waste: 0.3,
};
