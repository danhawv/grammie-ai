import { describe, expect, it } from "vitest";
import { buildFullRecipePhotoPrompt, withNewPrimaryPhoto } from "./dish-photo";

const photo = (id: string, isAiGenerated = true) => ({ id, url: `u-${id}`, isAiGenerated, order: 0, createdAt: "" });

describe("buildFullRecipePhotoPrompt", () => {
  it("includes the ingredients and the finishing steps", () => {
    const prompt = buildFullRecipePhotoPrompt({
      title: "Potage Sénégalais",
      description: null,
      ingredients: ["2 cups chicken broth", "1 cup heavy cream", "1 tbsp curry powder", "1/2 lb crab meat"],
      instructions: ["Simmer broth with curry.", "Stir in cream.", "Chill overnight.", "Serve cold topped with crab."],
      mealType: ["soup"],
      cuisines: null,
      servingSuggestions: null,
    });
    expect(prompt).toContain("Potage Sénégalais");
    expect(prompt).toContain("- 1 cup heavy cream");
    expect(prompt).toContain("Serve cold topped with crab.");
    expect(prompt).toMatch(/Do not add/);
  });

  it("keeps long recipes to a sensible length", () => {
    const prompt = buildFullRecipePhotoPrompt({
      title: "Big Stew",
      description: null,
      ingredients: Array.from({ length: 50 }, (_, i) => `ingredient ${i}`),
      instructions: Array.from({ length: 20 }, (_, i) => `step ${i}`),
      mealType: null,
      cuisines: null,
      servingSuggestions: null,
    });
    expect(prompt).toContain("and 20 more");
    expect(prompt).toContain("step 19");
    expect(prompt).not.toContain("step 10\n");
  });
});

describe("withNewPrimaryPhoto", () => {
  it("puts the new photo first and keeps the earlier ones", () => {
    const list = withNewPrimaryPhoto([photo("a"), photo("b")], photo("new"));
    expect(list.map((p) => p.id)).toEqual(["new", "a", "b"]);
    expect(list.map((p) => p.order)).toEqual([0, 1, 2]);
  });

  it("drops the oldest AI photo, never a family's own photo, when full", () => {
    const list = withNewPrimaryPhoto(
      [photo("ai1"), photo("mine1", false), photo("ai2"), photo("mine2", false), photo("ai3")],
      photo("new"),
    );
    expect(list.map((p) => p.id)).toEqual(["new", "ai1", "mine1", "ai2", "mine2"]);
  });
});
