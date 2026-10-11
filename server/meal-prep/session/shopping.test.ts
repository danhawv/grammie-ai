import { describe, expect, it } from "vitest";
import type { FoodData, ShoppingItem } from "@shared/meal-prep/contract";
import { buildShoppingList, choosePackages, gatherNeeds, parsePantryEntry, substitutesFor } from "./shopping";
import { ADJUSTERS, FACTS, PLAN } from "./fixtures";

const food = (packages: Awaited<ReturnType<FoodData["packagesFor"]>> = {}): FoodData => ({
  factsFor: async () => [], adjusters: async () => [], packagesFor: async () => packages,
});

const find = (list: Awaited<ReturnType<typeof buildShoppingList>>, id: string): ShoppingItem | undefined =>
  list.byAisle.flatMap((a) => a.items).find((i) => i.ingredient.id === id);

describe("gatherNeeds", () => {
  it("adds up scaled batches and plate add-ons by canonical ingredient", () => {
    const needs = gatherNeeds(PLAN, FACTS, ADJUSTERS);
    const onion = needs.find((n) => n.ingredient.id === "onion-yellow")!;
    // chili 150 ×1.5 + soup 300 + thighs 150
    expect(onion.grams).toBe(675);
    expect(Array.from(onion.forRecipes).sort()).toEqual(["Grandma's Chili", "Roast Chicken Thighs", "Vegetable Soup"]);
    // Cooked rice (chili line + plates) is bought dry: (316 ×1.5 + 600) / 3
    const rice = needs.find((n) => n.ingredient.id === "rice-white")!;
    expect(Math.round(rice.grams)).toBe(358);
    // Yogurt isn't cooked: from the plates
    expect(needs.find((n) => n.ingredient.id === "greek-yogurt")!.grams).toBe(150);
    // Optional garnish skipped; "to taste" flagged
    expect(needs.find((n) => n.ingredient.id === "cheddar")!.grams).toBe(113);
    expect(needs.find((n) => n.ingredient.id === "salt")!.someUnknown).toBe(true);
  });
});

describe("buildShoppingList", () => {
  it("groups by aisle in the standard order, with human amounts", async () => {
    const list = await buildShoppingList(PLAN, FACTS, ADJUSTERS, [], food());
    const aisles = list.byAisle.map((a) => a.aisle);
    expect(aisles.indexOf("Produce")).toBeLessThan(aisles.indexOf("Meat & Seafood"));
    expect(find(list, "onion-yellow")!.display).toBe("5 medium onions");
    expect(find(list, "garlic")!.display).toBe("3 cloves garlic");
    expect(find(list, "ground-beef")!.display).toBe("1½ lb (681 g)");
    expect(find(list, "chicken-broth")!.display).toBe("4 cups");
    expect(find(list, "salt")!.display).toBe("to taste");
  });

  it("takes pantry amounts off, and marks what's already on hand", async () => {
    const list = await buildShoppingList(PLAN, FACTS, ADJUSTERS, ["2 onions", "olive oil", "rice: 200 g", "1 lb ground beef"], food());
    const onion = find(list, "onion-yellow")!;
    expect(onion.have).toBe(false);
    expect(onion.neededGrams).toBe(375);
    expect(onion.display).toMatch(/you have 2 medium onions/);
    expect(find(list, "olive-oil")!.have).toBe(true);
    expect(list.pantryCheck.join(" ")).toMatch(/olive oil/);
    expect(find(list, "rice-white")!.neededGrams).toBe(158);
    expect(find(list, "ground-beef")!.neededGrams).toBe(227);
  });

  it("doesn't let 'onions' in the pantry cover spring onions", async () => {
    const plan = { ...PLAN, batches: [{ recipeId: "x", scale: 1, servingsMade: 2 }], adjusterCooking: {}, plates: [] };
    const facts = [{ ...FACTS[1], recipeId: "x", lines: [{ index: 0, raw: "4 spring onions", ingredient: { id: "spring-onion", name: "Spring onions", aisle: "Produce" as const }, grams: 60, prep: null, optional: false, confidence: "high" as const }] }];
    const list = await buildShoppingList(plan, facts, [], ["onions"], food());
    expect(find(list, "spring-onion")!.have).toBe(false);
  });

  it("suggests packages, rounds up, and shows what's left over", async () => {
    const list = await buildShoppingList(PLAN, FACTS, ADJUSTERS, [], food({
      "onion-yellow": [{ label: "3 lb bag", grams: 1361, price: 3.49 }, { label: "1 onion", grams: 150, price: 0.89 }],
      "rice-white": [{ label: "2 lb bag", grams: 907, price: 2.99 }],
    }));
    expect(find(list, "onion-yellow")!.buy).toBe("5 × 1 onion (about ½ medium onion left over)");
    expect(find(list, "rice-white")!.buy).toMatch(/^2 lb bag \(about .* left over\)$/);
  });

  it("lists staples to check and estimates cost from the recipes when package prices are missing", async () => {
    const list = await buildShoppingList(PLAN, FACTS, ADJUSTERS, [], food());
    expect(list.pantryCheck[0]).toMatch(/chili powder/);
    expect(list.estimatedCost).toBe(14 * 1.5 + 6 + 9 + 11);
  });

  it("still works when package sizes can't be fetched", async () => {
    const broken: FoodData = { ...food(), packagesFor: async () => { throw new Error("down"); } };
    const list = await buildShoppingList(PLAN, FACTS, ADJUSTERS, [], broken);
    expect(list.byAisle.length).toBeGreaterThan(0);
  });
});

describe("helpers", () => {
  it("parses pantry entries", () => {
    expect(parsePantryEntry("2 lb rice")).toMatchObject({ norm: "rice", grams: 907.2 });
    expect(parsePantryEntry("rice: 500 g")).toMatchObject({ grams: 500 });
    expect(parsePantryEntry("3 onions")).toMatchObject({ count: 3, grams: null });
    expect(parsePantryEntry("cumin")).toMatchObject({ grams: null, count: null });
  });
  it("chooses the package with the least left over", () => {
    expect(choosePackages(1000, [{ label: "2 lb", grams: 907 }, { label: "5 lb", grams: 2268 }])).toMatchObject({ label: "2 lb", n: 2 });
    expect(choosePackages(800, [{ label: "2 lb", grams: 907 }, { label: "1 lb", grams: 454 }])).toMatchObject({ label: "2 lb", n: 1 });
  });
  it("has simple substitutes", () => {
    expect(substitutesFor({ id: "sour-cream", name: "Sour cream", aisle: "Dairy & Eggs" })).toContain("plain Greek yogurt");
    expect(substitutesFor({ id: "buttermilk-ranch-mix", name: "Buttermilk ranch dressing mix", aisle: "Pantry" })).toEqual([]);
  });
});
