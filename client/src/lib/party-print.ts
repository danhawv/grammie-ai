// Layout rules for the party printables (menu, place cards, food labels,
// take-home recipe cards): what goes on each sheet, how much text fits, and
// the diet marks. Kept free of React so the rules can be tested.

import {
  ALLERGEN_SHORT,
  dishAllergens,
  dishFitsDiet,
  type DishRecipeFacts,
  type PartyDiet,
  type PartyGuest,
  type PartyDish,
} from "@shared/party";

/** Cards per Letter sheet */
export const PER_SHEET = {
  "place-cards": 6, // 2 columns x 3 rows
  "food-labels": 4, // 2 x 2
  "recipe-cards": 2, // two 4x6 cards
} as const;

/** Splits items into sheets of `size` */
export function paginate<T>(items: T[], size: number): T[][] {
  const n = Math.max(1, Math.floor(size));
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += n) out.push(items.slice(i, i + n));
  return out;
}

/** The invite token is the last part of the host's invite link */
export function inviteTokenFrom(inviteUrl: string | null | undefined): string | null {
  if (!inviteUrl) return null;
  const path = inviteUrl.split(/[?#]/)[0].replace(/\/+$/, "");
  const last = path.slice(path.lastIndexOf("/") + 1);
  return last ? decodeURIComponent(last) : null;
}

// ---------------------------------------------------------------- place cards

export interface PlaceCard {
  key: string;
  /** Empty for a blank card to write on */
  name: string;
  /** Small line under the name: what they're bringing */
  dish: string | null;
  blank: boolean;
}

/**
 * One card per person coming (yes and maybe), host first. A guest bringing
 * others (party size 3) adds "Guest of Sam" cards for the extra people. Then
 * any blank cards the host asked for.
 */
export function placeCards(
  guests: Pick<PartyGuest, "id" | "name" | "rsvp" | "partySize" | "isHost">[],
  dishes: Pick<PartyDish, "guestId" | "title">[],
  opts: { blanks?: number; showDish?: boolean } = {},
): PlaceCard[] {
  const coming = guests
    .filter((g) => g.rsvp === "yes" || g.rsvp === "maybe")
    .sort((a, b) => Number(b.isHost) - Number(a.isHost));
  const out: PlaceCard[] = [];
  for (const g of coming) {
    const theirs = dishes.filter((d) => d.guestId === g.id).map((d) => d.title.trim()).filter(Boolean);
    out.push({
      key: g.id,
      name: g.name.trim(),
      dish: opts.showDish && theirs.length ? theirs.join(" & ") : null,
      blank: false,
    });
    const extra = Math.min(20, Math.max(0, Math.floor(g.partySize || 1) - 1));
    for (let i = 0; i < extra; i++) {
      out.push({ key: `${g.id}-plus-${i}`, name: `Guest of ${firstName(g.name)}`, dish: null, blank: false });
    }
  }
  const blanks = Math.min(60, Math.max(0, Math.floor(opts.blanks ?? 0)));
  for (let i = 0; i < blanks; i++) out.push({ key: `blank-${i}`, name: "", dish: null, blank: true });
  return out;
}

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || name.trim();
}

// ---------------------------------------------------------------- diet marks

type Facts = Pick<DishRecipeFacts, "diets" | "allergens" | "ingredients"> | null;

export type DietMark = "V" | "VG" | "GF" | "DF";

/** The menu footnote key, in print order */
export const DIET_MARKS: { mark: DietMark; label: string }[] = [
  { mark: "V", label: "Vegetarian" },
  { mark: "VG", label: "Vegan" },
  { mark: "GF", label: "Gluten-free" },
  { mark: "DF", label: "Dairy-free" },
];

/**
 * Small marks for a dish. Vegan shows VG instead of V (it's both). A dish
 * with no recipe gets none: we can't tell what's in it.
 */
export function dietMarks(recipe: Facts): DietMark[] {
  if (!recipe) return [];
  const fits = (d: PartyDiet) => dishFitsDiet(recipe, d) === true;
  // dishFitsDiet's vegan word list misses cheeses like cheddar; the allergen
  // check knows them, so a menu never calls a dairy or egg dish vegan
  const animal = dishAllergens(recipe).some((a) => a === "Dairy" || a === "Eggs");
  const out: DietMark[] = [];
  if (fits("vegan") && !animal) out.push("VG");
  else if (fits("vegetarian")) out.push("V");
  if (fits("gluten-free")) out.push("GF");
  if (fits("dairy-free")) out.push("DF");
  return out;
}

/** Only the marks a menu actually uses, for its footnote */
export function marksKey(used: DietMark[][]): { mark: DietMark; label: string }[] {
  const seen = new Set(used.flat());
  return DIET_MARKS.filter((m) => seen.has(m.mark));
}

/** "Contains: tree nuts, dairy" for a food label, or null when nothing found */
export function containsLine(recipe: Pick<DishRecipeFacts, "allergens" | "ingredients"> | null): string | null {
  const found = dishAllergens(recipe);
  return found.length ? `Contains: ${found.map((a) => ALLERGEN_SHORT[a]).join(", ")}` : null;
}

// ---------------------------------------------------------------- fitting text

/**
 * Font size (pt) for a line that should stay on one or two lines: full size
 * up to `chars` characters, then smaller in step with the length, never
 * below `min`. The print CSS also clamps lines, so nothing spills.
 */
export function fitPt(text: string, max: number, min: number, chars: number): number {
  const len = text.trim().length;
  if (len <= chars) return max;
  return Math.max(min, Math.round(((max * chars) / len) * 10) / 10);
}

/**
 * How tightly to set the menu so it stays on one page: 1 for a normal menu,
 * smaller for a long potluck spread (never below 0.6).
 */
export function menuDensity(sections: number, dishes: number): number {
  const units = sections * 1.8 + dishes;
  if (units <= 16) return 1;
  return Math.max(0.6, Math.round((16 / units) ** 0.8 * 100) / 100);
}

/**
 * Keeps as many lines as fit in `maxLines` (each line about `charsPerLine`
 * characters). If the next item only partly fits and there are at least two
 * lines left, it's cut at a word with "…". Returns how many were left out.
 */
export function fitLines(items: string[], maxLines: number, charsPerLine: number): { shown: string[]; hidden: number; cut: boolean } {
  const shown: string[] = [];
  let used = 0;
  let cut = false;
  for (let i = 0; i < items.length; i++) {
    const text = items[i];
    const lines = Math.max(1, Math.ceil(text.length / charsPerLine));
    if (used + lines <= maxLines) {
      shown.push(text);
      used += lines;
      continue;
    }
    const left = maxLines - used;
    if (left >= 2) {
      shown.push(cutAtWord(text, left * charsPerLine - 1));
      cut = true;
      return { shown, hidden: items.length - i - 1, cut };
    }
    return { shown, hidden: items.length - i, cut };
  }
  return { shown, hidden: 0, cut };
}

function cutAtWord(text: string, max: number): string {
  if (text.length <= max) return text;
  const slice = text.slice(0, max);
  const space = slice.lastIndexOf(" ");
  return `${(space > max * 0.5 ? slice.slice(0, space) : slice).replace(/[\s,;:.-]+$/, "")}…`;
}

export type StepsLength = "short" | "long" | "none";

/** Recipe card steps column: about 58 characters a line at 7.5pt, 16 lines tall */
const STEP_LINES: Record<StepsLength, number> = { short: 8, long: 16, none: 0 };
const STEP_CHARS = 58;
/** Ingredient column: about 40 characters a line */
const INGREDIENT_LINES = 16;
const INGREDIENT_CHARS = 40;

/** Steps for a 4x6 card; `truncated` means "scan the code for the rest" */
export function cardSteps(steps: string[], length: StepsLength): { steps: string[]; truncated: boolean } {
  const clean = steps.map(cleanStep).filter(Boolean);
  if (length === "none") return { steps: [], truncated: clean.length > 0 };
  const fit = fitLines(clean, STEP_LINES[length], STEP_CHARS);
  return { steps: fit.shown, truncated: fit.cut || fit.hidden > 0 };
}

/** Ingredients for a 4x6 card, with how many more are on the full recipe */
export function cardIngredients(ingredients: string[]): { ingredients: string[]; more: number } {
  const clean = ingredients.map((s) => s.trim()).filter(Boolean);
  // Leave a line for "and 3 more" when it doesn't all fit
  const all = fitLines(clean, INGREDIENT_LINES, INGREDIENT_CHARS);
  if (all.hidden === 0 && !all.cut) return { ingredients: all.shown, more: 0 };
  const fit = fitLines(clean, INGREDIENT_LINES - 1, INGREDIENT_CHARS);
  // An ingredient cut in half reads wrong; drop it and count it as more
  const shown = fit.cut ? fit.shown.slice(0, -1) : fit.shown;
  return { ingredients: shown, more: clean.length - shown.length };
}

/** Drops "1." / "Step 2:" from the front (the card numbers its steps) */
export function cleanStep(step: string): string {
  return step.trim().replace(/^(step\s*)?\d+\s*[.):-]\s*/i, "").trim();
}

