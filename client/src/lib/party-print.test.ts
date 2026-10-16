import { describe, expect, it } from "vitest";
import {
  cardIngredients,
  cardSteps,
  cleanStep,
  containsLine,
  dietMarks,
  fitLines,
  fitPt,
  inviteTokenFrom,
  marksKey,
  menuDensity,
  paginate,
  partyDateLine,
  placeCards,
  readCardRecipe,
} from "./party-print";

const facts = (ingredients: string[], extra: { diets?: string[]; allergens?: string[] } = {}) => ({
  ingredients,
  diets: extra.diets ?? [],
  allergens: extra.allergens ?? [],
});

describe("paginate", () => {
  it("splits into full sheets and a last partial one", () => {
    expect(paginate([1, 2, 3, 4, 5, 6, 7], 6)).toEqual([[1, 2, 3, 4, 5, 6], [7]]);
    expect(paginate([], 4)).toEqual([]);
    expect(paginate([1, 2], 0)).toEqual([[1], [2]]);
  });
});

describe("inviteTokenFrom", () => {
  it("takes the last part of the link", () => {
    expect(inviteTokenFrom("https://grammie.ai/p/abcDEF_123-xyz")).toBe("abcDEF_123-xyz");
    expect(inviteTokenFrom("https://grammie.ai/p/abc/?utm=1")).toBe("abc");
    expect(inviteTokenFrom(null)).toBeNull();
  });
});

describe("placeCards", () => {
  const guests = [
    { id: "g1", name: "Sam Lee", rsvp: "yes" as const, partySize: 3, isHost: false },
    { id: "g2", name: "Ann", rsvp: "no" as const, partySize: 1, isHost: false },
    { id: "g3", name: "Pat", rsvp: "maybe" as const, partySize: 1, isHost: false },
    { id: "h", name: "Grammie", rsvp: "yes" as const, partySize: 1, isHost: true },
  ];
  const dishes = [{ guestId: "g1", title: "Lemon tart" }, { guestId: "g1", title: "Wine" }];

  it("puts the host first, skips no's and adds guests-of and blanks", () => {
    const cards = placeCards(guests, dishes, { blanks: 2 });
    expect(cards.map((c) => c.name)).toEqual(["Grammie", "Sam Lee", "Guest of Sam", "Guest of Sam", "Pat", "", ""]);
    expect(cards.filter((c) => c.blank)).toHaveLength(2);
    expect(new Set(cards.map((c) => c.key)).size).toBe(cards.length);
  });

  it("shows the dish only when asked", () => {
    expect(placeCards(guests, dishes)[1].dish).toBeNull();
    expect(placeCards(guests, dishes, { showDish: true })[1].dish).toBe("Lemon tart & Wine");
    expect(placeCards(guests, dishes, { showDish: true })[2].dish).toBeNull();
  });
});

describe("diet marks", () => {
  it("marks a vegan dish VG (not also V) plus GF/DF", () => {
    expect(dietMarks(facts(["2 cups chickpeas", "1 lemon", "olive oil"]))).toEqual(["VG", "GF", "DF"]);
  });
  it("marks a cheese dish V only, and none without a recipe", () => {
    expect(dietMarks(facts(["1 cup flour", "2 cups cheddar"]))).toEqual(["V"]);
    expect(dietMarks(facts(["1 lb chicken", "salt"]))).toEqual(["GF", "DF"]);
    expect(dietMarks(null)).toEqual([]);
  });
  it("keys only the marks used", () => {
    expect(marksKey([["V"], ["GF", "V"], []]).map((m) => m.mark)).toEqual(["V", "GF"]);
  });
  it("lists what a dish contains", () => {
    expect(containsLine(facts(["1/2 cup walnuts", "2 tbsp butter"]))).toBe("Contains: tree nuts, dairy");
    expect(containsLine(facts(["water"]))).toBeNull();
    expect(containsLine(null)).toBeNull();
  });
});

