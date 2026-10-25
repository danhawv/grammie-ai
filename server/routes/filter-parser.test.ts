import { describe, expect, it } from "vitest";
import { parseFiltersFromQuery } from "./filter-parser";

describe("parseFiltersFromQuery", () => {
  it("reads the handy toggles only when they are 'true'", () => {
    expect(parseFiltersFromQuery({ mealPrep: "true", onePot: "true" })).toEqual({ mealPrep: true, onePot: true });
    expect(parseFiltersFromQuery({ mealPrep: "false" })).toEqual({});
    expect(parseFiltersFromQuery({ mealPrep: "1" })).toEqual({});
  });

  it("round-trips the params the client sends", () => {
    // Same shape as serializeFiltersToParams in client/src/components/recipe-filter-controls.tsx
    const params = { mealTypes: "Dinner,Lunch", dietary_highProtein: "true", mealPrep: "true", search: "chili" };
    expect(parseFiltersFromQuery(params)).toEqual({
      mealTypes: ["Dinner", "Lunch"], dietary: { highProtein: true }, mealPrep: true, search: "chili",
    });
  });
});
