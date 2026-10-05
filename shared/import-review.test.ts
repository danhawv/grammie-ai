import { describe, expect, it } from 'vitest';
import {
  countEditLikely,
  findEditLikely,
  friendlyImportError,
  importStatusOf,
  parseIngredientLine,
  reconcileNormalizedIngredients,
  reconcileNormalizedInstructions,
  stripUnsureMarkers,
} from './import-review';

const kinds = (line: string, field: 'title' | 'ingredient' | 'step') => findEditLikely(line, field).map((f) => f.kind);

describe('findEditLikely', () => {
  it('leaves ordinary lines alone', () => {
    expect(kinds('2 cups flour', 'ingredient')).toEqual([]);
    expect(kinds('3 eggs', 'ingredient')).toEqual([]);
    expect(kinds('1 tsp vanilla extract', 'ingredient')).toEqual([]);
    expect(kinds('Stir until smooth.', 'step')).toEqual([]);
    expect(kinds("Grandma's Pound Cake", 'title')).toEqual([]);
  });

  it('flags fractions, including mixed and unicode ones', () => {
    expect(kinds('1/2 cup sugar', 'ingredient')).toEqual(['fraction']);
    expect(findEditLikely('1 1/2 cups milk', 'ingredient')[0].text).toBe('1 1/2');
    expect(kinds('½ tsp salt', 'ingredient')).toEqual(['fraction']);
    expect(findEditLikely('3/7 cup oil', 'ingredient')[0].message).toMatch(/unusual/);
  });

  it('flags ambiguous single-letter units', () => {
    const flags = findEditLikely('2 t baking soda', 'ingredient');
    expect(flags.map((f) => f.kind)).toContain('unit');
    expect(flags.find((f) => f.kind === 'unit')!.message).toMatch(/teaspoon or tablespoon/);
    expect(kinds('1 c. sugar', 'ingredient')).toContain('unit');
  });

  it('flags implausible amounts and missing units', () => {
    expect(kinds('12 tbsp salt', 'ingredient')).toContain('amount');
    expect(kinds('2 flour', 'ingredient')).toContain('unit');
  });

  it('flags oven temperatures in steps, and calls out odd ones', () => {
    expect(kinds('Bake at 350°F for 30 minutes', 'step')).toEqual(['temperature']);
    expect(kinds('Preheat oven to 375', 'step')).toEqual(['temperature']);
    expect(findEditLikely('Bake at 35°F', 'step')[0].message).toMatch(/unusual/);
    expect(findEditLikely('Roast at 180°C', 'step')[0].message).not.toMatch(/unusual/);
    expect(kinds('Bake 25 minutes', 'step')).toEqual([]);
  });

  it('flags words the reader was unsure about', () => {
    const [flag] = findEditLikely('1 cup buttermi1k', 'ingredient');
    expect(flag.kind).toBe('unclear');
    const marked = findEditLikely('2 cups oleo [?]', 'ingredient');
    expect(marked[0].kind).toBe('unclear');
    expect(marked[0].message).toMatch(/oleo/);
  });

  it('flags placeholders and missing titles', () => {
    expect(kinds('Instructions could not be extracted from the image.', 'step')).toEqual(['missing']);
    expect(kinds('Your Recipe', 'title')).toEqual(['missing']);
    expect(kinds('', 'title')).toEqual(['missing']);
  });

  it('counts flagged fields', () => {
    expect(countEditLikely('Cake', ['2 cups flour', '1/2 cup sugar'], ['Bake at 350°F'])).toBe(2);
  });
});

describe('stripUnsureMarkers', () => {
  it('removes markers and tidies spaces', () => {
    expect(stripUnsureMarkers('2 cups oleo [?] softened')).toBe('2 cups oleo softened');
  });
});

