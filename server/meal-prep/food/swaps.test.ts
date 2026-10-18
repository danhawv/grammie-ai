import { describe, expect, it } from "vitest";
import type { RecipeFacts } from "@shared/meal-prep/contract";
import { DEFAULT_SHAKE_ADJUSTER_ID, PROTEIN_SHAKES } from "@shared/meal-prep/shakes";
import fixtureFacts from "@shared/meal-prep/fixtures/recipe-facts.json";
import fixtureAdjusters from "@shared/meal-prep/fixtures/adjusters.json";
import { seedCatalog } from "./catalog";
import { computeRecipeFacts, mealSlotsFor, type RecipeInput } from "./facts";
import { buildAdjusters } from "./adjusters";
import { packagesFor } from "./packages";
import { amountToGrams, buildSwaps, classifySwap, parseAmountText, readProposals, swapDisplay, type SwapProposal } from "./swaps";
import { cachedSwaps, ensureSwapsWith, type Query } from "./swaps-store";

const catalog = seedCatalog();

function recipe(lines: Array<{ raw: string; quantity: number | null; unit: string; item: string }>, over: Partial<RecipeInput> = {}): RecipeFacts {
  const r: RecipeInput = {
    id: "r1", title: "Test Enchiladas", servings: 4, ingredients: lines.map((l) => l.raw), normalizedIngredients: lines, mealType: ["Dinner"],
    cuisines: [], allergens: [], prepTimeMinutes: 15, cookTimeMinutes: 30, totalTimeMinutes: 45, calories: null, protein: null,
    carbohydrates: null, fat: null, fiber: null, tips: [], totalCost: null, cookingMethods: ["Baking"], ...over,
  };
  return computeRecipeFacts(r, catalog);
}

const facts = recipe([
  { raw: "1 cup sour cream", quantity: 1, unit: "cup", item: "sour cream" },
  { raw: "1 lb ground beef", quantity: 1, unit: "lb", item: "ground beef" },
  { raw: "4 tbsp olive oil", quantity: 4, unit: "tbsp", item: "olive oil" },
  { raw: "Salt to taste", quantity: null, unit: "to taste", item: "salt" },
  { raw: "1 cup shredded cheddar", quantity: 1, unit: "cup", item: "cheddar cheese" },
  { raw: "1/2 cup shredded cheddar, for the top", quantity: 0.5, unit: "cup", item: "cheddar cheese" },
  { raw: "Cilantro, for garnish", quantity: 2, unit: "tbsp", item: "cilantro" },
]);

const per100 = (id: string) => catalog.byId.get(id)!.per100g;

describe("swap amounts", () => {
  it("reads amount text", () => {
    expect(parseAmountText("1 1/2 cups")).toEqual({ quantity: 1.5, unit: "cups" });
    expect(parseAmountText("½ cup")).toEqual({ quantity: 0.5, unit: "cup" });
    expect(parseAmountText("8 oz")).toEqual({ quantity: 8, unit: "oz" });
    expect(parseAmountText("3 ½ cups")).toEqual({ quantity: 3.5, unit: "cups" });
    expect(parseAmountText("3 large")).toEqual({ quantity: 3, unit: "large" });
    expect(parseAmountText("a splash").quantity).toBeNull();
    expect(parseAmountText("0g").quantity).toBeNull();
  });

  it("converts with the replacement's own density", () => {
    const y = catalog.byId.get("greek-yogurt-nonfat")!;
    expect(amountToGrams("1 cup", y, catalog).grams).toBeCloseTo(245, 0);
    expect(amountToGrams("1 lb", catalog.byId.get("beef-ground-lean")!, catalog).grams).toBeCloseTo(453.6, 0);
    expect(amountToGrams("some", y, catalog).grams).toBeNull();
  });

  it("says amounts the way a cook would", () => {
    expect(swapDisplay(245, catalog.ref("greek-yogurt-nonfat"), 245)).toBe("1 cup nonfat Greek yogurt");
    expect(swapDisplay(453.6, catalog.ref("beef-ground-lean"))).toBe("1 lb (454 g) lean ground beef");
    expect(swapDisplay(30, catalog.ref("olive-oil"), 216)).toBe("2 tbsp olive oil");
    expect(swapDisplay(132, catalog.ref("egg-white"))).toBe("4 egg whites");
  });
});

