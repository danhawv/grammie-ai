import type { RecipeFilterParams } from "../pg-storage";

/**
 * Parse a comma-separated query string value into an array of trimmed strings.
 * Returns undefined if the value is empty or not a string.
 */
export function parseArray(val: string | undefined): string[] | undefined {
  if (!val) return undefined;
  if (typeof val === 'string') {
    const arr = val.split(',').map((s: string) => s.trim()).filter(Boolean);
    return arr.length > 0 ? arr : undefined;
  }
  return undefined;
}

/**
 * Parse filter parameters from an Express-style query object.
 * Extracts all recognized filter fields and returns a RecipeFilterParams object.
 */
export function parseFiltersFromQuery(query: Record<string, any>): RecipeFilterParams {
  const filters: RecipeFilterParams = {};

  const mealTypes = parseArray(query.mealTypes);
  if (mealTypes) filters.mealTypes = mealTypes;

  const cuisines = parseArray(query.cuisines);
  if (cuisines) filters.cuisines = cuisines;

  const cookingMethods = parseArray(query.cookingMethods);
  if (cookingMethods) filters.cookingMethods = cookingMethods;

  const skillLevels = parseArray(query.skillLevels);
  if (skillLevels) filters.skillLevels = skillLevels;

  const seasons = parseArray(query.seasons);
  if (seasons) filters.seasons = seasons;

  const excludeAllergens = parseArray(query.excludeAllergens);
  if (excludeAllergens) filters.excludeAllergens = excludeAllergens;

  const timeConvenience = parseArray(query.timeConvenience);
  if (timeConvenience) filters.timeConvenience = timeConvenience;

  if (query.search) filters.search = query.search as string;
  if (query.sortBy) filters.sortBy = query.sortBy as string;

  const dietaryKeys = [
    'vegetarian', 'vegan', 'pescatarian', 'glutenFree', 'dairyFree',
    'keto', 'paleo', 'lowCarb', 'highProtein', 'lowCalorie', 'highFiber', 'mediterranean'
  ] as const;
  const dietary: Record<string, boolean> = {};
  let hasDietary = false;
  for (const key of dietaryKeys) {
    if (query[`dietary_${key}`] === 'true') {
      dietary[key] = true;
      hasDietary = true;
    }
  }
  if (hasDietary) filters.dietary = dietary as any;

  if (query.budgetFriendly === 'true') filters.budgetFriendly = true;
  if (query.fewIngredients === 'true') filters.fewIngredients = true;
  if (query.onePot === 'true') filters.onePot = true;
  if (query.airFryer === 'true') filters.airFryer = true;

  return filters;
}
