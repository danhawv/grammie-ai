import { describe, expect, it } from 'vitest';
import { transformRecipe, hasOriginalSteps, stepsVersionFor } from './print-recipe-transform';

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

describe("printing a recipe's own directions or Grammie's fuller steps", () => {
  const recipe = {
    id: "r1", title: "Cheese Ball", ingredients: ["1 stick butter"],
    instructions: ["Step 1: Soften the butter at room temperature.", "Step 2: Mix well and shape into a ball.", "Step 3: Chill 2 hours."],
    instructionsGenerated: true,
    originalInstructions: ["Soften and mix all together.", "Form ball and refrigerate."],
  } as any;

  it("prints the fuller steps unless asked otherwise", () => {
    expect(transformRecipe(recipe).instructions.map((s) => s.text)).toEqual([
      "Soften the butter at room temperature.", "Mix well and shape into a ball.", "Chill 2 hours.",
    ]);
  });
  it("prints the original words when chosen", () => {
    expect(transformRecipe(recipe, "original", "original").instructions.map((s) => s.text)).toEqual([
      "Soften and mix all together.", "Form ball and refrigerate.",
    ]);
  });
  it("falls back to the only directions a recipe has", () => {
    const plain = { ...recipe, instructionsGenerated: false, originalInstructions: null };
    expect(hasOriginalSteps(plain)).toBe(false);
    expect(transformRecipe(plain, "original", "original").instructions).toHaveLength(3);
  });
  it("uses the recipe's own choice, then the book's, then the fuller steps", () => {
    expect(stepsVersionFor("r1", undefined)).toBe("improved");
    expect(stepsVersionFor("r1", { customizations: { stepsVersion: "original" } })).toBe("original");
    expect(stepsVersionFor("r1", { customizations: { stepsVersion: "original" }, recipePrintSettings: { r1: { steps: "improved" } } })).toBe("improved");
  });
});
