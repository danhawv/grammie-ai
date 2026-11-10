import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { rotateCardImages } from "./card-orientation";

// A small landscape image as a data URL, so a quarter turn is easy to spot
async function pngDataUrl(width: number, height: number, color: string): Promise<string> {
  const buf = await sharp({ create: { width, height, channels: 3, background: color } }).png().toBuffer();
  return `data:image/png;base64,${buf.toString("base64")}`;
}

async function size(dataUrl: string | undefined): Promise<string> {
  const m = dataUrl?.match(/^data:image\/[\w.+-]+;base64,(.+)$/);
  if (!m) throw new Error("not a data image");
  const meta = await sharp(Buffer.from(m[1], "base64")).metadata();
  return `${meta.width}x${meta.height}`;
}

describe("rotateCardImages", () => {
  it("turns the card, its dishImages copy and the dish photo together", async () => {
    const card = await pngDataUrl(60, 30, "#c33");
    const thumb = await pngDataUrl(20, 10, "#c33");
    const photo = await pngDataUrl(40, 40, "#3c3");
    const out = await rotateCardImages(
      {
        handwrittenImage: card,
        dishImage: card,
        dishImageThumbnail: thumb,
        dishImages: [
          { id: "ai", url: photo, isAiGenerated: true, order: 1, createdAt: "" },
          { id: "card", url: card, thumbnailUrl: thumb, isAiGenerated: false, order: 0, createdAt: "" },
        ],
      },
      90,
    );
    expect(out).not.toBeNull();
    expect(await size(out!.handwrittenImage!)).toBe("30x60");
    expect(await size(out!.dishImage!)).toBe("30x60");
    expect(await size(out!.dishImageThumbnail!)).toBe("10x20");
    const entries = out!.dishImages!;
    expect(entries.map((e) => e.id)).toEqual(["ai", "card"]); // stored order kept
    expect(await size(entries[1].url)).toBe("30x60");
    expect(await size(entries[1].thumbnailUrl)).toBe("10x20");
    expect(entries[0].url).toBe(photo); // the AI photo is untouched
  });

  it("leaves the dish photo alone once it is no longer the card", async () => {
    const card = await pngDataUrl(60, 30, "#c33");
    const photo = await pngDataUrl(40, 40, "#3c3");
    const out = await rotateCardImages(
      {
        handwrittenImage: card,
        dishImage: photo,
        dishImageThumbnail: null,
        dishImages: [{ id: "card", url: card, isAiGenerated: false, order: 0, createdAt: "" }],
      },
      180,
    );
    expect(out!.dishImage).toBeUndefined();
    expect(await size(out!.dishImages![0].url)).toBe("60x30");
    expect(out!.dishImages![0].url).not.toBe(card);
  });

  it("falls back to the first non-AI entry for cards turned before copies were kept in step", async () => {
    const card = await pngDataUrl(60, 30, "#c33");
    const olderCopy = await pngDataUrl(30, 60, "#c33");
    const out = await rotateCardImages(
      {
        handwrittenImage: card,
        dishImage: null,
        dishImageThumbnail: null,
        dishImages: [{ id: "copy", url: olderCopy, isAiGenerated: false, order: 0, createdAt: "" }],
      },
      90,
    );
    expect(await size(out!.dishImages![0].url)).toBe("60x30");
  });

  it("returns null when there is no card", async () => {
    expect(await rotateCardImages({ handwrittenImage: null, dishImage: null, dishImageThumbnail: null, dishImages: [] }, 90)).toBeNull();
  });
});
