// Simple in-memory stand-ins for the meal-prep tests. They follow the
// contract's shapes but none of the real logic: the planner picks the first
// allowed dishes, the session builder makes one task per dish.

import type {
  Adjuster, FoodData, Macros, PlanOption, Planner, PlanWeights, PrepPlan, PrepSession, PrepSetup,
  RecipeFacts, SessionBuilder, ShoppingList,
} from "@shared/meal-prep/contract";
import type { PrepCookbookChoice } from "@shared/meal-prep/api";
import type { PrepPlanRow, PrepPlanShareRow, PrepRecipes, PrepStore, ProgressRecord, CheckinRecord, ProfileRecord } from "../store";
import type { CalendarEntry, GroceryLine, PrepIntegrations } from "../calendar";
import type { MealPrepEngines } from "../engines";

let seq = 0;
const nextId = (p: string) => `${p}-${++seq}`;

export function fakeFacts(id: string, title: string, extra: Partial<RecipeFacts> = {}): RecipeFacts {
  return {
    recipeId: id,
    title,
    servings: 4,
    perServing: { kcal: 500, protein: 30, carbs: 50, fat: 15 },
    confidence: "high",
    nutritionSource: "usda",
    lines: [
      { index: 0, raw: "1 cup sour cream", ingredient: { id: "sour-cream", name: "sour cream", aisle: "Dairy & Eggs" }, grams: 240, prep: null, optional: false, confidence: "high" },
      { index: 1, raw: "1 lb chicken thighs", ingredient: { id: "chicken-thigh", name: "chicken thigh", aisle: "Meat & Seafood" }, grams: 454, prep: null, optional: false, confidence: "high" },
    ],
    mealTypes: ["lunch", "dinner"],
    cuisines: ["American"],
    mainProtein: "chicken",
    allergens: ["milk"],
    activeMinutes: 20,
    totalMinutes: 45,
    storage: { fridgeDays: 4, freezerDays: 60, reheat: "Microwave 2 min", notes: [], reheatsWell: true },
    preference: { rating: 4, favorite: false, recentCount: 0 },
    cost: 12,
    ...extra,
  };
}

export class FakeFood implements FoodData {
  adjusterList: Adjuster[] = [];
  constructor(public facts: RecipeFacts[], public nutrition: Record<string, Macros> = {}) {}
  async factsFor(ids: string[]) { return this.facts.filter(f => ids.includes(f.recipeId)); }
  async adjusters(): Promise<Adjuster[]> { return this.adjusterList; }
  async packagesFor() { return {}; }
  async ingredientNutrition(names: string[]) {
    const out: Record<string, { ingredient: { id: string; name: string; aisle: "Other" }; perGram: Macros } | null> = {};
    for (const n of names) out[n] = this.nutrition[n] ? { ingredient: { id: n, name: n, aisle: "Other" }, perGram: this.nutrition[n] } : null;
    return out;
  }
}

export class FakePlanner implements Planner {
  calls: Array<{ setup: PrepSetup; weights?: PlanWeights; facts?: RecipeFacts[]; adjusters?: Adjuster[] }> = [];
  delayMs = 0;
  /** false = behave like a planner without planOptions (it throws) */
  offersOptions = true;
  /** swaps to use, by recipe id (only ones still in the facts are used) */
  useSwaps: Record<string, string[]> = {};

  async planOptions(setup: PrepSetup, facts: RecipeFacts[], adjusters: Adjuster[], weights?: PlanWeights): Promise<PlanOption[]> {
    if (!this.offersOptions) throw new Error("planOptions isn't built yet");
    const first = await this.plan(setup, facts, adjusters, weights);
    this.calls[this.calls.length - 1].adjusters = adjusters;
    const used = new Set(first.batches.map(b => b.recipeId));
    const others = facts.filter(f => !used.has(f.recipeId) && !(setup.excludedRecipeIds ?? []).includes(f.recipeId)).map(f => f.recipeId);
    const options: PlanOption[] = [{ key: "balanced", label: "Best fit", summary: "Closest to everyone's goals", plan: first }];
    if (others.length) {
      options.push({ key: "variety", label: "Most variety", summary: "Different dishes", plan: this.withSwaps(planFrom(setup, others.slice(0, setup.maxDishes ?? 2), 70), facts) });
    }
    return options;
  }

