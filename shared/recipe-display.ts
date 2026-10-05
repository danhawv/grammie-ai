import { convertAmount, type UnitSystem } from './units';

// How the recipe page and cooking mode show amounts and times on screen.
// Amounts go before the name with kitchen fractions: "4½ lb chicken breast, diced".

// Pseudo-units from ingredient normalization that read as data artifacts
// ("4 unit shallots"); the bare number is what a cook expects.
const COUNT_UNITS = new Set(['unit', 'units', 'unité', 'each', 'ea', 'piece', 'pieces', 'pc', 'pcs', 'whole', 'count', 'item', 'items']);

const FRACTIONS: [number, string][] = [
  [1 / 8, '⅛'], [1 / 4, '¼'], [1 / 3, '⅓'], [3 / 8, '⅜'], [1 / 2, '½'],
  [5 / 8, '⅝'], [2 / 3, '⅔'], [3 / 4, '¾'], [7 / 8, '⅞'],
];

const METRIC_UNITS = new Set(['g', 'gram', 'grams', 'kg', 'ml', 'l', 'liter', 'liters', 'litre', 'litres', 'cl', 'dl']);

/** 4.5 → "4½", 0.333 → "⅓", 2.27 → "2.27", 12 → "12" (decimals only with decimal: true) */
export function formatQuantityNumber(quantity: number, opts: { decimal?: boolean } = {}): string {
  if (!Number.isFinite(quantity) || quantity <= 0) return '';
  if (opts.decimal) return String(Number(quantity.toFixed(2)));
  let whole = Math.floor(quantity);
  let frac = quantity - whole;
  if (frac > 0.985) { whole += 1; frac = 0; }
  if (frac < 0.015) return String(whole);
  const match = FRACTIONS.find(([v]) => Math.abs(frac - v) < 0.015);
  if (match) return `${whole > 0 ? whole : ''}${match[1]}`;
  return String(Number(quantity.toFixed(2)));
}

/** The amount part of an ingredient line: "4½ lb", "2", "" */
export function formatAmount(quantity: number | null | undefined, unit: string | null | undefined): string {
  if (quantity == null) return '';
  const u = unit?.trim();
  const num = formatQuantityNumber(quantity, { decimal: !!u && METRIC_UNITS.has(u.toLowerCase()) });
  if (!num) return '';
  if (!u || COUNT_UNITS.has(u.toLowerCase())) return num;
  return `${num} ${u}`;
}

export interface IngredientLike {
  quantity?: number | null;
  unit?: string | null;
  item?: string;
  name?: string;
  raw?: string;
  preparation?: string | null;
  isOptional?: boolean;
}

export interface IngredientDisplay {
  /** "4½ lb", or "" when there's no amount */
  amount: string;
  /** "chicken breast" */
  name: string;
  /** "diced", or "" */
  preparation: string;
  optional: boolean;
}

/** Split an ingredient into amount / name / preparation in the chosen unit system */
export function ingredientDisplay(ing: IngredientLike, system: UnitSystem): IngredientDisplay {
  const conv = ing.quantity != null ? convertAmount(ing.quantity, ing.unit ?? undefined, system) : null;
  const amount = formatAmount(conv?.quantity ?? ing.quantity, conv?.unit ?? ing.unit);
  const name = ing.item || ing.name || ing.raw || '';
  return { amount, name, preparation: ing.preparation?.trim() || '', optional: !!ing.isOptional };
}

/** 95 → "1 hr 35 min", 60 → "1 hr", 20 → "20 min" */
export function formatMinutes(minutes: number | null | undefined): string {
  if (minutes == null || !Number.isFinite(minutes) || minutes <= 0) return '';
  const m = Math.round(minutes);
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h > 0 && r > 0) return `${h} hr ${r} min`;
  if (h > 0) return `${h} hr`;
  return `${r} min`;
}
