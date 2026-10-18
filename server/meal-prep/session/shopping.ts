import {
  AISLES, type Adjuster, type Aisle, type CanonicalIngredientRef, type FoodData, type PrepPlan, type RecipeFacts,
  type ShoppingItem, type ShoppingList,
} from "@shared/meal-prep/contract";
import { countedWeight, humanAmount } from "@shared/meal-prep/amounts";
import { adjusterDisplay, bottles, productName, swapIdsFor } from "@shared/meal-prep/callouts";
import { isStaple, namesMatch, normalizeIngredient } from "@shared/pantry-match";
import { componentFor, isCookedLine, rawGrams } from "./components";

// The shopping list for a plan: every gram the batches (at their scale) and
// the plate add-ons need, added up by canonical ingredient, minus what's in
// the pantry, in human amounts, with what to buy when package sizes are
// known. All arithmetic here; nothing from AI.

interface Need {
  ingredient: CanonicalIngredientRef;
  grams: number;
  /** some uses had no amount ("salt to taste") */
  someUnknown: boolean;
  /** the recipe lines without an amount, as written ("1 jar small white onions") */
  unknownLines: string[];
  forRecipes: Set<string>;
  /** bottled shakes: bought by the bottle */
  bottles?: { count: number; product: string; proteinEach: number | null };
}

/** "rice-cooked" / "Rice, cooked" -> the thing you buy */
function buyable(ref: CanonicalIngredientRef): CanonicalIngredientRef {
  if (!/cooked|steamed|roasted|baked|boiled/i.test(`${ref.id} ${ref.name}`)) return ref;
  return {
    ...ref,
    id: ref.id.replace(COOKED_SUFFIX, "").replace(/^cooked[-_]?/i, ""),
    name: cap(ref.name.replace(/,?\s*\(?(cooked|steamed|roasted|baked|hard[- ]boiled)\)?/ig, "").replace(/\s+/g, " ").trim()),
  };
}

/** "chicken-breast-cooked" -> the buyable id (food-data ids put the cooking last) */
const COOKED_SUFFIX = /[-_](cooked|steamed|roasted|baked|hard[-_]boiled)$/i;

const IGNORE = /^(water|ice|ice water|hot water|cold water|boiling water)$/i;

export function gatherNeeds(plan: PrepPlan, facts: RecipeFacts[], adjusters: Adjuster[]): Need[] {
  const needs = new Map<string, Need>();
  const add = (ref: CanonicalIngredientRef, grams: number | null, forRecipe: string, raw: string | null) => {
    const r = buyable(ref);
    if (IGNORE.test(r.name.trim())) return;
    const n = needs.get(r.id) ?? { ingredient: r, grams: 0, someUnknown: false, unknownLines: [], forRecipes: new Set<string>() };
    if (grams == null || !Number.isFinite(grams)) {
      n.someUnknown = true;
      if (raw && !n.unknownLines.includes(raw.trim())) n.unknownLines.push(raw.trim());
    }
    else n.grams += grams;
    n.forRecipes.add(forRecipe);
    needs.set(r.id, n);
  };
  const factsById = new Map(facts.map((f) => [f.recipeId, f]));
  for (const batch of plan.batches) {
    const f = factsById.get(batch.recipeId);
    if (!f) continue;
    // Swapped lines: buy what's used instead ("nonfat Greek yogurt", not "sour cream")
    const swapped = new Map<number, NonNullable<RecipeFacts["swaps"]>[number]["changes"][number]>();
    for (const id of swapIdsFor(plan, batch.recipeId)) {
      for (const c of f.swaps?.find((x) => x.id === id)?.changes ?? []) swapped.set(c.lineIndex, c);
    }
    for (const line of f.lines) {
      const change = swapped.get(line.index);
      if (change) {
        add(change.to, change.toGrams > 0 ? change.toGrams * batch.scale : null, f.title, change.toDisplay);
        continue;
      }
      if (!line.ingredient || line.optional) continue;
      let grams = line.grams == null ? null : line.grams * batch.scale;
      // "2 cups cooked rice": buy the dry rice it takes
      let ref = line.ingredient;
      if (isCookedLine(line.raw, line.prep, line.ingredient.id)) {
        const def = componentFor(`${line.ingredient.name} ${line.raw}`);
        if (def && grams != null) grams = rawGrams(def, grams, def.lineAmountIs);
        if (def?.buy && /cooked/.test(ref.id)) ref = { ...def.buy, aisle: ref.aisle };
      }
      add(ref, grams, f.title, line.raw);
    }
  }
  // Plate add-ons: the cooked ones from adjusterCooking (cooked weight), the rest from the plates
  const byId = new Map(adjusters.map((a) => [a.id, a]));
  const cooked = plan.adjusterCooking ?? {};
  const plated = new Map<string, number>();
  for (const p of plan.plates) for (const i of p.items) if (i.kind === "adjuster") plated.set(i.refId, (plated.get(i.refId) ?? 0) + (i.grams ?? i.amount));
  for (const adj of adjusters) {
    const grams = adj.needsCooking ? cooked[adj.id] ?? plated.get(adj.id) ?? 0 : plated.get(adj.id) ?? 0;
    if (!(grams > 0)) continue;
    if (adj.topUp === "shake") {
      // Whole bottles, counted plate by plate
      let count = 0;
      for (const p of plan.plates) for (const i of p.items) if (i.kind === "adjuster" && i.refId === adj.id) count += bottles(i.grams ?? i.amount, adj.unitGrams);
      const d = adjusterDisplay(adj);
      const product = productName(d);
      needs.set(`shake:${adj.id}`, {
        ingredient: { ...adj.ingredient, id: adj.ingredient.id || adj.id, name: `${product} protein shake` },
        grams: 0, someUnknown: false, unknownLines: [], forRecipes: new Set(["Plate add-ons"]),
        bottles: { count, product, proteinEach: d.proteinPerUnit ?? null },
      });
      continue;
    }
    const def = adj.needsCooking ? componentFor(`${adj.ingredient.name} ${adj.name}`) : null;
    // Shop for the raw thing: "Cooked chicken" on the plates is chicken breast at the store
    const ref = def?.buy ? { ...def.buy, aisle: adj.ingredient.aisle } : adj.ingredient;
    add(ref, def ? rawGrams(def, grams, "cooked") : grams, "Plate add-ons", null);
  }
  for (const id of Object.keys(cooked)) if (!byId.has(id)) console.warn(`[MealPrep] adjusterCooking has unknown adjuster ${id}`);
  return Array.from(needs.values());
}

