import { describe, expect, it } from "vitest";
import { formatDuration, formatServings, formatTimeAndServings, pluralize } from "./format";

describe("pluralize", () => {
  it("uses singular only for exactly one", () => {
    expect(pluralize(1, "recipe")).toBe("1 recipe");
    expect(pluralize(0, "recipe")).toBe("0 recipes");
    expect(pluralize(12, "recipe")).toBe("12 recipes");
  });
  it("supports irregular plurals and decimals", () => {
    expect(pluralize(2, "loaf", "loaves")).toBe("2 loaves");
    expect(pluralize(1.5, "cup")).toBe("1.5 cups");
  });
});

describe("formatDuration", () => {
  it("hides missing or nonsense values", () => {
    expect(formatDuration(null)).toBeNull();
    expect(formatDuration(undefined)).toBeNull();
    expect(formatDuration(0)).toBeNull();
    expect(formatDuration(-5)).toBeNull();
    expect(formatDuration(NaN)).toBeNull();
  });
  it("formats minutes and hours", () => {
    expect(formatDuration(0.4)).toBe("1 min");
    expect(formatDuration(5)).toBe("5 min");
    expect(formatDuration(59)).toBe("59 min");
    expect(formatDuration(60)).toBe("1 hr");
    expect(formatDuration(90)).toBe("1 hr 30 min");
    expect(formatDuration(23 * 60 + 59)).toBe("23 hr 59 min");
  });
  it("switches to days for long recipes", () => {
    expect(formatDuration(24 * 60)).toBe("1 day");
    expect(formatDuration(30 * 60)).toBe("1 day 6 hr");
    expect(formatDuration(47 * 60 + 50)).toBe("2 days");
    expect(formatDuration(48 * 60)).toBe("2 days");
    expect(formatDuration(72 * 60 + 30)).toBe("3 days");
  });
});

describe("formatServings", () => {
  it("pluralizes correctly", () => {
    expect(formatServings(1)).toBe("1 serving");
    expect(formatServings(4)).toBe("4 servings");
  });
  it("hides unknown servings", () => {
    expect(formatServings(null)).toBeNull();
    expect(formatServings(0)).toBeNull();
  });
});

describe("formatTimeAndServings", () => {
  it("joins the known parts", () => {
    expect(formatTimeAndServings(45, 1)).toBe("45 min · 1 serving");
    expect(formatTimeAndServings(null, 6)).toBe("6 servings");
    expect(formatTimeAndServings(4350, null)).toBe("3 days");
    expect(formatTimeAndServings(null, null)).toBeNull();
  });
});
