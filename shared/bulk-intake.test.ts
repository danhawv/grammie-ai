import { describe, expect, it } from "vitest";
import {
  buildPlan,
  estimateFirstLook,
  estimateImport,
  formatDollars,
  linesOverlap,
  normalizeTitle,
  pairBySequence,
  pairingCandidates,
  sanitizeCatalog,
  sanitizePairs,
  titlesMatch,
  type PhotoCatalog,
  type PlanPhoto,
} from "./bulk-intake";

const card = (over: Partial<PhotoCatalog> = {}): PhotoCatalog => ({
  rotate: 0,
  kind: "recipe",
  title: "Pound Cake",
  side: "front",
  continues: false,
  hasDirections: true,
  recipeCount: 1,
  firstLine: "2 c. flour",
  lastLine: "bake 1 hr",
  paper: "white lined index card",
  cutOff: false,
  hardToRead: false,
  ...over,
});

let n = 0;
const photo = (catalog: PhotoCatalog | null, over: Partial<PlanPhoto> = {}): PlanPhoto => {
  n++;
  return { id: `p${n}`, seq: n, sourceHash: `h${n}`, catalog, pairedTo: null, pairLocked: false, includeOverride: null, ...over };
};

describe("sanitizeCatalog", () => {
  it("maps the upright panel to a rotation and tidies the fields", () => {
    const c = sanitizeCatalog({ panel: 4, kind: "recipe", title: "  Texas\nCaviar ", continues: true, recipe_count: 1, first_line: "1 can black-eyed peas" })!;
    expect(c.rotate).toBe(270);
    expect(c.title).toBe("Texas Caviar");
    expect(c.continues).toBe(true);
    expect(c.side).toBe("front");
  });

  it("treats a recipe with no title as a back, and rejects junk", () => {
    expect(sanitizeCatalog({ panel: 1, kind: "recipe", title: "" })!.side).toBe("back");
    expect(sanitizeCatalog({ panel: 9, kind: "nonsense" })).toMatchObject({ rotate: 0, kind: "other", recipeCount: 0 });
    expect(sanitizeCatalog(null)).toBeNull();
    expect(sanitizeCatalog("text")).toBeNull();
  });
});

describe("titles", () => {
  it("matches the same name written differently", () => {
    expect(normalizeTitle("Avocado/Goat Cheese Dip (12)")).toBe("avocado goat cheese dip");
    expect(titlesMatch("Avocado/Goat Cheese Dip", "Avocado-Goat Cheese Dip")).toBe(true);
    expect(titlesMatch("Grilled Lamb Chops w/ Mint Pesto", "Grilled Lamb Chops with Mint Pesto")).toBe(true);
    expect(titlesMatch("Chimichuri", "Chimichurri")).toBe(true);
    expect(titlesMatch("Chimichurra Sauce (Argentinian)", "Chimichurri Sauce (Argentinian)")).toBe(true);
  });

  it("doesn't match different recipes", () => {
    expect(titlesMatch("Peanut Sauce", "Peanut Sauce for Pasta")).toBe(false);
    expect(titlesMatch("Cheese Straws", "Cheese Ball")).toBe(false);
    expect(titlesMatch("", "")).toBe(false);
  });

  it("compares first lines loosely", () => {
    expect(linesOverlap("3 ripe avocados", "3 ripe avocados, mashed")).toBe(true);
    expect(linesOverlap("1 pkg. frozen spinach", "2 garlic cloves")).toBe(false);
    expect(linesOverlap("", "anything")).toBe(true);
  });
});

