// Helpers for reviewing an AI-imported recipe before it counts as final
// (docs/DESIGN_PRINCIPLES.md §6.2). Pure functions, shared by the review
// screen (highlights) and the server (status + keeping normalized data in
// step with the user's edits).

// ---------------------------------------------------------------------------
// Edit-likely highlights
// ---------------------------------------------------------------------------

export type EditFlagKind = 'fraction' | 'unit' | 'temperature' | 'unclear' | 'amount' | 'missing';

export interface EditFlag {
  kind: EditFlagKind;
  /** The part of the line that triggered the flag (for "Check “1/2”") */
  text: string;
  /** Plain-words hint shown next to the field */
  message: string;
}

export type ReviewFieldKind = 'title' | 'ingredient' | 'step';

/** Marker the photo readers add after a word they couldn't read confidently */
export const UNSURE_MARKER = '[?]';

const UNICODE_FRACTIONS = '½⅓⅔¼¾⅛⅜⅝⅞⅕⅖⅗⅘⅙⅚';
const FRACTION_RE = new RegExp(`(?:\\d+\\s+)?\\d+\\s*/\\s*\\d+|\\d*[${UNICODE_FRACTIONS}]`, 'g');
const COMMON_DENOMINATORS = new Set([2, 3, 4, 8]);

const UNCLEAR_RES: RegExp[] = [
  /\[\?\]|\(\?\)|\?{2,}/,
  /\[(?:illegible|unclear|unreadable)\]/i,
  /�/,
  /_{2,}/,
  // A zero or one inside a word ("fl0ur", "sa1t") is usually a misread letter
  /\b[a-z]*[a-z][01][a-z]+\b/i,
];

const PLACEHOLDER_RES: RegExp[] = [
  /could not be extracted/i,
  /^extracting/i,
];

// Single letters that cooks use for different units ("t" vs "T")
const AMBIGUOUS_UNIT_RE = /(?:^|[\s\d½⅓⅔¼¾⅛])(\d[\d\s/½⅓⅔¼¾⅛]*)\s*(t|T|c|C)\.?(?=\s|$)/;

const SPOON_RE = /(\d+(?:\.\d+)?)\s*(tsp|teaspoons?|tbsp|tbs|tablespoons?)\b/i;
const CUP_RE = /(\d+(?:\.\d+)?)\s*(cups?)\b/i;
const MEASURED_ITEMS = /^(\d+(?:\.\d+)?|\d*[½⅓⅔¼¾⅛])\s+(flour|sugar|milk|butter|water|salt|oil|cream|honey|rice|oats|buttermilk|shortening|cornmeal|cocoa)\b/i;

const TEMP_WITH_SCALE_RE = /(\d{2,3})\s*(?:°\s*([FC])?|degrees?\s*([FC])?\b|deg\.?\s*([FC])?|([FC])\b)/i;
const TEMP_CONTEXT_RE = /\b(?:oven|bake|baking|preheat|heat(?:ed)?\s+to|roast)\b[^\d]{0,24}(\d{3})\b/i;

function fractionFlags(line: string): EditFlag[] {
  const flags: EditFlag[] = [];
  for (const match of line.match(FRACTION_RE) ?? []) {
    const text = match.trim();
    const slash = text.match(/(\d+)\s*\/\s*(\d+)$/);
    const denominator = slash ? Number(slash[2]) : null;
    const numerator = slash ? Number(slash[1]) : null;
    const unusual = denominator !== null && (!COMMON_DENOMINATORS.has(denominator) || (numerator !== null && numerator >= denominator));
    flags.push({
      kind: 'fraction',
      text,
      message: unusual
        ? `“${text}” is an unusual fraction. Check it against the original.`
        : `Check “${text}”. Fractions are easy to misread.`,
    });
  }
  return flags;
}

function temperatureFlag(line: string): EditFlag | null {
  const withScale = line.match(TEMP_WITH_SCALE_RE);
  const contextual = withScale ? null : line.match(TEMP_CONTEXT_RE);
  const match = withScale ?? contextual;
  if (!match) return null;
  const value = Number(match[1]);
  const scale = (withScale && (withScale[2] || withScale[3] || withScale[4] || withScale[5]))?.toUpperCase();
  // A bare "350" or "8 degrees" isn't an oven temperature worth checking
  if (!withScale && value < 150) return null;
  if (withScale && !scale && !/°|degree|deg/i.test(match[0])) return null;
  const unusual = scale === 'C'
    ? value < 90 || value > 290
    : value < 150 || value > 550;
  return {
    kind: 'temperature',
    text: match[0].trim(),
    message: unusual
      ? `“${match[0].trim()}” looks like an unusual temperature. Check it.`
      : `Check the temperature (“${match[0].trim()}”).`,
  };
}

