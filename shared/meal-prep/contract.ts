// Meal prep: the shared contract between its parts. Each part is built
// separately against these types, so change them only by agreement:
//
//   1. Food data   (server/meal-prep/food/)     canonical ingredients, USDA
//      nutrition, shelf life, package sizes -> RecipeFacts
//   2. Planner     (server/meal-prep/planner/)  PrepSetup + RecipeFacts -> PrepPlan
//   3. Session     (server/meal-prep/session/)  PrepPlan + RecipeFacts -> ShoppingList,
//      PrepSession (merged timeline), portions and labels
//   4. API         (server/routes/meal-prep.ts, server/meal-prep/store.ts) storage,
//      orchestration, AI wishes and explanations, cook share links
//   5. Screens     (client/src/pages/meal-prep*, client/src/components/meal-prep/)
//      guided first-run walkthrough, plan review, prep session, cook mode, packet
//
// Ideas behind the design (docs/MEAL_PREP.md):
//  - Recipes are kept as written; plates are tuned. Macros are hit with
//    portion multipliers and simple "adjusters" (plain rice, extra chicken),
//    never by changing the family's recipe.
//  - Exact math for numbers, AI for words. Totals, scaling and unit
//    conversion are computed in code; the model never adds up macros.
//  - Every number carries how sure we are (Confidence), shown as "≈" ranges.
//  - Food safety is built in: fridge/freezer windows, cooling, allergens.

// ---------- Shared basics ----------

export type MacroKey = "kcal" | "protein" | "carbs" | "fat";
export type Macros = Record<MacroKey, number> & { fiber?: number };

/** high = matched to USDA data with known amounts; medium = some guesses; low = AI estimate only */
export type Confidence = "high" | "medium" | "low";

export type MealSlot = "breakfast" | "lunch" | "dinner" | "snack";

/** Day index within the plan: 0 = first eating day */
export type DayIndex = number;

// ---------- Setup (what the walkthrough collects) ----------

export interface MacroTargets {
  kcal: number;
  /** grams; treated as a floor */
  protein: number;
  carbs?: number;
  fat?: number;
  /** allowed miss, as a fraction (default kcal 0.05, carbs/fat 0.15) */
  tolerance?: Partial<Record<MacroKey, number>>;
}

export interface PrepPerson {
  id: string;
  name: string;
  /** null = no targets, just "normal portions" */
  targets: MacroTargets | null;
  /** which meals this person eats from the prep, per day */
  slots: MealSlot[];
  /** ingredient names or canonical ids never to use (allergies are hard; dislikes are hard too) */
  allergies: string[];
  dislikes: string[];
}

export interface KitchenSetup {
  ovens: number; // 0..2
  ovenRacks: number; // per oven, usually 2
  burners: number; // usually 4
  /** e.g. "instant pot", "slow cooker", "air fryer", "rice cooker", "sheet pan" (with counts) */
  appliances: Array<{ kind: string; count: number }>;
  /** containers on hand, if known */
  containers?: number;
  freezerSpace?: "none" | "some" | "plenty";
}

export interface SessionSetup {
  /** date of the cooking session (ISO date) */
  date: string;
  /** longest the session may take, minutes (default 240) */
  maxMinutes: number;
  /** people cooking at once (1-2) */
  cooks: number;
  /** a hired helper runs it: produce the full cook packet and share link */
  helper: boolean;
  /** cook's skill, which pads task times */
  skill: "beginner" | "home" | "pro";
}

export interface PrepSetup {
  people: PrepPerson[];
  /** eating days covered (1-7), starting the day after the session unless startSameDay */
  days: number;
  startSameDay?: boolean;
  kitchen: KitchenSetup;
  session: SessionSetup;
  /** recipes to choose from; empty = all the owner's recipes */
  recipePool?: string[];
  /** must include / never include */
  pinnedRecipeIds?: string[];
  excludedRecipeIds?: string[];
  /** max distinct dishes to cook in the session (default 4-5) */
  maxDishes?: number;
  /** same dish at most this many times per person per week (default 4 lunches / 2 dinners) */
  maxRepeats?: Partial<Record<MealSlot, number>>;
  /** weekly grocery budget in dollars, optional */
  budget?: number;
  /** free text wishes ("more Mexican, no fish"), turned into weights by the API */
  wishes?: string;
}

// ---------- Food data (part 1 produces, parts 2-3 consume) ----------

export interface CanonicalIngredientRef {
  /** canonical ingredient id, e.g. "onion-yellow" */
  id: string;
  name: string;
  /** standard aisle (fixed list, see AISLES) */
  aisle: Aisle;
}

