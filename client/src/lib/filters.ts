import { RecipeCardData } from "@shared/schema";

const normalizeString = (str: any): string => {
  if (typeof str === "string") {
    return str.toLowerCase().trim();
  }
  return "";
};

const normalizeArray = (arr: any[] | null | undefined): string[] => {
  if (!arr) return [];
  return arr.filter(item => typeof item === "string").map(s => s.toLowerCase().trim());
};

const arrayIntersectNormalized = (
  arr1: string[] | null | undefined,
  arr2: string[] | null | undefined
): boolean => {
  const normalized1 = normalizeArray(arr1);
  const normalized2 = normalizeArray(arr2);
  return normalized1.some(item => normalized2.includes(item));
};

export interface FiltersState {
  search: string;
  
  dietary: {
    vegetarian: boolean;
    vegan: boolean;
    pescatarian: boolean;
    glutenFree: boolean;
    dairyFree: boolean;
    keto: boolean;
    paleo: boolean;
    lowCarb: boolean;
    highProtein: boolean;
    lowCalorie: boolean;
    highFiber: boolean;
    mediterranean: boolean;
  };
  
  cuisines: string[];
  timeConvenience: string[];
  mealTypes: string[];
  cookingMethods: string[];
  skillLevels: string[];
  seasons: string[];
  excludeAllergens: string[];
  
  budgetFriendly: boolean;
  fewIngredients: boolean;
  onePot: boolean;
  airFryer: boolean;
}

export const defaultFilters: FiltersState = {
  search: "",
  
  dietary: {
    vegetarian: false,
    vegan: false,
    pescatarian: false,
    glutenFree: false,
    dairyFree: false,
    keto: false,
    paleo: false,
    lowCarb: false,
    highProtein: false,
    lowCalorie: false,
    highFiber: false,
    mediterranean: false,
  },
  
  cuisines: [],
  timeConvenience: [],
  mealTypes: [],
  cookingMethods: [],
  skillLevels: [],
  seasons: [],
  excludeAllergens: [],
  
  budgetFriendly: false,
  fewIngredients: false,
  onePot: false,
  airFryer: false,
};

export type FilterAction =
  | { type: "SET_SEARCH"; payload: string }
  | { type: "TOGGLE_DIETARY"; payload: keyof FiltersState["dietary"] }
  | { type: "TOGGLE_CUISINE"; payload: string }
  | { type: "TOGGLE_TIME_CONVENIENCE"; payload: string }
  | { type: "TOGGLE_MEAL_TYPE"; payload: string }
  | { type: "TOGGLE_COOKING_METHOD"; payload: string }
  | { type: "TOGGLE_SKILL_LEVEL"; payload: string }
  | { type: "TOGGLE_SEASON"; payload: string }
  | { type: "TOGGLE_ALLERGEN"; payload: string }
  | { type: "TOGGLE_QUICK_FILTER"; payload: "budgetFriendly" | "fewIngredients" | "onePot" | "airFryer" }
  | { type: "RESET_ALL" }
  | { type: "RESET_SECTION"; payload: keyof FiltersState };

export function filtersReducer(state: FiltersState, action: FilterAction): FiltersState {
  switch (action.type) {
    case "SET_SEARCH":
      return { ...state, search: action.payload };
    
    case "TOGGLE_DIETARY":
      return {
        ...state,
        dietary: {
          ...state.dietary,
          [action.payload]: !state.dietary[action.payload],
        },
      };
    
    case "TOGGLE_CUISINE":
      return {
        ...state,
        cuisines: state.cuisines.includes(action.payload)
          ? state.cuisines.filter((c) => c !== action.payload)
          : [...state.cuisines, action.payload],
      };
    
    case "TOGGLE_TIME_CONVENIENCE":
      return {
        ...state,
        timeConvenience: state.timeConvenience.includes(action.payload)
          ? state.timeConvenience.filter((t) => t !== action.payload)
          : [...state.timeConvenience, action.payload],
      };
    
    case "TOGGLE_MEAL_TYPE":
      return {
        ...state,
        mealTypes: state.mealTypes.includes(action.payload)
          ? state.mealTypes.filter((m) => m !== action.payload)
          : [...state.mealTypes, action.payload],
      };
    
    case "TOGGLE_COOKING_METHOD":
      return {
        ...state,
        cookingMethods: state.cookingMethods.includes(action.payload)
          ? state.cookingMethods.filter((m) => m !== action.payload)
          : [...state.cookingMethods, action.payload],
      };
    
    case "TOGGLE_SKILL_LEVEL":
      return {
        ...state,
        skillLevels: state.skillLevels.includes(action.payload)
          ? state.skillLevels.filter((s) => s !== action.payload)
          : [...state.skillLevels, action.payload],
      };
    
    case "TOGGLE_SEASON":
      return {
        ...state,
        seasons: state.seasons.includes(action.payload)
          ? state.seasons.filter((s) => s !== action.payload)
          : [...state.seasons, action.payload],
      };
    
    case "TOGGLE_ALLERGEN":
      return {
        ...state,
        excludeAllergens: state.excludeAllergens.includes(action.payload)
          ? state.excludeAllergens.filter((a) => a !== action.payload)
          : [...state.excludeAllergens, action.payload],
      };
    
    case "TOGGLE_QUICK_FILTER":
      return {
        ...state,
        [action.payload]: !state[action.payload],
      };
    
    case "RESET_ALL":
      return defaultFilters;
    
    case "RESET_SECTION":
      return {
        ...state,
        [action.payload]: defaultFilters[action.payload],
      };
    
    default:
      return state;
  }
}

