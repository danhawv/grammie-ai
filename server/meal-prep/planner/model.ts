// Turns a prep setup into one mixed-integer model:
//   - which recipes to cook and how many batches (0.5x … 3x), at most maxDishes
//   - which recipe goes on each person's plate for each day and meal, and how
//     many servings (0.5 … 2 in quarter steps)
//   - grams of simple adjusters (rice, chicken, yogurt) per plate, and whole
//     bottles of a protein shake
//   - which of a recipe's own ingredient swaps to use for a whole batch
// Hard rules: allergies/dislikes, shelf life, servings eaten ≤ servings made,
// pinned/excluded dishes, dish count. Everything else is a penalty, so the
// solver always returns a plan and we can say which limit gave way. Penalty
// sizes put the limits in the agreed order of giving way: repeats first, then
// protein variety, then session time, then the macro bands.
//
// Levers for hitting the macro bands, cheapest first (the owner's order):
// portions, then a recipe's own swaps, then picking higher-protein / lighter
// recipes, then plain top-ups (extra chicken, a shake) last.

import type {
  Adjuster, IngredientSwap, MacroKey, MacroTargets, MealSlot, PlanWeights, PrepPerson, PrepSetup, RecipeFacts,
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
/** desserts go from half to one and a half servings */
export const MAX_DESSERT_QUARTERS = 6;
export const SLOT_ORDER: MealSlot[] = ["breakfast", "lunch", "dinner", "snack", "dessert"];
const MEAL_SLOTS: MealSlot[] = ["breakfast", "lunch", "dinner", "snack"];

export function maxQuarters(slot: MealSlot): number {
  return slot === "dessert" ? MAX_DESSERT_QUARTERS : MAX_QUARTERS;
}

/**
 * Daily targets are for the whole day; the prep only covers some meals. We aim
 * each person's prep plates at this share of the day for the slots they eat
 * from the prep (all four slots = the whole day). When a person also has
 * dessert, it takes its share and the other slots shrink to make room (see
 * shareFor), so the day as a whole stays the same.
 */
export const DEFAULT_SLOT_SHARE: Record<MealSlot, number> = {
  breakfast: 0.25,
  lunch: 0.3,
  dinner: 0.35,
  snack: 0.1,
  dessert: 0.1,
};

/** Same values the API sends (DEFAULT_PLAN_WEIGHTS), used when weights are undefined. */
export const DEFAULT_WEIGHTS: PlanWeights = { macro: 1, preference: 0.5, cost: 0.2, handsOn: 0.3, waste: 0.3 };
export const DEFAULT_REPEATS: Record<MealSlot, number> = { breakfast: 7, lunch: 4, dinner: 2, snack: 7, dessert: 7 };
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
  /** one dish over the default dish limit (only when the person didn't set one) */
  extraDish: 18,
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
  // --- the levers, in the owner's order: a quarter-serving portion change
  // costs portionOffUsual (0.4); a swap costs this once per batch (more when
  // we're less sure of its numbers); top-ups cost per gram / per bottle, so
  // that protein from a swap used on a few plates is cheaper than the same
  // protein from extra chicken or a shake
  swap: 3,
  swapMedium: 1.5,
  swapLow: 5,
  /** extra cost per gram of a side (rice, veg, yogurt…) and, more, of a plain chicken top-up */
  sideGram: 0.02,
  topUpGram: 0.05,
  /** cost of one bottled shake on a plate */
  shakeBottle: 7,
  /** plan options: reward per 1% of protein above the floor (protein option, up to 20%) */
  proteinAbove: 0,
};

export type Penalties = typeof PEN;

/** The plan options the planner can offer side by side. */
export type PlanMode = "balanced" | "protein" | "variety" | "quick";

