import sharp from "sharp";
import crypto from "crypto";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { recipes } from "@shared/schema";
import type { CookbookPrintData } from "./pdf/generator";
import { detectCardRotation, rotateImageDataUrl, type CardRotation } from "./card-orientation";

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

/** Drops cached copies after the card changes (rotated or replaced) */
export function forgetOriginalCard(recipeId: string): void {
  Array.from(cache.keys()).forEach((k) => { if (k.startsWith(`${recipeId}:`)) cache.delete(k); });
}

/** Turns a recipe's original card clockwise and saves it */
export async function rotateOriginalCard(recipeId: string, degrees: CardRotation): Promise<boolean> {
  const [row] = await db.select({ img: recipes.handwrittenImage }).from(recipes).where(eq(recipes.id, recipeId));
  if (!row?.img) return false;
  const turned = await rotateImageDataUrl(row.img, degrees);
  await db.update(recipes).set({ handwrittenImage: turned }).where(eq(recipes.id, recipeId));
  forgetOriginalCard(recipeId);
  return true;
}

// Orientation answers per card image (keyed by a hash, so a rotated or
// replaced card is checked again)
const orientation = new Map<string, CardRotation | null>();

async function cardRotation(recipeId: string): Promise<CardRotation | null> {
  const [row] = await db.select({ img: recipes.handwrittenImage }).from(recipes).where(eq(recipes.id, recipeId));
  const m = row?.img?.match(/^data:image\/[\w.+-]+;base64,(.+)$/);
  if (!m) return null;
  const key = crypto.createHash("sha1").update(m[1]).digest("hex");
  if (orientation.has(key)) return orientation.get(key)!;
  const small = await sharp(Buffer.from(m[1], "base64")).rotate().resize(900, 900, { fit: "inside" }).jpeg({ quality: 80 }).toBuffer();
  const rotation = await detectCardRotation(small);
  if (orientation.size > 5000) orientation.clear();
  orientation.set(key, rotation);
  return rotation;
}

/**
 * Cards that look sideways or upside down, with the turn that fixes each.
 * Runs a few at a time; a card the model can't judge is left alone.
 */
export async function findSidewaysCards(recipeIds: string[]): Promise<{ recipeId: string; rotate: CardRotation }[]> {
  const out: { recipeId: string; rotate: CardRotation }[] = [];
  const queue = [...recipeIds];
  const worker = async () => {
    for (let id = queue.shift(); id; id = queue.shift()) {
      try {
        const r = await cardRotation(id);
        if (r) out.push({ recipeId: id, rotate: r });
      } catch (err: any) {
        console.warn(`[Original card] Couldn't check orientation for ${id}: ${err?.message}`);
      }
    }
  };
  await Promise.all(Array.from({ length: 8 }, worker));
  return out;
}

/**
 * After a card is uploaded: if it's clearly sideways or upside down, turn
 * it upright. Runs beside extraction and never holds up the import.
 */
export function straightenNewCard(recipeId: string): void {
  cardRotation(recipeId)
    .then(async (r) => {
      if (!r) return;
      await rotateOriginalCard(recipeId, r);
      console.log(`[Original card] Turned the card for ${recipeId} ${r}° upright`);
    })
    .catch((err) => console.warn(`[Original card] Orientation check skipped for ${recipeId}: ${err?.message}`));
}
