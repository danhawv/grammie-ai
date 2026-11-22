import { describe, expect, it } from "vitest";
import { COVER_PALETTES, coverPaletteFor, frontCoverHtml } from "./cover-design";

describe("frontCoverHtml", () => {
  const base = { title: "Grammie's Recipes", palette: COVER_PALETTES.heirloom, widthIn: 6, heightIn: 9 };

  it("prints the title, subtitle and author, escaped", () => {
    const html = frontCoverHtml({ ...base, title: "Mom & <Dad>", subtitle: "Three generations", author: "The Millers" });
    expect(html).toContain("Mom &amp; &lt;Dad&gt;");
    expect(html).toContain("Three generations");
    expect(html).toContain("The Millers");
  });

  it("puts the photo on the cover when there is one", () => {
    const withPhoto = frontCoverHtml({ ...base, photoSrc: "data:image/jpeg;base64,AAA" });
    const without = frontCoverHtml(base);
    expect(withPhoto).toContain('src="data:image/jpeg;base64,AAA"');
    expect(without).not.toContain("<img");
    expect(without).toContain("A Family Cookbook");
  });

  it("is laid out at the book's trim size", () => {
    expect(frontCoverHtml({ ...base, widthIn: 8.5, heightIn: 11 })).toContain("width:8.5in;height:11in");
  });

  it("falls back to a title when there isn't one", () => {
    expect(frontCoverHtml({ ...base, title: "" })).toContain("Our Family Cookbook");
  });
});

describe("coverPaletteFor", () => {
  it("uses the style's palette, and Classic for unknown styles", () => {
    expect(coverPaletteFor("modern")).toBe(COVER_PALETTES.modern);
    expect(coverPaletteFor("nope")).toBe(COVER_PALETTES.classic);
  });

  it("takes a custom template's cover colors, with readable text", () => {
    const p = coverPaletteFor("classic", { backgroundColor: "#111111" });
    expect(p.bg).toBe("#111111");
    expect(p.text).toBe("#ffffff");
    expect(coverPaletteFor("classic", { backgroundColor: "#fafafa" }).text).toBe("#1c1917");
  });
});