function unitFlags(line: string): EditFlag[] {
  const flags: EditFlag[] = [];
  const ambiguous = line.match(AMBIGUOUS_UNIT_RE);
  if (ambiguous) {
    const letter = ambiguous[2];
    const meaning = letter.toLowerCase() === 't' ? 'teaspoon or tablespoon' : 'cup';
    flags.push({
      kind: 'unit',
      text: `${ambiguous[1].trim()} ${letter}`,
      message: `“${letter}” could mean ${meaning}. Write the unit out.`,
    });
  }
  const spoon = line.match(SPOON_RE);
  if (spoon && Number(spoon[1]) >= 8) {
    flags.push({ kind: 'amount', text: spoon[0], message: `“${spoon[0]}” is a lot. Check the amount and the unit.` });
  }
  const cup = line.match(CUP_RE);
  if (cup && Number(cup[1]) >= 12) {
    flags.push({ kind: 'amount', text: cup[0], message: `“${cup[0]}” is a lot. Check the amount.` });
  }
  const unitless = line.trim().match(MEASURED_ITEMS);
  if (unitless) {
    flags.push({ kind: 'unit', text: unitless[0], message: `“${unitless[0]}” has no unit. Add cups, tablespoons or another unit.` });
  }
  return flags;
}

function unclearFlag(line: string): EditFlag | null {
  for (const re of UNCLEAR_RES) {
    const match = line.match(re);
    if (match) {
      // Show the word before the marker, so "1 [?] cup" says what to check
      const before = line.slice(0, match.index ?? 0).trim().split(/\s+/).pop();
      const text = match[0] === UNSURE_MARKER && before ? `${before} ${UNSURE_MARKER}` : match[0];
      return { kind: 'unclear', text, message: `Grammie wasn’t sure about “${text.replace(UNSURE_MARKER, '').trim() || text}”. Check the original.` };
    }
  }
  return null;
}

/**
 * Flags the parts of one field that are likely to need fixing after an AI
 * read it: fractions, ambiguous units, temperatures and unclear words.
 * Deliberately selective — most lines should come back with no flags.
 */
export function findEditLikely(line: string, field: ReviewFieldKind): EditFlag[] {
  const text = (line ?? '').trim();
  if (!text) {
    return field === 'title'
      ? [{ kind: 'missing', text: '', message: 'Give the recipe a name.' }]
      : [];
  }
  if (PLACEHOLDER_RES.some((re) => re.test(text))) {
    return [{ kind: 'missing', text, message: 'Grammie couldn’t read this part. Type it in from the original.' }];
  }
  if (field === 'title') {
    if (/^(your recipe|failed to extract recipe)$/i.test(text)) {
      return [{ kind: 'missing', text, message: 'Give the recipe a name.' }];
    }
    const unclear = unclearFlag(text);
    return unclear ? [unclear] : [];
  }

  const flags: EditFlag[] = [];
  const unclear = unclearFlag(text);
  if (unclear) flags.push(unclear);
  flags.push(...fractionFlags(text));
  if (field === 'ingredient') flags.push(...unitFlags(text));
  const temp = temperatureFlag(text);
  if (temp) flags.push(temp);
  return flags;
}

/** True when any field of the recipe has a flag (for the summary line) */
export function countEditLikely(title: string, ingredients: string[], steps: string[]): number {
  return [
    findEditLikely(title, 'title').length > 0 ? 1 : 0,
    ...ingredients.map((l) => (findEditLikely(l, 'ingredient').length > 0 ? 1 : 0)),
    ...steps.map((l) => (findEditLikely(l, 'step').length > 0 ? 1 : 0)),
  ].reduce<number>((a, b) => a + b, 0);
}

/** Remove the "[?]" markers once a person has checked the line */
export function stripUnsureMarkers(line: string): string {
  return line.replace(/\s*\[\?\]/g, '').replace(/\s{2,}/g, ' ').trim();
}

// ---------------------------------------------------------------------------
// Import status (one vocabulary for the server, JobStatus and the review page)
// ---------------------------------------------------------------------------

export type ImportStatus = 'uploading' | 'reading' | 'needs_review' | 'saved' | 'failed';
export type ReviewStatus = 'needs_review' | 'reviewed' | 'dismissed';

export interface ImportStatusInput {
  enrichmentStatus?: string | null;
  enrichmentError?: string | null;
  title?: string | null;
  ingredients?: string[] | null;
  /** From recipe_imports; null when there's no record (old recipe or table missing) */
  reviewStatus?: ReviewStatus | null;
}

