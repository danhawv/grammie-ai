import { describe, expect, it } from 'vitest';
import { transformRecipe } from './print-recipe-transform';

const base: any = { id: 'r', title: 'Baba Ghanoush', ingredients: [], instructions: [], tips: [] };

describe('transformRecipe', () => {
  it('keeps section headings from the original ingredient lines', () => {
    const r = transformRecipe({
      ...base,
      ingredients: ['1 med. eggplant', "Mom's Taratoor (makes 1 1/2 c.):", '1 c. tahini paste', 'Or Near East Sauce:', '3 garlic cloves'],
      normalizedIngredients: [{ raw: 'x', item: 'flattened' }],
    });
    expect(r.ingredients).toEqual([
      { items: ['1 med. eggplant'] },
      { heading: "Mom's Taratoor (makes 1 1/2 c.)", items: ['1 c. tahini paste'] },
      { heading: 'Or Near East Sauce', items: ['3 garlic cloves'] },
    ]);
  });

  it('drops "Step 3:" labels the page numbers itself', () => {
    const r = transformRecipe({ ...base, instructions: ['Step 1: Preheat the oven.', 'Step 2) Bake 20 min.', 'Stir in step 3 sauce.'] });
    expect(r.instructions.map((s) => s.text)).toEqual(['Preheat the oven.', 'Bake 20 min.', 'Stir in step 3 sauce.']);
  });
});
