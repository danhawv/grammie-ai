// How recipe swaps and protein top-ups are said, everywhere they show up:
// plan review, labels, the cook packet, the shopping list and the
// explanation. The owner's rule: every swap is called out plainly, with what
// it changed and what it did. Pure functions, shared by server and screens.

import type { Adjuster, AppliedSwap, CookBatch, IngredientSwap, Macros, MealSlot, RecipeFacts } from "./contract";
import { humanAmount } from "./amounts";

// ---------- Swaps ----------

/** Chip text on a dish card */
export function swapChip(goal: IngredientSwap["goal"]): string {
  if (goal === "lighter") return "Lighter swap";
  if (goal === "protein") return "More protein swap";
  return "Lighter, more protein swap";
}

/** Container label line: "Made lighter: Greek yogurt instead of sour cream" */
export function swapLabelNote(swap: Pick<AppliedSwap, "goal" | "title">): string {
  const lead = swap.goal === "lighter" ? "Made lighter" : swap.goal === "protein" ? "More protein" : "Lighter, more protein";
  return `${lead}: ${swap.title}`;
}

/** "+14 g protein, 95 fewer calories per serving" from a per-serving change */
export function deltaText(d: Pick<Macros, "kcal" | "protein">): string {
  const parts: string[] = [];
  const p = Math.round(d.protein);
  const k = Math.round(d.kcal / 5) * 5;
  if (p > 0) parts.push(`+${p} g protein`);
  if (p < 0) parts.push(`${p} g protein`);
  if (k < 0) parts.push(`${-k} fewer calories`);
  if (k > 0) parts.push(`${k} more calories`);
  return parts.length ? `${parts.join(", ")} per serving` : "about the same numbers";
}

/** The note when the planner didn't write one */
export function swapNote(swap: Pick<AppliedSwap, "title" | "perServingDelta">): string {
  return `${swap.title}: ${deltaText(swap.perServingDelta)}`;
}

/** "sour cream" from "1 cup sour cream" when the canonical name is missing */
function fromName(from: string, lineName: string | null | undefined): string {
  if (lineName) return lowerStart(lineName);
  return from.replace(/^[\d\s½¼¾⅓⅔⅛.\/-]+/, "").replace(/^(cups?|tbsp|tsp|tablespoons?|teaspoons?|oz|ounces?|lbs?|pounds?|g|grams?)\s+/i, "").replace(/\([^)]*\)/g, "").trim() || from;
}

/** "Nonfat Greek yogurt" -> "nonfat Greek yogurt" (proper names keep their capitals) */
export function lowerStart(name: string): string {
  return /^[A-Z][a-z]/.test(name) ? name.charAt(0).toLowerCase() + name.slice(1) : name;
}

/** "Use nonfat Greek yogurt instead of sour cream (1 cup)", at the batch's scale */
export function swapUseText(
  change: IngredientSwap["changes"][number],
  scale: number,
  lineName?: string | null,
): string {
  const s = scale > 0 ? scale : 1;
  // At the recipe's own size, say it the way the swap was written ("1 cup")
  const written = change.toDisplay.toLowerCase().endsWith(change.to.name.toLowerCase())
    ? change.toDisplay.slice(0, change.toDisplay.length - change.to.name.length).trim()
    : "";
  const amount = Math.abs(s - 1) < 0.01 && written ? written : humanAmount(change.toGrams * s, change.to);
  const amountText = amount === "some" || !amount ? "" : ` (${amount.replace(/\s*\((\d[^)]*)\)/, ", $1")})`;
  return `Use ${lowerStart(change.to.name)} instead of ${fromName(change.from, lineName)}${amountText}`;
}

/** "recipeId:swapId", the key PrepSetup.excludedSwaps uses */
export const swapKey = (recipeId: string, swapId: string) => `${recipeId}:${swapId}`;

/**
 * The swaps a plan used, with the ingredient changes worked out at each
 * batch's scale. Uses plan.swapsApplied when the planner filled it, and
 * falls back to batches[].swapIds with RecipeFacts.swaps.
 */
