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

export function estimateBookPages(recipeCount: number, chapterCount: number, trimSize?: string): number {
  if (recipeCount === 0) return 0;
  // Title page, dedication, contents, plus a title page per chapter
  return Math.ceil(recipeCount * pagesPerRecipe(trimSize) + 4 + chapterCount);
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