describe("fitting text", () => {
  it("shrinks long titles but not below the floor", () => {
    expect(fitPt("Lemon tart", 28, 14, 18)).toBe(28);
    expect(fitPt("x".repeat(36), 28, 14, 18)).toBe(14);
    expect(fitPt("x".repeat(24), 28, 14, 18)).toBe(21);
    expect(fitPt("x".repeat(200), 28, 14, 18)).toBe(14);
  });

  it("keeps a normal menu full size and tightens a long one", () => {
    expect(menuDensity(4, 8)).toBe(1);
    const long = menuDensity(7, 40);
    expect(long).toBeLessThan(1);
    expect(long).toBeGreaterThanOrEqual(0.6);
    expect(menuDensity(8, 200)).toBe(0.6);
  });

  it("fits lines and cuts the last item at a word", () => {
    expect(fitLines(["aaa", "bbb"], 5, 10)).toEqual({ shown: ["aaa", "bbb"], hidden: 0, cut: false });
    const r = fitLines(["one", "this is a long step that goes on and on and on"], 3, 10);
    expect(r.cut).toBe(true);
    expect(r.shown[1].endsWith("…")).toBe(true);
    expect(r.shown[1].length).toBeLessThanOrEqual(20);
    expect(fitLines(["a", "b", "c"], 2, 10)).toEqual({ shown: ["a", "b"], hidden: 1, cut: false });
  });
});

describe("recipe card text", () => {
  const steps = Array.from({ length: 12 }, (_, i) => `${i + 1}. Stir the pot gently for a while and then keep stirring until it looks right.`);

  it("drops step numbers", () => {
    expect(cleanStep("1. Preheat")).toBe("Preheat");
    expect(cleanStep("Step 2: Mix")).toBe("Mix");
    expect(cleanStep("350F oven")).toBe("350F oven");
  });

  it("truncates steps by length option", () => {
    const short = cardSteps(steps, "short");
    const long = cardSteps(steps, "long");
    expect(short.truncated).toBe(true);
    expect(short.steps.length).toBeLessThan(long.steps.length);
    expect(short.steps[0].startsWith("Stir")).toBe(true);
    expect(cardSteps(steps, "none")).toEqual({ steps: [], truncated: true });
    expect(cardSteps(["Mix.", "Bake."], "short")).toEqual({ steps: ["Mix.", "Bake."], truncated: false });
    expect(cardSteps([], "none").truncated).toBe(false);
  });

  it("keeps ingredients whole and counts the rest", () => {
    expect(cardIngredients(["1 egg", " ", "2 cups flour"])).toEqual({ ingredients: ["1 egg", "2 cups flour"], more: 0 });
    const many = Array.from({ length: 30 }, (_, i) => `${i} cups sugar`);
    const r = cardIngredients(many);
    expect(r.ingredients.length).toBe(15);
    expect(r.more).toBe(15);
  });

  it("reads the full recipe bare or wrapped", () => {
    const bare = readCardRecipe({ title: "Tart", servings: 8, ingredients: ["1 egg"], instructions: ["Bake"] });
    expect(bare).toEqual({ title: "Tart", servings: 8, ingredients: ["1 egg"], steps: ["Bake"] });
    expect(readCardRecipe({ recipe: { title: "Tart", ingredients: [{ text: "1 egg" }], instructions: [] } })?.ingredients).toEqual(["1 egg"]);
    expect(readCardRecipe(null)).toBeNull();
  });
});

describe("partyDateLine", () => {
  it("formats a date and leaves out midnight", () => {
    expect(partyDateLine(null)).toBeNull();
    expect(partyDateLine("not a date")).toBeNull();
    const evening = partyDateLine(new Date(2026, 9, 18, 19, 0).toISOString(), "en-US");
    expect(evening).toBe("Sunday, October 18 · 7:00 PM");
    expect(partyDateLine(new Date(2026, 9, 18).toISOString(), "en-US")).toBe("Sunday, October 18");
  });
});
