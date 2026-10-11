// One recipe -> RecipeFacts. Per-serving macros are computed from ingredient
// grams x USDA values; the stored AI estimate is only a fallback (when too
// little of the recipe could be matched) and a cross-check. Everything here
// is pure so it can be tested and run without the database.

import type {
  Confidence, IngredientLine, Macros, MacroKey, MealSlot, RecipeFacts,
} from "@shared/meal-prep/contract";
import type { Catalog, CatalogIngredient } from "./catalog";
import { parseUnit, toGrams } from "./units";
import { storageFor } from "./storage";

/** The recipe columns facts are computed from (a subset of the recipes table) */
export interface RecipeInput {
  id: string;
  title: string;
  servings: number;
  ingredients: string[];
  normalizedIngredients: Array<{
    raw: string; quantity?: number | null; unit?: string | null; item: string; preparation?: string | null;
    isOptional?: boolean; isToolOrConsumable?: boolean;
    nutrition?: { calories?: number; protein?: number; carbohydrates?: number; fat?: number; fiber?: number } | null;
  }> | null;
  mealType: string[] | null;
  cuisines: string[] | null;
  cuisine?: string | null;
  allergens: string[] | null;
  prepTimeMinutes: number | null;
  cookTimeMinutes: number | null;
  totalTimeMinutes: number | null;
  calories: number | null;
  protein: number | null;
  carbohydrates: number | null;
  fat: number | null;
  fiber: number | null;
  tips: Array<{ type: string; text: string }> | null;
  totalCost: number | null;
  cookingMethods: string[] | null;
  updatedAt?: Date | string | null;
}

export interface PreferenceInput { rating: number | null; favorite: boolean; recentCount: number }

const MACROS: MacroKey[] = ["kcal", "protein", "carbs", "fat"];
const zero = (): Macros => ({ kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 });
const round1 = (n: number) => Math.round(n * 10) / 10;

function macrosFor(ing: CatalogIngredient, grams: number): Macros {
  const f = grams / 100;
  const p = ing.per100g;
  return { kcal: p.kcal * f, protein: p.protein * f, carbs: p.carbs * f, fat: p.fat * f, fiber: (p.fiber ?? 0) * f };
}

function add(a: Macros, b: Macros) {
  for (const k of MACROS) a[k] += b[k];
  a.fiber = (a.fiber ?? 0) + (b.fiber ?? 0);
}

/** "Dinner", "lunch/dinner", "Main Course" -> slots. Mains suit lunch too (that's what meal prep is). */
export function mealSlotsFor(types: string[] | null): MealSlot[] {
  const out = new Set<MealSlot>();
  for (const raw of types ?? []) {
    for (const t of raw.toLowerCase().split(/[\/,&]| and /).map((s) => s.trim())) {
      if (/breakfast|brunch/.test(t)) out.add("breakfast");
      if (/lunch/.test(t)) out.add("lunch");
      if (/dinner|main|entree|entrée|soup|stew|grain bowl|bowl/.test(t)) { out.add("dinner"); out.add("lunch"); }
      if (/^salad/.test(t)) out.add("lunch");
      if (/snack|appetizer|dip|dessert|beverage|drink|treat/.test(t)) out.add("snack");
    }
  }
  const order: MealSlot[] = ["breakfast", "lunch", "dinner", "snack"];
  return order.filter((s) => out.has(s));
}

const ALLERGEN_NAMES: Record<string, string> = {
  dairy: "dairy", milk: "dairy", lactose: "dairy", egg: "egg", eggs: "egg", gluten: "gluten", wheat: "gluten",
  soy: "soy", soya: "soy", sesame: "sesame", "tree nuts": "tree-nut", "tree nut": "tree-nut", "tree-nut": "tree-nut",
  nuts: "tree-nut", peanuts: "peanut", peanut: "peanut", fish: "fish", shellfish: "shellfish", crustaceans: "shellfish",
  mollusks: "shellfish", mustard: "mustard", sulfites: "sulfites", sulphites: "sulfites", celery: "celery",
};

/** Allergens from the recipe's own tags plus every matched ingredient's (never fewer than either) */
export function allergensFor(tags: string[] | null, ingredients: CatalogIngredient[]): string[] {
  const out = new Set<string>();
  for (const t of tags ?? []) { const k = ALLERGEN_NAMES[t.toLowerCase().trim()]; if (k) out.add(k); }
  for (const i of ingredients) for (const a of i.allergens) out.add(a);
  return Array.from(out).sort();
}

// Methods where the cook stands at the stove the whole time
const HANDS_ON = /saut|sear|stir|fry|frying|grill|pan|whisk|knead|assembl|toast|broil|blanch|scrambl/i;

