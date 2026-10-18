// What the AI connector's tools read and write. Production wiring
// (server/mcp/wiring.ts) maps these onto `storage`; tests use in-memory fakes.
//
// Every method takes the Grammie user id and must only return what that user
// may see in the app: their own things, things shared with them, and public
// recipes. Admin overrides are NOT applied here (an admin's AI assistant sees
// what any other user would).

import type { Recipe, InsertRecipe, PantryItem, GroceryListItem } from "@shared/schema";
import type { UserPreferences } from "@shared/food-profile";
import type { RecipeFilterParams } from "../pg-storage";
import type { MatchableRecipe } from "../lib/what-can-i-make";

/** The card fields search and cookbook listings return */
export interface RecipeCard {
  id: string;
  title: string;
  description?: string | null;
  totalTimeMinutes?: number | null;
  prepTimeMinutes?: number | null;
  cookTimeMinutes?: number | null;
  servings: number;
  ownerUserId: string | null;
  isPublic: boolean;
  cuisines?: string[] | null;
  mealType?: string[] | null;
  isVegetarian?: boolean | null;
  isVegan?: boolean | null;
  isGlutenFree?: boolean | null;
  isDairyFree?: boolean | null;
  allergens?: string[] | null;
}

export interface CookbookSummary {
  id: number;
  name: string;
  description?: string | null;
  ownerUserId: string;
  isPublic: boolean;
  recipeCount?: number;
}

export type CookbookAccess = "owner" | "collaborator" | "public";

export interface MealPlanSummary {
  id: string;
  name: string;
  ownerUserId: string;
  startDate: Date;
  endDate: Date;
  status: string;
  updatedAt?: Date | null;
}

export interface MealPlanEntryView {
  id: string;
  date: Date;
  mealSlot: string;
  position?: number;
  recipeId: string | null;
  recipeTitle: string | null;
  customMealName: string | null;
  scaledServings: number | null;
  notes: string | null;
}

export type RecipeScope = "all" | "mine" | "shared";

export interface McpData {
  searchRecipes(userId: string, opts: { scope: RecipeScope; filters: RecipeFilterParams; limit: number }): Promise<{ recipes: RecipeCard[]; total: number }>;
  /** Owner, public, or shared with the user; never an admin override */
  getRecipe(recipeId: string, userId: string): Promise<Recipe | undefined>;

  listCookbooks(userId: string): Promise<{ owned: CookbookSummary[]; shared: CookbookSummary[] }>;
  getCookbook(cookbookId: number, userId: string): Promise<{ cookbook: CookbookSummary; access: CookbookAccess } | undefined>;
  getCookbookRecipes(cookbookId: number, limit: number): Promise<{ recipes: RecipeCard[]; total: number }>;

  getPantryItems(userId: string): Promise<PantryItem[]>;
  getRecipesForPantryMatching(userId: string): Promise<MatchableRecipe[]>;
  getPreferences(userId: string): Promise<UserPreferences | null>;

  getGroceryItems(userId: string): Promise<GroceryListItem[]>;
  addRecipeToGroceryList(userId: string, recipeId: string, scale: number): Promise<void>;
  addGroceryItem(userId: string, item: { item: string; quantity?: number; unit?: string }): Promise<void>;

  /** Active, non-template plans the user owns or collaborates on */
  listMealPlans(userId: string): Promise<MealPlanSummary[]>;
  getMealPlanEntries(mealPlanId: string, userId: string): Promise<MealPlanEntryView[] | undefined>;
  canEditMealPlan(mealPlanId: string, userId: string): Promise<boolean>;
  createMealPlan(plan: { ownerUserId: string; name: string; startDate: Date; endDate: Date }): Promise<MealPlanSummary>;
  addMealPlanEntry(entry: {
    mealPlanId: string; date: Date; mealSlot: "breakfast" | "lunch" | "dinner" | "snack";
    recipeId: string; scaledServings?: number; notes?: string;
  }): Promise<{ id: string }>;

  createRecipe(recipe: InsertRecipe): Promise<{ id: string; title: string }>;
}

/** Credits and the background enrichment job, for create_recipe with enrich: true */
export interface McpEnrichment {
  /** Same check as gate(): ok when credits are off or the balance covers one import */
  canAfford(userId: string): Promise<{ ok: true } | { ok: false; message: string }>;
  /** Charges one recipe_import for this recipe (after the recipe is saved) */
  charge(userId: string, recipeId: string): Promise<void>;
  /** Queues the normal enrichment + dish photo jobs */
  queue(recipe: { id: string; title: string; ingredients: string[] }): void;
}
