// AI fallback for ingredient names the matcher can't place confidently
// ("t'loin", "simba mbili spice mix"). The model only picks from a shortlist
// of canonical ingredients we give it (or says none); it never invents an
// ingredient or a number, and we check its answer is on the list.

import { GoogleGenerativeAI } from "@google/generative-ai";
import { AI_CALL_TIMEOUT_MS, generationConfigFor, modelFor } from "../../ai-models";

export interface PickRequest {
  item: string;
  /** an example line it came from, for context ("12 oz. t'loin, sliced into bite-size") */
  example?: string;
  candidates: Array<{ id: string; name: string }>;
}

export interface Pick { item: string; id: string | null }

const PROMPT = `You match recipe ingredient names to a grocery catalog.
For each item, choose the ONE candidate id that is the same food (or a close
nutritional stand-in, e.g. a brand name for the generic food, or a regional
name). Answer "none" if no candidate is the same kind of food, or if the item
is not food (equipment, "toppings", "dry ingredients").
Return JSON: {"picks":[{"n":<item number>,"id":"<candidate id or none>"}]}`;

export async function pickIngredientsWithAI(requests: PickRequest[], apiKey = process.env.GEMINI_API_KEY): Promise<Pick[]> {
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set");
  const choice = modelFor("ingredientMatch");
  const model = new GoogleGenerativeAI(apiKey).getGenerativeModel(
    { model: choice.model, generationConfig: generationConfigFor(choice) as any },
    { timeout: AI_CALL_TIMEOUT_MS.text },
  );
  const body = requests.map((r, i) =>
    `${i + 1}. "${r.item}"${r.example ? ` (from: "${r.example}")` : ""}\n   candidates: ${r.candidates.map((c) => `${c.id} (${c.name})`).join("; ")}`,
  ).join("\n");
  const result = await model.generateContent(`${PROMPT}\n\n${body}`);
  const parsed = JSON.parse(result.response.text());
  const picks = new Map<number, string>();
  for (const p of parsed?.picks ?? []) if (typeof p?.n === "number" && typeof p?.id === "string") picks.set(p.n, p.id);
  return requests.map((r, i) => {
    const id = picks.get(i + 1);
    // Only ids we offered count; anything else is treated as no match
    return { item: r.item, id: id && r.candidates.some((c) => c.id === id) ? id : null };
  });
}
