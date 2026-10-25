import { describe, expect, it } from "vitest";
import { findCardImage, heroImages } from "./recipe-images";

const img = (id: string, url: string, isAiGenerated: boolean, order: number) => ({ id, url, isAiGenerated, order, createdAt: "" });

describe("heroImages", () => {
  it("puts the dish photo first, the card second, then the other photos", () => {
    const recipe = {
      handwrittenImage: "card",
      dishImages: [img("c", "card", false, 0), img("a", "photo-a", true, 1), img("b", "photo-b", true, 2)],
    };
    expect(heroImages(recipe, "photo-a").map((i) => i.id)).toEqual(["a", "c", "b"]);
    expect(heroImages(recipe, "photo-a")[1].isCard).toBe(true);
  });

  it("shows only the card while the recipe is still being read", () => {
    const recipe = { handwrittenImage: "card", dishImages: [img("c", "card", false, 0)] };
    const out = heroImages(recipe, "card");
    expect(out).toHaveLength(1);
    expect(out[0].isCard).toBe(true);
  });

  it("keeps the single legacy photo for recipes without dishImages", () => {
    expect(heroImages({ handwrittenImage: null, dishImages: null }, "photo")).toEqual([
      { id: "legacy", url: "photo", isAiGenerated: true, isCard: false },
    ]);
  });

  it("adds the card when it is missing from dishImages", () => {
    const out = heroImages({ handwrittenImage: "card", dishImages: [img("a", "photo-a", true, 0)] }, "photo-a");
    expect(out.map((i) => i.url)).toEqual(["photo-a", "card"]);
  });

  it("finds the card by picture, falling back to the first non-AI entry", () => {
    expect(findCardImage({ handwrittenImage: "card", dishImages: [img("u", "upload", false, 1), img("c", "card", false, 0)] })?.id).toBe("c");
    expect(findCardImage({ handwrittenImage: "turned-card", dishImages: [img("c", "card", false, 0), img("a", "photo", true, 1)] })?.id).toBe("c");
    expect(findCardImage({ handwrittenImage: null, dishImages: [img("u", "upload", false, 0)] })).toBeNull();
  });
});
