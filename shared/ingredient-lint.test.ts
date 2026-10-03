import { describe, it, expect } from 'vitest';
import { lintIngredients } from './ingredient-lint';
import { formatNormalizedIngredient } from './print-format';

describe('lintIngredients', () => {
  it('flags a unit that repeats inside the item ("24 cookies Oreo cookies")', () => {
    const issues = lintIngredients([{ quantity: 24, unit: 'cookies', item: 'Oreo cookies' }]);
    expect(issues).toHaveLength(1);
    expect(issues[0].suggestedDisplay).toBe('24 Oreo cookies');
    expect(issues[0].fix).toEqual({ unit: undefined });
  });

  it('flags doubled words in the item ("lemon lemon zest")', () => {
    const issues = lintIngredients([{ quantity: 0.5, item: 'lemon lemon zest' }]);
    expect(issues).toHaveLength(1);
    expect(issues[0].suggestedDisplay).toBe('1/2 lemon zest');
  });

  it('flags missing item names with no auto-fix', () => {
    const issues = lintIngredients([{ quantity: 0.5, unit: 'cup' }]);
    expect(issues).toHaveLength(1);
    expect(issues[0].fix).toBeNull();
  });

  it('passes clean ingredients', () => {
    const issues = lintIngredients([
      { quantity: 0.5, unit: 'cup', item: 'yogurt' },
      { quantity: 2, unit: 'cloves', item: 'garlic', preparation: 'peeled' },
      { quantity: 200, unit: 'g', item: 'ginger' },
      { raw: 'salt to taste' },
    ]);
    expect(issues).toHaveLength(0);
  });

  it('suggested fixes survive round-tripping through the formatter', () => {
    const ing = { quantity: 24, unit: 'cookies', item: 'Oreo cookies' };
    const [issue] = lintIngredients([ing]);
    const fixed = { ...ing, ...issue.fix };
    expect(formatNormalizedIngredient(fixed)).toBe(issue.suggestedDisplay);
  });

  it('handles null/undefined input', () => {
    expect(lintIngredients(null)).toEqual([]);
    expect(lintIngredients(undefined)).toEqual([]);
  });
});
