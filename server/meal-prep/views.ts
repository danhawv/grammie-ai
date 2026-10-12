// Row -> response shapes (shared/meal-prep/api.ts). The cook view is built
// field by field from an allowlist, so nothing private (owner, targets,
// budget, wishes, check-ins, other recipes) can slip through.

import type { Adjuster, PrepPlan, PrepSetup } from "@shared/meal-prep/contract";
import type {
  AdjusterDisplay, CookRecipe, CookView, PlanChanges, PlanOptionView, PrepPlanSummary, PrepPlanView, PrepShareView,
  StoredPlanOptions, TaskProgress,
} from "@shared/meal-prep/api";
import { adjusterDisplay, bottles, shakeText } from "@shared/meal-prep/callouts";
import type { PrepPlanRow, PrepPlanShareRow, ProgressRecord } from "./store";
import { shareState } from "./share";

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

export function progressMap(progress: ProgressRecord[]): Record<string, TaskProgress> {
  const out: Record<string, TaskProgress> = {};
  for (const p of progress) out[p.taskId] = { doneAt: p.doneAt.toISOString(), by: p.doneBy };
  return out;
}

/** Display info for the add-ons a plan (or its options) uses */
export function adjustersUsed(plans: Array<PrepPlan | null | undefined>, adjusters: Adjuster[]): Record<string, AdjusterDisplay> {
  const used = new Set<string>();
  for (const plan of plans) {
    if (!plan) continue;
    for (const p of plan.plates) for (const i of p.items) if (i.kind === "adjuster") used.add(i.refId);
    for (const id of Object.keys(plan.adjusterCooking ?? {})) used.add(id);
  }
  const out: Record<string, AdjusterDisplay> = {};
  for (const a of adjusters) if (used.has(a.id)) out[a.id] = adjusterDisplay(a);
  return out;
}

/** Older adjusters have no topUp tag; plain chicken is a protein top-up all the same */
function topUpKind(a: AdjusterDisplay | undefined, id: string): "chicken" | "shake" | null {
  if (a?.topUp) return a.topUp;
  return /chicken/i.test(id) ? "chicken" : null;
}

/** Every swap and protein top-up in the plan, for "Changes we made" */
export function planChanges(setup: PrepSetup, plan: PrepPlan | null, titles: Record<string, string>, adjusters: Record<string, AdjusterDisplay>): PlanChanges {
  if (!plan) return { swaps: [], topUps: [] };
  const swaps = (plan.swapsApplied ?? []).map(s => ({ ...s, dish: titles[s.recipeId] ?? "A dish" }));
  const topUps: PlanChanges["topUps"] = [];
  for (const person of setup.people) {
    const per = new Map<string, { count: number; grams: number; meals: number }>();
    for (const p of plan.plates) {
      if (p.personId !== person.id) continue;
      for (const i of p.items) {
        if (i.kind !== "adjuster" || !topUpKind(adjusters[i.refId], i.refId)) continue;
        const grams = i.grams ?? i.amount;
        const a = adjusters[i.refId];
        const agg = per.get(i.refId) ?? { count: 0, grams: 0, meals: 0 };
        agg.grams += grams;
        agg.meals += 1;
        agg.count += topUpKind(a, i.refId) === "shake" ? bottles(grams, a?.unitGrams) : 1;
        per.set(i.refId, agg);
      }
    }
    for (const [id, agg] of Array.from(per)) {
      const a = adjusters[id];
      const kind = topUpKind(a, id)!;
      const text = kind === "shake" && a
        ? `${person.name}: ${shakeText(a, (a.unitGrams ?? agg.grams) * agg.count)} over the week`
        : `${person.name}: ${Math.round(agg.grams / 5) * 5} g plain ${(a?.name ?? "chicken breast").toLowerCase()} over ${agg.meals} ${agg.meals === 1 ? "meal" : "meals"}`;
      topUps.push({ personId: person.id, adjusterId: id, kind, text, count: agg.count, grams: Math.round(agg.grams) });
    }
  }
  return { swaps, topUps };
}

function percentOf(plan: PrepPlan, key: "protein" | "kcal"): number | null {
  const ratios = plan.fit
    .filter(f => f.target && (key === "kcal" ? f.target.kcal : f.target.protein) > 0)
    .map(f => f.macros[key] / (key === "kcal" ? f.target!.kcal : f.target!.protein));
  if (ratios.length === 0) return null;
  return Math.round((ratios.reduce((s, r) => s + r, 0) / ratios.length) * 100);
}

