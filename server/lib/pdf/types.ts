export interface IngredientGroup {
  heading?: string;
  items: string[];
}

export interface InstructionStep {
  step: number;
  text: string;
  image?: string;
}

export interface NutritionData {
  calories?: number;
  fat?: string;
  saturatedFat?: string;
  carbohydrates?: string;
  fiber?: string;
  sugar?: string;
  protein?: string;
  sodium?: string;
  cholesterol?: string;
}

export interface NormalizedRecipe {
  id: string;
  title: string;
  description: string;
  prepTime?: number; // minutes
  cookTime?: number; // minutes
  totalTime?: number; // minutes
  servings?: string;
  yield?: string;
  difficulty?: string;
  cuisine?: string;
  category?: string;
  ingredients: IngredientGroup[];
  instructions: InstructionStep[];
  notes?: string[];
  tags: string[];
  imageUrl?: string;
  source?: string;
  nutritionInfo?: NutritionData;
}
