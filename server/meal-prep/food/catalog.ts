// The canonical ingredient catalog: one entry per ingredient we know well
// (USDA macros per 100 g, grams per household measure, usual pack size), plus
// the map from the item names recipes actually use to those entries. Both
// live in committed JSON seeds (data/) so they can be reviewed in git; the
// migration mirrors them into tables for SQL use and for names learned later.

import type { Aisle, CanonicalIngredientRef, Macros } from "@shared/meal-prep/contract";
import type { GramFacts, PortionKey } from "./units";
import { Matcher, type MatchResult } from "./match";
import ingredientsSeed from "./data/ingredients.json";
import itemMapSeed from "./data/item-map.json";

export interface CatalogIngredient {
  id: string;
  name: string;
  aisle: Aisle;
  /** USDA FoodData Central id, null for label data */
  fdcId: number | null;
  usdaDescription: string | null;
  source: "usda-sr" | "usda-foundation" | "label";
  /** per 100 g, as sold (raw unless `cooked`) */
  per100g: Macros & { fiber: number };
  /** grams per US cup (density) */
  cup: number | null;
  /** grams per household portion ("medium" onion = 110 g, "clove" garlic = 3 g) */
  portions: Partial<Record<PortionKey, number>>;
  /** grams in the usual can/jar/package a line might say ("1 can") */
  pack: number | null;
  allergens: string[];
  /** main-protein kind when this is the star of a dish */
  protein: string | null;
  cooked: boolean;
  aliases: string[];
}

export interface ItemMapEntry {
  /** lowercased item name as recipes write it */
  item: string;
  id: string | null;
  /** 0..1 */
  confidence: number;
  method: MatchResult["method"] | "none";
}

export class Catalog {
  readonly byId = new Map<string, CatalogIngredient>();
  private itemMap = new Map<string, ItemMapEntry>();
  readonly matcher: Matcher;

  constructor(ingredients: CatalogIngredient[], itemMap: ItemMapEntry[] = []) {
    for (const i of ingredients) this.byId.set(i.id, i);
    for (const e of itemMap) this.itemMap.set(e.item, e);
    this.matcher = new Matcher(ingredients.flatMap((i) => [i.name, ...i.aliases].map((alias) => ({ id: i.id, alias }))));
  }

  /** Add mappings learned at runtime (e.g. from the meal_prep_item_map table) */
  learn(entries: ItemMapEntry[]) {
    for (const e of entries) this.itemMap.set(e.item, e);
  }

  ref(id: string): CanonicalIngredientRef {
    const i = this.byId.get(id);
    if (!i) throw new Error(`Unknown ingredient ${id}`);
    return { id: i.id, name: i.name, aisle: i.aisle };
  }

  /** Canonical ingredient for a recipe's item name: reviewed map first, then the matcher */
  resolve(item: string): { ingredient: CatalogIngredient; confidence: number; method: string } | null {
    const key = (item ?? "").toLowerCase().trim();
    if (!key) return null;
    const mapped = this.itemMap.get(key);
    if (mapped) {
      if (!mapped.id) return null;
      const ing = this.byId.get(mapped.id);
      return ing ? { ingredient: ing, confidence: mapped.confidence, method: mapped.method } : null;
    }
    const m = this.matcher.match(item);
    if (!m) return null;
    const ing = this.byId.get(m.id);
    return ing ? { ingredient: ing, confidence: m.score, method: m.method } : null;
  }

  gramFacts(i: CatalogIngredient): GramFacts {
    return { cup: i.cup ?? undefined, portions: i.portions, pack: i.pack ?? undefined, aisle: i.aisle };
  }
}

let shared: Catalog | null = null;
/** The catalog from the committed seeds (cached) */
export function seedCatalog(): Catalog {
  if (!shared) shared = new Catalog(ingredientsSeed as CatalogIngredient[], itemMapSeed as ItemMapEntry[]);
  return shared;
}
