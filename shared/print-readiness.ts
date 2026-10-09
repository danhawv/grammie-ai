import { paginateToc, tocMetrics } from "./toc-layout";
// "Ready to print?" — the plain-language check before ordering a book
// (docs/DESIGN_PRINCIPLES.md §6 and §10). The server gathers facts about each
// recipe; this turns them into a short list grouped as "Needs attention"
// (would print wrong) and "Worth a look" (prints fine, but you may want to
// change it). The client adds the fixes.

export type ReadinessLevel = "attention" | "look";

export interface RecipePrintFacts {
  id: string;
  title: string;
  /** null when the recipe couldn't be loaded (deleted or no longer shared) */
  found: boolean;
  hasPhoto: boolean;
  /** Rough size of the dish photo; small files print blurry */
  photoKB?: number;
  hasIngredients: boolean;
  hasInstructions: boolean;
  status?: string | null;
}

export interface ReadinessItem {
  code:
    | "no_recipes"
    | "recipes_missing"
    | "still_processing"
    | "processing_failed"
    | "no_ingredients"
    | "no_instructions"
    | "empty_chapter"
    | "too_many_pages"
    | "photo_low_res"
    | "photo_missing"
    | "book_title_missing"
    | "author_missing"
    | "near_page_limit"
    | "pages_padded";
  level: ReadinessLevel;
  /** Recipes (or chapters, for empty_chapter) this is about */
  ids?: string[];
  /** Names to list under the item */
  names?: string[];
  count?: number;
}

export interface ReadinessResult {
  items: ReadinessItem[];
  estimatedPages: number;
  minPages: number;
  maxPages: number;
  totalRecipes: number;
}

/** Photos under this size are probably too small to print sharply */
export const LOW_RES_PHOTO_KB = 100;

/** Rough pages per recipe for a book size: smaller pages need more */
export function pagesPerRecipe(trimSize: string | undefined): number {
  const width = Number(String(trimSize ?? "0600X0900").slice(0, 4)) / 100;
  return width && width < 7 ? 2.5 : 2;
}

/** What the book's page count depends on, when the editor knows it */
export interface BookPageDetails {
  /** Recipes per chapter, in order (chapters with no recipes left out) */
  chapterSizes: number[];
  /**
   * Whether each recipe gets an extras page after it: on card-style
   * templates (Recipe Card, Heirloom) only for variations; on the others
   * for nutrition, tips or variations
   */
  extrasOn: boolean;
  /** Recipes set to a two-page spread (photo page + recipe page) */
  spreadCount?: number;
  /** Photos in the Family Album (4 per page, after an album title page) */
  albumPhotoCount?: number;
  /** The binding's minimum; short books are padded with Notes pages */
  minPages?: number;
}

/** Page size in inches from a Lulu trim code like "0600X0900" */
function trimInches(trimSize?: string): { w: number; h: number } {
  const m = String(trimSize ?? "0600X0900").match(/^(\d{4})X(\d{4})$/);
  return m ? { w: Number(m[1]) / 100, h: Number(m[2]) / 100 } : { w: 6, h: 9 };
}

/**
 * Pages in the printed book. With details it counts the pages the PDF
 * generator lays out (title, dedication, contents, a page per chapter, the
 * recipes, album, back page, padded to the minimum and an even total).
 * Without details it's the old rough guess of 2-2.5 pages per recipe.
 */
export function estimateBookPages(recipeCount: number, chapterCount: number, trimSize?: string, details?: BookPageDetails): number {
  if (recipeCount === 0) return 0;
  if (!details) {
    // Title page, dedication, contents, plus a title page per chapter
    return Math.ceil(recipeCount * pagesPerRecipe(trimSize) + 4 + chapterCount);
  }
  const { w, h } = trimInches(trimSize);
  // Same contents layout as the preview and PDF (0.5in margins, 24px top gap)
  const entries: { isSection: boolean }[] = [];
  details.chapterSizes.forEach((n) => {
    entries.push({ isSection: true });
    for (let i = 0; i < n; i++) entries.push({ isSection: false });
  });
  const album = details.albumPhotoCount ?? 0;
  if (album) entries.push({ isSection: false });
  const tocPages = Math.max(1, paginateToc(entries, tocMetrics((h - 1) * 96 - 24, w * 96)).length);

  const perRecipe = details.extrasOn ? 2 : 1;
  let pages = 1 /* title */ + 1 /* dedication or copyright */ + tocPages
    + details.chapterSizes.length
    + recipeCount * perRecipe + (details.spreadCount ?? 0)
    + (album ? 1 + Math.ceil(album / 4) : 0);
  // Notes pages up to the minimum, then the back page, and an even total
  const target = Math.max(details.minPages ?? 0, pages + 1);
  pages = Math.max(pages + 1, target);
  return pages % 2 === 0 ? pages : pages + 1;
}

export function checkReadiness(input: {
  recipes: RecipePrintFacts[];
  sections: { id: string; title: string; recipeIds: string[] }[];
  title?: string;
  authorName?: string;
  trimSize?: string;
  pageLimits: { min: number; max: number };
}): ReadinessResult {
  const items: ReadinessItem[] = [];
  const { recipes, sections, pageLimits } = input;
  const found = recipes.filter((r) => r.found);
  const by = (pred: (r: RecipePrintFacts) => boolean) => found.filter(pred);
  const add = (code: ReadinessItem["code"], level: ReadinessLevel, list?: RecipePrintFacts[]) => {
    if (list && list.length === 0) return;
    items.push({
      code,
      level,
      ...(list ? { ids: list.map((r) => r.id), names: list.map((r) => r.title || "Untitled recipe"), count: list.length } : {}),
    });
  };

  if (recipes.length === 0) {
    items.push({ code: "no_recipes", level: "attention" });
  }
  const missing = recipes.filter((r) => !r.found);
  if (missing.length) items.push({ code: "recipes_missing", level: "attention", ids: missing.map((r) => r.id), count: missing.length });

  add("still_processing", "attention", by((r) => r.status === "pending" || r.status === "processing"));
  add("processing_failed", "attention", by((r) => r.status === "failed"));
  add("no_ingredients", "attention", by((r) => !r.hasIngredients));
  add("no_instructions", "attention", by((r) => !r.hasInstructions));

  const empty = sections.filter((s) => s.recipeIds.length === 0);
  if (empty.length) {
    items.push({ code: "empty_chapter", level: "attention", ids: empty.map((s) => s.id), names: empty.map((s) => s.title), count: empty.length });
  }

  const estimatedPages = estimateBookPages(found.length, sections.filter((s) => s.recipeIds.length > 0).length, input.trimSize);
  if (estimatedPages > pageLimits.max) {
    items.push({ code: "too_many_pages", level: "attention", count: estimatedPages });
  }

  add("photo_low_res", "look", by((r) => r.hasPhoto && r.photoKB !== undefined && r.photoKB < LOW_RES_PHOTO_KB));
  add("photo_missing", "look", by((r) => !r.hasPhoto));
  if (!input.title?.trim()) items.push({ code: "book_title_missing", level: "look" });
  if (!input.authorName?.trim()) items.push({ code: "author_missing", level: "look" });

  if (estimatedPages <= pageLimits.max && estimatedPages > pageLimits.max * 0.9) {
    items.push({ code: "near_page_limit", level: "look", count: estimatedPages });
  }
  if (estimatedPages > 0 && estimatedPages < pageLimits.min) {
    items.push({ code: "pages_padded", level: "look", count: pageLimits.min - estimatedPages });
  }

  return { items, estimatedPages, minPages: pageLimits.min, maxPages: pageLimits.max, totalRecipes: found.length };
}
