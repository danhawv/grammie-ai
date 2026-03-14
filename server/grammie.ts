import { db } from "./db";
import { recipes, cookbooks, cookbookRecipes, users, recipeShares, bookmarks, cookbookFollows } from "@shared/schema";
import { eq, and, or, gte, lte, ilike, inArray, sql, desc, isNotNull } from "drizzle-orm";
import { parseQueryWithGemini, generateTextWithGemini, isGeminiAvailable } from "./gemini";

// Schema for parsed query filters - comprehensive coverage of all recipe metrics
interface RecipeFilters {
  // Time constraints
  maxTotalTime?: number; // in minutes
  minTotalTime?: number;
  maxPrepTime?: number;
  maxCookTime?: number;
  
  // Nutrition constraints (per serving)
  minProtein?: number;
  maxProtein?: number;
  minCalories?: number;
  maxCalories?: number;
  minCarbs?: number;
  maxCarbs?: number;
  minFat?: number;
  maxFat?: number;
  minFiber?: number;
  maxFiber?: number;
  minSodium?: number;
  maxSodium?: number;
  minSugar?: number;
  maxSugar?: number;
  
  // All dietary flags (comprehensive)
  isVegetarian?: boolean;
  isVegan?: boolean;
  isGlutenFree?: boolean;
  isDairyFree?: boolean;
  isKeto?: boolean;
  isPaleo?: boolean;
  isLowCarb?: boolean;
  isHighProtein?: boolean;
  isLowCalorie?: boolean;
  isHighFiber?: boolean;
  isPescatarian?: boolean;
  isLactoVegetarian?: boolean;
  isOvoVegetarian?: boolean;
  isMediterranean?: boolean;
  isFlexitarian?: boolean;
  isCarnivore?: boolean;
  isKosher?: boolean;
  isHalal?: boolean;
  isHindu?: boolean;
  isLowFat?: boolean;
  isLowSodium?: boolean;
  isLowSugar?: boolean;
  
  // Categories
  cuisines?: string[];
  mealTypes?: string[];
  cookingMethods?: string[];
  seasonTags?: string[];
  occasionTags?: string[];
  
  // Allergen-free requirements (all canonical allergens)
  allergenFree?: string[];
  
  // Price constraints
  maxCost?: number;
  priceCategory?: 'budget' | 'moderate' | 'premium';
  
  // Skill level
  skillLevel?: 'easy' | 'intermediate' | 'advanced';
  
  // Health score
  minHealthScore?: number;
  
  // Search terms
  titleSearch?: string;
  ingredientSearch?: string[];
  excludeIngredients?: string[];
  
  // Cookbook filter
  cookbookName?: string;
  
  // User-specific filters
  onlyBookmarked?: boolean;  // Only show bookmarked recipes
  onlySharedWithMe?: boolean; // Only show recipes shared with user
  onlyForked?: boolean;  // Only show forked recipes
  
  // Sorting
  sortBy?: 'time' | 'calories' | 'protein' | 'newest' | 'healthiest' | 'cheapest';
  
  // Limit
  limit?: number;
}

interface GrammieResponse {
  message: string;
  recipes: {
    id: string;
    title: string;
    description?: string;
    totalTimeMinutes?: number;
    calories?: number;
    protein?: number;
    cuisines?: string[];
    url: string;
  }[];
  suggestedFollowUps?: string[];
}

