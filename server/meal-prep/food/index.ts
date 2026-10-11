// Food data for meal prep (part 1 of the contract in
// shared/meal-prep/contract.ts): RecipeFacts, adjusters and package sizes.
//
//   createFoodData()                         reads recipes from the database,
//                                            caches facts in meal_prep_recipe_facts
//   createFoodData({ source: fixtures })     in memory, for tests and other parts
//
// The cache tables come from migrations/2026-10-meal-prep-food.sql; until it's
// applied, facts are computed on every call (a few ms per recipe) and nothing
// is written.

import type { Adjuster, CanonicalIngredientRef, FoodData, Macros, RecipeFacts } from "@shared/meal-prep/contract";
import { Catalog, seedCatalog, type ItemMapEntry } from "./catalog";
import { buildAdjusters } from "./adjusters";
import { computeRecipeFacts, type PreferenceInput, type RecipeInput } from "./facts";
import { packagesFor } from "./packages";
import ingredientsSeed from "./data/ingredients.json";
import itemMapSeed from "./data/item-map.json";

export { computeRecipeFacts, type RecipeInput } from "./facts";
export { seedCatalog, Catalog } from "./catalog";
export { buildAdjusters } from "./adjusters";
export { parseUnit, toGrams } from "./units";

/** Bumped automatically when the seeds change, so cached facts are recomputed */
export const FOOD_DATA_VERSION = `v1-${hash(JSON.stringify(ingredientsSeed) + JSON.stringify(itemMapSeed))}`;

type Package = { label: string; grams: number; price?: number };

export interface FixtureSource {
  facts: RecipeFacts[];
  adjusters?: Adjuster[];
  packages?: Record<string, Package[]>;
}

type Query = (sql: string, params?: unknown[]) => Promise<{ rows: any[] }>;

export interface FoodDataOptions {
  /** in-memory data instead of the database */
  source?: FixtureSource;
  /** database access (defaults to the app's shared pool) */
  query?: Query;
  catalog?: Catalog;
}

export function createFoodData(opts: FoodDataOptions = {}): FoodData {
  if (opts.source) return fixtureFoodData(opts.source, opts.catalog ?? seedCatalog());
  return dbFoodData(opts.query, opts.catalog ?? seedCatalog());
}

function fixtureFoodData(source: FixtureSource, catalog: Catalog): FoodData {
  const byId = new Map(source.facts.map((f) => [f.recipeId, f]));
  return {
    async factsFor(ids) {
      return ids.map((id) => byId.get(id)).filter((f): f is RecipeFacts => !!f);
    },
    async adjusters() {
      return source.adjusters ?? buildAdjusters(catalog);
    },
    async packagesFor(ids) {
      if (source.packages) return Object.fromEntries(ids.map((id) => [id, source.packages![id] ?? []]));
      return packagesFor(ids);
    },
    async ingredientNutrition(names) {
      return ingredientNutrition(catalog, names);
    },
  };
}

const RECIPE_COLUMNS = `id, title, servings, ingredients, normalized_ingredients, meal_type, cuisines, cuisine, allergens,
  prep_time_minutes, cook_time_minutes, total_time_minutes, calories, protein, carbohydrates, fat, fiber,
  tips, total_cost, cooking_methods, owner_user_id, updated_at`;

export function recipeInputFromRow(r: any): RecipeInput {
  return {
    id: r.id, title: r.title, servings: r.servings, ingredients: r.ingredients ?? [],
    normalizedIngredients: r.normalized_ingredients, mealType: r.meal_type, cuisines: r.cuisines, cuisine: r.cuisine,
    allergens: r.allergens, prepTimeMinutes: r.prep_time_minutes, cookTimeMinutes: r.cook_time_minutes,
    totalTimeMinutes: r.total_time_minutes, calories: r.calories, protein: r.protein, carbohydrates: r.carbohydrates,
    fat: r.fat, fiber: r.fiber, tips: r.tips, totalCost: r.total_cost, cookingMethods: r.cooking_methods, updatedAt: r.updated_at,
  };
}