  async plan(setup: PrepSetup, facts: RecipeFacts[], _adjusters: Adjuster[], weights?: PlanWeights): Promise<PrepPlan> {
    this.calls.push({ setup, weights });
    if (this.delayMs) await new Promise(r => setTimeout(r, this.delayMs));
    const excluded = new Set(setup.excludedRecipeIds ?? []);
    const pinned = setup.pinnedRecipeIds ?? [];
    const bonus = weights?.recipeBonus ?? {};
    const allowed = facts.filter(f => !excluded.has(f.recipeId))
      .sort((a, b) => Number(pinned.includes(b.recipeId)) - Number(pinned.includes(a.recipeId)) || (bonus[b.recipeId] ?? 0) - (bonus[a.recipeId] ?? 0));
    this.calls[this.calls.length - 1].facts = facts;
    return this.withSwaps(planFrom(setup, allowed.slice(0, setup.maxDishes ?? 2).map(f => f.recipeId), 80), facts);
  }

  private withSwaps(plan: PrepPlan, facts: RecipeFacts[]): PrepPlan {
    const applied: NonNullable<PrepPlan["swapsApplied"]> = [];
    for (const b of plan.batches) {
      const known = facts.find(f => f.recipeId === b.recipeId)?.swaps ?? [];
      const ids = (this.useSwaps[b.recipeId] ?? []).filter(id => known.some(s => s.id === id));
      if (!ids.length) continue;
      b.swapIds = ids;
      for (const id of ids) {
        const s = known.find(x => x.id === id)!;
        applied.push({ recipeId: b.recipeId, swapId: id, title: s.title, goal: s.goal, perServingDelta: s.perServingDelta, note: `${s.title}: +14 g protein, 95 fewer calories per serving` });
      }
    }
    return applied.length ? { ...plan, swapsApplied: applied } : plan;
  }

  async swapOptions(setup: PrepSetup, plan: PrepPlan, recipeId: string, facts: RecipeFacts[]) {
    const used = new Set(plan.batches.map(b => b.recipeId));
    return facts.filter(f => !used.has(f.recipeId)).map(f => ({
      recipeId: f.recipeId,
      plan: planFrom(setup, plan.batches.map(b => (b.recipeId === recipeId ? f.recipeId : b.recipeId)), 75),
    }));
  }
}

const SLOT_ORDER = ["lunch", "dinner", "breakfast", "snack"];

export function planFrom(setup: PrepSetup, recipeIds: string[], fitScore: number): PrepPlan {
  const m: Macros = { kcal: 500, protein: 30, carbs: 50, fat: 15 };
  const plates: PrepPlan["plates"] = [];
  const fit: PrepPlan["fit"] = [];
  for (const person of setup.people) {
    for (let day = 0; day < setup.days; day++) {
      person.slots.forEach(slot => {
        // same dish for everyone at a meal: lunch -> first dish, dinner -> second
        const recipeId = recipeIds[SLOT_ORDER.indexOf(slot) % recipeIds.length];
        plates.push({
          personId: person.id, day, slot,
          items: [{ kind: "recipe" as const, refId: recipeId, amount: 1, grams: 350, macros: { ...m } }],
          macros: { ...m }, storage: "fridge" as const, eatBy: "2026-10-22",
        });
      });
      fit.push({
        personId: person.id, day, macros: { kcal: 500 * person.slots.length, protein: 30 * person.slots.length, carbs: 0, fat: 0 },
        target: person.targets, status: { kcal: "ok" as const, protein: "ok" as const, carbs: "n/a" as const, fat: "n/a" as const },
      });
    }
  }
  return {
    batches: recipeIds.map(recipeId => ({ recipeId, scale: 1, servingsMade: 4 })),
    adjusterCooking: {},
    plates,
    fit,
    fitScore,
    notes: ["Chicken shows up twice to keep shopping simple"],
    relaxed: [],
    solverMs: 5,
  };
}