// Parse natural language query into structured filters using GPT
async function parseQueryToFilters(query: string): Promise<RecipeFilters> {
  const systemPrompt = `You are a recipe search query parser. Convert natural language queries into structured JSON filters.

Available filter fields:

TIME CONSTRAINTS:
- maxTotalTime (number, minutes): e.g., "under 30 minutes" → 30
- minTotalTime, maxPrepTime, maxCookTime (number, minutes)

NUTRITION (per serving):
- minProtein, maxProtein (grams)
- minCalories, maxCalories
- minCarbs, maxCarbs, minFat, maxFat (grams)
- minFiber, maxFiber, minSodium, maxSodium (mg for sodium)
- minSugar, maxSugar (grams)

DIETARY FLAGS (all boolean):
- isVegetarian, isVegan, isPescatarian
- isGlutenFree, isDairyFree
- isKeto, isPaleo, isLowCarb, isHighProtein, isLowCalorie, isHighFiber
- isLactoVegetarian, isOvoVegetarian, isMediterranean
- isFlexitarian, isCarnivore
- isKosher, isHalal, isHindu
- isLowFat, isLowSodium, isLowSugar

CATEGORIES:
- cuisines (array): ["Italian", "Mexican", "Chinese", "Indian", "Thai", "Japanese", "French", "Mediterranean", "American", "Korean", "Vietnamese", "Greek", "Middle Eastern", "Caribbean", "Southern", "TexMex", etc.]
- mealTypes (array): ["breakfast", "lunch", "dinner", "dessert", "snack", "appetizer", "side dish", "main course", "beverage", "sauce", "dip", "marinade", "rub"]
- cookingMethods (array): ["grilled", "baked", "fried", "sauteed", "roasted", "steamed", "slow-cooked", "pressure-cooked", "raw", "smoked"]
- seasonTags (array): ["spring", "summer", "fall", "winter", "holiday"]
- occasionTags (array): ["party", "date night", "weeknight", "meal prep", "potluck", "holiday", "birthday"]

ALLERGEN-FREE (array of allergens to exclude):
- allergenFree: ["Shellfish", "Fish", "Gluten", "Dairy", "Peanuts", "Tree Nuts", "Soy", "Eggs", "Sesame", "Mustard", "Sulfites", "Nightshades"]

PRICE:
- maxCost (number, dollars)
- priceCategory: "budget", "moderate", or "premium"

SKILL LEVEL:
- skillLevel: "easy", "intermediate", or "advanced"

HEALTH:
- minHealthScore (0-100)

SEARCH TERMS:
- titleSearch (string): search term for recipe title/name
- ingredientSearch (array): ingredients that MUST be in the recipe
- excludeIngredients (array): ingredients to EXCLUDE

COOKBOOK:
- cookbookName (string): specific cookbook name to search within

USER-SPECIFIC (requires logged in user):
- onlyBookmarked (boolean): only show user's bookmarked/favorite recipes
- onlySharedWithMe (boolean): only show recipes shared with the user
- onlyForked (boolean): only show recipes user has forked

SORTING:
- sortBy: "time" (fastest), "calories" (lowest), "protein" (highest), "newest", "healthiest", "cheapest"

LIMIT:
- limit (number, default 3, max 3)

Examples:
- "quick high protein dinner" → {"maxTotalTime": 30, "isHighProtein": true, "mealTypes": ["dinner"], "limit": 3}
- "vegetarian pasta under 500 calories" → {"isVegetarian": true, "titleSearch": "pasta", "maxCalories": 500, "limit": 3}
- "what can I make with chicken and broccoli" → {"ingredientSearch": ["chicken", "broccoli"], "limit": 3}
- "my chili recipe" → {"titleSearch": "chili", "limit": 3}
- "easy breakfast ideas" → {"skillLevel": "easy", "mealTypes": ["breakfast"], "limit": 3}
- "nut-free desserts" → {"allergenFree": ["Peanuts", "Tree Nuts"], "mealTypes": ["dessert"], "limit": 3}
- "keto dinner under $15" → {"isKeto": true, "mealTypes": ["dinner"], "maxCost": 15, "limit": 3}
- "low sodium heart healthy" → {"isLowSodium": true, "minHealthScore": 70, "limit": 3}
- "summer grilling recipes" → {"seasonTags": ["summer"], "cookingMethods": ["grilled"], "limit": 3}
- "Mediterranean diet lunch" → {"isMediterranean": true, "mealTypes": ["lunch"], "limit": 3}
- "recipes without dairy or eggs" → {"allergenFree": ["Dairy", "Eggs"], "limit": 3}
- "cheap weeknight meals" → {"priceCategory": "budget", "occasionTags": ["weeknight"], "sortBy": "cheapest", "limit": 3}
- "my favorites" or "bookmarked recipes" → {"onlyBookmarked": true, "limit": 3}
- "recipes shared with me" → {"onlySharedWithMe": true, "limit": 3}
- "my forked recipes" → {"onlyForked": true, "limit": 3}

Return ONLY valid JSON, no explanation.`;

  // If Gemini is not available, do simple keyword parsing
  if (!isGeminiAvailable()) {
    console.warn("[Grammie] Gemini not available - using fallback keyword parsing");
    return parseQuerySimple(query);
  }

  try {
    const raw = await parseQueryWithGemini(query, systemPrompt);
    // Normalize and validate the parsed response
    const parsed = normalizeFilters(raw);
    console.log("[Grammie] Successfully parsed query with Gemini");
    return parsed;
  } catch (error) {
    console.error("[Grammie] Gemini parsing failed, using fallback:", error);
    // Fall back to simple keyword parsing
    return parseQuerySimple(query);
  }
}

