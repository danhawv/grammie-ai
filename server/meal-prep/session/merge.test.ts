import { describe, expect, it } from "vitest";
import { buildGraph, groupOvenTemps, shortTitle, type BatchInput, type GraphTask } from "./merge";
import { validateSteps } from "./structure";
import { ADJUSTERS, AI_ANSWERS, FACTS, PLAN, SETUP, SOURCES } from "./fixtures";
import type { RecipeSteps } from "./types";

function batches(plan = PLAN): BatchInput[] {
  return plan.batches.map((batch) => {
    const src = SOURCES.find((s) => s.id === batch.recipeId)!;
    const v = validateSteps(AI_ANSWERS[src.id], src)!;
    const steps: RecipeSteps = { recipeId: src.id, recipeUpdatedAt: src.updatedAt, version: 1, source: "ai", model: "test", ...v, costMicros: 0 };
    return { batch, facts: FACTS.find((f) => f.recipeId === src.id)!, steps };
  });
}

describe("buildGraph", () => {
  const graph = buildGraph(SETUP, PLAN, batches(), ADJUSTERS);
  const byText = (re: RegExp) => graph.tasks.filter((t) => re.test(t.text));

  it("merges the same cut of the same ingredient across recipes, with who it's for", () => {
    const diced = byText(/^Dice .*onions?/);
    expect(diced).toHaveLength(1);
    // Chili ×1.5 (225 g) + soup (300 g) = 525 g, about 3½ onions
    expect(diced[0].text).toBe("Dice 3½ medium onions: 1½ for Grandma's Chili, 2 for Vegetable Soup");
    expect(diced[0].recipeIds.sort()).toEqual(["chili", "soup"]);
    // Sliced onion (thighs) is a different cut and stays separate
    expect(byText(/Slice the onion/)).toHaveLength(1);
    // Tasks that used either recipe's diced onion now wait for the merged task
    const chiliBrown = graph.tasks.find((t) => t.id === "r1.t3")!;
    const soupSaute = graph.tasks.find((t) => t.id === "r2.t3")!;
    expect(chiliBrown.dependsOn).toContain(diced[0].id);
    expect(soupSaute.dependsOn).toContain(diced[0].id);
    expect(graph.mise.some((m) => m.text === diced[0].text)).toBe(true);
  });

  it("cooks rice once for the recipe line and the plates", () => {
    const rice = graph.tasks.filter((t) => t.role === "component");
    expect(rice.length).toBeGreaterThan(0);
    // 316 g cooked ×1.5 for the chili + 600 g for the plates = 1074 g cooked, ~358 g dry
    expect(graph.components).toHaveLength(1);
    expect(Math.round(graph.components[0].rawGrams)).toBe(358);
    expect(rice[0].text).toMatch(/for Grandma's Chili and plates/);
    // Chili containers wait for the rice
    const chiliPortion = graph.tasks.find((t) => t.role === "portion" && t.recipeIds.includes("chili"))!;
    expect(chiliPortion.dependsOn).toContain(rice[rice.length - 1].id);
  });

  it("scales and pads times: home cooks +10%, waiting unpadded", () => {
    const simmer = graph.tasks.find((t) => t.id === "r1.t4")!;
    expect(simmer.passiveMin).toBeGreaterThanOrEqual(42);
    const beginner = buildGraph({ ...SETUP, session: { ...SETUP.session, skill: "beginner" } }, PLAN, batches(), ADJUSTERS);
    const pro = buildGraph({ ...SETUP, session: { ...SETUP.session, skill: "pro" } }, PLAN, batches(), ADJUSTERS);
    const active = (g: typeof graph) => g.tasks.reduce((s, t) => s + t.activeMin, 0);
    expect(active(beginner)).toBeGreaterThan(active(graph));
    expect(active(graph)).toBeGreaterThan(active(pro));
  });

  it("portions, cools and stores each dish, skipping same-day plates", () => {
    const portions = graph.tasks.filter((t) => t.role === "portion");
    expect(portions).toHaveLength(4);
    const chili = portions.find((t) => t.recipeIds.includes("chili"))!;
    // 2 stored plates; the fresh one (Gran, day 2) isn't boxed but counts as plated
    expect(chili.text).toMatch(/^Fill 2 containers: 450 g Grandma's Chili \+ 150 g rice each/);
    expect(chili.text).toMatch(/5 extra servings/);
    const thighs = portions.find((t) => t.recipeIds.includes("thighs"))!;
    expect(thighs.text).toMatch(/pan juices in a separate cup/);
    const store = graph.tasks.find((t) => t.role === "store" && t.recipeIds.includes("tuna"))!;
    expect(store.text).toMatch(/into the freezer|in the freezer/);
    expect(store.fridgeClockFrom!.length).toBeGreaterThan(0);
    // 8 stored plates + extra servings: chili 5, tuna 3 (of 3.5), thighs 1, soup 2
    expect(graph.containers).toBe(8 + 5 + 3 + 1 + 2);
    expect(graph.freezerCount).toBe(1 + 11);
  });

  it("every dependency points at a task in the graph", () => {
    const ids = new Set(graph.tasks.map((t) => t.id));
    for (const t of graph.tasks) for (const d of t.dependsOn) expect(ids.has(d)).toBe(true);
  });
});

describe("groupOvenTemps", () => {
  const ovenTask = (id: string, tempF: number, mode: "bake" | "roast", passiveMin = 30): GraphTask => ({
    id, recipeIds: [], text: id, kind: "bake", activeMin: 1, passiveMin, resources: [{ kind: "oven", qty: 1, tempF }],
    dependsOn: [], holdMin: 20, vessel: null, ovenMode: mode,
  });
  it("moves roasts within 25°F to a bake's exact temperature, never moves bakes", () => {
    const tasks = [ovenTask("cake", 375, "bake"), ovenTask("veg", 400, "roast"), ovenTask("chicken", 450, "roast")];
    groupOvenTemps(tasks);
    expect(tasks[0].resources[0].tempF).toBe(375);
    expect(tasks[1].resources[0].tempF).toBe(375);
    expect(tasks[1].passiveMin).toBeGreaterThan(30); // a little cooler, a little longer
    expect(tasks[2].resources[0].tempF).toBe(450); // 75°F away: stays
  });
  it("groups roasts with each other", () => {
    const tasks = [ovenTask("a", 425, "roast"), ovenTask("b", 425, "roast"), ovenTask("c", 400, "roast")];
    groupOvenTemps(tasks);
    expect(tasks.map((t) => t.resources[0].tempF)).toEqual([425, 425, 425]);
  });
});

describe("shortTitle", () => {
  it("keeps short titles and trims long ones", () => {
    expect(shortTitle("Potato Leek Soup")).toBe("Potato Leek Soup");
    expect(shortTitle("Hearty Mexican-Style Beef and Bean Chili")).toBe("Bean Chili");
    expect(shortTitle("One-Pan Chicken Shawarma Rice Bowls")).toBe("Chicken Shawarma Rice Bowls");
    expect(shortTitle("Taylor's Greek Avgolemono (Greek Lemon Chicken Soup)")).toBe("Taylor's Greek Avgolemono");
  });
});

describe("notes and names", () => {
  it("keeps packing notes, drops make-ahead advice, and shortens them", async () => {
    const { packSeparately, shortNote, plainAdjusterName } = await import("./merge");
    expect(packSeparately("Keep the sauce in a separate cup")).toBe(true);
    expect(packSeparately("Keep the breadcrumb topping separate until just before baking.")).toBe(false);
    expect(shortNote("Store the chicken separate from the rice to prevent the rice from becoming mushy. Reheat gently.")).toBe("Store the chicken separate from the rice");
    expect(plainAdjusterName("Cooked white rice")).toBe("white rice");
    expect(plainAdjusterName("Rice (cooked)")).toBe("rice");
  });
});

describe("components the recipe cooks itself", () => {
  it("doesn't add a shared component when the recipe's own steps cook the line", () => {
    const b = batches().filter((x) => x.facts.recipeId === "chili");
    // The chili's rice line, cooked by a step of its own
    b[0].steps = { ...b[0].steps, tasks: [...b[0].steps.tasks, {
      id: "rice", text: "Cook the rice", kind: "simmer", activeMin: 2, passiveMin: 18, heat: "burner", tempF: null, appliance: null,
      vessel: "saucepan", dependsOn: [], holdMin: 30, doneCue: null, ingredients: [{ index: 6, fraction: 1, prep: null }], fromSteps: [3],
    }] };
    const g = buildGraph(SETUP, { ...PLAN, batches: [PLAN.batches[0]], adjusterCooking: {}, plates: [] }, b, ADJUSTERS);
    expect(g.components).toHaveLength(0);
  });
});
