// Maps free-form meal-type tags onto a fixed set of cookbook chapters.
// Recipe tags are inconsistent ("Dinner", "dinner", "lunch/dinner", "Main
// Course"), often multiple per recipe, and sometimes missing, so a printed
// book needs one canonical chapter per recipe.

export interface Chapter {
  key: string;
  title: string;
  /** Tag written back to recipes the AI classifies into this chapter */
  canonicalTag: string;
}

// Book order (front to back)
export const CHAPTERS: Chapter[] = [
  { key: 'breakfast', title: 'Breakfast', canonicalTag: 'Breakfast' },
  { key: 'starters', title: 'Appetizers & Snacks', canonicalTag: 'Appetizer' },
  { key: 'soups-salads', title: 'Soups & Salads', canonicalTag: 'Salad' },
  { key: 'mains', title: 'Mains', canonicalTag: 'Dinner' },
  { key: 'sides', title: 'Sides', canonicalTag: 'Side Dish' },
  { key: 'sauces', title: 'Sauces, Dips & Dressings', canonicalTag: 'Sauce' },
  { key: 'desserts', title: 'Desserts', canonicalTag: 'Dessert' },
  { key: 'drinks', title: 'Drinks', canonicalTag: 'Beverage' },
];

export const OTHER_CHAPTER: Chapter = { key: 'more', title: 'More Recipes', canonicalTag: '' };

const TAG_TO_CHAPTER: Record<string, string> = {
  breakfast: 'breakfast', brunch: 'breakfast',
  appetizer: 'starters', appetizers: 'starters', snack: 'starters', snacks: 'starters',
  starter: 'starters', 'finger food': 'starters', 'party food': 'starters', entertaining: 'starters',
  salad: 'soups-salads', salads: 'soups-salads', soup: 'soups-salads', soups: 'soups-salads', stew: 'soups-salads',
  dinner: 'mains', lunch: 'mains', 'main course': 'mains', main: 'mains', mains: 'mains', entree: 'mains', entrée: 'mains',
  'side dish': 'sides', side: 'sides', sides: 'sides',
  sauce: 'sauces', sauces: 'sauces', dip: 'sauces', dips: 'sauces', marinade: 'sauces',
  dressing: 'sauces', condiment: 'sauces', spread: 'sauces', seasoning: 'sauces', rub: 'sauces',
  dessert: 'desserts', desserts: 'desserts', baking: 'desserts', sweets: 'desserts',
  beverage: 'drinks', beverages: 'drinks', drink: 'drinks', drinks: 'drinks', cocktail: 'drinks', smoothie: 'drinks',
};

// When a recipe carries several tags, the most specific wins: a "Dessert,
// Snack" belongs in Desserts, a "Snack, Lunch" in Appetizers & Snacks.
const SPECIFICITY = ['desserts', 'drinks', 'sauces', 'breakfast', 'soups-salads', 'sides', 'starters', 'mains'];

/** Split compound tags like "lunch/dinner" or "Lunch, Dinner" into parts */
function tagParts(tag: string): string[] {
  return tag.toLowerCase().split(/[\/,&]| and /).map((t) => t.trim()).filter(Boolean);
}

/** Chapter key for a recipe's tags, or null when no tag is recognizable */
export function chapterForTags(tags: string[] | null | undefined): string | null {
  if (!Array.isArray(tags) || tags.length === 0) return null;
  const keys = new Set<string>();
  for (const tag of tags) {
    for (const part of tagParts(tag)) {
      const key = TAG_TO_CHAPTER[part];
      if (key) keys.add(key);
    }
  }
  if (keys.size === 0) return null;
  return SPECIFICITY.find((k) => keys.has(k)) ?? null;
}

export interface CoursePlanRecipe {
  id: string;
  title: string;
  mealType: string[] | null;
}

export interface PlannedChapter {
  key: string;
  title: string;
  recipeIds: string[];
  recipeTitles: string[];
}

/** Group recipes into chapters in book order, dropping empty chapters */
export function buildCoursePlan(recipes: CoursePlanRecipe[]): PlannedChapter[] {
  const buckets = new Map<string, CoursePlanRecipe[]>();
  for (const r of recipes) {
    const key = chapterForTags(r.mealType) ?? OTHER_CHAPTER.key;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(r);
  }
  return [...CHAPTERS, OTHER_CHAPTER]
    .filter((c) => buckets.has(c.key))
    .map((c) => {
      const items = buckets.get(c.key)!.sort((a, b) => a.title.localeCompare(b.title));
      return {
        key: c.key,
        title: c.title,
        recipeIds: items.map((r) => r.id),
        recipeTitles: items.map((r) => r.title),
      };
    });
}