// Normalize and validate parsed filters from AI
function normalizeFilters(raw: any): RecipeFilters {
  const filters: RecipeFilters = { limit: 3 };
  
  if (!raw || typeof raw !== 'object') {
    return filters;
  }

  // Time constraints
  if (typeof raw.maxTotalTime === 'number') filters.maxTotalTime = raw.maxTotalTime;
  if (typeof raw.minTotalTime === 'number') filters.minTotalTime = raw.minTotalTime;
  if (typeof raw.maxPrepTime === 'number') filters.maxPrepTime = raw.maxPrepTime;
  if (typeof raw.maxCookTime === 'number') filters.maxCookTime = raw.maxCookTime;
  
  // Nutrition constraints
  if (typeof raw.maxCalories === 'number') filters.maxCalories = raw.maxCalories;
  if (typeof raw.minCalories === 'number') filters.minCalories = raw.minCalories;
  if (typeof raw.minProtein === 'number') filters.minProtein = raw.minProtein;
  if (typeof raw.maxProtein === 'number') filters.maxProtein = raw.maxProtein;
  if (typeof raw.maxCarbs === 'number') filters.maxCarbs = raw.maxCarbs;
  if (typeof raw.maxFat === 'number') filters.maxFat = raw.maxFat;
  if (typeof raw.maxSugar === 'number') filters.maxSugar = raw.maxSugar;
  if (typeof raw.maxSodium === 'number') filters.maxSodium = raw.maxSodium;
  if (typeof raw.minFiber === 'number') filters.minFiber = raw.minFiber;
  
  // Health and wellness scores
  if (typeof raw.minHealthScore === 'number') filters.minHealthScore = raw.minHealthScore;
  
  // Cost constraints
  if (typeof raw.maxCost === 'number') filters.maxCost = raw.maxCost;
  if (typeof raw.priceCategory === 'string') filters.priceCategory = raw.priceCategory;
  
  // Search terms
  if (typeof raw.titleSearch === 'string') filters.titleSearch = raw.titleSearch;
  if (Array.isArray(raw.ingredientSearch)) filters.ingredientSearch = raw.ingredientSearch.filter((i: any) => typeof i === 'string');
  
  // Categories and tags
  if (Array.isArray(raw.cuisines)) filters.cuisines = raw.cuisines.filter((c: any) => typeof c === 'string');
  if (Array.isArray(raw.mealTypes)) filters.mealTypes = raw.mealTypes.filter((m: any) => typeof m === 'string');
  if (Array.isArray(raw.occasionTags)) filters.occasionTags = raw.occasionTags.filter((o: any) => typeof o === 'string');
  if (Array.isArray(raw.seasonTags)) filters.seasonTags = raw.seasonTags.filter((s: any) => typeof s === 'string');
  if (Array.isArray(raw.cookingMethods)) filters.cookingMethods = raw.cookingMethods.filter((c: any) => typeof c === 'string');
  if (typeof raw.skillLevel === 'string') filters.skillLevel = raw.skillLevel;
  
  // Dietary flags
  if (typeof raw.isVegetarian === 'boolean') filters.isVegetarian = raw.isVegetarian;
  if (typeof raw.isVegan === 'boolean') filters.isVegan = raw.isVegan;
  if (typeof raw.isGlutenFree === 'boolean') filters.isGlutenFree = raw.isGlutenFree;
  if (typeof raw.isDairyFree === 'boolean') filters.isDairyFree = raw.isDairyFree;
  if (typeof raw.isKeto === 'boolean') filters.isKeto = raw.isKeto;
  if (typeof raw.isLowCarb === 'boolean') filters.isLowCarb = raw.isLowCarb;
  if (typeof raw.isPaleo === 'boolean') filters.isPaleo = raw.isPaleo;
  if (typeof raw.isWhole30 === 'boolean') (filters as any).isWhole30 = raw.isWhole30;
  if (typeof raw.isMediterranean === 'boolean') filters.isMediterranean = raw.isMediterranean;
  if (typeof raw.isHeartHealthy === 'boolean') (filters as any).isHeartHealthy = raw.isHeartHealthy;
  if (typeof raw.isLowSodium === 'boolean') filters.isLowSodium = raw.isLowSodium;
  if (typeof raw.isHighProtein === 'boolean') filters.isHighProtein = raw.isHighProtein;
  if (typeof raw.isHighFiber === 'boolean') filters.isHighFiber = raw.isHighFiber;
  if (typeof raw.isLowFat === 'boolean') filters.isLowFat = raw.isLowFat;
  if (typeof raw.isLowCalorie === 'boolean') filters.isLowCalorie = raw.isLowCalorie;
  
  // Allergen filters
  if (Array.isArray(raw.allergenFree)) filters.allergenFree = raw.allergenFree.filter((a: any) => typeof a === 'string');
  
  // User filters
  if (typeof raw.onlyBookmarked === 'boolean') filters.onlyBookmarked = raw.onlyBookmarked;
  if (typeof raw.onlySharedWithMe === 'boolean') filters.onlySharedWithMe = raw.onlySharedWithMe;
  if (typeof raw.onlyForked === 'boolean') filters.onlyForked = raw.onlyForked;
  
  // Sorting
  if (typeof raw.sortBy === 'string') filters.sortBy = raw.sortBy;
  
  // Limit (ensure default and max of 3)
  const rawLimit = typeof raw.limit === 'number' ? raw.limit : 3;
  filters.limit = Math.min(Math.max(1, rawLimit), 3);
  
  return filters;
}

