import { formatIngredientQuantity } from './print-format';

// Unit-system conversion for ingredient display. Recipes keep whatever units
// their source used (UK sources give grams, US sources give cups), so viewers
// can flip any recipe to the system they cook in.
//
// Deliberately conservative: mass converts to mass (g ↔ oz/lb) and volume to
// volume (ml ↔ cups/fl oz). Crossing mass↔volume needs per-ingredient density
// (a cup of flour ≠ a cup of honey), so unknown or unit-less lines pass
// through unchanged rather than being guessed at. Teaspoons and tablespoons
// are used by cooks in both systems and are never converted.

export type UnitSystem = 'original' | 'metric' | 'us';

type Kind = 'mass' | 'volume';

// Canonical name → [kind, factor to base unit (g or ml)]
const UNITS: Record<string, [Kind, number]> = {
  g: ['mass', 1], kg: ['mass', 1000],
  oz: ['mass', 28.35], lb: ['mass', 453.6],
  ml: ['volume', 1], l: ['volume', 1000],
  floz: ['volume', 29.57], cup: ['volume', 240],
  pint: ['volume', 473.2], quart: ['volume', 946.4], gallon: ['volume', 3785.4],
};

const ALIASES: Record<string, string> = {
  gram: 'g', grams: 'g', gramme: 'g', grammes: 'g', gr: 'g',
  kilogram: 'kg', kilograms: 'kg', kilo: 'kg', kilos: 'kg',
  ounce: 'oz', ounces: 'oz',
  pound: 'lb', pounds: 'lb', lbs: 'lb',
  milliliter: 'ml', milliliters: 'ml', millilitre: 'ml', millilitres: 'ml',
  liter: 'l', liters: 'l', litre: 'l', litres: 'l',
  'fl oz': 'floz', 'fluid ounce': 'floz', 'fluid ounces': 'floz', 'fl. oz.': 'floz', 'fl.oz': 'floz',
  cups: 'cup', c: 'cup',
  pints: 'pint', pt: 'pint',
  quarts: 'quart', qt: 'quart',
  gallons: 'gallon', gal: 'gallon',
};

function canonicalUnit(unit: string): string | null {
  const key = unit.trim().toLowerCase().replace(/\.$/, '');
  if (UNITS[key]) return key;
  if (ALIASES[key]) return ALIASES[key];
  return null;
}

/** Round to a cook-friendly value: quarter steps for small US amounts, sensible wholes for metric */
function roundQuarter(n: number): number {
  return Math.round(n * 4) / 4;
}

function roundMetric(n: number): number {
  if (n < 10) return Math.round(n * 10) / 10;
  if (n < 100) return Math.round(n);
  return Math.round(n / 5) * 5;
}

export interface ConvertedAmount {
  quantity: number;
  unit: string;
  /** True when the value was changed (for "≈" style hints if wanted) */
  converted: boolean;
}

/**
 * Convert a quantity+unit for display in the requested system.
 * Returns null when there's nothing to convert (unknown unit, count, tsp/tbsp,
 * already in-system, or system is 'original') — callers show the line as-is.
 */
export function convertAmount(quantity: number, unit: string | undefined, system: UnitSystem): ConvertedAmount | null {
  if (system === 'original' || !unit || !quantity || !Number.isFinite(quantity)) return null;
  const canon = canonicalUnit(unit);
  if (!canon) return null;
  const [kind, factor] = UNITS[canon];
  const base = quantity * factor; // grams or ml

  if (system === 'metric') {
    if (canon === 'g' || canon === 'kg' || canon === 'ml' || canon === 'l') return null; // already metric
    if (kind === 'mass') {
      return base >= 1000
        ? { quantity: Math.round(base / 10) / 100, unit: 'kg', converted: true }
        : { quantity: roundMetric(base), unit: 'g', converted: true };
    }
    return base >= 1000
      ? { quantity: Math.round(base / 10) / 100, unit: 'l', converted: true }
      : { quantity: roundMetric(base), unit: 'ml', converted: true };
  }

  // system === 'us'
  if (kind === 'mass') {
    if (canon === 'oz' || canon === 'lb') return null; // already US
    const oz = base / 28.35;
    return oz >= 16
      ? { quantity: roundQuarter(oz / 16), unit: 'lb', converted: true }
      : { quantity: roundQuarter(oz), unit: 'oz', converted: true };
  }
  if (canon === 'floz' || canon === 'cup' || canon === 'pint' || canon === 'quart' || canon === 'gallon') return null; // already US
  // metric volume → the most natural US kitchen unit
  if (base >= 60) {
    const cups = base / 240;
    if (cups >= 16) return { quantity: roundQuarter(cups / 16), unit: 'gallon', converted: true };
    if (cups >= 8) return { quantity: roundQuarter(cups / 4), unit: 'quart', converted: true };
    return { quantity: roundQuarter(cups), unit: 'cup', converted: true };
  }
  if (base >= 15) return { quantity: roundQuarter(base / 14.79), unit: 'tbsp', converted: true };
  return { quantity: roundQuarter(base / 4.93), unit: 'tsp', converted: true };
}

/** Format a normalized ingredient line in the requested unit system */
export function formatIngredientInSystem(
  ing: { quantity?: number; unit?: string; item?: string; name?: string; raw?: string; preparation?: string | null },
  system: UnitSystem
): string {
  const conv = ing.quantity != null ? convertAmount(ing.quantity, ing.unit, system) : null;
  const quantity = conv?.quantity ?? ing.quantity;
  const unit = conv?.unit ?? ing.unit;

  const name = ing.item || ing.name || '';
  const qty = formatIngredientQuantity(quantity, unit);
  let text = [qty, name].filter(Boolean).join(' ');
  if (text && ing.preparation) text += `, ${ing.preparation}`;
  return text || ing.raw || '';
}
