import type { Recipe, NormalizedIngredient } from "@shared/schema";

export interface ScaledRecipe {
  originalServings: number;
  newServings: number;
  scaleFactor: number;
  ingredients: string[];
  normalizedIngredients?: NormalizedIngredient[];
  warnings: string[];
}

const NON_SCALABLE_TERMS = [
  "to taste",
  "as needed",
  "for frying",
  "for greasing",
  "for dusting",
];

// Helper to build a complete Recipe response with scaled data merged in
export function buildScaledRecipeResponse(
  recipe: Recipe,
  newServings: number
): Recipe {
  const scaled = scaleRecipe(recipe, newServings);
  
  // Clone the recipe and merge in scaled fields
  // Append scaling warnings to validationWarnings for display
  const mergedWarnings = [
    ...(recipe.validationWarnings || []),
    ...scaled.warnings.map(w => ({
      severity: 'info' as const,
      category: 'scalingWarning' as const,
      message: w
    }))
  ];
  
  return {
    ...recipe, // All original fields preserved
    servings: scaled.newServings, // Updated servings
    ingredients: scaled.ingredients, // Updated raw ingredient strings
    normalizedIngredients: scaled.normalizedIngredients || recipe.normalizedIngredients, // Updated normalized ingredients
    validationWarnings: mergedWarnings as Recipe['validationWarnings'], // Include scaling warnings in validation warnings
  };
}

export function scaleRecipe(
  recipe: Recipe,
  newServings: number
): ScaledRecipe {
  const scaleFactor = newServings / recipe.servings;
  const warnings: string[] = [];

  // Scale regular ingredients
  const scaledIngredients = recipe.ingredients.map((ing) => {
    // Check if ingredient should not be scaled
    const shouldNotScale = NON_SCALABLE_TERMS.some((term) =>
      ing.toLowerCase().includes(term)
    );

    if (shouldNotScale) {
      warnings.push(`"${ing}" may need manual adjustment (not automatically scaled)`);
      return ing;
    }

    // Try to scale quantity
    return scaleIngredientText(ing, scaleFactor);
  });

  // Scale normalized ingredients if available (deep clone to prevent mutation)
  const scaledNormalized = recipe.normalizedIngredients?.map((ing) => {
    const shouldNotScale = NON_SCALABLE_TERMS.some((term) =>
      ing.raw.toLowerCase().includes(term)
    );

    if (shouldNotScale || !ing.quantity) {
      // Deep clone to prevent mutation of original
      return { ...ing };
    }

    return {
      ...ing,
      quantity: roundToNiceNumber(ing.quantity * scaleFactor),
      raw: scaleIngredientText(ing.raw, scaleFactor),
    };
  });

  // Add warnings for significant scaling
  if (scaleFactor > 2) {
    warnings.push(
      "For large batches, consider using multiple pans to avoid overcrowding."
    );
  }

  if (scaleFactor < 0.5) {
    warnings.push(
      "For very small portions, cooking times may need to be reduced slightly."
    );
  }

  return {
    originalServings: recipe.servings,
    newServings,
    scaleFactor,
    ingredients: scaledIngredients,
    normalizedIngredients: scaledNormalized,
    warnings,
  };
}

function scaleIngredientText(text: string, factor: number): string {
  // One pass, so each amount is scaled once: "1 1/2", "3/4" or "2.5", when it
  // starts the line or comes before a unit ("2 cups", "12 oz")
  const amount = /(\d+\s+\d+\/\d+|\d+\/\d+|\d+(?:\.\d+)?)(\s*)(cups?|tablespoons?|tbsp|teaspoons?|tsp|ounces?|oz|pounds?|lbs?|grams?|g|kg|ml|liters?)?\b/gi;
  return text.replace(amount, (match, num: string, space: string, unit: string | undefined, offset: number) => {
    const atStart = text.slice(0, offset).trim() === "";
    if (!unit && !atStart) return match;
    const mixed = num.match(/^(\d+)\s+(\d+)\/(\d+)$/);
    const frac = num.match(/^(\d+)\/(\d+)$/);
    const quantity = mixed
      ? parseInt(mixed[1]) + parseInt(mixed[2]) / parseInt(mixed[3])
      : frac ? parseInt(frac[1]) / parseInt(frac[2]) : parseFloat(num);
    const scaled = formatQuantity(roundToNiceNumber(quantity * factor));
    return unit ? `${scaled} ${unit}` : `${scaled}${space}`;
  });
}

function formatQuantity(num: number): string {
  // Convert to nice fractions for display
  if (num === 0.125) return "1/8";
  if (num === 0.25) return "1/4";
  if (num === 0.33 || num === 0.333) return "1/3";
  if (num === 0.5) return "1/2";
  if (num === 0.67 || num === 0.667) return "2/3";
  if (num === 0.75) return "3/4";
  
  // For numbers like 1.5, show as "1 1/2"
  const whole = Math.floor(num);
  const frac = num - whole;
  
  if (frac === 0) return whole.toString();
  if (frac === 0.5) return whole > 0 ? `${whole} 1/2` : "1/2";
  if (frac === 0.25) return whole > 0 ? `${whole} 1/4` : "1/4";
  if (frac === 0.75) return whole > 0 ? `${whole} 3/4` : "3/4";
  if (Math.abs(frac - 0.333) < 0.01) return whole > 0 ? `${whole} 1/3` : "1/3";
  if (Math.abs(frac - 0.667) < 0.01) return whole > 0 ? `${whole} 2/3` : "2/3";
  
  // Otherwise use decimal
  return num < 10 ? num.toFixed(1) : Math.round(num).toString();
}

function roundToNiceNumber(num: number): number {
  // Round to nice fractions, but preserve mid-range values
  if (num < 0.125) return 0.125; // 1/8
  if (num < 0.188) return 0.125; // closer to 1/8
  if (num < 0.313) return 0.25; // 1/4
  if (num < 0.416) return 0.33; // 1/3
  if (num < 0.584) return 0.5; // 1/2
  if (num < 0.71) return 0.67; // 2/3
  if (num < 0.875) return 0.75; // 3/4
  if (num < 1.125) return 1;
  if (num < 10) return Math.round(num * 4) / 4; // Quarter increments
  return Math.round(num);
}