describe("goal classification", () => {
  const d = (protein: number, kcal: number) => ({ protein, kcal, carbs: 0, fat: 0 });
  it("labels protein, lighter and both", () => {
    expect(classifySwap(d(3, 0))).toBe("protein");
    expect(classifySwap(d(2.9, -29))).toBeNull();
    expect(classifySwap(d(0, -30))).toBe("lighter");
    expect(classifySwap(d(5, -40))).toBe("both");
  });
  it("drops swaps that lose real protein to save calories, or add calories for little protein", () => {
    expect(classifySwap(d(-3.5, -100))).toBeNull();
    expect(classifySwap(d(-2, -100))).toBe("lighter");
    expect(classifySwap(d(5, 45))).toBeNull(); // 9 kcal per gram of protein
    expect(classifySwap(d(5, 35))).toBe("protein");
    expect(classifySwap(d(80, 100))).toBeNull(); // amounts gone wrong
    expect(classifySwap(d(30, 200))).toBeNull();
  });
});

describe("buildSwaps", () => {
  it("computes the exact per-serving change from catalog data", () => {
    const { swaps } = buildSwaps(facts, [{ source: "standard", changes: [{ line: 0, replacement: "nonfat Greek yogurt", amount: "1 cup" }] }], catalog);
    expect(swaps).toHaveLength(1);
    const s = swaps[0];
    const oldG = facts.lines[0].grams!;
    const newG = s.changes[0].toGrams;
    const kcal = (per100("greek-yogurt-nonfat").kcal * newG - per100("sour-cream").kcal * oldG) / 100 / 4;
    const protein = (per100("greek-yogurt-nonfat").protein * newG - per100("sour-cream").protein * oldG) / 100 / 4;
    expect(s.perServingDelta.kcal).toBe(Math.round(kcal));
    expect(s.perServingDelta.protein).toBe(Math.round(protein * 10) / 10);
    expect(s.goal).toBe("both");
    expect(s.title).toBe("Nonfat Greek yogurt instead of sour cream");
    expect(s.id).toBe("sour-cream->greek-yogurt-nonfat");
    expect(s.changes[0]).toMatchObject({ lineIndex: 0, from: "1 cup sour cream", to: { id: "greek-yogurt-nonfat" }, toDisplay: "1 cup nonfat Greek yogurt" });
    expect(s.source).toBe("standard");
    expect(s.confidence).toBe("high");
  });

  it("handles use-less swaps and keeps several lines of one ingredient together", () => {
    // per serving the cheese change only counts in a small batch
    const { swaps } = buildSwaps({ ...facts, servings: 1 }, [
      { source: "standard", changes: [{ line: 2, replacement: "olive oil", amount: "2 tbsp" }] },
      { source: "recipe_suggestion", changes: [
        { line: 4, replacement: "reduced-fat cheddar", amount: "1 cup" },
        { line: 5, replacement: "reduced-fat cheddar", amount: "1/2 cup" },
      ] },
    ], catalog);
    const oil = swaps.find((s) => s.id === "less-olive-oil")!;
    expect(oil.title).toBe("Less olive oil");
    expect(oil.goal).toBe("lighter");
    expect(oil.perServingDelta.kcal).toBeLessThan(-200);
    const cheese = swaps.find((s) => s.id === "cheddar->cheddar-reduced-fat")!;
    expect(cheese.changes.map((c) => c.lineIndex)).toEqual([4, 5]);
    expect(cheese.source).toBe("recipe_suggestion");
  });

  it("splits a proposal that bundles different ideas", () => {
    const { swaps } = buildSwaps(facts, [{ source: "standard", changes: [
      { line: 0, replacement: "nonfat Greek yogurt", amount: "1 cup" },
      { line: 1, replacement: "lean ground beef", amount: "1 lb" },
    ] }], catalog);
    expect(swaps.map((s) => s.id).sort()).toEqual(["beef-ground->beef-ground-lean", "sour-cream->greek-yogurt-nonfat"]);
  });

  it("rejects what it can't place or measure, garnishes, and nonsense amounts", () => {
    const p = (line: number, replacement: string, amount: string): SwapProposal => ({ source: "standard", changes: [{ line, replacement, amount }] });
    const { swaps, rejected } = buildSwaps(facts, [
      p(0, "zzqx unobtainium", "1 cup"), // mapping failure
      p(0, "nonfat Greek yogurt", "0g"), // no amount
      p(3, "salt substitute", "1 tsp"), // to taste
      p(6, "parsley", "2 tbsp"), // garnish
      p(1, "lean ground beef", "3 lb"), // 3x the original
      p(2, "olive oil", "4 tbsp"), // not less
      p(99, "olive oil", "1 tbsp"), // no such line
    ], catalog);
    const stew = recipe([{ raw: "2 lb beef chuck, cubed", quantity: 2, unit: "lb", item: "beef chuck" }]);
    const cut = buildSwaps(stew, [p(0, "lean ground beef", "2 lb")], catalog);
    expect(cut.swaps).toEqual([]);
    expect(cut.rejected[0].reason).toBe(`"lean ground beef" isn't the same cut as line 0`);
    expect(swaps).toEqual([]);
    expect(rejected.map((r) => r.reason)).toEqual([
      'can\'t place "zzqx unobtainium"', 'can\'t read amount "0g"', "line 3 is garnish, optional or unmeasured",
      "line 6 is garnish, optional or unmeasured", '"3 lb" is far from the original amount', '"4 tbsp" isn\'t a sensible reduction', "no line 99",
    ]);
  });

  it("keeps at most 4, best first, never two on the same line", () => {
    const { swaps, rejected } = buildSwaps(facts, [
      { source: "standard", changes: [{ line: 0, replacement: "light sour cream", amount: "1 cup" }] },
      { source: "standard", changes: [{ line: 0, replacement: "nonfat Greek yogurt", amount: "1 cup" }] },
      { source: "standard", changes: [{ line: 1, replacement: "lean ground beef", amount: "1 lb" }] },
      { source: "standard", changes: [{ line: 2, replacement: "olive oil", amount: "2 tbsp" }] },
      { source: "standard", changes: [{ line: 4, replacement: "reduced-fat cheddar", amount: "1 cup" }] },
      { source: "standard", changes: [{ line: 5, replacement: "cheddar", amount: "2 tbsp" }] },
    ], catalog);
    expect(swaps.length).toBe(4);
    expect(swaps.filter((s) => s.changes[0].lineIndex === 0).map((s) => s.id)).toEqual(["sour-cream->greek-yogurt-nonfat"]);
    const scores = swaps.map((s) => Math.max(0, s.perServingDelta.protein) * 10 - s.perServingDelta.kcal);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
    expect(rejected.some((r) => /overlaps|over 4/.test(r.reason))).toBe(true);
  });

  it("reads only well-formed model answers", () => {
    expect(readProposals({ swaps: [
      { source: "recipe_suggestion", changes: [{ line: 1, replacement: " lean ground beef ", amount: "1 lb" }, { line: "x", replacement: "a", amount: "1" }] },
      { source: "other", changes: [{ line: 2, replacement: "", amount: "1" }] },
      { changes: [{ line: 2, replacement: "olive oil", amount: "1 tbsp" }] },
    ] })).toEqual([
      { source: "recipe_suggestion", changes: [{ line: 1, replacement: "lean ground beef", amount: "1 lb" }] },
      { source: "standard", changes: [{ line: 2, replacement: "olive oil", amount: "1 tbsp" }] },
    ]);
    expect(readProposals(null)).toEqual([]);
  });
});