export function optionViews(stored: StoredPlanOptions | null | undefined, titles: Record<string, string>, adjusters: Record<string, AdjusterDisplay>): PlanOptionView[] {
  if (!stored) return [];
  return stored.items.map(({ option, handsOnMinutes, titles: own }) => ({
    key: option.key,
    label: option.label,
    summary: option.summary,
    dishes: option.plan.batches.map(b => ({ recipeId: b.recipeId, title: own[b.recipeId] ?? titles[b.recipeId] ?? "A dish" })),
    handsOnMinutes,
    proteinPct: percentOf(option.plan, "protein"),
    kcalPct: percentOf(option.plan, "kcal"),
    fitScore: Math.round(option.plan.fitScore),
    swapCount: option.plan.swapsApplied?.length ?? new Set(option.plan.batches.flatMap(b => (b.swapIds ?? []).map(id => `${b.recipeId}:${id}`))).size,
    topUpCount: option.plan.plates.reduce((n, p) => n + p.items.filter(i => i.kind === "adjuster" && topUpKind(adjusters[i.refId], i.refId)).length, 0),
    chosen: stored.chosenKey === option.key,
  }));
}

export function toPlanView(row: PrepPlanRow, progress: ProgressRecord[], allAdjusters: Adjuster[] = []): PrepPlanView {
  const substitutions = row.substitutions ?? [];
  const titles = row.recipeTitles ?? {};
  const adjusters = adjustersUsed([row.plan, ...(row.options?.items ?? []).map(i => i.option.plan)], allAdjusters);
  return {
    id: row.id,
    status: row.status,
    buildStatus: row.buildStatus,
    buildError: row.buildError,
    setup: row.setup,
    plan: row.plan,
    shopping: row.shopping,
    session: row.session,
    explanation: row.explanation,
    explanationByAI: row.explanationAi,
    options: optionViews(row.options, titles, adjusters),
    changes: planChanges(row.setup, row.plan, titles, adjusters),
    adjusters,
    wishes: row.wishesResult,
    recipeTitles: titles,
    progress: progressMap(progress),
    substitutions,
    unseenSubstitutions: substitutions.filter(s => !s.seenAt).length,
    sessionDate: row.sessionDate,
    calendarMealPlanId: row.calendarMealPlanId,
    groceryListId: row.groceryListId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    approvedAt: iso(row.approvedAt),
  };
}

export function toPlanSummary(row: PrepPlanRow): PrepPlanSummary {
  const titles = row.recipeTitles ?? {};
  return {
    id: row.id,
    status: row.status,
    buildStatus: row.buildStatus,
    sessionDate: row.sessionDate,
    days: row.setup.days,
    people: row.setup.people.length,
    dishes: (row.plan?.batches ?? []).map(b => titles[b.recipeId] ?? "A dish"),
    fitScore: row.plan ? Math.round(row.plan.fitScore) : null,
    unseenSubstitutions: (row.substitutions ?? []).filter(s => !s.seenAt).length,
    createdAt: row.createdAt.toISOString(),
  };
}

export function toShareView(share: PrepPlanShareRow, now: Date): PrepShareView {
  return {
    id: share.id,
    role: "cook",
    label: share.label,
    expiresAt: share.expiresAt.toISOString(),
    revokedAt: iso(share.revokedAt),
    createdAt: share.createdAt.toISOString(),
    active: shareState(share, now) === "active",
  };
}

export function toCookView(
  row: PrepPlanRow,
  share: PrepPlanShareRow,
  progress: ProgressRecord[],
  recipes: Array<{ id: string; title: string; servings: number; ingredients: string[]; instructions: string[] }>,
  allAdjusters: Adjuster[] = [],
): CookView {
  const batches = row.plan?.batches ?? [];
  const swaps = row.plan?.swapsApplied ?? [];
  const inPlan = new Set(batches.map(b => b.recipeId));
  const cookRecipes: CookRecipe[] = recipes
    .filter(r => inPlan.has(r.id))
    .map(r => ({
      id: r.id,
      title: r.title,
      servings: r.servings,
      scale: batches.find(b => b.recipeId === r.id)?.scale ?? 1,
      ingredients: r.ingredients,
      instructions: r.instructions,
      swaps: swaps.filter(s => s.recipeId === r.id).map(s => ({ swapId: s.swapId, title: s.title, goal: s.goal, note: s.note, changes: s.changes })),
    }));
  const allergies = new Set<string>();
  for (const p of row.setup.people) for (const a of p.allergies) allergies.add(a.trim().toLowerCase());
  return {
    planId: row.id,
    sessionDate: row.sessionDate,
    days: row.setup.days,
    session: row.session,
    shopping: row.shopping,
    recipes: cookRecipes,
    householdAllergies: Array.from(allergies).filter(Boolean).sort(),
    progress: progressMap(progress),
    substitutions: (row.substitutions ?? []).map(s => ({ id: s.id, ingredient: s.ingredient, replacement: s.replacement, at: s.at, note: s.note })),
    adjusters: adjustersUsed([row.plan], allAdjusters),
    expiresAt: share.expiresAt.toISOString(),
  };
}
