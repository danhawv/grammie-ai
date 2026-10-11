import { describe, expect, it } from "vitest";
import type { KitchenSetup, ScheduledTask } from "@shared/meal-prep/contract";
import { schedule } from "./schedule";
import { buildGraph, type GraphTask } from "./merge";
import { validateSteps } from "./structure";
import { ADJUSTERS, AI_ANSWERS, FACTS, PLAN, SETUP, SOURCES } from "./fixtures";

const cookingEnd = (tasks: ScheduledTask[]) => Math.max(...tasks.filter((t) => t.kind !== "clean").map((t) => t.end));

const KITCHEN: KitchenSetup = { ovens: 1, ovenRacks: 2, burners: 4, appliances: [] };

function fixtureGraph(): GraphTask[] {
  const batches = PLAN.batches.map((batch) => {
    const src = SOURCES.find((s) => s.id === batch.recipeId)!;
    const v = validateSteps(AI_ANSWERS[src.id], src)!;
    return { batch, facts: FACTS.find((f) => f.recipeId === src.id)!, steps: { recipeId: src.id, recipeUpdatedAt: src.updatedAt, version: 1, source: "ai" as const, model: null, ...v, costMicros: 0 } };
  });
  return buildGraph(SETUP, PLAN, batches, ADJUSTERS).tasks;
}

/** Checks the rules every schedule must keep */
function checkSchedule(tasks: ScheduledTask[], graph: GraphTask[], cooks: number, kitchen: KitchenSetup) {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  for (const g of graph) expect(byId.has(g.id), `${g.id} scheduled`).toBe(true);
  for (const t of tasks) {
    for (const d of t.dependsOn) {
      const dep = byId.get(d);
      if (dep) expect(t.start, `${t.id} after ${d}`).toBeGreaterThanOrEqual(dep.end);
    }
    expect(t.end - t.start).toBe(t.activeMin + t.passiveMin);
    expect(t.cook).toBeGreaterThanOrEqual(1);
    expect(t.cook).toBeLessThanOrEqual(cooks);
  }
  // A cook does one hands-on thing at a time
  for (let c = 1; c <= cooks; c++) {
    const mine = tasks.filter((t) => t.cook === c && t.activeMin > 0).sort((a, b) => a.start - b.start);
    for (let i = 1; i < mine.length; i++) expect(mine[i].start, `${mine[i].id} vs ${mine[i - 1].id}`).toBeGreaterThanOrEqual(mine[i - 1].start + mine[i - 1].activeMin);
  }
  // Burners never over capacity
  const burnerTasks = tasks.filter((t) => t.resources.some((r) => r.kind === "burner"));
  for (const t of burnerTasks) {
    const at = burnerTasks.filter((o) => o.start <= t.start && o.end > t.start).length;
    expect(at).toBeLessThanOrEqual(kitchen.burners);
  }
  // One oven temperature at a time; every oven task follows a preheat at its temperature
  const ovenTasks = tasks.filter((t) => t.kind !== "preheat" && t.resources.some((r) => r.kind === "oven"));
  const preheats = tasks.filter((t) => t.kind === "preheat");
  for (const t of ovenTasks) {
    const temp = t.resources.find((r) => r.kind === "oven")!.tempF;
    for (const o of ovenTasks) {
      if (o !== t && o.start < t.end && o.end > t.start) expect(o.resources.find((r) => r.kind === "oven")!.tempF).toBe(temp);
    }
    for (const p of preheats) if (p.start < t.end && p.end > t.start && kitchen.ovens === 1) expect.fail(`preheat ${p.id} overlaps ${t.id}`);
    const pre = preheats.find((p) => t.dependsOn.includes(p.id))!;
    expect(pre.resources[0].tempF).toBe(temp);
    expect(pre.end).toBeLessThanOrEqual(t.start);
  }
}