describe("buildPlan", () => {
  it("joins a back to its front and imports them as one recipe", () => {
    const front = photo(card({ title: "Sour Cream Muffins", continues: true }));
    const back = photo(card({ title: "", side: "back" }), { pairedTo: front.id });
    const plan = buildPlan([front, back]);
    expect(plan.groups).toHaveLength(1);
    expect(plan.groups[0]).toMatchObject({ photoIds: [front.id, back.id], status: "ready", include: true });
    expect(plan.summary).toMatchObject({ recipes: 1, toImport: 1, incomplete: 0 });
  });

  it("holds a front that says over with no back, and a back with no front", () => {
    const plan = buildPlan([photo(card({ title: "Texas Caviar", continues: true })), photo(card({ title: "", side: "back" }))]);
    expect(plan.groups.map((g) => g.status)).toEqual(["incomplete", "incomplete"]);
    expect(plan.groups.every((g) => !g.include)).toBe(true);
    expect(plan.groups[0].reason).toMatch(/back/);
  });

  it("skips recipes already in the cookbook, unless the first lines differ", () => {
    const plan = buildPlan(
      [photo(card({ title: "Spinach Dip", firstLine: "1 pkg. frozen spinach" })), photo(card({ title: "Nancy's Stilton Soup", firstLine: "1/4 c. butter" }))],
      [{ id: "r1", title: "Spinach Dip", firstLine: "1 pkg frozen chopped spinach" }, { id: "r2", title: "Nancy's Stilton Soup", firstLine: "2 leeks" }],
    );
    expect(plan.groups[0]).toMatchObject({ status: "existing", existingRecipeId: "r1", include: false });
    expect(plan.groups[1].status).toBe("ready");
  });

  it("keeps one copy of a recipe photographed twice", () => {
    const a = photo(card({ title: "Cheese Straws", firstLine: "2 c. flour", cutOff: true }));
    const b = photo(card({ title: "Cheese Straws", firstLine: "2 c. sifted flour" }));
    const plan = buildPlan([a, b]);
    expect(plan.groups.find((g) => g.key === a.id)).toMatchObject({ status: "duplicate", duplicateOf: b.id });
    expect(plan.groups.find((g) => g.key === b.id)!.status).toBe("ready");
    expect(plan.summary.duplicates).toBe(1);
  });

  it("sets aside dish photos and blanks, and imports unchecked photos with a note", () => {
    const plan = buildPlan([photo(card({ kind: "dish_photo", title: "" })), photo(card({ kind: "blank", title: "" })), photo(null)]);
    expect(plan.groups.map((g) => g.status)).toEqual(["not_recipe", "not_recipe", "ready"]);
    expect(plan.groups[2].warnings[0]).toMatch(/couldn't check/);
    expect(plan.summary).toMatchObject({ notRecipes: 2, unchecked: 1, toImport: 1 });
  });

  it("lets the person's choice win", () => {
    const held = photo(card({ continues: true }), { includeOverride: true });
    const left = photo(card({ title: "Gazpacho" }), { includeOverride: false });
    const plan = buildPlan([held, left]);
    expect(plan.groups.map((g) => g.include)).toEqual([true, false]);
    expect(plan.summary.toImport).toBe(1);
  });

  it("doesn't count recipes already imported", () => {
    const plan = buildPlan([photo(card(), { recipeId: "r9" }), photo(card({ title: "Gazpacho" }))]);
    expect(plan.summary.toImport).toBe(1);
  });
});

describe("pairing", () => {
  const cand = (id: string, seq: number, c: Partial<PhotoCatalog>) => ({ id, seq, catalog: card(c) });

  it("pairs by order only when the order is real", () => {
    const photos = [cand("a", 1, { continues: true }), cand("b", 2, { title: "", side: "back" }), cand("c", 3, { title: "Gazpacho" })];
    expect(Object.fromEntries(pairBySequence(photos, true))).toEqual({ b: "a" });
    expect(pairBySequence(photos, false).size).toBe(0);
  });

  it("offers continuing fronts, untitled backs and named cards to the matcher", () => {
    const { fronts, backs, others } = pairingCandidates([
      cand("a", 1, { title: "Sour Cream Muffins", continues: true }),
      cand("b", 2, { title: "", side: "back" }),
      cand("c", 3, { title: "Buttermilk" }),
      cand("d", 4, { kind: "dish_photo", title: "" }),
    ]);
    expect(fronts.map((p) => p.id)).toEqual(["a"]);
    expect(backs.map((p) => p.id)).toEqual(["b"]);
    expect(others.map((p) => p.id)).toEqual(["c"]);
  });

  it("checks the matcher's answer", () => {
    const pairs = sanitizePairs(
      { pairs: [{ front: "a", back: "b" }, { front: "a", back: "c" }, { front: "x", back: "b" }, { front: "d", back: "d" }] },
      new Set(["a", "d"]),
      new Set(["b", "c", "d"]),
    );
    expect(Object.fromEntries(pairs)).toEqual({ b: "a" });
  });
});

describe("estimates", () => {
  it("says money in plain words", () => {
    expect(formatDollars(0.004)).toBe("less than 1¢");
    expect(formatDollars(0.14)).toBe("about 14¢");
    expect(formatDollars(1.5)).toBe("about $1.50");
    expect(formatDollars(16.4)).toBe("about $16");
  });

  it("estimates the first look and the import", () => {
    expect(estimateFirstLook(231).dollars).toBeLessThan(0.2);
    expect(estimateImport(182).costText).toBe("about $16");
    expect(estimateImport(182, "batch").dollars).toBeLessThan(estimateImport(182).dollars * 0.7);
    expect(estimateImport(182).timeText).toBe("about 12 minutes");
    expect(estimateImport(182, "batch").timeText).toMatch(/^about 12 minutes \(photos/);
  });
});
