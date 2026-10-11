import { describe, expect, it } from "vitest";
import { AISLES, type RecipeFacts } from "@shared/meal-prep/contract";
import { parseUnit, toGrams } from "./units";
import { Matcher, normalizeName, singular, similarity } from "./match";
import { seedCatalog } from "./catalog";
import { computeRecipeFacts, mainProteinFor, mealSlotsFor, minutesFor, type RecipeInput } from "./facts";
import { storageFor, tipFridgeDays } from "./storage";
import { buildAdjusters } from "./adjusters";
import { allPackageIds, packagesFor } from "./packages";
import { createFoodData, ingredientNutrition } from "./index";
import fixtureFacts from "@shared/meal-prep/fixtures/recipe-facts.json";
import fixtureAdjusters from "@shared/meal-prep/fixtures/adjusters.json";

const catalog = seedCatalog();
const grams = (q: number | null, unit: string, item: string, raw = "") => {
  const ing = catalog.resolve(item)!.ingredient;
  return toGrams(q, parseUnit(unit, raw || `${q} ${unit} ${item}`, q), catalog.gramFacts(ing));
};

describe("units", () => {
  it("reads messy spellings", () => {
    expect(parseUnit("c.").unit).toEqual({ kind: "volume", ml: 236.588 });
    expect(parseUnit("tbs").unit).toMatchObject({ kind: "volume", ml: 14.7868 });
    expect(parseUnit("lbs").unit).toMatchObject({ kind: "mass", grams: 453.592 });
    expect(parseUnit("#").unit).toMatchObject({ kind: "mass" });
    expect(parseUnit("to taste").unit).toEqual({ kind: "none" });
  });

  it("tells T (tablespoon) from t (teaspoon) using the raw line", () => {
    expect(parseUnit("t", "3 T. mayonnaise").unit).toMatchObject({ ml: 14.7868 });
    expect(parseUnit("t", "1/2 t. garlic powder").unit).toMatchObject({ ml: 4.92892 });
    expect(parseUnit("t.", "2 T. lemon juice").unit).toMatchObject({ ml: 14.7868 });
  });

  it("takes pack sizes and weights written in the line", () => {
    expect(parseUnit("14 oz can").packGrams).toBeCloseTo(396.9, 0);
    expect(parseUnit("can", "1 can (15 oz) black beans").packGrams).toBeCloseTo(425.2, 0);
    expect(parseUnit("small", "4 small avocados (400 g)").statedGrams).toBe(400);
    expect(parseUnit("", "2 oz salami, chopped").unit).toMatchObject({ kind: "mass", grams: 28.3495 });
  });

  it("converts by density, piece weight and pack size", () => {
    expect(grams(1, "cup", "onion").grams).toBe(160); // USDA: 1 cup chopped
    expect(grams(1, "medium", "onion").grams).toBe(110);
    expect(grams(2, "cloves", "garlic").grams).toBe(6);
    expect(grams(1, "stick", "butter").grams).toBe(113);
    expect(grams(3, "large", "eggs").grams).toBe(150);
    expect(grams(1, "can", "black beans").grams).toBe(425);
    expect(grams(1, "lb", "ground beef").grams).toBeCloseTo(453.6, 1);
    expect(grams(1, "unit", "lemon juice", "Juice of 1 lemon").grams).toBe(48);
  });

  it("returns null, not a guess, for 'to taste' and missing amounts", () => {
    expect(grams(null, "to taste", "salt").grams).toBeNull();
    expect(grams(null, "", "black pepper").grams).toBeNull();
  });

  it("scales an unknown size from the medium one", () => {
    const g = grams(1, "large", "lemon");
    expect(g.grams).toBeCloseTo(84 * 1.3, 1);
    expect(g.confidence).toBe("medium");
  });
});

