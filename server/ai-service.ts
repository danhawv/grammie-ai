/**
 * Unified AI Service - Routes to OpenAI or Gemini based on configuration
 * 
 * Toggle via AI_PROVIDER environment variable:
 * - "openai" (default): Uses Replit AI Integrations OpenAI
 * - "gemini": Uses Google Gemini API
 */

import { generateDishImage as generateImageOpenAI } from "./openai";
import { 
  extractRecipeFromImageWithGemini,
  extractRecipeFromMultipleImagesWithGemini,
  enrichRecipeWithGemini, 
  generateRecipeImageWithGemini,
  extractRecipeFromSocialPostWithGemini,
  generateRecipeVariationWithGemini,
  isGeminiAvailable,
  type SocialRecipeExtractionResult,
  type RecipeVariationRequest,
  type RecipeVariationResult
} from "./gemini";
import { 
  extractRecipeFromImage as extractWithOpenAI,
  enrichRecipeData as enrichWithOpenAI,
  enrichedRecipeDataSchema,
  type ExtractedRecipeRaw, 
  type EnrichedRecipeData
} from "./enrichment";
import {
  deriveAllergenFreeTags,
  deriveTimeConvenienceTags,
  deriveGroceryAisleTags,
  deriveLegacyCuisine,
  deriveLegacyEquipment,
  deriveNutritionFlags,
} from "@shared/schema";

export type AIProvider = "openai" | "gemini";

// Runtime provider override (null = use environment variable)
let runtimeProviderOverride: AIProvider | null = null;

// Set provider at runtime (admin toggle)
export function setProvider(provider: AIProvider): void {
  runtimeProviderOverride = provider;
  console.log(`[AI Service] Provider set to: ${provider.toUpperCase()}`);
}

// Clear runtime override (use env var)
export function clearProviderOverride(): void {
  runtimeProviderOverride = null;
  console.log(`[AI Service] Provider override cleared, using env var`);
}

// Get current AI provider (runtime override takes precedence over env var)
export function getCurrentProvider(): AIProvider {
  // Runtime override takes precedence
  if (runtimeProviderOverride) {
    return runtimeProviderOverride;
  }
  
  // Fall back to environment variable
  const provider = process.env.AI_PROVIDER?.toLowerCase();
  if (provider === "openai") {
    return "openai";
  }
  return "gemini"; // Default to Gemini
}

// Check if there's a runtime override active
export function hasRuntimeOverride(): boolean {
  return runtimeProviderOverride !== null;
}

// Check if the current provider is available
export function isProviderAvailable(provider?: AIProvider): boolean {
  const p = provider || getCurrentProvider();
  if (p === "gemini") {
    return isGeminiAvailable();
  }
  // OpenAI via Replit AI Integrations
  return !!(process.env.AI_INTEGRATIONS_OPENAI_BASE_URL && process.env.AI_INTEGRATIONS_OPENAI_API_KEY);
}

// Get provider info for admin display
export function getProviderInfo(): {
  current: AIProvider;
  openaiAvailable: boolean;
  geminiAvailable: boolean;
} {
  return {
    current: getCurrentProvider(),
    openaiAvailable: !!(process.env.AI_INTEGRATIONS_OPENAI_BASE_URL && process.env.AI_INTEGRATIONS_OPENAI_API_KEY),
    geminiAvailable: isGeminiAvailable(),
  };
}

// ============ Vision Extraction (Phase 1) ============

export async function extractRecipeFromImageUnified(
  imageBase64: string,
  mimeType?: string
): Promise<ExtractedRecipeRaw> {
  const provider = getCurrentProvider();
  console.log(`[AI Service] Vision extraction using: ${provider.toUpperCase()}`);
  
  if (provider === "gemini") {
    if (!isGeminiAvailable()) {
      throw new Error("Gemini API not configured");
    }
    return extractRecipeFromImageWithGemini(imageBase64, mimeType);
  }
  
  // OpenAI - use enrichment.ts's extractRecipeFromImage which includes
  // normalization, cleaning, and fallback metadata handling
  return extractWithOpenAI(imageBase64);
}

// ============ Multi-Image Vision Extraction ============

export async function extractRecipeFromMultipleImagesUnified(
  imagesBase64: string[]
): Promise<ExtractedRecipeRaw> {
  const provider = getCurrentProvider();
  console.log(`[AI Service] Multi-image extraction using: ${provider.toUpperCase()} (${imagesBase64.length} images)`);
  
  if (provider === "gemini") {
    if (!isGeminiAvailable()) {
      throw new Error("Gemini API not configured");
    }
    return extractRecipeFromMultipleImagesWithGemini(imagesBase64);
  }
  
  // OpenAI fallback - use enrichment.ts's extractRecipeFromMultipleImages
  const { extractRecipeFromMultipleImages } = await import('./enrichment');
  return extractRecipeFromMultipleImages(imagesBase64);
}

// ============ Social Media Caption Extraction ============

export interface ExtractedSocialRecipeData {
  title: string;
  description: string;
  rawIngredients: string[];
  rawInstructions: string[];
  servings?: number;
  prepTimeMinutes?: number;
  cookTimeMinutes?: number;
  totalTimeMinutes?: number;
  cuisineType?: string;
  mealType?: string;
  difficulty?: string;
  dietaryTags?: string[];
  nutritionInfo?: {
    calories?: number;
    protein?: number;
    carbs?: number;
    fat?: number;
  };
  sourceUrl: string;
  sourceType: string;
  creatorUsername?: string;
  inferredFields?: string[];
}

export interface SocialPost {
  platform: string;
  id: string;
  caption: string;
  creatorUsername?: string;
  creatorDisplayName?: string;
  creatorAvatarUrl?: string;
  url: string;
  coverImageUrl?: string;
  postDate?: Date;
}