// Simple fallback query parser when GPT is not available
function parseQuerySimple(query: string): RecipeFilters {
  const filters: RecipeFilters = { limit: 3 };
  const lowerQuery = query.toLowerCase();
  
  // Extract potential ingredient/title keywords (words that aren't common stop words)
  const stopWords = ['what', 'which', 'how', 'can', 'do', 'you', 'have', 'find', 'show', 'me', 'give', 'get', 
    'recipes', 'recipe', 'with', 'for', 'the', 'a', 'an', 'some', 'any', 'that', 'are', 'is', 'my', 'your'];
  const words = lowerQuery.split(/\s+/).filter(word => 
    word.length > 2 && !stopWords.includes(word)
  );
  
  // Use extracted words for both title and ingredient search
  if (words.length > 0) {
    // Try to search both title and ingredients
    filters.titleSearch = words.join(' ');
    filters.ingredientSearch = words;
  }
  
  // Check for common dietary terms
  if (lowerQuery.includes('vegetarian')) filters.isVegetarian = true;
  if (lowerQuery.includes('vegan')) filters.isVegan = true;
  if (lowerQuery.includes('gluten-free') || lowerQuery.includes('gluten free')) filters.isGlutenFree = true;
  if (lowerQuery.includes('dairy-free') || lowerQuery.includes('dairy free')) filters.isDairyFree = true;
  if (lowerQuery.includes('keto')) filters.isKeto = true;
  if (lowerQuery.includes('low carb') || lowerQuery.includes('low-carb')) filters.isLowCarb = true;
  if (lowerQuery.includes('high protein')) filters.isHighProtein = true;
  
  // Check for time constraints
  const quickMatch = lowerQuery.match(/(\d+)\s*min/);
  if (quickMatch) {
    filters.maxTotalTime = parseInt(quickMatch[1]);
  } else if (lowerQuery.includes('quick') || lowerQuery.includes('fast')) {
    filters.maxTotalTime = 30;
  }
  
  // Check for meal types
  if (lowerQuery.includes('breakfast')) filters.mealTypes = ['breakfast'];
  if (lowerQuery.includes('lunch')) filters.mealTypes = ['lunch'];
  if (lowerQuery.includes('dinner')) filters.mealTypes = ['dinner'];
  if (lowerQuery.includes('dessert')) filters.mealTypes = ['dessert'];
  if (lowerQuery.includes('snack')) filters.mealTypes = ['snack'];
  
  // Check for skill level
  if (lowerQuery.includes('easy') || lowerQuery.includes('simple')) filters.skillLevel = 'easy';
  if (lowerQuery.includes('beginner')) filters.skillLevel = 'easy';
  
  // Check for bookmarks/favorites
  if (lowerQuery.includes('favorite') || lowerQuery.includes('bookmark') || lowerQuery.includes('saved')) {
    filters.onlyBookmarked = true;
  }
  
  return filters;
}