// ---------------------------------------------------------------- full recipe

export interface CardRecipe {
  title: string | null;
  servings: number | null;
  ingredients: string[];
  steps: string[];
}

/**
 * The full recipe from GET /api/party/:token/dishes/:dishId/recipe, in the
 * shape the recipe page uses (ingredients and instructions as text lists).
 * Accepts it bare or wrapped in { recipe }, and object lines with text.
 */
export function readCardRecipe(json: unknown): CardRecipe | null {
  if (!json || typeof json !== "object") return null;
  const r = ((json as any).recipe && typeof (json as any).recipe === "object" ? (json as any).recipe : json) as Record<string, unknown>;
  const lines = (v: unknown): string[] =>
    Array.isArray(v)
      ? v.map((x) => (typeof x === "string" ? x : x && typeof x === "object" ? String((x as any).text ?? (x as any).original ?? (x as any).instruction ?? "") : "")).map((s) => s.trim()).filter(Boolean)
      : [];
  return {
    title: typeof r.title === "string" ? r.title : null,
    servings: typeof r.servings === "number" ? r.servings : null,
    ingredients: lines(r.ingredients),
    steps: lines(r.instructions ?? r.steps),
  };
}

/** "Saturday, October 18 · 7:00 PM" (or just the day when the time is midnight) */
export function partyDateLine(startsAt: string | null, locale?: string): string | null {
  if (!startsAt) return null;
  const d = new Date(startsAt);
  if (Number.isNaN(d.getTime())) return null;
  const day = d.toLocaleDateString(locale, { weekday: "long", month: "long", day: "numeric" });
  if (d.getHours() === 0 && d.getMinutes() === 0) return day;
  return `${day} · ${d.toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" })}`;
}