interface PantryEntry { name: string; norm: string; grams: number | null; count: number | null }

const UNIT_GRAMS: Record<string, number> = { g: 1, gram: 1, grams: 1, kg: 1000, oz: 28.35, ounce: 28.35, ounces: 28.35, lb: 453.6, lbs: 453.6, pound: 453.6, pounds: 453.6 };

/** "2 lb rice", "rice: 500 g", "3 onions", "cumin" */
export function parsePantryEntry(raw: string): PantryEntry {
  const s = raw.trim();
  const unitRe = "(g|grams?|kg|oz|ounces?|lbs?|pounds?)";
  const lead = s.match(new RegExp(`^(\\d+(?:\\.\\d+)?)\\s*${unitRe}\\b\\s*(?:of\\s+)?(.+)$`, "i"));
  const trail = s.match(new RegExp(`^(.+?)[:,]?\\s+(\\d+(?:\\.\\d+)?)\\s*${unitRe}$`, "i"));
  const count = s.match(/^(\d+)\s+(.+)$/);
  if (lead) return entry(lead[3], Number(lead[1]) * UNIT_GRAMS[lead[2].toLowerCase()], null);
  if (trail) return entry(trail[1], Number(trail[2]) * UNIT_GRAMS[trail[3].toLowerCase()], null);
  if (count) return entry(count[2], null, Number(count[1]));
  return entry(s, null, null);
}

function entry(name: string, grams: number | null, count: number | null): PantryEntry {
  return { name: name.trim(), norm: normalizeIngredient(name), grams, count };
}

/** Words that make a different thing to buy: "onions" in the pantry don't cover "spring onions" */
const DIFFERENT = new Set(["spring", "green", "sweet", "dried", "powder", "ground", "smoked", "canned", "instant", "brown", "wild", "red", "frozen", "minute"]);

function pantryMatch(ref: CanonicalIngredientRef, pantry: PantryEntry[]): PantryEntry | null {
  const names = [normalizeIngredient(ref.name), normalizeIngredient(ref.id.replace(/-/g, " "))];
  return pantry.find((p) => (p.grams == null || p.grams > 0) && (p.count == null || p.count > 0) && names.some((n) => {
    if (!namesMatch(n, p.norm)) return false;
    const a = n.split(" ");
    const b = p.norm.split(" ");
    const extra = a.filter((w) => !b.includes(w)).concat(b.filter((w) => !a.includes(w)));
    return !extra.some((w) => DIFFERENT.has(w));
  })) ?? null;
}

