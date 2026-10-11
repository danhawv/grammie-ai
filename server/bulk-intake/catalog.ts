import { GoogleGenerativeAI } from "@google/generative-ai";
import { modelFor, generationConfigFor, AI_CALL_TIMEOUT_MS, type AIJob } from "../ai-models";
import { parseModelJson } from "../lib/model-json";
import { fourWays } from "../lib/card-orientation";
import { sanitizeCatalog, sanitizePairs, type PairCandidate, type PhotoCatalog } from "@shared/bulk-intake";

// The cheap first look at each photo in a bulk intake (docs/BULK_IMPORT.md).
// One call per photo answers both "which way up?" and "what is this?": the
// photo is shown turned four ways (the trick from card-orientation.ts, which
// a model gets right far more often than "how many degrees?"), and the model
// reads the upright panel. Panels are 448px, so a call is ~1.1k tokens.

/** Gemini list prices, US dollars per million tokens (October 2026) */
const PRICES: Record<string, { input: number; output: number }> = {
  "gemini-2.5-flash-lite": { input: 0.1, output: 0.4 },
  "gemini-3.1-flash-lite": { input: 0.25, output: 1.5 },
  "gemini-3.5-flash-lite": { input: 0.3, output: 2.5 },
  "gemini-2.5-flash": { input: 0.3, output: 2.5 },
  "gemini-3.6-flash": { input: 0.75, output: 3.75 },
};

export interface CallUsage {
  model: string;
  inputTokens: number;
  outputTokens: number;
  /** Millionths of a dollar */
  costMicros: number;
}

function usageOf(model: string, meta: any): CallUsage {
  const inputTokens = Number(meta?.promptTokenCount) || 0;
  // Thinking tokens bill as output
  const outputTokens = (Number(meta?.candidatesTokenCount) || 0) + (Number(meta?.thoughtsTokenCount) || 0);
  const price = PRICES[model] ?? PRICES["gemini-3.6-flash"];
  return { model, inputTokens, outputTokens, costMicros: Math.round(inputTokens * price.input + outputTokens * price.output) };
}

function modelForJob(job: AIJob, json = true) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY is not set");
  const choice = modelFor(job);
  const model = new GoogleGenerativeAI(key).getGenerativeModel(
    { model: choice.model, generationConfig: { ...generationConfigFor(choice, json), temperature: 0 } as any },
    { timeout: AI_CALL_TIMEOUT_MS.vision },
  );
  return { model, name: choice.model };
}

const CATALOG_PROMPT = `These four numbered panels show the SAME photo turned four different ways. It is a photo from a family's pile of recipes (index cards, note paper, clippings), or sometimes a photo of food or something else.

1. Pick the panel where the writing reads normally, left to right with lines going down. Look at the letters, not the shape of the card.
2. Read that panel and describe the photo.

Reply with JSON only:
{
 "panel": 1-4 (0 if there is no writing),
 "kind": "recipe" | "dish_photo" | "blank" | "other",
 "title": "the recipe name as written, or \\"\\" if there is none",
 "side": "front" | "back",
 "continues": true | false,
 "has_directions": true | false,
 "recipe_count": number,
 "first_line": "the first ingredient or first line after the title",
 "last_line": "the last few words written",
 "paper": "a few words: paper type, lines, color, ink, e.g. white lined index card, blue ink",
 "cut_off": true | false,
 "hard_to_read": true | false
}

- "side" is "back" when this is the second side or second page of a recipe: no title at the top, it starts mid-recipe (often just directions), or it says "continued" or "back". A card with its own title is a "front", even if it is short.
- "continues" is true when it says "over", "(over)", "cont.", "see back", "PTO" or an arrow to the back, or the text clearly stops mid-sentence or mid-list at the bottom. "Over" as a cooking word ("pour sauce over", "spoon over rice") does not count.
- "has_directions": false when it lists ingredients but no cooking steps.
- "kind": "dish_photo" for a photo of food; "blank" for an empty card or page; "other" for anything else that isn't a recipe (a letter, a menu, a blurry photo).
- "cut_off": part of the writing runs off the edge of the photo.
Copy words exactly as written; don't fix spelling. Don't guess words you can't read.`;

export interface CatalogResult {
  catalog: PhotoCatalog;
  usage: CallUsage;
}

export async function catalogPhoto(image: Buffer): Promise<CatalogResult> {
  const { model, name } = modelForJob("bulkCatalog");
  const strip = await fourWays(image);
  const result = await model.generateContent([
    CATALOG_PROMPT,
    { inlineData: { data: strip.toString("base64"), mimeType: "image/jpeg" } },
  ]);
  const usage = usageOf(name, result.response.usageMetadata);
  const catalog = sanitizeCatalog(parseModelJson(result.response.text()));
  if (!catalog) throw new Error("The first look gave an answer we couldn't use");
  return { catalog, usage };
}

const PAIRING_PROMPT = `A family photographed a pile of recipe cards. Some recipes are written on two sides, so the back was photographed separately. Below are notes about FRONTS that might continue on a back, and about BACKS (photos that look like the second side of a card).

Match each back to the front it continues, using:
- what the front's last words say (e.g. "(over)", "subs over", "serve with -> over") and what the back is about
- the back's first line continuing the front's last line
- the same paper and ink
- photo order (numbers close together were taken close together), though the order may be random

Sometimes a front names a separate titled card as its back instead (e.g. last words "b'milk, sour cr. subs over" and a card titled "Buttermilk"). OTHER_CARDS lists the titled cards; use one only when the front's last words clearly name it.

Only match when you are fairly sure. Leave a back unmatched if no front fits. Each front gets at most one back.
Reply with JSON only: {"pairs": [{"front": "id", "back": "id"}]}`;

/**
 * Matches card backs to their fronts from the first-look notes (text only,
 * so it's cheap: one call per pile). Returns back id -> front id.
 */
export async function pairBacksWithAI(
  fronts: PairCandidate[],
  backs: PairCandidate[],
  others: PairCandidate[] = [],
): Promise<{ pairs: Map<string, string>; usage: CallUsage | null }> {
  if (!fronts.length || (!backs.length && !others.length)) return { pairs: new Map(), usage: null };
  const note = (p: PairCandidate) => ({
    id: p.id,
    order: p.seq,
    title: p.catalog.title,
    first_line: p.catalog.firstLine,
    last_words: p.catalog.lastLine,
    paper: p.catalog.paper,
    ...(p.catalog.side === "front" ? { says_continues: p.catalog.continues, has_directions: p.catalog.hasDirections } : {}),
  });
  const { model, name } = modelForJob("bulkPairing");
  const other = (p: PairCandidate) => ({ id: p.id, order: p.seq, title: p.catalog.title, first_line: p.catalog.firstLine });
  const input = JSON.stringify({ FRONTS: fronts.map(note), BACKS: backs.map(note), OTHER_CARDS: others.map(other) });
  const result = await model.generateContent([PAIRING_PROMPT, input]);
  const usage = usageOf(name, result.response.usageMetadata);
  const pairs = sanitizePairs(parseModelJson(result.response.text()), new Set(fronts.map((f) => f.id)), new Set([...backs, ...others].map((b) => b.id)));
  return { pairs, usage };
}