export class FakeSessionBuilder implements SessionBuilder {
  async shopping(plan: PrepPlan): Promise<ShoppingList> {
    return {
      byAisle: [
        { aisle: "Dairy & Eggs", items: [{ ingredient: { id: "sour-cream", name: "sour cream", aisle: "Dairy & Eggs" }, neededGrams: 480, display: "2 cups", buy: "1 tub (16 oz)", have: false, forRecipes: plan.batches.map(b => b.recipeId), substitutes: [] }] },
        { aisle: "Spices & Seasonings", items: [{ ingredient: { id: "salt", name: "salt", aisle: "Spices & Seasonings" }, neededGrams: null, display: "to taste", buy: null, have: true, forRecipes: [], substitutes: [] }] },
      ],
      pantryCheck: ["salt"],
      estimatedCost: 30,
    };
  }

  async session(setup: PrepSetup, plan: PrepPlan): Promise<PrepSession> {
    const tasks = plan.batches.map((b, i) => ({
      id: `t-${b.recipeId}`, recipeIds: [b.recipeId], text: `Cook ${b.recipeId}`, kind: "cook" as const,
      activeMin: 10, passiveMin: 20, resources: [], dependsOn: [], holdMin: 30,
      lane: "stove" as const, start: i * 30, end: i * 30 + 30, cook: 1,
    }));
    const labels = plan.plates.map(p => ({
      plateKey: `${p.personId}:${p.day}:${p.slot}`,
      title: p.items.map(i => i.refId).join(" + "),
      person: setup.people.find(x => x.id === p.personId)?.name ?? "",
      madeOn: setup.session.date, eatBy: p.eatBy, storage: "fridge" as const,
      macros: { ...p.macros }, confidence: "high" as const, reheat: "Microwave", allergens: ["milk"], portion: "350 g",
    }));
    return {
      tasks, totalMinutes: 60, handsOnMinutes: 30, misePlace: [], equipment: ["pot"], beforeSession: ["Buy containers"],
      labels, containers: { count: labels.length }, safety: ["Fridge within 2 hours"], warnings: [],
    };
  }
}

export function fakeEngines(facts: RecipeFacts[], nutrition: Record<string, Macros> = {}) {
  const food = new FakeFood(facts, nutrition);
  const planner = new FakePlanner();
  const session = new FakeSessionBuilder();
  const engines: MealPrepEngines = { food, planner, session };
  return { engines, food, planner, session };
}

export class MemoryStore implements PrepStore {
  profiles = new Map<string, ProfileRecord>();
  plans = new Map<string, PrepPlanRow>();
  shares: PrepPlanShareRow[] = [];
  progress = new Map<string, ProgressRecord[]>();
  checkins = new Map<string, CheckinRecord[]>();

  async getProfile(ownerId: string) { return this.profiles.get(ownerId) ?? null; }
  async putProfile(ownerId: string, defaults: any, walkthroughDone?: boolean) {
    const prev = this.profiles.get(ownerId);
    const rec = { defaults, walkthroughDone: walkthroughDone ?? prev?.walkthroughDone ?? false, updatedAt: new Date() };
    this.profiles.set(ownerId, rec);
    return rec;
  }
  async createPlan(ownerId: string, setup: PrepSetup) {
    const now = new Date();
    const row: PrepPlanRow = {
      id: nextId("plan"), ownerUserId: ownerId, status: "draft", buildStatus: "building", buildError: null,
      setup, plan: null, shopping: null, session: null, explanation: null, explanationAi: false, wishesResult: null,
      recipeTitles: {}, swapOptions: null, substitutions: [], options: null, sessionDate: setup.session.date,
      calendarMealPlanId: null, groceryListId: null, createdAt: now, updatedAt: now, approvedAt: null,
    };
    this.plans.set(row.id, row);
    return structuredClone(row);
  }
  async getPlan(id: string) { const r = this.plans.get(id); return r ? structuredClone(r) : null; }
  async listPlans(ownerId: string) { return Array.from(this.plans.values()).filter(p => p.ownerUserId === ownerId); }
  async updatePlan(id: string, update: any) {
    const r = this.plans.get(id);
    if (!r) return null;
    Object.assign(r, structuredClone(update), { updatedAt: new Date() });
    return structuredClone(r);
  }
  async createShare(s: { planId: string; tokenHash: string; label: string | null; expiresAt: Date }) {
    const row: PrepPlanShareRow = { id: nextId("share"), role: "cook", revokedAt: null, createdAt: new Date(), ...s };
    this.shares.push(row);
    return row;
  }
  async findShareByHash(hash: string) { return this.shares.find(s => s.tokenHash === hash) ?? null; }
  async listShares(planId: string) { return this.shares.filter(s => s.planId === planId); }
  async revokeShare(planId: string, shareId: string, at: Date) {
    const s = this.shares.find(x => x.id === shareId && x.planId === planId);
    if (!s) return false;
    s.revokedAt = at;
    return true;
  }
  async setTaskDone(planId: string, taskId: string, done: boolean, by: "owner" | "cook") {
    const list = (this.progress.get(planId) ?? []).filter(p => p.taskId !== taskId);
    if (done) list.push({ taskId, doneAt: new Date(), doneBy: by });
    this.progress.set(planId, list);
  }
  async listProgress(planId: string) { return this.progress.get(planId) ?? []; }
  async upsertCheckin(planId: string, c: Omit<CheckinRecord, "id" | "updatedAt">) {
    const list = (this.checkins.get(planId) ?? []).filter(x => !(x.personId === c.personId && x.day === c.day && x.slot === c.slot));
    const rec = { id: nextId("checkin"), ...c, updatedAt: new Date() };
    list.push(rec);
    this.checkins.set(planId, list);
    return rec;
  }
  async listCheckins(planId: string) { return this.checkins.get(planId) ?? []; }
}

