import { describe, it, expect } from "vitest";
import {
  extractIngredientName,
  normalizeIngredient,
  isStaple,
  namesMatch,
  findPantryItem,
  computeCoverage,
  recipeIngredients,
  rankRecipesByPantry,
  groceryMergeKey,
  normalizeUnit,
  parseAmount,
} from "./pantry-match";

const pantry = ["butter", "eggs", "milk", "chicken thighs", "grapes", "tomatoes"].map((name) => ({ name }));

describe("extractIngredientName", () => {
  it("strips amounts, units and prep notes", () => {
    expect(extractIngredientName("2 cups (480 ml) whole milk, warmed")).toBe("whole milk");
    expect(extractIngredientName("1 1/2 lb boneless, skinless chicken thighs, cut into strips")).toBe("boneless, skinless chicken thighs");
    expect(extractIngredientName("½ cup unsalted butter, melted")).toBe("unsalted butter");
    expect(extractIngredientName("1 (14 oz) can diced tomatoes")).toBe("diced tomatoes");
    expect(extractIngredientName("3 cloves garlic, minced")).toBe("garlic");
    expect(extractIngredientName("Salt and pepper to taste")).toBe("Salt and pepper");
    expect(extractIngredientName("a pinch of salt")).toBe("salt");
  });

  it("skips section headers", () => {
    expect(extractIngredientName("For the sauce:")).toBe("");
    expect(extractIngredientName("Topping:")).toBe("");
  });
});

describe("normalizeIngredient", () => {
  it("singularizes and drops descriptors", () => {
    expect(normalizeIngredient("Boneless Skinless Chicken Thighs")).toBe("chicken thigh");
    expect(normalizeIngredient("large eggs")).toBe("egg");
    expect(normalizeIngredient("ripe tomatoes")).toBe("tomato");
    expect(normalizeIngredient("fresh berries")).toBe("berry");
    expect(normalizeIngredient("cheeses")).toBe("cheese");
    expect(normalizeIngredient("bay leaves")).toBe("bay leaf");
    expect(normalizeIngredient("asparagus")).toBe("asparagus");
  });

  it("applies synonyms", () => {
    expect(normalizeIngredient("scallions")).toBe("green onion");
    expect(normalizeIngredient("all-purpose flour")).toBe("flour");
    expect(normalizeIngredient("chicken stock")).toBe("chicken broth");
    expect(normalizeIngredient("garlic cloves")).toBe("garlic");
  });
});

describe("isStaple", () => {
  it("treats salt, pepper, oil, water, flour, sugar and dried spices as on hand", () => {
    for (const s of ["salt", "kosher salt", "black pepper", "olive oil", "vegetable oil", "water", "warm water",
      "all-purpose flour", "granulated sugar", "brown sugar", "ground cinnamon", "dried oregano", "paprika",
      "salt and pepper", "ground ginger", "baking soda"]) {
      expect(isStaple(s), s).toBe(true);
    }
  });

  it("does not treat fresh or specific items as staples", () => {
    for (const s of ["bell pepper", "fresh thyme", "ginger", "fresh ginger", "butter", "eggs", "sesame oil", "tomato paste"]) {
      expect(isStaple(s), s).toBe(false);
    }
  });
});

describe("namesMatch", () => {
  it("matches plural/singular and extra descriptors", () => {
    expect(namesMatch(normalizeIngredient("chicken thighs"), normalizeIngredient("boneless chicken thighs"))).toBe(true);
    expect(namesMatch(normalizeIngredient("tomatoes"), normalizeIngredient("grape tomatoes"))).toBe(true);
    expect(namesMatch(normalizeIngredient("cheddar"), normalizeIngredient("sharp cheddar cheese"))).toBe(true);
  });

  it("lets generic proteins cover their cuts", () => {
    expect(namesMatch("chicken", "chicken thigh")).toBe(true);
    expect(namesMatch("egg", "egg yolk")).toBe(true);
    expect(namesMatch("chicken thigh", "chicken breast")).toBe(false);
  });

  it("keeps different foods apart", () => {
    expect(namesMatch("butter", "peanut butter")).toBe(false);
    expect(namesMatch("milk", "coconut milk")).toBe(false);
    expect(namesMatch("milk", "buttermilk")).toBe(false);
    expect(namesMatch("grape", "grape tomato")).toBe(false);
    expect(namesMatch("tomato", "tomato paste")).toBe(false);
    expect(namesMatch("cream", "sour cream")).toBe(false);
    expect(namesMatch("potato", "sweet potato")).toBe(false);
  });
});

describe("findPantryItem", () => {
  it("finds the covering pantry item", () => {
    expect(findPantryItem("2 large eggs", pantry)?.name).toBe("eggs");
    expect(findPantryItem("unsalted butter", pantry)?.name).toBe("butter");
    expect(findPantryItem("boneless chicken thighs", pantry)?.name).toBe("chicken thighs");
    expect(findPantryItem("cherry tomatoes", pantry)?.name).toBe("tomatoes");
    expect(findPantryItem("whole milk", pantry)?.name).toBe("milk");
    expect(findPantryItem("peanut butter", pantry)).toBeNull();
    expect(findPantryItem("chicken broth", pantry)).toBeNull();
  });

  it("accepts either side of an 'or'", () => {
    expect(findPantryItem("butter or margarine", pantry)?.name).toBe("butter");
  });
});

