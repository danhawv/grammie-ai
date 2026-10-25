// Production wiring for the meal-prep router: Postgres storage, Gemini,
// Instacart (when configured) and the engines registered in engines.ts.

import { db } from "../db";
import { storage } from "../storage";
import { mealPlanWsManager } from "../websocket";
import { createMealPrepRouter } from "../routes/meal-prep";
import { isAuthenticated } from "../clerkAuth";
import { getUserId } from "../routes/route-utils";
import { createPgPrepRecipes, createPgPrepStore } from "./store";
import { createPgIntegrations } from "./calendar";
import { createGeminiMealPrepAI } from "./ai";
import { getMealPrepEngines } from "./engines";
import { createInstacartClient, instacartConfig } from "./instacart";
import { charge, gate, jobRefs } from "../lib/credits";

export function mealPrepRouter() {
  return createMealPrepRouter({
    auth: isAuthenticated,
    userIdOf: getUserId,
    store: createPgPrepStore(db),
    recipes: createPgPrepRecipes(db),
    integrations: createPgIntegrations(db, storage),
    engines: getMealPrepEngines,
    ai: createGeminiMealPrepAI(),
    credits: {
      canStart: (res, ownerId) => gate(res, ownerId, "meal_prep_plan"),
      charge: (ownerId, planId) => charge(ownerId, "meal_prep_plan", jobRefs.prepPlan(planId)),
    },
    instacart: () => {
      const config = instacartConfig();
      return config ? createInstacartClient(config) : null;
    },
    // There's no app-wide notification feed yet: the owner sees new swaps
    // on the plan (unseenSubstitutions), and anyone with the approved plan
    // open on the Kitchen calendar gets a live message.
    notifyOwner: (row, substitution) => {
      if (row.calendarMealPlanId) {
        mealPlanWsManager.broadcastToPlan(row.calendarMealPlanId, {
          type: "meal_prep_substitution",
          prepPlanId: row.id,
          note: substitution.note,
        });
      }
    },
  });
}