// Search recipes based on parsed filters
async function searchRecipes(filters: RecipeFilters, userId?: string): Promise<any[]> {
  const conditions: any[] = [];
  
  // Visibility: user can see public recipes, their own, or shared with them
  if (userId) {
    conditions.push(
      or(
        eq(recipes.isPublic, true),
        eq(recipes.ownerUserId, userId),
        // Include recipes shared with the user
        sql`EXISTS (SELECT 1 FROM recipe_shares WHERE recipe_shares.recipe_id = ${recipes.id} AND recipe_shares.user_id = ${userId})`
      )
    );
  } else {
    conditions.push(eq(recipes.isPublic, true));
  }
  
  // Only show enriched/ready recipes
  conditions.push(eq(recipes.enrichmentStatus, 'ready'));
  
  // User-specific filters
  if (filters.onlyBookmarked && userId) {
    conditions.push(
      sql`EXISTS (SELECT 1 FROM bookmarks WHERE bookmarks.recipe_id = ${recipes.id} AND bookmarks.user_id = ${userId})`
    );
  }
  
  if (filters.onlySharedWithMe && userId) {
    conditions.push(
      sql`EXISTS (SELECT 1 FROM recipe_shares WHERE recipe_shares.recipe_id = ${recipes.id} AND recipe_shares.user_id = ${userId})`
    );
  }
  
  if (filters.onlyForked && userId) {
    conditions.push(
      and(
        eq(recipes.ownerUserId, userId),
        isNotNull(recipes.forkedFromId)
      )
    );
  }
  
  // Time filters (null-safe: only filter if value exists)
  if (filters.maxTotalTime) {
    conditions.push(and(isNotNull(recipes.totalTimeMinutes), lte(recipes.totalTimeMinutes, filters.maxTotalTime)));
  }
  if (filters.minTotalTime) {
    conditions.push(and(isNotNull(recipes.totalTimeMinutes), gte(recipes.totalTimeMinutes, filters.minTotalTime)));
  }
  if (filters.maxPrepTime) {
    conditions.push(and(isNotNull(recipes.prepTimeMinutes), lte(recipes.prepTimeMinutes, filters.maxPrepTime)));
  }
  if (filters.maxCookTime) {
    conditions.push(and(isNotNull(recipes.cookTimeMinutes), lte(recipes.cookTimeMinutes, filters.maxCookTime)));
  }
  
  // Nutrition filters (null-safe: skip recipes without nutrition data for max filters, require value for min)
  if (filters.minProtein) conditions.push(and(isNotNull(recipes.protein), gte(recipes.protein, filters.minProtein)));
  if (filters.maxProtein) conditions.push(or(sql`${recipes.protein} IS NULL`, lte(recipes.protein, filters.maxProtein)));
  if (filters.minCalories) conditions.push(and(isNotNull(recipes.calories), gte(recipes.calories, filters.minCalories)));
  if (filters.maxCalories) conditions.push(or(sql`${recipes.calories} IS NULL`, lte(recipes.calories, filters.maxCalories)));
  if (filters.minCarbs) conditions.push(and(isNotNull(recipes.carbohydrates), gte(recipes.carbohydrates, filters.minCarbs)));
  if (filters.maxCarbs) conditions.push(or(sql`${recipes.carbohydrates} IS NULL`, lte(recipes.carbohydrates, filters.maxCarbs)));
  if (filters.minFat) conditions.push(and(isNotNull(recipes.fat), gte(recipes.fat, filters.minFat)));
  if (filters.maxFat) conditions.push(or(sql`${recipes.fat} IS NULL`, lte(recipes.fat, filters.maxFat)));
  if (filters.minFiber) conditions.push(and(isNotNull(recipes.fiber), gte(recipes.fiber, filters.minFiber)));
  if (filters.maxFiber) conditions.push(or(sql`${recipes.fiber} IS NULL`, lte(recipes.fiber, filters.maxFiber)));
  if (filters.minSodium) conditions.push(and(isNotNull(recipes.sodium), gte(recipes.sodium, filters.minSodium)));
  if (filters.maxSodium) conditions.push(or(sql`${recipes.sodium} IS NULL`, lte(recipes.sodium, filters.maxSodium)));
  if (filters.minSugar) conditions.push(and(isNotNull(recipes.sugar), gte(recipes.sugar, filters.minSugar)));
  if (filters.maxSugar) conditions.push(or(sql`${recipes.sugar} IS NULL`, lte(recipes.sugar, filters.maxSugar)));
  
  // Health score (null-safe)
  if (filters.minHealthScore) conditions.push(and(isNotNull(recipes.healthScore), gte(recipes.healthScore, filters.minHealthScore)));
  
  // All dietary flags (comprehensive)
  if (filters.isVegetarian) conditions.push(eq(recipes.isVegetarian, true));
  if (filters.isVegan) conditions.push(eq(recipes.isVegan, true));
  if (filters.isGlutenFree) conditions.push(eq(recipes.isGlutenFree, true));
  if (filters.isDairyFree) conditions.push(eq(recipes.isDairyFree, true));
  if (filters.isKeto) conditions.push(eq(recipes.isKeto, true));
  if (filters.isPaleo) conditions.push(eq(recipes.isPaleo, true));
  if (filters.isLowCarb) conditions.push(eq(recipes.isLowCarb, true));
  if (filters.isHighProtein) conditions.push(eq(recipes.isHighProtein, true));
  if (filters.isLowCalorie) conditions.push(eq(recipes.isLowCalorie, true));
  if (filters.isHighFiber) conditions.push(eq(recipes.isHighFiber, true));
  if (filters.isPescatarian) conditions.push(eq(recipes.isPescatarian, true));
  if (filters.isLactoVegetarian) conditions.push(eq(recipes.isLactoVegetarian, true));
  if (filters.isOvoVegetarian) conditions.push(eq(recipes.isOvoVegetarian, true));
  if (filters.isMediterranean) conditions.push(eq(recipes.isMediterranean, true));
  if (filters.isFlexitarian) conditions.push(eq(recipes.isFlexitarian, true));
  if (filters.isCarnivore) conditions.push(eq(recipes.isCarnivore, true));
  if (filters.isKosher) conditions.push(eq(recipes.isKosher, true));
  if (filters.isHalal) conditions.push(eq(recipes.isHalal, true));
  if (filters.isHindu) conditions.push(eq(recipes.isHindu, true));
  if (filters.isLowFat) conditions.push(eq(recipes.isLowFat, true));
  if (filters.isLowSodium) conditions.push(eq(recipes.isLowSodium, true));
  if (filters.isLowSugar) conditions.push(eq(recipes.isLowSugar, true));
  
  // Skill level
  if (filters.skillLevel) {
    const skillMap: Record<string, string> = {
      'easy': 'Beginner',
      'intermediate': 'Intermediate',
      'advanced': 'Advanced'
    };
    conditions.push(eq(recipes.skillLevel, skillMap[filters.skillLevel] || filters.skillLevel));
  }
  
  // Price filters
  if (filters.maxCost) {
    conditions.push(lte(recipes.totalCost, filters.maxCost));
  }
  if (filters.priceCategory) {
    conditions.push(eq(recipes.priceCategory, filters.priceCategory));
  }
  
  // Title and ingredient search - use OR logic when both are provided
  // This allows "shrimp recipes" to match recipes with shrimp in title OR ingredients
  if (filters.titleSearch && filters.ingredientSearch && filters.ingredientSearch.length > 0) {
    // Combine title and ingredient search with OR
    const searchTerms = filters.ingredientSearch;
    const titleOrIngredientConditions = searchTerms.map(term => 
      or(
        ilike(recipes.title, `%${term}%`),
        sql`EXISTS (SELECT 1 FROM unnest(${recipes.ingredients}) ing WHERE ing ILIKE ${'%' + term + '%'})`
      )
    );
    // All terms must match in either title or ingredients
    titleOrIngredientConditions.forEach(condition => conditions.push(condition));
  } else {
    // Title-only search
    if (filters.titleSearch) {
      conditions.push(ilike(recipes.title, `%${filters.titleSearch}%`));
    }
    
    // Ingredient-only search
    if (filters.ingredientSearch && filters.ingredientSearch.length > 0) {
      filters.ingredientSearch.forEach(ingredient => {
        conditions.push(
          sql`EXISTS (SELECT 1 FROM unnest(${recipes.ingredients}) ing WHERE ing ILIKE ${'%' + ingredient + '%'})`
        );
      });
    }
  }
  
  // Cuisine filter
  if (filters.cuisines && filters.cuisines.length > 0) {
    const cuisineConditions = filters.cuisines.map(cuisine => 
      sql`${recipes.cuisines}::text[] && ARRAY[${cuisine}]::text[]`
    );
    conditions.push(or(...cuisineConditions));
  }
  
  // Meal type filter
  if (filters.mealTypes && filters.mealTypes.length > 0) {
    const mealConditions = filters.mealTypes.map(meal => 
      sql`${recipes.mealType}::text[] && ARRAY[${meal}]::text[]`
    );
    conditions.push(or(...mealConditions));
  }
  
  // Cooking method filter
  if (filters.cookingMethods && filters.cookingMethods.length > 0) {
    const methodConditions = filters.cookingMethods.map(method => 
      sql`${recipes.cookingMethods}::text[] && ARRAY[${method}]::text[]`
    );
    conditions.push(or(...methodConditions));
  }
  
  // Season tags filter
  if (filters.seasonTags && filters.seasonTags.length > 0) {
    const seasonConditions = filters.seasonTags.map(season => 
      sql`${recipes.seasonTags}::text[] && ARRAY[${season}]::text[]`
    );
    conditions.push(or(...seasonConditions));
  }
  
  // Occasion tags filter
  if (filters.occasionTags && filters.occasionTags.length > 0) {
    const occasionConditions = filters.occasionTags.map(occasion => 
      sql`${recipes.occasionTags}::text[] && ARRAY[${occasion}]::text[]`
    );
    conditions.push(or(...occasionConditions));
  }
  
  // Allergen-free filter
  if (filters.allergenFree && filters.allergenFree.length > 0) {
    // Recipes should NOT contain these allergens
    filters.allergenFree.forEach(allergen => {
      conditions.push(
        or(
          sql`${recipes.allergens} IS NULL`,
          sql`NOT (${recipes.allergens}::text[] && ARRAY[${allergen}]::text[])`
        )
      );
    });
  }
  
  // Exclude ingredients
  if (filters.excludeIngredients && filters.excludeIngredients.length > 0) {
    filters.excludeIngredients.forEach(ingredient => {
      conditions.push(
        sql`NOT EXISTS (SELECT 1 FROM unnest(${recipes.ingredients}) ing WHERE ing ILIKE ${'%' + ingredient + '%'})`
      );
    });
  }
  
  // Cookbook name filter (search by cookbook name)
  if (filters.cookbookName) {
    conditions.push(
      sql`EXISTS (
        SELECT 1 FROM cookbook_recipes cr 
        JOIN cookbooks c ON cr.cookbook_id = c.id 
        WHERE cr.recipe_id = ${recipes.id} 
        AND c.name ILIKE ${'%' + filters.cookbookName + '%'}
      )`
    );
  }
  
  // Build query
  let query = db
    .select({
      id: recipes.id,
      title: recipes.title,
      description: recipes.description,
      totalTimeMinutes: recipes.totalTimeMinutes,
      calories: recipes.calories,
      protein: recipes.protein,
      cuisines: recipes.cuisines,
      dishImageThumbnail: recipes.dishImageThumbnail,
      skillLevel: recipes.skillLevel,
      servings: recipes.servings,
    })
    .from(recipes)
    .where(and(...conditions));
  
  // Sorting
  let orderBy: any = desc(recipes.createdAt); // default: newest
  if (filters.sortBy === 'time') {
    orderBy = recipes.totalTimeMinutes;
  } else if (filters.sortBy === 'calories') {
    orderBy = recipes.calories;
  } else if (filters.sortBy === 'protein') {
    orderBy = desc(recipes.protein);
  } else if (filters.sortBy === 'healthiest') {
    orderBy = desc(recipes.healthScore);
  } else if (filters.sortBy === 'cheapest') {
    orderBy = recipes.totalCost;
  }
  
  const results = await query.orderBy(orderBy).limit(filters.limit || 3);
  
  return results;
}

