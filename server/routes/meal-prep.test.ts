import { afterEach, beforeEach, describe, expect, it } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createMealPrepRouter, type MealPrepRouterDeps } from "./meal-prep";
import {
  FakeIntegrations, FakeRecipes, MemoryStore, fakeEngines, fakeFacts, sampleSetup,
} from "../meal-prep/testing/fakes";
import type { MealPrepAI } from "../meal-prep/ai";
import type { MealPrepEngines } from "../meal-prep/engines";
import type { PrepSubstitution } from "@shared/meal-prep/api";

const FACTS = [
  fakeFacts("r1", "Mom's Chili"),
  fakeFacts("r2", "Chicken Soup"),
  fakeFacts("r3", "Fish Tacos", { mainProtein: "fish", cuisines: ["Mexican"] }),
  fakeFacts("r4", "Beef Stew"),
];

interface Ctx {
  base: string;
  server: Server;
  store: MemoryStore;
  integrations: FakeIntegrations;
  engines: ReturnType<typeof fakeEngines>;
  ai: { wishes: unknown; explain: unknown; wishCalls: number };
  notified: PrepSubstitution[];
  deps: MealPrepRouterDeps;
  setEngines(e: MealPrepEngines | null): void;
}

let ctx: Ctx;

async function setup(overrides: Partial<MealPrepRouterDeps> = {}): Promise<Ctx> {
  const store = new MemoryStore();
  const integrations = new FakeIntegrations();
  const engines = fakeEngines(FACTS, {
    "sour cream": { kcal: 2, protein: 0.02, carbs: 0.05, fat: 0.2 },
    "greek yogurt": { kcal: 0.6, protein: 0.1, carbs: 0.04, fat: 0.0 },
  });
  const ai = { wishes: {} as unknown, explain: "This plan covers 3 days with 2 dishes." as unknown, wishCalls: 0 };
  const fakeAI: MealPrepAI = {
    wishes: async () => { ai.wishCalls++; return ai.wishes; },
    explain: async () => ai.explain,
  };
  let current: MealPrepEngines | null = engines.engines;
  const notified: PrepSubstitution[] = [];
  const deps: MealPrepRouterDeps = {
    store,
    recipes: new FakeRecipes({ alice: ["r1", "r2", "r3", "r4"], bob: ["b1"] }),
    integrations,
    engines: () => current,
    ai: fakeAI,
    instacart: () => null,
    notifyOwner: (_row, sub) => notified.push(sub),
    // Tests sign in with an x-user header
    auth: (req: any, _res, next) => {
      const user = req.header("x-user");
      if (user) req.user = { claims: { sub: user } };
      next();
    },
    userIdOf: (req: any) => req.user?.claims?.sub,
    waitMs: 200,
    ...overrides,
  };
  const app = express();
  app.use(express.json());
  app.use("/api/meal-prep", createMealPrepRouter(deps));
  const server = await new Promise<Server>(resolve => {
    const s = app.listen(0, () => resolve(s));
  });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/meal-prep`;
  return { base, server, store, integrations, engines, ai, notified, deps, setEngines: e => { current = e; } };
}

async function call(method: string, path: string, body?: unknown, user: string | null = "alice") {
  const res = await fetch(`${ctx.base}${path}`, {
    method,
    headers: { "content-type": "application/json", ...(user ? { "x-user": user } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, headers: res.headers };
}

async function makePlan(body: unknown = sampleSetup()) {
  const res = await call("POST", "/plans", body);
  expect(res.status).toBe(201);
  return res.body;
}

beforeEach(async () => { ctx = await setup(); });
afterEach(async () => { await new Promise(r => ctx.server.close(r)); });

describe("auth and ownership", () => {
  it("needs a signed-in user", async () => {
    expect((await call("GET", "/profile", undefined, null)).status).toBe(401);
    expect((await call("POST", "/plans", sampleSetup(), null)).status).toBe(401);
  });

  it("hides other people's plans", async () => {
    const plan = await makePlan();
    for (const [method, path, body] of [
      ["GET", `/plans/${plan.id}`, undefined],
      ["PATCH", `/plans/${plan.id}`, { exclude: ["r1"] }],
      ["POST", `/plans/${plan.id}/approve`, {}],
      ["POST", `/plans/${plan.id}/share`, {}],
      ["POST", `/plans/${plan.id}/swap`, { recipeId: "r1" }],
      ["GET", `/plans/${plan.id}/checkins`, undefined],
      ["POST", `/plans/${plan.id}/instacart`, {}],
    ] as const) {
      const res = await call(method, path, body, "bob");
      expect(res.status, `${method} ${path}`).toBe(404);
    }
    expect((await call("GET", "/plans", undefined, "bob")).body).toEqual([]);
  });

  it("refuses recipes the owner can't use as must-haves", async () => {
    const res = await call("POST", "/plans", sampleSetup({ pinnedRecipeIds: ["b1"] }));
    expect(res.status).toBe(400);
  });
});

describe("profile", () => {
  it("starts empty and saves the walkthrough answers", async () => {
    expect((await call("GET", "/profile")).body).toEqual({ defaults: {}, walkthroughDone: false, updatedAt: null });
    const { people, kitchen } = sampleSetup();
    const put = await call("PUT", "/profile", { defaults: { people, kitchen, days: 4 }, walkthroughDone: true });
    expect(put.status).toBe(200);
    const got = await call("GET", "/profile");
    expect(got.body.walkthroughDone).toBe(true);
    expect(got.body.defaults.days).toBe(4);
    expect(got.body.defaults.people[0].name).toBe("Mom");
  });

  it("rejects bad answers with a readable message", async () => {
    const res = await call("PUT", "/profile", { defaults: { days: 12 } });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/days/);
  });
});

describe("making a plan", () => {
  it("returns the plan, shopping list, session and explanation", async () => {
    const plan = await makePlan();
    expect(plan.buildStatus).toBe("ready");
    expect(plan.status).toBe("draft");
    expect(plan.plan.batches.map((b: any) => b.recipeId)).toEqual(["r1", "r2"]);
    expect(plan.shopping.byAisle.length).toBeGreaterThan(0);
    expect(plan.session.tasks.length).toBe(2);
    expect(plan.explanation).toBe("This plan covers 3 days with 2 dishes.");
    expect(plan.explanationByAI).toBe(true);
    expect(plan.recipeTitles).toMatchObject({ r1: "Mom's Chili", r2: "Chicken Soup" });
    expect(plan.sessionDate).toBe("2026-10-18");
  });

  it("falls back to plain words when the model invents a number", async () => {
    ctx.ai.explain = "This plan covers 3 days and saves you 45 minutes.";
    const plan = await makePlan();
    expect(plan.explanationByAI).toBe(false);
    expect(plan.explanation).toMatch(/3 days/);
    expect(plan.explanation).not.toMatch(/45/);
  });

  it("answers 202 when solving is slow, then the plan can be polled", async () => {
    ctx.engines.planner.delayMs = 400;
    const res = await call("POST", "/plans", sampleSetup());
    expect(res.status).toBe(202);
    expect(res.body.buildStatus).toBe("building");
    const early = await call("GET", `/plans/${res.body.id}`);
    expect(early.body.buildStatus).toBe("building");
    await new Promise(r => setTimeout(r, 450));
    const later = await call("GET", `/plans/${res.body.id}`);
    expect(later.body.buildStatus).toBe("ready");
    expect(later.body.plan.batches).toHaveLength(2);
  });

  it("says plainly when meal prep isn't switched on", async () => {
    ctx.setEngines(null);
    const res = await call("POST", "/plans", sampleSetup());
    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/isn't switched on/);
  });

  it("turns wishes into bonuses and exclusions, keeping only known ids", async () => {
    ctx.ai.wishes = { more: ["r4", "not-a-recipe"], never: ["r3", "r1"], less: [] };
    const plan = await makePlan(sampleSetup({ wishes: "No fish, more stew", pinnedRecipeIds: ["r1"] }));
    const call0 = ctx.engines.planner.calls[0];
    expect(call0.weights?.recipeBonus).toEqual({ r4: 1 });
    // r1 is pinned, so the wishes can't push it out
    expect(call0.setup.excludedRecipeIds).toEqual(["r3"]);
    expect(plan.wishes).toMatchObject({ excludedRecipeIds: ["r3"], more: ["r4"], source: "ai" });
    // the owner's own exclusions are kept apart from the wishes'
    expect(plan.setup.excludedRecipeIds ?? []).toEqual([]);
  });

  it("re-plans with pins and exclusions without asking the model again", async () => {
    ctx.ai.wishes = { never: ["r3"] };
    const plan = await makePlan(sampleSetup({ wishes: "no fish" }));
    expect(ctx.ai.wishCalls).toBe(1);
    const res = await call("PATCH", `/plans/${plan.id}`, { exclude: ["r1"], unexclude: ["r3"], setup: { days: 2 } });
    expect(res.status).toBe(200);
    expect(ctx.ai.wishCalls).toBe(1);
    const last = ctx.engines.planner.calls.at(-1)!;
    expect(last.setup.days).toBe(2);
    expect(last.setup.excludedRecipeIds).toEqual(["r1"]);
    expect(res.body.plan.batches.map((b: any) => b.recipeId)).toEqual(["r2", "r3"]);
  });

  it("finishes and cancels without re-planning", async () => {
    const plan = await makePlan();
    const res = await call("PATCH", `/plans/${plan.id}`, { status: "cancelled" });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("cancelled");
    expect(ctx.engines.planner.calls).toHaveLength(1);
  });

  it("limits how often a plan can be solved", async () => {
    for (let i = 0; i < 6; i++) await makePlan();
    const res = await call("POST", "/plans", sampleSetup());
    expect(res.status).toBe(429);
    // reading is still fine
    expect((await call("GET", "/plans")).status).toBe(200);
  });
});

describe("swaps", () => {
  it("offers other dishes and applies the chosen one", async () => {
    const plan = await makePlan();
    const swap = await call("POST", `/plans/${plan.id}/swap`, { recipeId: "r1" });
    expect(swap.status).toBe(200);
    expect(swap.body.options.map((o: any) => o.recipeId)).toEqual(["r3", "r4"]);
    expect(swap.body.options[0]).toMatchObject({ title: "Fish Tacos", fitScore: 75, fitScoreChange: -5 });

    const chosen = await call("POST", `/plans/${plan.id}/choose-swap`, { recipeId: "r4" });
    expect(chosen.status).toBe(200);
    expect(chosen.body.plan.batches.map((b: any) => b.recipeId)).toEqual(["r4", "r2"]);
    expect(chosen.body.setup.excludedRecipeIds).toEqual(["r1"]);
    expect(chosen.body.recipeTitles.r4).toBe("Beef Stew");

    // the offer is used up
    expect((await call("POST", `/plans/${plan.id}/choose-swap`, { recipeId: "r3" })).status).toBe(409);
  });

  it("rejects a dish that isn't in the plan", async () => {
    const plan = await makePlan();
    expect((await call("POST", `/plans/${plan.id}/swap`, { recipeId: "r4" })).status).toBe(400);
  });
});

describe("approve", () => {
  it("puts the plan on the calendar and the grocery list, once", async () => {
    const plan = await makePlan();
    const res = await call("POST", `/plans/${plan.id}/approve`, {});
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("approved");
    expect(res.body.calendarMealPlanId).toBe("cal-1");
    expect(res.body.groceryListId).toBe("list-1");

    const cal = ctx.integrations.calendar[0];
    expect(cal.ownerId).toBe("alice");
    expect(cal.startDate).toBe("2026-10-19");
    expect(cal.endDate).toBe("2026-10-21");
    // Mom lunch+dinner, Grandpa dinner: dinner entries are shared
    const day0 = cal.entries.filter(e => e.date === "2026-10-19");
    expect(day0).toHaveLength(2);
    expect(day0.find(e => e.mealSlot === "dinner")).toMatchObject({ recipeId: "r2", scaledServings: 2 });

    const grocery = ctx.integrations.grocery[0];
    expect(grocery.mode).toBe("add_to_existing");
    expect(grocery.mealPlanId).toBe("cal-1");
    // "have" items (salt) aren't added
    expect(grocery.lines.map(l => l.item)).toEqual(["sour cream"]);

    const again = await call("POST", `/plans/${plan.id}/approve`, {});
    expect(again.status).toBe(200);
    expect(ctx.integrations.calendar).toHaveLength(1);
    expect(ctx.integrations.grocery).toHaveLength(1);

    // approved plans aren't re-planned
    expect((await call("PATCH", `/plans/${plan.id}`, { exclude: ["r1"] })).status).toBe(409);
  });
});

describe("cook links", () => {
  async function shared() {
    const plan = await makePlan(sampleSetup({ budget: 120, wishes: "more soup" }));
    const share = await call("POST", `/plans/${plan.id}/share`, { label: "Rosa" });
    expect(share.status).toBe(201);
    return { plan, share: share.body };
  }

  it("opens without an account and shows only the cook's view", async () => {
    const { plan, share } = await shared();
    expect(share.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(share.path).toBe(`/prep/cook/${share.token}`);
    // the token isn't stored readable
    expect(JSON.stringify(ctx.store.shares)).not.toContain(share.token);

    const res = await call("GET", `/cook/${share.token}`, undefined, null);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    expect(res.body.planId).toBe(plan.id);
    expect(res.body.session.tasks).toHaveLength(2);
    expect(res.body.recipes.map((r: any) => r.id)).toEqual(["r1", "r2"]);
    expect(res.body.householdAllergies).toEqual(["peanuts"]);
    const text = JSON.stringify(res.body);
    for (const secret of ["alice", "ownerUserId", "targets", "budget", "more soup", "explanation", "wishes", "Fish Tacos", "Beef Stew"]) {
      expect(text, secret).not.toContain(secret);
    }
  });

  it("lists and turns off links", async () => {
    const { plan, share } = await shared();
    const list = await call("GET", `/plans/${plan.id}/shares`);
    expect(list.body).toHaveLength(1);
    expect(list.body[0]).toMatchObject({ label: "Rosa", active: true });
    expect(list.body[0].token).toBeUndefined();
    expect((await call("DELETE", `/plans/${plan.id}/shares/${share.id}`)).status).toBe(200);
    const res = await call("GET", `/cook/${share.token}`, undefined, null);
    expect(res.status).toBe(410);
    expect(res.body.error).toMatch(/turned this cook link off/);
  });

  it("refuses unknown, malformed and expired links", async () => {
    expect((await call("GET", `/cook/${"a".repeat(43)}`, undefined, null)).status).toBe(404);
    expect((await call("GET", `/cook/short`, undefined, null)).status).toBe(404);
    const { share } = await shared();
    ctx.store.shares[0].expiresAt = new Date(Date.now() - 1000);
    expect((await call("GET", `/cook/${share.token}`, undefined, null)).status).toBe(410);
  });

  it("records the cook's progress on real steps only", async () => {
    const { plan, share } = await shared();
    const ok = await call("POST", `/cook/${share.token}/progress`, { taskId: "t-r1", done: true }, null);
    expect(ok.status).toBe(200);
    expect(ok.body.progress["t-r1"].by).toBe("cook");
    expect((await call("POST", `/cook/${share.token}/progress`, { taskId: "nope", done: true }, null)).status).toBe(400);
    const owner = await call("GET", `/plans/${plan.id}`);
    expect(owner.body.progress["t-r1"].by).toBe("cook");
    const undone = await call("POST", `/cook/${share.token}/progress`, { taskId: "t-r1", done: false }, null);
    expect(undone.body.progress).toEqual({});
  });

  it("records a swap, updates the labels and tells the owner", async () => {
    const { plan, share } = await shared();
    const before = (await call("GET", `/plans/${plan.id}`)).body;
    const label0 = before.session.labels.find((l: any) => l.plateKey === "p1:0:lunch");

    const res = await call("POST", `/cook/${share.token}/substitution`, { ingredient: "sour cream", replacement: "greek yogurt" }, null);
    expect(res.status).toBe(201);
    expect(res.body.substitution.note).toMatch(/greek yogurt instead of sour cream/);
    expect(ctx.notified).toHaveLength(1);

    const after = (await call("GET", `/plans/${plan.id}`)).body;
    expect(after.unseenSubstitutions).toBe(1);
    expect(after.substitutions[0]).toMatchObject({ by: "cook", nutritionUpdated: true, recipeIds: ["r1", "r2"] });
    const label1 = after.session.labels.find((l: any) => l.plateKey === "p1:0:lunch");
    // 240 g per 4 servings: (0.6 - 2) kcal/g * 240 / 4 = -84 kcal; (0.1 - 0.02) * 240 / 4 = +4.8 g protein
    expect(label1.macros.kcal).toBe(Math.round(label0.macros.kcal - 84));
    expect(label1.macros.protein).toBe(Math.round(label0.macros.protein + 4.8));
    expect(label1.confidence).toBe("medium");

    const seen = await call("POST", `/plans/${plan.id}/substitutions/seen`, {});
    expect(seen.body.unseenSubstitutions).toBe(0);
  });

  it("marks labels rougher when the swap's nutrition is unknown", async () => {
    const { plan, share } = await shared();
    await call("POST", `/cook/${share.token}/substitution`, { ingredient: "chicken thighs", replacement: "tofu" }, null);
    const after = (await call("GET", `/plans/${plan.id}`)).body;
    expect(after.substitutions[0].nutritionUpdated).toBe(false);
    expect(after.session.labels.every((l: any) => l.confidence === "low")).toBe(true);
  });

  it("stops writes once the plan is done", async () => {
    const { plan, share } = await shared();
    await call("PATCH", `/plans/${plan.id}`, { status: "done" });
    expect((await call("GET", `/cook/${share.token}`, undefined, null)).status).toBe(200);
    expect((await call("POST", `/cook/${share.token}/progress`, { taskId: "t-r1", done: true }, null)).status).toBe(409);
  });
});

describe("check-ins", () => {
  it("saves one answer per plate and checks the person and day", async () => {
    const plan = await makePlan();
    const first = await call("POST", `/plans/${plan.id}/checkins`, { personId: "p1", day: 0, slot: "lunch", outcome: "too_much" });
    expect(first.status).toBe(201);
    await call("POST", `/plans/${plan.id}/checkins`, { personId: "p1", day: 0, slot: "lunch", outcome: "ate", note: "Better" });
    const list = await call("GET", `/plans/${plan.id}/checkins`);
    expect(list.body).toHaveLength(1);
    expect(list.body[0]).toMatchObject({ outcome: "ate", note: "Better" });
    expect((await call("POST", `/plans/${plan.id}/checkins`, { personId: "zz", day: 0, slot: "lunch", outcome: "ate" })).status).toBe(400);
    expect((await call("POST", `/plans/${plan.id}/checkins`, { personId: "p1", day: 5, slot: "lunch", outcome: "ate" })).status).toBe(400);
    expect((await call("POST", `/plans/${plan.id}/checkins`, { personId: "p1", day: 0, slot: "lunch", outcome: "loved" })).status).toBe(400);
  });
});

describe("Instacart", () => {
  it("answers 501 with a friendly message when not set up", async () => {
    const plan = await makePlan();
    const res = await call("POST", `/plans/${plan.id}/instacart`, {});
    expect(res.status).toBe(501);
    expect(res.body.code).toBe("instacart_not_configured");
  });

  it("sends what's left to buy and returns the link", async () => {
    await new Promise(r => ctx.server.close(r));
    const sent: any[] = [];
    ctx = await setup({ instacart: () => async req => { sent.push(req); return "https://www.instacart.com/store/list/abc"; } });
    const plan = await makePlan();
    const res = await call("POST", `/plans/${plan.id}/instacart`, {});
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ url: "https://www.instacart.com/store/list/abc", items: 1 });
    expect(sent[0].items[0]).toMatchObject({ name: "sour cream", line_item_measurements: [{ quantity: 480, unit: "gram" }] });
  });
});

describe("credits", () => {
  async function withCredits(canStart: boolean) {
    await new Promise(r => ctx.server.close(r));
    const charged: string[] = [];
    ctx = await setup({
      credits: {
        canStart: async (res, _owner) => {
          if (!canStart) res.status(402).json({ error: "Add credits to keep going.", code: "needs_credits" });
          return canStart;
        },
        charge: async (owner, planId) => { charged.push(`${owner}:${planId}`); },
      },
    });
    return charged;
  }

  it("charges a new plan when it builds, and re-plans don't charge again", async () => {
    const charged = await withCredits(true);
    const plan = await makePlan();
    expect(charged).toEqual([`alice:${plan.id}`]);
    const replan = await call("PATCH", `/plans/${plan.id}`, { exclude: ["r1"] });
    expect(replan.status).toBe(200);
    // The router asks again; credits.ts makes the repeat a no-op (same plan id)
    expect(new Set(charged)).toEqual(new Set([`alice:${plan.id}`]));
  });

  it("refuses a new plan the owner can't afford, without making it", async () => {
    const charged = await withCredits(false);
    const res = await call("POST", "/plans", sampleSetup());
    expect(res.status).toBe(402);
    expect(res.body.code).toBe("needs_credits");
    expect((await call("GET", "/plans")).body).toEqual([]);
    expect(charged).toEqual([]);
  });
});
