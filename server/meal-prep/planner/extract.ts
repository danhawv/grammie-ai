// Reads the solver's answer back into a PrepPlan: batches, plates, adjusters
// rounded to sensible steps (then nudged by a small greedy pass so rounding
// doesn't knock a day out of its band), the fit per person-day, and plain
// notes about what was chosen and what had to give.

import type {
  CookBatch, DayFit, MacroKey, Macros, MealSlot, Plate, PlateItem, PrepPlan, RecipeFacts,
} from "@shared/meal-prep/contract";
import { addDays, ageOnDay, keepingFor, type Keeping } from "./eligibility";
import { CONFIDENCE_WIDEN, PEN, PLATE_BAND, PLATE_FLOOR, SCALES, adjusterCost, personSlots, plateAim, type Aim, type Built, type Prepared } from "./model";

const MACROS: MacroKey[] = ["kcal", "protein", "carbs", "fat"];
/** protein counts as met within this much of the floor (rounding to quarter servings and steps) */
const PROTEIN_GRACE = 0.02;
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function zero(): Macros {
  return { kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 };
}

function addInto(t: Macros, m: Macros, f: number) {
  for (const k of MACROS) t[k] += (m[k] ?? 0) * f;
  if (m.fiber != null) t.fiber = (t.fiber ?? 0) + m.fiber * f;
}

function rounded(m: Macros): Macros {
  const r: Macros = {
    kcal: Math.round(m.kcal),
    protein: Math.round(m.protein * 10) / 10,
    carbs: Math.round(m.carbs * 10) / 10,
    fat: Math.round(m.fat * 10) / 10,
  };
  if (m.fiber) r.fiber = Math.round(m.fiber * 10) / 10;
  return r;
}

export function dayLabel(P: Prepared, day: number): string {
  const iso = addDays(P.setup.session.date, ageOnDay(P.setup, day));
  const d = new Date(iso + "T12:00:00Z");
  return Number.isNaN(d.getTime()) ? `day ${day + 1}` : WEEKDAYS[d.getUTCDay()];
}

function list(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return items.slice(0, -1).join(", ") + " and " + items[items.length - 1];
}

// The walkthrough names a single cook "You": "Your plates", "You have", "for you"
const isYou = (n: string) => n.trim().toLowerCase() === "you";
const poss = (n: string) => (isYou(n) ? "Your" : /s$/i.test(n) ? `${n}'` : `${n}'s`);
const has = (n: string) => (isYou(n) ? "You have" : `${n} has`);
const obj = (n: string) => (isYou(n) ? "you" : n);
const plural = (n: number, one: string, many = one + "s") => `${n} ${n === 1 ? one : many}`;
const fmtScale = (k: number) => (k === 0.5 ? "a half batch" : k === 1 ? "1 batch" : `${k} batches`);

interface WorkPlate {
  occ: number;
  personIdx: number;
  day: number;
  slot: MealSlot;
  recipeIdx: number;
  servings: number;
  keeping: Keeping;
  mismatch: boolean;
  /** adjuster index -> grams */
  adj: Map<number, number>;
}

/** Same penalties as the model, for one person-day, used by the rounding pass. */
function dayPenalty(m: Macros, widen: Macros, aim: Aim, adjCost: number): number {
  const pct = (t: number) => 100 / Math.max(t, 1);
  const K = aim.targets.kcal;
  let p = 0;
  p += Math.max(0, K * (1 - aim.tol.kcal) - m.kcal - widen.kcal) * PEN.kcalUnder * pct(K);
  p += Math.max(0, m.kcal - widen.kcal - K * (1 + aim.tol.kcal)) * PEN.kcalOver * pct(K);
  p += Math.abs(m.kcal - K) * PEN.kcalOffAim * pct(K);
  const Pt = aim.targets.protein;
  if (Pt > 0) p += Math.max(0, Pt * (1 - aim.tol.protein) - m.protein - widen.protein) * PEN.proteinShort * pct(Pt);
  for (const k of ["carbs", "fat"] as const) {
    const T = aim.targets[k];
    if (T == null || !(T > 0)) continue;
    p += Math.max(0, T * (1 - aim.tol[k]) - m[k] - widen[k]) * PEN.carbFatOut * pct(T);
    p += Math.max(0, m[k] - widen[k] - T * (1 + aim.tol[k])) * PEN.carbFatOut * pct(T);
  }
  return p + adjCost;
}

