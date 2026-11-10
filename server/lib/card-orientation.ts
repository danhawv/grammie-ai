import sharp from "sharp";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { modelFor, generationConfigFor, AI_CALL_TIMEOUT_MS } from "../ai-models";
import { parseModelJson } from "./model-json";

// Is a recipe-card photo sideways or upside down? Asking a model "how much
// should this be rotated" is unreliable (it mixes up 90 and 270), so we show
// it the card turned all four ways, side by side, and ask which one reads
// normally. Picking the readable one is easy for a vision model.

export type CardRotation = 0 | 90 | 180 | 270;

const ROTATIONS: CardRotation[] = [0, 90, 180, 270];
const PANEL = 448;

/** The photo turned 0/90/180/270°, side by side and numbered 1-4 (also used by the bulk intake first look) */
export async function fourWays(image: Buffer): Promise<Buffer> {
  const base = await sharp(image).rotate().resize(PANEL, PANEL, { fit: "inside" }).toBuffer();
  const panels = await Promise.all(ROTATIONS.map(async (deg, i) => {
    const turned = await sharp(base).rotate(deg).resize(PANEL, PANEL, { fit: "contain", background: "#ffffff" }).toBuffer();
    const label = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${PANEL}" height="${PANEL + 56}">
      <rect width="100%" height="56" fill="#222"/>
      <text x="${PANEL / 2}" y="42" font-size="40" font-family="Arial" font-weight="bold" fill="#fff" text-anchor="middle">${i + 1}</text></svg>`);
    return sharp(label).composite([{ input: turned, top: 56, left: 0 }]).png().toBuffer();
  }));
  const gap = 16;
  return sharp({ create: { width: PANEL * 4 + gap * 3, height: PANEL + 56, channels: 3, background: "#ffffff" } })
    .composite(panels.map((input, i) => ({ input, top: 0, left: i * (PANEL + gap) })))
    .jpeg({ quality: 80 })
    .toBuffer();
}

/**
 * Clockwise degrees that make the card upright (0 = already upright), or
 * null if the model couldn't tell (no writing, a photo, or an error).
 */
export async function detectCardRotation(image: Buffer): Promise<CardRotation | null> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  const choice = modelFor("vision");
  const model = new GoogleGenerativeAI(key).getGenerativeModel(
    { model: choice.model, generationConfig: generationConfigFor(choice) as any },
    { timeout: AI_CALL_TIMEOUT_MS.vision },
  );
  const grid = await fourWays(image);
  const prompt = `These four panels are the same photo of a recipe card, turned four different ways.
In which panel is the writing upright, so it reads normally left to right with lines going down the page?
Look at the letters themselves, not the shape of the card. Reply with JSON only: {"panel": 1-4, "sure": true|false}.
If there is no readable writing, reply {"panel": 0, "sure": false}.`;
  const result = await model.generateContent([
    prompt,
    { inlineData: { data: grid.toString("base64"), mimeType: "image/jpeg" } },
  ]);
  const parsed = parseModelJson(result.response.text()) as { panel?: number; sure?: boolean } | null;
  const panel = Number(parsed?.panel);
  if (!(panel >= 1 && panel <= 4) || parsed?.sure === false) return null;
  return ROTATIONS[panel - 1];
}

/** Turns an image clockwise and returns a JPEG data URL (phone orientation flags applied first) */
export async function rotateImageDataUrl(dataUrl: string, degrees: CardRotation): Promise<string> {
  const m = dataUrl.match(/^data:image\/[\w.+-]+;base64,(.+)$/);
  if (!m) throw new Error("Not an image");
  const out = await sharp(Buffer.from(m[1], "base64")).rotate().rotate(degrees).jpeg({ quality: 90, mozjpeg: true }).toBuffer();
  return `data:image/jpeg;base64,${out.toString("base64")}`;
}

type CardImageFields = {
  handwrittenImage: string | null;
  dishImage: string | null;
  dishImageThumbnail: string | null;
  dishImages: Array<{ id: string; url: string; thumbnailUrl?: string; isAiGenerated: boolean; order: number; createdAt: string }> | null;
};

const isDataImage = (s: string | null | undefined): s is string => !!s && /^data:image\//.test(s);

/**
 * The recipe's image fields after turning its card: the card itself, the
 * card's copy in dishImages (the entry that shows the same picture, or, for
 * cards turned before the copy was kept in step, the first entry that isn't
 * an AI photo, which is where uploads put the card), and the dish photo plus
 * its thumbnail while they still show the card. Returns null when there is
 * no card.
 */
export async function rotateCardImages(fields: CardImageFields, degrees: CardRotation): Promise<Partial<CardImageFields> | null> {
  const card = fields.handwrittenImage;
  if (!isDataImage(card)) return null;
  const out: Partial<CardImageFields> = { handwrittenImage: await rotateImageDataUrl(card, degrees) };

  const list = [...(fields.dishImages ?? [])].sort((a, b) => a.order - b.order);
  let cardEntries = list.filter((img) => !img.isAiGenerated && img.url === card);
  if (cardEntries.length === 0) {
    const first = list.find((img) => !img.isAiGenerated);
    if (first) cardEntries = [first];
  }
  if (cardEntries.length > 0) {
    const turned = new Map<string, { url: string; thumbnailUrl?: string }>();
    for (const img of cardEntries) {
      turned.set(img.id, {
        url: isDataImage(img.url) ? await rotateImageDataUrl(img.url, degrees) : img.url,
        thumbnailUrl: isDataImage(img.thumbnailUrl) ? await rotateImageDataUrl(img.thumbnailUrl, degrees) : img.thumbnailUrl,
      });
    }
    out.dishImages = (fields.dishImages ?? []).map((img) => (turned.has(img.id) ? { ...img, ...turned.get(img.id)! } : img));
  }

  const cardUrls = new Set([card, ...cardEntries.map((img) => img.url)]);
  if (fields.dishImage && cardUrls.has(fields.dishImage)) {
    out.dishImage = isDataImage(fields.dishImage) ? await rotateImageDataUrl(fields.dishImage, degrees) : fields.dishImage;
    if (isDataImage(fields.dishImageThumbnail)) out.dishImageThumbnail = await rotateImageDataUrl(fields.dishImageThumbnail, degrees);
  }
  return out;
}
