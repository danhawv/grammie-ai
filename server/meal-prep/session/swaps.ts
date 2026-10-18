import type { Adjuster, Plate, PrepPlan, RecipeFacts } from "@shared/meal-prep/contract";
import { swapIdsFor, swapUseText } from "@shared/meal-prep/callouts";

// Recipe swaps in the session: the batch is cooked with the swapped
// ingredients (so prep tasks, merged cutting and the shopping list use what's
// actually bought), and every task that touches a swapped line says so:
// "Use nonfat Greek yogurt instead of sour cream (1 cup)".

/** Allergens of a swapped-in ingredient, by name ("may contain", like the add-ons) */
const ALLERGEN_WORDS: Array<[RegExp, string]> = [
  [/yogurt|milk|cheese|cottage|whey|cream|butter/i, "Milk"],
  [/\begg/i, "Eggs"],
  [/bread|pasta|tortilla|wheat|couscous|flour/i, "Wheat"],
  [/peanut/i, "Peanuts"],
  [/almond|walnut|pecan|cashew/i, "Tree Nuts"],
  [/tofu|edamame|soy/i, "Soy"],
  [/salmon|tuna|cod|fish/i, "Fish"],
  [/shrimp|prawn|crab/i, "Shellfish"],
];

export function allergensOf(name: string): string[] {
  return ALLERGEN_WORDS.filter(([re]) => re.test(name)).map(([, a]) => a);
}

/** The recipe's facts as cooked in this plan: swapped lines replaced, allergens widened */
export function factsAsCooked(facts: RecipeFacts, swapIds: string[]): RecipeFacts {
  if (!swapIds.length || !facts.swaps?.length) return facts;
  const changes = new Map<number, NonNullable<RecipeFacts["swaps"]>[number]["changes"][number]>();
  for (const id of swapIds) for (const c of facts.swaps.find((s) => s.id === id)?.changes ?? []) changes.set(c.lineIndex, c);
  if (!changes.size) return facts;
  const allergens = new Set(facts.allergens);
  const lines = facts.lines.map((l) => {
    const c = changes.get(l.index);
    if (!c) return l;
    for (const a of allergensOf(c.to.name)) if (!Array.from(allergens).some((x) => x.toLowerCase() === a.toLowerCase())) allergens.add(a);
    return { ...l, raw: c.toDisplay, ingredient: c.to, grams: c.toGrams > 0 ? c.toGrams : l.grams };
  });
  return { ...facts, lines, allergens: Array.from(allergens) };
}

/** Line index -> "Use nonfat Greek yogurt instead of sour cream (1 cup)" at the batch's scale */
export function swapUses(facts: RecipeFacts, swapIds: string[], scale: number): Map<number, string> {
  const out = new Map<number, string>();
  for (const id of swapIds) {
    for (const c of facts.swaps?.find((s) => s.id === id)?.changes ?? []) {
      out.set(c.lineIndex, swapUseText(c, scale, facts.lines.find((l) => l.index === c.lineIndex)?.ingredient?.name));
    }
  }
  return out;
}

/** Every recipe's facts as cooked in the plan */
export function planFactsAsCooked(plan: PrepPlan, facts: RecipeFacts[]): RecipeFacts[] {
  return facts.map((f) => factsAsCooked(f, swapIdsFor(plan, f.recipeId)));
}

/** Bottled shakes aren't cooked or packed: they go on the shopping list and the label only */
export function shakeIds(adjusters: Adjuster[]): Set<string> {
  return new Set(adjusters.filter((a) => a.topUp === "shake").map((a) => a.id));
}

/** The plate without its bottled shakes (null when nothing's left to pack) */
export function packedPart(plate: Plate, shakes: Set<string>): Plate | null {
  if (!shakes.size) return plate;
  const items = plate.items.filter((i) => !(i.kind === "adjuster" && shakes.has(i.refId)));
  if (!items.length) return null;
  return items.length === plate.items.length ? plate : { ...plate, items };
}
