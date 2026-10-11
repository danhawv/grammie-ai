// Turns a prep setup into one mixed-integer model:
//   - which recipes to cook and how many batches (0.5x … 3x), at most maxDishes
//   - which recipe goes on each person's plate for each day and meal, and how
//     many servings (0.5 … 2 in quarter steps)
//   - grams of simple adjusters (rice, chicken, yogurt) per person-day
// Hard rules: allergies/dislikes, shelf life, servings eaten ≤ servings made,
// pinned/excluded dishes, dish count. Everything else is a penalty, so the
// solver always returns a plan and we can say which limit gave way. Penalty
// sizes put the limits in the agreed order of giving way: repeats first, then
// protein variety, then session time, then the macro bands.

import type {
  Adjuster, MacroKey, MacroTargets, MealSlot, PlanWeights, PrepPerson, PrepSetup, RecipeFacts,
} from "@shared/meal-prep/contract";
import { LpModel, type Term } from "./lp";
import { SOFT_APPLIANCES, normalizeAppliance } from "@shared/meal-prep/equipment";
import {
  adjusterExcluded, ageOnDay, keepingFor, matchExclusion, personWords, suitsSlot, type Keeping,
} from "./eligibility";

export const SCALES = [0.5, 1, 1.5, 2, 3] as const;
/** portion range in quarter servings */
export const MIN_QUARTERS = 2;
export const MAX_QUARTERS = 8;
const SLOT_ORDER: MealSlot[] = ["breakfast", "lunch", "dinner", "snack"];

/**
 * Daily targets are for the whole day; the prep only covers some meals. We aim
 * each person's prep plates at this share of the day for the slots they eat
 * from the prep (all four slots = the whole day).
 */
export const DEFAULT_SLOT_SHARE: Record<MealSlot, number> = {
  breakfast: 0.25,
  lunch: 0.3,
  dinner: 0.35,
  snack: 0.1,
};

/** Same values the API sends (DEFAULT_PLAN_WEIGHTS), used when weights are undefined. */
export const DEFAULT_WEIGHTS: PlanWeights = { macro: 1, preference: 0.5, cost: 0.2, handsOn: 0.3, waste: 0.3 };
export const DEFAULT_REPEATS: Record<MealSlot, number> = { breakfast: 7, lunch: 4, dinner: 2, snack: 7 };
const DEFAULT_TOL: Record<MacroKey, number> = { kcal: 0.05, protein: 0, carbs: 0.15, fat: 0.15 };
/** extra room for numbers we're less sure of, as a share of that food's macros */
export const CONFIDENCE_WIDEN = { high: 0, medium: 0.05, low: 0.1 } as const;
/**
 * Session time, calibrated on real sessions built by the session part (8
 * dishes from the owner's recipes, two full runs; per-dish error about ±5 min,
 * whole session within a few minutes):
 *   hands-on per dish ≈ (5 + 1.2 × activeMinutes + 1 × ingredient lines) × (0.6 + 0.4 × batches)
 *   plus about 10 min for the session and 3 min per plate (portioning, labels, washing up).
 * The schedule then adds waiting and a 10% cushion, about 13% on top, so one
 * cook's hands-on minutes should stay under 87% of the session.
 */
export const SESSION_MODEL = { perDish: 5, perActiveMinute: 1.2, perLine: 1, batchBase: 0.6, batchSlope: 0.4, session: 10, perPlate: 3, handsOnShare: 0.87, secondCook: 0.7 };
const MAX_CANDIDATES = 20;

export const PEN = {
  missingPlate: 2000,
  repeat: 15,
  /** the same dish twice in one day for one person (gives way after repeats) */
  sameDayDish: 20,
  /** per plate of one dish beyond 3, and again beyond 5, in a person's plan */
  weekDishOver3: 3,
  weekDishOver5: 4,
  proteinRepeat: 25,
  sessionMinute: 2,
  budgetDollar: 1,
  slotMismatch: 25,
  cuisineExtra: 3,
  freezerPlate: 1.5,
  noReheatPlate: 1,
  /** each extra dish is more shopping, pans and washing up */
  dish: 2,
  /** each adjuster on a plate (rounding pass only): no 5 g drizzles */
  adjusterItem: 1.5,
  // adjusters cost a little per gram and per kcal, so a plate isn't
  // fine-tuned with drizzles of oil when the dish portion can do the job
  adjusterGram: 0.01,
  adjusterKcal: 0.003,
  /** per 1% of a plate's aim outside ±25%, and again below 60% */
  plateOut: 3,
  plateFloor: 10,
  /** a dish needing an appliance the kitchen lacks: given up only after the bands */
  missingAppliance: 1500,
  /** a dish that would be easier with a blender, mixer or food processor */
  missingSoftAppliance: 8,
  /** per quarter serving away from the person's usual portion */
  portionOffUsual: 0.4,
  lowConfidencePlate: 0.6,
  mediumConfidencePlate: 0.2,
  // macro penalties, per 1% outside the band: large enough that variety
  // preferences never push a day out of its band when the pool can avoid it
  kcalUnder: 60,
  kcalOver: 80,
  kcalOffAim: 0.15,
  proteinShort: 80,
  carbFatOut: 40,
  // objective terms scaled by PlanWeights (sized for the default weights)
  preferenceScale: 2,
  costDollar: 0.75,
  handsOnMinute: 0.13,
  wasteServing: 6.5,
  /**
   * per plate for a wish bonus of 1 (recipeBonus is ±1 from the API), plus a
   * one-off amount per dish: a bit more than a favorite is worth, so a wish tips
   * close calls without overriding macros or allergies
   */
  wishPlate: 2,
  wishDish: 4,
  overlapShared: 0.4,
};

