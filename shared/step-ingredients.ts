import { formatIngredientInSystem, type UnitSystem } from './units';

// Matches a step's ingredient names (from AI-normalized instructions, e.g.
// ["dried chickpeas", "salt"]) back to the recipe's full ingredient entries so
// the UI can show quantities in place: "200 g dried chickpeas, soaked".

export interface StepIngredientMatch {
  /** The name as the step references it */
  name: string;
  /** Full display line with quantity when a match was found, else the bare name */
  display: string;
  /** Whether a full ingredient entry was matched */
  matched: boolean;
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9à-ɏ ]/gi, '').trim();
}

/** Loose containment match: "chickpeas" matches "dried chickpeas" and vice versa */
function ingredientMatches(stepName: string, item: string): boolean {
  const a = normalize(stepName);
  const b = normalize(item);
  if (!a || !b) return false;
  return a === b || a.includes(b) || b.includes(a);
}

export function matchStepIngredients(
  stepIngredients: string[] | null | undefined,
  recipeIngredients: { quantity?: number; unit?: string; item?: string; name?: string; raw?: string; preparation?: string | null }[] | null | undefined,
  system: UnitSystem = 'original'
): StepIngredientMatch[] {
  if (!Array.isArray(stepIngredients) || stepIngredients.length === 0) return [];
  const entries = Array.isArray(recipeIngredients) ? recipeIngredients : [];

  return stepIngredients.map((name) => {
    const entry = entries.find((ing) => ingredientMatches(name, ing.item || ing.name || ''));
    return entry
      ? { name, display: formatIngredientInSystem(entry, system), matched: true }
      : { name, display: name, matched: false };
  });
}
