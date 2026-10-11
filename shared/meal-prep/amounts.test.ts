import { describe, expect, it } from "vitest";
import { humanAmount, niceNumber } from "./amounts";

const ing = (name: string, aisle?: string) => ({ id: name.toLowerCase().replace(/\s+/g, "-"), name, aisle });

describe("niceNumber", () => {
  it("uses kitchen fractions", () => {
    expect(niceNumber(1.5)).toBe("1½");
    expect(niceNumber(0.33)).toBe("⅓");
    expect(niceNumber(2.74)).toBe("2¾");
    expect(niceNumber(3)).toBe("3");
    expect(niceNumber(2.97)).toBe("3");
    expect(niceNumber(0.1)).toBe("⅛");
    expect(niceNumber(12.4)).toBe("12");
  });
});

describe("humanAmount", () => {
  it("counts things bought by the piece", () => {
    expect(humanAmount(450, ing("Yellow onion", "Produce"))).toBe("3 medium onions");
    expect(humanAmount(40, ing("Garlic", "Produce"))).toBe("8 cloves garlic");
    expect(humanAmount(100, ing("Eggs", "Dairy & Eggs"))).toBe("2 eggs");
    expect(humanAmount(80, ing("Celery", "Produce"))).toBe("2 stalks celery");
  });
  it("rounds pieces up for shopping", () => {
    expect(humanAmount(170, ing("Yellow onion", "Produce"))).toBe("1 medium onion");
    expect(humanAmount(170, ing("Yellow onion", "Produce"), { wholeItems: true })).toBe("1 medium onion");
    expect(humanAmount(240, ing("Yellow onion", "Produce"), { wholeItems: true })).toBe("2 medium onions");
  });
  it("doesn't count powders, canned or dried forms", () => {
    expect(humanAmount(6, ing("Onion powder", "Spices & Seasonings"))).toBe("2½ tsp");
    expect(humanAmount(411, ing("Diced tomatoes", "Canned & Jarred"))).toBe("14½ oz (411 g), about 1 can");
  });
  it("measures liquids and grains by volume", () => {
    expect(humanAmount(960, ing("Chicken broth", "Canned & Jarred"))).toBe("4 cups");
    expect(humanAmount(30, ing("Olive oil", "Oils, Vinegars & Condiments"))).toBe("2 tbsp");
    expect(humanAmount(2, ing("Ground cumin", "Spices & Seasonings"))).toBe("¾ tsp");
    expect(humanAmount(370, ing("White rice", "Pasta, Rice & Grains"))).toBe("2 cups (370 g)");
  });
  it("weighs meat in pounds or ounces with grams", () => {
    expect(humanAmount(680, ing("Ground beef", "Meat & Seafood"))).toBe("1½ lb (680 g)");
    expect(humanAmount(225, ing("Bacon", "Meat & Seafood"))).toBe("8 oz (225 g)");
    expect(humanAmount(2000, ing("Chicken thighs", "Meat & Seafood"))).toBe("4½ lb (2 kg)");
  });
  it("says 'some' when there's no amount", () => {
    expect(humanAmount(null, ing("Salt"))).toBe("some");
  });
});