export const AISLES = [
  "Produce", "Meat & Seafood", "Dairy & Eggs", "Bakery", "Pantry", "Canned & Jarred",
  "Pasta, Rice & Grains", "Baking", "Spices & Seasonings", "Oils, Vinegars & Condiments",
  "Frozen", "Beverages", "Snacks", "Other",
] as const;
export type Aisle = (typeof AISLES)[number];

export interface IngredientLine {
  /** index into the recipe's ingredients array */
  index: number;
  raw: string;
  ingredient: CanonicalIngredientRef | null;
  /** amount in grams for the recipe's stated servings, null if unknown ("to taste") */
  grams: number | null;
  /** prep form, e.g. "diced", "minced", used to merge prep across recipes */
  prep: string | null;
  optional: boolean;
  confidence: Confidence;
}

export interface StorageInfo {
  fridgeDays: number;
  freezerDays: number | null; // null = doesn't freeze well
  reheat: string; // "Microwave 2-3 min, stir halfway"
  /** keep sauce/dressing separate, eat cold, etc. */
  notes: string[];
  reheatsWell: boolean;
}

/** Everything the planner and session builder need about one recipe */
export interface RecipeFacts {
  recipeId: string;
  title: string;
  servings: number;
  /** per serving, computed from ingredients (or the AI estimate when not possible) */
  perServing: Macros;
  confidence: Confidence;
  /** where the numbers came from */
  nutritionSource: "usda" | "mixed" | "ai_estimate";
  lines: IngredientLine[];
  mealTypes: MealSlot[];
  cuisines: string[];
  /** main protein, for variety: "chicken", "beef", "fish", "beans", ... */
  mainProtein: string | null;
  allergens: string[];
  activeMinutes: number;
  totalMinutes: number;
  storage: StorageInfo;
  /** owner's liking: rating 0-5, favorite, times cooked recently */
  preference: { rating: number | null; favorite: boolean; recentCount: number };
  /** whole-recipe ingredient cost estimate, dollars */
  cost: number | null;
  /** components this recipe can be split into for mix-and-match plates */
  component?: "protein" | "grain" | "veg" | "sauce" | "complete";
  /** how the numbers were checked (filled by food data) */
  nutritionCheck?: NutritionCheck;
}

export interface NutritionCheck {
  /** calorie-weighted share of the ingredient lines computed from USDA data, 0..1 */
  coverage: number;
  /** the stored AI estimate per serving, for comparison */
  aiPerServing: Macros | null;
  /** computed and AI calories differ by more than 25% */
  disagreesWithAi: boolean;
}

/** Single-ingredient add-ons with clean data used to tune plates */
export interface Adjuster {
  id: string; // "rice-cooked", "chicken-breast-cooked", "greek-yogurt", "olive-oil"
  name: string;
  ingredient: CanonicalIngredientRef;
  /** macros per gram */
  perGram: Macros;
  /** sensible step and limits in grams */
  stepGrams: number;
  maxGrams: number;
  /** which slots it suits */
  slots: MealSlot[];
  /** needs cooking in the session (rice) or not (yogurt) */
  needsCooking: boolean;
  storage: StorageInfo;
}

export interface FoodData {
  /** RecipeFacts for these recipes (computes and caches as needed) */
  factsFor(recipeIds: string[]): Promise<RecipeFacts[]>;
  adjusters(): Promise<Adjuster[]>;
  /** package sizes for buying, grams per package; empty if unknown */
  packagesFor(ingredientIds: string[]): Promise<Record<string, Array<{ label: string; grams: number; price?: number }>>>;
  /** canonical ingredient and macros per gram for free-text names (e.g. a mid-session swap); null if unknown */
  ingredientNutrition?(names: string[]): Promise<Record<string, { ingredient: CanonicalIngredientRef; perGram: Macros } | null>>;
}

// ---------- Plan (part 2 produces) ----------

export interface CookBatch {
  recipeId: string;
  /** recipe multiplier (0.5, 1, 1.5, 2, ...) */
  scale: number;
  servingsMade: number;
}

export interface PlateItem {
  /** a recipe portion or an adjuster */
  kind: "recipe" | "adjuster";
  refId: string;
  /** recipe: servings (e.g. 1.25); adjuster: grams */
  amount: number;
  /** grams on the plate, for the portioning plan (null if recipe yield weight unknown) */
  grams: number | null;
  macros: Macros;
}

export interface Plate {
  personId: string;
  day: DayIndex;
  slot: MealSlot;
  items: PlateItem[];
  macros: Macros;
  /** where it waits until eaten */
  storage: "fridge" | "freezer" | "fresh"; // fresh = cooked/finished that day
  eatBy: string; // ISO date
}

