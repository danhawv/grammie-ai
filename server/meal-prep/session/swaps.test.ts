import { describe, expect, it, vi } from "vitest";
import type { Adjuster, FoodData, PrepPlan, RecipeFacts, ShoppingItem } from "@shared/meal-prep/contract";
import { createSessionBuilder, memoryStepStore } from "./index";
import { buildShoppingList } from "./shopping";
import { factsAsCooked } from "./swaps";
import { ADJUSTERS, AI_ANSWERS, FACTS, PLAN, SETUP, SOURCES } from "./fixtures";

// Recipe swaps and bottled shakes, through the shopping list, the timeline
// and the labels: every swap is called out where the cook and family look.

const TURKEY = { id: "ground-turkey-lean", name: "Lean ground turkey", aisle: "Meat & Seafood" as const };

const SWAPPED_FACTS: RecipeFacts[] = FACTS.map((f) => (f.recipeId !== "chili" ? f : {
  ...f,
  swaps: [{
    id: "ground-beef->ground-turkey-lean",
    goal: "lighter" as const,
    title: "Lean ground turkey instead of ground beef",
    changes: [{ lineIndex: 0, from: "1 lb ground beef", to: TURKEY, toGrams: 454, toDisplay: "1 lb lean ground turkey" }],
    perServingDelta: { kcal: -60, protein: 2, carbs: 0, fat: -7 },
    confidence: "high" as const,
    source: "standard" as const,
  }],
}));

const SHAKE: Adjuster = {
  id: "shake-core-power", name: "Protein shake", ingredient: { id: "protein-shake", name: "Protein shake", aisle: "Beverages" },
  perGram: { kcal: 0.41, protein: 0.0628, carbs: 0.02, fat: 0.011 }, stepGrams: 414, maxGrams: 414, slots: ["lunch", "dinner", "snack"],
  needsCooking: false, storage: { fridgeDays: 30, freezerDays: null, reheat: "Drink cold.", notes: [], reheatsWell: false },
  topUp: "shake", product: "Fairlife Core Power 26g", unitGrams: 414,
};

const shakeItem = { kind: "adjuster" as const, refId: SHAKE.id, amount: 414, grams: 414, macros: { kcal: 170, protein: 26, carbs: 8, fat: 4.5 } };

const SWAP_PLAN: PrepPlan = {
  ...PLAN,
  batches: PLAN.batches.map((b) => (b.recipeId === "chili" ? { ...b, swapIds: ["ground-beef->ground-turkey-lean"] } : b)),
  plates: [
    ...PLAN.plates.map((p) => (p.personId === "pat" && p.day === 0 && p.slot === "lunch" ? { ...p, items: [...p.items, shakeItem] } : p)),
    // a snack that's only a shake: nothing to pack
    { personId: "pat", day: 1, slot: "snack", storage: "fridge", eatBy: "2026-10-20", items: [shakeItem], macros: shakeItem.macros },
  ],
  swapsApplied: [{
    recipeId: "chili", swapId: "ground-beef->ground-turkey-lean", title: "Lean ground turkey instead of ground beef", goal: "lighter",
    perServingDelta: { kcal: -60, protein: 2, carbs: 0, fat: -7 }, note: "Lean ground turkey instead of ground beef: +2 g protein, 60 fewer calories per serving",
  }],
};

const food: FoodData = { factsFor: async () => [], adjusters: async () => [], packagesFor: async () => ({}) };
const find = (list: Awaited<ReturnType<typeof buildShoppingList>>, id: string): ShoppingItem | undefined =>
  list.byAisle.flatMap((a) => a.items).find((i) => i.ingredient.id === id);

describe("swaps on the shopping list", () => {
  it("buys the swapped ingredient instead of the original, at the batch's scale", async () => {
    const list = await buildShoppingList(SWAP_PLAN, SWAPPED_FACTS, [...ADJUSTERS, SHAKE], [], food);
    expect(find(list, "ground-beef")).toBeUndefined();
    const turkey = find(list, "ground-turkey-lean")!;
    expect(turkey.neededGrams).toBe(681);
    expect(turkey.forRecipes).toEqual(["Grandma's Chili"]);
  });

  it("counts protein shakes in bottles", async () => {
    const list = await buildShoppingList(SWAP_PLAN, SWAPPED_FACTS, [...ADJUSTERS, SHAKE], [], food);
    const shake = list.byAisle.flatMap((a) => a.items).find((i) => /protein shake/.test(i.ingredient.name))!;
    expect(shake.display).toBe("2 bottles");
    expect(shake.buy).toBe("2 bottles Fairlife Core Power (26 g protein each)");
    expect(shake.neededGrams).toBeNull();
  });

  it("leaves recipes without swaps as written", () => {
    expect(factsAsCooked(SWAPPED_FACTS[0], [])).toBe(SWAPPED_FACTS[0]);
    const cooked = factsAsCooked(SWAPPED_FACTS[0], ["ground-beef->ground-turkey-lean"]);
    expect(cooked.lines[0]).toMatchObject({ raw: "1 lb lean ground turkey", ingredient: TURKEY, grams: 454 });
    expect(cooked.lines[1]).toBe(SWAPPED_FACTS[0].lines[1]);
  });
});

describe("swaps and shakes in the session", () => {
  const loadRecipes = async (ids: string[]) => SOURCES.filter((s) => ids.includes(s.id));
  const structurer = vi.fn(async (r: { id: string }) => ({ raw: AI_ANSWERS[r.id], model: "test-model", costMicros: 0 }));
  const builder = () => createSessionBuilder({ loadRecipes, stepStore: memoryStepStore(), structurer, iterations: 30 });

  it("tells the cook what to use instead, on the steps or up front", async () => {
    const s = await builder().session(SETUP, SWAP_PLAN, SWAPPED_FACTS, [...ADJUSTERS, SHAKE]);
    const all = [...s.tasks.map((t) => t.text), ...s.misePlace.map((m) => m.text)].join("\n");
    expect(all).toMatch(/Use lean ground turkey instead of ground beef \(1½ lb, 681 g\)/);
    expect(s.beforeSession.join(" ")).toMatch(/Grandma's Chili uses a swap: Lean ground turkey instead of ground beef/);
  });

  it("puts the swap on the labels and the shake beside the container, not in it", async () => {
    const s = await builder().session(SETUP, SWAP_PLAN, SWAPPED_FACTS, [...ADJUSTERS, SHAKE]);
    const chili = s.labels.find((l) => l.plateKey === "pat:0:lunch")!;
    expect(chili.swapNotes).toEqual(["Made lighter: Lean ground turkey instead of ground beef"]);
    expect(chili.portion).toBe("450 g Grandma's Chili + 150 g rice; have with 1 bottle Fairlife Core Power (26 g protein) from the fridge");
    expect(s.labels.find((l) => l.plateKey === "pat:1:snack")).toBeUndefined();
    expect(s.labels.find((l) => l.plateKey === "pat:0:dinner")!.swapNotes).toBeUndefined();
    // Containers: the shake-only snack doesn't need one
    const plain = await builder().session(SETUP, PLAN, FACTS, ADJUSTERS);
    expect(s.containers.count).toBe(plain.containers.count);
    expect(s.tasks.some((t) => /shake/i.test(t.text))).toBe(false);
  });
});
