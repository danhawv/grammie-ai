// "What can I make?" matching: which of a recipe's ingredients are already in
// the pantry, which are missing, and which are everyday staples we assume are
// on hand (salt, pepper, oil, water, flour, sugar, common dried spices).
//
// Pure TypeScript with no Node or browser imports, so the server route and the
// client (grocery list "Hide items I have") use the same rules.

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

/** Words that describe an ingredient's state or size, not what it is. */
const DESCRIPTORS = new Set([
  "a", "an", "the", "of", "about", "approximately", "approx", "heaping", "level", "generous", "scant",
  "fresh", "freshly", "frozen", "thawed", "large", "extra", "small", "medium", "jumbo", "ripe", "organic",
  "raw", "boneless", "skinless", "bone", "in", "skin", "on", "chopped", "diced", "minced", "sliced",
  "shredded", "grated", "julienned", "cubed", "crushed", "mashed", "melted", "softened", "cold", "warm",
  "room", "temperature", "beaten", "lightly", "peeled", "seeded", "deveined", "halved", "quartered",
  "trimmed", "rinsed", "drained", "packed", "firmly", "loosely", "finely", "roughly", "coarsely",
  "thinly", "thickly", "unsalted", "salted", "plain", "lean", "low", "sodium", "reduced", "nonfat",
  "lowfat", "good", "quality", "store", "bought", "homemade", "prepared", "cooked", "uncooked", "dried",
  "dry", "canned", "jarred", "whole", "virgin", "pure", "unsweetened", "sweetened", "pitted", "zested",
  "juiced", "squeezed", "toasted", "roasted", "fat", "free", "skim", "kosher", "sea", "table", "fine",
]);

/**
 * Modifiers that turn one ingredient into a different one: pantry "milk" does
 * not cover "coconut milk", and "butter" does not cover "peanut butter".
 */
const IDENTITY_MODIFIERS = new Set([
  "peanut", "almond", "cashew", "hazelnut", "coconut", "oat", "soy", "rice", "sweet", "sour", "cream",
  "condensed", "evaporated", "powdered", "chocolate", "goat", "cottage", "vegan", "plant", "apple",
  "maple", "garlic", "onion", "tomato", "sun", "nut", "seed", "buttermilk", "malted", "baking", "truffle",
]);

/** Proteins whose generic name covers any cut, and the cuts themselves. */
const PROTEINS = new Set(["chicken", "beef", "pork", "turkey", "lamb", "egg", "salmon", "fish"]);
const CUTS = new Set([
  "breast", "thigh", "leg", "drumstick", "wing", "tender", "tenderloin", "cutlet", "fillet", "filet",
  "steak", "chop", "loin", "shoulder", "rib", "yolk", "white",
]);

/** Phrase synonyms, in normalized (singular, descriptor-free) form. */
const SYNONYMS: Record<string, string> = {
  "scallion": "green onion",
  "spring onion": "green onion",
  "coriander leaf": "cilantro",
  "courgette": "zucchini",
  "aubergine": "eggplant",
  "capsicum": "bell pepper",
  "garbanzo bean": "chickpea",
  "garbanzo": "chickpea",
  "prawn": "shrimp",
  "chicken stock": "chicken broth",
  "beef stock": "beef broth",
  "vegetable stock": "vegetable broth",
  "stock": "broth",
  "heavy whipping cream": "heavy cream",
  "whipping cream": "heavy cream",
  "double cream": "heavy cream",
  "confectioner sugar": "powdered sugar",
  "confectioners sugar": "powdered sugar",
  "icing sugar": "powdered sugar",
  "bicarbonate soda": "baking soda",
  "all purpose flour": "flour",
  "ap flour": "flour",
  "granulated sugar": "sugar",
  "white sugar": "sugar",
  "caster sugar": "sugar",
  "mayo": "mayonnaise",
  "yoghurt": "yogurt",
  "parmigiano reggiano": "parmesan",
  "parmesan cheese": "parmesan",
  "cheddar cheese": "cheddar",
  "mozzarella cheese": "mozzarella",
  "catsup": "ketchup",
  "beef mince": "ground beef",
  "minced beef": "ground beef",
  "turkey mince": "ground turkey",
  "pork mince": "ground pork",
  "rapeseed oil": "canola oil",
};

const SYNONYM_KEYS_LONGEST_FIRST = Object.keys(SYNONYMS).sort((a, b) => b.length - a.length);

