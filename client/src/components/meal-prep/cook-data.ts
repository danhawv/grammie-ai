import { useQueries } from "@tanstack/react-query";
import type { PrepSession, PrepSetup, ShoppingList } from "@shared/meal-prep/contract";
import type { CookView, PrepPlanView, TaskProgress } from "@shared/meal-prep/api";

// Cook mode and the packet work for two people: the owner (signed in, by plan
// id) and a hired cook (no account, by share token). The API gives them
// different shapes (PrepPlanView vs CookView); these helpers turn both into
// one, so the screens don't care who's looking.

export type CookSource = { kind: "owner"; id: string } | { kind: "cook"; token: string };

export interface CookDish {
  id: string;
  title: string;
  /** recipe multiplier */
  scale: number;
  servingsMade: number | null;
  /** the recipe as written, when we have it */
  servings?: number;
  ingredients?: string[];
  instructions?: string[];
}

export interface CookData {
  planId: string;
  sessionDate: string | null;
  days: number;
  /** owner only; the cook's view leaves out people's details */
  setup: PrepSetup | null;
  session: PrepSession;
  shopping: ShoppingList | null;
  titles: Record<string, string>;
  dishes: CookDish[];
  householdAllergies: string[];
  progress: Record<string, TaskProgress>;
  substitutions: Array<{ id: string; ingredient: string; replacement: string; note: string }>;
  /** how many people cook at once */
  cooks: number;
}

function cooksIn(session: PrepSession, setup: PrepSetup | null): number {
  return setup?.session.cooks ?? Math.max(1, ...session.tasks.map((t) => t.cook));
}

export function fromPlanView(v: PrepPlanView): CookData | null {
  if (!v.session) return null;
  const allergies = new Set(v.setup.people.flatMap((p) => p.allergies.map((a) => a.trim().toLowerCase())).filter(Boolean));
  return {
    planId: v.id,
    sessionDate: v.sessionDate ?? v.setup.session.date,
    days: v.setup.days,
    setup: v.setup,
    session: v.session,
    shopping: v.shopping,
    titles: v.recipeTitles,
    dishes: (v.plan?.batches ?? []).map((b) => ({ id: b.recipeId, title: v.recipeTitles[b.recipeId] ?? "A dish", scale: b.scale, servingsMade: b.servingsMade })),
    householdAllergies: Array.from(allergies).sort(),
    progress: v.progress,
    substitutions: v.substitutions.map(({ id, ingredient, replacement, note }) => ({ id, ingredient, replacement, note })),
    cooks: cooksIn(v.session, v.setup),
  };
}

export function fromCookView(v: CookView): CookData | null {
  if (!v.session) return null;
  return {
    planId: v.planId,
    sessionDate: v.sessionDate,
    days: v.days,
    setup: null,
    session: v.session,
    shopping: v.shopping,
    titles: Object.fromEntries(v.recipes.map((r) => [r.id, r.title])),
    dishes: v.recipes.map((r) => ({ ...r, servingsMade: Math.round(r.servings * r.scale) || null })),
    householdAllergies: v.householdAllergies,
    progress: v.progress,
    substitutions: v.substitutions,
    cooks: cooksIn(v.session, null),
  };
}

/** Recipe title for an id; adjusters ("rice-cooked") and unknown ids get plain words */
export function titleFor(titles: Record<string, string>, id: string): string {
  return titles[id] ?? (id.endsWith("-cooked") ? id.replace(/-cooked$/, "").replace(/-/g, " ") : "A dish");
}

/** Titles we know for these ids, leaving out ones we don't (rather than "A dish") */
export function knownTitles(titles: Record<string, string>, ids: string[]): string[] {
  return ids.map((id) => titles[id]).filter((t): t is string => !!t);
}

interface RecipeLike {
  dishImageThumbnail?: string | null;
  ingredients?: string[];
  instructions?: string[];
  servings?: number | null;
}

/**
 * The owner's own recipes, for dish photos and (in the packet) the written
 * recipe. Uses the app's existing recipe endpoint and cache.
 */
export function useOwnerRecipes(ids: string[], enabled = true) {
  const results = useQueries({
    queries: ids.map((id) => ({ queryKey: ["/api/recipes", id], enabled, staleTime: 5 * 60_000, retry: false })),
  });
  const byId: Record<string, RecipeLike> = {};
  results.forEach((r, i) => { if (r.data) byId[ids[i]] = r.data as RecipeLike; });
  return byId;
}

/** A real photo, not the generated placeholder art */
export function photoOf(r: RecipeLike | undefined): string | null {
  const src = r?.dishImageThumbnail;
  return src && !src.startsWith("data:image/svg") ? src : null;
}