/** Same plate-balance penalties as the model. */
function platePenalty(kcal: number, T: number): number {
  const pct = 100 / Math.max(T, 1);
  return Math.max(0, T * (1 - PLATE_BAND) - kcal) * PEN.plateOut * pct
    + Math.max(0, kcal - T * (1 + PLATE_BAND)) * PEN.plateOut * pct
    + Math.max(0, T * PLATE_FLOOR - kcal) * PEN.plateFloor * pct;
}

export function statusFor(m: Macros, widen: Macros, aim: Aim): DayFit["status"] {
  const s: DayFit["status"] = { kcal: "n/a", protein: "n/a", carbs: "n/a", fat: "n/a" };
  const band = (k: MacroKey) => {
    const T = aim.targets[k];
    if (T == null || !(T > 0)) return "n/a" as const;
    if (m[k] + widen[k] < T * (1 - aim.tol[k]) - 0.5) return "low" as const;
    if (m[k] - widen[k] > T * (1 + aim.tol[k]) + 0.5) return "high" as const;
    return "ok" as const;
  };
  s.kcal = band("kcal");
  s.carbs = band("carbs");
  s.fat = band("fat");
  const Pt = aim.targets.protein;
  if (Pt > 0) s.protein = m.protein + widen.protein >= Pt * (1 - Math.max(aim.tol.protein, PROTEIN_GRACE)) ? "ok" : "low";
  return s;
}

export interface Extracted {
  plan: PrepPlan;
  /** solver objective, for ranking alternatives */
  objective: number;
}

