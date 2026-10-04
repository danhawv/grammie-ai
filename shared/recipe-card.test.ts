import { describe, it, expect } from 'vitest';
import { buildRecipeCardHtml, CARD_THEME } from './recipe-card';
import type { NormalizedRecipe } from './print-recipe-types';

const recipe: NormalizedRecipe = {
  id: 'r1',
  title: 'Mississippi Roast <Sandwiches>',
  description: 'Tender and savory.',
  prepTime: 5,
  cookTime: 360,
  servings: '8',
  ingredients: [{ items: ['1 (3 lb) chuck roast', '8 slices provolone'] }],
  instructions: [{ step: 1, text: 'Combine in slow cooker.' }, { step: 2, text: 'Shred and serve.' }],
  tags: [],
  imageUrl: 'data:image/png;base64,AAAA',
  nutritionInfo: { calories: 766, protein: '48', fat: '49', sodium: '1200' },
  tips: [{ type: 'serving', text: 'Use crusty bakery buns.' }],
};

const geo = (widthIn: number, heightIn: number) => ({
  widthIn, heightIn, bleedIn: 0.125, padTopIn: 0.625, padBottomIn: 0.625, padLeftIn: 0.825, padRightIn: 0.625, pageNumber: 7,
});

describe('buildRecipeCardHtml', () => {
  const wide = buildRecipeCardHtml(recipe, undefined, CARD_THEME, geo(8.75, 11.25));

  it('renders every ingredient, step, badge, nutrition row and tip', () => {
    expect(wide).toContain('1 (3 lb) chuck roast');
    expect(wide).toContain('Shred and serve.');
    expect(wide).toContain('6 hrs');
    expect(wide).toContain('~766');
    expect(wide).toContain('1200 mg');
    expect(wide).toContain('Use crusty bakery buns.');
  });

  it('escapes recipe text', () => {
    expect(wide).toContain('Mississippi Roast &lt;Sandwiches&gt;');
    expect(wide).not.toContain('<Sandwiches>');
  });

  it('puts the photo beside the title on wide pages and on top on 6x9', () => {
    expect(wide).toMatch(/grid-template-columns:1\.05fr 1fr/);
    const narrow = buildRecipeCardHtml(recipe, undefined, CARD_THEME, geo(6.25, 9.25));
    expect(narrow).not.toMatch(/grid-template-columns:1\.05fr 1fr/);
    expect(narrow).toMatch(/position:absolute;top:0;left:0;right:0;height:/);
  });

  it('marks the content block for shrink-to-fit', () => {
    expect(wide).toMatch(/class="recipe-content" data-avail-h="\d+/);
  });

  it('omits boxes the layout turns off, and the photo when excluded', () => {
    const bare = buildRecipeCardHtml(recipe, { nutritionBox: false, tipsBox: false, badges: false }, CARD_THEME, geo(8.75, 11.25), { includePhoto: false });
    expect(bare).not.toContain('Recipe Tips');
    expect(bare).not.toContain('1200 mg');
    expect(bare).not.toContain('PREP TIME'.toLowerCase());
    expect(bare).not.toContain('<img');
  });
});
