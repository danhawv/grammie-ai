import { describe, it, expect } from "vitest";
import { applySubstitution, deltaPerServing, matchIngredientLines } from "./substitution";
import { FakeSessionBuilder, fakeFacts, planFrom, sampleSetup } from "./testing/fakes";

const facts = [fakeFacts("r1", "Chili"), fakeFacts("r2", "Soup", { lines: [] })];

describe("matching an ingredient", () => {
  it("finds lines by canonical name or by the written line, singular or plural", () => {
    expect(matchIngredientLines(facts, "Sour Cream").map(l => l.recipeId)).toEqual(["r1"]);
    expect(matchIngredientLines(facts, "chicken thighs")).toHaveLength(1);
    expect(matchIngredientLines(facts, "peanut butter")).toHaveLength(0);
  });

  it("works out the per-serving change", () => {
    const lines = matchIngredientLines(facts, "sour cream");
    const d = deltaPerServing(facts, lines, { kcal: 2, protein: 0, carbs: 0, fat: 0.2 }, { kcal: 1, protein: 0.1, carbs: 0, fat: 0 });
    expect(d.get("r1")).toEqual({ kcal: -60, protein: 6, carbs: 0, fat: -12 });
    expect(deltaPerServing(facts, lines, null, { kcal: 1, protein: 0, carbs: 0, fat: 0 }).get("r1")).toBeNull();
  });
});

describe("applySubstitution", () => {
  async function base() {
    const setup = sampleSetup();
    const plan = planFrom(setup, ["r1", "r2"], 80);
    const session = await new FakeSessionBuilder().session(setup, plan);
    return { setup, plan, session };
  }

  it("shifts only the affected plates and labels, without touching the input", async () => {
    const { plan, session } = await base();
    const r = applySubstitution({
      plan, session, facts, titles: { r1: "Chili" }, ingredient: "sour cream", replacement: "yogurt",
      from: { kcal: 2, protein: 0, carbs: 0, fat: 0.2 }, to: { kcal: 1, protein: 0.1, carbs: 0, fat: 0 },
    });
    expect(r.recipeIds).toEqual(["r1"]);
    expect(r.nutritionUpdated).toBe(true);
    // r1 is lunch for Mom only
    expect(r.labelKeys).toEqual(["p1:0:lunch", "p1:1:lunch", "p1:2:lunch"]);
    const label = r.session!.labels.find(l => l.plateKey === "p1:0:lunch")!;
    expect(label.macros).toMatchObject({ kcal: 440, protein: 36, fat: 3 });
    expect(label.confidence).toBe("medium");
    expect(r.session!.labels.find(l => l.plateKey === "p1:0:dinner")!.macros.kcal).toBe(500);
    expect(r.plan.fit.find(f => f.personId === "p1" && f.day === 0)!.macros.kcal).toBe(940);
    expect(plan.plates[0].macros.kcal).toBe(500);
    expect(session.labels[0].macros.kcal).toBe(500);
    expect(r.note).toBe("Used yogurt instead of sour cream in Chili. The labels were updated to match.");
  });

  it("marks labels low confidence when nutrition is unknown", async () => {
    const { plan, session } = await base();
    const r = applySubstitution({ plan, session, facts, titles: {}, ingredient: "sour cream", replacement: "yogurt", from: null, to: null });
    expect(r.nutritionUpdated).toBe(false);
    expect(r.session!.labels.filter(l => l.confidence === "low").map(l => l.plateKey)).toEqual(r.labelKeys);
    expect(r.session!.labels.find(l => l.plateKey === "p1:0:lunch")!.macros.kcal).toBe(500);
    expect(r.note).toMatch(/rougher/);
  });

  it("changes nothing for an ingredient not in the plan", async () => {
    const { plan, session } = await base();
    const r = applySubstitution({ plan, session, facts, titles: {}, ingredient: "saffron", replacement: "turmeric", from: null, to: null });
    expect(r.recipeIds).toEqual([]);
    expect(r.session).toEqual(session);
    expect(r.note).toMatch(/isn't in this week's recipes/);
  });
});
