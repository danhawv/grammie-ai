// A quick greedy plan handed to HiGHS as a starting point (a "MIP start").
// Without it the solver can spend a second or more just finding any plan
// that fills every meal; with it, the time limit is spent improving a
// complete plan. It only needs to be feasible, not good.

import type { MealSlot } from "@shared/meal-prep/contract";
import { SCALES, usualQuarters, personSlots, type Built, type PlateVar, type Prepared } from "./model";

export function greedyStart(P: Prepared, B: Built): Array<[string, number]> {
  const { recipes: R, occasions } = P;
  const W = P.weights;
  const score = (i: number) => {
    const r = R[i];
    return (r.preference.rating ?? 3) + (r.preference.favorite ? 2 : 0) + (W.recipeBonus?.[r.recipeId] ?? 0) + (P.pinned.has(r.recipeId) ? 100 : 0);
  };
  const usual = P.people.map((p, pi) => (P.aims[pi] ? usualQuarters(P.aims[pi]!, personSlots(p).length, R) : 4));
  const chosen = new Set<number>();
  R.forEach((r, i) => P.pinned.has(r.recipeId) && chosen.add(i));
  const usedQuarters = new Map<number, number>();
  const repeats = new Map<string, number>();
  const pick = new Map<number, PlateVar>();
  const byOcc = new Map<number, PlateVar[]>();
  for (const p of B.plates) byOcc.set(p.occ, [...(byOcc.get(p.occ) ?? []), p]);

  // Fill the meals with the fewest options first, then by day.
  const order = occasions.slice().sort((a, b) => (byOcc.get(a.idx)?.length ?? 0) - (byOcc.get(b.idx)?.length ?? 0) || a.day - b.day);
  for (const o of order) {
    const q = usual[o.personIdx];
    const fits = (byOcc.get(o.idx) ?? []).filter((p) => (usedQuarters.get(p.recipeIdx) ?? 0) + q <= 4 * SCALES[SCALES.length - 1] * R[p.recipeIdx].servings);
    const rep = (p: PlateVar) => repeats.get(key(o.personIdx, o.slot, p.recipeIdx)) ?? 0;
    const underLimit = (p: PlateVar) => rep(p) < P.maxRepeats[o.slot];
    const rank = (a: PlateVar, b: PlateVar) => Number(a.mismatch) - Number(b.mismatch) || rep(a) - rep(b) || score(b.recipeIdx) - score(a.recipeIdx);
    let best = fits.filter((p) => chosen.has(p.recipeIdx) && underLimit(p)).sort(rank)[0];
    if (!best && chosen.size < P.maxDishes) best = fits.filter((p) => !chosen.has(p.recipeIdx)).sort(rank)[0];
    if (!best) best = fits.filter((p) => chosen.has(p.recipeIdx)).sort(rank)[0];
    if (!best) continue;
    chosen.add(best.recipeIdx);
    pick.set(o.idx, best);
    usedQuarters.set(best.recipeIdx, (usedQuarters.get(best.recipeIdx) ?? 0) + q);
    repeats.set(key(o.personIdx, o.slot, best.recipeIdx), rep(best) + 1);
  }
  if (P.exactDishes) {
    // a swap asks for an exact dish count: add the best unused dishes
    const rest = R.map((_, i) => i).filter((i) => !chosen.has(i)).sort((a, b) => score(b) - score(a));
    while (chosen.size < P.maxDishes && rest.length) chosen.add(rest.shift()!);
  }

  const start: Array<[string, number]> = [];
  R.forEach((r, i) => {
    const on = chosen.has(i);
    start.push([B.y[i], on ? 1 : 0]);
    const need = (usedQuarters.get(i) ?? 0) / 4;
    const s = on ? Math.max(0, SCALES.findIndex((k) => k * r.servings >= need - 1e-9)) : -1;
    SCALES.forEach((_, k) => start.push([B.b[i][k], k === s ? 1 : 0]));
  });
  for (const p of B.plates) {
    const on = pick.get(p.occ) === p;
    start.push([p.x, on ? 1 : 0]);
    if (p.n) start.push([p.n, on ? usual[occasions[p.occ].personIdx] : 0]);
  }
  return start;
}

function key(p: number, s: MealSlot, r: number) {
  return `${p}:${s}:${r}`;
}
