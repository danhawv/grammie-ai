import { describe, expect, it } from "vitest";
import { checkReadiness, estimateBookPages, pagesPerRecipe, type RecipePrintFacts } from "./print-readiness";

const ok = (id: string, extra: Partial<RecipePrintFacts> = {}): RecipePrintFacts => ({
  id, title: `Recipe ${id}`, found: true, hasPhoto: true, photoKB: 400, hasIngredients: true, hasInstructions: true, ...extra,
});
const limits = { min: 32, max: 800 };

describe("pagesPerRecipe / estimateBookPages", () => {
  it("uses more pages on small books", () => {
    expect(pagesPerRecipe("0600X0900")).toBe(2.5);
    expect(pagesPerRecipe("0850X1100")).toBe(2);
    expect(estimateBookPages(10, 2, "0600X0900")).toBe(31);
    expect(estimateBookPages(0, 1)).toBe(0);
  });
});

describe("checkReadiness", () => {
  it("is clean for a complete book", () => {
    const r = checkReadiness({
      recipes: Array.from({ length: 20 }, (_, i) => ok(String(i))),
      sections: [{ id: "s", title: "All", recipeIds: Array.from({ length: 20 }, (_, i) => String(i)) }],
      title: "Family", authorName: "Jean", pageLimits: limits,
    });
    expect(r.items).toEqual([]);
    expect(r.totalRecipes).toBe(20);
  });

  it("groups problems by level", () => {
    const r = checkReadiness({
      recipes: [ok("a", { hasPhoto: false }), ok("b", { photoKB: 20 }), ok("c", { status: "processing" }), ok("d", { hasIngredients: false }), { ...ok("e"), found: false }],
      sections: [{ id: "s1", title: "Mains", recipeIds: ["a", "b", "c", "d", "e"] }, { id: "s2", title: "Empty", recipeIds: [] }],
      pageLimits: limits,
    });
    const codes = Object.fromEntries(r.items.map((i) => [i.code, i]));
    expect(codes.photo_missing.ids).toEqual(["a"]);
    expect(codes.photo_low_res.level).toBe("look");
    expect(codes.still_processing.level).toBe("attention");
    expect(codes.no_ingredients.names).toEqual(["Recipe d"]);
    expect(codes.recipes_missing.count).toBe(1);
    expect(codes.empty_chapter.ids).toEqual(["s2"]);
    expect(codes.book_title_missing).toBeDefined();
    // 4 recipes -> 15 pages, padded to 32
    expect(codes.pages_padded.count).toBe(32 - r.estimatedPages);
  });

  it("flags books over the binding's page limit", () => {
    const ids = Array.from({ length: 40 }, (_, i) => String(i));
    const r = checkReadiness({ recipes: ids.map((i) => ok(i)), sections: [{ id: "s", title: "All", recipeIds: ids }], title: "x", authorName: "y", pageLimits: { min: 4, max: 80 } });
    expect(r.items.map((i) => i.code)).toContain("too_many_pages");
  });

  it("says when there are no recipes", () => {
    const r = checkReadiness({ recipes: [], sections: [], title: "x", authorName: "y", pageLimits: limits });
    expect(r.items.map((i) => i.code)).toEqual(["no_recipes"]);
  });
});

describe("estimateBookPages with book details", () => {
  // Mom's cookbook: Heirloom, 8 chapters, 96 recipes, 45 album photos
  const mom = { chapterSizes: [21, 14, 12, 11, 16, 13, 4, 5], extrasOn: false, albumPhotoCount: 45, minPages: 32 };

  it("matches the preview's count for a one-page-per-recipe book", () => {
    expect(estimateBookPages(96, 8, "0600X0900", mom)).toBe(124);
  });

  it("adds an extras page per recipe when extras print", () => {
    expect(estimateBookPages(96, 8, "0600X0900", { ...mom, extrasOn: true })).toBe(220);
  });

  it("pads short books to the binding minimum and keeps the total even", () => {
    const n = estimateBookPages(3, 1, "0600X0900", { chapterSizes: [3], extrasOn: false, minPages: 32 });
    expect(n).toBe(32);
  });
});