export function minutesFor(r: Pick<RecipeInput, "prepTimeMinutes" | "cookTimeMinutes" | "totalTimeMinutes" | "cookingMethods">) {
  const prep = Math.max(0, r.prepTimeMinutes ?? 0);
  const cook = Math.max(0, r.cookTimeMinutes ?? 0);
  const total = Math.max(r.totalTimeMinutes ?? 0, prep + cook, 5);
  const handsOn = (r.cookingMethods ?? []).some((m) => HANDS_ON.test(m));
  // Baking, roasting, simmering and chilling mostly wait; a quarter of it is checking and stirring
  const active = Math.round(prep + cook * (handsOn ? 0.6 : 0.25));
  return { activeMinutes: Math.min(total, Math.max(5, active)), totalMinutes: total };
}

export interface FactsOptions {
  preference?: PreferenceInput;
  /** USDA and AI kcal differ by more than this share -> flagged (default 0.25) */
  disagreeAt?: number;
}

export function computeRecipeFacts(r: RecipeInput, catalog: Catalog, opts: FactsOptions = {}): RecipeFacts {
  const servings = r.servings > 0 ? r.servings : 1;
  const lines: IngredientLine[] = [];
  const usda = zero();
  const fill = zero(); // AI per-line values for lines we couldn't compute
  let weightAll = 0, weightCovered = 0, weightHigh = 0;
  const matched: CatalogIngredient[] = [];
  const gramsById = new Map<string, number>();
  const proteinByKind = new Map<string, number>();
  let totalGrams = 0;

  const src = r.normalizedIngredients ?? [];
  src.forEach((n, index) => {
    if (!n || n.isToolOrConsumable) return;
    const optional = !!n.isOptional || /\boptional\b/i.test(n.raw ?? "");
    const resolved = catalog.resolve(n.item || "");
    const ing = resolved?.ingredient ?? null;
    let grams: number | null = null;
    let gramConf: Confidence = "low";
    if (ing) {
      const g = toGrams(n.quantity ?? null, parseUnit(n.unit, n.raw, n.quantity), catalog.gramFacts(ing));
      grams = g.grams != null ? round1(g.grams) : null;
      gramConf = g.confidence;
    }
    const matchConf = resolved?.confidence ?? 0;
    const confidence: Confidence = ing && grams != null && matchConf >= 0.9 && gramConf === "high" ? "high"
      : ing && grams != null && matchConf >= 0.7 ? "medium" : "low";
    lines.push({
      index, raw: n.raw, ingredient: ing ? catalog.ref(ing.id) : null, grams,
      prep: n.preparation?.trim().toLowerCase() || null, optional, confidence,
    });
    if (optional) return;

    const computed = ing && grams != null ? macrosFor(ing, grams) : null;
    const ai = n.nutrition && typeof n.nutrition.calories === "number" ? n.nutrition : null;
    // How much this line matters: its calories (ours, else the AI's; salt and water weigh nothing)
    const weight = Math.max(computed?.kcal ?? ai?.calories ?? 40, 0);
    weightAll += weight;
    if (computed && ing) {
      add(usda, computed);
      weightCovered += weight;
      if (confidence === "high") weightHigh += weight;
      matched.push(ing);
      gramsById.set(ing.id, (gramsById.get(ing.id) ?? 0) + grams!);
      totalGrams += grams!;
      if (ing.protein) proteinByKind.set(ing.protein, (proteinByKind.get(ing.protein) ?? 0) + computed.protein);
      else if (ing.allergens.includes("dairy") && ing.per100g.protein >= 8) proteinByKind.set("dairy", (proteinByKind.get("dairy") ?? 0) + computed.protein);
    } else {
      if (ing) matched.push(ing);
      if (ai) add(fill, { kcal: ai.calories ?? 0, protein: ai.protein ?? 0, carbs: ai.carbohydrates ?? 0, fat: ai.fat ?? 0, fiber: ai.fiber ?? 0 });
    }
  });

  const coverage = weightAll > 0 ? weightCovered / weightAll : 0;
  const highShare = weightCovered > 0 ? weightHigh / weightCovered : 0;
  const aiPerServing: Macros | null = r.calories != null
    ? { kcal: r.calories, protein: r.protein ?? 0, carbs: r.carbohydrates ?? 0, fat: r.fat ?? 0, fiber: r.fiber ?? 0 }
    : null;

  let perServing: Macros;
  let nutritionSource: RecipeFacts["nutritionSource"];
  let confidence: Confidence;
  if (coverage >= 0.6 && src.length > 0) {
    const total = zero();
    add(total, usda);
    add(total, fill);
    perServing = scale(total, 1 / servings);
    nutritionSource = coverage >= 0.9 ? "usda" : "mixed";
    confidence = coverage >= 0.9 && highShare >= 0.8 ? "high" : "medium";
  } else if (aiPerServing) {
    perServing = { ...aiPerServing };
    nutritionSource = "ai_estimate";
    confidence = "low";
  } else {
    const total = zero();
    add(total, usda);
    add(total, fill);
    perServing = scale(total, 1 / servings);
    nutritionSource = "mixed";
    confidence = "low";
  }
  perServing = roundMacros(perServing);

  const disagreesWithAi = nutritionSource !== "ai_estimate" && !!aiPerServing && aiPerServing.kcal > 0
    && Math.abs(perServing.kcal - aiPerServing.kcal) / aiPerServing.kcal > (opts.disagreeAt ?? 0.25);
  // Two independent estimates that disagree: show it as less certain
  if (disagreesWithAi && confidence === "high") confidence = "medium";

  // Main protein: the kind supplying the most protein, if it's a real share of the dish
  let mainProtein: string | null = null;
  const totalProtein = usda.protein;
  let best = 0;
  for (const [kind, p] of Array.from(proteinByKind)) if (p > best) { best = p; mainProtein = kind; }
  if (best < 5 || best < totalProtein * 0.3) mainProtein = null;

  const share = (pred: (i: CatalogIngredient) => boolean) => {
    if (!totalGrams) return 0;
    let g = 0;
    for (const [id, grams] of Array.from(gramsById)) { const i = catalog.byId.get(id); if (i && pred(i)) g += grams; }
    return g / totalGrams;
  };
  const kinds = (r.mealType ?? []).map((t) => t.toLowerCase());
  const mealTypes = mealSlotsFor(r.mealType);

  const storage = storageFor({
    mainProtein, kinds, cookingMethods: r.cookingMethods ?? [], tips: r.tips ?? [], title: r.title,
    shares: {
      creamyDressing: share((i) => /^(mayonnaise|mayonnaise-light|sour-cream|sour-cream-light|ranch|greek-yogurt|greek-yogurt-nonfat|yogurt-plain|yogurt-lowfat)$/.test(i.id)),
      rawGreens: share((i) => /^(lettuce-romaine|arugula|spinach|kale|cucumber|watercress)$/.test(i.id)),
      egg: share((i) => /^egg/.test(i.id)),
      rice: share((i) => /^rice-|^quinoa/.test(i.id)),
      pasta: share((i) => i.id === "pasta" || i.id === "rice-noodles"),
    },
  });

  return {
    recipeId: r.id,
    title: r.title,
    servings,
    perServing,
    confidence,
    nutritionSource,
    lines,
    mealTypes,
    cuisines: (r.cuisines?.length ? r.cuisines : r.cuisine ? [r.cuisine] : []).map((c) => c.trim()).filter(Boolean),
    mainProtein,
    allergens: allergensFor(r.allergens, matched),
    ...minutesFor(r),
    storage,
    preference: opts.preference ?? { rating: null, favorite: false, recentCount: 0 },
    cost: r.totalCost != null && r.totalCost > 0 ? Math.round(r.totalCost * 100) / 100 : null,
    component: componentFor(kinds, mainProtein, share, mealTypes),
    nutritionCheck: { coverage: round2(coverage), aiPerServing: aiPerServing ? roundMacros(aiPerServing) : null, disagreesWithAi },
  };
}