export async function extractRecipeFromSocialPostUnified(
  post: SocialPost
): Promise<ExtractedSocialRecipeData | null> {
  const provider = getCurrentProvider();
  const platformName = post.platform === "instagram" ? "Instagram" : "TikTok";
  
  console.log(`[AI Service] Social post extraction using: ${provider.toUpperCase()}`);
  const startTime = Date.now();
  
  try {
    if (provider === "gemini") {
      if (!isGeminiAvailable()) {
        throw new Error("Gemini API not configured");
      }
      
      const result = await extractRecipeFromSocialPostWithGemini(post.caption, platformName);
      
      if (!result || result.hasEnoughContext === false) {
        console.error(`[AI Service] No food/recipe content found in ${platformName} caption`);
        return null;
      }
      
      // Validate essential fields
      if (!result.title || !result.rawIngredients || result.rawIngredients.length === 0 ||
          !result.rawInstructions || result.rawInstructions.length === 0) {
        console.error(`[AI Service] Gemini could not complete recipe - essential fields missing`);
        return null;
      }
      
      const elapsed = Date.now() - startTime;
      console.log(`[AI Service] Gemini extracted "${result.title}" in ${elapsed}ms`);
      
      return {
        title: result.title,
        description: result.description || "",
        rawIngredients: result.rawIngredients,
        rawInstructions: result.rawInstructions,
        servings: result.servings,
        prepTimeMinutes: result.prepTimeMinutes,
        cookTimeMinutes: result.cookTimeMinutes,
        totalTimeMinutes: result.totalTimeMinutes,
        cuisineType: result.cuisineType,
        mealType: result.mealType,
        difficulty: result.difficulty,
        dietaryTags: result.dietaryTags || [],
        nutritionInfo: result.nutritionInfo,
        sourceUrl: post.url,
        sourceType: post.platform,
        creatorUsername: post.creatorUsername,
        inferredFields: result.inferredFields || [],
      };
    }
    
    // OpenAI path - use existing logic
    return await extractRecipeFromSocialPostWithOpenAI(post, platformName);
    
  } catch (error) {
    const elapsed = Date.now() - startTime;
    console.error(`[AI Service] Social post extraction failed after ${elapsed}ms:`, error);
    return null;
  }
}

async function extractRecipeFromSocialPostWithOpenAI(
  post: SocialPost,
  platformName: string
): Promise<ExtractedSocialRecipeData | null> {
  const OpenAI = (await import("openai")).default;
  const openai = new OpenAI({
    baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
    apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  });
  
  const systemPrompt = `You are an expert chef and recipe analyst who extracts and completes recipe information from ${platformName} post captions.

Your task is to extract recipe data AND fill in any missing components using your culinary expertise:

1. EXTRACT what's explicitly in the caption (ingredients, instructions, title, etc.)
2. INFER missing components based on what's available:
   - If title is missing: Generate a descriptive title from the ingredients/instructions
   - If ingredients are missing but instructions exist: Infer likely ingredients from the cooking steps
   - If instructions are missing but ingredients exist: Create logical cooking steps based on the ingredients
   - If both are partially available: Complete them based on culinary best practices

IMPORTANT: Always provide complete recipes. Never leave rawIngredients or rawInstructions empty if there's ANY food-related content.

Clean up promotional content like "Comment X and I'll DM you", "Link in bio", hashtag lists, or emoji spam.

Return a JSON object:
{
  "title": "Recipe title (always provide one)",
  "description": "Brief description of the dish",
  "rawIngredients": ["ingredient 1 with quantity", "ingredient 2 with quantity"],
  "rawInstructions": ["step 1", "step 2"],
  "servings": number or null,
  "prepTimeMinutes": number or null,
  "cookTimeMinutes": number or null,
  "totalTimeMinutes": number or null,
  "cuisineType": "type or null",
  "mealType": "breakfast/lunch/dinner/snack/dessert/appetizer/side dish/beverage/sauce/dip/marinade/rub or null",
  "difficulty": "easy/medium/hard or null",
  "dietaryTags": ["tag1", "tag2"],
  "nutritionInfo": {
    "calories": number or null,
    "protein": number or null,
    "carbs": number or null,
    "fat": number or null
  },
  "inferredFields": ["list of fields you had to infer/complete"],
  "hasEnoughContext": true or false (false only if caption has no food/recipe content at all)
}`;

  const startTime = Date.now();
  
  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: `Extract recipe information from this ${platformName} caption:\n\n${post.caption}` }
    ],
    response_format: { type: "json_object" },
    temperature: 0.3,
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    console.error(`[AI Service] No response from OpenAI`);
    return null;
  }

  const parsed = JSON.parse(content);
  const elapsed = Date.now() - startTime;
  
  // Check if AI determined there's not enough food-related content
  if (parsed.hasEnoughContext === false) {
    console.error(`[AI Service] OpenAI found no food/recipe content in caption`);
    return null;
  }
  
  // Log inferred fields
  if (parsed.inferredFields && parsed.inferredFields.length > 0) {
    console.log(`[AI Service] OpenAI inferred fields: ${parsed.inferredFields.join(", ")}`);
  }
  
  // Final validation
  if (!parsed.title || !parsed.rawIngredients || parsed.rawIngredients.length === 0 ||
      !parsed.rawInstructions || parsed.rawInstructions.length === 0) {
    console.error(`[AI Service] OpenAI could not complete recipe - essential fields missing`);
    return null;
  }

  console.log(`[AI Service] OpenAI extracted "${parsed.title}" in ${elapsed}ms`);
  
  return {
    title: parsed.title,
    description: parsed.description || "",
    rawIngredients: parsed.rawIngredients || [],
    rawInstructions: parsed.rawInstructions || [],
    servings: parsed.servings,
    prepTimeMinutes: parsed.prepTimeMinutes,
    cookTimeMinutes: parsed.cookTimeMinutes,
    totalTimeMinutes: parsed.totalTimeMinutes,
    cuisineType: parsed.cuisineType,
    mealType: parsed.mealType,
    difficulty: parsed.difficulty,
    dietaryTags: parsed.dietaryTags || [],
    nutritionInfo: parsed.nutritionInfo,
    sourceUrl: post.url,
    sourceType: post.platform,
    creatorUsername: post.creatorUsername,
    inferredFields: parsed.inferredFields || [],
  };
}

// ============ Instruction Generation (Pre-Enrichment) ============

export interface InstructionGenerationResult {
  instructions: string[];
  wasGenerated: boolean;
}

