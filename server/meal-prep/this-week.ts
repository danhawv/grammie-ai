// "Add to this week's meal prep" from a recipe's menu: which plan counts as
// this week's, and how a new plan is shaped from the saved defaults when
// there isn't one. Pure functions; the route (POST /this-week/recipes) does
// the writes.

import type { PrepSetup } from "@shared/meal-prep/contract";
import type { PrepProfileDefaults } from "@shared/meal-prep/api";
import type { PrepPlanRow } from "./store";
import { eatingDate } from "./calendar";

const DAY_MS = 24 * 60 * 60 * 1000;

/** ISO date `days` after an ISO date (UTC, like the rest of the calendar maths) */
export function addDays(iso: string, days: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

type ActivePlan = Pick<PrepPlanRow, "status" | "setup" | "createdAt">;

/**
 * The plan a recipe should join: the newest draft or approved plan whose
 * eating days aren't over yet. A plan that starts within the next week wins
 * over one further out (the family is shopping for this week, not next
 * month). Cancelled and finished plans never count. Null = start a new one.
 */
export function currentPlan<T extends ActivePlan>(plans: T[], today: string): T | null {
  const open = plans
    .filter(p => (p.status === "draft" || p.status === "approved") && eatingDate(p.setup, p.setup.days - 1) >= today)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const soon = open.filter(p => eatingDate(p.setup, 0) <= addDays(today, 6));
  return soon[0] ?? open[0] ?? null;
}

/** The first eating day (index) of a plan that is today or later; null when they've all passed */
export function nextEatingDay(setup: PrepSetup, today: string): number | null {
  for (let day = 0; day < setup.days; day++) {
    if (eatingDate(setup, day) >= today) return day;
  }
  return null;
}

/**
 * The next cooking day: the weekday the family cooked on last time (their
 * most recent plan), else Sunday. Today counts when it's that weekday.
 */
export function nextSessionDate(plans: Array<Pick<PrepPlanRow, "sessionDate" | "createdAt">>, today: string): string {
  const latest = [...plans].filter(p => p.sessionDate).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
  const weekday = latest?.sessionDate ? new Date(`${latest.sessionDate}T00:00:00Z`).getUTCDay() : 0;
  const todayDay = new Date(`${today}T00:00:00Z`).getUTCDay();
  return addDays(today, (weekday - todayDay + 7) % 7);
}

/**
 * A full setup from the walkthrough's saved answers, for a plan started
 * from a recipe. Null when the answers don't cover the basics (people and
 * kitchen): the screen then opens the walkthrough instead.
 */
export function setupFromProfile(defaults: PrepProfileDefaults, date: string, pinnedRecipeIds: string[]): PrepSetup | null {
  if (!defaults.people?.length || !defaults.kitchen) return null;
  return {
    people: defaults.people,
    days: defaults.days ?? 5,
    startSameDay: defaults.startSameDay,
    kitchen: defaults.kitchen,
    session: { maxMinutes: 240, cooks: 1, helper: false, skill: "home", ...(defaults.session ?? {}), date },
    maxDishes: defaults.maxDishes,
    maxRepeats: defaults.maxRepeats,
    budget: defaults.budget,
    recipeSource: defaults.recipeSource,
    allowSwaps: defaults.allowSwaps,
    topUps: defaults.topUps,
    dessertsPerWeek: defaults.dessertsPerWeek,
    shakeId: defaults.shakeId,
    pinnedRecipeIds,
  };
}
