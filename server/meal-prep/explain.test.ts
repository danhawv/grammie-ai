import { describe, it, expect } from "vitest";
import { allowedNumbers, checkExplanation, explainInput, plainExplanation, type ExplainInput } from "./explain";
import { planFrom, sampleSetup } from "./testing/fakes";

const input: ExplainInput = {
  days: 5, peopleCount: 2, dishCount: 3, dishes: ["Chili", "Soup", "Stew"], fitScore: 87,
  people: [{ name: "Mom", hasTargets: true, daysOnTarget: 4, days: 5 }],
  notes: ["Rice is cooked once for 1,200 g"], relaxed: ["dinner repeats"],
};

describe("checkExplanation", () => {
  it("accepts friendly text that uses only the given numbers", () => {
    const text = "Your 5 days use 3 dishes. Mom is on target 4 of 5 days, and the rice is cooked once for 1,200 g.";
    expect(checkExplanation(text, input)).toBe(text);
  });

  it("rejects invented numbers", () => {
    expect(checkExplanation("Your 5 days use 3 dishes and save 9 hours.", input)).toBeNull();
    expect(checkExplanation("Each lunch is about 650 calories.", input)).toBeNull();
  });

  it("rejects health and allergy claims, junk and rambling", () => {
    expect(checkExplanation("This week's 3 dishes are allergen-free for the whole family.", input)).toBeNull();
    expect(checkExplanation(42, input)).toBeNull();
    expect(checkExplanation("Too short", input)).toBeNull();
    expect(checkExplanation("Nice. ".repeat(8), input)).toBeNull();
  });

  it("strips markdown", () => {
    expect(checkExplanation("**Your 5 days** use 3 dishes.", input)).toBe("Your 5 days use 3 dishes.");
  });

  it("knows the numbers in the facts", () => {
    expect(allowedNumbers(input).has("1200")).toBe(true);
    expect(allowedNumbers(input).has("87")).toBe(true);
  });
});

describe("plain explanation", () => {
  it("is built from the same facts and passes its own check", () => {
    const text = plainExplanation(input);
    expect(text).toMatch(/5 days with 3 dishes: Chili, Soup and Stew/);
    expect(text).toMatch(/Mom is on target 4 of 5 days/);
    expect(text).toMatch(/dinner repeats/);
    expect(checkExplanation(text, input)).toBe(text);
  });

  it("counts days on target from the plan's fit", () => {
    const setup = sampleSetup();
    const plan = planFrom(setup, ["r1", "r2"], 80);
    plan.fit[0].status.kcal = "low";
    const facts = explainInput(setup, plan, { r1: "Chili", r2: "Soup" });
    expect(facts.people[0]).toEqual({ name: "Mom", hasTargets: true, daysOnTarget: 2, days: 3 });
    expect(facts.dishes).toEqual(["Chili", "Soup"]);
  });
});