describe('importStatusOf', () => {
  it('maps pipeline state to one status', () => {
    expect(importStatusOf({ enrichmentStatus: 'extracting' })).toBe('reading');
    expect(importStatusOf({ enrichmentStatus: 'enriching' })).toBe('reading');
    expect(importStatusOf({ enrichmentStatus: 'failed', title: 'Failed to Extract Recipe', ingredients: ['Extracting...'] })).toBe('failed');
    expect(importStatusOf({ enrichmentStatus: 'failed', ingredients: ['2 eggs'], reviewStatus: 'needs_review' })).toBe('needs_review');
    expect(importStatusOf({ enrichmentStatus: 'ready', ingredients: ['2 eggs'], reviewStatus: 'needs_review' })).toBe('needs_review');
    expect(importStatusOf({ enrichmentStatus: 'ready', ingredients: ['2 eggs'], reviewStatus: 'reviewed' })).toBe('saved');
  });

  it('uses the fallback when there is no review record', () => {
    expect(importStatusOf({ enrichmentStatus: 'ready', ingredients: ['2 eggs'], reviewStatus: null })).toBe('saved');
    expect(importStatusOf({ enrichmentStatus: 'ready', ingredients: ['2 eggs'], reviewStatus: null }, true)).toBe('needs_review');
  });
});

describe('friendlyImportError', () => {
  it('turns pipeline errors into actionable reasons', () => {
    expect(friendlyImportError('Vision extraction failed: text is too small/blurry')).toMatch(/blurry/);
    expect(friendlyImportError('Vision extraction timed out after 120 seconds')).toMatch(/too long/);
    expect(friendlyImportError('Invalid recipe data from AI extraction - missing ingredients')).toMatch(/couldn’t find a recipe/);
    expect(friendlyImportError(null)).toMatch(/Try again/);
  });
});

describe('parseIngredientLine', () => {
  it('reads quantity, unit, item and preparation', () => {
    expect(parseIngredientLine('1 1/2 cups flour, sifted')).toMatchObject({ quantity: 1.5, unit: 'cup', item: 'flour', preparation: 'sifted' });
    expect(parseIngredientLine('½ tsp salt')).toMatchObject({ quantity: 0.5, unit: 'tsp', item: 'salt' });
    expect(parseIngredientLine('2 T butter')).toMatchObject({ quantity: 2, unit: 'tbsp', item: 'butter' });
    expect(parseIngredientLine('3 eggs')).toMatchObject({ quantity: 3, unit: undefined, item: 'eggs' });
  });

  it('keeps lines it cannot read as typed', () => {
    const range = parseIngredientLine('2-3 cups broth');
    expect(range.quantity).toBeUndefined();
    expect(range.item).toBe('2-3 cups broth');
    const toTaste = parseIngredientLine('Salt to taste');
    expect(toTaste.quantity).toBeUndefined();
    expect(toTaste.item).toBe('Salt to taste');
  });
});

describe('reconcileNormalized*', () => {
  const old = ['2 cups flour', '1 cup sugar'];
  const norm = [
    { raw: '2 cups flour', quantity: 2, unit: 'cup', item: 'flour', emoji: '🌾' },
    { raw: '1 cup sugar', quantity: 1, unit: 'cup', item: 'sugar', emoji: '🍬' },
  ];

  it('keeps entries for unchanged lines and re-parses edited ones', () => {
    const out = reconcileNormalizedIngredients(old, ['2 cups flour', '3/4 cup sugar', '2 eggs'], norm);
    expect(out[0]).toBe(norm[0]);
    expect(out[1]).toMatchObject({ raw: '3/4 cup sugar', quantity: 0.75, unit: 'cup', item: 'sugar' });
    expect(out[2]).toMatchObject({ quantity: 2, item: 'eggs' });
  });

  it('follows lines that moved', () => {
    const out = reconcileNormalizedIngredients(old, ['1 cup sugar', '2 cups flour'], norm);
    expect(out).toEqual([norm[1], norm[0]]);
  });

  it('renumbers steps and replaces edited ones', () => {
    const steps = ['Mix.', 'Bake.'];
    const nsteps = [
      { stepNumber: 1, text: 'Mix.', ingredients: ['flour'], tools: [] },
      { stepNumber: 2, text: 'Bake.', ingredients: [], tools: ['oven'] },
    ];
    const out = reconcileNormalizedInstructions(steps, ['Preheat to 350°F.', 'Mix.', 'Bake.'], nsteps);
    expect(out.map((s) => s.stepNumber)).toEqual([1, 2, 3]);
    expect(out[0]).toMatchObject({ text: 'Preheat to 350°F.', ingredients: [] });
    expect(out[1]).toMatchObject({ text: 'Mix.', ingredients: ['flour'] });
    expect(out[2]).toMatchObject({ tools: ['oven'] });
  });
});