// Generate cooking instructions when missing or insufficient from source
export async function generateMissingInstructions(
  rawRecipe: ExtractedRecipeRaw,
  alreadyGenerated?: boolean
): Promise<InstructionGenerationResult> {
  // Skip if instructions were already AI-generated (prevent duplicate regeneration)
  if (alreadyGenerated) {
    console.log(`[AI Service] Instructions already generated, skipping`);
    return { instructions: rawRecipe.instructions || [], wasGenerated: false };
  }
  
  // Filter out empty/whitespace-only instructions
  const existingInstructions = rawRecipe.instructions || [];
  const validInstructions = existingInstructions
    .map(i => i.trim())
    .filter(i => i.length > 10); // Meaningful instructions only
  
  // Check if we have at least 2 valid instruction steps
  // Also respect any existing instructions if there's at least 1 meaningful step
  const hasEnoughSteps = validInstructions.length >= 2 || 
    (validInstructions.length >= 1 && existingInstructions.length >= 2);
  
  // NEW: Also check if instructions are too terse (short notes vs proper cooking steps)
  // Good cooking instructions typically average 50+ characters per step
  // Terse notes like "Sauté garlic & herbs in butter" are ~30 chars
  const totalCharCount = validInstructions.reduce((sum, i) => sum + i.length, 0);
  const avgCharCount = validInstructions.length > 0 ? totalCharCount / validInstructions.length : 0;
  const instructionsAreTerse = validInstructions.length > 0 && avgCharCount < 50;
  
  if (hasEnoughSteps && !instructionsAreTerse) {
    console.log(`[AI Service] Instructions present (${validInstructions.length} valid steps, avg ${Math.round(avgCharCount)} chars), skipping generation`);
    return { instructions: existingInstructions, wasGenerated: false };
  }
  
  // Log reason for generation
  if (!hasEnoughSteps) {
    console.log(`[AI Service] Insufficient instructions (${existingInstructions.length} existing, ${validInstructions.length} valid), generating...`);
  } else if (instructionsAreTerse) {
    console.log(`[AI Service] Instructions too terse (${validInstructions.length} steps, avg ${Math.round(avgCharCount)} chars), generating detailed steps...`);
  }
  
  const provider = getCurrentProvider();
  
  try {
    if (provider === "gemini") {
      return await generateInstructionsWithGemini(rawRecipe);
    } else {
      return await generateInstructionsWithOpenAI(rawRecipe);
    }
  } catch (error) {
    console.error(`[AI Service] Failed to generate instructions:`, error);
    // Return original instructions on failure - don't block enrichment
    console.log(`[AI Service] Falling back to original instructions (${existingInstructions.length} steps)`);
    return { instructions: existingInstructions, wasGenerated: false };
  }
}

async function generateInstructionsWithOpenAI(rawRecipe: ExtractedRecipeRaw): Promise<InstructionGenerationResult> {
  const OpenAI = (await import("openai")).default;
  const openai = new OpenAI({
    baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
    apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  });
  
  const dishName = rawRecipe.title || "Unknown dish";
  const ingredients = rawRecipe.ingredients?.join(", ") || "various ingredients";
  
  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      {
        role: "system",
        content: `You are a professional chef creating cooking instructions. Generate clear, step-by-step cooking instructions based on the dish name and ingredients provided. The instructions should be practical and appropriate for the type of cuisine and cooking method implied by the dish name.`
      },
      {
        role: "user",
        content: `Generate cooking instructions for "${dishName}" using these ingredients: ${ingredients}

Return a JSON object with this structure:
{
  "instructions": ["Step 1: ...", "Step 2: ...", ...]
}

Guidelines:
- Create 5-10 logical cooking steps
- Start with prep work (cutting, seasoning)
- Include cooking temperatures and times where appropriate
- End with serving suggestions
- Be specific but concise
- Match the cooking style to the dish type (e.g., grilling for kebabs, baking for cakes)`
      }
    ],
    response_format: { type: "json_object" },
    max_tokens: 2000,
  });
  
  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error("No response from OpenAI");
  }
  
  let parsed: any;
  try {
    parsed = JSON.parse(content);
  } catch (parseError) {
    console.error(`[AI Service] OpenAI JSON parse error:`, parseError);
    throw new Error("Failed to parse OpenAI response as JSON");
  }
  
  const instructions = Array.isArray(parsed.instructions) ? parsed.instructions : [];
  
  // Validate we got meaningful instructions (at least 2 steps)
  const validInstructions = instructions.filter((i: string) => typeof i === 'string' && i.trim().length > 10);
  if (validInstructions.length < 2) {
    throw new Error(`OpenAI returned insufficient instructions (${validInstructions.length})`);
  }
  
  console.log(`[AI Service] Generated ${validInstructions.length} instruction steps with OpenAI`);
  return { instructions: validInstructions, wasGenerated: true };
}

async function generateInstructionsWithGemini(rawRecipe: ExtractedRecipeRaw): Promise<InstructionGenerationResult> {
  const { GoogleGenerativeAI } = await import("@google/generative-ai");
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
  const model = genAI.getGenerativeModel({ 
    model: "gemini-3-flash-preview",
    generationConfig: {
      responseMimeType: "application/json",
    },
  });
  
  const dishName = rawRecipe.title || "Unknown dish";
  const ingredients = rawRecipe.ingredients?.join(", ") || "various ingredients";
  
  const prompt = `You are a professional chef creating cooking instructions. Generate clear, step-by-step cooking instructions for "${dishName}" using these ingredients: ${ingredients}

Return a JSON object with this structure:
{
  "instructions": ["Step 1: ...", "Step 2: ...", ...]
}

Guidelines:
- Create 5-10 logical cooking steps
- Start with prep work (cutting, seasoning)
- Include cooking temperatures and times where appropriate
- End with serving suggestions
- Be specific but concise
- Match the cooking style to the dish type (e.g., grilling for kebabs, baking for cakes)`;

  const result = await model.generateContent(prompt);
  const responseText = result.response.text();
  
  // Robust JSON extraction
  let cleanedResponse = responseText.trim();
  
  // Remove markdown code blocks if present
  if (cleanedResponse.includes("```")) {
    const jsonMatch = cleanedResponse.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      cleanedResponse = jsonMatch[1].trim();
    }
  }
  
  // Try to find JSON object if response has extra text
  if (!cleanedResponse.startsWith("{")) {
    const jsonStart = cleanedResponse.indexOf("{");
    const jsonEnd = cleanedResponse.lastIndexOf("}");
    if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
      cleanedResponse = cleanedResponse.substring(jsonStart, jsonEnd + 1);
    }
  }
  
  let parsed: any;
  try {
    parsed = JSON.parse(cleanedResponse);
  } catch (parseError) {
    console.error(`[AI Service] Gemini JSON parse error:`, parseError);
    console.error(`[AI Service] Response was:`, responseText.substring(0, 500));
    throw new Error("Failed to parse Gemini response as JSON");
  }
  
  const instructions = Array.isArray(parsed.instructions) ? parsed.instructions : [];
  
  // Validate we got meaningful instructions (at least 2 steps)
  const validInstructions = instructions.filter((i: string) => typeof i === 'string' && i.trim().length > 10);
  if (validInstructions.length < 2) {
    throw new Error(`Gemini returned insufficient instructions (${validInstructions.length})`);
  }
  
  console.log(`[AI Service] Generated ${validInstructions.length} instruction steps with Gemini`);
  return { instructions: validInstructions, wasGenerated: true };
}