export interface Occasion {
  idx: number;
  personIdx: number;
  day: number;
  slot: MealSlot;
}

export interface Aim {
  /** the slice of the day the prep covers, already scaled */
  targets: MacroTargets;
  tol: Record<MacroKey, number>;
  share: number;
}

export interface PlateVar {
  occ: number;
  recipeIdx: number;
  x: string;
  /** quarter servings, or null when fixed at one serving (no targets) */
  n: string | null;
  keeping: Keeping;
  mismatch: boolean;
}

export interface Prepared {
  setup: PrepSetup;
  weights: PlanWeights;
  recipes: RecipeFacts[];
  adjusters: Adjuster[];
  people: PrepPerson[];
  aims: Array<Aim | null>;
  /** words to exclude per person */
  words: string[][];
  /** per person: may eat recipe i */
  allowed: boolean[][];
  /** per person: may use adjuster j */
  adjAllowed: boolean[][];
  occasions: Occasion[];
  maxDishes: number;
  maxRepeats: Record<MealSlot, number>;
  pinned: Set<string>;
  /** cook exactly maxDishes (swap), rather than at most */
  exactDishes: boolean;
  /** facts gathered while preparing, for notes */
  notes: string[];
  relaxed: string[];
  thinSlots: MealSlot[];
  /** share of a day's targets per slot */
  share: Record<MealSlot, number>;
  sessionTimeFactor: number;
}

export interface PrepareOptions {
  weights?: PlanWeights;
  slotShare?: Record<MealSlot, number>;
  /** recipes that must be cooked (used by swap), on top of setup.pinnedRecipeIds */
  forceRecipes?: string[];
  /** cook exactly this many dishes (swap) */
  dishCount?: number;
  /** multiplies the session-time estimate (1 = the calibrated model) */
  sessionTimeFactor?: number;
}

function macroOf(r: RecipeFacts, m: MacroKey): number {
  const v = r.perServing[m];
  return Number.isFinite(v) ? v : 0;
}

function usable(r: RecipeFacts): boolean {
  return r.servings > 0 && Number.isFinite(r.perServing.kcal) && r.perServing.kcal >= 0;
}

export function personSlots(p: PrepPerson): MealSlot[] {
  return SLOT_ORDER.filter((s) => p.slots.includes(s));
}

export function aimFor(p: PrepPerson, share: Record<MealSlot, number>): Aim | null {
  const t = p.targets;
  if (!t || !(t.kcal > 0)) return null;
  const slots = personSlots(p);
  const f = Math.min(1, slots.reduce((a, s) => a + share[s], 0)) || 1;
  const tol = { ...DEFAULT_TOL, ...(t.tolerance ?? {}) } as Record<MacroKey, number>;
  return {
    share: f,
    tol,
    targets: {
      kcal: t.kcal * f,
      protein: (t.protein ?? 0) * f,
      carbs: t.carbs != null ? t.carbs * f : undefined,
      fat: t.fat != null ? t.fat * f : undefined,
      tolerance: tol,
    },
  };
}

