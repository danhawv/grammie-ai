// One Food profile and one set of Display preferences per user
// (docs/DESIGN_PRINCIPLES.md §4 "User preferences").
//
// Everything is stored in the existing `users.preferences` JSONB column, using
// the keys the voice assistant, What Can I Make and the AI already read, so no
// database migration is needed. Readers should go through getFoodProfile() /
// getDisplayPrefs() instead of picking keys off the raw object.

import { z } from "zod";

export type CookingSkillLevel = "beginner" | "intermediate" | "advanced" | "professional";
export type TextSize = "default" | "large" | "xlarge";
/** "original" = as written in the recipe */
export type DisplayUnits = "original" | "us" | "metric";

export interface DisplayPreferences {
  textSize?: TextSize;
  units?: DisplayUnits;
}

/** The shape of users.preferences (all keys optional; older rows may lack any of them). */
export interface UserPreferences {
  quickFilters?: {
    enabled?: string[];
    order?: string[];
    showQuickFilters?: boolean;
  };
  /** Grocery/pantry/voice unit preference. Kept in sync with display.units when that is "us" or "metric". */
  unitSystem?: "metric" | "us";
  dietaryRestrictions?: string[];
  dislikedIngredients?: string[];
  allergies?: string[];
  cookingSkillLevel?: CookingSkillLevel;
  cuisinePreferences?: string[];
  householdSize?: number;
  cookingGoals?: string[];
  grammieNotes?: string;
  display?: DisplayPreferences;
  /** Open a "Check this recipe" step after each import. Off unless turned on in Me → Adding recipes. */
  checkImports?: boolean;
}

export const DIET_OPTIONS = [
  { id: "vegetarian", label: "Vegetarian" },
  { id: "vegan", label: "Vegan" },
  { id: "gluten-free", label: "Gluten-free" },
  { id: "dairy-free", label: "Dairy-free" },
  { id: "keto", label: "Keto" },
  { id: "low-carb", label: "Low-carb" },
] as const;

export const SKILL_LEVEL_OPTIONS: { id: CookingSkillLevel; label: string; hint: string }[] = [
  { id: "beginner", label: "Beginner", hint: "I'm new to cooking" },
  { id: "intermediate", label: "Intermediate", hint: "I cook regularly" },
  { id: "advanced", label: "Advanced", hint: "I'm comfortable with complex recipes" },
  { id: "professional", label: "Professional", hint: "I have culinary training" },
];

export const CUISINE_OPTIONS = [
  "Italian", "Mexican", "Asian", "American", "Mediterranean", "Indian", "French", "Japanese", "Thai",
] as const;

export const COOKING_GOAL_OPTIONS = [
  { id: "meal-prep", label: "Meal prep" },
  { id: "quick-weeknight", label: "Quick weeknight meals" },
  { id: "healthy-eating", label: "Healthy eating" },
  { id: "budget-friendly", label: "Budget friendly" },
  { id: "family-cooking", label: "Family cooking" },
  { id: "learning", label: "Learning new skills" },
] as const;

export const DEFAULT_HOUSEHOLD_SIZE = 2;
export const DEFAULT_SKILL_LEVEL: CookingSkillLevel = "intermediate";
export const MAX_HOUSEHOLD_SIZE = 20;

export interface FoodProfile {
  allergies: string[];
  diets: string[];
  /** Ingredients the person doesn't want (dislikes), not including allergies */
  dislikes: string[];
  /** Allergies + dislikes: everything recipe suggestions should leave out */
  avoidAll: string[];
  householdSize: number;
  skillLevel: CookingSkillLevel;
  cuisines: string[];
  goals: string[];
  notes: string;
}

/** Trim, lowercase, drop blanks and duplicates. */
export function normalizeIngredientList(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  const out: string[] = [];
  for (const raw of list) {
    if (typeof raw !== "string") continue;
    const v = raw.trim().toLowerCase();
    if (v && !out.includes(v)) out.push(v);
  }
  return out;
}

function stringList(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  return Array.from(new Set(list.filter((v): v is string => typeof v === "string" && v.trim() !== "")));
}

const SKILLS = new Set<string>(SKILL_LEVEL_OPTIONS.map((s) => s.id));

export function getFoodProfile(prefs: UserPreferences | null | undefined): FoodProfile {
  const p = prefs || {};
  const allergies = normalizeIngredientList(p.allergies);
  const dislikes = normalizeIngredientList(p.dislikedIngredients);
  const size = Number(p.householdSize);
  return {
    allergies,
    diets: stringList(p.dietaryRestrictions),
    dislikes,
    avoidAll: normalizeIngredientList([...allergies, ...dislikes]),
    householdSize: Number.isFinite(size) && size >= 1 ? Math.min(Math.round(size), MAX_HOUSEHOLD_SIZE) : DEFAULT_HOUSEHOLD_SIZE,
    skillLevel: p.cookingSkillLevel && SKILLS.has(p.cookingSkillLevel) ? p.cookingSkillLevel : DEFAULT_SKILL_LEVEL,
    cuisines: stringList(p.cuisinePreferences),
    goals: stringList(p.cookingGoals),
    notes: typeof p.grammieNotes === "string" ? p.grammieNotes : "",
  };
}

