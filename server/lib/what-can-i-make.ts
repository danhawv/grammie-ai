// "What can I make?": ranks the recipes a person can see by how much of each
// their pantry covers, leaving out what their food profile says to avoid.
// Shared by GET /api/recipes/what-can-i-make and the AI connector (server/mcp).
// Pure: the caller loads the pantry, recipes and preferences.

import { getFoodProfile, type UserPreferences } from "@shared/food-profile";
import { namesMatch, normalizeIngredient, rankRecipesByPantry, recipeIngredients, type RecipeIngredientSource } from "@shared/pantry-match";

export interface PantryRow {
  name: string;
  expiresAt: Date | string | null;
}

export interface MatchableRecipe extends RecipeIngredientSource {
  id: string;
  title: string;
  ownerUserId: string | null;
  dishImageThumbnail?: string | null;
  prepTimeMinutes?: number | null;
  cookTimeMinutes?: number | null;
  totalTimeMinutes?: number | null;
  servings: number;
  cuisines?: string[] | null;
  isVegetarian?: boolean | null;
  isVegan?: boolean | null;
  isGlutenFree?: boolean | null;
  isDairyFree?: boolean | null;
}

export interface WhatCanIMakeResult<P extends PantryRow> {
  pantryItemCount: number;
  recipesChecked: number;
  appliedFilters: { dietaryRestrictions: string[]; dislikedIngredients: string[] };
  results: Array<{
    recipe: { id: string; title: string; image: string | null; totalTimeMinutes: number | null; servings: number; cuisine: string | null };
    haveCount: number;
    total: number;
    have: Array<{ ingredient: string; pantryItem: string }>;
    missing: string[];
    staples: string[];
    expiringItemsUsed: number;
  }>;
}

export function whatCanIMake<P extends PantryRow>(input: {
  userId: string;
  pantryItems: P[];
  recipes: MatchableRecipe[];
  preferences: UserPreferences | null | undefined;
  now?: number;
  limit?: number;
}): WhatCanIMakeResult<P> {
  const { userId, pantryItems } = input;
  const foodProfile = getFoodProfile(input.preferences);
  const dietaryRestrictions: string[] = foodProfile.diets;
  const dislikedIngredients: string[] = foodProfile.avoidAll;
  const appliedFilters = { dietaryRestrictions, dislikedIngredients };

  if (pantryItems.length === 0) {
    return { pantryItemCount: 0, results: [], recipesChecked: 0, appliedFilters };
  }

  let recipesList = input.recipes;
  if (dietaryRestrictions.length > 0) {
    recipesList = recipesList.filter((recipe) => {
      if (dietaryRestrictions.includes("vegetarian") && !recipe.isVegetarian) return false;
      if (dietaryRestrictions.includes("vegan") && !recipe.isVegan) return false;
      if (dietaryRestrictions.includes("gluten-free") && !recipe.isGlutenFree) return false;
      if (dietaryRestrictions.includes("dairy-free") && !recipe.isDairyFree) return false;
      return true;
    });
  }

  if (dislikedIngredients.length > 0) {
    const disliked = dislikedIngredients.map((d) => normalizeIngredient(d)).filter(Boolean);
    recipesList = recipesList.filter((recipe) =>
      !recipeIngredients(recipe).some((ing) => {
        const n = normalizeIngredient(ing.name);
        return disliked.some((d) => n === d || namesMatch(n, d) || n.split(" ").includes(d));
      }),
    );
  }

  // Own recipes first, so a public copy of the same dish doesn't push yours out
  recipesList = [...recipesList].sort((a, b) => Number(b.ownerUserId === userId) - Number(a.ownerUserId === userId));
  const seenTitles = new Set<string>();
  const ranked = rankRecipesByPantry(recipesList, pantryItems)
    .filter((r) => {
      // Show each dish once (libraries often hold several copies)
      const key = r.recipe.title.trim().toLowerCase();
      if (seenTitles.has(key)) return false;
      seenTitles.add(key);
      return true;
    })
    .slice(0, input.limit ?? 60);

  const now = input.now ?? Date.now();
  const expiryThreshold = now + 3 * 24 * 60 * 60 * 1000;
  const isExpiringSoon = (p: PantryRow) => !!p.expiresAt && new Date(p.expiresAt).getTime() <= expiryThreshold;

  const results = ranked.map((r) => ({
    recipe: {
      id: r.recipe.id,
      title: r.recipe.title,
      image: r.recipe.dishImageThumbnail ?? null,
      totalTimeMinutes:
        r.recipe.totalTimeMinutes ??
        ((r.recipe.prepTimeMinutes || r.recipe.cookTimeMinutes)
          ? (r.recipe.prepTimeMinutes || 0) + (r.recipe.cookTimeMinutes || 0)
          : null),
      servings: r.recipe.servings,
      cuisine: r.recipe.cuisines?.[0] ?? null,
    },
    haveCount: r.haveCount,
    total: r.total,
    have: r.have.map((h) => ({ ingredient: h.ingredient, pantryItem: h.pantryItem.name })),
    missing: r.missing,
    staples: r.staples,
    expiringItemsUsed: r.have.filter((h) => isExpiringSoon(h.pantryItem)).length,
  }));

  return { pantryItemCount: pantryItems.length, recipesChecked: recipesList.length, results, appliedFilters };
}
