import { describe, expect, it } from "vitest";
import type { PartyDish, PartyGuest, PartySlot } from "@shared/party";
import {
  anyImporting,
  coverage,
  fromLocalInput,
  inviteTokenFrom,
  isImporting,
  safeNext,
  signUpPath,
  joinPrefillFromProfile,
  menuBoard,
  recipeFactsFrom,
  scaleIngredient,
  scaleText,
  shareableInvite,
  toLocalInput,
} from "./party-format";
import { clearGuestToken, getGuestToken, setGuestToken } from "./party-api";

const guest = (over: Partial<PartyGuest>): PartyGuest => ({
  id: "g", name: "Sam", rsvp: "yes", partySize: 1, allergies: [], diets: [], dietNote: null, isHost: false, hasAccount: false, ...over,
});

const dish = (over: Partial<PartyDish>): PartyDish => ({
  id: "d", slotId: null, course: "main", guestId: "g", guestName: "Sam", title: "Dish", note: null, recipe: null,
  makeServings: null, scale: 1, conflicts: [], createdAt: "2026-10-01T00:00:00Z", ...over,
});

const facts = (ingredients: string[], status: string | null = "ready") => ({
  id: "r", title: "R", description: null, image: null, servings: 4, allergens: [], diets: [], ingredients, status,
});

describe("party links", () => {
  it("reads the invite token from full and relative links", () => {
    expect(inviteTokenFrom("https://grammie.ai/p/abc_123")).toBe("abc_123");
    expect(inviteTokenFrom("/p/xyz?claim=1")).toBe("xyz");
    expect(inviteTokenFrom(null)).toBeNull();
    expect(inviteTokenFrom("https://grammie.ai/parties/1")).toBeNull();
  });

  it("keeps full links and completes relative ones", () => {
    expect(shareableInvite("https://grammie.ai/p/abc")).toBe("https://grammie.ai/p/abc");
    expect(shareableInvite("/p/abc")).toMatch(/^https?:\/\/.+\/p\/abc$/);
  });
});

describe("sign-up round trip", () => {
  it("comes back to the party, claiming when asked", () => {
    expect(signUpPath("abc", true)).toBe("/login?mode=signup&next=%2Fp%2Fabc%3Fclaim%3D1");
    expect(signUpPath("abc", false, "signin")).toBe("/login?next=%2Fp%2Fabc");
  });
  it("only follows paths on this site", () => {
    expect(safeNext("/p/abc?claim=1")).toBe("/p/abc?claim=1");
    expect(safeNext("https://evil.example")).toBeNull();
    expect(safeNext("//evil.example")).toBeNull();
    expect(safeNext(null)).toBeNull();
  });
});

describe("dates", () => {
  it("round-trips a datetime-local value", () => {
    const iso = fromLocalInput("2026-11-08T18:30")!;
    expect(toLocalInput(iso)).toBe("2026-11-08T18:30");
    expect(fromLocalInput("")).toBeNull();
    expect(toLocalInput(null)).toBe("");
  });
});

describe("scale wording", () => {
  it("speaks only for dinner style", () => {
    expect(scaleText({ scale: 2.5, makeServings: 10 }, "dinner")).toBe("Make 2½× the recipe: enough for 10");
    expect(scaleText({ scale: 1, makeServings: 4 }, "dinner")).toBe("Make the recipe as written: enough for 4");
    expect(scaleText({ scale: 1, makeServings: 4 }, "potluck")).toBeNull();
    expect(scaleText({ scale: 1, makeServings: null }, "dinner")).toBeNull();
  });

  it("multiplies quantities and leaves lines without one alone", () => {
    expect(scaleIngredient({ quantity: 1.5, unit: "cup" }, 2).quantity).toBe(3);
    const raw = { raw: "salt to taste" } as { raw: string; quantity?: number };
    expect(scaleIngredient(raw, 2)).toBe(raw);
  });
});

describe("imports", () => {
  it("knows when a recipe is still being read", () => {
    expect(isImporting({ status: "extracting" })).toBe(true);
    expect(isImporting({ status: "enriching" })).toBe(true);
    expect(isImporting({ status: "ready" })).toBe(false);
    expect(isImporting({ status: "failed" })).toBe(false);
    expect(isImporting(null)).toBe(false);
    expect(anyImporting({ dishes: [dish({ recipe: facts([], "extracting") })] })).toBe(true);
    expect(anyImporting({ dishes: [dish({})] })).toBe(false);
  });
});

describe("menu board", () => {
  const slots: PartySlot[] = [
    { id: "s2", course: "dessert", label: null, position: 2 },
    { id: "s1", course: "main", label: "Something hearty", position: 1 },
    { id: "s3", course: "main", label: null, position: 3 },
  ];
  it("puts dishes on their slots, extras under their course, in menu order", () => {
    const board = menuBoard(slots, [dish({ id: "a", slotId: "s1" }), dish({ id: "b", course: "drink" })]);
    expect(board.map((g) => g.course)).toEqual(["main", "dessert", "drink"]);
    expect(board[0].slots.map((s) => s.dish?.id ?? null)).toEqual(["a", null]);
    expect(board[2].extras.map((d) => d.id)).toEqual(["b"]);
  });
});

describe("everyone covered", () => {
  it("counts safe mains and sides for guests with restrictions", () => {
    const guests = [guest({ id: "1", name: "Sam", allergies: ["Peanuts"] }), guest({ id: "2", name: "Al" }), guest({ id: "3", name: "Bo", rsvp: "no", diets: ["vegan"] })];
    const dishes = [
      dish({ id: "x", course: "main", recipe: facts(["1 cup peanut butter"]) }),
      dish({ id: "y", course: "side", recipe: facts(["2 carrots"]) }),
      dish({ id: "z", course: "drink" }),
    ];
    const c = coverage(guests, dishes);
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ safe: 1, unknown: 1, safeMainsAndSides: 1, worry: true });
  });
});

describe("Food profile prefill", () => {
  it("maps known allergies and diets, and notes the rest", () => {
    expect(joinPrefillFromProfile({ allergies: ["peanuts", "milk", "cilantro"], diets: ["vegan", "keto"] })).toEqual({
      allergies: ["Peanuts", "Dairy"],
      diets: ["vegan"],
      dietNote: "Also avoid: cilantro",
    });
  });
});

describe("recipe facts", () => {
  it("reads diet flags and ingredients from a recipe row", () => {
    const f = recipeFactsFrom({ id: "r1", title: "Soup", servings: 6, isVegan: true, dietType: ["Vegetarian"], ingredients: ["water"] });
    expect(f.diets).toEqual(["vegetarian", "vegan"]);
    expect(f.servings).toBe(6);
  });
});

describe("guest tokens on this device", () => {
  const memory = () => {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
  };
  it("keeps one token per invite", () => {
    const s = memory();
    setGuestToken("inv1", "g1", s);
    setGuestToken("inv2", "g2", s);
    expect(getGuestToken("inv1", s)).toBe("g1");
    clearGuestToken("inv1", s);
    expect(getGuestToken("inv1", s)).toBeNull();
    expect(getGuestToken("inv2", s)).toBe("g2");
  });
  it("survives broken or missing storage", () => {
    const broken = { getItem: () => "{not json", setItem: () => { throw new Error("full"); } };
    expect(getGuestToken("x", broken)).toBeNull();
    expect(() => setGuestToken("x", "y", broken)).not.toThrow();
    expect(getGuestToken("x", null)).toBeNull();
  });
});