/** Everyday items most kitchens have; treated as on hand. */
const STAPLES = new Set([
  "salt", "pepper", "black pepper", "white pepper", "peppercorn", "black peppercorn", "salt and pepper",
  "water", "ice", "ice cube", "ice water",
  "oil", "olive oil", "vegetable oil", "canola oil", "cooking oil", "neutral oil", "cooking spray",
  "nonstick cooking spray", "avocado oil",
  "flour", "sugar", "brown sugar", "light brown sugar", "dark brown sugar", "powdered sugar",
  "baking soda", "baking powder", "vanilla", "vanilla extract", "cornstarch",
  "cinnamon", "nutmeg", "paprika", "smoked paprika", "cumin", "chili powder", "garlic powder",
  "onion powder", "oregano", "thyme", "rosemary", "bay leaf", "italian seasoning", "cayenne",
  "cayenne pepper", "red pepper flake", "crushed red pepper flake", "curry powder", "dill weed",
  "seasoning salt", "seasoned salt", "garlic salt", "onion salt", "allspice", "clove",
]);

/** Spices that are only staples when written "ground …" (ginger alone is fresh root). */
const GROUND_SPICES = new Set([
  "ginger", "clove", "allspice", "coriander", "turmeric", "cardamom", "cinnamon", "nutmeg", "cumin",
  "black pepper", "pepper", "white pepper", "mustard", "sage", "mace",
]);

/** Words that look plural but aren't (or shouldn't be singularized). */
const SINGULAR_EXCEPTIONS = new Set([
  "molasses", "hummus", "couscous", "asparagus", "swiss", "grits", "citrus", "lemongrass", "bass",
  "watercress", "series", "species", "brussels", "cress", "anise", "gas",
]);

const IRREGULAR_SINGULARS: Record<string, string> = {
  leaves: "leaf", halves: "half", loaves: "loaf", knives: "knife", calves: "calf",
};

/** Units that can open an ingredient line ("2 cups flour"). */
const UNIT_WORDS = new Set([
  "cup", "cups", "tablespoon", "tablespoons", "tbsp", "tbsps", "tbs", "tbl", "teaspoon", "teaspoons",
  "tsp", "tsps", "ounce", "ounces", "oz", "pound", "pounds", "lb", "lbs", "gram", "grams", "kilogram",
  "kilograms", "kg", "milliliter", "milliliters", "millilitre", "millilitres", "ml", "liter", "liters",
  "litre", "litres", "pint", "pints", "quart", "quarts", "qt", "gallon", "gallons", "stick", "sticks",
  "clove", "cloves", "can", "cans", "jar", "jars", "package", "packages", "pkg", "pkgs", "packet", "packets",
  "bag", "bags", "box", "boxes", "bunch", "bunches", "head", "heads", "sprig", "sprigs", "pinch",
  "pinches", "dash", "dashes", "slice", "slices", "piece", "pieces", "handful", "handfuls", "stalk",
  "stalks", "fl", "envelope", "envelopes", "container", "containers", "drop", "drops", "splash",
  "bottle", "bottles", "carton", "cartons", "block", "blocks", "sheet", "sheets", "fillets",
]);
/** One-letter units only count right after a number ("2 c flour", "1 T butter"). */
const SHORT_UNITS = new Set(["c", "t", "g", "l"]);

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

