import { describe, expect, it } from "vitest";
import { defaultSlots, dishAllergens, dishConflicts, dishFitsDiet, dishScale, duplicateOf, inviteSite, menuSections, openSlots } from "./party";

const r = (ingredients: string[], allergens: string[] = [], diets: string[] = []) => ({ ingredients, allergens, diets });

describe("party rules", () => {
  it("scales dinners to the table and leaves potlucks as written", () => {
    expect(dishScale("dinner", 4, 10)).toEqual({ scale: 2.5, makeServings: 10 });
    expect(dishScale("potluck", 4, 30)).toEqual({ scale: 1, makeServings: 4 });
    expect(dishScale("dinner", null, 10)).toEqual({ scale: 1, makeServings: null });
    expect(dishScale("dinner", 2, 100).scale).toBe(12);
  });

  it("finds allergens from enrichment and ingredient words, without false friends", () => {
    expect(dishAllergens(r(["1 cup almond milk", "2 tbsp peanut butter"]))).toEqual(["Peanuts", "Tree Nuts"]);
    expect(dishAllergens(r(["2 cups gluten-free flour"]))).toEqual([]);
    expect(dishAllergens(r(["1 eggplant"]))).toEqual([]);
    expect(dishAllergens(r([], ["dairy"]))).toEqual(["Dairy"]);
  });

  it("judges diets", () => {
    expect(dishFitsDiet(r(["1 lb ground beef"]), "vegetarian")).toBe(false);
    expect(dishFitsDiet(r(["2 cups rice", "1 cup oat milk"]), "vegan")).toBe(true);
    expect(dishFitsDiet(r(["salmon"]), "pescatarian")).toBe(true);
    expect(dishFitsDiet(r(["1 cup shredded cheddar"]), "vegan")).toBe(false);
    expect(dishFitsDiet(null, "vegan")).toBeNull();
  });

  it("names who a dish clashes with, ignoring people not coming", () => {
    const guests = [
      { name: "Sam", rsvp: "yes" as const, allergies: ["Peanuts" as const], diets: [] },
      { name: "Ali", rsvp: "no" as const, allergies: ["Peanuts" as const], diets: [] },
      { name: "Jo", rsvp: "maybe" as const, allergies: [], diets: ["vegetarian" as const] },
    ];
    const c = dishConflicts(r(["peanuts", "bacon"]), guests);
    expect(c.map((x) => [x.what, x.guests])).toEqual([["Peanuts", ["Sam"]], ["vegetarian", ["Jo"]]]);
  });

  it("spots duplicates and open slots, and orders the menu", () => {
    expect(duplicateOf("Grandma's Mac and Cheese", [{ id: "1", title: "mac & cheese", guestName: "S" }])?.id).toBe("1");
    expect(duplicateOf("Brownies", [{ id: "1", title: "Lemon bars", guestName: "S" }])).toBeNull();
    const slots = [{ id: "a", course: "main" as const, label: null, position: 0 }, { id: "b", course: "dessert" as const, label: null, position: 1 }];
    expect(openSlots(slots, [{ slotId: "a" }]).map((s) => s.id)).toEqual(["b"]);
    expect(menuSections([{ course: "dessert" as const }, { course: "appetizer" as const }]).map((s) => s.course)).toEqual(["appetizer", "dessert"]);
    expect(defaultSlots("potluck", 24).length).toBeGreaterThan(defaultSlots("dinner", 24).length);
    expect(inviteSite("https://partiful.com/e/abc")).toBe("partiful");
  });
});
