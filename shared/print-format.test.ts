import { describe, it, expect } from 'vitest';
import { formatIngredientQuantity, formatNormalizedIngredient } from './print-format';

describe('formatIngredientQuantity', () => {
  it('renders decimals as cook-friendly fractions', () => {
    expect(formatIngredientQuantity(0.5, 'cup')).toBe('1/2 cup');
    expect(formatIngredientQuantity(0.25, 'teaspoon')).toBe('1/4 teaspoon');
    expect(formatIngredientQuantity(0.125, 'teaspoon')).toBe('1/8 teaspoon');
    expect(formatIngredientQuantity(1.5, 'cup')).toBe('1 1/2 cup');
  });

  it('keeps whole numbers plain', () => {
    expect(formatIngredientQuantity(2, 'tbsp')).toBe('2 tbsp');
    expect(formatIngredientQuantity(3, undefined)).toBe('3');
  });

  it('suppresses pseudo-units like "unit", "each", and "items"', () => {
    expect(formatIngredientQuantity(4, 'unit')).toBe('4');
    expect(formatIngredientQuantity(2, 'each')).toBe('2');
    expect(formatIngredientQuantity(1, 'Unit')).toBe('1');
    expect(formatIngredientQuantity(24, 'items')).toBe('24');
  });

  it('returns empty for missing quantity', () => {
    expect(formatIngredientQuantity(undefined, 'cup')).toBe('');
    expect(formatIngredientQuantity(0, 'cup')).toBe('');
  });
});

describe('formatNormalizedIngredient', () => {
  it('combines quantity, unit, and item name', () => {
    expect(formatNormalizedIngredient({ quantity: 0.5, unit: 'cup', item: 'yogurt' })).toBe('1/2 cup yogurt');
  });

  it('never drops the item name (the "0.5 cup of nothing" bug)', () => {
    const line = formatNormalizedIngredient({ quantity: 0.5, unit: 'cup', item: 'yogurt', raw: '1/2 c. yogurt' });
    expect(line).toContain('yogurt');
  });

  it('appends preparation after a comma', () => {
    expect(formatNormalizedIngredient({ quantity: 4, unit: 'unit', item: 'shallots', preparation: 'finely diced' }))
      .toBe('4 shallots, finely diced');
  });

  it('falls back to name, then raw', () => {
    expect(formatNormalizedIngredient({ quantity: 1, unit: 'tbsp', name: 'tahini' })).toBe('1 tbsp tahini');
    expect(formatNormalizedIngredient({ raw: 'a pinch of salt' })).toBe('a pinch of salt');
  });
});
