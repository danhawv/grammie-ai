// Grams -> amounts people shop and cook with: "2 medium onions",
// "1½ lb (680 g)", "about 2 cups", "1 tbsp". Used by the meal-prep shopping
// list, merged prep tasks and container labels. Rough by design: the
// numbers underneath stay in grams, this is only how they're said.

export interface AmountIngredient {
  id: string;
  name: string;
  aisle?: string;
}

interface Counted {
  match: RegExp;
  grams: number;
  one: string;
  many: string;
  /** "8 cloves garlic" rather than "8 garlics" */
  suffix?: string;
}

// Typical weights of one item (USDA "medium" sizes, rounded)
const COUNTED: Counted[] = [
  { match: /\b(green onion|scallion|spring onion)/, grams: 15, one: "green onion", many: "green onions" },
  { match: /\bshallot/, grams: 40, one: "shallot", many: "shallots" },
  { match: /\bgarlic\b/, grams: 5, one: "clove", many: "cloves", suffix: "garlic" },
  { match: /\bleek/, grams: 200, one: "leek", many: "leeks" },
  { match: /\bsweet potato/, grams: 200, one: "sweet potato", many: "sweet potatoes" },
  { match: /\bpotato/, grams: 210, one: "medium potato", many: "medium potatoes" },
  { match: /\bonion/, grams: 150, one: "medium onion", many: "medium onions" },
  { match: /\bcarrot/, grams: 60, one: "carrot", many: "carrots" },
  { match: /\bcelery/, grams: 40, one: "stalk", many: "stalks", suffix: "celery" },
  { match: /\b(bell pepper|red pepper|green pepper)/, grams: 160, one: "bell pepper", many: "bell peppers" },
  { match: /\bjalape/, grams: 15, one: "jalapeño", many: "jalapeños" },
  { match: /\b(cherry|grape) tomato/, grams: 0, one: "", many: "" }, // weighed, not counted
  { match: /\btomato(es)?\b/, grams: 120, one: "tomato", many: "tomatoes" },
  { match: /\bcucumber/, grams: 300, one: "cucumber", many: "cucumbers" },
  { match: /\bzucchini/, grams: 200, one: "zucchini", many: "zucchini" },
  { match: /\blemon/, grams: 60, one: "lemon", many: "lemons" },
  { match: /\blime/, grams: 45, one: "lime", many: "limes" },
  { match: /\bavocado/, grams: 150, one: "avocado", many: "avocados" },
  { match: /\begg yolk/, grams: 17, one: "egg", many: "eggs" },
  { match: /\beggs?\b/, grams: 50, one: "egg", many: "eggs" },
  { match: /\bapple/, grams: 180, one: "apple", many: "apples" },
  { match: /\bbanana/, grams: 120, one: "banana", many: "bananas" },
];

/** Forms that are measured, not counted, even when the name says onion or garlic */
const NOT_COUNTED = /powder|dried|flake|salt|paste|sauce|juice|stock|broth|soup|seasoning|granul|minced jar|oil|vinegar|ground|frozen|canned|mix/;

// Grams per cup for things measured by volume
const BY_VOLUME: Array<[RegExp, number]> = [
  [/\b(olive oil|vegetable oil|canola|oil)\b/, 218],
  [/\b(honey|maple syrup|molasses|syrup)\b/, 330],
  [/\b(stock|broth|water|milk|cream|buttermilk|juice|wine|vinegar|soy sauce|tamari|ponzu|tomato sauce|salsa)\b/, 240],
  [/\b(mayonnaise|mayo|yogurt|sour cream)\b/, 230],
  [/\b(brown rice|white rice|basmati|jasmine|rice)\b/, 185],
  [/\b(quinoa)\b/, 170],
  [/\b(oats|oatmeal)\b/, 90],
  [/\b(flour|wondra)\b/, 125],
  [/\b(brown sugar)\b/, 220],
  [/\b(sugar)\b/, 200],
  [/\b(breadcrumbs|bread crumbs|panko)\b/, 110],
  [/\b(parmesan|parm)\b/, 100],
  [/\b(dried onion|onion flakes)\b/, 60],
  [/\b(beans|chickpeas|lentils)\b/, 180],
];

const SPICE = /\b(cumin|paprika|turmeric|coriander|allspice|cinnamon|nutmeg|chili powder|garlic powder|onion powder|oregano|thyme|basil|pepper|salt|cayenne|sumac|seasoning|bouillon|curry|ginger, ground|baking soda|baking powder|extract)\b/;