// ============ Recipe Enrichment (Phase 2) ============

export interface EnrichedRecipeResult {
  enrichedData: EnrichedRecipeData;
  instructionsGenerated: boolean;
}

// Original sequential enrichment (fallback)
export async function enrichRecipeUnified(
  rawRecipe: ExtractedRecipeRaw
): Promise<EnrichedRecipeData> {
  const provider = getCurrentProvider();
  console.log(`[AI Service] Enrichment using: ${provider.toUpperCase()}`);
  
  if (provider === "gemini") {
    if (!isGeminiAvailable()) {
      throw new Error("Gemini API not configured");
    }
    return enrichRecipeWithGemini(rawRecipe) as any;
  }
  
  // OpenAI - use enrichment.ts's enrichRecipeData which preserves all
  // metadata, retry handling, and validation logic
  return enrichWithOpenAI(rawRecipe);
}

// ============ PARALLEL Enrichment (Phase 2 Optimized) ============

export interface ParallelEnrichmentResult {
  enrichedData: EnrichedRecipeData;
  timings: {
    group1Ms: number;  // Core recipe structure
    group2Ms: number;  // Nutrition & cost
    group3Ms: number;  // Content & reviews
    totalMs: number;
  };
}

// Retry wrapper with exponential backoff
async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number = 2,
  groupName: string = "unknown"
): Promise<T> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;
      const isRateLimit = error.message?.includes("429") || error.message?.includes("rate");
      const backoffMs = Math.min(1000 * Math.pow(2, attempt) + Math.random() * 500, 10000);
      
      if (attempt < maxRetries) {
        console.log(`[AI Service] ${groupName} attempt ${attempt + 1} failed: ${error.message}. Retrying in ${Math.round(backoffMs)}ms...`);
        await new Promise(resolve => setTimeout(resolve, isRateLimit ? backoffMs * 2 : backoffMs));
      }
    }
  }
  throw lastError || new Error(`${groupName} failed after ${maxRetries} retries`);
}

// Parallel enrichment splits the work into 3 concurrent API calls
export async function enrichRecipeParallel(
  rawRecipe: ExtractedRecipeRaw
): Promise<ParallelEnrichmentResult> {
  const provider = getCurrentProvider();
  console.log(`[AI Service] PARALLEL enrichment using: ${provider.toUpperCase()}`);
  
  const overallStart = Date.now();
  
  try {
    // Run all 3 groups in parallel with individual retry logic
    const [group1Result, group2Result, group3Result] = await Promise.all([
      withRetry(() => enrichGroup1Core(rawRecipe, provider), 2, "Group1-Core"),
      withRetry(() => enrichGroup2Nutrition(rawRecipe, provider), 2, "Group2-Nutrition"),
      withRetry(() => enrichGroup3Content(rawRecipe, provider), 2, "Group3-Content"),
    ]);
    
    const totalMs = Date.now() - overallStart;
    
    console.log(`[AI Service] Parallel enrichment completed:`);
    console.log(`  - Group 1 (Core): ${group1Result.durationMs}ms`);
    console.log(`  - Group 2 (Nutrition): ${group2Result.durationMs}ms`);
    console.log(`  - Group 3 (Content): ${group3Result.durationMs}ms`);
    console.log(`  - Total wall-clock: ${totalMs}ms (saved ~${group1Result.durationMs + group2Result.durationMs + group3Result.durationMs - totalMs}ms)`);
    
    // Merge all results into a single EnrichedRecipeData object
    const merged = mergeEnrichmentResults(group1Result.data, group2Result.data, group3Result.data);
    
    // Apply lenient schema validation with defaults for missing required fields
    // Use safeParse to avoid throwing on partial data
    const parseResult = enrichedRecipeDataSchema.safeParse(merged);
    
    let validated: EnrichedRecipeData;
    if (parseResult.success) {
      validated = parseResult.data;
      console.log(`[AI Service] Schema validation passed`);
    } else {
      // Log validation issues but continue with merged data + defaults
      console.warn(`[AI Service] Schema validation had issues, applying defaults:`, 
        parseResult.error.issues.slice(0, 3).map(i => `${i.path.join('.')}: ${i.message}`).join('; '));
      
      // Apply defaults for critical missing fields
      validated = {
        ...getEnrichmentDefaults(),
        ...merged,
        // Ensure required arrays exist
        normalizedIngredients: Array.isArray(merged.normalizedIngredients) ? merged.normalizedIngredients : [],
        normalizedInstructions: Array.isArray(merged.normalizedInstructions) ? merged.normalizedInstructions : [],
        servings: merged.servings || 4,
      } as EnrichedRecipeData;
    }
    
    // Compute derived fields on validated data
    computeDerivedFields(validated);
    
    return {
      enrichedData: validated,
      timings: {
        group1Ms: group1Result.durationMs,
        group2Ms: group2Result.durationMs,
        group3Ms: group3Result.durationMs,
        totalMs,
      },
    };
  } catch (error: any) {
    console.error(`[AI Service] Parallel enrichment failed: ${error.message}. Falling back to sequential.`);
    // Fallback to sequential enrichment
    const fallbackStart = Date.now();
    const enriched = await enrichRecipeUnified(rawRecipe);
    const fallbackMs = Date.now() - fallbackStart;
    
    return {
      enrichedData: enriched,
      timings: {
        group1Ms: 0,
        group2Ms: 0,
        group3Ms: 0,
        totalMs: fallbackMs,
      },
    };
  }
}

// ============ Essential-Only Enrichment (Groups 1+2, skip Group 3) ============

export interface EssentialEnrichmentResult {
  enrichedData: EnrichedRecipeData;
  timings: {
    group1Ms: number;
    group2Ms: number;
    group3Ms: number; // Always 0 — Group 3 is skipped
    totalMs: number;
  };
}

/**
 * Runs ONLY Group 1 (Core) + Group 2 (Nutrition) enrichment.
 * Group 3 (Content: tips, variations, beveragePairings, etc.) is skipped.
 * Returns a valid EnrichedRecipeData with defaults for Group 3 fields.
 */