/** Applies the hard filters and narrows the pool to the most promising recipes. */
export function prepare(setup: PrepSetup, facts: RecipeFacts[], adjusters: Adjuster[], opts: PrepareOptions = {}): Prepared {
  const notes: string[] = [];
  const relaxed: string[] = [];
  const weights = { ...DEFAULT_WEIGHTS, ...(opts.weights ?? {}) };
  const share = opts.slotShare ?? DEFAULT_SLOT_SHARE;
  const people = setup.people.filter((p) => personSlots(p).length > 0);
  const words = people.map(personWords);
  const pinned = new Set([...(setup.pinnedRecipeIds ?? []), ...(opts.forceRecipes ?? [])]);
  const excluded = new Set(setup.excludedRecipeIds ?? []);
  const poolIds = setup.recipePool?.length ? new Set(setup.recipePool) : null;

  let pool = facts.filter((r) => usable(r) && !excluded.has(r.recipeId) && (!poolIds || poolIds.has(r.recipeId) || pinned.has(r.recipeId)));

  // Who can eat what. A recipe nobody can eat is dropped.
  const allowedById = new Map<string, boolean[]>();
  for (const r of pool) {
    const row = people.map((p, i) => {
      const hit = matchExclusion(r, words[i]);
      if (hit && pinned.has(r.recipeId)) relaxed.push(`${r.title} was asked for, but ${p.name} can't have it (${hit}), so it's left off ${p.name}'s plates.`);
      return !hit;
    });
    allowedById.set(r.recipeId, row);
  }
  const before = pool.length;
  pool = pool.filter((r) => allowedById.get(r.recipeId)!.some(Boolean));
  if (before > pool.length) notes.push(`${before - pool.length} recipes were left out because of allergies or dislikes.`);
  for (const id of Array.from(pinned)) {
    if (!pool.some((r) => r.recipeId === id)) {
      const f = facts.find((r) => r.recipeId === id);
      if (f) relaxed.push(`${f.title} was asked for, but no one in the plan can have it.`);
      pinned.delete(id);
    }
  }

  // The same dish saved twice (same title) counts once, so repeats and
  // variety see it as one dish. Keep the copy we know best.
  const rankCopy = (r: RecipeFacts) =>
    (pinned.has(r.recipeId) ? 100 : 0) + (r.preference.favorite ? 10 : 0) + ({ high: 3, medium: 2, low: 1 }[r.confidence]) + (r.preference.rating ?? 0) / 10;
  const byTitle = new Map<string, RecipeFacts>();
  for (const r of pool) {
    const key = r.title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const cur = byTitle.get(key);
    if (!cur || rankCopy(r) > rankCopy(cur)) byTitle.set(key, r);
  }
  if (byTitle.size < pool.length) {
    const keep = new Set(Array.from(byTitle.values()).map((r) => r.recipeId));
    pool = pool.filter((r) => keep.has(r.recipeId));
  }

  // Slots with too few suitable recipes may borrow other dishes, with a penalty.
  const usedSlots = Array.from(new Set(people.flatMap(personSlots)));
  const thinSlots = usedSlots.filter((s) => pool.filter((r) => suitsSlot(r, s)).length < 2);

  // Rank and cap the pool so the model stays small enough to solve in seconds.
  const aims = people.map((p) => aimFor(p, share));
  const pool2 = capPool(pool, aims, usedSlots, pinned, setup);

  const allowed = people.map((_, i) => pool2.map((r) => allowedById.get(r.recipeId)![i]));
  const adjAllowed = people.map((_, i) => adjusters.map((a) => !adjusterExcluded(a, words[i])));

  const occasions: Occasion[] = [];
  people.forEach((p, pi) => {
    for (let d = 0; d < setup.days; d++) for (const s of personSlots(p)) occasions.push({ idx: occasions.length, personIdx: pi, day: d, slot: s });
  });

  const perPerson = Math.max(...people.map((p) => personSlots(p).length * setup.days), 0);
  let maxDishes = setup.maxDishes ?? (perPerson >= 10 ? 5 : 4);
  if (opts.dishCount != null) maxDishes = opts.dishCount;
  if (pinned.size > maxDishes) {
    relaxed.push(`${pinned.size} dishes were asked for, more than the ${maxDishes}-dish limit, so the plan cooks ${pinned.size}.`);
    maxDishes = pinned.size;
  }

  return {
    setup, weights, recipes: pool2, adjusters, people, aims, words, allowed, adjAllowed, occasions,
    maxDishes, maxRepeats: { ...DEFAULT_REPEATS, ...(setup.maxRepeats ?? {}) } as Record<MealSlot, number>,
    pinned, exactDishes: opts.dishCount != null, notes, relaxed, thinSlots, share, sessionTimeFactor: opts.sessionTimeFactor ?? 1,
  };
}