function dbFoodData(queryIn: Query | undefined, catalog: Catalog): FoodData {
  const query: Query = queryIn ?? (async (sql, params) => {
    const { getSharedPool } = await import("../../pg-pool");
    return getSharedPool().query(sql, params as any[]);
  });
  let tablesReady: boolean | null = null;
  let learnedAt = 0;

  async function ready(): Promise<boolean> {
    if (tablesReady != null) return tablesReady;
    try {
      const { rows } = await query(`SELECT to_regclass('public.meal_prep_recipe_facts') IS NOT NULL AS facts, to_regclass('public.meal_prep_item_map') IS NOT NULL AS map`);
      tablesReady = !!rows[0]?.facts && !!rows[0]?.map;
    } catch {
      tablesReady = false;
    }
    return tablesReady;
  }

  // Item names reviewed or learned after the seed was made (refreshed every 10 minutes)
  async function learn() {
    if (Date.now() - learnedAt < 10 * 60 * 1000 || !(await ready())) return;
    learnedAt = Date.now();
    const { rows } = await query(`SELECT item, ingredient_id, confidence, method FROM meal_prep_item_map`);
    catalog.learn(rows.map((r): ItemMapEntry => ({ item: r.item, id: r.ingredient_id, confidence: Number(r.confidence), method: r.method })));
  }

  return {
    async factsFor(ids) {
      if (!ids.length) return [];
      await learn().catch((e) => console.warn("[MealPrep] item map not loaded:", e.message));
      const { rows: recipes } = await query(`SELECT ${RECIPE_COLUMNS} FROM recipes WHERE id = ANY($1::varchar[])`, [ids]);
      const useCache = await ready();
      const cached = new Map<string, RecipeFacts>();
      if (useCache) {
        const { rows } = await query(
          `SELECT recipe_id, recipe_updated_at, version, facts FROM meal_prep_recipe_facts WHERE recipe_id = ANY($1::varchar[])`, [ids]);
        const updated = new Map(recipes.map((r) => [r.id, new Date(r.updated_at).getTime()]));
        for (const row of rows) {
          if (row.version === FOOD_DATA_VERSION && new Date(row.recipe_updated_at).getTime() === updated.get(row.recipe_id)) cached.set(row.recipe_id, row.facts);
        }
      }
      const prefs = await preferences(query, recipes);
      const out = new Map<string, RecipeFacts>();
      for (const r of recipes) {
        const pref = prefs.get(r.id) ?? { rating: null, favorite: false, recentCount: 0 };
        const hit = cached.get(r.id);
        // Preference changes daily, so it's always fresh rather than cached
        if (hit) { out.set(r.id, { ...hit, preference: pref }); continue; }
        const facts = computeRecipeFacts(recipeInputFromRow(r), catalog, { preference: pref });
        out.set(r.id, facts);
        if (useCache) {
          await query(
            `INSERT INTO meal_prep_recipe_facts (recipe_id, recipe_updated_at, version, facts, confidence, computed_at)
             VALUES ($1, $2, $3, $4, $5, now())
             ON CONFLICT (recipe_id) DO UPDATE SET recipe_updated_at = EXCLUDED.recipe_updated_at, version = EXCLUDED.version,
               facts = EXCLUDED.facts, confidence = EXCLUDED.confidence, computed_at = now()`,
            [r.id, r.updated_at, FOOD_DATA_VERSION, JSON.stringify(facts), facts.confidence],
          ).catch((e) => console.warn("[MealPrep] facts cache write failed:", e.message));
        }
      }
      return ids.map((id) => out.get(id)).filter((f): f is RecipeFacts => !!f);
    },
    async adjusters() {
      return buildAdjusters(catalog);
    },
    async packagesFor(ids) {
      return packagesFor(ids);
    },
    async ingredientNutrition(names) {
      await learn().catch(() => undefined);
      return ingredientNutrition(catalog, names);
    },
  };
}

/** Canonical ingredient + USDA macros per gram for free-text names ("almond milk", "chicken-thigh") */
export function ingredientNutrition(catalog: Catalog, names: string[]): Record<string, { ingredient: CanonicalIngredientRef; perGram: Macros } | null> {
  const out: Record<string, { ingredient: CanonicalIngredientRef; perGram: Macros } | null> = {};
  for (const name of names) {
    // A canonical id works too; a weak guess (below 0.7) is treated as unknown
    const direct = catalog.byId.get(name);
    const r = direct ? { ingredient: direct, confidence: 1 } : catalog.resolve(name);
    if (!r || r.confidence < 0.7) { out[name] = null; continue; }
    const p = r.ingredient.per100g;
    out[name] = {
      ingredient: catalog.ref(r.ingredient.id),
      perGram: { kcal: p.kcal / 100, protein: p.protein / 100, carbs: p.carbs / 100, fat: p.fat / 100, fiber: (p.fiber ?? 0) / 100 },
    };
  }
  return out;
}

/**
 * Owner's liking. There are no ratings in the schema yet, so rating is null;
 * favorite = the owner bookmarked it; recentCount = times on the owner's meal
 * plans in the last 28 days.
 */
async function preferences(query: Query, recipes: any[]): Promise<Map<string, PreferenceInput>> {
  const out = new Map<string, PreferenceInput>();
  if (!recipes.length) return out;
  const ids = recipes.map((r) => r.id);
  try {
    const [{ rows: marks }, { rows: recent }] = await Promise.all([
      query(`SELECT b.recipe_id FROM bookmarks b JOIN recipes r ON r.id = b.recipe_id AND r.owner_user_id = b.user_id WHERE b.recipe_id = ANY($1::varchar[])`, [ids]),
      query(`SELECT e.recipe_id, count(*)::int AS n FROM meal_plan_entries e JOIN meal_plans p ON p.id = e.meal_plan_id
             JOIN recipes r ON r.id = e.recipe_id AND r.owner_user_id = p.owner_user_id
             WHERE e.recipe_id = ANY($1::varchar[]) AND e.date >= now() - interval '28 days' AND e.date <= now() + interval '1 day'
             GROUP BY e.recipe_id`, [ids]),
    ]);
    const fav = new Set(marks.map((m) => m.recipe_id));
    const counts = new Map(recent.map((x) => [x.recipe_id, Number(x.n)]));
    for (const id of ids) out.set(id, { rating: null, favorite: fav.has(id), recentCount: counts.get(id) ?? 0 });
  } catch (e: any) {
    console.warn("[MealPrep] preferences not loaded:", e.message);
  }
  return out;
}

function hash(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}
