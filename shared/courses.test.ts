import { describe, it, expect } from 'vitest';
import { chapterForTags, buildCoursePlan } from './courses';

describe('chapterForTags', () => {
  it('normalizes case and synonyms', () => {
    expect(chapterForTags(['Dinner'])).toBe('mains');
    expect(chapterForTags(['dinner'])).toBe('mains');
    expect(chapterForTags(['Main Course'])).toBe('mains');
    expect(chapterForTags(['Dip'])).toBe('sauces');
    expect(chapterForTags(['Side Dish'])).toBe('sides');
  });

  it('splits compound tags', () => {
    expect(chapterForTags(['lunch/dinner'])).toBe('mains');
    expect(chapterForTags(['Lunch/Dinner'])).toBe('mains');
  });

  it('prefers the most specific chapter when tags conflict', () => {
    expect(chapterForTags(['Snack', 'Dessert'])).toBe('desserts');
    expect(chapterForTags(['Lunch', 'Snack'])).toBe('starters');
    expect(chapterForTags(['Dinner', 'Sauce'])).toBe('sauces');
  });

  it('returns null for missing or unknown tags', () => {
    expect(chapterForTags(null)).toBeNull();
    expect(chapterForTags([])).toBeNull();
    expect(chapterForTags(['Holiday'])).toBeNull();
  });
});

describe('buildCoursePlan', () => {
  it('puts each recipe in exactly one chapter, in book order', () => {
    const plan = buildCoursePlan([
      { id: '1', title: 'Pie', mealType: ['Dessert', 'Snack'] },
      { id: '2', title: 'Pancakes', mealType: ['breakfast'] },
      { id: '3', title: 'Steak', mealType: ['dinner'] },
      { id: '4', title: 'Mystery', mealType: null },
    ]);
    expect(plan.map((c) => c.title)).toEqual(['Breakfast', 'Mains', 'Desserts', 'More Recipes']);
    const allIds = plan.flatMap((c) => c.recipeIds).sort();
    expect(allIds).toEqual(['1', '2', '3', '4']);
  });

  it('sorts recipes alphabetically within a chapter', () => {
    const plan = buildCoursePlan([
      { id: 'b', title: 'Zucchini Bake', mealType: ['Dinner'] },
      { id: 'a', title: 'Apple Pork', mealType: ['Dinner'] },
    ]);
    expect(plan[0].recipeTitles).toEqual(['Apple Pork', 'Zucchini Bake']);
  });
});