export function enrichSwaps(
  plan: { batches: CookBatch[]; swapsApplied?: AppliedSwap[] },
  facts: RecipeFacts[],
): AppliedSwap[] {
  const byId = new Map(facts.map((f) => [f.recipeId, f]));
  const applied = new Map<string, AppliedSwap>();
  for (const s of plan.swapsApplied ?? []) applied.set(swapKey(s.recipeId, s.swapId), s);
  for (const b of plan.batches) {
    for (const id of b.swapIds ?? []) {
      const key = swapKey(b.recipeId, id);
      if (applied.has(key)) continue;
      const swap = byId.get(b.recipeId)?.swaps?.find((x) => x.id === id);
      if (!swap) continue;
      applied.set(key, {
        recipeId: b.recipeId, swapId: id, title: swap.title, goal: swap.goal,
        perServingDelta: swap.perServingDelta, note: swapNote(swap),
      });
    }
  }
  return Array.from(applied.values()).map((s) => {
    const f = byId.get(s.recipeId);
    const swap = f?.swaps?.find((x) => x.id === s.swapId);
    const scale = plan.batches.find((b) => b.recipeId === s.recipeId)?.scale ?? 1;
    const changes = swap
      ? swap.changes.map((c) => ({
        lineIndex: c.lineIndex,
        from: c.from,
        toDisplay: c.toDisplay,
        use: swapUseText(c, scale, f?.lines.find((l) => l.index === c.lineIndex)?.ingredient?.name),
      }))
      : s.changes;
    return { ...s, note: s.note || swapNote(s), ...(changes ? { changes } : {}) };
  });
}

/** Swap ids used for a recipe in a plan (batches first, then swapsApplied) */
export function swapIdsFor(plan: { batches: CookBatch[]; swapsApplied?: AppliedSwap[] }, recipeId: string): string[] {
  const ids = new Set(plan.batches.find((b) => b.recipeId === recipeId)?.swapIds ?? []);
  for (const s of plan.swapsApplied ?? []) if (s.recipeId === recipeId) ids.add(s.swapId);
  return Array.from(ids);
}

// ---------- Protein shakes ----------

/** What the screens need to say an add-on: name, and for bottled shakes the product */
export interface AdjusterDisplay {
  id: string;
  name: string;
  topUp?: "chicken" | "shake";
  product?: string;
  /** grams in one bottle */
  unitGrams?: number;
  /** protein in one bottle, g */
  proteinPerUnit?: number;
  kcalPerUnit?: number;
}

export function adjusterDisplay(a: Adjuster): AdjusterDisplay {
  const out: AdjusterDisplay = { id: a.id, name: a.name };
  if (a.topUp) out.topUp = a.topUp;
  if (a.product) out.product = a.product;
  if (a.unitGrams) {
    out.unitGrams = a.unitGrams;
    out.proteinPerUnit = Math.round(a.perGram.protein * a.unitGrams);
    out.kcalPerUnit = Math.round(a.perGram.kcal * a.unitGrams);
  }
  return out;
}

export function isShake(a: Pick<AdjusterDisplay, "topUp" | "unitGrams"> | undefined | null): boolean {
  return !!a && a.topUp === "shake";
}

/** Whole bottles for an amount in grams (at least one) */
export function bottles(grams: number, unitGrams: number | undefined): number {
  if (!unitGrams || unitGrams <= 0) return 1;
  return Math.max(1, Math.round(grams / unitGrams));
}

/** "Fairlife Core Power 26g" -> "Fairlife Core Power" (the protein is said separately) */
export function productName(a: Pick<AdjusterDisplay, "product" | "name">): string {
  return (a.product ?? a.name).replace(/\s*\b\d+\s*g\b(?:\s*protein)?/i, "").replace(/\s+protein shake$/i, "").trim() || a.name;
}

/** "1 bottle Fairlife Core Power (26 g protein)" */
export function shakeText(a: AdjusterDisplay, grams: number): string {
  const n = bottles(grams, a.unitGrams);
  const protein = a.proteinPerUnit != null ? ` (${a.proteinPerUnit} g protein${n > 1 ? " each" : ""})` : "";
  return `${n} ${n === 1 ? "bottle" : "bottles"} ${productName(a)}${protein}`;
}

// ---------- Desserts ----------

/** Share of a day's targets each slot carries (mirrors the planner's DEFAULT_SLOT_SHARE; dessert about 10%) */
export const SLOT_SHARE: Record<MealSlot, number> = { breakfast: 0.25, lunch: 0.3, dinner: 0.35, snack: 0.1, dessert: 0.1 };