describe("schedule", () => {
  const graph = fixtureGraph();

  it("keeps every rule with one cook", () => {
    const r = schedule(graph, { cooks: 1, kitchen: KITCHEN, iterations: 60 });
    checkSchedule(r.tasks, graph, 1, KITCHEN);
    // One cook: the session can't be shorter than the hands-on work
    const handsOn = r.tasks.reduce((s, t) => s + t.activeMin, 0);
    expect(r.makespan).toBeGreaterThanOrEqual(handsOn);
    expect(r.makespan).toBeLessThan(handsOn * 1.25);
  });

  it("is shorter with two cooks and still keeps every rule", () => {
    const one = schedule(graph, { cooks: 1, kitchen: KITCHEN, iterations: 60 });
    const two = schedule(graph, { cooks: 2, kitchen: KITCHEN, iterations: 60 });
    checkSchedule(two.tasks, graph, 2, KITCHEN);
    expect(two.makespan).toBeLessThan(one.makespan);
  });

  it("gets everything into the fridge within 2 hours of cooking", () => {
    const r = schedule(graph, { cooks: 1, kitchen: KITCHEN, iterations: 60 });
    const byId = new Map(r.tasks.map((t) => [t.id, t]));
    for (const g of graph.filter((t) => t.role === "store")) {
      const cooked = Math.max(...g.fridgeClockFrom!.map((id) => byId.get(id)!.end));
      expect(byId.get(g.id)!.end - cooked).toBeLessThanOrEqual(120);
    }
    expect(r.warnings.join(" ")).not.toMatch(/2 hours/);
  });

  it("more random tries never make it worse, and the same seed gives the same plan", () => {
    const few = schedule(graph, { cooks: 1, kitchen: KITCHEN, iterations: 1 });
    const many = schedule(graph, { cooks: 1, kitchen: KITCHEN, iterations: 200 });
    expect(many.score).toBeLessThanOrEqual(few.score);
    const again = schedule(graph, { cooks: 1, kitchen: KITCHEN, iterations: 200 });
    expect(again.tasks.map((t) => `${t.id}@${t.start}`)).toEqual(many.tasks.map((t) => `${t.id}@${t.start}`));
  });

  it("changes the oven between temperatures and preheats first", () => {
    const t = (id: string, tempF: number): GraphTask => ({
      id, recipeIds: [], text: id, kind: "bake", activeMin: 2, passiveMin: 30,
      resources: [{ kind: "cook", qty: 1 }, { kind: "oven", qty: 1, tempF }], dependsOn: [], holdMin: 20, vessel: null,
    });
    const g = [t("cake", 350), t("roast", 425)];
    const r = schedule(g, { cooks: 1, kitchen: KITCHEN, iterations: 5 });
    checkSchedule(r.tasks, g, 1, KITCHEN);
    const pre = r.tasks.filter((x) => x.kind === "preheat");
    expect(pre).toHaveLength(2);
    expect(pre.some((p) => /^Change the oven/.test(p.text))).toBe(true);
    expect(cookingEnd(r.tasks)).toBe(10 + 32 + 10 + 32);
    // Boards and counters get wiped at the end
    expect(r.makespan).toBe(cookingEnd(r.tasks) + 5);
    // Two ovens: both at once
    const two = schedule(g, { cooks: 1, kitchen: { ...KITCHEN, ovens: 2 }, iterations: 5 });
    expect(cookingEnd(two.tasks)).toBeLessThan(50);
  });

  it("shares a hot oven between dishes at the same temperature, up to the racks", () => {
    const t = (id: string): GraphTask => ({
      id, recipeIds: [], text: id, kind: "bake", activeMin: 1, passiveMin: 30,
      resources: [{ kind: "cook", qty: 1 }, { kind: "oven", qty: 1, tempF: 400 }], dependsOn: [], holdMin: 20, vessel: null,
    });
    const r = schedule([t("a"), t("b"), t("c")], { cooks: 1, kitchen: KITCHEN, iterations: 5 });
    expect(r.tasks.filter((x) => x.kind === "preheat")).toHaveLength(1);
    // Two racks: two together, the third after
    expect(cookingEnd(r.tasks)).toBe(10 + 31 + 31);
  });

  it("washes a pot before it's used again, and starts long waits early", () => {
    const pot = (id: string, deps: string[] = []): GraphTask => ({
      id, recipeIds: [], text: id, kind: "simmer", activeMin: 2, passiveMin: 20,
      resources: [{ kind: "cook", qty: 1 }, { kind: "burner", qty: 1 }], dependsOn: deps, holdMin: 30,
      vessel: { key: `${id}:dutch oven`, kind: "dutch oven" },
    });
    const chop = (id: string): GraphTask => ({
      id, recipeIds: [], text: id, kind: "prep", activeMin: 5, passiveMin: 0, resources: [{ kind: "cook", qty: 1 }, { kind: "board", qty: 1 }],
      dependsOn: [], holdMin: 240, vessel: null,
    });
    const marinate: GraphTask = {
      id: "marinate", recipeIds: [], text: "marinate", kind: "marinate", activeMin: 1, passiveMin: 90, resources: [{ kind: "cook", qty: 1 }],
      dependsOn: [], holdMin: 600, vessel: null,
    };
    const g = [pot("a"), pot("b"), chop("x"), chop("y"), chop("z"), marinate];
    const r = schedule(g, { cooks: 1, kitchen: KITCHEN, iterations: 30 });
    checkSchedule(r.tasks, g, 1, KITCHEN);
    const a = r.tasks.find((t) => t.id === "a")!;
    const b = r.tasks.find((t) => t.id === "b")!;
    const [first, second] = a.start < b.start ? [a, b] : [b, a];
    expect(second.start).toBeGreaterThanOrEqual(first.end);
    const wash = r.tasks.find((t) => t.text === "Wash the dutch oven for the next dish")!;
    expect(wash).toBeTruthy();
    expect(second.dependsOn).toContain(wash.id);
    expect(r.tasks.find((t) => t.id === "marinate")!.start).toBe(0);
  });

  it("borrows a pot rather than getting stuck, and says so", () => {
    // Chain A holds the only blender until its last step, which needs B first; B needs a blender too
    const g: GraphTask[] = [
      { id: "a1", recipeIds: [], text: "a1", kind: "assemble", activeMin: 2, passiveMin: 0, resources: [{ kind: "cook", qty: 1 }], dependsOn: [], holdMin: 30, vessel: { key: "A:blender", kind: "blender" } },
      { id: "b1", recipeIds: [], text: "b1", kind: "assemble", activeMin: 2, passiveMin: 0, resources: [{ kind: "cook", qty: 1 }], dependsOn: ["a1"], holdMin: 30, vessel: { key: "B:blender", kind: "blender" } },
      { id: "a2", recipeIds: [], text: "a2", kind: "assemble", activeMin: 2, passiveMin: 0, resources: [{ kind: "cook", qty: 1 }], dependsOn: ["b1"], holdMin: 30, vessel: { key: "A:blender", kind: "blender" } },
    ];
    const r = schedule(g, { cooks: 1, kitchen: KITCHEN, iterations: 3 });
    expect(r.tasks.filter((t) => g.some((x) => x.id === t.id))).toHaveLength(3);
    expect(r.warnings.join(" ")).toMatch(/one more blender/);
  });
});
