import { GoogleGenerativeAI } from "@google/generative-ai";
import type { Recipe } from "@shared/schema";
import { modelFor, AI_CALL_TIMEOUT_MS } from "../ai-models";

// "Remake this photo": a dish photo drawn from the whole recipe, not just its
// title. The automatic photo only knows the name and a few tags, so odd or
// family-specific dishes (a chilled cream soup, lamb with a horseradish
// sauce) sometimes come out as something else. Here the model sees the
// ingredients with amounts and the finishing steps, and is told not to add
// anything the recipe doesn't have. Always uses the best photo model, since
// someone is waiting on it and asked for accuracy.

const MAX_INGREDIENTS = 30;
const MAX_FINISHING_STEPS = 4;
const MAX_LINE = 160;

const clip = (s: string) => (s.length > MAX_LINE ? `${s.slice(0, MAX_LINE - 1)}…` : s);

type PromptRecipe = Pick<
  Recipe,
  "title" | "description" | "ingredients" | "instructions" | "mealType" | "cuisines" | "servingSuggestions"
>;

/** The full-recipe photo prompt (also shown, editable, in Manage Images) */
export function buildFullRecipePhotoPrompt(recipe: PromptRecipe): string {
  const ingredients = (recipe.ingredients || []).map((i) => i.trim()).filter(Boolean);
  const steps = (recipe.instructions || []).map((s) => s.trim()).filter(Boolean);
  // The last steps say how it's finished and served, which is what the photo shows
  const finishing = steps.slice(-MAX_FINISHING_STEPS);
  const meal = recipe.mealType?.[0]?.toLowerCase();
  const cuisine = recipe.cuisines?.length ? recipe.cuisines.join(" and ") : "";

  const lines = [
    `A professional food photograph of "${recipe.title}"${cuisine ? ` (${cuisine})` : ""}${meal ? `, a ${meal}` : ""}, finished and ready to eat, exactly as this recipe makes it.`,
  ];
  if (recipe.description?.trim()) lines.push(`About the dish: ${clip(recipe.description.trim())}`);
  if (ingredients.length) {
    lines.push("", "Ingredients:", ...ingredients.slice(0, MAX_INGREDIENTS).map((i) => `- ${clip(i)}`));
    if (ingredients.length > MAX_INGREDIENTS) lines.push(`- and ${ingredients.length - MAX_INGREDIENTS} more`);
  }
  if (finishing.length) {
    lines.push("", steps.length > finishing.length ? "How it is finished:" : "Method:", ...finishing.map((s) => `- ${clip(s)}`));
  }
  if (recipe.servingSuggestions?.length) lines.push("", `Served: ${clip(recipe.servingSuggestions[0])}`);
  lines.push(
    "",
    "Show the dish's real colour, texture and form as these ingredients and steps would produce it (for example a smooth cream soup stays smooth and pale; a casserole is shown baked in its dish).",
    "Only show ingredients and garnishes from the recipe. Do not add herbs, nuts, sauces or sides it doesn't mention.",
    "Make this dish the clear subject. Leave out other dishes it only \"pairs well with\"; show an accompaniment only if the recipe says to serve it with one.",
    "Home-style plating on appropriate dinnerware, on a rustic wooden table with soft natural window light, shallow depth of field, warm appetizing colours. Photorealistic. No text, labels, hands, raw ingredients or cooking process.",
  );
  return lines.join("\n");
}

export interface DishPhoto {
  /** data URL of the image */
  dataUrl: string;
  model: string;
}

/** Generates a dish photo from a prompt with the main photo model, falling back to the backup if it's busy */
export async function generateDishPhoto(prompt: string): Promise<DishPhoto> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("Gemini API not configured");
  const ai = new GoogleGenerativeAI(key);
  const request = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: { responseModalities: ["TEXT", "IMAGE"] } as any,
  };

  const attempt = async (model: string) => {
    const result = await ai.getGenerativeModel({ model }, { timeout: AI_CALL_TIMEOUT_MS.image }).generateContent(request);
    const image = result.response.candidates?.[0]?.content?.parts?.find((p: any) => p.inlineData)?.inlineData;
    if (!image?.data) throw new Error("The photo model didn't return a picture");
    return { dataUrl: `data:${image.mimeType || "image/png"};base64,${image.data}`, model };
  };

  const main = modelFor("dishImage").model;
  try {
    return await attempt(main);
  } catch (err: any) {
    if (!/\b(429|500|502|503|504)\b|abort|timed? ?out/i.test(String(err?.message))) throw err;
    return attempt(modelFor("dishImageBackup").model);
  }
}

type DishImage = NonNullable<Recipe["dishImages"]>[number];

/**
 * Puts a new photo first and keeps the earlier ones so people can switch
 * back. When that's more than `max`, the oldest AI photo goes; a family's
 * own uploaded photos are never dropped to make room.
 */
export function withNewPrimaryPhoto(existing: DishImage[], added: DishImage, max = 5): DishImage[] {
  const list = [added, ...existing];
  while (list.length > max) {
    let drop = -1;
    for (let i = list.length - 1; i > 0; i--) {
      if (list[i].isAiGenerated) { drop = i; break; }
    }
    if (drop === -1) break;
    list.splice(drop, 1);
  }
  return list.map((img, order) => ({ ...img, order }));
}