function stripAccents(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function singularize(word: string): string {
  if (word.length <= 3 || SINGULAR_EXCEPTIONS.has(word)) return word;
  if (IRREGULAR_SINGULARS[word]) return IRREGULAR_SINGULARS[word];
  if (word.endsWith("ies") && word.length > 4) return word.slice(0, -3) + "y";
  if (/(ches|shes|xes|zes|sses)$/.test(word)) return word.slice(0, -2);
  if (word.endsWith("oes")) return word.slice(0, -2);
  if (word.endsWith("s") && !/(ss|us|is)$/.test(word)) return word.slice(0, -1);
  return word;
}

function hasMeaningfulWord(segment: string): boolean {
  return segment
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .some((w) => w && !DESCRIPTORS.has(w));
}

/**
 * Drop prep notes after a comma, but keep leading descriptor-only segments:
 * "chicken thighs, cut into strips" → "chicken thighs";
 * "boneless, skinless chicken thighs" → "boneless, skinless chicken thighs".
 */
function meaningfulPrefix(s: string): string {
  const segments = s.split(",");
  const kept: string[] = [];
  for (const seg of segments) {
    kept.push(seg.trim());
    if (hasMeaningfulWord(seg)) break;
  }
  return kept.filter(Boolean).join(", ");
}

const FRACTION_CHARS = /[¼-¾⅐-⅞]/g;
const NUMBER_TOKEN = /^(\d+([.,/]\d+)?|\d*[¼-¾⅐-⅞]|-|–|to|x|about|a|an)$/;

/**
 * Pull the ingredient name out of a recipe line:
 * "2 cups (480 ml) whole milk, warmed" → "whole milk".
 * Returns "" for section headers ("For the sauce:").
 */
export function extractIngredientName(raw: string): string {
  let s = stripAccents(raw ?? "").trim();
  if (!s) return "";
  if (/:\s*$/.test(s) || /^for the\b/i.test(s)) return "";
  s = s.replace(/\([^)]*\)/g, " ").replace(/\[[^\]]*\]/g, " ");
  s = s.replace(FRACTION_CHARS, (m) => ` ${m} `);
  s = s.replace(/\b(to taste|as needed|for garnish|for serving|for the pan|optional|divided|plus more|or more|if needed|if desired)\b/gi, " ");
  const words = s.trim().split(/\s+/).filter(Boolean);
  let i = 0;
  let sawNumber = false;
  while (i < words.length) {
    const w = words[i].toLowerCase().replace(/\.$/, "");
    if (NUMBER_TOKEN.test(w) || /^\d/.test(w)) { sawNumber = true; i++; continue; }
    if (UNIT_WORDS.has(w) || (sawNumber && SHORT_UNITS.has(w))) {
      // Keep "cloves" when it's the spice ("1 tsp ground cloves" never reaches here; "whole cloves" stops earlier)
      i++;
      continue;
    }
    if (w === "of" && i > 0) { i++; continue; }
    break;
  }
  // "4 cloves" with nothing after: the unit word is the ingredient
  const rest = i >= words.length ? words.slice(-1) : words.slice(i);
  if (rest.length === 1 && /^\d/.test(rest[0])) return "";
  return meaningfulPrefix(rest.join(" ")).replace(/[\s,]+$/, "").trim();
}

/** Whether a recipe line marks itself optional or garnish. */
export function isOptionalLine(raw: string): boolean {
  return /\b(optional|for garnish|garnish)\b/i.test(raw ?? "");
}

/** Lowercase, drop punctuation and descriptors, singularize, apply synonyms. */
export function normalizeIngredient(name: string): string {
  let s = stripAccents(name ?? "").toLowerCase();
  s = meaningfulPrefix(s.replace(/\([^)]*\)/g, " "));
  s = s.replace(/&/g, " and ").replace(/[-_/]/g, " ").replace(/[^a-z\s]/g, " ");
  const tokens = s.split(/\s+/).filter((t) => t && !DESCRIPTORS.has(t)).map(singularize);
  // "garlic cloves" / "cloves garlic" → "garlic"
  if (tokens.includes("garlic")) {
    const idx = tokens.indexOf("clove");
    if (idx >= 0) tokens.splice(idx, 1);
  }
  const joined = tokens.join(" ");
  if (SYNONYMS[joined]) return SYNONYMS[joined];
  // "sharp cheddar cheese" → "sharp cheddar": longest synonym that ends the name
  for (const key of SYNONYM_KEYS_LONGEST_FIRST) {
    if (joined.endsWith(" " + key)) return joined.slice(0, -key.length) + SYNONYMS[key];
  }
  return joined;
}

/** "butter or margarine" → ["butter", "margarine"]; keeps "half and half". */
function alternatives(normalized: string): string[] {
  return normalized.split(/\s+or\s+/).map((s) => s.trim()).filter(Boolean);
}

/** True for salt, pepper, oil, water, flour, sugar and common dried spices. */
export function isStaple(name: string): boolean {
  const lower = stripAccents(name ?? "").toLowerCase();
  // Fresh herbs and fresh ginger aren't pantry staples
  if (/\bfresh\b/.test(lower)) return false;
  const norm = normalizeIngredient(name);
  if (!norm) return false;
  return alternatives(norm).some((alt) => {
    if (STAPLES.has(alt)) return true;
    if (alt.startsWith("ground ") && GROUND_SPICES.has(alt.slice(7))) return true;
    // "salt and pepper", "salt and black pepper"
    if (alt.includes(" and ")) {
      const parts = alt.split(" and ").map((p) => p.trim()).filter(Boolean);
      return parts.length > 1 && parts.every((p) => STAPLES.has(p));
    }
    return false;
  });
}

function isSubset(a: string[], b: string[]): boolean {
  return a.every((t) => b.includes(t));
}

