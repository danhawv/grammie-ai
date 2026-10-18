// The one AI call for ingredient swaps: a recipe's lines and its own
// suggestions -> swap proposals (server/meal-prep/food/swaps.ts checks them
// and works out every number).

import { GoogleGenerativeAI, SchemaType, type ResponseSchema } from "@google/generative-ai";
import { AI_CALL_TIMEOUT_MS, generationConfigFor, modelFor } from "../../ai-models";
import { parseModelJson } from "../../lib/model-json";
import { readProposals, SWAPS_PROMPT, swapPromptText, type SwapPromptRecipe, type SwapProposal } from "./swaps";

/** Gemini list prices, US dollars per million tokens (October 2026; same table as session/structure-ai.ts) */
const PRICES: Record<string, { input: number; output: number }> = {
  "gemini-2.5-flash-lite": { input: 0.1, output: 0.4 },
  "gemini-3.1-flash-lite": { input: 0.25, output: 1.5 },
  "gemini-3.5-flash-lite": { input: 0.3, output: 2.5 },
  "gemini-3.6-flash": { input: 0.75, output: 3.75 },
};

export function costMicros(model: string, meta: any): number {
  const input = Number(meta?.promptTokenCount) || 0;
  const output = (Number(meta?.candidatesTokenCount) || 0) + (Number(meta?.thoughtsTokenCount) || 0); // thinking bills as output
  const price = PRICES[model] ?? PRICES["gemini-3.6-flash"];
  return Math.round(input * price.input + output * price.output);
}

const SWAPS_SCHEMA: ResponseSchema = {
  type: SchemaType.OBJECT,
  properties: {
    swaps: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          source: { type: SchemaType.STRING, format: "enum", enum: ["recipe_suggestion", "standard"] },
          changes: {
            type: SchemaType.ARRAY,
            items: {
              type: SchemaType.OBJECT,
              properties: {
                line: { type: SchemaType.INTEGER },
                replacement: { type: SchemaType.STRING },
                amount: { type: SchemaType.STRING },
              },
              required: ["line", "replacement", "amount"],
            },
          },
        },
        required: ["source", "changes"],
      },
    },
  },
  required: ["swaps"],
};

export interface SwapAnswer {
  proposals: SwapProposal[];
  model: string;
  costMicros: number;
  tokens: { input: number; output: number };
}

export type ProposeSwaps = (recipe: SwapPromptRecipe) => Promise<SwapAnswer>;

/** Asks Gemini for swap proposals. Throws when Gemini isn't set up or the call fails. */
export const proposeSwapsWithGemini: ProposeSwaps = async (recipe) => {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY is not set");
  const choice = modelFor("prepSwaps");
  const model = new GoogleGenerativeAI(key).getGenerativeModel(
    { model: choice.model, generationConfig: { ...generationConfigFor(choice), responseSchema: SWAPS_SCHEMA, temperature: 0 } as any },
    { timeout: AI_CALL_TIMEOUT_MS.text },
  );
  const result = await model.generateContent([SWAPS_PROMPT, swapPromptText(recipe)]);
  const meta = result.response.usageMetadata as any;
  return {
    proposals: readProposals(parseModelJson(result.response.text())),
    model: choice.model,
    costMicros: costMicros(choice.model, meta),
    tokens: { input: Number(meta?.promptTokenCount) || 0, output: (Number(meta?.candidatesTokenCount) || 0) + (Number(meta?.thoughtsTokenCount) || 0) },
  };
};