export interface DayFit {
  personId: string;
  day: DayIndex;
  macros: Macros;
  target: MacroTargets | null;
  status: Record<MacroKey, "ok" | "low" | "high" | "n/a">;
}

export interface PrepPlan {
  batches: CookBatch[];
  /** adjusters to cook in the session (e.g. 900 g rice), by adjuster id -> grams */
  adjusterCooking: Record<string, number>;
  plates: Plate[];
  fit: DayFit[];
  /** 0-100, share of person-days within all bands */
  fitScore: number;
  /** plain facts for the explanation (the API turns them into words) */
  notes: string[];
  /** when the solver couldn't satisfy everything: which limits bound */
  relaxed: string[];
  solverMs: number;
}

export interface Planner {
  plan(setup: PrepSetup, facts: RecipeFacts[], adjusters: Adjuster[], weights?: PlanWeights): Promise<PrepPlan>;
  /** replace one dish with alternatives that keep the week's macros (best first) */
  swapOptions(setup: PrepSetup, plan: PrepPlan, recipeId: string, facts: RecipeFacts[], adjusters: Adjuster[]): Promise<Array<{ recipeId: string; plan: PrepPlan }>>;
}

export interface PlanWeights {
  macro: number;
  preference: number;
  cost: number;
  handsOn: number;
  waste: number;
  /** recipe id -> bonus (from wishes) */
  recipeBonus?: Record<string, number>;
}

// ---------- Session (part 3 produces) ----------

export interface ShoppingItem {
  ingredient: CanonicalIngredientRef;
  /** total needed in grams, and a human amount ("2 medium onions", "3 cups") */
  neededGrams: number | null;
  display: string;
  /** what to buy ("1 bag (2 lb)"), when package sizes are known */
  buy: string | null;
  /** already have (pantry) */
  have: boolean;
  forRecipes: string[];
  substitutes: string[];
}

export interface ShoppingList {
  byAisle: Array<{ aisle: Aisle; items: ShoppingItem[] }>;
  /** "Check you have: cumin, 3 cups rice" */
  pantryCheck: string[];
  estimatedCost: number | null;
}

export type TaskKind =
  | "prep" | "preheat" | "cook" | "bake" | "simmer" | "rest" | "chill"
  | "marinate" | "assemble" | "cool" | "portion" | "clean";

export interface PrepTask {
  id: string;
  /** recipe ids this task serves (several when merged) */
  recipeIds: string[];
  text: string; // "Dice 3 onions (1 for Chili, 2 for Soup)"
  kind: TaskKind;
  activeMin: number;
  passiveMin: number;
  /** what it occupies while running */
  resources: Array<{ kind: "cook" | "oven" | "burner" | "board" | "appliance"; name?: string; qty: number; tempF?: number }>;
  dependsOn: string[];
  /** can wait this long after it's ready without harm */
  holdMin: number;
  /** "Chicken reaches 165°F", "Golden on top" */
  doneCue?: string;
  /** timer to start when the task starts, seconds */
  timerSec?: number;
}

export type Lane = "prep" | "stove" | "oven" | "other" | "clean";

export interface ScheduledTask extends PrepTask {
  lane: Lane;
  /** minutes from session start */
  start: number;
  end: number;
  /** which cook does the active part (1-based) */
  cook: number;
}

export interface ContainerLabel {
  plateKey: string; // `${personId}:${day}:${slot}`
  title: string; // "Mom's Chili + rice"
  person: string;
  madeOn: string; // ISO date
  eatBy: string;
  storage: "fridge" | "freezer";
  macros: Macros;
  confidence: Confidence;
  reheat: string;
  allergens: string[];
  /** "350 g chili + 150 g rice; sauce in a separate cup" */
  portion: string;
}

export interface PrepSession {
  tasks: ScheduledTask[];
  totalMinutes: number;
  handsOnMinutes: number;
  /** all chopping and measuring first, merged across recipes */
  misePlace: Array<{ text: string; recipeIds: string[] }>;
  equipment: string[];
  /** owner's checklist for the day before: defrost, containers, pantry */
  beforeSession: string[];
  labels: ContainerLabel[];
  containers: { count: number; bySize?: Record<string, number> };
  safety: string[]; // "Cool in shallow containers; fridge within 2 hours", allergen warnings
  warnings: string[]; // e.g. "Session runs 20 min over your 4 hours"
}

export interface SessionBuilder {
  shopping(plan: PrepPlan, facts: RecipeFacts[], adjusters: Adjuster[], pantry: string[], food: FoodData): Promise<ShoppingList>;
  session(setup: PrepSetup, plan: PrepPlan, facts: RecipeFacts[], adjusters: Adjuster[]): Promise<PrepSession>;
}
