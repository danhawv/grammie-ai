import { describe, it, expect } from "vitest";
import { calendarEntries, eatingDate, groceryLines, prepPlanName } from "./calendar";
import { FakeSessionBuilder, planFrom, sampleSetup } from "./testing/fakes";

describe("calendar mapping", () => {
  it("starts the day after the session unless told otherwise", () => {
    expect(eatingDate(sampleSetup(), 0)).toBe("2026-10-19");
    expect(eatingDate(sampleSetup({ startSameDay: true }), 0)).toBe("2026-10-18");
    expect(eatingDate(sampleSetup({ session: { ...sampleSetup().session, date: "2026-10-31" } }), 1)).toBe("2026-11-02");
    expect(prepPlanName(sampleSetup())).toBe("Meal prep · Oct 18");
  });

  it("makes one entry per dish per meal, with everyone's servings", () => {
    const setup = sampleSetup();
    const plan = planFrom(setup, ["r1", "r2"], 80);
    plan.plates[1].items.push({ kind: "adjuster", refId: "rice", amount: 150, grams: 150, macros: { kcal: 0, protein: 0, carbs: 0, fat: 0 } });
    plan.plates[1].items[0].amount = 1.4;
    const entries = calendarEntries(setup, plan);
    expect(entries).toHaveLength(6); // 3 days x (lunch, dinner)
    const dinner = entries.find(e => e.date === "2026-10-19" && e.mealSlot === "dinner")!;
    expect(dinner.recipeId).toBe("r2");
    expect(dinner.scaledServings).toBe(2); // 1.4 + 1, rounded
    expect(dinner.notes).toBe("From meal prep · for Mom, Grandpa");
    expect(entries.some(e => e.recipeId === "rice")).toBe(false);
  });

  it("puts desserts on the calendar as snacks, marked Dessert", () => {
    const setup = sampleSetup({ days: 1 });
    setup.people[0].slots = ["dinner", "dessert"];
    const plan = planFrom(setup, ["r1", "r2"], 80);
    plan.plates.push({
      personId: "p1", day: 0, slot: "dessert", storage: "fridge", eatBy: "2026-10-20",
      items: [{ kind: "recipe", refId: "r9", amount: 1, grams: 120, macros: { kcal: 200, protein: 5, carbs: 30, fat: 6 } }],
      macros: { kcal: 200, protein: 5, carbs: 30, fat: 6 },
    });
    const dessert = calendarEntries(setup, plan).find(e => e.recipeId === "r9")!;
    expect(dessert.mealSlot).toBe("snack");
    expect(dessert.notes).toBe("Dessert · From meal prep · for Mom");
  });
});

describe("grocery lines", () => {
  it("counts protein shakes in bottles", () => {
    const lines = groceryLines({
      byAisle: [{ aisle: "Beverages", items: [{
        ingredient: { id: "shake-core-power", name: "Fairlife Core Power protein shake", aisle: "Beverages" },
        neededGrams: null, display: "6 bottles", buy: "6 bottles Fairlife Core Power (26 g protein each)", have: false, forRecipes: ["Plate add-ons"], substitutes: [],
      }] }],
      pantryCheck: [], estimatedCost: null,
    }, {});
    expect(lines[0]).toMatchObject({ quantity: 6, unit: "bottles", displayName: "Fairlife Core Power protein shake (6 bottles)" });
  });

  it("adds what's left to buy with its amount and package", async () => {
    const plan = planFrom(sampleSetup(), ["r1"], 80);
    const shopping = await new FakeSessionBuilder().shopping(plan);
    const lines = groceryLines(shopping, { r1: "Chili" });
    expect(lines).toEqual([{
      item: "sour cream",
      displayName: "sour cream (1 tub (16 oz))",
      quantity: 480,
      unit: "g",
      aisle: "Dairy & Eggs",
      originalEntries: [{ recipeId: "r1", recipeTitle: "Chili", quantity: 480, unit: "g", raw: "2 cups" }],
    }]);
  });
});