describe("matching", () => {
  it("normalizes names", () => {
    expect(singular("tomatoes")).toBe("tomato");
    expect(singular("berries")).toBe("berry");
    expect(singular("molasses")).toBe("molasses");
    expect(normalizeName("Jalapeño Peppers (seeded)")).toBe("jalapeno pepper");
    expect(similarity("onion", "onions")).toBeGreaterThan(0.6);
  });

  it("maps the many ways recipes name an ingredient", () => {
    const id = (s: string) => catalog.resolve(s)?.ingredient.id;
    expect(id("onions")).toBe("onion-yellow");
    expect(id("Yellow Onion")).toBe("onion-yellow");
    expect(id("red onions")).toBe("onion-red");
    expect(id("Fresh Cilantro")).toBe("cilantro");
    expect(id("0% greek yogurt")).toBe("greek-yogurt-nonfat");
    expect(id("ground organic pork")).toBe("pork-ground");
    expect(id("ground pork")).toBe("pork-ground");
    expect(id("chicken/turkey broth")).toBe("broth-chicken");
  });

  it("drops descriptive words only as a weaker fallback", () => {
    const m = new Matcher([{ id: "salt", alias: "salt" }, { id: "pepper", alias: "black pepper" }]);
    expect(m.match("salt")).toMatchObject({ method: "exact", score: 1 });
    expect(m.match("smoked flaky salt")).toMatchObject({ id: "salt", method: "head" });
    expect(m.match("zzzz")).toBeNull();
  });

  it("offers a shortlist for the AI fallback", () => {
    const c = catalog.matcher.candidates("cremini mushroom caps", 10);
    expect(c.length).toBe(10);
    expect(c[0].id).toBe("mushroom");
  });
});

describe("catalog seed", () => {
  it("is consistent", () => {
    const aisles = new Set<string>(AISLES);
    for (const i of catalog.byId.values()) {
      expect(aisles.has(i.aisle), i.id).toBe(true);
      expect(i.per100g.kcal, i.id).toBeGreaterThanOrEqual(0);
      expect(i.per100g.kcal, i.id).toBeLessThanOrEqual(900);
      // Atwater sanity: macros can't hold far more energy than stated (fiber left out; alcohol and leavening are exceptions)
      const atwater = 4 * i.per100g.protein + 4 * (i.per100g.carbs - i.per100g.fiber) + 9 * i.per100g.fat;
      if (!/spirits|wine|beer|mirin|sweetener|vanilla|baking-powder/.test(i.id)) expect(atwater, i.id).toBeLessThan(i.per100g.kcal * 1.35 + 25);
      if (i.source !== "label") expect(i.fdcId, i.id).toBeGreaterThan(0);
    }
  });

  it("package sizes all point at catalog ingredients", () => {
    for (const id of allPackageIds()) expect(catalog.byId.has(id), id).toBe(true);
    expect(allPackageIds().length).toBeGreaterThanOrEqual(150);
    const eggs = packagesFor(["egg", "nothing"]);
    expect(eggs.egg[0]).toEqual({ label: "6 eggs", grams: 300 });
    expect(eggs.nothing).toEqual([]);
  });
});

function recipe(over: Partial<RecipeInput>): RecipeInput {
  return {
    id: "r1", title: "Test", servings: 4, ingredients: [], normalizedIngredients: [], mealType: ["Dinner"], cuisines: ["American"],
    allergens: [], prepTimeMinutes: 15, cookTimeMinutes: 30, totalTimeMinutes: 45, calories: 400, protein: 30, carbohydrates: 30,
    fat: 15, fiber: 3, tips: [], totalCost: 12.5, cookingMethods: ["Baking"], ...over,
  };
}