function componentFor(kinds: string[], mainProtein: string | null, share: (p: (i: CatalogIngredient) => boolean) => number, slots: MealSlot[]): RecipeFacts["component"] {
  const k = kinds.join(" ");
  if (/sauce|marinade|dressing|condiment|rub|dip/.test(k) && !/dinner|lunch|main/.test(k)) return "sauce";
  const grain = share((i) => i.aisle === "Pasta, Rice & Grains" || i.id === "potato" || i.id === "sweet-potato" || i.aisle === "Bakery");
  const veg = share((i) => i.aisle === "Produce" || i.aisle === "Frozen" && /veg|spinach|corn|peas/.test(i.id));
  const meat = share((i) => i.aisle === "Meat & Seafood" || !!i.protein);
  if (/side/.test(k) && !/dinner|lunch|main/.test(k)) return grain > veg ? "grain" : "veg";
  if (mainProtein && meat > 0.55 && grain < 0.1 && veg < 0.25) return "protein";
  if (slots.length === 0 && grain > 0.5) return "grain";
  return "complete";
}

function scale(m: Macros, f: number): Macros {
  return { kcal: m.kcal * f, protein: m.protein * f, carbs: m.carbs * f, fat: m.fat * f, fiber: (m.fiber ?? 0) * f };
}
function roundMacros(m: Macros): Macros {
  return { kcal: Math.round(m.kcal), protein: round1(m.protein), carbs: round1(m.carbs), fat: round1(m.fat), fiber: round1(m.fiber ?? 0) };
}
const round2 = (n: number) => Math.round(n * 100) / 100;
