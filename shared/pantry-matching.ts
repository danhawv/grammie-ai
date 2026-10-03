// Shared pantry ingredient matching utilities.
// Pure TypeScript — no Node-specific imports so it works in both Vite/browser and Node.

// ---------------------------------------------------------------------------
// Synonym groups → canonical map
// ---------------------------------------------------------------------------

const SYNONYM_GROUPS: string[][] = [
  ["heavy cream", "heavy whipping cream", "whipping cream", "double cream"],
  ["light cream", "single cream"],
  ["half and half", "half & half"],
  ["sour cream", "creme fraiche", "crème fraîche"],
  ["cilantro", "coriander leaves", "fresh coriander"],
  ["scallions", "green onions", "spring onions"],
  ["zucchini", "courgette"],
  ["bell pepper", "capsicum"],
  ["eggplant", "aubergine"],
  ["powdered sugar", "confectioners sugar", "confectioners' sugar", "icing sugar"],
  ["baking soda", "bicarbonate of soda"],
  ["cornstarch", "corn starch", "corn flour"],
  ["arugula", "rocket"],
  ["garbanzo beans", "chickpeas"],
  ["navy beans", "white beans", "cannellini beans", "great northern beans"],
  ["shrimp", "prawns"],
  ["chicken stock", "chicken broth"],
  ["beef stock", "beef broth"],
  ["vegetable stock", "vegetable broth"],
  ["stock", "broth"],
  ["jam", "preserves", "jelly"],
  ["all-purpose flour", "plain flour", "ap flour"],
  ["self-rising flour", "self-raising flour"],
  ["italian seasoning", "mixed herbs"],
  ["ground beef", "beef mince", "minced beef"],
  ["ground turkey", "turkey mince"],
  ["ground pork", "pork mince"],
  ["ketchup", "catsup"],
  ["mayo", "mayonnaise"],
  ["parmesan", "parmigiano reggiano", "parmigiano-reggiano"],
  ["mozzarella", "fresh mozzarella"],
  ["cheddar", "cheddar cheese"],
  ["butter", "unsalted butter", "salted butter"],
  ["sugar", "granulated sugar", "white sugar"],
  ["brown sugar", "light brown sugar", "dark brown sugar"],
  ["soy sauce", "soya sauce"],
  ["greek yogurt", "greek-style yogurt"],
  ["yogurt", "yoghurt"],
  ["tomato paste", "tomato puree concentrate"],
  ["tomato sauce", "passata"],
  ["canned tomatoes", "tinned tomatoes"],
  ["green bean", "french bean", "string bean"],
  ["snow pea", "mange tout"],
  ["rutabaga", "swede"],
  ["endive", "chicory"],
  ["romaine", "cos lettuce"],
  ["canola oil", "rapeseed oil"],
  ["peanut", "groundnut"],
  ["sesame oil", "toasted sesame oil"],
  ["rice wine vinegar", "rice vinegar"],
  ["balsamic vinegar", "balsamic"],
  ["dijon mustard", "dijon"],
  ["whole milk", "full fat milk"],
  ["skim milk", "skimmed milk", "nonfat milk", "fat free milk"],
  ["2% milk", "semi-skimmed milk", "reduced fat milk"],
  ["cream cheese", "philadelphia"],
  ["monterey jack", "monterey jack cheese"],
  ["swiss cheese", "emmental", "emmentaler"],
  ["provolone", "provolone cheese"],
  ["worcestershire sauce", "worcestershire"],
  ["hot sauce", "chili sauce", "chilli sauce"],
  ["jalapeno", "jalapeño"],
  ["habanero", "habanero pepper"],
];

function buildSynonymMap(groups: string[][]): Map<string, string> {
  const map = new Map<string, string>();
  for (const group of groups) {
    // The first entry in each group is the canonical form.
    const canonical = group[0];
    for (const variant of group) {
      map.set(variant, canonical);
    }
  }
  return map;
}

const SYNONYM_MAP: Map<string, string> = buildSynonymMap(SYNONYM_GROUPS);

// ---------------------------------------------------------------------------
// Qualifier words to strip during normalization
// ---------------------------------------------------------------------------

const QUALIFIERS = new Set([
  "fresh",
  "organic",
  "whole",
  "large",
  "small",
  "medium",
  "raw",
  "cooked",
  "dried",
  "canned",
  "frozen",
  "boneless",
  "skinless",
  "extra",
  "pure",
  "light",
  "dark",
  "unsalted",
  "salted",
  "sweetened",
  "unsweetened",
]);

// Articles to strip
const ARTICLES = new Set(["a", "an", "the"]);

// ---------------------------------------------------------------------------
// normalizeIngredientName
// ---------------------------------------------------------------------------