export function extractPlan(P: Prepared, B: Built, values: Record<string, number>, solverMs: number, objective: number): Extracted {
  const v = (name: string | null) => (name ? values[name] ?? 0 : 0);
  const { setup, recipes: R, occasions, adjusters: A } = P;
  const notes = [...P.notes];
  const relaxed = [...P.relaxed];
  const freezerOk = setup.kitchen.freezerSpace !== "none";

  // --- batches
  const batches: CookBatch[] = [];
  const scaleOf = new Map<number, number>();
  R.forEach((r, i) => {
    if (v(B.y[i]) < 0.5) return;
    let best = 1;
    let bestV = -1;
    SCALES.forEach((k, s) => {
      if (v(B.b[i][s]) > bestV) {
        bestV = v(B.b[i][s]);
        best = k;
      }
    });
    scaleOf.set(i, best);
    batches.push({ recipeId: r.recipeId, scale: best, servingsMade: Math.round(best * r.servings * 100) / 100 });
  });

  // --- plates (recipe part)
  const work: WorkPlate[] = [];
  for (const p of B.plates) {
    if (v(p.x) < 0.5) continue;
    const o = occasions[p.occ];
    const servings = p.n ? Math.min(2, Math.max(0.5, Math.round(v(p.n)) / 4)) : 1;
    work.push({ occ: p.occ, personIdx: o.personIdx, day: o.day, slot: o.slot, recipeIdx: p.recipeIdx, servings, keeping: p.keeping, mismatch: p.mismatch, adj: new Map() });
  }
  work.sort((a, b) => a.personIdx - b.personIdx || a.day - b.day || slotRank(a.slot) - slotRank(b.slot));

  // --- adjusters: round the solver's grams on each plate to whole steps
  const workByOcc = new Map(work.map((w) => [w.occ, w]));
  for (const dv of B.days) {
    for (const { occ, j, v: name } of dv.adj) {
      const w = workByOcc.get(occ);
      const a = A[j];
      const grams = Math.min(a.maxGrams, Math.round(v(name) / a.stepGrams) * a.stepGrams);
      if (w && grams > 0) w.adj.set(j, grams);
    }
  }

  const recipeMacros = (w: WorkPlate) => {
    const m = zero();
    addInto(m, R[w.recipeIdx].perServing, w.servings);
    return m;
  };
  const plateMacros = (w: WorkPlate) => {
    const m = recipeMacros(w);
    w.adj.forEach((g, j) => addInto(m, A[j].perGram, g));
    return m;
  };
  const widenOf = (w: WorkPlate) => {
    const m = zero();
    addInto(m, R[w.recipeIdx].perServing, w.servings * CONFIDENCE_WIDEN[R[w.recipeIdx].confidence]);
    return m;
  };
  const sumDay = (ws: WorkPlate[], f: (w: WorkPlate) => Macros) => {
    const t = zero();
    ws.forEach((w) => addInto(t, f(w), 1));
    return t;
  };
  const adjCostOf = (ws: WorkPlate[]) =>
    ws.reduce((a, w) => a + Array.from(w.adj).reduce((x, [j, g]) => x + g * adjusterCost(A[j]) + (g > 0 ? PEN.adjusterItem : 0), 0), 0);

  // --- greedy pass: step adjusters (or a portion, by a quarter serving, when
  // there's food to spare) up or down while it improves the day
  const made = (i: number) => (scaleOf.get(i) ?? 0) * R[i].servings;
  const eatenOf = (i: number) => work.reduce((a, w) => a + (w.recipeIdx === i ? w.servings : 0), 0);
  for (const dv of B.days) {
    const aim = P.aims[dv.personIdx]!;
    const ws = work.filter((w) => w.personIdx === dv.personIdx && w.day === dv.day);
    if (!ws.length) continue;
    const widen = sumDay(ws, widenOf);
    const age = ageOnDay(setup, dv.day);
    const person = P.people[dv.personIdx];
    const score = () => dayPenalty(sumDay(ws, plateMacros), widen, aim, adjCostOf(ws))
      + ws.reduce((acc, w) => acc + platePenalty(plateMacros(w).kcal, plateAim(aim, person, w.slot, P.share)), 0);
    let cur = score();
    for (let iter = 0; iter < 60; iter++) {
      let best: { w: WorkPlate; j: number; g: number; s: number } | null = null;
      for (const w of ws) {
        A.forEach((a, j) => {
          if (!P.adjAllowed[dv.personIdx][j] || !a.slots.includes(w.slot)) return;
          if (keepingFor(a.storage, age, freezerOk) === "no") return;
          const g0 = w.adj.get(j) ?? 0;
          // one step either way, or drop the adjuster from this plate altogether
          for (const g of Array.from(new Set([g0 - a.stepGrams, g0 + a.stepGrams, 0])).filter((g) => g !== g0)) {
            if (g < 0 || g > a.maxGrams) continue;
            w.adj.set(j, g);
            const s = score();
            if (s < cur - 1e-6 && (!best || s < best.s)) best = { w, j, g, s };
          }
          if (g0) w.adj.set(j, g0);
          else w.adj.delete(j);
        });
        // j = -1 marks a portion change
        const s0 = w.servings;
        const spare = made(w.recipeIdx) - eatenOf(w.recipeIdx);
        for (const sv of [s0 - 0.25, s0 + 0.25]) {
          if (sv < 0.5 || sv > 2) continue;
          if (sv > s0 && spare < 0.25 - 1e-9) continue;
          w.servings = sv;
          const sc = score() + PEN.portionOffUsual; // a small cost, so portions only move when it helps
          if (sc < cur - 1e-6 && (!best || sc < best.s)) best = { w, j: -1, g: sv, s: sc - PEN.portionOffUsual };
        }
        w.servings = s0;
      }
      if (!best) break;
      const b = best as { w: WorkPlate; j: number; g: number; s: number };
      if (b.j === -1) b.w.servings = b.g;
      else if (b.g > 0) b.w.adj.set(b.j, b.g);
      else b.w.adj.delete(b.j);
      cur = b.s;
    }
  }

  // --- build plates
  const plates: Plate[] = work.map((w) => {
    const r = R[w.recipeIdx];
    const age = ageOnDay(setup, w.day);
    const dayIso = addDays(setup.session.date, age);
    const items: PlateItem[] = [{
      kind: "recipe",
      refId: r.recipeId,
      amount: w.servings,
      grams: null, // recipes don't carry a cooked yield weight
      macros: rounded(recipeMacros(w)),
    }];
    const eatBys = [eatByFor(setup.session.date, dayIso, w.keeping, r.storage)];
    w.adj.forEach((g, j) => {
      const a = A[j];
      const m = zero();
      addInto(m, a.perGram, g);
      items.push({ kind: "adjuster", refId: a.id, amount: g, grams: g, macros: rounded(m) });
      eatBys.push(eatByFor(setup.session.date, dayIso, keepingFor(a.storage, age, freezerOk), a.storage));
    });
    return {
      personId: P.people[w.personIdx].id,
      day: w.day,
      slot: w.slot,
      items,
      macros: rounded(plateMacros(w)),
      storage: w.keeping === "no" ? "fridge" : w.keeping,
      eatBy: eatBys.sort()[0],
    };
  });

  // --- fit per person-day
  const fit: DayFit[] = [];
  let withTargets = 0;
  let inBand = 0;
  const misses = new Map<number, string[]>(); // person -> "low protein on Tuesday"
  P.people.forEach((person, pi) => {
    const aim = P.aims[pi];
    for (let d = 0; d < setup.days; d++) {
      const ws = work.filter((w) => w.personIdx === pi && w.day === d);
      const m = sumDay(ws, plateMacros);
      if (!aim) {
        fit.push({ personId: person.id, day: d, macros: rounded(m), target: null, status: { kcal: "n/a", protein: "n/a", carbs: "n/a", fat: "n/a" } });
        continue;
      }
      const status = statusFor(m, sumDay(ws, widenOf), aim);
      fit.push({ personId: person.id, day: d, macros: rounded(m), target: roundTargets(aim), status });
      withTargets++;
      const off = (Object.keys(status) as MacroKey[]).filter((k) => status[k] === "low" || status[k] === "high");
      if (!off.length) inBand++;
      else misses.set(pi, [...(misses.get(pi) ?? []), `${off.map((k) => `${k === "kcal" ? "calories" : k} ${status[k]}`).join(", ")} on ${dayLabel(P, d)}`]);
    }
  });
  const fitScore = withTargets ? Math.round((100 * inBand) / withTargets) : 100;

  // --- adjusters cooked in the session
  const adjusterCooking: Record<string, number> = {};
  for (const w of work) w.adj.forEach((g, j) => {
    if (A[j].needsCooking) adjusterCooking[A[j].id] = (adjusterCooking[A[j].id] ?? 0) + g;
  });
  for (const id of Object.keys(adjusterCooking)) adjusterCooking[id] = Math.ceil(adjusterCooking[id] / 50) * 50;

  // --- notes: plain facts the API turns into an explanation
  P.people.forEach((person, pi) => {
    const aim = P.aims[pi];
    if (!aim) return;
    const slots = personSlots(person);
    const t = aim.targets;
    const part = aim.share >= 0.999 ? "the whole day" : `about ${Math.round(aim.share * 100)}% of the day`;
    notes.push(`${poss(person.name)} prep covers ${list(slots)}, ${part}: aiming for about ${Math.round(t.kcal)} kcal and ${Math.round(t.protein)} g protein a day from these meals.`);
  });
  for (const bt of batches) {
    const i = R.findIndex((r) => r.recipeId === bt.recipeId);
    const ws = work.filter((w) => w.recipeIdx === i);
    const bySlot = new Map<MealSlot, number>();
    ws.forEach((w) => bySlot.set(w.slot, (bySlot.get(w.slot) ?? 0) + 1));
    const covers = Array.from(bySlot).sort((a, b) => slotRank(a[0]) - slotRank(b[0])).map(([s, n]) => plural(n, s, s === "lunch" ? "lunches" : s + "s"));
    const eaten = ws.reduce((a, w) => a + w.servings, 0);
    const left = Math.round((bt.servingsMade - eaten) * 4) / 4;
    notes.push(`Chose ${fmtScale(bt.scale)} of ${R[i].title} (${fmtNum(bt.servingsMade)} servings) to cover ${covers.length ? list(covers) : "no plates"}${left > 0 ? `; ${fmtNum(left)} ${left === 1 ? "serving" : "servings"} left over` : ""}.`);
  }
  const portionRange = new Map<number, number[]>();
  work.forEach((w) => P.aims[w.personIdx] && portionRange.set(w.personIdx, [...(portionRange.get(w.personIdx) ?? []), w.servings]));
  portionRange.forEach((s, pi) => {
    const lo = Math.min(...s);
    const hi = Math.max(...s);
    if (lo !== 1 || hi !== 1) notes.push(`${poss(P.people[pi].name)} plates use ${lo === hi ? fmtNum(lo) : `${fmtNum(lo)} to ${fmtNum(hi)}`} servings of each dish to fit the targets.`);
  });
  const adjUse = new Map<string, number>();
  work.forEach((w) => w.adj.forEach((_, j) => adjUse.set(`${w.personIdx}:${j}`, (adjUse.get(`${w.personIdx}:${j}`) ?? 0) + 1)));
  adjUse.forEach((n, key) => {
    const [pi, j] = key.split(":").map(Number);
    notes.push(`Added ${A[j].name.toLowerCase()} to ${plural(n, "plate")} for ${obj(P.people[pi].name)} to round out the day.`);
  });
  const frozen = work.filter((w) => w.keeping === "freezer");
  if (frozen.length) {
    const dishes = Array.from(new Set(frozen.map((w) => R[w.recipeIdx].title)));
    const fridgeMax = Math.max(...Array.from(new Set(frozen.map((w) => R[w.recipeIdx].storage.fridgeDays))));
    notes.push(`${plural(frozen.length, "plate")} (${list(dishes)}) ${frozen.length === 1 ? "goes" : "go"} in the freezer, since they'll be eaten more than ${plural(fridgeMax, "day")} after cooking.`);
  }
  work.filter((w) => w.mismatch).forEach((w) => notes.push(`${R[w.recipeIdx].title} is used for ${w.slot} on ${dayLabel(P, w.day)} because few ${w.slot} recipes were available.`));
  const handsOn = batches.reduce((a, bt) => a + B.activeFor(R.findIndex((r) => r.recipeId === bt.recipeId), bt.scale), 0);
  notes.push(`About ${Math.round(handsOn)} minutes of hands-on cooking for ${plural(batches.length, "dish", "dishes")}.`);

  // --- what had to give
  occasions.forEach((o, idx) => {
    if (v(B.miss[idx]) < 0.5) return;
    const name = P.people[o.personIdx].name;
    const any = B.plates.some((p) => p.occ === idx);
    relaxed.push(any
      ? `${poss(name)} ${dayLabel(P, o.day)} ${o.slot} is left open; the chosen dishes didn't stretch that far.`
      : `${poss(name)} ${dayLabel(P, o.day)} ${o.slot} is left open: none of the recipes suit it and keep safely that long.`);
  });
  for (const s of B.slack.repeats) {
    const extra = Math.round(v(s.v));
    if (extra > 0) relaxed.push(`${has(P.people[s.personIdx].name)} ${R[s.recipeIdx].title} for ${s.slot} ${s.limit + extra} times, more than the usual ${s.limit}; there weren't enough suitable dishes to vary it.`);
  }
  const sameDay = new Map<string, string[]>(); // person|recipe -> days
  for (const s of B.slack.sameDay) if (v(s.v) > 0.5) {
    const k = `${s.personIdx}|${s.recipeIdx}`;
    sameDay.set(k, [...(sameDay.get(k) ?? []), dayLabel(P, s.day)]);
  }
  sameDay.forEach((days, k) => {
    const [pi, ri] = k.split("|").map(Number);
    relaxed.push(`${has(P.people[pi].name)} ${R[ri].title} twice in one day on ${list(days)}; there weren't enough suitable dishes to avoid it.`);
  });
  const protByPerson = new Map<string, number>();
  for (const s of B.slack.protein) if (v(s.v) > 0.5) {
    const k = `${s.personIdx}|${s.protein}|${s.slot}`;
    protByPerson.set(k, (protByPerson.get(k) ?? 0) + 1);
  }
  protByPerson.forEach((n, k) => {
    const [pi, protein, slot] = k.split("|");
    relaxed.push(`${has(P.people[Number(pi)].name)} ${protein} for ${slot} on back-to-back days ${plural(n, "time")}, from different dishes.`);
  });
  for (const f of B.plateFloors) {
    const w = workByOcc.get(f.occ);
    if (!w) continue;
    const kcal = plateMacros(w).kcal;
    if (kcal < f.aim * PLATE_FLOOR - 1) {
      relaxed.push(`${poss(P.people[w.personIdx].name)} ${dayLabel(P, w.day)} ${w.slot} is small (about ${Math.round(kcal)} kcal against about ${Math.round(f.aim)}) to keep the day on target.`);
    }
  }
  const chosenIdx = new Set(batches.map((bt) => R.findIndex((r) => r.recipeId === bt.recipeId)));
  for (const e of B.equipment) {
    if (!chosenIdx.has(e.recipeIdx)) continue;
    const needs = `needs ${list(e.missing.map((k) => `a ${k}`))}`;
    if (e.soft) notes.push(`${R[e.recipeIdx].title} is easiest with ${list(e.missing.map((k) => `a ${k}`))}, which isn't on the kitchen list.`);
    else relaxed.push(`${R[e.recipeIdx].title} ${needs}, which isn't on the kitchen list; nothing else fit as well.`);
  }
  const over = v(B.slack.sessionMinutes);
  if (over > 1) relaxed.push(`The dishes need about ${Math.round(handsOn)} minutes of hands-on work; about ${Math.round(B.sessionCap)} fit in the session.`);
  if (B.slack.budget && v(B.slack.budget) > 1) {
    const cost = batches.reduce((a, bt) => a + (R.find((r) => r.recipeId === bt.recipeId)!.cost ?? 0) * bt.scale, 0);
    relaxed.push(`The groceries come to about $${Math.round(cost)}, over the $${setup.budget} budget.`);
  }
  misses.forEach((m, pi) => {
    const days = m.length;
    relaxed.push(`${poss(P.people[pi].name)} targets weren't fully met on ${plural(days, "day")}: ${m.join("; ")}.`);
  });

  return {
    plan: { batches, adjusterCooking, plates, fit, fitScore, notes, relaxed, solverMs },
    objective,
  };
}

function eatByFor(sessionIso: string, dayIso: string, keeping: Keeping, storage: RecipeFacts["storage"]): string {
  if (keeping === "fresh") return dayIso;
  if (keeping === "freezer" && storage.freezerDays != null) return addDays(sessionIso, storage.freezerDays);
  return addDays(sessionIso, storage.fridgeDays);
}

function roundTargets(aim: Aim): DayFit["target"] {
  const t = aim.targets;
  return {
    kcal: Math.round(t.kcal),
    protein: Math.round(t.protein),
    ...(t.carbs != null ? { carbs: Math.round(t.carbs) } : {}),
    ...(t.fat != null ? { fat: Math.round(t.fat) } : {}),
    tolerance: aim.tol,
  };
}

function slotRank(s: MealSlot): number {
  return ["breakfast", "lunch", "dinner", "snack"].indexOf(s);
}

function fmtNum(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
}