export async function enrichRecipeEssential(
  rawRecipe: ExtractedRecipeRaw
): Promise<ParallelEnrichmentResult> {
  const provider = getCurrentProvider();
  console.log(`[AI Service] ESSENTIAL enrichment using: ${provider.toUpperCase()} (Groups 1+2 only)`);

  const overallStart = Date.now();

  try {
    // Run only Groups 1 and 2 in parallel (skip Group 3)
    const [group1Result, group2Result] = await Promise.all([
      withRetry(() => enrichGroup1Core(rawRecipe, provider), 2, "Group1-Core"),
      withRetry(() => enrichGroup2Nutrition(rawRecipe, provider), 2, "Group2-Nutrition"),
    ]);

    const totalMs = Date.now() - overallStart;

    console.log(`[AI Service] Essential enrichment completed:`);
    console.log(`  - Group 1 (Core): ${group1Result.durationMs}ms`);
    console.log(`  - Group 2 (Nutrition): ${group2Result.durationMs}ms`);
    console.log(`  - Group 3 (Content): SKIPPED`);
    console.log(`  - Total wall-clock: ${totalMs}ms`);

    // Merge Groups 1+2 with defaults (Group 3 fields get defaults)
    const group3Defaults: Partial<EnrichedRecipeData> = {
      tips: [],
      variations: [],
      servingSuggestions: [],
      beveragePairings: { wines: [], beers: [], cocktails: [], nonAlcoholic: [] },
      recipeVariations: { lowerCalorie: [], higherProtein: [], michelinUpgrade: [], budgetFriendly: [] },
      culturalSignificance: null as any,
      celebrityChefReviews: null as any,
    };

    const merged = mergeEnrichmentResults(group1Result.data, group2Result.data, group3Defaults);

    // Apply lenient schema validation with defaults for missing required fields
    const parseResult = enrichedRecipeDataSchema.safeParse(merged);

    let validated: EnrichedRecipeData;
    if (parseResult.success) {
      validated = parseResult.data;
      console.log(`[AI Service] Essential schema validation passed`);
    } else {
      console.warn(`[AI Service] Essential schema validation had issues, applying defaults:`,
        parseResult.error.issues.slice(0, 3).map(i => `${i.path.join('.')}: ${i.message}`).join('; '));

      validated = {
        ...getEnrichmentDefaults(),
        ...merged,
        normalizedIngredients: Array.isArray(merged.normalizedIngredients) ? merged.normalizedIngredients : [],
        normalizedInstructions: Array.isArray(merged.normalizedInstructions) ? merged.normalizedInstructions : [],
        servings: merged.servings || 4,
      } as EnrichedRecipeData;
    }

    // Compute derived fields on validated data
    computeDerivedFields(validated);

    return {
      enrichedData: validated,
      timings: {
        group1Ms: group1Result.durationMs,
        group2Ms: group2Result.durationMs,
        group3Ms: 0,
        totalMs,
      },
    };
  } catch (error: any) {
    console.error(`[AI Service] Essential enrichment failed: ${error.message}. Falling back to sequential.`);
    const fallbackStart = Date.now();
    const enriched = await enrichRecipeUnified(rawRecipe);
    const fallbackMs = Date.now() - fallbackStart;

    return {
      enrichedData: enriched,
      timings: {
        group1Ms: 0,
        group2Ms: 0,
        group3Ms: 0,
        totalMs: fallbackMs,
      },
    };
  }
}

/**
 * Runs ONLY Group 3 (Content) enrichment.
 * Returns the Group 3 data: tips, variations, beveragePairings, recipeVariations,
 * culturalSignificance, celebrityChefReviews, servingSuggestions, and aiEnrichmentFields.
 */
export async function enrichRecipeContentOnly(
  rawRecipe: ExtractedRecipeRaw
): Promise<Partial<EnrichedRecipeData>> {
  const provider = getCurrentProvider();
  console.log(`[AI Service] CONTENT-ONLY enrichment using: ${provider.toUpperCase()} (Group 3 only)`);

  const startTime = Date.now();

  try {
    const group3Result = await withRetry(
      () => enrichGroup3Content(rawRecipe, provider),
      2,
      "Group3-Content"
    );

    const totalMs = Date.now() - startTime;
    console.log(`[AI Service] Content-only enrichment completed in ${totalMs}ms`);

    return group3Result.data;
  } catch (error: any) {
    console.error(`[AI Service] Content-only enrichment failed: ${error.message}`);
    throw error;
  }
}

// ============ Lightweight Variation Enrichment ============
// For recipe variations (Make Your Own), we SKIP Group 1 (ingredient/instruction normalization)
// because the AI already generated complete, correct variations. We only run:
// 1. Dietary analysis (allergens, dietary flags) based on the NEW ingredients
// 2. Nutrition/cost analysis (Group 2)
// This is 60-70% faster than full enrichment and preserves AI-generated data.

export interface VariationEnrichmentResult {
  enrichedData: Partial<EnrichedRecipeData>;
  timings: {
    dietaryMs: number;
    nutritionMs: number;
    totalMs: number;
  };
}

export async function enrichVariationRecipe(
  rawRecipe: ExtractedRecipeRaw
): Promise<VariationEnrichmentResult> {
  const provider = getCurrentProvider();
  console.log(`[AI Service] VARIATION enrichment using: ${provider.toUpperCase()} (lightweight mode)`);
  
  const startTime = Date.now();
  
  try {
    // Run dietary analysis and nutrition in parallel
    const [dietaryResult, nutritionResult] = await Promise.all([
      withRetry(() => enrichVariationDietary(rawRecipe, provider), 2, "Variation-Dietary"),
      withRetry(() => enrichGroup2Nutrition(rawRecipe, provider), 2, "Variation-Nutrition"),
    ]);
    
    const totalMs = Date.now() - startTime;
    
    console.log(`[AI Service] Variation enrichment completed:`);
    console.log(`  - Dietary analysis: ${dietaryResult.durationMs}ms`);
    console.log(`  - Nutrition/cost: ${nutritionResult.durationMs}ms`);
    console.log(`  - Total wall-clock: ${totalMs}ms`);
    
    // Merge results (note: we DON'T include normalizedIngredients/normalizedInstructions)
    const merged: Partial<EnrichedRecipeData> = {
      ...dietaryResult.data,
      ...nutritionResult.data,
      aiEnrichmentFields: [
        ...(dietaryResult.data.aiEnrichmentFields || []),
        ...(nutritionResult.data.aiEnrichmentFields || []),
        "variationEnriched",
      ],
    };
    
    // Compute derived fields
    computeDerivedFields(merged);
    
    return {
      enrichedData: merged,
      timings: {
        dietaryMs: dietaryResult.durationMs,
        nutritionMs: nutritionResult.durationMs,
        totalMs,
      },
    };
  } catch (error: any) {
    console.error(`[AI Service] Variation enrichment failed: ${error.message}`);
    throw error;
  }
}

