// Gemini calls for meal prep. Both return the model's raw JSON; wishes.ts
// and explain.ts validate it, so a bad answer degrades to "no wishes" or the
// plain explanation instead of reaching the plan.

import { GoogleGenerativeAI } from "@google/generative-ai";
import { AI_CALL_TIMEOUT_MS, generationConfigFor, modelFor, type AIJob } from "../ai-models";
import { parseModelJson } from "../lib/model-json";
import { buildWishesPrompt, type WishRecipe } from "./wishes";
import { buildExplainPrompt, type ExplainInput } from "./explain";

export interface MealPrepAI {
  /** raw answer: expected {more, less, never} of recipe ids */
  wishes(wishes: string, recipes: WishRecipe[]): Promise<unknown>;
  /** raw answer: expected {text} */
  explain(input: ExplainInput): Promise<unknown>;
}

/** Wording is a nicety; don't hold the plan up for it */
const WORDING_TIMEOUT_MS = 15_000;

async function askJson(apiKey: string, job: AIJob, prompt: string): Promise<unknown> {
  const choice = modelFor(job);
  const model = new GoogleGenerativeAI(apiKey).getGenerativeModel(
    { model: choice.model, generationConfig: generationConfigFor(choice) },
    { timeout: Math.min(WORDING_TIMEOUT_MS, AI_CALL_TIMEOUT_MS.text) },
  );
  const result = await model.generateContent(prompt);
  return parseModelJson(result.response.text());
}

/** null when GEMINI_API_KEY isn't set: wishes are skipped and explanations are plain */
export function createGeminiMealPrepAI(apiKey = process.env.GEMINI_API_KEY): MealPrepAI | null {
  if (!apiKey) return null;
  return {
    wishes: (wishes, recipes) => askJson(apiKey, "prepWishes", buildWishesPrompt(wishes, recipes)),
    explain: async input => {
      const raw = await askJson(apiKey, "prepExplain", buildExplainPrompt(input));
      return raw && typeof raw === "object" ? (raw as { text?: unknown }).text : raw;
    },
  };
}