describe("RecipeFacts", () => {
  const lines = [
    { raw: "2 lb chicken breast", quantity: 2, unit: "lb", item: "chicken breast", nutrition: { calories: 1090 } },
    { raw: "1 cup white rice", quantity: 1, unit: "cup", item: "white rice", nutrition: { calories: 675 } },
    { raw: "2 T. olive oil", quantity: 2, unit: "t", item: "olive oil", nutrition: { calories: 240 } },
    { raw: "1 medium onion, diced", quantity: 1, unit: "medium", item: "onion", preparation: "diced", nutrition: { calories: 44 } },
    { raw: "salt to taste", unit: "to taste", item: "salt", nutrition: { calories: 0 } },
  ];

  it("computes per-serving macros from USDA values", () => {
    const f = computeRecipeFacts(recipe({ normalizedIngredients: lines, calories: 510 }), catalog);
    // 907 g chicken (120 kcal/100 g) + 185 g rice (365) + 27 g oil (884) + 110 g onion (40), over 4 servings
    const kcal = (907.2 * 1.2 + 185 * 3.65 + 27.2 * 8.84 + 110 * 0.4) / 4;
    expect(f.perServing.kcal).toBeCloseTo(kcal, -1);
    expect(f.nutritionSource).toBe("usda");
    expect(f.confidence).toBe("high");
    expect(f.mainProtein).toBe("chicken");
    expect(f.lines[3].prep).toBe("diced");
    expect(f.lines[4].grams).toBeNull();
    expect(f.nutritionCheck?.disagreesWithAi).toBe(false);
  });

  it("flags a >25% disagreement with the stored AI estimate and lowers confidence", () => {
    const f = computeRecipeFacts(recipe({ normalizedIngredients: lines, calories: 300 }), catalog);
    expect(f.nutritionCheck?.disagreesWithAi).toBe(true);
    expect(f.confidence).toBe("medium");
  });

  it("falls back to the AI estimate when too little could be matched", () => {
    const f = computeRecipeFacts(recipe({
      normalizedIngredients: [
        { raw: "1 secret family mix", quantity: 1, unit: "", item: "qqqq xyzzy", nutrition: { calories: 1500 } },
        { raw: "1 tsp salt", quantity: 1, unit: "tsp", item: "salt", nutrition: { calories: 0 } },
      ],
    }), catalog);
    expect(f.nutritionSource).toBe("ai_estimate");
    expect(f.confidence).toBe("low");
    expect(f.perServing.kcal).toBe(400);
  });

  it("skips sub-headings and alternatives", () => {
    const f = computeRecipeFacts(recipe({
      normalizedIngredients: [
        { raw: "For the sauce:", quantity: 1, unit: "cup", item: "tahini" },
        { raw: "1 cup rice", quantity: 1, unit: "cup", item: "rice" },
        { raw: "Or 1 cup quinoa", quantity: 1, unit: "cup", item: "quinoa" },
      ],
    }), catalog);
    expect(f.lines.map((l) => l.raw)).toEqual(["1 cup rice", "Or 1 cup quinoa"]);
    expect(f.lines[1].optional).toBe(true);
  });

  it("normalizes meal types and allergens", () => {
    expect(mealSlotsFor(["Dinner"])).toEqual(["lunch", "dinner"]);
    expect(mealSlotsFor(["lunch/dinner", "Snack"])).toEqual(["lunch", "dinner", "snack"]);
    expect(mealSlotsFor(["Brunch"])).toEqual(["breakfast"]);
    expect(mealSlotsFor(["Sauce"])).toEqual([]);
    const f = computeRecipeFacts(recipe({ allergens: ["Tree Nuts", "Dairy"], normalizedIngredients: [{ raw: "2 eggs", quantity: 2, unit: "", item: "eggs" }] }), catalog);
    expect(f.allergens).toEqual(["dairy", "egg", "tree-nut"]);
  });

  it("names the main protein from the title first", () => {
    expect(mainProteinFor("Mongolian Beef", new Map([["turkey", 60]]), 60)).toBe("turkey"); // title protein absent from ingredients
    expect(mainProteinFor("Mongolian Beef", new Map([["beef", 60], ["eggs", 70]]), 130)).toBe("beef");
    expect(mainProteinFor("Weeknight Bowl", new Map([["beef", 25], ["eggs", 12]]), 50)).toBe("beef");
    expect(mainProteinFor("Green Salad", new Map([["eggs", 2]]), 10)).toBeNull();
  });

  it("estimates hands-on time", () => {
    expect(minutesFor({ prepTimeMinutes: 20, cookTimeMinutes: 60, totalTimeMinutes: 80, cookingMethods: ["Baking"] })).toEqual({ activeMinutes: 35, totalMinutes: 80 });
    expect(minutesFor({ prepTimeMinutes: 10, cookTimeMinutes: 10, totalTimeMinutes: null, cookingMethods: ["Stir-frying"] })).toEqual({ activeMinutes: 16, totalMinutes: 20 });
  });
});