describe("computeCoverage", () => {
  it("counts what you have, what's missing, and assumes staples", () => {
    const ings = recipeIngredients({
      ingredients: [
        "1 1/2 lb boneless, skinless chicken thighs",
        "2 tbsp butter",
        "1 cup cherry tomatoes, halved",
        "2 cloves garlic, minced",
        "1 lemon",
        "Salt and pepper to taste",
        "2 tbsp olive oil",
        "Fresh parsley, for garnish",
      ],
    });
    const cov = computeCoverage(ings, pantry);
    expect(cov.have.map((h) => h.pantryItem.name)).toEqual(["chicken thighs", "butter", "tomatoes"]);
    expect(cov.missing).toEqual(["garlic", "lemon"]);
    expect(cov.staples).toEqual(["Salt and pepper", "olive oil"]);
    expect(cov.haveCount).toBe(3);
    expect(cov.total).toBe(5);
    expect(cov.coverage).toBeCloseTo(0.6);
  });

  it("uses normalized ingredients when present and skips optional/tool items", () => {
    const ings = recipeIngredients({
      ingredients: ["ignored"],
      normalizedIngredients: [
        { item: "eggs", raw: "3 large eggs" },
        { item: "milk", raw: "1/4 cup milk" },
        { item: "chives", raw: "chives (optional)", isOptional: true },
        { item: "parchment paper", raw: "parchment paper", isToolOrConsumable: true },
      ],
    });
    expect(ings.map((i) => i.name)).toEqual(["eggs", "milk", "chives"]);
    const cov = computeCoverage(ings, pantry);
    expect(cov.haveCount).toBe(2);
    expect(cov.total).toBe(2);
  });

  it("counts a repeated ingredient once", () => {
    const cov = computeCoverage([{ name: "butter" }, { name: "butter, softened" }, { name: "sugar" }], pantry);
    expect(cov.haveCount).toBe(1);
    expect(cov.total).toBe(1);
  });
});

describe("rankRecipesByPantry", () => {
  // The flow-review case: this pantry used to return "No matching recipes".
  const recipes = [
    { id: "cake", ingredients: ["2 cups flour", "1 cup sugar", "1/2 cup butter", "2 eggs", "1 cup milk", "1 tsp vanilla extract", "1 cup cocoa powder"] },
    { id: "thighs", ingredients: ["6 bone-in chicken thighs", "2 tbsp butter", "1 pint grape tomatoes", "4 cloves garlic", "1 lemon", "Salt", "Pepper"] },
    { id: "omelet", ingredients: ["3 large eggs", "2 tbsp milk", "1 tbsp butter", "Salt and pepper"] },
    { id: "salmon", ingredients: ["2 salmon fillets", "1 lemon", "fresh dill"] },
    { id: "pbj", ingredients: ["2 slices bread", "2 tbsp peanut butter", "1 tbsp grape jelly"] },
  ];

  it("ranks by coverage and leaves out recipes that use nothing you have", () => {
    const ranked = rankRecipesByPantry(recipes, pantry);
    expect(ranked.map((r) => r.recipe.id)).toEqual(["omelet", "cake", "thighs"]);
    const omelet = ranked[0];
    expect(omelet.haveCount).toBe(3);
    expect(omelet.missing).toEqual([]);
    const cake = ranked[1];
    expect(cake.haveCount).toBe(3);
    expect(cake.total).toBe(4);
    expect(cake.missing).toEqual(["cocoa powder"]);
    const thighs = ranked[2];
    expect(thighs.haveCount).toBe(3);
    expect(thighs.missing).toEqual(["garlic", "lemon"]);
  });

  it("respects a limit", () => {
    expect(rankRecipesByPantry(recipes, pantry, { limit: 1 })).toHaveLength(1);
  });

  it("returns nothing for an empty pantry", () => {
    expect(rankRecipesByPantry(recipes, [])).toEqual([]);
  });
});

describe("groceryMergeKey", () => {
  it("merges only the same name and unit", () => {
    expect(groceryMergeKey("Milk", "cups")).toBe(groceryMergeKey("milk", "cup"));
    expect(groceryMergeKey("butter", "tablespoons")).toBe(groceryMergeKey("butter", "Tbsp"));
    expect(groceryMergeKey("garlic", "cloves")).not.toBe(groceryMergeKey("garlic", "head"));
    expect(groceryMergeKey("milk", "cup")).not.toBe(groceryMergeKey("milk", "tbsp"));
    expect(groceryMergeKey("eggs", "count")).toBe(groceryMergeKey("eggs", ""));
  });

  it("normalizes units", () => {
    expect(normalizeUnit("T")).toBe("tbsp");
    expect(normalizeUnit("t")).toBe("tsp");
    expect(normalizeUnit("Pounds")).toBe("lb");
    expect(normalizeUnit("pinches")).toBe("pinch");
  });
});

describe("parseAmount", () => {
  it("accepts whole numbers, decimals and fractions", () => {
    expect(parseAmount("2")).toBe(2);
    expect(parseAmount("1.5")).toBe(1.5);
    expect(parseAmount("1,5")).toBe(1.5);
    expect(parseAmount("1/2")).toBe(0.5);
    expect(parseAmount("1 1/2")).toBe(1.5);
    expect(parseAmount("1½")).toBe(1.5);
    expect(parseAmount("1 ½")).toBe(1.5);
    expect(parseAmount("¾")).toBe(0.75);
  });

  it("returns null for empty or unreadable input", () => {
    expect(parseAmount("")).toBeNull();
    expect(parseAmount("   ")).toBeNull();
    expect(parseAmount("a few")).toBeNull();
    expect(parseAmount("1/0")).toBeNull();
  });
});
