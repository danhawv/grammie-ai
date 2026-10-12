import fs from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { Adjuster, PrepPlan, PrepSetup, RecipeFacts } from "@shared/meal-prep/contract";
import { createPlanner, stopSolver } from "./index";
import { LpModel } from "./lp";
import { solveLp } from "./solver";
import { ageOnDay, expandTerms, keepingFor, matchExclusion } from "./eligibility";
import { DEFAULT_REPEATS, handsOnMinutes, personSlots } from "./model";
import { adjusterFacts, dessertFacts, person, recipeFacts, scenarios, setupFor, shakeAdjusters } from "./test-fixtures";

const planner = createPlanner({ timeLimit: 2 });
const API_WEIGHTS = { macro: 1, preference: 0.5, cost: 0.2, handsOn: 0.3, waste: 0.3 };
const byName = (n: string) => scenarios().find((s) => s.name === n)!;

afterAll(() => stopSolver());

/** Rules every plan must keep, whatever it chose. */
function checkInvariants(plan: PrepPlan, setup: PrepSetup, facts: RecipeFacts[], adjusters: Adjuster[] = adjusterFacts()) {
  const fact = (id: string) => facts.find((f) => f.recipeId === id)!;
  // servings eaten never exceed servings cooked
  for (const b of plan.batches) {
    const eaten = plan.plates.flatMap((p) => p.items).filter((i) => i.kind === "recipe" && i.refId === b.recipeId).reduce((a, i) => a + i.amount, 0);
    expect(eaten).toBeLessThanOrEqual(b.servingsMade + 1e-9);
    expect([0.5, 1, 1.5, 2, 3]).toContain(b.scale);
  }
  expect(plan.batches.length).toBeLessThanOrEqual(setup.maxDishes ?? 5);
  for (const p of plan.plates) {
    const rec = p.items.filter((i) => i.kind === "recipe");
    expect(rec).toHaveLength(1);
    const r = fact(rec[0].refId);
    const person = setup.people.find((x) => x.id === p.personId)!;
    // portions in quarter steps between half and double
    expect(rec[0].amount * 4).toBe(Math.round(rec[0].amount * 4));
    expect(rec[0].amount).toBeGreaterThanOrEqual(0.5);
    expect(rec[0].amount).toBeLessThanOrEqual(2);
    if (!person.targets) expect(rec[0].amount).toBe(1);
    // shelf life
    const age = ageOnDay(setup, p.day);
    if (p.storage === "fridge") expect(age).toBeLessThanOrEqual(r.storage.fridgeDays);
    if (p.storage === "freezer") {
      expect(age).toBeGreaterThan(r.storage.fridgeDays);
      expect(r.storage.freezerDays ?? -1).toBeGreaterThanOrEqual(age);
    }
    expect(p.eatBy >= addDaysIso(setup.session.date, age)).toBe(true);
    // adjusters in whole steps, within limits, in suitable slots
    // portions: desserts half to one and a half servings
    if (p.slot === "dessert") {
      expect(r.mealTypes).toContain("dessert");
      expect(rec[0].amount).toBeLessThanOrEqual(1.5);
    }
    // plate macros include any swaps the batch uses
    const batch = plan.batches.find((b) => b.recipeId === r.recipeId)!;
    const delta = (plan.swapsApplied ?? []).filter((x) => x.recipeId === r.recipeId && batch.swapIds?.includes(x.swapId));
    const perKcal = r.perServing.kcal + delta.reduce((a, x) => a + x.perServingDelta.kcal, 0);
    expect(Math.abs(rec[0].macros.kcal - perKcal * rec[0].amount)).toBeLessThanOrEqual(2);
    const shakes = p.items.filter((x) => x.kind === "adjuster" && adjusters.find((a) => a.id === x.refId)?.topUp === "shake");
    expect(shakes.length).toBeLessThanOrEqual(1);
    for (const i of p.items.filter((x) => x.kind === "adjuster")) {
      const a = adjusters.find((x) => x.id === i.refId)!;
      if (a.topUp === "shake") expect(i.amount).toBe(a.unitGrams); // one whole bottle
      else expect(i.amount % a.stepGrams).toBe(0);
      if (p.slot === "dessert") expect(a.topUp).not.toBe("chicken");
      expect(i.amount).toBeLessThanOrEqual(a.maxGrams);
      expect(a.slots).toContain(p.slot);
    }
    expect(personSlots(person)).toContain(p.slot);
  }
}

