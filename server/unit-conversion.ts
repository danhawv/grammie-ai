/**
 * Unit Conversion Utility for Grocery List Ingredient Aggregation
 * 
 * Normalizes ingredient quantities to base units:
 * - Weight → grams (g)
 * - Volume → milliliters (ml)
 * - Count → count
 */

type BaseUnit = 'g' | 'ml' | 'count';

interface ConversionResult {
  quantity: number;
  unit: BaseUnit;
  canConvert: boolean;
}

// Conversion factors to base units
const WEIGHT_TO_GRAMS: Record<string, number> = {
  'g': 1,
  'gram': 1,
  'grams': 1,
  'kg': 1000,
  'kilogram': 1000,
  'kilograms': 1000,
  'oz': 28.3495,
  'ounce': 28.3495,
  'ounces': 28.3495,
  'lb': 453.592,
  'pound': 453.592,
  'pounds': 453.592,
  'mg': 0.001,
  'milligram': 0.001,
  'milligrams': 0.001,
};

const VOLUME_TO_ML: Record<string, number> = {
  'ml': 1,
  'milliliter': 1,
  'milliliters': 1,
  'l': 1000,
  'liter': 1000,
  'liters': 1000,
  'cup': 236.588,
  'cups': 236.588,
  'tbsp': 14.7868,
  'tablespoon': 14.7868,
  'tablespoons': 14.7868,
  'tsp': 4.92892,
  'teaspoon': 4.92892,
  'teaspoons': 4.92892,
  'fl oz': 29.5735,
  'fluid ounce': 29.5735,
  'fluid ounces': 29.5735,
  'pt': 473.176,
  'pint': 473.176,
  'pints': 473.176,
  'qt': 946.353,
  'quart': 946.353,
  'quarts': 946.353,
  'gal': 3785.41,
  'gallon': 3785.41,
  'gallons': 3785.41,
};

const COUNT_UNITS = new Set([
  'count',
  'whole',
  'piece',
  'pieces',
  'item',
  'items',
  'clove',
  'cloves',
  'slice',
  'slices',
  'leaf',
  'leaves',
  'sprig',
  'sprigs',
  'stalk',
  'stalks',
  'can',
  'cans',
  'jar',
  'jars',
  'package',
  'packages',
  'pkg',
  'box',
  'boxes',
  'bag',
  'bags',
]);

/**
 * Normalize a unit string to lowercase and remove trailing 's'
 */
function normalizeUnitString(unit: string | undefined): string {
  if (!unit) return 'count';
  
  const normalized = unit.toLowerCase().trim();
  return normalized;
}

/**
 * Convert an ingredient quantity to its base unit
 * 
 * @param quantity - The original quantity
 * @param unit - The original unit
 * @returns Conversion result with normalized quantity and base unit
 */
export function convertToBaseUnit(
  quantity: number | undefined,
  unit: string | undefined
): ConversionResult {
  // Handle missing quantity or unit
  if (quantity === undefined || quantity === null) {
    return {
      quantity: 1,
      unit: 'count',
      canConvert: true,
    };
  }

  const normalizedUnit = normalizeUnitString(unit);
  
  // Try weight conversion
  if (normalizedUnit in WEIGHT_TO_GRAMS) {
    return {
      quantity: quantity * WEIGHT_TO_GRAMS[normalizedUnit],
      unit: 'g',
      canConvert: true,
    };
  }
  
  // Try volume conversion
  if (normalizedUnit in VOLUME_TO_ML) {
    return {
      quantity: quantity * VOLUME_TO_ML[normalizedUnit],
      unit: 'ml',
      canConvert: true,
    };
  }
  
  // Check if it's a count-based unit
  if (COUNT_UNITS.has(normalizedUnit) || normalizedUnit === '') {
    return {
      quantity,
      unit: 'count',
      canConvert: true,
    };
  }
  
  // Cannot convert - keep original (will be separate line item)
  return {
    quantity,
    unit: 'count', // Default to count for unknown units
    canConvert: false,
  };
}

/**
 * Convert base units to user-friendly display units
 */
