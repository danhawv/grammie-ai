// A cook swaps an ingredient during the session ("no sour cream, used Greek
// yogurt"). We find the recipes that use it, and when food data knows both
// ingredients per gram, shift the affected plates and container labels by
// the exact difference. Otherwise the labels keep their numbers but are
// marked low confidence. The recipes themselves are never changed.

import type {
  Confidence, MacroKey, Macros, PrepPlan, PrepSession, RecipeFacts,
} from "@shared/meal-prep/contract";
import { extractIngredientName, namesMatch, normalizeIngredient } from "@shared/pantry-match";

const KEYS: MacroKey[] = ["kcal", "protein", "carbs", "fat"];

export interface MatchedLine {
  recipeId: string;
  grams: number | null;
  /** canonical name when known, else the name read from the line */
  name: string;
}

/** Ingredient lines (not optional ones) in these recipes that are the named ingredient */
export function matchIngredientLines(facts: RecipeFacts[], ingredient: string): MatchedLine[] {
  const want = normalizeIngredient(ingredient);
  if (!want) return [];
  const out: MatchedLine[] = [];
  for (const f of facts) {
    for (const line of f.lines) {
      const names = [
        line.ingredient ? normalizeIngredient(line.ingredient.name) : "",
        line.ingredient ? normalizeIngredient(line.ingredient.id.replace(/-/g, " ")) : "",
        normalizeIngredient(extractIngredientName(line.raw)),
      ].filter(Boolean);
      if (names.some(n => namesMatch(n, want))) {
        out.push({ recipeId: f.recipeId, grams: line.grams, name: line.ingredient?.name ?? extractIngredientName(line.raw) });
      }
    }
  }
  return out;
}

type PerGram = Macros | null;

/**
 * Change in macros per serving of each recipe when `from` becomes `to`, or
 * null for a recipe whose amounts or nutrition aren't known.
 */
export function deltaPerServing(facts: RecipeFacts[], lines: MatchedLine[], from: PerGram, to: PerGram): Map<string, Macros | null> {
  const servings = new Map(facts.map(f => [f.recipeId, f.servings || 1]));
  const out = new Map<string, Macros | null>();
  for (const line of lines) {
    const prev = out.get(line.recipeId);
    if (prev === null) continue;
    if (!from || !to || line.grams == null) {
      out.set(line.recipeId, null);
      continue;
    }
    const acc: Macros = prev ?? { kcal: 0, protein: 0, carbs: 0, fat: 0 };
    const per = servings.get(line.recipeId) ?? 1;
    for (const k of KEYS) acc[k] += (line.grams * ((to[k] ?? 0) - (from[k] ?? 0))) / per;
    out.set(line.recipeId, acc);
  }
  return out;
}

const LOWER: Record<Confidence, Confidence> = { high: "medium", medium: "medium", low: "low" };

export interface SubstitutionResult {
  plan: PrepPlan;
  session: PrepSession | null;
  recipeIds: string[];
  labelKeys: string[];
  nutritionUpdated: boolean;
  note: string;
}

function add(a: Macros, b: Macros, times = 1): Macros {
  const out: Macros = { ...a };
  for (const k of KEYS) out[k] = (a[k] ?? 0) + (b[k] ?? 0) * times;
  return out;
}

function rounded(m: Macros): Macros {
  const out: Macros = { ...m };
  for (const k of KEYS) out[k] = Math.max(0, Math.round(m[k]));
  return out;
}

/** Applies a swap to copies of the plan and session */
export function applySubstitution(input: {
  plan: PrepPlan;
  session: PrepSession | null;
  facts: RecipeFacts[];
  titles: Record<string, string>;
  ingredient: string;
  replacement: string;
  /** per-gram nutrition of the original and the replacement, if known */
  from: PerGram;
  to: PerGram;
}): SubstitutionResult {
  const plan: PrepPlan = structuredClone(input.plan);
  const session: PrepSession | null = input.session ? structuredClone(input.session) : null;
  const planRecipes = new Set(plan.batches.map(b => b.recipeId));
  const lines = matchIngredientLines(input.facts.filter(f => planRecipes.has(f.recipeId)), input.ingredient);
  const recipeIds = Array.from(new Set(lines.map(l => l.recipeId)));

  if (recipeIds.length === 0) {
    return {
      plan, session, recipeIds, labelKeys: [], nutritionUpdated: false,
      note: `Used ${input.replacement} instead of ${input.ingredient}, which isn't in this week's recipes, so the labels didn't change.`,
    };
  }

  const deltas = deltaPerServing(input.facts, lines, input.from, input.to);
  const nutritionUpdated = recipeIds.every(id => deltas.get(id) != null);

  // Shift each affected plate by its recipe portions' change
  const plateDelta = new Map<string, Macros>();
  const touched = new Set<string>();
  for (const plate of plan.plates) {
    const key = `${plate.personId}:${plate.day}:${plate.slot}`;
    let plateChange: Macros = { kcal: 0, protein: 0, carbs: 0, fat: 0 };
    for (const item of plate.items) {
      if (item.kind !== "recipe" || !recipeIds.includes(item.refId)) continue;
      touched.add(key);
      const d = deltas.get(item.refId);
      if (!d) continue;
      item.macros = add(item.macros, d, item.amount);
      plateChange = add(plateChange, d, item.amount);
    }
    if (touched.has(key) && nutritionUpdated) {
      plate.macros = add(plate.macros, plateChange);
      plateDelta.set(key, plateChange);
    }
  }
  if (nutritionUpdated) {
    for (const fit of plan.fit) {
      for (const [key, d] of Array.from(plateDelta.entries())) {
        const [personId, day] = key.split(":");
        if (fit.personId === personId && String(fit.day) === day) fit.macros = add(fit.macros, d);
      }
    }
  }

  const labelKeys: string[] = [];
  for (const label of session?.labels ?? []) {
    if (!touched.has(label.plateKey)) continue;
    labelKeys.push(label.plateKey);
    if (nutritionUpdated) {
      label.macros = rounded(add(label.macros, plateDelta.get(label.plateKey) ?? { kcal: 0, protein: 0, carbs: 0, fat: 0 }));
      label.confidence = LOWER[label.confidence];
    } else {
      label.confidence = "low";
    }
  }

  const dishes = recipeIds.map(id => input.titles[id] ?? "a dish").join(", ");
  const note = `Used ${input.replacement} instead of ${input.ingredient} in ${dishes}.` +
    (nutritionUpdated ? " The labels were updated to match." : " The labels' numbers are rougher now.");
  return { plan, session, recipeIds, labelKeys, nutritionUpdated, note };
}