/** True once the AI has produced readable ingredients (extraction finished) */
export function hasExtractedContent(r: Pick<ImportStatusInput, 'ingredients' | 'title'>): boolean {
  const ingredients = r.ingredients ?? [];
  if (r.title === 'Failed to Extract Recipe') return false;
  if (ingredients.length === 0) return false;
  return !(ingredients.length === 1 && /^extracting/i.test(ingredients[0]));
}

/**
 * Where an import stands. `fallbackNeedsReview` decides recipes with no
 * review record (e.g. just imported in this session while the review table
 * isn't migrated yet).
 */
export function importStatusOf(r: ImportStatusInput, fallbackNeedsReview = false): ImportStatus {
  if (r.enrichmentStatus === 'extracting' || r.enrichmentStatus === 'enriching') return 'reading';
  if (r.enrichmentStatus === 'failed' && !hasExtractedContent(r)) return 'failed';
  if (r.reviewStatus === 'reviewed' || r.reviewStatus === 'dismissed') return 'saved';
  if (r.reviewStatus === 'needs_review') return 'needs_review';
  return fallbackNeedsReview ? 'needs_review' : 'saved';
}

/** Turns pipeline errors into a reason a person can act on */
export function friendlyImportError(raw: string | null | undefined): string {
  const msg = (raw ?? '').toLowerCase();
  if (!msg) return 'Something went wrong while reading this recipe. Try again.';
  if (/blurry|too small|unreadable|not legible|resolution/.test(msg)) {
    return 'The photo is too blurry or small to read. Retake it closer, in good light.';
  }
  if (/no recipe|missing ingredients|not appear to contain|could not extract|valid recipe/.test(msg)) {
    return 'Grammie couldn’t find a recipe here. Check that the ingredients are in view.';
  }
  if (/timed out|timeout/.test(msg)) return 'Reading took too long. Try again in a minute.';
  if (/rate limit|429|quota|overloaded|503/.test(msg)) return 'Grammie is busy right now. Try again in a minute.';
  if (/heic|convert/.test(msg)) return 'This photo format couldn’t be opened. Try a JPEG or PNG.';
  if (/not configured|unavailable/.test(msg)) return 'Reading recipes is unavailable right now. Try again later.';
  return 'Something went wrong while reading this recipe. Try again.';
}

// ---------------------------------------------------------------------------
// Keeping normalized ingredients/steps in step with edits
// ---------------------------------------------------------------------------

export interface ParsedIngredient {
  raw: string;
  quantity?: number;
  unit?: string;
  item: string;
  preparation?: string;
  isOptional: boolean;
  isToolOrConsumable: boolean;
}

const UNICODE_VALUES: Record<string, number> = {
  '½': 1 / 2, '⅓': 1 / 3, '⅔': 2 / 3, '¼': 1 / 4, '¾': 3 / 4,
  '⅛': 1 / 8, '⅜': 3 / 8, '⅝': 5 / 8, '⅞': 7 / 8,
};

const UNIT_WORDS: Record<string, string> = {
  cup: 'cup', cups: 'cup', c: 'cup', C: 'cup',
  tablespoon: 'tbsp', tablespoons: 'tbsp', tbsp: 'tbsp', tbs: 'tbsp', tbl: 'tbsp', T: 'tbsp',
  teaspoon: 'tsp', teaspoons: 'tsp', tsp: 'tsp', t: 'tsp',
  ounce: 'oz', ounces: 'oz', oz: 'oz',
  pound: 'lb', pounds: 'lb', lb: 'lb', lbs: 'lb',
  gram: 'g', grams: 'g', g: 'g', kg: 'kg', kilogram: 'kg', kilograms: 'kg',
  ml: 'ml', milliliter: 'ml', milliliters: 'ml', l: 'l', liter: 'l', liters: 'l', litre: 'l', litres: 'l',
  pint: 'pint', pints: 'pint', pt: 'pint', quart: 'quart', quarts: 'quart', qt: 'quart',
  gallon: 'gallon', gallons: 'gallon',
  can: 'can', cans: 'can', package: 'package', packages: 'package', pkg: 'package',
  stick: 'stick', sticks: 'stick', clove: 'clove', cloves: 'clove',
  pinch: 'pinch', dash: 'dash', slice: 'slice', slices: 'slice',
};