/** Simple, safe swaps a shopper can make if the store is out */
const SUBSTITUTES: Array<[RegExp, string[]]> = [
  [/\bbutter\b/, ["margarine", "olive oil (¾ the amount)"]],
  [/\bheavy cream|whipping cream/, ["half-and-half", "evaporated milk"]],
  [/\bsour cream/, ["plain Greek yogurt"]],
  [/\bbuttermilk\b(?!.*(dressing|ranch|mix))/, ["milk with 1 tbsp lemon juice per cup"]],
  [/\bgreek yogurt/, ["plain yogurt, strained", "sour cream"]],
  [/\bchicken thigh/, ["chicken breast"]],
  [/\bchicken breast/, ["chicken thighs"]],
  [/\bground beef/, ["ground turkey"]],
  [/\bground turkey/, ["ground chicken", "ground beef"]],
  [/\bbasmati|jasmine/, ["long-grain white rice"]],
  [/\b(chicken|beef|vegetable) (stock|broth)/, ["bouillon with water"]],
  [/\bbouillon|better than bouillon|chicken base/, ["chicken stock in place of some of the water"]],
  [/\blemon\b/, ["bottled lemon juice", "lime"]],
  [/\blime\b/, ["lemon"]],
  [/\bshallot/, ["yellow onion"]],
  [/\bleek/, ["yellow onion"]],
  [/\b(parsley|cilantro)\b/, ["dried, a third of the amount"]],
  [/\bbreadcrumb|bread crumb/, ["panko", "crushed crackers"]],
  [/\bpanko\b/, ["breadcrumbs"]],
  [/\bmayonnaise|\bmayo\b/, ["plain Greek yogurt"]],
  [/\bparmesan|\bparm\b/, ["pecorino romano"]],
  [/\bsoy sauce/, ["tamari"]],
  [/\brice vinegar|ponzu/, ["white wine vinegar", "lemon juice"]],
  [/\bbrown sugar/, ["white sugar with a little molasses"]],
  [/\bwondra\b/, ["all-purpose flour"]],
  [/\bkidney bean|pinto bean|black bean/, ["any canned beans"]],
  [/\bspring onion|green onion|scallion/, ["chives"]],
];

export function substitutesFor(ref: CanonicalIngredientRef): string[] {
  const h = `${ref.name} ${ref.id.replace(/-/g, " ")}`.toLowerCase();
  return SUBSTITUTES.find(([re]) => re.test(h))?.[1] ?? [];
}

/** The package choice that leaves the least over (then fewest packages, then cheapest) */
export function choosePackages(grams: number, options: Array<{ label: string; grams: number; price?: number }>) {
  let best: { label: string; n: number; grams: number; leftover: number; price: number | null } | null = null;
  for (const o of options) {
    if (!(o.grams > 0)) continue;
    // Up to 10% short is fine (the amounts are estimates); more means another package
    const n = Math.max(1, Math.ceil(grams / o.grams - 0.1));
    const leftover = n * o.grams - grams;
    const price = o.price != null ? n * o.price : null;
    const better = !best
      || leftover < best.leftover - 1
      || (Math.abs(leftover - best.leftover) <= 1 && (n < best.n || (n === best.n && (price ?? Infinity) < (best.price ?? Infinity))));
    if (better) best = { label: o.label, n, grams: o.grams, leftover, price };
  }
  return best;
}

