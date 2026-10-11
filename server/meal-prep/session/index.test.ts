import { describe, expect, it, vi } from "vitest";
import type { FoodData } from "@shared/meal-prep/contract";
import { createSessionBuilder, memoryStepStore } from "./index";
import { stepsFor } from "./step-store";
import { ADJUSTERS, AI_ANSWERS, FACTS, PLAN, SETUP, SOURCES } from "./fixtures";

const loadRecipes = async (ids: string[]) => SOURCES.filter((s) => ids.includes(s.id));
const fakeAI = vi.fn(async (r: { id: string }) => ({ raw: AI_ANSWERS[r.id], model: "test-model", costMicros: 3000 }));

function builder(extra: Parameters<typeof createSessionBuilder>[0] = {}) {
  return createSessionBuilder({ loadRecipes, stepStore: memoryStepStore(), structurer: fakeAI, iterations: 40, ...extra });
}

describe("createSessionBuilder().session", () => {
  it("builds a full session from the plan", async () => {
    const s = await builder().session(SETUP, PLAN, FACTS, ADJUSTERS);
    expect(s.tasks.length).toBeGreaterThan(20);
    // Sorted by start; minutes from session start
    for (let i = 1; i < s.tasks.length; i++) expect(s.tasks[i].start).toBeGreaterThanOrEqual(s.tasks[i - 1].start);
    expect(s.totalMinutes).toBeGreaterThanOrEqual(Math.max(...s.tasks.map((t) => t.end)) + 10);
    expect(s.totalMinutes % 5).toBe(0);
    expect(s.handsOnMinutes).toBe(s.tasks.reduce((sum, t) => sum + t.activeMin, 0));
    expect(s.misePlace.some((m) => /^Dice 3½ medium onions/.test(m.text))).toBe(true);
    expect(s.equipment.join(" | ")).toMatch(/large pot/);
    expect(s.equipment.join(" | ")).toMatch(/Oven \(/);
  });

  it("makes a label for every stored plate, none for same-day ones", async () => {
    const s = await builder().session(SETUP, PLAN, FACTS, ADJUSTERS);
    expect(s.labels).toHaveLength(8);
    const chili = s.labels.find((l) => l.plateKey === "pat:0:lunch")!;
    expect(chili).toMatchObject({
      title: "Grandma's Chili + rice", person: "Pat", madeOn: "2026-10-18", eatBy: "2026-10-19", storage: "fridge",
      portion: "450 g Grandma's Chili + 150 g rice", allergens: ["Dairy"], confidence: "high",
    });
    const tuna = s.labels.find((l) => l.plateKey === "pat:2:lunch")!;
    expect(tuna.storage).toBe("freezer");
    expect(tuna.reheat).toMatch(/^Thaw overnight in the fridge/);
    expect(tuna.portion).toBe("1½ servings Tuna Noodle Casserole");
    const thighs = s.labels.find((l) => l.plateKey === "pat:0:dinner")!;
    expect(thighs.portion).toMatch(/; keep the pan juices in a separate cup$/);
    const yogurt = s.labels.find((l) => l.plateKey === "pat:2:dinner")!;
    expect(yogurt.allergens).toContain("Dairy");
    expect(s.containers.count).toBe(19);
  });

  it("caps eat-by at how long the dish keeps", async () => {
    const plan = { ...PLAN, plates: PLAN.plates.map((p) => ({ ...p, eatBy: "2026-12-31" })) };
    const s = await builder().session(SETUP, plan, FACTS, ADJUSTERS);
    // Tuna keeps 3 days in the fridge
    expect(s.labels.find((l) => l.plateKey === "gran:1:lunch")!.eatBy).toBe("2026-10-21");
  });

  it("flags allergy clashes and lists food safety notes", async () => {
    const s = await builder().session(SETUP, PLAN, FACTS, ADJUSTERS);
    const safety = s.safety.join("\n");
    expect(safety).toMatch(/within 2 hours/);
    expect(safety).toMatch(/165°F/);
    expect(safety).toMatch(/Gran: Tuna Noodle Casserole \(fish\)/);
    expect(safety).toMatch(/may contain/);
    expect(safety).not.toMatch(/\bfree\b|-free/i);
  });

  it("warns when the session runs past the time set, and two cooks are quicker", async () => {
    const tight = { ...SETUP, session: { ...SETUP.session, maxMinutes: 60 } };
    const one = await builder().session(tight, PLAN, FACTS, ADJUSTERS);
    expect(one.warnings.join(" ")).toMatch(/more than the 1 hour you set/);
    const two = await builder().session({ ...tight, session: { ...tight.session, cooks: 2 } }, PLAN, FACTS, ADJUSTERS);
    expect(two.totalMinutes).toBeLessThan(one.totalMinutes);
    expect(two.tasks.some((t) => t.cook === 2)).toBe(true);
  });

  it("lists the day-before jobs", async () => {
    const s = await builder().session({ ...SETUP, session: { ...SETUP.session, helper: true } }, PLAN, FACTS, ADJUSTERS);
    const before = s.beforeSession.join("\n");
    expect(before).toMatch(/Get 19 containers .* You have 8, so you'll need 11 more/);
    expect(before).toMatch(/ground beef, chicken thighs .* frozen/);
    expect(before).toMatch(/freezer space for 12/);
    expect(before).toMatch(/helper/);
  });

  it("works without AI, from the recipe's own steps", async () => {
    const s = await builder({ structurer: null }).session(SETUP, PLAN, FACTS, ADJUSTERS);
    expect(s.tasks.length).toBeGreaterThan(15);
    expect(s.labels).toHaveLength(8);
  });

  it("leaves out a recipe it can't find, with a warning", async () => {
    const s = await builder({ loadRecipes: async (ids) => SOURCES.filter((r) => ids.includes(r.id) && r.id !== "soup") }).session(SETUP, PLAN, FACTS, ADJUSTERS);
    expect(s.warnings.join(" ")).toMatch(/couldn't be found/);
    expect(s.tasks.some((t) => t.recipeIds.includes("soup") && t.kind !== "portion")).toBe(false);
  });
});

describe("createSessionBuilder().shopping", () => {
  it("returns the consolidated list", async () => {
    const food: FoodData = { factsFor: async () => [], adjusters: async () => [], packagesFor: async () => ({}) };
    const list = await builder().shopping(PLAN, FACTS, ADJUSTERS, ["salt"], food);
    expect(list.byAisle.length).toBeGreaterThan(3);
  });
});

describe("stepsFor", () => {
  it("asks the model once per recipe version and caches the answer", async () => {
    const store = memoryStepStore();
    const ai = vi.fn(async () => ({ raw: AI_ANSWERS.soup, model: "m", costMicros: 2500 }));
    const soup = SOURCES.find((s) => s.id === "soup")!;
    const a = await stepsFor(soup, store, ai);
    const b = await stepsFor(soup, store, ai);
    expect(ai).toHaveBeenCalledTimes(1);
    expect(a).toEqual(b);
    expect(a).toMatchObject({ source: "ai", model: "m", costMicros: 2500, version: 1 });
    // An edited recipe is redone
    await stepsFor({ ...soup, updatedAt: "2026-10-09T00:00:00.000Z" }, store, ai);
    expect(ai).toHaveBeenCalledTimes(2);
  });

  it("falls back to the recipe's steps when the model fails, and tries again next time", async () => {
    const store = memoryStepStore();
    const ai = vi.fn(async () => { throw new Error("quota"); });
    const soup = SOURCES.find((s) => s.id === "soup")!;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const a = await stepsFor(soup, store, ai);
    expect(a.source).toBe("heuristic");
    await stepsFor(soup, store, ai);
    expect(ai).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });
});