/** How each option leans, as changes to the penalties and weights. */
export function modeTuning(mode: PlanMode, weights: PlanWeights): { pen: Penalties; weights: PlanWeights } {
  const pen = { ...PEN };
  const w = { ...weights };
  if (mode === "protein") {
    pen.proteinShort *= 1.5;
    pen.proteinAbove = 6;
    pen.swap *= 0.5;
    pen.swapMedium *= 0.5;
  } else if (mode === "variety") {
    pen.repeat *= 2;
    pen.weekDishOver3 *= 3;
    pen.weekDishOver5 *= 2;
    pen.proteinRepeat *= 1.5;
    pen.dish = -8; // each distinct dish is now a plus
  } else if (mode === "quick") {
    w.handsOn = Math.max(w.handsOn, 0.3) * 4;
    pen.dish *= 5;
    pen.sessionMinute *= 2;
  }
  return { pen, weights: w };
}

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
  /** this person's share of the day per slot, and the total over the slots counted */
  slotShare: Record<MealSlot, number>;
  slotTotal: number;
}

/** A recipe swap the model may use for a whole batch. */
export interface SwapChoice {
  recipeIdx: number;
  swap: IngredientSwap;
  /** objective cost of using it */
  cost: number;
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
  /** per person: the aim for a full day of their slots (with dessert, if they have it) */
  aims: Array<Aim | null>;
  /** per person and day: the aim for the slots actually planned that day */
  dayAims: Array<Array<Aim | null>>;
  /** per person: the days that get a dessert plate */
  dessertDays: Array<Set<number>>;
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
  /**
   * the dish limit is our default, not the person's: one more dish may be
   * cooked rather than serve the same dish twice in a day
   */
  softDishLimit: boolean;
  /** cook exactly maxDishes (swap), rather than at most */
  exactDishes: boolean;
  /** facts gathered while preparing, for notes */
  notes: string[];
  relaxed: string[];
  thinSlots: MealSlot[];
  /** share of a day's targets per slot */
  share: Record<MealSlot, number>;
  sessionTimeFactor: number;
  /** penalties, after the plan option's tuning */
  pen: Penalties;
  /** usable recipe swaps (empty when swaps are off) */
  swaps: SwapChoice[];
  /** dish sets earlier plan options used: keep at least `drop` of each out */
  cuts: Array<{ ids: string[]; drop: number }>;
  /** the bottled shake the plan uses, if any */
  shakeIdx: number | null;
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
  /** which plan option to lean toward (default balanced) */
  mode?: PlanMode;
  /** dish sets to differ from (plan options) */
  cuts?: Array<{ ids: string[]; drop: number }>;
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

/**
 * A person's share of the day per slot. Dessert keeps its share (about 10%);
 * when the person's meals plus dessert would come to more than the whole day,
 * the meals shrink so they still add up to one day.
 */
export function shareFor(p: PrepPerson, base: Record<MealSlot, number> = DEFAULT_SLOT_SHARE): Record<MealSlot, number> {
  const out = { ...DEFAULT_SLOT_SHARE, ...base };
  if (!p.slots.includes("dessert")) return out;
  const d = Math.min(0.5, Math.max(0, out.dessert));
  const meals = MEAL_SLOTS.filter((s) => p.slots.includes(s)).reduce((a, s) => a + out[s], 0);
  const f = meals + d > 1 && meals > 0 ? (1 - d) / meals : 1;
  for (const s of MEAL_SLOTS) out[s] *= f;
  out.dessert = d;
  return out;
}

/** Days (0-based) that get dessert: dessertsPerWeek of them (default every day), spread out. */
export function dessertDaysFor(setup: PrepSetup): Set<number> {
  const per = setup.dessertsPerWeek ?? 7;
  const n = Math.max(0, Math.min(setup.days, Math.round(per)));
  const out = new Set<number>();
  for (let k = 0; k < n; k++) out.add(Math.floor(((k + 0.5) * setup.days) / n));
  return out;
}

export function aimFor(p: PrepPerson, share: Record<MealSlot, number>, slots: MealSlot[] = personSlots(p)): Aim | null {
  const t = p.targets;
  if (!t || !(t.kcal > 0)) return null;
  const slotShare = shareFor(p, share);
  const total = slots.reduce((a, s) => a + slotShare[s], 0);
  const f = Math.min(1, total) || 1;
  const tol = { ...DEFAULT_TOL, ...(t.tolerance ?? {}) } as Record<MacroKey, number>;
  return {
    share: f,
    slotShare,
    slotTotal: total || 1,
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
  const tuned = modeTuning(opts.mode ?? "balanced", { ...DEFAULT_WEIGHTS, ...(opts.weights ?? {}) });
  const weights = tuned.weights;
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
  // (dessert never borrows: only real desserts go on a dessert plate)
  const thinSlots = usedSlots.filter((s) => s !== "dessert" && pool.filter((r) => suitsSlot(r, s)).length < 2);
  // a recipe that suits none of the meals planned (a dessert when nobody has
  // dessert, say) can't go on a plate, so it doesn't take a place in the pool
  pool = pool.filter((r) => pinned.has(r.recipeId) || usedSlots.some((s) => suitsSlot(r, s)) || (thinSlots.length > 0 && isMeal(r)));

  // Rank and cap the pool so the model stays small enough to solve in seconds.
  const aims = people.map((p) => aimFor(p, share));
  const pool2 = capPool(pool, aims, usedSlots, pinned, setup);

  const allowed = people.map((_, i) => pool2.map((r) => allowedById.get(r.recipeId)![i]));

  // Protein top-ups follow the setup (chicken, a shake, both or none), and a
  // plan uses one shake product, not a mix of brands.
  const topUps = setup.topUps ?? "both";
  const okTopUp = (a: Adjuster) => {
    const k = topUpKind(a);
    if (!k) return true;
    if (topUps === "none") return false;
    return topUps === "both" || topUps === k;
  };
  let adj = adjusters.filter(okTopUp);
  const shakes = adj.filter((a) => topUpKind(a) === "shake");
  if (shakes.length > 1) {
    // the shake the person picked (PrepSetup.shakeId), else the default
    const picked = setup.shakeId;
    const keep = shakes.find((a) => picked && (a.id === `shake-${picked}` || a.id === picked))
      ?? shakes.find((a) => a.id === DEFAULT_SHAKE_ADJUSTER_ID)
      ?? shakes[0];
    adj = adj.filter((a) => topUpKind(a) !== "shake" || a === keep);
  }
  const shakeIdx = adj.findIndex((a) => topUpKind(a) === "shake");
  const adjAllowed = people.map((_, i) => adj.map((a) => !adjusterExcluded(a, words[i])));

  // Dessert plates only on the chosen days (the same days for everyone).
  const dDays = dessertDaysFor(setup);
  const dessertDays = people.map((p) => (p.slots.includes("dessert") ? dDays : new Set<number>()));
  const slotsOn = (pi: number, d: number) => personSlots(people[pi]).filter((s) => s !== "dessert" || dessertDays[pi].has(d));
  const occasions: Occasion[] = [];
  people.forEach((p, pi) => {
    for (let d = 0; d < setup.days; d++) for (const s of slotsOn(pi, d)) occasions.push({ idx: occasions.length, personIdx: pi, day: d, slot: s });
  });
  const dayAims = people.map((p, pi) => Array.from({ length: setup.days }, (_, d) => aimFor(p, share, slotsOn(pi, d))));

  // A recipe's own swaps, when allowed and someone has targets to aim for.
  // A swap is used for the whole batch, so it must suit everyone eating it.
  const swaps: SwapChoice[] = [];
  // swaps the person turned off ("recipeId:swapId")
  const offSwaps = new Set(setup.excludedSwaps ?? []);
  if (setup.allowSwaps !== false && aims.some(Boolean)) {
    pool2.forEach((r, ri) => {
      const eaters = people.map((_, i) => i).filter((i) => allowed[i][ri]);
      const ok = (r.swaps ?? []).filter((sw) =>
        !offSwaps.has(`${r.recipeId}:${sw.id}`) &&
        sw.changes.length > 0 &&
        MACROS.every((m) => Number.isFinite(sw.perServingDelta[m] ?? 0)) &&
        sw.changes.every((c) => c.lineIndex >= 0) &&
        !eaters.some((i) => swapExcluded(sw, words[i])));
      // the most useful few: protein gained plus calories saved
      const worth = (sw: IngredientSwap) => (sw.perServingDelta.protein ?? 0) * 4 - (sw.perServingDelta.kcal ?? 0);
      ok.sort((a, b) => worth(b) - worth(a)).slice(0, 4).forEach((sw) => {
        const lean = opts.mode === "protein" && sw.goal !== "lighter" ? 0.5 : 1;
        const cost = (tuned.pen.swap + (sw.confidence === "low" ? tuned.pen.swapLow : sw.confidence === "medium" ? tuned.pen.swapMedium : 0)) * lean;
        swaps.push({ recipeIdx: ri, swap: sw, cost });
      });
    });
  }

  const perPerson = Math.max(...people.map((p) => personSlots(p).filter((s) => s !== "dessert").length * setup.days), 0);
  // dessert is one more dish to cook, on top of the usual count
  const hasDessert = occasions.some((o) => o.slot === "dessert");
  let maxDishes = setup.maxDishes ?? (perPerson >= 10 ? 5 : 4) + (hasDessert ? 1 : 0);
  if (opts.dishCount != null) maxDishes = opts.dishCount;
  if (pinned.size > maxDishes) {
    relaxed.push(`${pinned.size} dishes were asked for, more than the ${maxDishes}-dish limit, so the plan cooks ${pinned.size}.`);
    maxDishes = pinned.size;
  }

  return {
    setup, weights, recipes: pool2, adjusters: adj, people, aims, dayAims, dessertDays, words, allowed, adjAllowed, occasions,
    maxDishes, maxRepeats: { ...DEFAULT_REPEATS, ...(setup.maxRepeats ?? {}) } as Record<MealSlot, number>,
    pinned, exactDishes: opts.dishCount != null, softDishLimit: setup.maxDishes == null && opts.dishCount == null, notes, relaxed, thinSlots, share, sessionTimeFactor: opts.sessionTimeFactor ?? 1,
    pen: tuned.pen, swaps, cuts: opts.cuts ?? [], shakeIdx: shakeIdx >= 0 ? shakeIdx : null,
  };
}

const MACROS: MacroKey[] = ["kcal", "protein", "carbs", "fat"];

/** Mirrors DEFAULT_SHAKE_ADJUSTER_ID in shared/meal-prep/shakes.ts (food data): Premier Protein 30g. */
export const DEFAULT_SHAKE_ADJUSTER_ID = "shake-premier-protein-30g";

/**
 * Which protein top-up an adjuster is. Uses Adjuster.topUp; adjusters from
 * before that field existed are recognized by id.
 */
export function topUpKind(a: Adjuster): "chicken" | "shake" | null {
  if (a.topUp) return a.topUp;
  if (/shake/.test(a.id)) return "shake";
  if (/^chicken/.test(a.id)) return "chicken";
  return null;
}

/** grams one unit of the adjuster's variable stands for: a whole bottle for a shake */
export function adjusterUnit(a: Adjuster): number {
  return topUpKind(a) === "shake" ? Math.max(1, a.unitGrams ?? a.stepGrams) : 1;
}

/** A dessert-type recipe (brownies, cookies), wherever it's served: dessert or snack. */
export function isSweetRecipe(r: RecipeFacts): boolean {
  return r.mealTypes.includes("dessert");
}

/**
 * Adjusters that go with something sweet: a bottled shake, yogurt, cottage
 * cheese, fruit, milk. Eggs, chicken, oil, avocado, rice, veg and the like don't.
 */
export function isSweetAdjuster(a: Adjuster): boolean {
  if (topUpKind(a) === "shake") return true;
  if (topUpKind(a) === "chicken") return false;
  if (a.slots.includes("dessert")) return true;
  const text = `${a.id} ${a.name} ${a.ingredient.id} ${a.ingredient.name}`.toLowerCase();
  return /yogh?urt|cottage|skyr|kefir|berr|fruit|banana|apple|granola|\bmilk|whey|honey/.test(text);
}

/** Whether an adjuster may go on a plate for this slot (desserts never get savory top-ups). */
export function adjusterFitsSlot(a: Adjuster, slot: MealSlot): boolean {
  if (!a.slots.includes(slot)) return false;
  if (slot === "dessert" && !isSweetAdjuster(a)) return false;
  return true;
}

/** Whether an adjuster may go next to this recipe: nothing savory beside a dessert-type recipe, even as a snack. */
export function adjusterFitsRecipe(a: Adjuster, r: RecipeFacts): boolean {
  return !isSweetRecipe(r) || isSweetAdjuster(a);
}

function swapExcluded(sw: IngredientSwap, words: string[]): boolean {
  if (!words.length) return false;
  const texts = sw.changes.flatMap((c) => [c.to.id, c.to.name, c.toDisplay]).map((t) => t.toLowerCase().replace(/[-_]/g, " "));
  return words.some((w) => {
    const re = new RegExp("(^|[^a-z])" + w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    return texts.some((t) => re.test(t));
  });
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
  /**
   * adjuster j on the plate for occasion occ: v counts units of `unit` grams
   * (whole steps, whole bottles, or grams when `int` is false)
   */
  adj: Array<{ occ: number; j: number; v: string; unit: number; int: boolean }>;
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
  /** one binary per usable swap (same order as P.swaps): on = the whole batch uses it */
  swapVars: string[];
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
export function plateAim(aim: Aim, slot: MealSlot): number {
  return (aim.targets.kcal * aim.slotShare[slot]) / aim.slotTotal;
}

/**
 * objective cost of one gram of an adjuster. Protein top-ups cost more than
 * a portion change or a recipe swap, so they're the last lever used.
 */
export function adjusterCost(a: Adjuster): number {
  const k = topUpKind(a);
  if (k === "shake") return PEN.shakeBottle / adjusterUnit(a);
  return PEN.adjusterGram + PEN.adjusterKcal * (a.perGram.kcal ?? 0) + (k === "chicken" ? PEN.topUpGram : PEN.sideGram);
}

/** A person's usual portion of a meal (quarter servings); a dessert is one serving. */
export function usualFor(P: Prepared, pi: number, slot?: MealSlot): number {
  if (slot === "dessert") return 4;
  const aim = P.aims[pi];
  if (!aim) return 4;
  const meals = personSlots(P.people[pi]).filter((s) => s !== "dessert");
  const kcal = meals.reduce((a, s) => a + plateAim(aim, s), 0);
  return usualQuarters({ ...aim, targets: { ...aim.targets, kcal } }, meals.length, P.recipes.filter((r) => !r.mealTypes.every((t) => t === "dessert")));
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
  const PEN = P.pen; // tuned for the plan option
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
  if (P.softDishLimit) {
    // one dish over the default limit is allowed, at a cost just under a
    // same-day repeat: it's cooked mainly to avoid the same dish twice in a day
    const extra = lp.addVar({ type: "B", obj: PEN.extraDish });
    lp.addRow([...y.map((v): Term => [v, 1]), [extra, -1]], "<=", P.maxDishes);
  } else {
    lp.addRow(y.map((v): Term => [v, 1]), P.exactDishes ? "=" : "<=", P.maxDishes);
  }
  // plan options: differ from earlier options by at least `drop` of their dishes
  for (const cut of P.cuts) {
    const idx = R.map((r, i) => (cut.ids.includes(r.recipeId) && !P.pinned.has(r.recipeId) ? i : -1)).filter((i) => i >= 0);
    const drop = Math.min(cut.drop, idx.length);
    if (drop > 0) lp.addRow(idx.map((i): Term => [y[i], 1]), "<=", idx.length - drop);
  }

  // --- recipe swaps: one binary per swap, for the whole batch
  const swapVars = P.swaps.map((c) => {
    const v = lp.addVar({ type: "B", obj: c.cost * W.macro });
    lp.addRow([[v, 1], [y[c.recipeIdx], -1]], "<=", 0);
    return v;
  });
  R.forEach((_, i) => {
    const mine = P.swaps.map((c, k) => (c.recipeIdx === i ? k : -1)).filter((k) => k >= 0);
    if (mine.length > 2) lp.addRow(mine.map((k): Term => [swapVars[k], 1]), "<=", 2);
    // at most one swap per ingredient line
    const lines = new Map<number, number[]>();
    for (const k of mine) for (const c of P.swaps[k].swap.changes) lines.set(c.lineIndex, [...(lines.get(c.lineIndex) ?? []), k]);
    lines.forEach((ks) => {
      const uniq = Array.from(new Set(ks));
      if (uniq.length > 1) lp.addRow(uniq.map((k): Term => [swapVars[k], 1]), "<=", 1);
    });
  });

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
        const maxQ = maxQuarters(o.slot);
        n = lp.addVar({ type: "I", lb: 0, ub: maxQ, obj: (-W.waste * PEN.wasteServing) / 4 });
        lp.addRow([[n, 1], [x, -MIN_QUARTERS]], ">=", 0);
        lp.addRow([[n, 1], [x, -maxQ]], "<=", 0);
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
  const usual = P.people.map((_, pi) => usualFor(P, pi));
  for (const o of occasions) {
    const ps = platesByOcc[o.idx].filter((p) => p.n);
    if (!ps.length) continue;
    const up = lp.addVar({ obj: PEN.portionOffUsual });
    const down = lp.addVar({ obj: PEN.portionOffUsual });
    const u = o.slot === "dessert" ? usualFor(P, o.personIdx, "dessert") : usual[o.personIdx];
    lp.addRow([...ps.map((p): Term => [p.n!, 1]), ...ps.map((p): Term => [p.x, -u]), [up, -1], [down, 1]], "=", 0);
  }
  // swap amounts per plate: w = servings (quarters) when the batch uses the
  // swap, else 0 (a product of a binary and an integer, written linearly)
  const swapOnPlate = new Map<PlateVar, Array<{ k: number; w: string }>>();
  P.swaps.forEach((c, k) => {
    for (const p of plates) {
      if (p.recipeIdx !== c.recipeIdx || !p.n) continue;
      const maxQ = maxQuarters(occasions[p.occ].slot);
      const w = lp.addVar({ lb: 0, ub: maxQ });
      lp.addRow([[w, 1], [p.n, -1]], "<=", 0);
      lp.addRow([[w, 1], [swapVars[k], -maxQ]], "<=", 0);
      lp.addRow([[w, 1], [p.n, -1], [swapVars[k], -maxQ]], ">=", -maxQ);
      swapOnPlate.set(p, [...(swapOnPlate.get(p) ?? []), { k, w }]);
    }
  });
  const swapTerms = (p: PlateVar, m: MacroKey): Term[] =>
    (swapOnPlate.get(p) ?? []).map(({ k, w }): Term => [w, (P.swaps[k].swap.perServingDelta[m] ?? 0) / 4]);
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
      // (a week of the same dessert is fine: one batch of brownies)
      const meals = mine.filter((p) => occasions[p.occ].slot !== "dessert");
      for (const [over, pen] of [[3, PEN.weekDishOver3], [5, PEN.weekDishOver5]] as const) {
        if (meals.length <= over) continue;
        const e = lp.addVar({ obj: pen });
        lp.addRow([...meals.map((p): Term => [p.x, 1]), [e, -1]], "<=", over);
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
  P.people.forEach((_, pi) => {
    if (!P.aims[pi]) return;
    for (let d = 0; d < setup.days; d++) {
      const aim = P.dayAims[pi][d]!;
      const age = ageOnDay(setup, d);
      const dayPlates = plates.filter((p) => occasions[p.occ].personIdx === pi && occasions[p.occ].day === d);
      // adjusters belong to a plate (so each plate can be balanced), and only
      // to a plate that has a dish on it
      const adj: DayMacroVars["adj"] = [];
      for (const o of occasions) {
        if (o.personIdx !== pi || o.day !== d) continue;
        const xsAll = plates.filter((p) => p.occ === o.idx);
        if (!xsAll.length) continue;
        P.adjusters.forEach((a, j) => {
          if (!P.adjAllowed[pi][j] || !adjusterFitsSlot(a, o.slot)) return;
          if (keepingFor(a.storage, age, freezerOk) === "no") return;
          // only on the plates whose dish it goes with (no eggs beside a brownie)
          const xs = xsAll.filter((p) => adjusterFitsRecipe(a, R[p.recipeIdx]));
          if (!xs.length) return;
          const unit = adjusterUnit(a);
          if (unit > 1) {
            // a shake: at most one whole bottle on a plate
            const v = lp.addVar({ type: "B", obj: adjusterCost(a) * unit * W.macro });
            lp.addRow([[v, 1], ...xs.map((p): Term => [p.x, -1])], "<=", 0);
            adj.push({ occ: o.idx, j, v, unit, int: true });
            return;
          }
          const v = lp.addVar({ lb: 0, ub: a.maxGrams, obj: adjusterCost(a) * W.macro });
          lp.addRow([[v, 1], ...xs.map((p): Term => [p.x, -a.maxGrams])], "<=", 0);
          adj.push({ occ: o.idx, j, v, unit, int: false });
        });
      }
      days.push({ personIdx: pi, day: d, adj });

      const amount = (m: MacroKey): Term[] => {
        const t: Term[] = dayPlates.map((p) => [p.n!, macroOf(R[p.recipeIdx], m) / 4]);
        dayPlates.forEach((p) => t.push(...swapTerms(p, m)));
        adj.forEach(({ j, v, unit }) => t.push([v, (P.adjusters[j].perGram[m] ?? 0) * unit]));
        return t;
      };

      // each plate near its meal's share of the day, so lunch isn't 1,200 kcal
      // and dinner 200: a soft ±25% band, and a firmer floor at 60%
      for (const o of occasions) {
        if (o.personIdx !== pi || o.day !== d) continue;
        const xs = dayPlates.filter((p) => p.occ === o.idx);
        if (!xs.length) continue;
        const T = plateAim(aim, o.slot);
        const kc: Term[] = [
          ...xs.map((p): Term => [p.n!, macroOf(R[p.recipeIdx], "kcal") / 4]),
          ...xs.flatMap((p) => swapTerms(p, "kcal")),
          ...adj.filter((a) => a.occ === o.idx).map(({ j, v, unit }): Term => [v, (P.adjusters[j].perGram.kcal ?? 0) * unit]),
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
        if (PEN.proteinAbove > 0) {
          // protein option: a reward for protein above the floor (up to 20%);
          // `g` pays the reward back whenever protein is under the floor
          const above = lp.addVar({ ub: 0.2 * Pt, obj: -PEN.proteinAbove * pct(Pt) });
          const g = lp.addVar({ obj: (PEN.proteinAbove + 0.01) * pct(Pt) });
          lp.addRow([[above, 1], ...amount("protein").map(([v, c]): Term => [v, -c]), [g, -1]], "<=", -Pt);
        }
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
  return { lp, y, b, plates, miss, days, plateFloors, equipment, swapVars, slack, sessionCap, activeFor, sessionMinutes };
}
