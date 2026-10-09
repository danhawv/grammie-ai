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

async function fourWays(image: Buffer): Promise<Buffer> {
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