// Lightweight dietary analysis for variations - determines dietary flags and allergens
// without re-normalizing ingredients (which would overwrite AI-generated variations)
async function enrichVariationDietary(
  rawRecipe: ExtractedRecipeRaw,
  provider: AIProvider
): Promise<GroupResult<Partial<EnrichedRecipeData>>> {
  const startTime = Date.now();
  
  const prompt = `Analyze this recipe's dietary properties. This is a modified variation, so analyze the EXACT ingredients listed below.

RECIPE DATA:
Title: ${rawRecipe.title}
Ingredients: ${JSON.stringify(rawRecipe.ingredients)}
Instructions: ${JSON.stringify(rawRecipe.instructions)}

Return JSON with these fields ONLY:
1. servings: number (estimate from ingredients if not stated, default 4)
2. prepTimeMinutes, cookTimeMinutes, totalTimeMinutes: numbers (estimate if not stated)
3. skillLevel: "Beginner"|"Intermediate"|"Advanced"
4. skillLevelExplanation: string
5. cuisines: string[] (e.g. ["Italian", "Mediterranean"])
6. cookingMethods: string[]
7. allergens: string[] (only include if present: Gluten, Dairy, Eggs, Peanuts, Tree Nuts, Soy, Fish, Shellfish, Sesame)
8. seasonTags: string[]
9. occasionTags: string[]
10. Dietary flags (all boolean, analyze based on ACTUAL ingredients):
    - isVegetarian (no meat/fish)
    - isVegan (no animal products)
    - isPescatarian (fish allowed, no other meat)
    - isGlutenFree (no wheat/barley/rye)
    - isDairyFree (no milk/cheese/cream/butter)
    - isKeto (very low carb, <20g net carbs)
    - isPaleo
    - isLowCarb (under 30g carbs/serving)
    - isHighProtein (>25g protein/serving)
    - isLowCalorie (<400 calories/serving)
    - isHighFiber (>5g fiber/serving)
    - isLactoVegetarian, isMediterranean, isOvoVegetarian, isOvoLactoVegetarian, isFlexitarian, isCarnivore, isKosher, isHalal, isHindu
11. aiEnrichmentFields: ["dietaryAnalysis"]

IMPORTANT: Analyze the ACTUAL ingredients listed. For example:
- If it contains "plant-based sausage" instead of meat = vegetarian
- If it contains "lite cream cheese" = contains dairy, NOT dairy-free
- If it contains "keto-friendly wraps" = likely low-carb

Return ONLY valid JSON.`;

  const result = await callAIForJSON(prompt, provider);
  
  return {
    data: result,
    durationMs: Date.now() - startTime,
  };
}

// Compute derived fields using shared schema utilities for consistency
function computeDerivedFields(data: any): void {
  // Use shared utility for allergenFreeTags
  data.allergenFreeTags = deriveAllergenFreeTags(data.allergens);
  
  // Use shared utility for timeConvenienceTags
  data.timeConvenienceTags = deriveTimeConvenienceTags(data.totalTimeMinutes);
  
  // Use shared utility for groceryAisleTags
  data.groceryAisleTags = deriveGroceryAisleTags(data.normalizedIngredients);
  
  // Use shared utility for legacy cuisine field
  data.cuisine = deriveLegacyCuisine(data.cuisines);
  
  // Use shared utility for legacy equipment field
  data.equipment = deriveLegacyEquipment(data.standardEquipment, data.specializedEquipment);
  
  // Use shared utility for nutrition flags
  const nutritionFlags = deriveNutritionFlags({
    fat: data.fat,
    sodium: data.sodium,
    sugar: data.sugar,
  });
  Object.assign(data, nutritionFlags);
}

interface GroupResult<T> {
  data: T;
  durationMs: number;
}

// Group 1: Core recipe structure (normalized ingredients/instructions, times, dietary flags)
async function enrichGroup1Core(
  rawRecipe: ExtractedRecipeRaw,
  provider: AIProvider
): Promise<GroupResult<Partial<EnrichedRecipeData>>> {
  const startTime = Date.now();
  
  const prompt = `Analyze this recipe and return JSON with the following fields ONLY:

RECIPE DATA:
${JSON.stringify(rawRecipe, null, 2)}

REQUIRED FIELDS:
1. correctedTitle: string (fix any spelling/OCR errors in "${rawRecipe.title}")
2. normalizedIngredients: [{raw, quantity, unit, item, preparation, isOptional, isToolOrConsumable, emoji (single Unicode emoji), nutrition: {calories, protein, carbohydrates, fat, fiber}, groceryMapping: {name, aisle, packageSize, category}}]
3. normalizedInstructions: [{stepNumber, text, ingredients[], tools[], timeMinutes, temperature: {value, scale: "F"|"C"}, stepType, donenessCue}]
4. servings: number (REQUIRED - infer from ingredients if not stated)
5. prepTimeMinutes, cookTimeMinutes, totalTimeMinutes: numbers
6. skillLevel: "Beginner"|"Intermediate"|"Advanced"
7. skillLevelExplanation: string
8. cuisines: string[] (e.g. ["Italian", "Mediterranean"])
9. cookingMethods: string[]
10. allergens: string[] (Gluten, Dairy, Eggs, Peanuts, Tree Nuts, Soy, Fish, Shellfish, Sesame)
11. seasonTags: string[]
12. occasionTags: string[]
13. standardEquipment: string[] (common tools)
14. specializedEquipment: string[] (advanced tools)
15. mealType: string[] (REQUIRED - ALWAYS assign at least one. Choose from: "Breakfast", "Lunch", "Dinner", "Snack", "Dessert", "Appetizer", "Side Dish", "Beverage", "Sauce", "Dip", "Marinade", "Rub". A recipe can have multiple types e.g. ["Dinner", "Side Dish"]. Never leave empty or null.)
16. Dietary flags (all boolean): isVegetarian, isVegan, isPescatarian, isGlutenFree, isDairyFree, isKeto, isPaleo, isLowCarb, isHighProtein, isLowCalorie, isHighFiber, isLactoVegetarian, isMediterranean, isOvoVegetarian, isOvoLactoVegetarian, isFlexitarian, isCarnivore, isKosher, isHalal, isHindu

Return ONLY valid JSON with these exact field names.`;

  const result = await callAIForJSON(prompt, provider);
  
  return {
    data: result,
    durationMs: Date.now() - startTime,
  };
}

