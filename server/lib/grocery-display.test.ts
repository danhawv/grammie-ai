import { describe, expect, it } from "vitest";
import { groceryDisplay } from "./grocery-display";

describe("grocery amounts in the chosen units", () => {
  it("switches grams between US and metric", () => {
    const item = { quantity: 1200, unit: "g" };
    const entries = [{ quantity: 1200, unit: "g" }];
    expect(groceryDisplay(item, entries, "metric").displayText).toBe("1.2 kg");
    expect(groceryDisplay(item, entries, "us").displayText).toBe("2.65 lb");
    expect(groceryDisplay({ quantity: 100, unit: "g" }, null, "us").displayText).toBe("3.53 oz");
  });

  it("keeps US recipe units in US and converts them for metric", () => {
    const item = { quantity: 473.176, unit: "ml" };
    const entries = [{ quantity: 1, unit: "cup" }, { quantity: 1, unit: "cup" }];
    expect(groceryDisplay(item, entries, "us").displayText).toBe("2 cup");
    expect(groceryDisplay(item, entries, "metric").displayText).toBe("473 ml");
  });

  it("leaves counts alone", () => {
    expect(groceryDisplay({ quantity: 3, unit: "count" }, [{ quantity: 3, unit: "" }], "metric").displayText).toBe("3");
  });
});
