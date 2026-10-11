// How long a cooked dish keeps, and how to reheat it. Windows follow the
// USDA FSIS FoodKeeper guidance for cooked leftovers (fridge 3-4 days;
// freezer 2-3 months for cooked meat, poultry, soups and casseroles), using
// the safe end of each range. A recipe's own storage tip can shorten a
// window but never lengthen it past FoodKeeper's.

import type { StorageInfo } from "@shared/meal-prep/contract";

export interface StorageInput {
  mainProtein: string | null;
  /** lowercased meal types / categories as stored ("salad", "dip", "dessert"...) */
  kinds: string[];
  cookingMethods: string[];
  tips: Array<{ type: string; text: string }>;
  /** share of the recipe's grams in each "doesn't freeze" group, 0..1 */
  shares: { creamyDressing: number; rawGreens: number; egg: number; rice: number; pasta: number };
  title: string;
}

interface Rule { fridge: number; freezer: number | null; label: string }

// FoodKeeper (FSIS) cooked-food windows, safe end. Freezer days are quality limits.
export const FOODKEEPER = {
  seafood: { fridge: 3, freezer: 90, label: "cooked fish and shellfish" },
  poultry: { fridge: 4, freezer: 60, label: "cooked poultry" },
  meat: { fridge: 4, freezer: 60, label: "cooked meat" },
  soup: { fridge: 4, freezer: 60, label: "soups and stews" },
  casserole: { fridge: 4, freezer: 60, label: "casseroles and cooked dishes" },
  rice: { fridge: 4, freezer: 180, label: "cooked rice and grains" },
  pasta: { fridge: 3, freezer: 60, label: "cooked pasta" },
  salad: { fridge: 3, freezer: null, label: "egg, chicken, tuna or pasta salads" },
  greens: { fridge: 1, freezer: null, label: "dressed green salads" },
  dip: { fridge: 4, freezer: null, label: "homemade dips and dressings" },
  sauce: { fridge: 4, freezer: 90, label: "cooked sauces" },
  baked: { fridge: 5, freezer: 90, label: "cakes, muffins and breads" },
  dessertChilled: { fridge: 3, freezer: null, label: "cream and custard desserts" },
  hardBoiledEggs: { fridge: 7, freezer: null, label: "hard-boiled eggs" },
} satisfies Record<string, Rule>;

const COLD_KINDS = /salad|dip|dressing|beverage|condiment|marinade|rub/;
const NO_COOK = /no-?cook|no-?bake|chilling|blending|mixing|whisking|tossing|assembly/i;
const HEAT = /bak|roast|simmer|saut|sear|boil|grill|fry|frying|broil|brais|steam|slow|stir|toast|microwav|pan/i;

type RuleKey = keyof typeof FOODKEEPER;

function pickRule(i: StorageInput): RuleKey {
  const k = i.kinds.join(" ");
  const cooked = i.cookingMethods.some((m) => HEAT.test(m));
  if (/soup|stew|chili/.test(k) || /\b(soup|stew|chili|chowder|curry)\b/i.test(i.title)) return "soup";
  if (/dip|dressing|condiment/.test(k)) return "dip";
  if (/sauce|marinade|rub/.test(k)) return cooked ? "sauce" : "dip";
  if (/salad/.test(k) || /\bsalad\b/i.test(i.title)) return i.shares.rawGreens > 0.25 ? "greens" : "salad";
  if (/dessert/.test(k)) return /bak/i.test(i.cookingMethods.join(" ")) ? "baked" : "dessertChilled";
  if (i.mainProtein === "fish" || i.mainProtein === "shellfish") return "seafood";
  if (i.mainProtein === "chicken" || i.mainProtein === "turkey" || i.mainProtein === "duck") return "poultry";
  if (i.mainProtein && /beef|pork|lamb|veal/.test(i.mainProtein)) return "meat";
  if (i.shares.rice > 0.4) return "rice";
  if (i.shares.pasta > 0.3) return "pasta";
  if (i.mainProtein === "eggs" && /hard|deviled|boiled/i.test(i.title)) return "hardBoiledEggs";
  return "casserole";
}

/** "up to 5 days", "3-4 days", "for 2 days" in a storage tip -> the smallest day count */
export function tipFridgeDays(text: string): number | null {
  if (!/(fridge|refrigerat|airtight|store|keeps?)/i.test(text) || /freez/i.test(text.split(/[.;]/)[0]) && !/fridge|refrigerat/i.test(text)) return null;
  const m = text.match(/(\d+)\s*(?:[-–to]+\s*(\d+)\s*)?(day|week)s?/i);
  if (!m) return null;
  const n = Number(m[1]);
  return m[3].toLowerCase().startsWith("week") ? n * 7 : n;
}

export function tipSaysNoFreeze(text: string): boolean {
  return /(do not|don't|doesn't|does not|not recommended to|avoid) (freez|freeze)|not freeze well|doesn'?t freeze well|does not freeze well|not suitable for freezing/i.test(text);
}

export function storageFor(i: StorageInput): StorageInfo {
  const ruleKey = pickRule(i);
  const rule = FOODKEEPER[ruleKey];
  const kinds = i.kinds.join(" ");
  const tipTexts = i.tips.filter((t) => t.type === "storage" || t.type === "makeAhead" || t.type === "reheating");
  let fridgeDays = rule.fridge;
  for (const t of tipTexts.filter((t) => t.type === "storage")) {
    const d = tipFridgeDays(t.text);
    if (d != null && d >= 1 && d < fridgeDays) fridgeDays = d;
  }

  let freezerDays = rule.freezer;
  if (tipTexts.some((t) => tipSaysNoFreeze(t.text))) freezerDays = null;
  // Mayo/yogurt/sour-cream dressings split when thawed; raw greens go limp; egg whites turn rubbery
  if (i.shares.creamyDressing > 0.15 || i.shares.rawGreens > 0.25 || i.shares.egg > 0.3) freezerDays = null;

  const cold = COLD_KINDS.test(kinds) || i.cookingMethods.length > 0 && i.cookingMethods.every((m) => NO_COOK.test(m))
    || ruleKey === "dessertChilled" || ruleKey === "greens" || ruleKey === "salad" || ruleKey === "dip";
  const reheatTip = tipTexts.find((t) => t.type === "reheating")?.text;
  const fried = i.cookingMethods.some((m) => /fry|frying|crisp/i.test(m)) && !i.cookingMethods.some((m) => /simmer|brais|stew/i.test(m));

  let reheat: string;
  if (cold) reheat = "Serve cold. No reheating needed.";
  else if (reheatTip) reheat = firstSentence(reheatTip);
  else if (fried) reheat = "Reheat in a 375°F oven or air fryer for 5–8 minutes so it stays crisp.";
  else reheat = "Microwave covered until steaming hot all the way through (165°F), 2–3 minutes, stirring halfway.";

  const notes: string[] = [];
  const separate = tipTexts.find((t) => /separate/i.test(t.text));
  if (separate) notes.push(firstSentence(separate.text));
  if (cold) notes.push("Eat cold.");
  if (freezerDays == null && rule.freezer != null) notes.push("Doesn't freeze well; keep it in the fridge.");

  const reheatsWell = !cold && !fried && !/best (served|eaten) (fresh|immediately|right away)/i.test(tipTexts.map((t) => t.text).join(" "));
  return { fridgeDays, freezerDays, reheat, notes, reheatsWell };
}

function firstSentence(s: string): string {
  const m = s.match(/^.*?[.!](\s|$)/);
  return (m ? m[0] : s).trim();
}