/**
 * Do two normalized names refer to the same thing for cooking purposes?
 * - exact match ("chicken thigh" = "boneless skinless chicken thighs")
 * - one is a variety of the other with the same head noun ("tomato" covers
 *   "grape tomato"), unless a modifier changes what it is ("peanut butter")
 * - a generic protein covers its cuts ("chicken" ↔ "chicken thigh", "egg" ↔ "egg yolk")
 */
export function namesMatch(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  const at = a.split(" ");
  const bt = b.split(" ");
  const aHead = at[at.length - 1];
  const bHead = bt[bt.length - 1];
  if (aHead === bHead) {
    if (isSubset(at, bt) || isSubset(bt, at)) {
      const extra = at.length > bt.length ? at.filter((t) => !bt.includes(t)) : bt.filter((t) => !at.includes(t));
      if (!extra.some((t) => IDENTITY_MODIFIERS.has(t))) return true;
    }
  }
  const generic = at.length === 1 ? at : bt.length === 1 ? bt : null;
  const specific = generic === at ? bt : at;
  if (generic && PROTEINS.has(generic[0]) && specific[0] === generic[0] && specific.length > 1 &&
      specific.slice(1).every((t) => CUTS.has(t))) {
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Pantry lookup
// ---------------------------------------------------------------------------

export interface PantryEntry {
  name: string;
}

interface PreparedPantry<T extends PantryEntry> {
  item: T;
  norms: string[];
}

function preparePantry<T extends PantryEntry>(pantry: T[]): PreparedPantry<T>[] {
  return pantry
    .map((item) => ({ item, norms: alternatives(normalizeIngredient(item.name)) }))
    .filter((p) => p.norms.length > 0);
}

function findInPrepared<T extends PantryEntry>(name: string, prepared: PreparedPantry<T>[]): T | null {
  const norms = alternatives(normalizeIngredient(name));
  if (norms.length === 0) return null;
  // Prefer an exact match over a looser one
  for (const p of prepared) {
    if (p.norms.some((pn) => norms.includes(pn))) return p.item;
  }
  for (const p of prepared) {
    if (p.norms.some((pn) => norms.some((n) => namesMatch(n, pn)))) return p.item;
  }
  return null;
}

/** The pantry item that covers this ingredient name, if any. */
export function findPantryItem<T extends PantryEntry>(name: string, pantry: T[]): T | null {
  return findInPrepared(name, preparePantry(pantry));
}

// ---------------------------------------------------------------------------
// Recipe coverage and ranking
// ---------------------------------------------------------------------------

export interface RecipeIngredient {
  /** Display name, e.g. "boneless chicken thighs" */
  name: string;
  optional?: boolean;
}

/** Minimal recipe shape: normalized ingredients when enriched, raw lines otherwise. */
export interface RecipeIngredientSource {
  ingredients?: string[] | null;
  normalizedIngredients?: { item?: string | null; raw?: string | null; isOptional?: boolean | null; isToolOrConsumable?: boolean | null }[] | null;
}

/** The ingredient names to match for a recipe. */
export function recipeIngredients(recipe: RecipeIngredientSource): RecipeIngredient[] {
  const out: RecipeIngredient[] = [];
  const normalized = recipe.normalizedIngredients;
  if (normalized && normalized.length > 0) {
    for (const ing of normalized) {
      if (!ing || ing.isToolOrConsumable) continue;
      const name = (ing.item && ing.item.trim()) || extractIngredientName(ing.raw || "");
      if (!name) continue;
      out.push({ name, optional: Boolean(ing.isOptional) || isOptionalLine(ing.raw || "") });
    }
    return out;
  }
  for (const line of recipe.ingredients || []) {
    const name = extractIngredientName(line);
    if (!name) continue;
    out.push({ name, optional: isOptionalLine(line) });
  }
  return out;
}

export interface CoverageMatch<T> {
  ingredient: string;
  pantryItem: T;
}

export interface RecipeCoverage<T> {
  /** Ingredients covered by a pantry item */
  have: CoverageMatch<T>[];
  /** Ingredients you'd need to buy */
  missing: string[];
  /** Everyday staples assumed on hand (not counted) */
  staples: string[];
  /** have.length */
  haveCount: number;
  /** have + missing (staples and optional items aren't counted) */
  total: number;
  /** haveCount / total, 0–1 */
  coverage: number;
}

function coverageWithPrepared<T extends PantryEntry>(ingredients: RecipeIngredient[], prepared: PreparedPantry<T>[]): RecipeCoverage<T> {
  const have: CoverageMatch<T>[] = [];
  const missing: string[] = [];
  const staples: string[] = [];
  const seen = new Set<string>();
  for (const ing of ingredients) {
    if (ing.optional) continue;
    const key = normalizeIngredient(ing.name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    if (isStaple(ing.name)) {
      staples.push(ing.name);
      continue;
    }
    const pantryItem = findInPrepared(ing.name, prepared);
    if (pantryItem) {
      have.push({ ingredient: ing.name, pantryItem });
    } else {
      missing.push(ing.name);
    }
  }
  const total = have.length + missing.length;
  return { have, missing, staples, haveCount: have.length, total, coverage: total === 0 ? 0 : have.length / total };
}

/** How much of one recipe the pantry covers. */
export function computeCoverage<T extends PantryEntry>(ingredients: RecipeIngredient[], pantry: T[]): RecipeCoverage<T> {
  return coverageWithPrepared(ingredients, preparePantry(pantry));
}

export interface RankedRecipe<R, T> extends RecipeCoverage<T> {
  recipe: R;
}

/**
 * Rank recipes by how much of each the pantry covers. Recipes that use none
 * of the pantry are left out. Order: coverage, nudged toward recipes that use
 * more of what you have (have / (total + 1), so 3 of 4 beats 1 of 1), then
 * fewest missing, then most pantry items used.
 */
export function rankRecipesByPantry<R extends RecipeIngredientSource, T extends PantryEntry>(
  recipes: R[],
  pantry: T[],
  opts: { limit?: number } = {},
): RankedRecipe<R, T>[] {
  const prepared = preparePantry(pantry);
  const ranked: RankedRecipe<R, T>[] = [];
  for (const recipe of recipes) {
    const cov = coverageWithPrepared(recipeIngredients(recipe), prepared);
    if (cov.haveCount === 0) continue;
    ranked.push({ recipe, ...cov });
  }
  const score = (r: RecipeCoverage<T>) => r.haveCount / (r.total + 1);
  ranked.sort((a, b) =>
    score(b) - score(a) ||
    a.missing.length - b.missing.length ||
    b.haveCount - a.haveCount,
  );
  return opts.limit ? ranked.slice(0, opts.limit) : ranked;
}

// ---------------------------------------------------------------------------
// Grocery list merging
// ---------------------------------------------------------------------------

const UNIT_ALIASES: Record<string, string> = {
  c: "cup", cups: "cup", cup: "cup",
  tablespoon: "tbsp", tablespoons: "tbsp", tbsp: "tbsp", tbsps: "tbsp", tbs: "tbsp", tbl: "tbsp", T: "tbsp",
  teaspoon: "tsp", teaspoons: "tsp", tsp: "tsp", tsps: "tsp", t: "tsp",
  ounce: "oz", ounces: "oz", oz: "oz",
  pound: "lb", pounds: "lb", lb: "lb", lbs: "lb",
  gram: "g", grams: "g", g: "g",
  kilogram: "kg", kilograms: "kg", kg: "kg",
  milliliter: "ml", milliliters: "ml", millilitre: "ml", millilitres: "ml", ml: "ml",
  liter: "l", liters: "l", litre: "l", litres: "l", l: "l", L: "l",
  clove: "clove", cloves: "clove",
  can: "can", cans: "can",
  count: "", each: "", whole: "", piece: "", pieces: "", pcs: "",
};

/** Canonical unit for merge decisions ("Cups" → "cup", "tablespoons" → "tbsp"). */
export function normalizeUnit(unit: string | null | undefined): string {
  const raw = (unit ?? "").trim().replace(/\.$/, "");
  if (!raw) return "";
  if (raw === "T") return "tbsp";
  if (raw === "t") return "tsp";
  const lower = raw.toLowerCase();
  if (lower in UNIT_ALIASES) return UNIT_ALIASES[lower];
  if (/(ches|shes)$/.test(lower)) return lower.slice(0, -2);
  return lower.endsWith("s") && lower.length > 3 ? lower.slice(0, -1) : lower;
}

/**
 * Grocery items merge only when the name and the unit match exactly (after
 * case and plural clean-up): "2 cups milk" + "1 cup milk" → "3 cups milk", but
 * "2 cloves garlic" and "1 head garlic" stay separate lines.
 */
export function groceryMergeKey(name: string, unit: string | null | undefined): string {
  const n = (name ?? "").toLowerCase().trim().replace(/\s+/g, " ");
  return `${n}|${normalizeUnit(unit)}`;
}