// Group 2: Nutrition & cost analysis
async function enrichGroup2Nutrition(
  rawRecipe: ExtractedRecipeRaw,
  provider: AIProvider
): Promise<GroupResult<Partial<EnrichedRecipeData>>> {
  const startTime = Date.now();
  
  const prompt = `Analyze this recipe's nutrition and cost. Return JSON with these fields ONLY:

RECIPE DATA:
${JSON.stringify(rawRecipe, null, 2)}

REQUIRED FIELDS (per serving):
1. calories: number
2. protein: number (grams)
3. fat: number (grams)
4. carbohydrates: number (grams)
5. fiber: number (grams)
6. sugar: number (grams)
7. sodium: number (mg)
8. cholesterol: number (mg)
9. priceRangeMin: number (USD, minimum cost)
10. priceRangeMax: number (USD, maximum cost)
11. totalCost: number (USD, midpoint estimate)
12. costExcludingStaples: number (USD, excluding salt, pepper, oil, flour)
13. priceCategory: "$"|"$$"|"$$$"
14. healthScore: number (0-100)
15. healthScoreJustification: string

Estimate based on typical US grocery prices. Return ONLY valid JSON.`;

  const result = await callAIForJSON(prompt, provider);
  
  return {
    data: result,
    durationMs: Date.now() - startTime,
  };
}

// Group 3: Creative content & reviews (tips, variations, cultural significance, chef reviews)
async function enrichGroup3Content(
  rawRecipe: ExtractedRecipeRaw,
  provider: AIProvider
): Promise<GroupResult<Partial<EnrichedRecipeData>>> {
  const startTime = Date.now();
  
  const prompt = `Generate creative content for this recipe. Return JSON with these fields ONLY:

RECIPE DATA:
${JSON.stringify(rawRecipe, null, 2)}

REQUIRED FIELDS:
1. tips: [{type: "technique"|"storage"|"makeAhead"|"reheating"|"serving", text}] (3-5 items)
2. variations: [{type: "ingredient"|"flavor"|"protein"|"dietary", title, description}] (2-4 items)
3. servingSuggestions: string[] (2-3 items)
4. beveragePairings: {
  wines: [{name, styleOrVarietal, rationale}] (3+ items or []),
  beers: [{name, styleOrVarietal, rationale}] (3+ items or []),
  cocktails: [{name, rationale}] (2-3 items or []),
  nonAlcoholic: [{name, rationale}] (2-3 items)
}
5. recipeVariations: {
  lowerCalorie: [{targetIngredient, replacement, reason, impactSummary}] (3 items),
  higherProtein: [{targetIngredient, replacement, reason, impactSummary}] (3 items),
  michelinUpgrade: [{focus: "presentation"|"technique"|"ingredient", recommendation, rationale}] (3 items),
  budgetFriendly: [{targetIngredient, replacement, reason, impactSummary}] (3 items)
}
6. culturalSignificance: string (2+ paragraphs about history, origins, fun facts)
7. celebrityChefReviews: [
  {chefName: "Gordon Ramsay", philosophy: "Technique", score: 1-10, review: "3-4 sentences in his voice referencing specific ingredients/techniques"},
  {chefName: "Ina Garten", philosophy: "Quality/Ease", score: 1-10, review: "3-4 sentences in her voice"},
  {chefName: "Matty Matheson", philosophy: "Flavor/Fat", score: 1-10, review: "3-4 sentences in his enthusiastic voice"}
]
8. aiEnrichmentFields: string[] (list all fields you enriched)

Return ONLY valid JSON.`;

  const result = await callAIForJSON(prompt, provider);
  
  return {
    data: result,
    durationMs: Date.now() - startTime,
  };
}

// Helper to call AI and get JSON response
async function callAIForJSON(prompt: string, provider: AIProvider): Promise<any> {
  if (provider === "gemini") {
    return callGeminiForJSON(prompt);
  }
  return callOpenAIForJSON(prompt);
}

