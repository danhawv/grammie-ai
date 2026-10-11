import { describe, expect, it } from "vitest";
import { firstSharedUrl, sharedRecipeText } from "./share-text";

describe("firstSharedUrl", () => {
  it("finds a bare link", () => {
    expect(firstSharedUrl(["https://www.instagram.com/reel/abc123/?igsh=xyz"])).toBe(
      "https://www.instagram.com/reel/abc123/?igsh=xyz",
    );
  });

  it("finds a link inside a caption and drops trailing punctuation", () => {
    expect(firstSharedUrl(["Grandma's pie! Recipe: https://example.com/pie."])).toBe("https://example.com/pie");
  });

  it("looks through every shared text", () => {
    expect(firstSharedUrl(["Check this out", "https://vm.tiktok.com/ZM123/"])).toBe("https://vm.tiktok.com/ZM123/");
  });

  it("returns null without a link", () => {
    expect(firstSharedUrl(["just words"])).toBeNull();
    expect(firstSharedUrl([])).toBeNull();
  });
});

describe("sharedRecipeText", () => {
  it("keeps text long enough to be a recipe", () => {
    expect(sharedRecipeText(["2 cups flour, 1 cup sugar, bake at 350"])).toContain("flour");
  });

  it("ignores short text", () => {
    expect(sharedRecipeText(["yum"])).toBeNull();
  });
});
