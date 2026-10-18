import { describe, expect, it } from "vitest";
import { scaleRecipe } from "./scaling";

describe("scaling ingredient lines", () => {
  it("scales each amount once", () => {
    const out = scaleRecipe({ servings: 4, ingredients: ["2 cups flour", "1 1/2 tsp salt", "3 eggs", "1/2 cup milk", "Bake at 350 degrees"] } as any, 8) as any;
    const lines = JSON.stringify(out);
    expect(lines).toContain("4 cups flour");
    expect(lines).toContain("3 tsp salt");
    expect(lines).toContain("6 eggs");
    expect(lines).toContain("1 cup milk");
    expect(lines).toContain("350 degrees");
  });
});