export async function buildShoppingList(
  plan: PrepPlan, facts: RecipeFacts[], adjusters: Adjuster[], pantryRaw: string[], food: FoodData,
): Promise<ShoppingList> {
  const needs = gatherNeeds(plan, facts, adjusters);
  const pantry = pantryRaw.filter((p) => p && p.trim()).map(parsePantryEntry);
  let packages: Awaited<ReturnType<FoodData["packagesFor"]>> = {};
  try {
    packages = await food.packagesFor(needs.map((n) => n.ingredient.id));
  } catch (err: any) {
    console.warn(`[MealPrep] Package sizes unavailable: ${err?.message}`);
  }

  const items: ShoppingItem[] = [];
  const pantryCheck: string[] = [];
  const staples: string[] = [];
  let pricedTotal = 0;
  let unpriced = 0;
  for (const n of needs) {
    const ing = n.ingredient;
    if (n.bottles) {
      const { count, product, proteinEach } = n.bottles;
      const word = count === 1 ? "bottle" : "bottles";
      items.push({
        ingredient: ing,
        neededGrams: null,
        display: `${count} ${word}`,
        buy: `${count} ${word} ${product}${proteinEach != null ? ` (${proteinEach} g protein each)` : ""}`,
        have: false,
        forRecipes: Array.from(n.forRecipes),
        substitutes: ["any ready-to-drink protein shake with about the same protein"],
      });
      unpriced++;
      continue;
    }
    let grams: number | null = n.grams > 0 ? n.grams : null;
    let have = false;
    let note = "";
    const p = pantryMatch(ing, pantry);
    const counted = countedWeight(ing);
    const haveGrams = p ? p.grams ?? (p.count != null && counted ? p.count * counted.grams : null) : null;
    if (p && haveGrams != null && grams != null) {
      // Have some: buy only the rest. One pantry amount covers several items
      // at most once ("2 lb rice" for both the basmati and the plain rice)
      if (haveGrams >= grams) { have = true; }
      else { note = ` (you have ${humanAmount(haveGrams, ing)})`; grams -= haveGrams; }
      const used = Math.min(haveGrams, n.grams);
      if (p.grams != null) p.grams -= used;
      else if (p.count != null && counted) p.count -= used / counted.grams;
    } else if (p) {
      have = true;
      pantryCheck.push(`${grams != null ? `${humanAmount(grams, ing)} ` : ""}${ing.name.toLowerCase()}`);
    }
    // Uses without an amount are shown as the recipe wrote them
    const extra = n.unknownLines.filter((l) => !/to taste|as needed|for garnish/i.test(l)).map(cleanLine);
    const unknownText = extra.length ? extra.join("; ") : "to taste";
    const display = grams != null
      ? `${humanAmount(grams, ing, { wholeItems: true })}${n.someUnknown ? `, plus ${extra.length ? extra.join("; ") : "some to taste"}` : ""}${note}`
      : unknownText;
    let buy: string | null = null;
    if (!have && grams != null) {
      const choice = choosePackages(grams, packages[ing.id] ?? []);
      if (choice) {
        const left = choice.leftover >= Math.max(30, choice.grams * 0.1) ? ` (about ${humanAmount(choice.leftover, ing)} left over)` : "";
        buy = `${choice.n > 1 ? `${choice.n} × ` : ""}${choice.label}${left}`;
        if (choice.price != null) pricedTotal += choice.price; else unpriced++;
      } else unpriced++;
    }
    if (!have && !p && isStaple(ing.name)) staples.push(grams != null ? `${ing.name.toLowerCase()} (${humanAmount(grams, ing)})` : ing.name.toLowerCase());
    items.push({
      ingredient: ing,
      neededGrams: grams != null ? Math.round(grams) : null,
      display,
      buy,
      have,
      forRecipes: Array.from(n.forRecipes),
      substitutes: substitutesFor(ing),
    });
  }
  if (staples.length) pantryCheck.unshift(`Most kitchens have these; check before you shop: ${staples.join(", ")}`);

  const byAisle: ShoppingList["byAisle"] = [];
  for (const aisle of AISLES) {
    const here = items.filter((i) => (AISLES.includes(i.ingredient.aisle) ? i.ingredient.aisle : "Other") === aisle)
      .sort((a, b) => Number(a.have) - Number(b.have) || a.ingredient.name.localeCompare(b.ingredient.name));
    if (here.length) byAisle.push({ aisle: aisle as Aisle, items: here });
  }

  // Package prices when we have them for everything; otherwise the recipes' own cost estimates
  let estimatedCost: number | null = null;
  const toBuy = items.filter((i) => !i.have).length;
  if (toBuy && unpriced === 0) estimatedCost = round2(pricedTotal);
  else {
    const factsById = new Map(facts.map((f) => [f.recipeId, f]));
    const costs = plan.batches.map((b) => {
      const c = factsById.get(b.recipeId)?.cost;
      return c == null ? null : c * b.scale;
    });
    if (costs.length && costs.every((c) => c != null)) estimatedCost = round2(costs.reduce((s: number, c) => s + (c ?? 0), 0));
  }
  return { byAisle, pantryCheck, estimatedCost };
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const round2 = (n: number) => Math.round(n * 100) / 100;

/** "1 jar small white onions (Jar)" -> "1 jar small white onions" */
function cleanLine(raw: string): string {
  return raw.replace(/\s*\([^)]*\)\s*$/, "").replace(/^[*•\-\s]+/, "").trim();
}