describe("swaps cache", () => {
  function fakeDb(rows: any[] = []) {
    const writes: any[][] = [];
    const query: Query = async (sql, params) => {
      if (/to_regclass/.test(sql)) return { rows: [{ ok: true }] };
      if (/^\s*SELECT/i.test(sql)) return { rows };
      writes.push(params ?? []);
      return { rows: [] };
    };
    return { query, writes };
  }
  const updated = "2026-10-01T00:00:00.000Z";
  const proposals: SwapProposal[] = [{ source: "standard", changes: [{ line: 0, replacement: "nonfat Greek yogurt", amount: "1 cup" }] }];

  it("uses current rows, recomputes from proposals on a new food data version, ignores stale recipes", async () => {
    const f2 = { ...facts, recipeId: "r2" };
    const f3 = { ...facts, recipeId: "r3" };
    const { query } = fakeDb([
      { recipe_id: "r1", recipe_updated_at: updated, version: "v-now", swaps: [{ id: "cached" }], proposals },
      { recipe_id: "r2", recipe_updated_at: updated, version: "v-old", swaps: [{ id: "old" }], proposals },
      { recipe_id: "r3", recipe_updated_at: "2026-09-01T00:00:00.000Z", version: "v-now", swaps: [{ id: "stale" }], proposals },
    ]);
    const got = await cachedSwaps(query, [facts, f2, f3], new Map([["r1", updated], ["r2", updated], ["r3", updated]]), catalog, "v-now");
    expect(got.get("r1")).toEqual([{ id: "cached" }]);
    expect(got.get("r2")!.map((s) => s.id)).toEqual(["sour-cream->greek-yogurt-nonfat"]);
    expect(got.has("r3")).toBe(false);
  });

  it("ensureSwaps fills only missing recipes, and a dry run calls and writes nothing", async () => {
    const load = async () => [
      { facts, updatedAt: updated, variations: [], tips: [] },
      { facts: { ...facts, recipeId: "r2" }, updatedAt: updated, variations: [], tips: [] },
    ];
    let calls = 0;
    const propose = async () => { calls++; return { proposals, model: "m", costMicros: 400, tokens: { input: 1, output: 1 } }; };
    const dry = fakeDb([{ recipe_id: "r2", recipe_updated_at: updated }]);
    const r0 = await ensureSwapsWith({ query: dry.query, catalog, version: "v", load, propose }, ["r1", "r2"], { write: false });
    expect(r0.missing).toEqual(["r1"]);
    expect(r0.estimatedCostMicros).toBeGreaterThan(0);
    expect(calls).toBe(0);
    expect(dry.writes).toEqual([]);

    const db = fakeDb([{ recipe_id: "r2", recipe_updated_at: updated }]);
    const r1 = await ensureSwapsWith({ query: db.query, catalog, version: "v", load, propose }, ["r1", "r2"], {});
    expect(calls).toBe(1);
    expect(r1).toMatchObject({ filled: 1, swaps: 1, costMicros: 400, failed: [] });
    expect(db.writes[0][0]).toBe("r1");
    expect(JSON.parse(db.writes[0][3])[0].id).toBe("sour-cream->greek-yogurt-nonfat");
  });
});