function capPool(pool: RecipeFacts[], aims: Array<Aim | null>, slots: MealSlot[], pinned: Set<string>, setup: PrepSetup): RecipeFacts[] {
  if (pool.length <= MAX_CANDIDATES) return pool;
  const withAim = aims.filter((a): a is Aim => !!a);
  // protein share of calories the people with targets are aiming for
  const aimProteinShare = withAim.length
    ? withAim.reduce((a, t) => a + (4 * t.targets.protein) / t.targets.kcal, 0) / withAim.length
    : 0.2;
  const score = (r: RecipeFacts) => {
    const kcal = Math.max(1, macroOf(r, "kcal"));
    const pShare = (4 * macroOf(r, "protein")) / kcal;
    let s = (r.preference.rating ?? 3) + (r.preference.favorite ? 2 : 0);
    s -= Math.abs(pShare - aimProteinShare) * 8;
    s += r.confidence === "high" ? 0.5 : r.confidence === "low" ? -0.5 : 0;
    if (setup.budget && r.cost != null) s -= r.cost / Math.max(1, r.servings) / 3;
    return s;
  };
  const ranked = pool.slice().sort((a, b) => score(b) - score(a));
  const chosen = new Set<string>(Array.from(pinned));
  // Make sure every slot keeps a fair choice of fitting recipes.
  const perSlot = Math.max(4, Math.floor(MAX_CANDIDATES / Math.max(1, slots.length)));
  for (const s of slots) {
    let n = 0;
    for (const r of ranked) {
      if (n >= perSlot) break;
      if (suitsSlot(r, s)) {
        chosen.add(r.recipeId);
        n++;
      }
    }
  }
  for (const r of ranked) {
    if (chosen.size >= MAX_CANDIDATES) break;
    chosen.add(r.recipeId);
  }
  return pool.filter((r) => chosen.has(r.recipeId));
}

// ---------------------------------------------------------------------------

export interface DayMacroVars {
  personIdx: number;
  day: number;
  /** grams of adjuster j on the plate for occasion occ */
  adj: Array<{ occ: number; j: number; v: string }>;
}

export interface Built {
  lp: LpModel;
  y: string[];
  /** b[recipe][scaleIdx] */
  b: string[][];
  plates: PlateVar[];
  /** occasion idx -> slack var for "no plate" */
  miss: string[];
  days: DayMacroVars[];
  /** slack below 60% of a plate's aim, for the explanation */
  plateFloors: Array<{ v: string; occ: number; aim: number }>;
  /** chosen dishes that need an appliance the kitchen doesn't list */
  equipment: Array<{ recipeIdx: number; missing: string[]; soft: boolean }>;
  slack: {
    repeats: Array<{ v: string; personIdx: number; slot: MealSlot; recipeIdx: number; limit: number }>;
    protein: Array<{ v: string; personIdx: number; slot: MealSlot; day: number; protein: string }>;
    sameDay: Array<{ v: string; personIdx: number; day: number; recipeIdx: number }>;
    sessionMinutes: string | null;
    budget: string | null;
  };
  sessionCap: number;
  activeFor: (recipeIdx: number, scale: number) => number;
  /** estimated hands-on minutes for the whole session, given the plates */
  sessionMinutes: (batches: Array<{ recipeIdx: number; scale: number }>, plates: number) => number;
}

/** a plate within ±25% of its meal's share of the day's aim is balanced */
export const PLATE_BAND = 0.25;
/** below 60% of its share, a plate is too small to be a meal */
export const PLATE_FLOOR = 0.6;

/** calories one plate should carry: the meal's share of the person's prep aim */
export function plateAim(aim: Aim, person: PrepPerson, slot: MealSlot, share: Record<MealSlot, number> = DEFAULT_SLOT_SHARE): number {
  const total = personSlots(person).reduce((a, s) => a + share[s], 0) || 1;
  return (aim.targets.kcal * share[slot]) / total;
}

/** objective cost of one gram of an adjuster */
export function adjusterCost(a: Adjuster): number {
  return PEN.adjusterGram + PEN.adjusterKcal * (a.perGram.kcal ?? 0);
}

/**
 * A person's usual portion, in quarter servings: roughly what a typical dish
 * needs to reach their per-meal calories. Plates stay near it so portions
 * don't swing from half to double day to day.
 */
export function usualQuarters(aim: Aim, slots: number, recipes: RecipeFacts[]): number {
  const kcals = recipes.map((r) => macroOf(r, "kcal")).filter((k) => k > 0).sort((a, b) => a - b);
  const median = kcals.length ? kcals[Math.floor(kcals.length / 2)] : 450;
  const q = Math.round(((aim.targets.kcal / Math.max(1, slots)) / median) * 4);
  return Math.min(MAX_QUARTERS, Math.max(MIN_QUARTERS, q));
}

function isMeal(r: RecipeFacts): boolean {
  return (["breakfast", "lunch", "dinner"] as MealSlot[]).some((s) => suitsSlot(r, s));
}

/** Hands-on minutes one batch adds to a session (before the skill factor). */
export function handsOnMinutes(r: RecipeFacts, scale: number): number {
  const M = SESSION_MODEL;
  return (M.perDish + M.perActiveMinute * r.activeMinutes + M.perLine * r.lines.length) * (M.batchBase + M.batchSlope * scale);
}

const SKILL_FACTOR = { beginner: 1.3, home: 1, pro: 0.85 } as const;