describe("storage", () => {
  const base = { kinds: ["dinner"], cookingMethods: ["Baking"], tips: [], title: "Bake", mainProtein: "chicken",
    shares: { creamyDressing: 0, rawGreens: 0, egg: 0, rice: 0, pasta: 0 } };

  it("uses FoodKeeper windows for cooked leftovers", () => {
    expect(storageFor(base)).toMatchObject({ fridgeDays: 4, freezerDays: 60, reheatsWell: true });
    expect(storageFor({ ...base, mainProtein: "fish" }).fridgeDays).toBe(3);
  });

  it("lets a recipe tip shorten but not lengthen the window", () => {
    expect(storageFor({ ...base, tips: [{ type: "storage", text: "Keeps in the fridge for up to 2 days." }] }).fridgeDays).toBe(2);
    expect(storageFor({ ...base, tips: [{ type: "storage", text: "Store in the fridge up to 7 days." }] }).fridgeDays).toBe(4);
    expect(tipFridgeDays("Refrigerate leftovers 3-4 days")).toBe(3);
  });

  it("doesn't freeze creamy, leafy or 'do not freeze' dishes", () => {
    expect(storageFor({ ...base, shares: { ...base.shares, creamyDressing: 0.3 } }).freezerDays).toBeNull();
    expect(storageFor({ ...base, tips: [{ type: "storage", text: "Do not freeze, the cream will split." }] }).freezerDays).toBeNull();
    const salad = storageFor({ ...base, kinds: ["salad"], title: "Greek Salad", cookingMethods: ["Tossing"], shares: { ...base.shares, rawGreens: 0.6 } });
    expect(salad).toMatchObject({ fridgeDays: 1, freezerDays: null, reheatsWell: false, reheat: "Serve cold. No reheating needed." });
  });

  it("uses the recipe's reheating tip", () => {
    const s = storageFor({ ...base, tips: [{ type: "reheating", text: "Reheat gently on the stove. Add a splash of broth." }] });
    expect(s.reheat).toBe("Reheat gently on the stove.");
  });
});

describe("adjusters", () => {
  it("has ~15 clean add-ons with USDA macros per gram", () => {
    const a = buildAdjusters(catalog);
    expect(a.length).toBe(15);
    const rice = a.find((x) => x.id === "rice-cooked")!;
    expect(rice.perGram.kcal).toBeCloseTo(1.3, 2);
    expect(rice.needsCooking).toBe(true);
    expect(a.find((x) => x.id === "greek-yogurt")!.needsCooking).toBe(false);
    for (const x of a) {
      expect(x.stepGrams).toBeGreaterThan(0);
      expect(x.maxGrams).toBeGreaterThanOrEqual(x.stepGrams);
      expect(x.slots.length).toBeGreaterThan(0);
    }
  });
});