// Generate Grammie's friendly response
async function generateGrammieResponse(
  originalQuery: string,
  filters: RecipeFilters,
  foundRecipes: any[],
  baseUrl: string
): Promise<GrammieResponse> {
  const recipesWithUrls = foundRecipes.map(r => ({
    id: r.id,
    title: r.title,
    description: r.description,
    totalTimeMinutes: r.totalTimeMinutes,
    calories: r.calories,
    protein: r.protein,
    cuisines: r.cuisines,
    url: `${baseUrl}/recipe/${r.id}`,
  }));
  
  // Generate a warm, grandmotherly response
  const systemPrompt = `You are Grammie, a warm and loving grandmother who helps people find recipes in their collection. 
You speak in a friendly, caring tone with occasional endearing terms like "dear", "honey", or "sweetie".
You're knowledgeable about cooking and nutrition but explain things simply.
Keep responses concise (2-3 sentences max for the main message).
If no recipes found, be encouraging and suggest they try different criteria.
Never use emojis.`;

  const recipeContext = recipesWithUrls.length > 0
    ? `Found ${recipesWithUrls.length} recipes: ${recipesWithUrls.map(r => r.title).join(', ')}`
    : 'No recipes found matching these criteria.';

  // Generate follow-up suggestions
  const suggestedFollowUps = generateFollowUpSuggestions(filters, foundRecipes.length);

  // If Gemini is not available, return a simple response
  if (!isGeminiAvailable()) {
    return {
      message: recipesWithUrls.length > 0 
        ? `Here's what I found for you, dear! I found ${recipesWithUrls.length} recipe${recipesWithUrls.length > 1 ? 's' : ''} matching your search.`
        : "I couldn't find any recipes matching that, sweetie. Try using different words or check your spelling!",
      recipes: recipesWithUrls,
      suggestedFollowUps,
    };
  }

  try {
    const userPrompt = `User asked: "${originalQuery}"\n\nFilters applied: ${JSON.stringify(filters)}\n\nResults: ${recipeContext}\n\nGenerate a brief, warm response introducing these recipes (or explaining no results). Do NOT list the recipes - they'll be shown separately.`;
    const rawMessage = await generateTextWithGemini(systemPrompt, userPrompt);
    
    // Clean up markdown formatting from Gemini response
    const message = cleanMarkdown(rawMessage);
    console.log("[Grammie] Successfully generated response with Gemini");

    return {
      message: message || (recipesWithUrls.length > 0 
        ? "Here's what I found for you, dear!" 
        : "I couldn't find any recipes matching that, sweetie. Try adjusting your search!"),
      recipes: recipesWithUrls,
      suggestedFollowUps,
    };
  } catch (error) {
    console.error("[Grammie] Gemini response generation failed:", error);
    return {
      message: recipesWithUrls.length > 0 
        ? "Here's what I found for you, dear!" 
        : "I couldn't find any recipes matching that, sweetie.",
      recipes: recipesWithUrls,
      suggestedFollowUps,
    };
  }
}

