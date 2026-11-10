// Request validation for /api/meal-prep. Bounds are generous for real
// households and tight enough that one request can't make the solver or the
// model do unbounded work.

import { z } from "zod";
import { CHECKIN_OUTCOMES } from "@shared/meal-prep/api";

const id = z.string().trim().min(1).max(100);
const recipeIds = z.array(id).max(500);
const slot = z.enum(["breakfast", "lunch", "dinner", "snack", "dessert"]);
const name = z.string().trim().min(1).max(80);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-10-18")
  .refine(s => !Number.isNaN(Date.parse(`${s}T00:00:00Z`)), "That date doesn't exist");

const tolerance = z.object({
  kcal: z.number().min(0).max(0.5),
  protein: z.number().min(0).max(0.5),
  carbs: z.number().min(0).max(0.5),
  fat: z.number().min(0).max(0.5),
}).partial();

export const macroTargetsSchema = z.object({
  kcal: z.number().min(800).max(6000),
  protein: z.number().min(0).max(400),
  carbs: z.number().min(0).max(800).optional(),
  fat: z.number().min(0).max(400).optional(),
  tolerance: tolerance.optional(),
});

export const personSchema = z.object({
  id,
  name,
  targets: macroTargetsSchema.nullable(),
  slots: z.array(slot).min(1).max(5),
  allergies: z.array(z.string().trim().min(1).max(60)).max(30).default([]),
  dislikes: z.array(z.string().trim().min(1).max(60)).max(50).default([]),
});

export const kitchenSchema = z.object({
  ovens: z.number().int().min(0).max(2),
  ovenRacks: z.number().int().min(1).max(4),
  burners: z.number().int().min(0).max(8),
  appliances: z.array(z.object({ kind: z.string().trim().min(1).max(40), count: z.number().int().min(1).max(5) })).max(20),
  containers: z.number().int().min(0).max(200).optional(),
  freezerSpace: z.enum(["none", "some", "plenty"]).optional(),
});

const sessionPrefs = z.object({
  maxMinutes: z.number().int().min(30).max(600),
  cooks: z.number().int().min(1).max(2),
  helper: z.boolean(),
  skill: z.enum(["beginner", "home", "pro"]),
});

export const sessionSchema = sessionPrefs.extend({ date: isoDate });

const maxRepeats = z.object({
  breakfast: z.number().int().min(1).max(7),
  lunch: z.number().int().min(1).max(7),
  dinner: z.number().int().min(1).max(7),
  snack: z.number().int().min(1).max(7),
  dessert: z.number().int().min(1).max(7),
}).partial();

const recipeSource = z.object({
  kind: z.enum(["all", "cookbooks", "favorites"]),
  cookbookIds: z.array(z.number().int().positive()).max(50).optional(),
}).refine(s => s.kind !== "cookbooks" || (s.cookbookIds?.length ?? 0) > 0, "Pick at least one cookbook");

const topUps = z.enum(["chicken", "shake", "both", "none"]);

/** Round 2 choices, shared by the setup and the saved defaults */
const planningChoices = {
  recipeSource: recipeSource.optional(),
  allowSwaps: z.boolean().optional(),
  topUps: topUps.optional(),
  dessertsPerWeek: z.number().int().min(1).max(7).optional(),
  shakeId: id.optional(),
};

export const prepSetupSchema = z.object({
  people: z.array(personSchema).min(1).max(8)
    .refine(p => new Set(p.map(x => x.id)).size === p.length, "Each person needs their own id"),
  days: z.number().int().min(1).max(7),
  startSameDay: z.boolean().optional(),
  kitchen: kitchenSchema,
  session: sessionSchema,
  recipePool: recipeIds.optional(),
  pinnedRecipeIds: recipeIds.max(10).optional(),
  excludedRecipeIds: recipeIds.optional(),
  maxDishes: z.number().int().min(1).max(8).optional(),
  maxRepeats: maxRepeats.optional(),
  budget: z.number().min(0).max(2000).optional(),
  wishes: z.string().trim().max(500).optional(),
  ...planningChoices,
  /** "recipeId:swapId" */
  excludedSwaps: z.array(z.string().trim().min(3).max(220)).max(200).optional(),
});

export const profileDefaultsSchema = z.object({
  people: z.array(personSchema).max(8).optional(),
  days: z.number().int().min(1).max(7).optional(),
  startSameDay: z.boolean().optional(),
  kitchen: kitchenSchema.optional(),
  session: sessionPrefs.optional(),
  maxDishes: z.number().int().min(1).max(8).optional(),
  maxRepeats: maxRepeats.optional(),
  budget: z.number().min(0).max(2000).optional(),
  ...planningChoices,
});

export const putProfileSchema = z.object({
  defaults: profileDefaultsSchema,
  walkthroughDone: z.boolean().optional(),
});

/** PATCH /plans/:id: pin/exclude dishes, adjust setup, and re-plan */
export const patchPlanSchema = z.object({
  pin: recipeIds.max(10).optional(),
  unpin: recipeIds.optional(),
  exclude: recipeIds.optional(),
  /** also lifts exclusions that came from wishes */
  unexclude: recipeIds.optional(),
  /** replaces these setup fields (people, days, kitchen, session, ...) */
  setup: prepSetupSchema.partial().optional(),
  /** new wishes text; "" clears them */
  wishes: z.string().trim().max(500).optional(),
  /** drop what the wishes did without changing the text */
  clearWishes: z.boolean().optional(),
  /** "Keep it as written": turn these swaps off ("recipeId:swapId") and re-plan */
  keepAsWritten: z.array(z.string().trim().min(3).max(220)).max(50).optional(),
  /** allow these swaps again */
  allowSwapsAgain: z.array(z.string().trim().min(3).max(220)).max(50).optional(),
  /** done / cancelled without re-planning */
  status: z.enum(["done", "cancelled"]).optional(),
});

export const swapSchema = z.object({ recipeId: id });
/** POST /this-week/recipes: one recipe from its "…" menu */
export const thisWeekRecipeSchema = z.object({ recipeId: id });
export const chooseOptionSchema = z.object({ key: z.enum(["balanced", "protein", "variety", "quick"]) });
export const chooseSwapSchema = z.object({ recipeId: id });

export const approveSchema = z.object({
  addToCalendar: z.boolean().default(true),
  addToGroceryList: z.boolean().default(true),
  /** add_to_existing keeps the current list and adds to it */
  groceryMode: z.enum(["add_to_existing", "create_new"]).default("add_to_existing"),
});

export const shareSchema = z.object({
  label: z.string().trim().max(100).optional(),
  /** default: 3 days after the session; at most 30 */
  expiresInDays: z.number().int().min(1).max(30).optional(),
});

export const progressSchema = z.object({ taskId: id, done: z.boolean() });

export const substitutionSchema = z.object({
  ingredient: z.string().trim().min(1).max(80),
  replacement: z.string().trim().min(1).max(80),
});

export const checkinSchema = z.object({
  personId: id,
  day: z.number().int().min(0).max(6),
  slot,
  outcome: z.enum(CHECKIN_OUTCOMES as [string, ...string[]]),
  note: z.string().trim().max(500).optional(),
});

export type PatchPlanInput = z.infer<typeof patchPlanSchema>;

/** First zod issue as a sentence for the screen */
export function firstIssue(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return "Something in the form needs a look.";
  const where = issue.path.join(".");
  return where ? `${where}: ${issue.message}` : issue.message;
}
