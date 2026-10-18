import { describe, expect, it } from "vitest";
import { clip, formatAmount, result, scaleIngredientLine } from "./format";

describe("scaleIngredientLine", () => {
  it("scales the leading amount once", () => {
    expect(scaleIngredientLine("2 cups flour", 2).text).toBe("4 cups flour");
    expect(scaleIngredientLine("1 1/2 cups milk", 2).text).toBe("3 cups milk");
    expect(scaleIngredientLine("1/2 tsp salt", 0.5).text).toBe("1/4 tsp salt");
    expect(scaleIngredientLine("2-3 cloves garlic", 2).text).toBe("4-6 cloves garlic");
    expect(scaleIngredientLine("½ cup sugar", 3).text).toBe("1 1/2 cup sugar");
    expect(scaleIngredientLine("200g butter", 1.5).text).toBe("300g butter");
  });

  it("leaves lines without an amount, or 'to taste', alone", () => {
    expect(scaleIngredientLine("salt to taste", 2)).toEqual({ text: "salt to taste", scaled: false });
    expect(scaleIngredientLine("a handful of basil", 2)).toEqual({ text: "a handful of basil", scaled: false });
    expect(scaleIngredientLine("2 eggs", 1)).toEqual({ text: "2 eggs", scaled: false });
  });

  it("formats amounts as kitchen fractions", () => {
    expect(formatAmount(0.333)).toBe("1/3");
    expect(formatAmount(2.75)).toBe("2 3/4");
    expect(formatAmount(12.25)).toBe("12.3");
    expect(formatAmount(1.43)).toBe("1.43");
  });
});

describe("limits", () => {
  it("clips long text", () => {
    expect(clip("x".repeat(50), 10)).toHaveLength(10);
    expect(clip("   ")).toBeNull();
  });

  it("trims long lists to fit the result cap", () => {
    const big = Array.from({ length: 2000 }, (_, i) => ({ i, text: "y".repeat(100) }));
    const r = result({ items: big }, ["items"]);
    expect(r.content[0].text.length).toBeLessThanOrEqual(60_000);
    expect((r.structuredContent as any).truncated).toBe(true);
  });
});