// Clean markdown formatting from AI responses
function cleanMarkdown(text: string): string {
  if (!text) return '';
  
  return text
    // Remove code blocks
    .replace(/```[\s\S]*?```/g, '')
    // Remove inline code
    .replace(/`([^`]+)`/g, '$1')
    // Remove bold/italic markers
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    // Remove blockquotes
    .replace(/^>\s*/gm, '')
    // Remove headers
    .replace(/^#+\s*/gm, '')
    // Clean up multiple newlines
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function generateFollowUpSuggestions(filters: RecipeFilters, resultCount: number): string[] {
  const suggestions: string[] = [];
  
  if (resultCount === 0) {
    suggestions.push("Show me all my recipes");
    if (filters.maxTotalTime) {
      suggestions.push(`Recipes under ${filters.maxTotalTime + 15} minutes`);
    }
    if (filters.isVegetarian || filters.isVegan) {
      suggestions.push("Any quick dinner ideas");
    }
  } else {
    if (!filters.isHighProtein && !filters.minProtein) {
      suggestions.push("Which of these has the most protein?");
    }
    if (!filters.maxTotalTime) {
      suggestions.push("Which is the quickest to make?");
    }
    if (!filters.maxCalories) {
      suggestions.push("Show me lower calorie options");
    }
    suggestions.push("What else can I make for dinner?");
  }
  
  return suggestions.slice(0, 3);
}

// Check if query is contextual (refers to previous results)
function isContextualQuery(query: string): boolean {
  const contextualPatterns = [
    /which\s+(one|of\s+these|is\s+the)/i,
    /of\s+these/i,
    /from\s+these/i,
    /the\s+(quickest|fastest|healthiest|cheapest|lowest|highest)/i,
    /most\s+(protein|calories|healthy)/i,
    /least\s+(calories|time)/i,
  ];
  return contextualPatterns.some(pattern => pattern.test(query));
}

// Get recipes by IDs for contextual queries
async function getRecipesByIds(recipeIds: string[]): Promise<any[]> {
  if (!recipeIds || recipeIds.length === 0) return [];
  
  const results = await db
    .select({
      id: recipes.id,
      title: recipes.title,
      description: recipes.description,
      totalTimeMinutes: recipes.totalTimeMinutes,
      calories: recipes.calories,
      protein: recipes.protein,
      cuisines: recipes.cuisines,
      dishImageThumbnail: recipes.dishImageThumbnail,
      skillLevel: recipes.skillLevel,
      servings: recipes.servings,
      healthScore: recipes.healthScore,
      totalCost: recipes.totalCost,
    })
    .from(recipes)
    .where(inArray(recipes.id, recipeIds));
  
  return results;
}

// Answer contextual questions about specific recipes
function answerContextualQuery(query: string, contextRecipes: any[], baseUrl: string): GrammieResponse {
  const lowerQuery = query.toLowerCase();
  let sortedRecipes = [...contextRecipes];
  let responseMessage = "";
  
  // Determine what attribute they're asking about
  if (lowerQuery.includes('quick') || lowerQuery.includes('fast') || lowerQuery.includes('time')) {
    sortedRecipes = sortedRecipes
      .filter(r => r.totalTimeMinutes != null)
      .sort((a, b) => (a.totalTimeMinutes || 999) - (b.totalTimeMinutes || 999));
    if (sortedRecipes.length > 0) {
      const quickest = sortedRecipes[0];
      responseMessage = `The quickest one is "${quickest.title}" at just ${quickest.totalTimeMinutes} minutes, dear!`;
    } else {
      responseMessage = "I don't have time information for those recipes, sweetie.";
    }
  } else if (lowerQuery.includes('protein')) {
    sortedRecipes = sortedRecipes
      .filter(r => r.protein != null)
      .sort((a, b) => (b.protein || 0) - (a.protein || 0));
    if (sortedRecipes.length > 0) {
      const highest = sortedRecipes[0];
      responseMessage = `"${highest.title}" has the most protein with ${highest.protein}g per serving!`;
    } else {
      responseMessage = "I don't have protein information for those recipes, dear.";
    }
  } else if (lowerQuery.includes('calorie') || lowerQuery.includes('low cal')) {
    sortedRecipes = sortedRecipes
      .filter(r => r.calories != null)
      .sort((a, b) => (a.calories || 999) - (b.calories || 999));
    if (sortedRecipes.length > 0) {
      const lowest = sortedRecipes[0];
      responseMessage = `"${lowest.title}" is the lightest option at ${lowest.calories} calories, honey!`;
    } else {
      responseMessage = "I don't have calorie information for those recipes, sweetie.";
    }
  } else if (lowerQuery.includes('health') || lowerQuery.includes('healthy')) {
    sortedRecipes = sortedRecipes
      .filter(r => r.healthScore != null)
      .sort((a, b) => (b.healthScore || 0) - (a.healthScore || 0));
    if (sortedRecipes.length > 0) {
      const healthiest = sortedRecipes[0];
      responseMessage = `"${healthiest.title}" is the healthiest choice with a health score of ${healthiest.healthScore}!`;
    } else {
      responseMessage = "I don't have health scores for those recipes, dear.";
    }
  } else if (lowerQuery.includes('cheap') || lowerQuery.includes('cost') || lowerQuery.includes('budget')) {
    sortedRecipes = sortedRecipes
      .filter(r => r.totalCost != null)
      .sort((a, b) => (a.totalCost || 999) - (b.totalCost || 999));
    if (sortedRecipes.length > 0) {
      const cheapest = sortedRecipes[0];
      responseMessage = `"${cheapest.title}" is the most budget-friendly at about $${cheapest.totalCost?.toFixed(2)}!`;
    } else {
      responseMessage = "I don't have cost information for those recipes, honey.";
    }
  } else {
    responseMessage = "I found these recipes for you, dear!";
  }
  
  // Return top result for contextual queries
  const topRecipe = sortedRecipes[0];
  const recipesWithUrls = topRecipe ? [{
    id: topRecipe.id,
    title: topRecipe.title,
    description: topRecipe.description,
    totalTimeMinutes: topRecipe.totalTimeMinutes,
    calories: topRecipe.calories,
    protein: topRecipe.protein,
    cuisines: topRecipe.cuisines,
    url: `${baseUrl}/recipe/${topRecipe.id}`,
  }] : [];
  
  return {
    message: responseMessage,
    recipes: recipesWithUrls,
    suggestedFollowUps: [
      "What else can I make for dinner?",
      "Show me more quick recipes",
      "Find me something healthy",
    ],
  };
}

// Main chat function
export async function chatWithGrammie(
  query: string,
  userId?: string,
  baseUrl: string = '',
  contextRecipeIds?: string[]
): Promise<GrammieResponse> {
  console.log(`Grammie chat: "${query}" for user ${userId || 'anonymous'}`);
  
  // Check if this is a contextual query about previous results
  if (contextRecipeIds && contextRecipeIds.length > 0 && isContextualQuery(query)) {
    console.log('Handling contextual query with recipe IDs:', contextRecipeIds);
    const contextRecipes = await getRecipesByIds(contextRecipeIds);
    if (contextRecipes.length > 0) {
      return answerContextualQuery(query, contextRecipes, baseUrl);
    }
  }
  
  // Parse the natural language query
  const filters = await parseQueryToFilters(query);
  console.log('Parsed filters:', JSON.stringify(filters));
  
  // Search recipes
  const foundRecipes = await searchRecipes(filters, userId);
  console.log(`Found ${foundRecipes.length} recipes`);
  
  // Generate response
  const response = await generateGrammieResponse(query, filters, foundRecipes, baseUrl);
  
  return response;
}

// For Twilio/API integration - simpler response format
export async function chatWithGrammieSimple(
  query: string,
  userId?: string,
  baseUrl: string = ''
): Promise<string> {
  const response = await chatWithGrammie(query, userId, baseUrl);
  
  let text = response.message;
  
  if (response.recipes.length > 0) {
    text += '\n\n';
    response.recipes.forEach((r, i) => {
      text += `${i + 1}. ${r.title}`;
      if (r.totalTimeMinutes) text += ` (${r.totalTimeMinutes} min)`;
      if (r.calories) text += ` - ${r.calories} cal`;
      text += `\n   ${r.url}\n`;
    });
  }
  
  return text;
}