describe("createFoodData", () => {
  it("serves fixtures in memory", async () => {
    const food = createFoodData({ source: { facts: fixtureFacts as RecipeFacts[], adjusters: fixtureAdjusters as any } });
    const ids = (fixtureFacts as RecipeFacts[]).slice(0, 2).map((f) => f.recipeId);
    const got = await food.factsFor([...ids, "missing"]);
    expect(got.map((f) => f.recipeId)).toEqual(ids);
    expect((await food.adjusters()).length).toBe(15);
    expect((await food.packagesFor(["rice-white"]))["rice-white"].length).toBeGreaterThan(0);
    const n = await food.ingredientNutrition!(["almond milk", "chicken-thigh", "qqqq"]);
    expect(n["almond milk"]?.ingredient.id).toBe("almond-milk");
    expect(n["chicken-thigh"]?.perGram.protein).toBeGreaterThan(0.15);
    expect(n.qqqq).toBeNull();
  });

  it("fixtures match the contract shape", () => {
    expect((fixtureFacts as RecipeFacts[]).length).toBeGreaterThanOrEqual(20);
    for (const f of fixtureFacts as RecipeFacts[]) {
      expect(["high", "medium", "low"]).toContain(f.confidence);
      expect(f.perServing.kcal).toBeGreaterThan(0);
      expect(f.storage.fridgeDays).toBeGreaterThan(0);
    }
  });

  it("computes from the database, caches, and reuses the cache", async () => {
    const row = {
      id: "r1", title: "Chicken and Rice", servings: 4, ingredients: [], meal_type: ["Dinner"], cuisines: [], cuisine: null, allergens: [],
      normalized_ingredients: [{ raw: "1 lb chicken breast", quantity: 1, unit: "lb", item: "chicken breast" }],
      prep_time_minutes: 10, cook_time_minutes: 20, total_time_minutes: 30, calories: 150, protein: 25, carbohydrates: 0, fat: 3, fiber: 0,
      tips: [], total_cost: 9, cooking_methods: ["Baking"], owner_user_id: "u1", updated_at: new Date("2026-10-01T00:00:00Z"),
    };
    const cache = new Map<string, any>();
    const calls: string[] = [];
    const query = async (sql: string, params?: unknown[]) => {
      calls.push(sql.trim().split(/\s+/).slice(0, 2).join(" "));
      if (sql.includes("to_regclass")) return { rows: [{ facts: true, map: true }] };
      if (sql.includes("FROM meal_prep_item_map")) return { rows: [] };
      if (sql.includes("FROM recipes WHERE")) return { rows: [row] };
      if (sql.includes("FROM meal_prep_recipe_facts")) return { rows: [...cache.values()] };
      if (sql.startsWith("INSERT INTO meal_prep_recipe_facts")) {
        cache.set(params![0] as string, { recipe_id: params![0], recipe_updated_at: params![1], version: params![2], facts: JSON.parse(params![3] as string) });
        return { rows: [] };
      }
      if (sql.includes("FROM bookmarks")) return { rows: [{ recipe_id: "r1" }] };
      return { rows: [] };
    };
    const food = createFoodData({ query });
    const [a] = await food.factsFor(["r1"]);
    expect(a.perServing.protein).toBeCloseTo((453.6 * 0.225) / 4, 0);
    expect(a.preference.favorite).toBe(true);
    expect(cache.size).toBe(1);
    const inserts = calls.filter((c) => c.startsWith("INSERT")).length;
    const [b] = await food.factsFor(["r1"]);
    expect(b.perServing).toEqual(a.perServing);
    expect(calls.filter((c) => c.startsWith("INSERT")).length).toBe(inserts); // served from cache
  });

  it("works before the migration is applied (no cache, no writes)", async () => {
    const writes: string[] = [];
    const food = createFoodData({
      query: async (sql) => {
        if (sql.includes("to_regclass")) return { rows: [{ facts: false, map: false }] };
        if (/^\s*INSERT/.test(sql)) writes.push(sql);
        return { rows: [] };
      },
    });
    expect(await food.factsFor(["nope"])).toEqual([]);
    expect(writes).toEqual([]);
  });

  it("ingredientNutrition treats weak guesses as unknown", () => {
    expect(ingredientNutrition(catalog, ["olive oil"])["olive oil"]?.perGram.fat).toBe(1);
  });
});
