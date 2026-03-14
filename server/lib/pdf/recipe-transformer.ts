import type { Recipe } from '@shared/schema';
import type { NormalizedRecipe, IngredientGroup, InstructionStep } from './types';

/**
 * Transforms a grammie-ai Recipe into a NormalizedRecipe for PDF rendering.
 */
export function transformRecipe(recipe: Recipe): NormalizedRecipe {
  return {
    id: recipe.id,
    title: recipe.title,
    description: recipe.description || '',
    prepTime: recipe.prepTimeMinutes ?? undefined,
    cookTime: recipe.cookTimeMinutes ?? undefined,
    totalTime: recipe.totalTimeMinutes ?? undefined,
    servings: recipe.servings ? String(recipe.servings) : undefined,
    yield: recipe.yield ?? undefined,
    difficulty: recipe.skillLevel ?? undefined,
    cuisine: recipe.cuisine ?? (recipe.cuisines?.[0] ?? undefined),
    category: recipe.mealType?.[0] ?? undefined,
    ingredients: transformIngredients(recipe),
    instructions: transformInstructions(recipe),
    notes: recipe.tips?.map((t: any) => t.text) ?? undefined,
    tags: [
      ...(recipe.dietType ?? []),
      ...(recipe.mealType ?? []),
      ...(recipe.cuisines ?? []),
    ],
    imageUrl: recipe.dishImageThumbnail ?? undefined,
    source: recipe.socialSourceUrl ?? undefined,
  };
}

function transformIngredients(recipe: Recipe): IngredientGroup[] {
  // If normalized ingredients with categories exist, group them
  if (recipe.normalizedIngredients && recipe.normalizedIngredients.length > 0) {
    const groups = new Map<string, string[]>();

    for (const ing of recipe.normalizedIngredients) {
      const category = (ing as any).category || '';
      const display = formatNormalizedIngredient(ing);
      if (!groups.has(category)) {
        groups.set(category, []);
      }
      groups.get(category)!.push(display);
    }

    return Array.from(groups.entries()).map(([heading, items]) => ({
      heading: heading || undefined,
      items,
    }));
  }

  // Fall back to plain string ingredients
  if (recipe.ingredients && recipe.ingredients.length > 0) {
    return [{ items: recipe.ingredients }];
  }

  return [{ items: [] }];
}

function formatNormalizedIngredient(ing: any): string {
  const parts: string[] = [];
  if (ing.quantity) parts.push(ing.quantity);
  if (ing.unit) parts.push(ing.unit);
  if (ing.name) parts.push(ing.name);
  if (ing.preparation) parts.push(`(${ing.preparation})`);
  return parts.join(' ') || ing.original || '';
}

function transformInstructions(recipe: Recipe): InstructionStep[] {
  // Use normalized instructions if available
  if (recipe.normalizedInstructions && recipe.normalizedInstructions.length > 0) {
    return recipe.normalizedInstructions.map((inst: any, i: number) => ({
      step: inst.stepNumber ?? i + 1,
      text: inst.instruction || inst.text || '',
    }));
  }

  // Fall back to plain string instructions
  if (recipe.instructions && recipe.instructions.length > 0) {
    return recipe.instructions.map((text, i) => ({
      step: i + 1,
      text,
    }));
  }

  return [];
}
