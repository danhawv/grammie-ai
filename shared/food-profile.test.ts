import { describe, it, expect } from "vitest";
import {
  getFoodProfile,
  foodProfileToPreferences,
  getDisplayPrefs,
  buildPreferencesPatch,
  ingredientMatchesAvoid,
  normalizeIngredientList,
  userPreferencesUpdateSchema,
} from "./food-profile";

describe("getFoodProfile", () => {
  it("gives defaults for empty or missing preferences", () => {
    for (const prefs of [null, undefined, {}]) {
      const p = getFoodProfile(prefs);
      expect(p).toMatchObject({
        allergies: [], diets: [], dislikes: [], avoidAll: [],
        householdSize: 2, skillLevel: "intermediate", cuisines: [], goals: [], notes: "",
      });
    }
  });

  it("reads the legacy keys and combines allergies with dislikes", () => {
    const p = getFoodProfile({
      allergies: ["Peanuts", " shellfish "],
      dislikedIngredients: ["cilantro", "peanuts"],
      dietaryRestrictions: ["vegan"],
      householdSize: 4,
      cookingSkillLevel: "beginner",
      grammieNotes: "No spice",
    });
    expect(p.allergies).toEqual(["peanuts", "shellfish"]);
    expect(p.dislikes).toEqual(["cilantro", "peanuts"]);
    expect(p.avoidAll).toEqual(["peanuts", "shellfish", "cilantro"]);
    expect(p.diets).toEqual(["vegan"]);
    expect(p.householdSize).toBe(4);
    expect(p.skillLevel).toBe("beginner");
    expect(p.notes).toBe("No spice");
  });

  it("ignores junk values", () => {
    const p = getFoodProfile({ householdSize: -3, cookingSkillLevel: "wizard" as any, allergies: "nuts" as any });
    expect(p.householdSize).toBe(2);
    expect(p.skillLevel).toBe("intermediate");
    expect(p.allergies).toEqual([]);
  });

  it("round-trips through the stored key names", () => {
    const stored = foodProfileToPreferences(getFoodProfile({ allergies: ["eggs"], cuisinePreferences: ["Thai"], householdSize: 3 }));
    expect(stored).toMatchObject({ allergies: ["eggs"], cuisinePreferences: ["Thai"], householdSize: 3 });
    expect(userPreferencesUpdateSchema.safeParse(stored).success).toBe(true);
  });
});

describe("buildPreferencesPatch", () => {
  it("only includes keys that were sent", () => {
    expect(buildPreferencesPatch({ allergies: ["eggs"] }, { householdSize: 3 })).toEqual({ householdSize: 3 });
  });

  it("merges display key by key and syncs the grocery unitSystem", () => {
    const patch = buildPreferencesPatch({ display: { textSize: "large" } }, { display: { units: "metric" } });
    expect(patch).toEqual({ display: { textSize: "large", units: "metric" }, unitSystem: "metric" });
  });

  it("leaves unitSystem alone for 'as written'", () => {
    const patch = buildPreferencesPatch({ unitSystem: "metric" }, { display: { units: "original" } });
    expect(patch).toEqual({ display: { units: "original" } });
  });
});

describe("getDisplayPrefs", () => {
  it("returns undefined for unset or invalid values", () => {
    expect(getDisplayPrefs({})).toEqual({ textSize: undefined, units: undefined });
    expect(getDisplayPrefs({ display: { textSize: "huge" as any, units: "us" } })).toEqual({ textSize: undefined, units: "us" });
  });
});

describe("ingredientMatchesAvoid", () => {
  it("matches substrings either way and never matches blank names", () => {
    expect(ingredientMatchesAvoid("roasted peanuts", ["peanuts"])).toBe(true);
    expect(ingredientMatchesAvoid("flour", ["peanuts"])).toBe(false);
    expect(ingredientMatchesAvoid("", ["peanuts"])).toBe(false);
    expect(ingredientMatchesAvoid("salt", ["", " "])).toBe(false);
  });
});

describe("normalizeIngredientList", () => {
  it("trims, lowercases and dedupes", () => {
    expect(normalizeIngredientList([" Eggs", "eggs", "", 3, "Milk"])).toEqual(["eggs", "milk"]);
  });
});

describe("userPreferencesUpdateSchema", () => {
  it("rejects invalid display values", () => {
    expect(userPreferencesUpdateSchema.safeParse({ display: { textSize: "huge" } }).success).toBe(false);
    expect(userPreferencesUpdateSchema.safeParse({ householdSize: 0 }).success).toBe(false);
  });
});