/** The Food profile written back in the stored key names. */
export function foodProfileToPreferences(profile: FoodProfile): Partial<UserPreferences> {
  return {
    allergies: normalizeIngredientList(profile.allergies),
    dietaryRestrictions: stringList(profile.diets),
    dislikedIngredients: normalizeIngredientList(profile.dislikes),
    householdSize: profile.householdSize,
    cookingSkillLevel: profile.skillLevel,
    cuisinePreferences: stringList(profile.cuisines),
    cookingGoals: stringList(profile.goals),
    grammieNotes: profile.notes,
  };
}

const TEXT_SIZES = new Set<string>(["default", "large", "xlarge"]);
const UNITS = new Set<string>(["original", "us", "metric"]);

export function isTextSize(v: unknown): v is TextSize {
  return typeof v === "string" && TEXT_SIZES.has(v);
}
export function isDisplayUnits(v: unknown): v is DisplayUnits {
  return typeof v === "string" && UNITS.has(v);
}

/** Whether imports stop at the "Check this recipe" step (off by default) */
export function wantsImportCheck(prefs: UserPreferences | null | undefined): boolean {
  return prefs?.checkImports === true;
}

/** Display preferences with gaps left as undefined (so callers can fall back to local values). */
export function getDisplayPrefs(prefs: UserPreferences | null | undefined): DisplayPreferences {
  const d = prefs?.display;
  return {
    textSize: isTextSize(d?.textSize) ? d!.textSize : undefined,
    units: isDisplayUnits(d?.units) ? d!.units : undefined,
  };
}

/**
 * Build the top-level keys to merge into users.preferences for a partial
 * update. `display` is merged key by key; when display.units is "us" or
 * "metric", the legacy `unitSystem` used by the grocery list, pantry and voice
 * assistant follows it ("as written" leaves it alone).
 */
export function buildPreferencesPatch(
  current: UserPreferences | null | undefined,
  update: Partial<UserPreferences>,
): Partial<UserPreferences> {
  const patch: Partial<UserPreferences> = {};
  for (const [key, value] of Object.entries(update) as [keyof UserPreferences, unknown][]) {
    if (value === undefined || key === "display") continue;
    (patch as Record<string, unknown>)[key] = value;
  }
  if (update.display) {
    const display: DisplayPreferences = { ...(current?.display || {}) };
    if (update.display.textSize !== undefined) display.textSize = update.display.textSize;
    if (update.display.units !== undefined) display.units = update.display.units;
    patch.display = display;
    if (update.display.units === "us" || update.display.units === "metric") {
      patch.unitSystem = update.display.units;
    }
  }
  return patch;
}

/** Whether a recipe ingredient name hits something on the avoid list (substring match either way). */
export function ingredientMatchesAvoid(ingredientName: string, avoid: string[]): boolean {
  const name = ingredientName.trim().toLowerCase();
  if (!name) return false;
  return avoid.some((a) => {
    const term = a.trim().toLowerCase();
    if (!term) return false;
    return name.includes(term) || term.includes(name);
  });
}

/**
 * What PUT /api/user/preferences accepts: any subset of the keys. Each key
 * given replaces that key; keys not given are left as they are.
 */
export const userPreferencesUpdateSchema = z.object({
  quickFilters: z.object({
    enabled: z.array(z.string().max(60)).max(50).optional(),
    order: z.array(z.string().max(60)).max(50).optional(),
    showQuickFilters: z.boolean().optional(),
  }).optional(),
  unitSystem: z.enum(["metric", "us"]).optional(),
  dietaryRestrictions: z.array(z.string().max(60)).max(30).optional(),
  dislikedIngredients: z.array(z.string().max(80)).max(100).optional(),
  allergies: z.array(z.string().max(80)).max(100).optional(),
  cookingSkillLevel: z.enum(["beginner", "intermediate", "advanced", "professional"]).optional(),
  cuisinePreferences: z.array(z.string().max(60)).max(30).optional(),
  householdSize: z.number().int().min(1).max(MAX_HOUSEHOLD_SIZE).optional(),
  cookingGoals: z.array(z.string().max(60)).max(30).optional(),
  grammieNotes: z.string().max(2000).optional(),
  checkImports: z.boolean().optional(),
  display: z.object({
    textSize: z.enum(["default", "large", "xlarge"]).optional(),
    units: z.enum(["original", "us", "metric"]).optional(),
  }).optional(),
});