export function convertToDisplayUnit(
  quantity: number,
  baseUnit: BaseUnit,
  preferMetric: boolean = true
): { quantity: number; unit: string } {
  // Handle count-based items (no conversion needed)
  if (baseUnit === 'count') {
    return { quantity, unit: 'count' };
  }

  // Convert weight (grams)
  if (baseUnit === 'g') {
    if (preferMetric) {
      // Metric: Use kg for large quantities, g otherwise
      if (quantity >= 1000) {
        return { quantity: quantity / 1000, unit: 'kg' };
      }
      return { quantity, unit: 'g' };
    } else {
      // US: Use lb for large quantities, oz otherwise
      if (quantity >= 453.592) {
        return { quantity: quantity / 453.592, unit: 'lb' };
      }
      return { quantity: quantity / 28.3495, unit: 'oz' };
    }
  }

  // Convert volume (milliliters)
  if (baseUnit === 'ml') {
    if (preferMetric) {
      // Metric: Use L for large quantities, ml otherwise
      if (quantity >= 1000) {
        return { quantity: quantity / 1000, unit: 'L' };
      }
      return { quantity, unit: 'ml' };
    } else {
      // US: Use cups/tbsp/tsp for cooking quantities
      if (quantity >= 236.588) {
        // Use cups for quantities >= 1 cup
        return { quantity: quantity / 236.588, unit: 'cup' };
      } else if (quantity >= 14.7868) {
        // Use tbsp for quantities >= 1 tbsp
        return { quantity: quantity / 14.7868, unit: 'tbsp' };
      } else {
        // Use tsp for small quantities
        return { quantity: quantity / 4.92892, unit: 'tsp' };
      }
    }
  }

  // Fallback
  return { quantity, unit: baseUnit };
}

/**
 * Format a quantity for display (round to reasonable precision)
 */
export function formatQuantityForDisplay(
  quantity: number,
  unit: string,
  preferMetric: boolean = true
): string {
  // Round to appropriate precision based on size
  let rounded: number;
  if (quantity >= 100) {
    rounded = Math.round(quantity); // No decimals for large quantities
  } else if (quantity >= 10) {
    rounded = Math.round(quantity * 10) / 10; // 1 decimal
  } else {
    rounded = Math.round(quantity * 100) / 100; // 2 decimals
  }
  
  // Remove trailing zeros
  const formatted = rounded.toString().replace(/\.0+$/, '');
  
  // Handle fractions for common US cooking measurements
  if (!preferMetric && (unit === 'cup' || unit === 'tbsp' || unit === 'tsp')) {
    return formatWithFractions(rounded, unit);
  }
  
  return `${formatted} ${unit}`;
}

/**
 * Format numbers with common fractions for US measurements
 */
function formatWithFractions(quantity: number, unit: string): string {
  const whole = Math.floor(quantity);
  const decimal = quantity - whole;
  
  // Common fractions
  const fractions: [number, string][] = [
    [0.25, '¼'],
    [0.33, '⅓'],
    [0.5, '½'],
    [0.67, '⅔'],
    [0.75, '¾'],
  ];
  
  // Find closest fraction
  let fraction = '';
  let minDiff = 0.1; // Only use fraction if within 0.1
  
  for (const [value, symbol] of fractions) {
    const diff = Math.abs(decimal - value);
    if (diff < minDiff) {
      minDiff = diff;
      fraction = symbol;
    }
  }
  
  if (fraction && whole > 0) {
    return `${whole} ${fraction} ${unit}`;
  } else if (fraction) {
    return `${fraction} ${unit}`;
  } else {
    // Use decimal
    const rounded = Math.round(quantity * 100) / 100;
    return `${rounded} ${unit}`;
  }
}

/**
 * Check if two ingredients can be aggregated (same item and compatible units)
 */
export function canAggregateIngredients(
  item1: string,
  unit1: string,
  item2: string,
  unit2: string
): boolean {
  // Items must match (case-insensitive)
  if (item1.toLowerCase().trim() !== item2.toLowerCase().trim()) {
    return false;
  }
  
  // Units must both convert to the same base unit
  const result1 = convertToBaseUnit(1, unit1);
  const result2 = convertToBaseUnit(1, unit2);
  
  return result1.canConvert && result2.canConvert && result1.unit === result2.unit;
}

/**
 * Aggregate quantities from multiple ingredients
 */
export function aggregateQuantities(
  ingredients: Array<{ quantity: number; unit: string }>
): ConversionResult {
  if (ingredients.length === 0) {
    return { quantity: 0, unit: 'count', canConvert: true };
  }
  
  // Convert all to base units
  const conversions = ingredients.map(ing => 
    convertToBaseUnit(ing.quantity, ing.unit)
  );
  
  // Check all conversions use the same base unit
  const baseUnit = conversions[0].unit;
  const allSameUnit = conversions.every(c => c.unit === baseUnit && c.canConvert);
  
  if (!allSameUnit) {
    // Cannot aggregate - units incompatible
    return {
      quantity: ingredients[0].quantity,
      unit: baseUnit,
      canConvert: false,
    };
  }
  
  // Sum all quantities
  const totalQuantity = conversions.reduce((sum, c) => sum + c.quantity, 0);
  
  return {
    quantity: totalQuantity,
    unit: baseUnit,
    canConvert: true,
  };
}
