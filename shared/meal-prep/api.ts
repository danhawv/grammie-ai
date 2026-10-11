// Meal prep: request and response shapes of /api/meal-prep (server/routes/
// meal-prep.ts), shared with the screens. Built on the types in contract.ts.

import type {
  KitchenSetup, MealSlot, PrepPerson, PrepPlan, PrepSession, PrepSetup,
  SessionSetup, ShoppingList,
} from "./contract";

export type PrepPlanStatus = "draft" | "approved" | "done" | "cancelled";
/** building = the solver is still working; poll GET /plans/:id */
export type PrepBuildStatus = "building" | "ready" | "failed";
export type CheckinOutcome = "ate" | "too_much" | "too_little" | "skipped" | "threw_out";

export const CHECKIN_OUTCOMES: CheckinOutcome[] = ["ate", "too_much", "too_little", "skipped", "threw_out"];

/** The walkthrough's answers, saved as next time's defaults (no session date) */
export interface PrepProfileDefaults {
  people?: PrepPerson[];
  days?: number;
  startSameDay?: boolean;
  kitchen?: KitchenSetup;
  session?: Omit<SessionSetup, "date">;
  maxDishes?: number;
  maxRepeats?: Partial<Record<MealSlot, number>>;
  budget?: number;
}

export interface PrepProfile {
  defaults: PrepProfileDefaults;
  walkthroughDone: boolean;
  updatedAt: string | null;
}

/**
 * What the free-text wishes became. The model only picks recipe ids from the
 * owner's list; the bonus numbers are set in code. Shown as "Suggested by
 * Grammie" and undone with PATCH (unexclude / clearWishes).
 */
export interface WishesResult {
  wishes: string;
  /** recipe id -> bonus passed to the planner (PlanWeights.recipeBonus) */
  recipeBonus: Record<string, number>;
  /** recipe ids left out because of the wishes */
  excludedRecipeIds: string[];
  /** recipe ids, for showing what was understood */
  more: string[];
  less: string[];
  /** "ai" = understood by the model; "none" = no wishes or the model failed */
  source: "ai" | "none";
}

/** A swap the cook (or owner) made during the session */
export interface PrepSubstitution {
  id: string;
  ingredient: string;
  replacement: string;
  by: "cook" | "owner";
  at: string;
  /** recipes that used the ingredient */
  recipeIds: string[];
  /** label plateKeys whose numbers changed */
  labelKeys: string[];
  /** true when label macros were recomputed from food data; false = numbers are rougher now */
  nutritionUpdated: boolean;
  /** plain sentence for the owner ("Used Greek yogurt instead of sour cream in Chili.") */
  note: string;
  /** owner saw it (POST /plans/:id/substitutions/seen); null = new */
  seenAt: string | null;
}

export interface TaskProgress {
  doneAt: string;
  by: "owner" | "cook";
}

export interface PrepPlanView {
  id: string;
  status: PrepPlanStatus;
  buildStatus: PrepBuildStatus;
  /** plain words, when buildStatus is "failed" */
  buildError: string | null;
  setup: PrepSetup;
  plan: PrepPlan | null;
  shopping: ShoppingList | null;
  session: PrepSession | null;
  /** 2-4 friendly sentences */
  explanation: string | null;
  /** true = written by the model (label it "Suggested by Grammie"); false = plain text from the plan's notes */
  explanationByAI: boolean;
  wishes: WishesResult | null;
  /** recipe id -> title for every recipe in the plan */
  recipeTitles: Record<string, string>;
  /** task id -> progress */
  progress: Record<string, TaskProgress>;
  substitutions: PrepSubstitution[];
  /** substitutions not yet seen by the owner */
  unseenSubstitutions: number;
  sessionDate: string | null;
  calendarMealPlanId: string | null;
  groceryListId: string | null;
  createdAt: string;
  updatedAt: string;
  approvedAt: string | null;
}

export interface PrepPlanSummary {
  id: string;
  status: PrepPlanStatus;
  buildStatus: PrepBuildStatus;
  sessionDate: string | null;
  days: number;
  people: number;
  dishes: string[];
  fitScore: number | null;
  unseenSubstitutions: number;
  createdAt: string;
}

export interface SwapOptionView {
  recipeId: string;
  title: string;
  fitScore: number;
  /** fitScore minus the current plan's (negative = a bit further from targets) */
  fitScoreChange: number;
  notes: string[];
}

export interface PrepShareView {
  id: string;
  role: "cook";
  label: string | null;
  expiresAt: string;
  revokedAt: string | null;
  createdAt: string;
  active: boolean;
}

/** Returned once, when the link is made; the token is not stored in a readable form */
export interface PrepShareCreated extends PrepShareView {
  token: string;
  /** client path for the cook page */
  path: string;
}

export interface CookRecipe {
  id: string;
  title: string;
  servings: number;
  /** recipe multiplier from the plan */
  scale: number;
  ingredients: string[];
  instructions: string[];
}

/** What a hired cook sees: the session, labels and the plan's recipes, nothing else */
export interface CookView {
  planId: string;
  sessionDate: string | null;
  days: number;
  session: PrepSession | null;
  shopping: ShoppingList | null;
  recipes: CookRecipe[];
  /** ingredients someone in the household must not have (no names) */
  householdAllergies: string[];
  progress: Record<string, TaskProgress>;
  substitutions: Array<Pick<PrepSubstitution, "id" | "ingredient" | "replacement" | "at" | "note">>;
  expiresAt: string;
}

export interface PrepCheckin {
  id: string;
  personId: string;
  day: number;
  slot: MealSlot;
  outcome: CheckinOutcome;
  note: string | null;
  updatedAt: string;
}
