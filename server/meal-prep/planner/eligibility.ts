// Hard rules decided before the solver runs: who may eat which recipe
// (allergies, dislikes), which slots a recipe suits, and how long a dish keeps.

import type { Adjuster, PrepPerson, RecipeFacts, MealSlot, PrepSetup, StorageInfo } from "@shared/meal-prep/contract";

// Allergy words people type, expanded to the ingredients they cover. Matching
// errs toward excluding: "nut" also catches "nutmeg", which is a fair price.
const TERM_GROUPS: Record<string, string[]> = {
  nut: ["nut", "almond", "walnut", "pecan", "cashew", "pistachio", "hazelnut", "macadamia", "pine nut", "praline", "marzipan", "nutella", "peanut"],
  "tree nut": ["almond", "walnut", "pecan", "cashew", "pistachio", "hazelnut", "macadamia", "pine nut", "brazil nut", "praline", "marzipan", "tree nut"],
  peanut: ["peanut", "groundnut"],
  dairy: ["milk", "cheese", "butter", "cream", "yogurt", "yoghurt", "whey", "casein", "ghee", "parmesan", "mozzarella", "cheddar", "ricotta", "dairy"],
  milk: ["milk", "cheese", "butter", "cream", "yogurt", "yoghurt", "whey", "casein", "ghee", "dairy"],
  lactose: ["milk", "cheese", "cream", "yogurt", "yoghurt", "dairy"],
  egg: ["egg", "mayonnaise", "mayo", "meringue"],
  gluten: ["wheat", "flour", "bread", "pasta", "noodle", "barley", "rye", "couscous", "breadcrumb", "panko", "cracker", "tortilla", "seitan", "gluten", "soy sauce", "farro", "bulgur"],
  wheat: ["wheat", "flour", "bread", "pasta", "noodle", "couscous", "breadcrumb", "panko", "cracker", "seitan", "bulgur"],
  soy: ["soy", "tofu", "edamame", "tempeh", "miso"],
  sesame: ["sesame", "tahini"],
  fish: ["fish", "salmon", "tuna", "cod", "tilapia", "halibut", "trout", "anchov", "sardine", "mackerel", "haddock", "pollock", "catfish", "snapper", "bass"],
  shellfish: ["shellfish", "shrimp", "prawn", "crab", "lobster", "clam", "mussel", "oyster", "scallop", "crawfish", "crayfish"],
  seafood: ["fish", "salmon", "tuna", "cod", "tilapia", "shrimp", "prawn", "crab", "lobster", "clam", "mussel", "oyster", "scallop", "anchov", "sardine"],
  meat: ["beef", "pork", "chicken", "turkey", "lamb", "veal", "bacon", "ham", "sausage", "steak", "prosciutto", "salami", "pepperoni", "chorizo", "duck", "venison", "meat", "gelatin"],
  pork: ["pork", "bacon", "ham", "prosciutto", "salami", "pepperoni", "chorizo", "lard", "pancetta"],
};
// Diet words in the dislikes list work as shortcuts.
TERM_GROUPS.vegetarian = Array.from(new Set([...TERM_GROUPS.meat, ...TERM_GROUPS.seafood, ...TERM_GROUPS.shellfish, "anchov", "fish sauce", "lard"]));
TERM_GROUPS.vegan = Array.from(new Set([...TERM_GROUPS.vegetarian, ...TERM_GROUPS.dairy, ...TERM_GROUPS.egg, "honey"]));
TERM_GROUPS.pescatarian = TERM_GROUPS.meat;

function norm(s: string): string {
  return s.toLowerCase().replace(/[-_]/g, " ").replace(/\s+/g, " ").trim();
}

function singular(t: string): string {
  if (t.endsWith("ies")) return t.slice(0, -3) + "y";
  if (t.endsWith("oes")) return t.slice(0, -2);
  if (t.endsWith("es") && /(sh|ch|x|s)es$/.test(t)) return t.slice(0, -2);
  if (t.endsWith("s") && !t.endsWith("ss")) return t.slice(0, -1);
  return t;
}

/** Expands what a person typed ("tree nuts", "Dairy") into words to look for. */
export function expandTerms(input: string[]): string[] {
  const out = new Set<string>();
  for (const raw of input) {
    const t = norm(raw);
    if (!t) continue;
    const s = singular(t);
    const group = TERM_GROUPS[t] ?? TERM_GROUPS[s];
    if (group) group.forEach((g) => out.add(g));
    out.add(s);
  }
  return Array.from(out);
}

function wordStart(w: string): RegExp {
  return new RegExp("(^|[^a-z])" + w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
}

/** Text that describes what's in a recipe, for matching. */
function recipeTexts(r: RecipeFacts): string[] {
  const texts: string[] = [];
  for (const l of r.lines) {
    texts.push(norm(l.raw));
    if (l.ingredient) texts.push(norm(l.ingredient.id), norm(l.ingredient.name));
  }
  r.allergens.forEach((a) => texts.push(norm(a)));
  if (r.mainProtein) texts.push(norm(r.mainProtein));
  return texts;
}

/** The first word that rules this recipe out, or null if it's fine. */
export function matchExclusion(r: RecipeFacts, words: string[]): string | null {
  if (!words.length) return null;
  const texts = recipeTexts(r);
  for (const w of words) {
    // Match at the start of a word ("nut" catches "nutmeg" and "nuts" but
    // not "coconut"; the groups above list the compound words). Erring toward
    // excluding is the safe side for allergies.
    const re = wordStart(w);
    if (texts.some((t) => re.test(t))) return w;
  }
  return null;
}

export function adjusterExcluded(a: Adjuster, words: string[]): boolean {
  const texts = [norm(a.id), norm(a.name), norm(a.ingredient.id), norm(a.ingredient.name)];
  return words.some((w) => {
    const re = wordStart(w);
    return texts.some((t) => re.test(t));
  });
}

export function personWords(p: PrepPerson): string[] {
  return expandTerms([...p.allergies, ...p.dislikes]);
}

/** below this per serving, a recipe is a side or snack, not a meal on its own */
export const MIN_MEAL_KCAL = 150;

/**
 * Whether a recipe suits a meal. Recipes with no meal types (rubs, sauces,
 * unknowns) suit nothing on their own; very light recipes suit snacks only.
 */
export function suitsSlot(r: RecipeFacts, slot: MealSlot): boolean {
  if (!r.mealTypes.includes(slot)) return false;
  return slot === "snack" || r.perServing.kcal >= MIN_MEAL_KCAL;
}

/** Days between the session and eating day `day` (0 = eaten the day of the session). */
export function ageOnDay(setup: PrepSetup, day: number): number {
  return setup.startSameDay ? day : day + 1;
}

export type Keeping = "fresh" | "fridge" | "freezer" | "no";

/** How a plate made in the session can wait until it's eaten on a day this many days later. */
export function keepingFor(storage: StorageInfo, age: number, freezerOk: boolean): Keeping {
  if (age <= 0) return "fresh";
  if (age <= storage.fridgeDays) return "fridge";
  if (freezerOk && storage.freezerDays != null && age <= storage.freezerDays) return "freezer";
  return "no";
}

export function addDays(isoDate: string, days: number): string {
  const d = new Date(isoDate + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