function addDaysIso(iso: string, n: number) {
  const d = new Date(iso + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function noSameDayDish(plan: PrepPlan) {
  const seen = new Set<string>();
  for (const p of plan.plates) {
    const k = `${p.personId}:${p.day}:${p.items[0].refId}`;
    if (seen.has(k)) return false;
    seen.add(k);
  }
  return true;
}

function repeatsOk(plan: PrepPlan) {
  const counts = new Map<string, number>();
  for (const p of plan.plates) {
    const k = `${p.personId}:${p.slot}:${p.items[0].refId}`;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return Array.from(counts).every(([k, n]) => n <= DEFAULT_REPEATS[k.split(":")[1] as keyof typeof DEFAULT_REPEATS]);
}

describe("eligibility", () => {
  it("expands allergy words and matches at word starts", () => {
    const words = expandTerms(["Tree nuts"]);
    expect(words).toContain("walnut");
    const facts = recipeFacts();
    const pesto = facts.find((f) => f.recipeId === "pesto-chicken-pasta")!;
    const curry = facts.find((f) => f.recipeId === "chickpea-curry")!; // has coconut milk
    expect(matchExclusion(pesto, words)).not.toBeNull();
    expect(matchExclusion(curry, expandTerms(["nuts"]))).toBeNull();
    expect(matchExclusion(facts.find((f) => f.recipeId === "peanut-noodles")!, expandTerms(["peanuts"]))).toBe("peanut");
  });

  it("treats 'vegetarian' in dislikes as no meat or fish", () => {
    const w = expandTerms(["vegetarian"]);
    const facts = recipeFacts();
    expect(matchExclusion(facts.find((f) => f.recipeId === "turkey-chili")!, w)).not.toBeNull();
    expect(matchExclusion(facts.find((f) => f.recipeId === "aunt-mae-casserole")!, w)).not.toBeNull();
    expect(matchExclusion(facts.find((f) => f.recipeId === "lentil-soup")!, w)).toBeNull();
  });

  it("decides fridge, freezer or not at all", () => {
    const st = { fridgeDays: 4, freezerDays: 60, reheat: "", notes: [], reheatsWell: true };
    expect(keepingFor(st, 0, true)).toBe("fresh");
    expect(keepingFor(st, 4, true)).toBe("fridge");
    expect(keepingFor(st, 5, true)).toBe("freezer");
    expect(keepingFor(st, 5, false)).toBe("no");
    expect(keepingFor({ ...st, freezerDays: null }, 5, true)).toBe("no");
  });
});

describe("LP model and solver", () => {
  it("writes LP text HiGHS can solve, off the main thread", async () => {
    const m = new LpModel();
    const x = m.addVar({ type: "I", ub: 10, obj: -3 });
    const y = m.addVar({ type: "B", obj: -5 });
    const pinned = m.addVar({ type: "B", lb: 1, obj: 1 });
    m.addRow([[x, 1], [y, 4], [x, 1]], "<=", 9.5); // repeated x merges to 2x
    const lp = m.toString();
    expect(lp).toContain("2 v0 + 4 v1 <= 9.5");
    // best: x = 4 (-12) beats x = 2, y = 1 (-11); the pinned binary stays at 1
    const res = await solveLp(lp, { timeLimit: 1, mipGap: 0 });
    expect(res.status).toBe("Optimal");
    expect(Math.round(res.values![x])).toBe(4);
    expect(Math.round(res.values![y])).toBe(0);
    expect(Math.round(res.values![pinned])).toBe(1);
  });
});

describe("planner scenarios", () => {
  it("keeps the main thread free while solving", async () => {
    const s = byName("two-people");
    let ticks = 0;
    const timer = setInterval(() => ticks++, 20);
    const t0 = Date.now();
    await planner.plan(s.setup, s.facts, s.adjusters);
    clearInterval(timer);
    // the event loop kept running through the solve
    expect(ticks).toBeGreaterThan((Date.now() - t0) / 20 / 2);
  });

  it("one person, 2,200 kcal / 180 g protein, weekday lunches and dinners", async () => {
    const s = byName("one-lifter");
    const plan = await planner.plan(s.setup, s.facts, s.adjusters);
    checkInvariants(plan, s.setup, s.facts);
    expect(plan.plates).toHaveLength(10);
    expect(plan.fitScore).toBeGreaterThanOrEqual(80);
    expect(plan.relaxed).toEqual([]);
    expect(repeatsOk(plan)).toBe(true);
    expect(noSameDayDish(plan)).toBe(true);
    expect(plan.notes.some((n) => n.startsWith("Chose"))).toBe(true);
    // the day's aim is the lunch + dinner share of 2,200 kcal
    expect(plan.fit[0].target?.kcal).toBe(Math.round(2200 * 0.65));
  });

  it("two people with different targets share dishes, and allergies hold", async () => {
    const s = byName("two-people");
    const plan = await planner.plan(s.setup, s.facts, s.adjusters, API_WEIGHTS);
    checkInvariants(plan, s.setup, s.facts);
    expect(plan.plates).toHaveLength(20);
    const dishes = (id: string) => new Set(plan.plates.filter((p) => p.personId === id).map((p) => p.items[0].refId));
    const shared = Array.from(dishes("sam")).filter((d) => dishes("ana").has(d));
    expect(shared.length).toBeGreaterThan(0);
    expect(dishes("ana").has("shrimp-fried-rice")).toBe(false);
    expect(plan.fitScore).toBeGreaterThanOrEqual(80);
    // Sam eats more than Ana
    const kcal = (id: string) => plan.fit.filter((f) => f.personId === id).reduce((a, f) => a + f.macros.kcal, 0);
    expect(kcal("sam")).toBeGreaterThan(kcal("ana"));
  });

  it("vegetarian with a nut allergy gets no meat, fish or nuts", async () => {
    const s = byName("vegetarian-nut-allergy");
    const plan = await planner.plan(s.setup, s.facts, s.adjusters);
    checkInvariants(plan, s.setup, s.facts);
    const banned = new Set(["turkey-chili", "pesto-chicken-pasta", "peanut-noodles", "overnight-oats", "burrito-bowls", "sheet-pan-chicken", "tikka-masala", "meatloaf", "beef-broccoli"]);
    for (const p of plan.plates) for (const i of p.items) {
      expect(banned.has(i.refId)).toBe(false);
      expect(i.refId).not.toBe("chicken-breast-cooked");
    }
    expect(plan.plates).toHaveLength(15);
  });

  it("a thin pool still gives a plan and says what gave way", async () => {
    const s = byName("thin-pool");
    const plan = await planner.plan(s.setup, s.facts, s.adjusters);
    checkInvariants(plan, s.setup, s.facts);
    expect(plan.plates).toHaveLength(10);
    expect(plan.relaxed.some((r) => r.includes("more than the usual"))).toBe(true);
    expect(plan.relaxed.some((r) => r.includes("fits in the session"))).toBe(true);
  });

  it("varies dishes within each day when the pool allows, and says so when it can't", async () => {
    for (const name of ["two-people", "vegetarian-nut-allergy"]) {
      const s = byName(name);
      expect(noSameDayDish(await planner.plan(s.setup, s.facts, s.adjusters))).toBe(true);
    }
    const s = byName("one-lifter");
    const setup = { ...s.setup, days: 2 };
    const plan = await planner.plan(setup, s.facts.filter((f) => f.recipeId === "lentil-soup"), s.adjusters);
    expect(plan.plates).toHaveLength(4);
    expect(plan.relaxed.some((r) => r.includes("twice in one day"))).toBe(true);
  });

  it("seven days uses the freezer for late plates", async () => {
    const s = byName("seven-days-freezer");
    const plan = await planner.plan(s.setup, s.facts, s.adjusters);
    checkInvariants(plan, s.setup, s.facts);
    expect(plan.plates).toHaveLength(21);
    expect(plan.plates.some((p) => p.storage === "freezer")).toBe(true);
    expect(plan.plates.filter((p) => p.day < 3).every((p) => p.storage === "fridge")).toBe(true);
    expect(plan.notes.some((n) => n.includes("freezer"))).toBe(true);
  });

  it("without a freezer, meals nothing can safely cover are left open", async () => {
    const s = byName("one-lifter");
    const setup = { ...s.setup, days: 7, kitchen: { ...s.setup.kitchen, freezerSpace: "none" as const } };
    const facts = s.facts.filter((f) => f.storage.fridgeDays <= 4);
    const plan = await planner.plan(setup, facts, s.adjusters);
    checkInvariants(plan, setup, facts);
    expect(plan.plates.every((p) => ageOnDay(setup, p.day) <= 4)).toBe(true);
    expect(plan.relaxed.some((r) => r.includes("left open"))).toBe(true);
  });

  it("keeps pinned dishes and never uses excluded ones", async () => {
    const s = byName("one-lifter");
    const setup = { ...s.setup, pinnedRecipeIds: ["carnitas"], excludedRecipeIds: ["turkey-chili"] };
    const plan = await planner.plan(setup, s.facts, s.adjusters);
    const ids = plan.batches.map((b) => b.recipeId);
    expect(ids).toContain("carnitas");
    expect(ids).not.toContain("turkey-chili");
  });

  it("a ±1 wish bonus tips the choice", async () => {
    const s = byName("one-lifter");
    const base = await planner.plan(s.setup, s.facts, s.adjusters, API_WEIGHTS);
    const ids = base.batches.map((b) => b.recipeId);
    const wished = ["turkey-meatballs", "carnitas", "beef-broccoli", "burrito-bowls"].find((id) => !ids.includes(id))!;
    const more = await planner.plan(s.setup, s.facts, s.adjusters, { ...API_WEIGHTS, recipeBonus: { [wished]: 1 } });
    expect(more.batches.map((b) => b.recipeId)).toContain(wished);
    expect(more.fitScore).toBeGreaterThanOrEqual(80);
  });

  it("people without targets get one serving per meal", async () => {
    const setup = setupFor([person("gma", "Grandma", { slots: ["dinner"] })], { days: 3 });
    const plan = await planner.plan(setup, recipeFacts(), adjusterFacts());
    expect(plan.plates).toHaveLength(3);
    expect(plan.plates.every((p) => p.items.length === 1 && p.items[0].amount === 1)).toBe(true);
    expect(plan.fitScore).toBe(100);
    expect(plan.fit.every((f) => f.target === null)).toBe(true);
  });

  it("returns an explained empty plan when nothing can be planned", async () => {
    const setup = setupFor([person("x", "Pat", { allergies: ["onion"], dislikes: ["vegan"] })]);
    const plan = await planner.plan(setup, recipeFacts().filter((f) => f.recipeId === "turkey-chili"), adjusterFacts());
    expect(plan.plates).toEqual([]);
    expect(plan.relaxed.length).toBeGreaterThan(0);
  });
});

describe("balanced plates and kitchen equipment", () => {
  it("keeps each plate near its meal's share of the day", async () => {
    for (const name of ["one-lifter", "two-people", "seven-days-freezer"]) {
      const s = byName(name);
      const plan = await planner.plan(s.setup, s.facts, s.adjusters);
      expect(plan.fitScore).toBe(100);
      for (const p of plan.plates) {
        const person = s.setup.people.find((x) => x.id === p.personId)!;
        const fit = plan.fit.find((f) => f.personId === p.personId && f.day === p.day)!;
        if (!fit.target) continue;
        const share = { breakfast: 0.25, lunch: 0.3, dinner: 0.35, snack: 0.1, dessert: 0.1 };
        const total = personSlots(person).reduce((a, sl) => a + share[sl], 0);
        const aim = (fit.target.kcal * share[p.slot]) / total;
        expect(p.macros.kcal).toBeGreaterThanOrEqual(aim * 0.6);
        expect(p.macros.kcal).toBeLessThanOrEqual(aim * 1.4);
      }
    }
  });

  it("skips dishes that need an appliance the kitchen doesn't have, unless nothing else fits", async () => {
    const s = byName("one-lifter");
    const facts = s.facts.map((f) => (f.recipeId === "turkey-chili" || f.recipeId === "carnitas" ? { ...f, equipment: ["slow cooker"] } : f));
    const without = await planner.plan(s.setup, facts, s.adjusters);
    const ids = without.batches.map((b) => b.recipeId);
    expect(ids).not.toContain("turkey-chili");
    expect(ids).not.toContain("carnitas");

    const kitchen = { ...s.setup.kitchen, appliances: [{ kind: "Slow cooker", count: 1 }] };
    const withIt = await planner.plan({ ...s.setup, kitchen }, facts, s.adjusters, { ...API_WEIGHTS, recipeBonus: { "turkey-chili": 1 } });
    expect(withIt.batches.map((b) => b.recipeId)).toContain("turkey-chili");

    const only = facts.filter((f) => ["turkey-chili", "carnitas"].includes(f.recipeId));
    const forced = await planner.plan(s.setup, only, s.adjusters);
    expect(forced.plates.length).toBeGreaterThan(0);
    expect(forced.relaxed.some((r) => r.includes("needs a slow cooker"))).toBe(true);
  });

  it("treats a missing blender as a note, not a reason to skip", async () => {
    const s = byName("one-lifter");
    const facts = s.facts.map((f) => (f.recipeId === "turkey-chili" ? { ...f, equipment: ["blender"] } : f));
    const plan = await planner.plan(s.setup, facts, s.adjusters, { ...API_WEIGHTS, recipeBonus: { "turkey-chili": 1 } });
    expect(plan.batches.map((b) => b.recipeId)).toContain("turkey-chili");
    expect(plan.notes.some((n) => n.includes("easiest with a blender"))).toBe(true);
    expect(plan.relaxed.some((r) => r.includes("blender"))).toBe(false);
  });
});

describe("session time", () => {
  it("estimates hands-on minutes close to real sessions", () => {
    const f = recipeFacts()[0];
    const dish = (active: number, lines: number) => ({ ...f, activeMinutes: active, lines: f.lines.slice(0, 1).concat(Array(lines - 1).fill(f.lines[0])) });
    // measured in real sessions built by the session part: 64, 52 and 40 minutes
    expect(Math.abs(handsOnMinutes(dish(30, 21), 1) - 64)).toBeLessThan(6);
    expect(Math.abs(handsOnMinutes(dish(41, 17), 0.5) - 52)).toBeLessThan(6);
    expect(Math.abs(handsOnMinutes(dish(18, 10), 1.5) - 40)).toBeLessThan(6);
  });

  it("a larger sessionTimeFactor plans a lighter session", async () => {
    const s = byName("one-lifter");
    const slow = createPlanner({ timeLimit: 2, sessionTimeFactor: 2 });
    const base = await planner.plan(s.setup, s.facts, s.adjusters);
    const plan = await slow.plan(s.setup, s.facts, s.adjusters);
    const minutes = (p: PrepPlan) => {
      const m = /About (?:(\d+) hr)? ?(?:(\d+) min)? of hands-on/.exec(p.notes.join(" "))!;
      return Number(m[1] ?? 0) * 60 + Number(m[2] ?? 0);
    };
    expect(minutes(plan) / 2).toBeLessThan(minutes(base));
  });
});

describe("library quirks", () => {
  it("treats two saved copies of one recipe as one dish, and speaks to 'You'", async () => {
    const s = byName("one-lifter");
    const chili = s.facts.find((f) => f.recipeId === "turkey-chili")!;
    const facts = [...s.facts, { ...chili, recipeId: "turkey-chili-copy", title: "Turkey chili!" }];
    const setup = { ...s.setup, people: [{ ...s.setup.people[0], name: "You" }] };
    const plan = await planner.plan(setup, facts, s.adjusters);
    const ids = plan.batches.map((b) => b.recipeId);
    expect(ids.includes("turkey-chili") && ids.includes("turkey-chili-copy")).toBe(false);
    expect(plan.notes.some((n) => n.startsWith("Your prep covers"))).toBe(true);
    expect(plan.notes.join(" ")).not.toMatch(/You's|for You\b/);
  });
});

describe("swapOptions", () => {
  it("offers up to three replacements and keeps the other dishes", async () => {
    const s = byName("one-lifter");
    const plan = await planner.plan(s.setup, s.facts, s.adjusters);
    const out = plan.batches[0].recipeId;
    const keep = plan.batches.slice(1).map((b) => b.recipeId);
    const options = await planner.swapOptions(s.setup, plan, out, s.facts, s.adjusters);
    expect(options.length).toBeGreaterThan(0);
    expect(options.length).toBeLessThanOrEqual(3);
    expect(new Set(options.map((o) => o.recipeId)).size).toBe(options.length);
    for (const o of options) {
      const ids = o.plan.batches.map((b) => b.recipeId);
      expect(ids).not.toContain(out);
      expect(ids).toContain(o.recipeId);
      for (const k of keep) expect(ids).toContain(k);
      checkInvariants(o.plan, s.setup, s.facts);
    }
  });
});

describe("dessert", () => {
  const facts = [...recipeFacts(), ...dessertFacts()];

  it("puts a dessert on dessertsPerWeek days, spread out, from dessert recipes only", async () => {
    const setup = setupFor([person("sam", "Sam", { targets: { kcal: 2200, protein: 160 }, slots: ["lunch", "dinner", "dessert"] })], { dessertsPerWeek: 3 });
    const plan = await planner.plan(setup, facts, adjusterFacts());
    checkInvariants(plan, setup, facts);
    const desserts = plan.plates.filter((p) => p.slot === "dessert");
    expect(desserts.map((p) => p.day).sort()).toEqual([0, 2, 4]);
    expect(plan.plates.filter((p) => p.slot !== "dessert")).toHaveLength(10);
    expect(plan.fitScore).toBe(100);
    // dessert takes about a tenth of the day; the day's aim is bigger on dessert days
    const aim = (d: number) => plan.fit.find((f) => f.day === d)!.target!.kcal;
    expect(aim(0)).toBe(Math.round(2200 * 0.75));
    expect(aim(1)).toBe(Math.round(2200 * 0.65));
    for (const p of desserts) expect(p.macros.kcal).toBeLessThan(2200 * 0.1 * 1.6);
    expect(plan.notes.some((n) => n.includes("dessert on 3 of the 5 days"))).toBe(true);
  });

  it("defaults to dessert every day, and says so when there are no desserts to pick", async () => {
    const setup = setupFor([person("gma", "Grandma", { slots: ["dinner", "dessert"] })], { days: 4 });
    const plan = await planner.plan(setup, facts, adjusterFacts());
    expect(plan.plates.filter((p) => p.slot === "dessert")).toHaveLength(4);
    const none = await planner.plan(setup, recipeFacts(), adjusterFacts());
    expect(none.plates.filter((p) => p.slot === "dessert")).toHaveLength(0);
    expect(none.relaxed.some((r) => r.startsWith("Desserts are left off"))).toBe(true);
  });
});

describe("recipe swaps", () => {
  // a high-protein, lower-calorie aim from dishes that have swaps
  const facts = recipeFacts().filter((f) => ["tikka-masala", "meatloaf", "veggie-lasagna", "chickpea-curry"].includes(f.recipeId));
  const setup = setupFor([person("sam", "Sam", { targets: { kcal: 1800, protein: 150 }, slots: ["lunch", "dinner"] })], { days: 4, topUps: "none" });

  it("uses a recipe's swaps when they help, and calls each one out", async () => {
    const plan = await planner.plan(setup, facts, adjusterFacts());
    checkInvariants(plan, setup, facts);
    const applied = plan.swapsApplied ?? [];
    expect(applied.length).toBeGreaterThan(0);
    for (const x of applied) {
      expect(plan.batches.find((b) => b.recipeId === x.recipeId)!.swapIds).toContain(x.swapId);
      expect(x.note).toMatch(/ instead of .+: .*per serving$/);
      expect(plan.notes.some((n) => n.startsWith("Swap in") && n.includes(x.title))).toBe(true);
    }
    expect(applied.find((x) => x.swapId === "coconut->greek-yogurt")?.note).toBe("Nonfat Greek yogurt instead of coconut milk: +8 g protein, 95 fewer calories per serving");
    // at most one swap per ingredient line (meatloaf has two for its beef)
    expect(plan.batches.find((b) => b.recipeId === "meatloaf")?.swapIds?.length ?? 0).toBeLessThanOrEqual(1);
  });

  it("uses none when swaps are off or turned off one by one, and none an eater can't have", async () => {
    const off = await planner.plan({ ...setup, allowSwaps: false }, facts, adjusterFacts());
    expect(off.swapsApplied ?? []).toEqual([]);
    expect(off.batches.every((b) => !b.swapIds?.length)).toBe(true);
    expect(off.notes.some((n) => n.startsWith("Swap in"))).toBe(false);

    const excludedSwaps = ["tikka-masala:coconut->greek-yogurt"];
    const some = await planner.plan({ ...setup, excludedSwaps }, facts, adjusterFacts());
    expect((some.swapsApplied ?? []).map((x) => x.swapId)).not.toContain("coconut->greek-yogurt");

    // someone who won't eat turkey never gets the turkey swap in the meatloaf
    const noTurkey = { ...setup, people: [{ ...setup.people[0], dislikes: ["turkey"] }] };
    const plan = await planner.plan(noTurkey, facts, adjusterFacts(), { ...API_WEIGHTS, recipeBonus: { meatloaf: 3 } });
    expect((plan.swapsApplied ?? []).map((x) => x.swapId)).not.toContain("beef->turkey-93");
  });
});

describe("protein top-ups setting", () => {
  // low-protein dishes, so top-ups are needed; no tofu side, so the top-up setting decides
  const facts = recipeFacts().filter((f) => ["lentil-soup", "chickpea-curry", "quinoa-salad", "egg-muffins", "overnight-oats", "bean-enchiladas", "yogurt-parfait"].includes(f.recipeId));
  const adjusters = [...adjusterFacts().filter((a) => a.id !== "tofu-baked"), ...shakeAdjusters()];
  const base = setupFor([person("sam", "Sam", { targets: { kcal: 2400, protein: 170 }, slots: ["breakfast", "lunch", "dinner"] })], { days: 4 });
  const used = (plan: PrepPlan, kind: "chicken" | "shake") =>
    plan.plates.flatMap((p) => p.items).filter((i) => adjusters.find((a) => a.id === i.refId)?.topUp === kind);

  it("none: no chicken and no shakes", async () => {
    const plan = await planner.plan({ ...base, topUps: "none" }, facts, adjusters);
    checkInvariants(plan, base, facts, adjusters);
    expect(used(plan, "chicken")).toEqual([]);
    expect(used(plan, "shake")).toEqual([]);
  });

  it("shake: whole bottles of one product, at most one a plate, on its slots, with a plain note", async () => {
    const setup = { ...base, topUps: "shake" as const };
    const plan = await planner.plan(setup, facts, adjusters);
    checkInvariants(plan, setup, facts, adjusters);
    expect(used(plan, "chicken")).toEqual([]);
    const shakes = used(plan, "shake");
    expect(shakes.length).toBeGreaterThan(0);
    expect(new Set(shakes.map((i) => i.refId)).size).toBe(1);
    expect(plan.plates.filter((p) => p.slot === "dinner").every((p) => !p.items.some((i) => i.refId.startsWith("shake")))).toBe(true);
    expect(plan.notes.some((n) => /^Added a Fairlife Core Power shake to .* to reach Sam's protein\.$/.test(n))).toBe(true);
    // a picked shake (PrepSetup.shakeId) is the one used
    const picked = await planner.plan({ ...setup, shakeId: "premier" }, facts, adjusters);
    expect(new Set(used(picked, "shake").map((i) => i.refId))).toEqual(new Set(["shake-premier"]));
  });

  it("a milk-based shake is never given to someone avoiding dairy", async () => {
    const setup = { ...base, topUps: "shake" as const, people: [{ ...base.people[0], allergies: ["dairy"] }] };
    const plan = await planner.plan(setup, facts, adjusters);
    expect(used(plan, "shake")).toEqual([]);
  });
});

describe("planOptions", () => {
  it("offers up to three plans with different dishes, labelled and summarized", async () => {
    const s = byName("one-lifter");
    const t0 = Date.now();
    const options = await planner.planOptions(s.setup, s.facts, s.adjusters);
    const ms = Date.now() - t0;
    expect(options.length).toBe(3);
    expect(ms).toBeLessThan(10_000);
    expect(new Set(options.map((o) => o.key)).size).toBe(3);
    const sets = options.map((o) => o.plan.batches.map((b) => b.recipeId).sort().join(","));
    expect(new Set(sets).size).toBe(3);
    for (const o of options) {
      checkInvariants(o.plan, s.setup, s.facts);
      expect(o.label.length).toBeGreaterThan(0);
      expect(o.summary).toMatch(/^\d+ dish(es)? · about .+ hands-on · \d+ g protein\/day avg/);
      expect(o.plan.fitScore).toBe(100);
    }
    // each option leaves out at least two of each other option's dishes
    for (let i = 0; i < options.length; i++) for (let j = 0; j < options.length; j++) {
      if (i === j) continue;
      const a = options[i].plan.batches.map((b) => b.recipeId);
      const b = options[j].plan.batches.map((x) => x.recipeId);
      // (the later of the two left out two of the earlier one's dishes)
      expect(Math.max(a.filter((x) => !b.includes(x)).length, b.filter((x) => !a.includes(x)).length)).toBeGreaterThanOrEqual(2);
    }
  });

  it("returns fewer when the recipes don't allow more distinct plans", async () => {
    const s = byName("thin-pool");
    const options = await planner.planOptions(s.setup, s.facts, s.adjusters);
    expect(options.length).toBeGreaterThanOrEqual(1);
    expect(options.length).toBeLessThan(3);
  });
});

// The food-data part's fixtures (real family recipes). They land with that
// branch; until then point MP_FIXTURES_DIR at its worktree to run these.
const FIXTURES_DIR = process.env.MP_FIXTURES_DIR ?? path.resolve(__dirname, "../../../shared/meal-prep/fixtures");
const haveFixtures = fs.existsSync(path.join(FIXTURES_DIR, "recipe-facts.json"));

describe.skipIf(!haveFixtures)("planner on the food-data fixtures", () => {
  const load = () => ({
    facts: JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, "recipe-facts.json"), "utf8")) as RecipeFacts[],
    adjusters: JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, "adjusters.json"), "utf8")) as Adjuster[],
  });

  it("plans a lifter's week and a family's week from real recipes", async () => {
    const { facts, adjusters } = load();
    const lifter = setupFor([person("sam", "Sam", { targets: { kcal: 2200, protein: 180 } })]);
    const a = await planner.plan(lifter, facts, adjusters);
    checkInvariants(a, lifter, facts, adjusters);
    expect(a.plates).toHaveLength(10);
    expect(a.fitScore).toBeGreaterThanOrEqual(80);
    expect(noSameDayDish(a)).toBe(true);

    const family = setupFor([
      person("mom", "Mom", { targets: { kcal: 1800, protein: 120 }, allergies: ["tree nuts"] }),
      person("gpa", "Grandpa", { slots: ["dinner"], dislikes: ["shrimp"] }),
    ], { days: 6 });
    const b = await planner.plan(family, facts, adjusters);
    checkInvariants(b, family, facts, adjusters);
    for (const p of b.plates) {
      const r = facts.find((f) => f.recipeId === p.items[0].refId)!;
      expect(r.mealTypes).toContain(p.slot);
      if (p.personId === "mom") expect(r.allergens).not.toContain("tree-nut");
    }
  });

  it("adds dessert days, one shake brand and called-out swaps on real recipes (once the fixtures have them)", async () => {
    const { facts, adjusters } = load();
    const hasNew = facts.some((f) => f.mealTypes.includes("dessert")) && adjusters.some((a) => a.topUp === "shake") && facts.some((f) => f.swaps?.length);
    if (!hasNew) return;
    const setup = setupFor([person("sam", "Sam", { targets: { kcal: 2200, protein: 180 }, slots: ["breakfast", "lunch", "dinner", "dessert"] })], { dessertsPerWeek: 3, topUps: "shake" });
    const plan = await planner.plan(setup, facts, adjusters);
    checkInvariants(plan, setup, facts, adjusters);
    expect(plan.fitScore).toBeGreaterThanOrEqual(80);
    expect(plan.plates.filter((p) => p.slot === "dessert").map((p) => p.day).sort()).toEqual([0, 2, 4]);
    const items = plan.plates.flatMap((p) => p.items).filter((i) => i.kind === "adjuster");
    expect(items.some((i) => adjusters.find((a) => a.id === i.refId)?.topUp === "chicken")).toBe(false);
    const shakes = new Set(items.filter((i) => adjusters.find((a) => a.id === i.refId)?.topUp === "shake").map((i) => i.refId));
    expect(shakes.size).toBeLessThanOrEqual(1);
    if (shakes.size) expect(Array.from(shakes)[0]).toBe("shake-premier-protein-30g");
    for (const x of plan.swapsApplied ?? []) expect(plan.notes.some((n) => n.includes(x.note))).toBe(true);
  });
});
