// Row -> response shapes (shared/meal-prep/api.ts). The cook view is built
// field by field from an allowlist, so nothing private (owner, targets,
// budget, wishes, check-ins, other recipes) can slip through.

import type {
  CookRecipe, CookView, PrepPlanSummary, PrepPlanView, PrepShareView, TaskProgress,
} from "@shared/meal-prep/api";
import type { PrepPlanRow, PrepPlanShareRow, ProgressRecord } from "./store";
import { shareState } from "./share";

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

export function progressMap(progress: ProgressRecord[]): Record<string, TaskProgress> {
  const out: Record<string, TaskProgress> = {};
  for (const p of progress) out[p.taskId] = { doneAt: p.doneAt.toISOString(), by: p.doneBy };
  return out;
}

export function toPlanView(row: PrepPlanRow, progress: ProgressRecord[]): PrepPlanView {
  const substitutions = row.substitutions ?? [];
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
    wishes: row.wishesResult,
    recipeTitles: row.recipeTitles ?? {},
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
): CookView {
  const batches = row.plan?.batches ?? [];
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
    expiresAt: share.expiresAt.toISOString(),
  };
}
