import { describe, it, expect } from "vitest";
import { addToGroceryAggregate, type AggregatedGroceryItem } from "./grocery-aggregate";

const line = (quantity: number, unit: string) => ({
  item: "garlic", quantity, unit, displayName: "garlic", aisle: "Produce", category: null, emoji: null,
});

describe("addToGroceryAggregate", () => {
  it("adds amounts for a repeated unconvertible unit instead of replacing them", () => {
    const agg = new Map<string, AggregatedGroceryItem<string>>();
    addToGroceryAggregate(agg, "garlic|clove", line(2, "clove"), "Chili");
    addToGroceryAggregate(agg, "garlic|clove", line(3, "clove"), "Soup");
    expect(agg.get("garlic|clove")!.quantity).toBe(5);
    expect(agg.get("garlic|clove")!.originalEntries).toEqual(["Chili", "Soup"]);
  });

  it("adds converted amounts for the same key", () => {
    const agg = new Map<string, AggregatedGroceryItem<string>>();
    addToGroceryAggregate(agg, "milk|cup", line(240, "ml"), "a");
    addToGroceryAggregate(agg, "milk|cup", line(120, "ml"), "b");
    expect(agg.get("milk|cup")!.quantity).toBe(360);
  });

  it("keeps different keys apart", () => {
    const agg = new Map<string, AggregatedGroceryItem<string>>();
    addToGroceryAggregate(agg, "garlic|clove", line(2, "clove"), "a");
    addToGroceryAggregate(agg, "garlic|head", line(1, "head"), "b");
    expect(agg.size).toBe(2);
  });
});