export class FakeRecipes implements PrepRecipes {
  /** cookbook id -> recipe ids, and who can open each */
  cookbooks: Array<PrepCookbookChoice & { ownerId: string; recipeIds: string[] }> = [];
  favorites: Record<string, string[]> = {};
  constructor(public owned: Record<string, string[]>, public publicIds: string[] = []) {}
  async cookbooksFor(ownerId: string) {
    return this.cookbooks.filter(c => c.ownerId === ownerId).map(({ ownerId: _o, recipeIds: _r, ...c }) => c);
  }
  async recipeIdsInCookbooks(ownerId: string, ids: number[]) {
    return Array.from(new Set(this.cookbooks.filter(c => c.ownerId === ownerId && ids.includes(c.id)).flatMap(c => c.recipeIds)));
  }
  async favoriteRecipeIds(ownerId: string) { return this.favorites[ownerId] ?? []; }
  async ownRecipeIds(ownerId: string) { return this.owned[ownerId] ?? []; }
  async usableRecipeIds(ownerId: string, ids: string[]) {
    const mine = new Set([...(this.owned[ownerId] ?? []), ...this.publicIds]);
    return ids.filter(id => mine.has(id));
  }
  async forCook(ids: string[]) {
    return ids.map(id => ({ id, title: `Recipe ${id}`, servings: 4, ingredients: ["1 cup sour cream"], instructions: ["Cook it"] }));
  }
  async pantryNames() { return ["salt"]; }
}

export class FakeIntegrations implements PrepIntegrations {
  calendar: Array<{ ownerId: string; name: string; startDate: string; endDate: string; entries: CalendarEntry[] }> = [];
  grocery: Array<{ ownerId: string; lines: GroceryLine[]; mode: string; mealPlanId: string | null }> = [];
  async pushToCalendar(ownerId: string, plan: { name: string; startDate: string; endDate: string; entries: CalendarEntry[] }) {
    this.calendar.push({ ownerId, ...plan });
    return `cal-${this.calendar.length}`;
  }
  async addToGroceryList(ownerId: string, list: { lines: GroceryLine[]; mode: "add_to_existing" | "create_new"; mealPlanId: string | null }) {
    this.grocery.push({ ownerId, lines: list.lines, mode: list.mode, mealPlanId: list.mealPlanId });
    return `list-${this.grocery.length}`;
  }
}

export function sampleSetup(overrides: Partial<PrepSetup> = {}): PrepSetup {
  return {
    people: [
      { id: "p1", name: "Mom", targets: { kcal: 1800, protein: 120 }, slots: ["lunch", "dinner"], allergies: ["Peanuts"], dislikes: [] },
      { id: "p2", name: "Grandpa", targets: null, slots: ["dinner"], allergies: [], dislikes: [] },
    ],
    days: 3,
    kitchen: { ovens: 1, ovenRacks: 2, burners: 4, appliances: [] },
    session: { date: "2026-10-18", maxMinutes: 240, cooks: 1, helper: true, skill: "home" },
    ...overrides,
  };
}
