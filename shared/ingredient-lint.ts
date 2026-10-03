import { formatNormalizedIngredient } from './print-format';

// Heuristics for catching AI-normalization artifacts before they reach a
// printed book — e.g. "24 cookies Oreo cookies" (unit duplicated in the item)
// or "1/2 lemon lemon zest" (item starts with the unit word). Each issue
// carries a suggested fix expressed as a patch to the normalized ingredient.

export interface NormalizedIngredientLike {
  quantity?: number;
  unit?: string;
  item?: string;
  name?: string;
  raw?: string;
  preparation?: string | null;
  [key: string]: unknown;
}

export interface IngredientIssue {
  /** Index into the recipe's normalizedIngredients array */
  index: number;
  /** How the line currently prints */
  display: string;
  /** Human-readable description of the problem */
  message: string;
  /** How the line prints after the suggested fix (null = no auto-fix available) */
  suggestedDisplay: string | null;
  /** Patch to merge into the ingredient to apply the fix */
  fix: Partial<NormalizedIngredientLike> | null;
}

const WORD_SPLIT = /\s+/;

function normalizeWord(w: string): string {
  // Strip punctuation, keep letters (incl. accented) and digits
  return w.toLowerCase().replace(/[^a-z0-9À-ɏ]/g, '');
}

/** Singular/plural-insensitive word comparison ("cookie" vs "cookies") */
function sameWord(a: string, b: string): boolean {
  const na = normalizeWord(a);
  const nb = normalizeWord(b);
  if (!na || !nb) return false;
  return na === nb || na === nb + 's' || nb === na + 's';
}

function lintOne(ing: NormalizedIngredientLike, index: number): IngredientIssue | null {
  const display = formatNormalizedIngredient(ing);
  const item = (ing.item || ing.name || '').trim();
  const unit = (ing.unit || '').trim();
  const itemWords = item ? item.split(WORD_SPLIT) : [];

  // Missing item: renders as a bare quantity ("1/2 cup" of nothing)
  if (!item && !ing.raw) {
    return {
      index,
      display,
      message: 'Ingredient name is missing — this prints as a bare quantity.',
      suggestedDisplay: null,
      fix: null,
    };
  }

  // Unit word duplicated in the item ("24 cookies Oreo cookies")
  if (unit && itemWords.some((w) => sameWord(w, unit))) {
    const fix = { unit: undefined };
    return {
      index,
      display,
      message: `The unit "${unit}" repeats inside the ingredient name.`,
      suggestedDisplay: formatNormalizedIngredient({ ...ing, ...fix }),
      fix,
    };
  }

  // Doubled consecutive word in the item ("lemon lemon zest")
  for (let i = 0; i < itemWords.length - 1; i++) {
    if (sameWord(itemWords[i], itemWords[i + 1])) {
      const cleaned = itemWords.filter((w, j) => j === 0 || !sameWord(w, itemWords[j - 1])).join(' ');
      const fix = { item: cleaned };
      return {
        index,
        display,
        message: `"${itemWords[i]}" appears twice in a row.`,
        suggestedDisplay: formatNormalizedIngredient({ ...ing, ...fix }),
        fix,
      };
    }
  }

  return null;
}

/** Scan a recipe's normalized ingredients; returns one issue per flagged line */
export function lintIngredients(ingredients: NormalizedIngredientLike[] | null | undefined): IngredientIssue[] {
  if (!Array.isArray(ingredients)) return [];
  const issues: IngredientIssue[] = [];
  ingredients.forEach((ing, i) => {
    const issue = lintOne(ing, i);
    if (issue) issues.push(issue);
  });
  return issues;
}