const FRACTIONS: Array<[number, string]> = [[0.125, "⅛"], [0.25, "¼"], [1 / 3, "⅓"], [0.5, "½"], [2 / 3, "⅔"], [0.75, "¾"]];

/** 1.5 -> "1½", 0.33 -> "⅓" (nearest quarter or third) */
export function niceNumber(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0";
  if (n >= 10) return String(Math.round(n));
  const whole = Math.floor(n);
  const rest = n - whole;
  let best: [number, string] = [0, ""];
  let bestErr = rest;
  for (const f of [...FRACTIONS, [1, ""] as [number, string]]) {
    const err = Math.abs(rest - f[0]);
    if (err < bestErr) { best = f; bestErr = err; }
  }
  if (best[0] === 1) return String(whole + 1);
  if (!best[1]) return whole ? String(whole) : "⅛";
  return whole ? `${whole}${best[1]}` : best[1];
}

function haystack(ing: AmountIngredient): string {
  return `${ing.name} ${ing.id.replace(/-/g, " ")}`.toLowerCase();
}

/** One item's weight in grams when the ingredient is bought or cut by the piece */
export function countedWeight(ing: AmountIngredient): Counted | null {
  const h = haystack(ing);
  if (NOT_COUNTED.test(h) || (ing.aisle && !["Produce", "Dairy & Eggs", "Meat & Seafood"].includes(ing.aisle))) return null;
  const c = COUNTED.find((x) => x.match.test(h));
  return c && c.grams > 0 ? c : null;
}

/** "3 medium onions", "8 cloves garlic", rounding to a half (or up to whole items with wholeItems) */
export function countText(grams: number, c: Counted, wholeItems = false): string {
  const raw = grams / c.grams;
  const n = wholeItems ? Math.max(1, Math.ceil(raw - 0.15)) : Math.max(0.5, Math.round(raw * 2) / 2);
  const word = n > 1 ? c.many : c.one;
  return `${niceNumber(n)} ${word}${c.suffix ? ` ${c.suffix}` : ""}`;
}

function volumeText(cups: number): string {
  const tbsp = cups * 16;
  // Measuring spoons come in quarters (tsp) and halves (tbsp)
  if (tbsp * 3 < 0.1) return "a pinch";
  if (tbsp < 0.9) return `${niceNumber(Math.max(0.125, Math.round(tbsp * 3 * 4) / 4))} tsp`;
  if (tbsp < 3.5) return `${niceNumber(Math.round(tbsp * 2) / 2)} tbsp`;
  if (cups >= 8) return `${niceNumber(cups / 4)} quarts`;
  return `${niceNumber(cups)} ${cups > 1 ? "cups" : "cup"}`;
}

function weightText(grams: number): string {
  const metric = grams >= 1000 ? `${(grams / 1000).toFixed(1).replace(/\.0$/, "")} kg` : `${Math.round(grams)} g`;
  const oz = grams / 28.35;
  if (oz < 15) {
    const half = Math.max(0.5, Math.round(oz * 2) / 2);
    return `${half >= 1 ? Math.floor(half) : ""}${half % 1 ? "½" : ""} oz (${metric})`;
  }
  const lb = Math.round((grams / 453.6) * 4) / 4;
  return `${niceNumber(lb)} lb (${metric})`;
}

/**
 * How to say `grams` of an ingredient. wholeItems rounds counted things up
 * to whole pieces (for shopping: you can't buy half an onion).
 */
export function humanAmount(grams: number | null, ing: AmountIngredient, opts: { wholeItems?: boolean } = {}): string {
  if (grams == null || !Number.isFinite(grams) || grams <= 0) return "some";
  const counted = countedWeight(ing);
  if (counted) return countText(grams, counted, opts.wholeItems);
  const h = haystack(ing);
  const spice = SPICE.test(h) || ing.aisle === "Spices & Seasonings";
  // Cans and jars: by weight, which is what the label says
  if (ing.aisle === "Canned & Jarred" && !/stock|broth/.test(h)) {
    const cans = grams / 425;
    return `${weightText(grams)}${cans >= 0.75 ? `, about ${niceNumber(Math.round(cans * 2) / 2)} ${cans >= 1.25 ? "cans" : "can"}` : ""}`;
  }
  if (spice && grams < 20) {
    // Ground spices weigh about 2.5 g a teaspoon
    return volumeText(grams / 2.5 / 48);
  }
  const perCup = BY_VOLUME.find(([re]) => re.test(h))?.[1];
  if (perCup) return `${volumeText(grams / perCup)}${grams >= 150 && perCup !== 240 ? ` (${Math.round(grams)} g)` : ""}`;
  return weightText(grams);
}
