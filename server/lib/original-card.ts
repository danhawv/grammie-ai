import sharp from "sharp";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { recipes } from "@shared/schema";
import type { CookbookPrintData } from "./pdf/generator";

// The original handwritten card (recipes.handwritten_image) for print pages
// that show it beside the dish photo (the Heirloom template, or any custom
// template whose layout sets `original`). Stored cards are multi-MB phone
// photos, so they're read one at a time and shrunk: ~1500px for the PDF
// (about 300 DPI at the size the card prints), smaller for the preview.

const cache = new Map<string, Buffer | null>();
const CACHE_LIMIT = 120;

export async function originalCardJpeg(recipeId: string, maxPx: number): Promise<Buffer | null> {
  const key = `${recipeId}:${maxPx}`;
  if (cache.has(key)) return cache.get(key)!;

  const [row] = await db.select({ img: recipes.handwrittenImage }).from(recipes).where(eq(recipes.id, recipeId));
  let out: Buffer | null = null;
  const match = row?.img?.match(/^data:image\/[\w.+-]+;base64,(.+)$/);
  if (match) {
    try {
      out = await sharp(Buffer.from(match[1], "base64"))
        .rotate() // honor the phone's orientation flag
        .resize(maxPx, maxPx, { fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 82, mozjpeg: true })
        .toBuffer();
    } catch (err: any) {
      console.warn(`[Original card] Couldn't read the card for ${recipeId}: ${err?.message}`);
    }
  }

  if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value!);
  cache.set(key, out);
  return out;
}

/** Whether the book's recipe layout shows original cards */
export function layoutShowsOriginals(data: Pick<CookbookPrintData, "templateId" | "customTemplateData">): boolean {
  const custom = (data.customTemplateData as any)?.layout?.original;
  if (data.customTemplateData) return !!custom && custom !== "none";
  return data.templateId === "heirloom";
}

/** Adds originalImageUrl to each recipe that has a card, when the layout shows them */
export async function attachOriginalCards(data: CookbookPrintData): Promise<number> {
  if (!layoutShowsOriginals(data)) return 0;
  let attached = 0;
  for (const r of data.recipes) {
    const jpeg = await originalCardJpeg(r.data.id, 1500);
    if (jpeg) {
      r.data.originalImageUrl = `data:image/jpeg;base64,${jpeg.toString("base64")}`;
      attached++;
    }
  }
  return attached;
}