/**
 * Normalize an ingredient name through a multi-step pipeline:
 * 1. Lowercase and trim
 * 2. Strip articles (a / an / the)
 * 3. Remove common qualifiers
 * 4. Normalize simple plurals (-s / -es / -ies)
 * 5. Collapse whitespace
 */
export function normalizeIngredientName(name: string): string {
  // 1. Lowercase + trim
  let result = name.toLowerCase().trim();

  // Remove parenthetical notes, e.g. "cream (heavy)"
  result = result.replace(/\(.*?\)/g, "");

  // Replace common punctuation but keep hyphens and ampersands for synonym matching
  result = result.replace(/[,]/g, " ");

  // Collapse whitespace
  result = result.replace(/\s+/g, " ").trim();

  // 2 & 3. Split into words, strip articles and qualifiers
  const words = result.split(" ").filter((w) => {
    if (ARTICLES.has(w)) return false;
    if (QUALIFIERS.has(w)) return false;
    return true;
  });

  // 4. Normalize plurals on each word (simple rules)
  const singularized = words.map(singularize);

  // 5. Collapse and trim
  return singularized.join(" ").trim();
}

/**
 * Simple English singular form (best-effort, no dictionary).
 */
function singularize(word: string): string {
  if (word.length <= 2) return word;

  // -ies → -y  (e.g. berries → berry)
  if (word.endsWith("ies") && word.length > 4) {
    return word.slice(0, -3) + "y";
  }
  // -ses / -xes / -zes / -ches / -shes → drop -es
  if (
    word.endsWith("ses") ||
    word.endsWith("xes") ||
    word.endsWith("zes") ||
    word.endsWith("ches") ||
    word.endsWith("shes")
  ) {
    return word.slice(0, -2);
  }
  // -ves → -f  (e.g. halves → half) but not "olives"
  // skip this rule — too error-prone for ingredient names
  // general -s (but not -ss, -us, -is)
  if (
    word.endsWith("s") &&
    !word.endsWith("ss") &&
    !word.endsWith("us") &&
    !word.endsWith("is")
  ) {
    return word.slice(0, -1);
  }

  return word;
}

// ---------------------------------------------------------------------------
// resolveCanonical — look up synonym map
// ---------------------------------------------------------------------------

function resolveCanonical(normalized: string): string {
  return SYNONYM_MAP.get(normalized) ?? normalized;
}

// ---------------------------------------------------------------------------
// Jaccard similarity on word sets
// ---------------------------------------------------------------------------

function jaccardSimilarity(a: string, b: string): number {
  const setA = new Set(a.split(" "));
  const setB = new Set(b.split(" "));
  let intersection = 0;
  Array.from(setA).forEach((w) => {
    if (setB.has(w)) intersection++;
  });
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

// ---------------------------------------------------------------------------
// findPantryMatch
// ---------------------------------------------------------------------------

export interface PantryItem {
  name: string;
  normalizedName?: string | null;
  quantity?: number | null;
  unit?: string | null;
}

export interface PantryMatchResult {
  match: PantryItem | null;
  confidence: number;
}

/**
 * Find the best matching pantry item for a given ingredient name.
 *
 * Algorithm:
 * 1. Normalize + resolve canonical form for the query.
 * 2. For each pantry item, do the same.
 * 3. Exact match → confidence 1.0
 * 4. Substring containment (either direction) → confidence 0.8
 * 5. Jaccard similarity on word sets → if > 0.6, confidence = jaccard * 0.9
 * 6. Return the best match above 0.5 threshold, or null.
 */
export function findPantryMatch(
  itemName: string,
  pantryItems: PantryItem[],
): PantryMatchResult {
  const normalizedQuery = normalizeIngredientName(itemName);
  const canonicalQuery = resolveCanonical(normalizedQuery);

  let bestMatch: PantryItem | null = null;
  let bestConfidence = 0;

  for (const pantryItem of pantryItems) {
    const normalizedPantry = normalizeIngredientName(pantryItem.name);
    const canonicalPantry = resolveCanonical(normalizedPantry);

    let confidence = 0;

    // 1. Exact match on canonical forms
    if (canonicalQuery === canonicalPantry) {
      confidence = 1.0;
    }
    // 2. Substring containment (either direction)
    else if (
      canonicalQuery.includes(canonicalPantry) ||
      canonicalPantry.includes(canonicalQuery)
    ) {
      confidence = 0.8;
    }
    // 3. Jaccard similarity on word sets
    else {
      const jaccard = jaccardSimilarity(canonicalQuery, canonicalPantry);
      if (jaccard > 0.6) {
        confidence = jaccard * 0.9;
      }
    }

    if (confidence > bestConfidence) {
      bestConfidence = confidence;
      bestMatch = pantryItem;
    }
  }

  // Threshold gate
  if (bestConfidence < 0.5) {
    return { match: null, confidence: 0 };
  }

  return { match: bestMatch, confidence: bestConfidence };
}