/** canonical ingredients worth counting as shared shopping/prep (not salt or oil) */
function overlapIds(r: RecipeFacts): Set<string> {
  const skip = new Set(["Spices & Seasonings", "Oils, Vinegars & Condiments", "Baking", "Beverages"]);
  const ids = new Set<string>();
  for (const l of r.lines) if (l.ingredient && !skip.has(l.ingredient.aisle) && !/^(water|salt|pepper)/.test(l.ingredient.id)) ids.add(l.ingredient.id);
  return ids;
}

export function buildModel(P: Prepared): Built {
  const { setup, weights: W, recipes: R, occasions } = P;
  const lp = new LpModel();
  const nR = R.length;

  // --- dishes and batches
  const wish = (id: string) => Math.max(-3, Math.min(3, W.recipeBonus?.[id] ?? 0));
  // appliances the kitchen has (any spelling: "Instant Pot", "pressure cooker")
  const have = new Set(setup.kitchen.appliances.filter((a) => a.count > 0).map((a) => normalizeAppliance(a.kind)).filter(Boolean) as string[]);
  const equipment: Built["equipment"] = [];
  const y = R.map((r, i) => {
    const missing = (r.equipment ?? []).filter((k) => !have.has(k));
    const hard = missing.filter((k) => !SOFT_APPLIANCES.has(k));
    if (missing.length) equipment.push({ recipeIdx: i, missing, soft: !hard.length });
    const appliancePenalty = hard.length ? PEN.missingAppliance : missing.length ? PEN.missingSoftAppliance : 0;
    return lp.addVar({ type: "B", lb: P.pinned.has(r.recipeId) ? 1 : 0, obj: PEN.dish - PEN.wishDish * wish(r.recipeId) + appliancePenalty });
  });
  const skill = SKILL_FACTOR[setup.session.skill] ?? 1;
  const activeFor = (i: number, k: number) => handsOnMinutes(R[i], k) * skill * P.sessionTimeFactor;
  const b = R.map((r, i) =>
    SCALES.map((k) => {
      const cost = r.cost != null ? r.cost * k * W.cost * PEN.costDollar : 0;
      const hands = activeFor(i, k) * W.handsOn * PEN.handsOnMinute;
      const waste = k * r.servings * W.waste * PEN.wasteServing; // minus servings eaten, below
      return lp.addVar({ type: "B", obj: cost + hands + waste });
    }),
  );
  R.forEach((_, i) => lp.addRow([...b[i].map((v): Term => [v, 1]), [y[i], -1]], "=", 0));
  lp.addRow(y.map((v): Term => [v, 1]), P.exactDishes ? "=" : "<=", P.maxDishes);

  // --- plates
  const freezerOk = setup.kitchen.freezerSpace !== "none";
  const plates: PlateVar[] = [];
  const platesByOcc: PlateVar[][] = occasions.map(() => []);
  const servedTerms: Term[][] = R.map(() => []);
  for (const o of occasions) {
    const hasAim = !!P.aims[o.personIdx];
    const age = ageOnDay(setup, o.day);
    R.forEach((r, i) => {
      if (!P.allowed[o.personIdx][i]) return;
      const keeping = keepingFor(r.storage, age, freezerOk);
      if (keeping === "no") return;
      const fits = suitsSlot(r, o.slot);
      // a thin slot may borrow a real meal from another slot, never a rub or a side
      if (!fits && !(P.thinSlots.includes(o.slot) && isMeal(r))) return;
      const pref = r.preference;
      let obj = -W.preference * PEN.preferenceScale * (0.4 * ((pref.rating ?? 3) - 3) + (pref.favorite ? 0.8 : 0));
      obj -= PEN.wishPlate * wish(r.recipeId);
      if (!fits) obj += PEN.slotMismatch;
      if (keeping === "freezer") obj += PEN.freezerPlate;
      if (!r.storage.reheatsWell && age >= 1) obj += PEN.noReheatPlate;
      if (r.confidence === "low") obj += PEN.lowConfidencePlate;
      else if (r.confidence === "medium") obj += PEN.mediumConfidencePlate;
      const x = lp.addVar({ type: "B", obj });
      lp.addRow([[x, 1], [y[i], -1]], "<=", 0);
      let n: string | null = null;
      if (hasAim) {
        n = lp.addVar({ type: "I", lb: 0, ub: MAX_QUARTERS, obj: (-W.waste * PEN.wasteServing) / 4 });
        lp.addRow([[n, 1], [x, -MIN_QUARTERS]], ">=", 0);
        lp.addRow([[n, 1], [x, -MAX_QUARTERS]], "<=", 0);
        servedTerms[i].push([n, 0.25]);
      } else {
        lp.addObj(x, -W.waste * PEN.wasteServing);
        servedTerms[i].push([x, 1]);
      }
      const pv: PlateVar = { occ: o.idx, recipeIdx: i, x, n, keeping, mismatch: !fits };
      plates.push(pv);
      platesByOcc[o.idx].push(pv);
    });
  }
  // one dish per plate (or a costly "no plate")
  const miss = occasions.map((o) => {
    const m = lp.addVar({ lb: 0, ub: 1, obj: PEN.missingPlate });
    lp.addRow([...platesByOcc[o.idx].map((p): Term => [p.x, 1]), [m, 1]], "=", 1);
    return m;
  });
  // keep portions near the person's usual size
  const usual = P.people.map((p, pi) => (P.aims[pi] ? usualQuarters(P.aims[pi]!, personSlots(p).length, R) : 4));
  for (const o of occasions) {
    const ps = platesByOcc[o.idx].filter((p) => p.n);
    if (!ps.length) continue;
    const up = lp.addVar({ obj: PEN.portionOffUsual });
    const down = lp.addVar({ obj: PEN.portionOffUsual });
    lp.addRow([...ps.map((p): Term => [p.n!, 1]), ...ps.map((p): Term => [p.x, -usual[o.personIdx]]), [up, -1], [down, 1]], "=", 0);
  }
  // servings eaten ≤ servings made
  R.forEach((r, i) => {
    lp.addRow([...servedTerms[i], ...SCALES.map((k, s): Term => [b[i][s], -k * r.servings])], "<=", 0);
  });

  // --- freezer room
  const freezerPlates = plates.filter((p) => p.keeping === "freezer");
  const freezerCap = setup.kitchen.freezerSpace === "some" ? 10 : Infinity;
  if (freezerPlates.length && Number.isFinite(freezerCap)) lp.addRow(freezerPlates.map((p): Term => [p.x, 1]), "<=", freezerCap);

  // --- repeats per person, slot and dish
  const slack: Built["slack"] = { repeats: [], protein: [], sameDay: [], sessionMinutes: null, budget: null };
  P.people.forEach((_, pi) => {
    for (const slot of personSlots(P.people[pi])) {
      const limit = P.maxRepeats[slot];
      if (limit >= setup.days) continue;
      for (let i = 0; i < nR; i++) {
        const xs = plates.filter((p) => p.recipeIdx === i && occasions[p.occ].personIdx === pi && occasions[p.occ].slot === slot);
        if (xs.length <= limit) continue;
        const v = lp.addVar({ obj: PEN.repeat });
        lp.addRow([...xs.map((p): Term => [p.x, 1]), [v, -1]], "<=", limit);
        slack.repeats.push({ v, personIdx: pi, slot, recipeIdx: i, limit });
      }
    }
  });

  // --- variety within a person's plan: not the same dish twice in a day, and
  // a growing cost for eating one dish many times across the week
  P.people.forEach((_, pi) => {
    for (let i = 0; i < nR; i++) {
      const mine = plates.filter((p) => p.recipeIdx === i && occasions[p.occ].personIdx === pi);
      for (let d = 0; d < setup.days; d++) {
        const xs = mine.filter((p) => occasions[p.occ].day === d);
        if (xs.length < 2) continue;
        const v = lp.addVar({ obj: PEN.sameDayDish });
        lp.addRow([...xs.map((p): Term => [p.x, 1]), [v, -1]], "<=", 1);
        slack.sameDay.push({ v, personIdx: pi, day: d, recipeIdx: i });
      }
      for (const [over, pen] of [[3, PEN.weekDishOver3], [5, PEN.weekDishOver5]] as const) {
        if (mine.length <= over) continue;
        const e = lp.addVar({ obj: pen });
        lp.addRow([...mine.map((p): Term => [p.x, 1]), [e, -1]], "<=", over);
      }
    }
  });

  // --- same main protein from different dishes on back-to-back days (same meal)
  const plateAt = new Map<string, PlateVar>(); // `${occ}:${recipe}`
  plates.forEach((p) => plateAt.set(`${p.occ}:${p.recipeIdx}`, p));
  const occAt = new Map<string, number>(); // `${person}:${day}:${slot}`
  occasions.forEach((o) => occAt.set(`${o.personIdx}:${o.day}:${o.slot}`, o.idx));
  const proteins = new Map<string, number[]>();
  R.forEach((r, i) => {
    if (!r.mainProtein) return;
    const g = r.mainProtein.toLowerCase();
    proteins.set(g, [...(proteins.get(g) ?? []), i]);
  });
  for (const [g, members] of Array.from(proteins)) {
    if (members.length < 2) continue; // one dish per protein is a repeat, not this rule
    for (const o of occasions) {
      const next = occAt.get(`${o.personIdx}:${o.day + 1}:${o.slot}`);
      if (next == null) continue;
      const a = members.map((i) => plateAt.get(`${o.idx}:${i}`)).filter(Boolean) as PlateVar[];
      const c = members.map((i) => plateAt.get(`${next}:${i}`)).filter(Boolean) as PlateVar[];
      if (!a.length || !c.length || new Set([...a, ...c].map((p) => p.recipeIdx)).size < 2) continue;
      const w = lp.addVar({ obj: PEN.proteinRepeat });
      const terms: Term[] = [...a.map((p): Term => [p.x, 1]), ...c.map((p): Term => [p.x, 1]), [w, -1]];
      // the same dish two days running is fine here (repeats are limited above)
      for (const p of a) {
        const q = c.find((cc) => cc.recipeIdx === p.recipeIdx);
        if (!q) continue;
        const t = lp.addVar({ lb: 0, ub: 1 });
        lp.addRow([[t, 1], [p.x, -1]], "<=", 0);
        lp.addRow([[t, 1], [q.x, -1]], "<=", 0);
        terms.push([t, -1]);
      }
      lp.addRow(terms, "<=", 1);
      slack.protein.push({ v: w, personIdx: o.personIdx, slot: o.slot, day: o.day, protein: g });
    }
  }

  // --- spread cuisines: each extra dish of the same cuisine costs a little
  const cuisines = new Map<string, number[]>();
  R.forEach((r, i) => r.cuisines.forEach((c) => {
    const k = c.toLowerCase();
    cuisines.set(k, [...(cuisines.get(k) ?? []), i]);
  }));
  for (const [, members] of Array.from(cuisines)) {
    if (members.length < 2) continue;
    const e = lp.addVar({ obj: PEN.cuisineExtra });
    lp.addRow([...members.map((i): Term => [y[i], 1]), [e, -1]], "<=", 1);
  }

  // --- shared ingredients between chosen dishes make shopping and prep easier
  const ov = R.map(overlapIds);
  for (let i = 0; i < nR; i++) for (let j = i + 1; j < nR; j++) {
    let shared = 0;
    for (const id of Array.from(ov[i])) if (ov[j].has(id)) shared++;
    if (shared < 1) continue;
    const z = lp.addVar({ lb: 0, ub: 1, obj: -PEN.overlapShared * Math.min(shared, 5) });
    lp.addRow([[z, 1], [y[i], -1]], "<=", 0);
    lp.addRow([[z, 1], [y[j], -1]], "<=", 0);
  }

  // --- session time (hands-on minutes as a proxy for the real schedule)
  const cooks = Math.max(1, setup.session.cooks || 1);
  // a second cook helps, but not twice over (shared oven, waiting on each other)
  const M = SESSION_MODEL;
  const sessionCap = (setup.session.maxMinutes || 240) * (1 + M.secondCook * (cooks - 1)) * M.handsOnShare;
  const timeTerms: Term[] = [];
  R.forEach((_, i) => SCALES.forEach((k, s) => timeTerms.push([b[i][s], activeFor(i, k)])));
  plates.forEach((p) => timeTerms.push([p.x, M.perPlate * skill * P.sessionTimeFactor]));
  slack.sessionMinutes = lp.addVar({ obj: PEN.sessionMinute });
  lp.addRow([...timeTerms, [slack.sessionMinutes, -1]], "<=", sessionCap - M.session * skill * P.sessionTimeFactor);

  // --- budget (recipes with unknown cost count as free)
  if (setup.budget && setup.budget > 0) {
    const costTerms: Term[] = [];
    R.forEach((r, i) => r.cost != null && SCALES.forEach((k, s) => costTerms.push([b[i][s], r.cost! * k])));
    if (costTerms.length) {
      slack.budget = lp.addVar({ obj: PEN.budgetDollar });
      lp.addRow([...costTerms, [slack.budget, -1]], "<=", setup.budget);
    }
  }

  // --- macros per person-day
  const days: DayMacroVars[] = [];
  const plateFloors: Built["plateFloors"] = [];
  P.people.forEach((person, pi) => {
    const aim = P.aims[pi];
    if (!aim) return;
    const slots = personSlots(person);
    for (let d = 0; d < setup.days; d++) {
      const age = ageOnDay(setup, d);
      const dayPlates = plates.filter((p) => occasions[p.occ].personIdx === pi && occasions[p.occ].day === d);
      // adjusters belong to a plate (so each plate can be balanced), and only
      // to a plate that has a dish on it
      const adj: DayMacroVars["adj"] = [];
      for (const o of occasions) {
        if (o.personIdx !== pi || o.day !== d) continue;
        const xs = plates.filter((p) => p.occ === o.idx);
        if (!xs.length) continue;
        P.adjusters.forEach((a, j) => {
          if (!P.adjAllowed[pi][j] || !a.slots.includes(o.slot)) return;
          if (keepingFor(a.storage, age, freezerOk) === "no") return;
          const v = lp.addVar({ lb: 0, ub: a.maxGrams, obj: adjusterCost(a) * W.macro });
          lp.addRow([[v, 1], ...xs.map((p): Term => [p.x, -a.maxGrams])], "<=", 0);
          adj.push({ occ: o.idx, j, v });
        });
      }
      days.push({ personIdx: pi, day: d, adj });

      const amount = (m: MacroKey): Term[] => {
        const t: Term[] = dayPlates.map((p) => [p.n!, macroOf(R[p.recipeIdx], m) / 4]);
        adj.forEach(({ j, v }) => t.push([v, P.adjusters[j].perGram[m] ?? 0]));
        return t;
      };

      // each plate near its meal's share of the day, so lunch isn't 1,200 kcal
      // and dinner 200: a soft ±25% band, and a firmer floor at 60%
      for (const o of occasions) {
        if (o.personIdx !== pi || o.day !== d) continue;
        const xs = dayPlates.filter((p) => p.occ === o.idx);
        if (!xs.length) continue;
        const T = plateAim(aim, person, o.slot, P.share);
        const kc: Term[] = [
          ...xs.map((p): Term => [p.n!, macroOf(R[p.recipeIdx], "kcal") / 4]),
          ...adj.filter((a) => a.occ === o.idx).map(({ j, v }): Term => [v, P.adjusters[j].perGram.kcal ?? 0]),
        ];
        const pctP = (100 / Math.max(T, 1)) * W.macro;
        const lo = lp.addVar({ obj: PEN.plateOut * pctP });
        const hi = lp.addVar({ obj: PEN.plateOut * pctP });
        const floor = lp.addVar({ obj: PEN.plateFloor * pctP });
        lp.addRow([...kc, ...xs.map((p): Term => [p.x, -T * (1 - PLATE_BAND)]), [lo, 1]], ">=", 0);
        lp.addRow([...kc, ...xs.map((p): Term => [p.x, -T * (1 + PLATE_BAND)]), [hi, -1]], "<=", 0);
        lp.addRow([...kc, ...xs.map((p): Term => [p.x, -T * PLATE_FLOOR]), [floor, 1]], ">=", 0);
        plateFloors.push({ v: floor, occ: o.idx, aim: T });
      }
      const widen = (m: MacroKey): Term[] =>
        dayPlates.map((p) => [p.n!, (CONFIDENCE_WIDEN[R[p.recipeIdx].confidence] * macroOf(R[p.recipeIdx], m)) / 4]);
      const pct = (target: number) => (100 / Math.max(target, 1)) * W.macro;

      // calories: inside the band, and close to the aim
      const K = aim.targets.kcal;
      const tolK = aim.tol.kcal;
      const uk = lp.addVar({ obj: PEN.kcalUnder * pct(K) });
      const ok = lp.addVar({ obj: PEN.kcalOver * pct(K) });
      lp.addRow([...amount("kcal"), ...widen("kcal"), [uk, 1]], ">=", K * (1 - tolK));
      lp.addRow([...amount("kcal"), ...widen("kcal").map(([v, c]): Term => [v, -c]), [ok, -1]], "<=", K * (1 + tolK));
      const dp = lp.addVar({ obj: PEN.kcalOffAim * pct(K) });
      const dn = lp.addVar({ obj: PEN.kcalOffAim * pct(K) });
      lp.addRow([...amount("kcal"), [dp, -1], [dn, 1]], "=", K);

      // protein is a floor
      const Pt = aim.targets.protein;
      if (Pt > 0) {
        const up = lp.addVar({ obj: PEN.proteinShort * pct(Pt) });
        lp.addRow([...amount("protein"), ...widen("protein"), [up, 1]], ">=", Pt * (1 - aim.tol.protein));
      }
      for (const m of ["carbs", "fat"] as const) {
        const T = aim.targets[m];
        if (T == null || !(T > 0)) continue;
        const u = lp.addVar({ obj: PEN.carbFatOut * pct(T) });
        const o = lp.addVar({ obj: PEN.carbFatOut * pct(T) });
        lp.addRow([...amount(m), ...widen(m), [u, 1]], ">=", T * (1 - aim.tol[m]));
        lp.addRow([...amount(m), ...widen(m).map(([v, c]): Term => [v, -c]), [o, -1]], "<=", T * (1 + aim.tol[m]));
      }
    }
  });

  const sessionMinutes = (bs: Array<{ recipeIdx: number; scale: number }>, n: number) =>
    bs.reduce((a, x) => a + activeFor(x.recipeIdx, x.scale), 0) + (M.session + M.perPlate * n) * skill * P.sessionTimeFactor;
  return { lp, y, b, plates, miss, days, plateFloors, equipment, slack, sessionCap, activeFor, sessionMinutes };
}