describe("protein shake top-ups", () => {
  const adjusters = buildAdjusters(catalog);
  const shakes = adjusters.filter((a) => a.topUp === "shake");

  it("one adjuster per bottled shake, a whole bottle at a time", () => {
    expect(shakes.length).toBe(PROTEIN_SHAKES.length);
    expect(shakes.length).toBeGreaterThanOrEqual(6);
    for (const a of shakes) {
      const s = PROTEIN_SHAKES.find((x) => `shake-${x.id}` === a.id)!;
      expect(a.unitGrams).toBe(s.grams);
      expect(a.stepGrams).toBe(a.unitGrams);
      expect(a.maxGrams).toBe(a.unitGrams);
      expect(a.slots).toEqual(["breakfast", "lunch", "snack"]);
      expect(a.needsCooking).toBe(false);
      expect(a.product).toBe(s.product);
      // one bottle gives exactly the label's numbers
      expect(a.perGram.protein * a.unitGrams!).toBeCloseTo(s.protein, 6);
      expect(a.perGram.kcal * a.unitGrams!).toBeCloseTo(s.kcal, 6);
      expect(packagesFor([a.ingredient.id])[a.ingredient.id][0].grams).toBe(s.grams);
    }
    expect(shakes.map((a) => a.id)).toContain(DEFAULT_SHAKE_ADJUSTER_ID);
  });

  it("cooked chicken breast is the chicken top-up; other adjusters are unchanged", () => {
    expect(adjusters.filter((a) => a.topUp === "chicken").map((a) => a.id)).toEqual(["chicken-breast-cooked"]);
    expect(adjusters.filter((a) => !a.topUp).length).toBe(14);
  });

  it("fixtures carry the shakes and some swaps and desserts", () => {
    expect((fixtureAdjusters as any[]).filter((a) => a.topUp === "shake").length).toBe(PROTEIN_SHAKES.length);
    const f = fixtureFacts as RecipeFacts[];
    expect(f.filter((x) => x.mealTypes.includes("dessert")).length).toBeGreaterThanOrEqual(3);
    expect(f.filter((x) => x.swaps?.length).length).toBeGreaterThanOrEqual(3);
  });
});

describe("dessert slot", () => {
  it("maps dessert, sweets, baking and treats to dessert, apart from snack", () => {
    expect(mealSlotsFor(["Dessert"])).toEqual(["dessert"]);
    expect(mealSlotsFor(["Sweets"])).toEqual(["dessert"]);
    expect(mealSlotsFor(["Baking", "Treat"])).toEqual(["dessert"]);
    expect(mealSlotsFor(["Snack", "Dessert"])).toEqual(["snack", "dessert"]);
    expect(mealSlotsFor(["Appetizer", "Dip"])).toEqual(["snack"]);
    expect(mealSlotsFor(["Beverage"])).toEqual(["snack"]);
  });
  it("adds dessert for sweet titles tagged only as a snack, never for savory ones", () => {
    expect(mealSlotsFor(["snack"], "High Protein Chocolate Lava Cake")).toEqual(["snack", "dessert"]);
    expect(mealSlotsFor(null, "Chocolate Pecan Pie")).toEqual(["dessert"]);
    expect(mealSlotsFor(["Dinner"], "Chili Pie")).toEqual(["lunch", "dinner"]);
    expect(mealSlotsFor([], "Tomato Tart")).toEqual([]);
    expect(mealSlotsFor(["Snack", "Appetizer"], "Cheese Cookies")).toEqual(["snack"]);
    expect(mealSlotsFor(["Breakfast"], "Blueberry Muffins")).toEqual(["breakfast"]);
  });
});