async function callGeminiForJSON(prompt: string): Promise<any> {
  const { GoogleGenerativeAI } = await import("@google/generative-ai");
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY not configured");
  }
  const genAI = new GoogleGenerativeAI(apiKey);
  
  // Use the same model as gemini.ts for consistency
  const model = genAI.getGenerativeModel({
    model: "gemini-3-flash-preview",
    generationConfig: { responseMimeType: "application/json" },
  });
  
  let responseText: string;
  try {
    const result = await model.generateContent(prompt);
    responseText = result.response.text();
  } catch (error: any) {
    // Handle rate limiting
    if (error.status === 429 || error.message?.includes("429")) {
      throw new Error(`Gemini rate limited: ${error.message}`);
    }
    throw error;
  }
  
  // Clean markdown code blocks if present
  let cleaned = responseText.trim();
  if (cleaned.includes("```json")) {
    cleaned = cleaned.replace(/```json\n?/g, "").replace(/```\n?/g, "");
  }
  if (cleaned.includes("```")) {
    cleaned = cleaned.replace(/```\n?/g, "");
  }
  
  // Extract JSON object if wrapped in extra content
  const jsonStart = cleaned.indexOf("{");
  const jsonEnd = cleaned.lastIndexOf("}");
  if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
    cleaned = cleaned.substring(jsonStart, jsonEnd + 1);
  }
  
  try {
    return JSON.parse(cleaned);
  } catch (parseError: any) {
    console.error(`[AI Service] Gemini JSON parse error:`, parseError.message);
    console.error(`[AI Service] Response preview:`, responseText.substring(0, 300));
    throw new Error(`Gemini returned invalid JSON: ${parseError.message}`);
  }
}

async function callOpenAIForJSON(prompt: string): Promise<any> {
  const OpenAI = (await import("openai")).default;
  const openai = new OpenAI({
    baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
    apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  });
  
  let response;
  try {
    response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
    });
  } catch (error: any) {
    // Handle rate limiting
    if (error.status === 429 || error.message?.includes("429")) {
      throw new Error(`OpenAI rate limited: ${error.message}`);
    }
    throw error;
  }
  
  const content = response.choices[0]?.message?.content;
  if (!content) throw new Error("Empty response from OpenAI");
  
  try {
    return JSON.parse(content);
  } catch (parseError: any) {
    console.error(`[AI Service] OpenAI JSON parse error:`, parseError.message);
    console.error(`[AI Service] Response preview:`, content.substring(0, 300));
    throw new Error(`OpenAI returned invalid JSON: ${parseError.message}`);
  }
}

// Merge results from all 3 groups into a single EnrichedRecipeData
function mergeEnrichmentResults(
  group1: Partial<EnrichedRecipeData>,
  group2: Partial<EnrichedRecipeData>,
  group3: Partial<EnrichedRecipeData>
): EnrichedRecipeData {
  // Combine all results with defaults for any missing fields
  const merged: any = {
    ...getEnrichmentDefaults(),
    ...group1,
    ...group2,
    ...group3,
  };
  
  // Ensure aiEnrichmentFields includes all enriched fields
  const allEnrichedFields = new Set<string>([
    ...(group1.aiEnrichmentFields || []),
    ...(group2.aiEnrichmentFields || []),
    ...(group3.aiEnrichmentFields || []),
    "parallelEnriched",
  ]);
  merged.aiEnrichmentFields = Array.from(allEnrichedFields);
  
  return merged as EnrichedRecipeData;
}

// Default values for enrichment fields
function getEnrichmentDefaults(): Partial<EnrichedRecipeData> {
  return {
    normalizedIngredients: [],
    normalizedInstructions: [],
    servings: 4,
    isVegetarian: false,
    isVegan: false,
    isPescatarian: false,
    isGlutenFree: false,
    isDairyFree: false,
    isKeto: false,
    isPaleo: false,
    isLowCarb: false,
    isHighProtein: false,
    isLowCalorie: false,
    isHighFiber: false,
    isLactoVegetarian: false,
    isMediterranean: false,
    isOvoVegetarian: false,
    isOvoLactoVegetarian: false,
    isFlexitarian: false,
    isCarnivore: false,
    isKosher: false,
    isHalal: false,
    isHindu: false,
    allergens: [],
    cuisines: [],
    cookingMethods: [],
    seasonTags: [],
    occasionTags: [],
    standardEquipment: [],
    specializedEquipment: [],
    tips: [],
    variations: [],
    servingSuggestions: [],
    aiEnrichmentFields: [],
    beveragePairings: { wines: [], beers: [], cocktails: [], nonAlcoholic: [] },
    recipeVariations: { lowerCalorie: [], higherProtein: [], michelinUpgrade: [], budgetFriendly: [] },
  };
}

// ============ Image Generation (Phase 3) ============

export interface GeneratedImageResult {
  imageBuffer: Buffer;
  format: "png" | "webp" | "svg";
  provider: AIProvider;
  durationMs: number;
}

interface RecipeImageContext {
  instructions?: Array<{ step: string }> | string[];
  cookingMethods?: string[];
  cuisines?: string[];
  mealType?: string[];
  skillLevel?: string;
}

export async function generateRecipeImageUnified(
  recipeName: string,
  ingredients: string[],
  cuisines: string[],
  cookingMethods: string[],
  additionalContext?: RecipeImageContext
): Promise<GeneratedImageResult> {
  const provider = getCurrentProvider();
  console.log(`[AI Service] Image generation using: ${provider.toUpperCase()}`);
  
  const startTime = Date.now();
  
  if (provider === "gemini") {
    if (!isGeminiAvailable()) {
      throw new Error("Gemini API not configured");
    }
    const base64 = await generateRecipeImageWithGemini(recipeName, cuisines, cookingMethods, additionalContext ? {
      instructions: additionalContext.instructions,
      cookingMethods: additionalContext.cookingMethods,
      cuisines: additionalContext.cuisines,
      mealType: additionalContext.mealType,
      skillLevel: additionalContext.skillLevel,
    } : undefined);
    return {
      imageBuffer: Buffer.from(base64, "base64"),
      format: "png",
      provider: "gemini",
      durationMs: Date.now() - startTime,
    };
  }
  
  // OpenAI (DALL-E) - use the original function with full context
  const recipeContext: RecipeImageContext = {
    cuisines,
    cookingMethods,
    ...additionalContext,
  };
  
  const imageBuffer = await generateImageOpenAI(recipeName, ingredients, recipeContext);
  
  // Detect if it's an SVG placeholder or actual image
  const isSvg = imageBuffer.toString("utf8").startsWith("<svg");
  
  return {
    imageBuffer,
    format: isSvg ? "svg" : "png", // OpenAI returns PNG, or SVG placeholder
    provider: "openai",
    durationMs: Date.now() - startTime,
  };
}

// ============ Recipe Variation (Make Your Own) ============

export async function generateRecipeVariationUnified(
  request: RecipeVariationRequest
): Promise<RecipeVariationResult> {
  const provider = getCurrentProvider();
  console.log(`[AI Service] Recipe variation using: ${provider.toUpperCase()}`);
  
  // Recipe variation is Gemini-only for now (can add OpenAI later if needed)
  if (!isGeminiAvailable()) {
    throw new Error("Gemini API not configured - recipe variations require Gemini");
  }
  
  return generateRecipeVariationWithGemini(request);
}

// ============ Ingredient Substitutions (What Can I Make?) ============

interface SubstitutionSuggestion {
  ingredient: string;
  suggestions: string[];
  notes?: string;
}

export async function getSubstitutionSuggestions(
  missingIngredients: string[],
  availablePantryItems: string[]
): Promise<SubstitutionSuggestion[]> {
  const provider = getCurrentProvider();
  console.log(`[AI Service] Getting substitution suggestions using: ${provider.toUpperCase()}`);
  
  const prompt = `You are a helpful cooking assistant. A home cook is missing some ingredients but has other items in their pantry. Suggest practical substitutions they could use.

MISSING INGREDIENTS:
${missingIngredients.join('\n')}

AVAILABLE PANTRY ITEMS:
${availablePantryItems.join(', ')}

For each missing ingredient, suggest 1-3 practical substitutions from their pantry or common household items. Focus on substitutions that will work well in most recipes.

Return a JSON array with this structure:
[
  {
    "ingredient": "the missing ingredient",
    "suggestions": ["substitution 1", "substitution 2"],
    "notes": "optional tip about the substitution"
  }
]

Only return the JSON array, no other text.`;

  try {
    if (provider === 'gemini' && isGeminiAvailable()) {
      const { GoogleGenerativeAI } = await import("@google/generative-ai");
      const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
      const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
      
      const result = await model.generateContent(prompt);
      const text = result.response.text();
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
    } else {
      // Use OpenAI
      const { default: OpenAI } = await import("openai");
      const openai = new OpenAI();
      
      const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" }
      });
      
      const content = response.choices[0]?.message?.content || '[]';
      const parsed = JSON.parse(content);
      return Array.isArray(parsed) ? parsed : parsed.substitutions || [];
    }
  } catch (error) {
    console.error("[AI Service] Error getting substitution suggestions:", error);
  }
  
  // Fallback: return basic common substitutions
  return missingIngredients.map(ing => ({
    ingredient: ing,
    suggestions: ["No specific substitution available"],
    notes: "Check online for suitable alternatives"
  }));
}

// Re-export types for convenience
export type { ExtractedRecipeRaw, EnrichedRecipeData, RecipeVariationRequest, RecipeVariationResult };