function parseQuantity(token: string): number | undefined {
  const t = token.trim();
  const mixed = t.match(/^(\d+)\s+(\d+)\s*\/\s*(\d+)$/);
  if (mixed) return Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);
  const frac = t.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (frac) return Number(frac[2]) === 0 ? undefined : Number(frac[1]) / Number(frac[2]);
  const uni = t.match(/^(\d*)([½⅓⅔¼¾⅛⅜⅝⅞])$/);
  if (uni) return (uni[1] ? Number(uni[1]) : 0) + UNICODE_VALUES[uni[2]];
  if (/^\d+(?:\.\d+)?$/.test(t)) return Number(t);
  return undefined;
}

/**
 * Best-effort parse of one ingredient line typed by a person. Lines it can't
 * read confidently (ranges, "salt to taste") keep the whole text as the item,
 * so they display exactly as typed and never scale wrongly.
 */
export function parseIngredientLine(line: string): ParsedIngredient {
  const raw = line.trim();
  const base: ParsedIngredient = { raw, item: raw, isOptional: /\(optional\)|\boptional\b/i.test(raw), isToolOrConsumable: false };
  const m = raw.match(/^((?:\d+\s+\d+\s*\/\s*\d+)|(?:\d+\s*\/\s*\d+)|(?:\d*[½⅓⅔¼¾⅛⅜⅝⅞])|(?:\d+(?:\.\d+)?))(?!\s*[-–]\s*\d)\s*(.*)$/);
  if (!m) return base;
  const quantity = parseQuantity(m[1]);
  if (quantity === undefined) return base;
  let rest = m[2].trim();
  let unit: string | undefined;
  const unitMatch = rest.match(/^([A-Za-z]+)\.?(?:\s+|$)(.*)$/);
  if (unitMatch) {
    const word = unitMatch[1];
    // Single letters only count when written as-is ("T" is tablespoon, "t" teaspoon)
    const canonical = word.length === 1 ? UNIT_WORDS[word] : UNIT_WORDS[word.toLowerCase()];
    if (canonical) {
      unit = canonical;
      rest = unitMatch[2].trim();
    }
  }
  if (!rest) return base;
  let item = rest.replace(/^of\s+/i, '');
  let preparation: string | undefined;
  const comma = item.indexOf(',');
  if (comma > 0) {
    preparation = item.slice(comma + 1).trim() || undefined;
    item = item.slice(0, comma).trim();
  }
  return { ...base, quantity, unit, item, preparation };
}

interface WithRaw { raw?: string }
interface WithText { text?: string; stepNumber?: number }

/**
 * Line up the normalized entries with the person's edited lines. Unchanged
 * lines keep their AI-normalized entry (emoji, grocery data, nutrition);
 * changed or new lines are re-parsed from what the person typed.
 */
export function reconcileNormalizedIngredients<T extends WithRaw>(
  oldLines: string[],
  newLines: string[],
  normalized: T[] | null | undefined,
): Array<T | ParsedIngredient> {
  const norm = Array.isArray(normalized) ? normalized : [];
  const aligned = norm.length === oldLines.length;
  const used = new Set<number>();
  return newLines.map((line, i) => {
    const pick = (idx: number) => { used.add(idx); return norm[idx]; };
    if (aligned && oldLines[i] === line && norm[i] && !used.has(i)) return pick(i);
    if (aligned) {
      const oldIdx = oldLines.findIndex((l, j) => l === line && !used.has(j));
      if (oldIdx >= 0 && norm[oldIdx]) return pick(oldIdx);
    }
    const byRaw = norm.findIndex((n, j) => !used.has(j) && (n.raw ?? '').trim() === line.trim());
    if (byRaw >= 0) return pick(byRaw);
    return parseIngredientLine(line);
  });
}

export function reconcileNormalizedInstructions<T extends WithText>(
  oldLines: string[],
  newLines: string[],
  normalized: T[] | null | undefined,
): Array<T | { stepNumber: number; text: string; ingredients: string[]; tools: string[] }> {
  const norm = Array.isArray(normalized) ? normalized : [];
  const aligned = norm.length === oldLines.length;
  const used = new Set<number>();
  return newLines.map((line, i) => {
    let idx = -1;
    if (aligned && oldLines[i] === line && !used.has(i)) idx = i;
    if (idx < 0 && aligned) idx = oldLines.findIndex((l, j) => l === line && !used.has(j));
    if (idx < 0) idx = norm.findIndex((n, j) => !used.has(j) && (n.text ?? '').trim() === line.trim());
    if (idx >= 0 && norm[idx]) {
      used.add(idx);
      return { ...norm[idx], stepNumber: i + 1 };
    }
    return { stepNumber: i + 1, text: line, ingredients: [], tools: [] };
  });
}