export function filterRecipes(recipes: RecipeCardData[], filters: FiltersState): RecipeCardData[] {
  return recipes.filter((recipe) => {
    if (filters.search) {
      const searchLower = filters.search.toLowerCase();
      const matchesSearch =
        recipe.title.toLowerCase().includes(searchLower) ||
        recipe.description?.toLowerCase().includes(searchLower);
      if (!matchesSearch) return false;
    }

    if (filters.dietary.vegetarian && !recipe.isVegetarian) return false;
    if (filters.dietary.vegan && !recipe.isVegan) return false;
    if (filters.dietary.pescatarian && !recipe.isPescatarian) return false;
    if (filters.dietary.glutenFree && !recipe.isGlutenFree) return false;
    if (filters.dietary.dairyFree && !recipe.isDairyFree) return false;
    if (filters.dietary.keto && !recipe.isKeto) return false;
    if (filters.dietary.paleo && !recipe.isPaleo) return false;
    if (filters.dietary.lowCarb && !recipe.isLowCarb) return false;
    if (filters.dietary.highProtein && !recipe.isHighProtein) return false;
    if (filters.dietary.lowCalorie && !recipe.isLowCalorie) return false;
    if (filters.dietary.highFiber && !recipe.isHighFiber) return false;
    if (filters.dietary.mediterranean && !recipe.isMediterranean) return false;

    if (filters.cuisines.length > 0) {
      if (!arrayIntersectNormalized(recipe.cuisines, filters.cuisines)) {
        return false;
      }
    }
    
    if (filters.timeConvenience.length > 0) {
      if (!arrayIntersectNormalized(recipe.timeConvenienceTags, filters.timeConvenience)) {
        return false;
      }
    }

    if (filters.mealTypes.length > 0) {
      if (!arrayIntersectNormalized(recipe.mealType, filters.mealTypes)) {
        return false;
      }
    }

    if (filters.cookingMethods.length > 0) {
      if (!arrayIntersectNormalized(recipe.cookingMethods, filters.cookingMethods)) {
        return false;
      }
    }

    if (filters.skillLevels.length > 0) {
      const normalizedRecipeSkillLevel = normalizeString(recipe.skillLevel);
      const normalizedFilterSkillLevels = normalizeArray(filters.skillLevels);
      if (!normalizedFilterSkillLevels.includes(normalizedRecipeSkillLevel)) {
        return false;
      }
    }

    if (filters.seasons.length > 0) {
      if (!arrayIntersectNormalized(recipe.seasonTags, filters.seasons)) {
        return false;
      }
    }

    if (filters.excludeAllergens.length > 0) {
      if (arrayIntersectNormalized(recipe.allergens, filters.excludeAllergens)) {
        return false;
      }
    }

    return true;
  });
}

export function countActiveFilters(filters: FiltersState): number {
  let count = 0;
  
  if (filters.search) count++;
  
  Object.values(filters.dietary).forEach((v) => {
    if (v) count++;
  });
  
  count += filters.cuisines.length;
  count += filters.timeConvenience.length;
  count += filters.mealTypes.length;
  count += filters.cookingMethods.length;
  count += filters.skillLevels.length;
  count += filters.seasons.length;
  count += filters.excludeAllergens.length;
  if (filters.budgetFriendly) count++;
  if (filters.fewIngredients) count++;
  if (filters.onePot) count++;
  if (filters.airFryer) count++;
  
  return count;
}
