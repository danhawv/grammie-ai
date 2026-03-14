import { GoogleGenerativeAI } from "@google/generative-ai";
import sharp from "sharp";
import type { ExtractedRecipeRaw } from "./enrichment";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// ============ Image Optimization for Faster Vision API ============
// Resize and compress images before sending to Gemini to reduce latency
const MAX_IMAGE_WIDTH = 1500; // Max width for vision extraction
const JPEG_QUALITY = 80; // Compression quality

async function optimizeImageForVision(imageBase64: string): Promise<{ data: string; mimeType: string; originalSize: number; optimizedSize: number }> {
  const startTime = Date.now();
  
  // Decode base64 to buffer
  const inputBuffer = Buffer.from(imageBase64, 'base64');
  const originalSize = inputBuffer.length;
  
  try {
    // Get image metadata
    const metadata = await sharp(inputBuffer).metadata();
    const width = metadata.width || 0;
    
    // Skip optimization if image is already small
    if (width <= MAX_IMAGE_WIDTH && originalSize < 500000) {
      console.log(`[Gemini] Image already optimized (${Math.round(originalSize / 1024)}KB, ${width}px wide)`);
      return {
        data: imageBase64,
        mimeType: metadata.format === 'png' ? 'image/png' : 'image/jpeg',
        originalSize,
        optimizedSize: originalSize
      };
    }
    
    // Resize and compress
    const optimizedBuffer = await sharp(inputBuffer)
      .resize({ width: MAX_IMAGE_WIDTH, withoutEnlargement: true })
      .jpeg({ quality: JPEG_QUALITY })
      .toBuffer();
    
    const optimizedSize = optimizedBuffer.length;
    const elapsed = Date.now() - startTime;
    const savings = Math.round((1 - optimizedSize / originalSize) * 100);
    
    console.log(`[Gemini] Image optimized: ${Math.round(originalSize / 1024)}KB → ${Math.round(optimizedSize / 1024)}KB (${savings}% smaller, ${width}px → ${MAX_IMAGE_WIDTH}px) in ${elapsed}ms`);
    
    return {
      data: optimizedBuffer.toString('base64'),
      mimeType: 'image/jpeg',
      originalSize,
      optimizedSize
    };
  } catch (error) {
    // If optimization fails, use original
    console.warn(`[Gemini] Image optimization failed, using original:`, error);
    return {
      data: imageBase64,
      mimeType: 'image/jpeg',
      originalSize,
      optimizedSize: originalSize
    };
  }
}

// Helper to repair truncated/malformed JSON
function repairJson(jsonStr: string): string {
  let str = jsonStr.trim();
  
  // Remove markdown code blocks if present
  const codeBlockMatch = str.match(/```(?:json)?\s*([\s\S]*?)(?:\s*```|$)/);
  if (codeBlockMatch) {
    str = codeBlockMatch[1].trim();
  }
  
  // Find the opening brace
  const start = str.indexOf('{');
  if (start === -1) return str;
  str = str.substring(start);
  
  // Count braces and brackets to find where to close
  let braceCount = 0;
  let bracketCount = 0;
  let inString = false;
  let escape = false;
  let lastValidPos = 0;
  
  for (let i = 0; i < str.length; i++) {
    const char = str[i];
    
    if (escape) {
      escape = false;
      continue;
    }
    
    if (char === '\\') {
      escape = true;
      continue;
    }
    
    if (char === '"') {
      inString = !inString;
      continue;
    }
    
    if (inString) continue;
    
    if (char === '{') braceCount++;
    if (char === '}') braceCount--;
    if (char === '[') bracketCount++;
    if (char === ']') bracketCount--;
    
    // Track last position where we could safely truncate
    if (braceCount >= 0 && bracketCount >= 0) {
      lastValidPos = i;
    }
    
    // Perfect balance - return as-is
    if (braceCount === 0 && bracketCount === 0 && i > 0) {
      return str.substring(0, i + 1);
    }
  }
  
  // JSON is truncated - try to repair by closing open structures
  if (braceCount > 0 || bracketCount > 0) {
    // Truncate to last safe position and close remaining structures
    let repaired = str.substring(0, lastValidPos + 1);
    
    // Remove trailing comma if present
    repaired = repaired.replace(/,\s*$/, '');
    
    // Close any unclosed strings (simple heuristic)
    const quoteCount = (repaired.match(/(?<!\\)"/g) || []).length;
    if (quoteCount % 2 !== 0) {
      repaired += '"';
    }
    
    // Close brackets then braces
    for (let i = 0; i < bracketCount; i++) repaired += ']';
    for (let i = 0; i < braceCount; i++) repaired += '}';
    
    console.log(`[Gemini] Repaired truncated JSON (closed ${bracketCount} brackets, ${braceCount} braces)`);
    return repaired;
  }
  
  return str;
}

const hasGemini = !!GEMINI_API_KEY;

const genAI = hasGemini ? new GoogleGenerativeAI(GEMINI_API_KEY!) : null;

// Use Gemini 3 Flash Preview for text/vision tasks (released Dec 17, 2025 - 3x faster, 1M context)
const GEMINI_TEXT_MODEL = "gemini-3-flash-preview";
// Use Nano Banana Pro (gemini-3-pro-image-preview) for image generation - Google's state-of-the-art image model
const GEMINI_IMAGE_MODEL = "gemini-3-pro-image-preview";

export function isGeminiAvailable(): boolean {
  return hasGemini;
}

// ============ Vision Extraction (Phase 1) ============

// Helper to detect MIME type from base64 image data
function detectImageMimeType(base64: string): string {
  // Check for common image signatures in base64
  if (base64.startsWith('/9j/')) return 'image/jpeg';
  if (base64.startsWith('iVBORw')) return 'image/png';
  if (base64.startsWith('R0lGOD')) return 'image/gif';
  if (base64.startsWith('UklGR')) return 'image/webp';
  // Default to JPEG for unknown formats
  return 'image/jpeg';
}

export async function extractRecipeFromImageWithGemini(
  imageBase64: string,
  mimeType?: string
): Promise<ExtractedRecipeRaw> {
  if (!genAI) {
    throw new Error("Gemini API not configured");
  }

  const model = genAI.getGenerativeModel({ model: GEMINI_TEXT_MODEL });
  
  // Optimize image for faster Vision API processing
  const optimized = await optimizeImageForVision(imageBase64);
  const optimizedMimeType = optimized.mimeType;

  const prompt = `You are an expert at reading handwritten recipes. Carefully analyze this ENTIRE image and extract ALL text that is visible.

CRITICAL: Read the COMPLETE ingredient list and ALL instruction steps. Do not skip any lines.

Extract the following fields (ONLY if clearly visible in the image):
- title: Recipe name - ONLY if clearly visible (many handwritten recipes don't have titles - omit if not visible)
- description: Brief description (ONLY if written in the image)
- prepTime: Preparation time (e.g., "15 mins") - ONLY if mentioned
- cookTime: Cooking time (e.g., "45 mins") - ONLY if mentioned
- totalTime: Total time (e.g., "1 hr") - ONLY if mentioned
- coolingTime: Cooling time - ONLY if mentioned
- servings: Number of servings as integer (extract if visible, otherwise omit)
- servingUnit: What it makes (e.g., "cookies", "servings", "slices") - ONLY if mentioned
- servingSize: Portion size per serving (e.g., "8 oz", "1 cup", "200g", "1 slice") - ONLY if mentioned
- yield: Complete yield description (e.g., "Makes 12 cookies") - ONLY if mentioned
- ingredients: Array of ALL ingredient strings EXACTLY as written (REQUIRED - read EVERY ingredient line, do not skip any)
- instructions: Array of ALL instruction steps EXACTLY as written (REQUIRED - read EVERY step, do not skip any)

CRITICAL RULES:
- Read the ENTIRE image carefully - scan from top to bottom
- Extract EVERY ingredient and EVERY instruction - do not truncate or skip lines
- Extract text exactly as written - do not normalize, estimate, or enrich
- If a field is not visible in the image, omit it entirely
- Do not infer cuisine, diet types, meal types, equipment, or nutrition - that will be done later
- Make your best guess for handwriting, but stay true to what's written

Return ONLY valid JSON. Include ALL ingredients and ALL instructions that are visible.`;

  const startTime = Date.now();

  try {
    console.log("[Gemini] Starting vision extraction...");

    // Use proper SDK format with { text: prompt } wrapper - use optimized image
    const result = await model.generateContent([
      { text: prompt },
      {
        inlineData: {
          mimeType: optimizedMimeType,
          data: optimized.data,
        },
      },
    ]);
    
    console.log(`[Gemini] Using MIME type: ${optimizedMimeType}`);

    const response = result.response;
    const text = response.text();

    const elapsed = Date.now() - startTime;
    console.log(`[Gemini] Vision extraction completed in ${elapsed}ms`);

    // Parse JSON from response (Gemini may include markdown code blocks)
    const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/) || text.match(/\{[\s\S]*\}/);
    const jsonStr = jsonMatch ? (jsonMatch[1] || jsonMatch[0]) : text;

    const parsed = JSON.parse(jsonStr) as ExtractedRecipeRaw;
    console.log("[Gemini] Parsed extraction result:", JSON.stringify(parsed, null, 2).substring(0, 500));

    return parsed;
  } catch (error) {
    const elapsed = Date.now() - startTime;
    console.error(`[Gemini] Vision extraction failed after ${elapsed}ms:`, error);
    throw error;
  }
}

// ============ Multi-Image Vision Extraction ============

export async function extractRecipeFromMultipleImagesWithGemini(
  imagesBase64: string[]
): Promise<ExtractedRecipeRaw> {
  if (!genAI) {
    throw new Error("Gemini API not configured");
  }

  const model = genAI.getGenerativeModel({ model: GEMINI_TEXT_MODEL });

  const prompt = `You are an expert at reading handwritten recipes. You have been given ${imagesBase64.length} images that together form ONE COMPLETE recipe (e.g., front and back of a recipe card, or multiple pages).

CRITICAL: Read ALL ${imagesBase64.length} images carefully and COMBINE the content into ONE unified recipe. The images may contain:
- Front of a recipe card with title and ingredients
- Back of a recipe card with instructions
- Multiple pages of the same recipe
- Different angles or sections of the same recipe

Extract the following fields (ONLY if clearly visible in ANY of the images):
- title: Recipe name - ONLY if clearly visible
- description: Brief description (ONLY if written)
- prepTime: Preparation time (e.g., "15 mins") - ONLY if mentioned
- cookTime: Cooking time (e.g., "45 mins") - ONLY if mentioned
- totalTime: Total time (e.g., "1 hr") - ONLY if mentioned
- coolingTime: Cooling time - ONLY if mentioned
- servings: Number of servings as integer
- servingUnit: What it makes (e.g., "cookies", "servings", "slices")
- servingSize: Portion size per serving (e.g., "8 oz", "1 cup", "200g", "1 slice")
- yield: Complete yield description (e.g., "Makes 12 cookies")
- ingredients: Array of ALL ingredient strings EXACTLY as written (REQUIRED - combine from ALL images)
- instructions: Array of ALL instruction steps EXACTLY as written (REQUIRED - combine from ALL images in correct order)

CRITICAL RULES:
- Read ALL ${imagesBase64.length} images and MERGE the content into one recipe
- Extract EVERY ingredient and EVERY instruction from ALL images
- Deduplicate if the same content appears in multiple images
- Maintain the logical order (ingredients before instructions, steps in sequence)
- Extract text exactly as written - do not normalize, estimate, or enrich
- Do not infer cuisine, diet types, meal types, equipment, or nutrition - that will be done later

Return ONLY valid JSON with the COMPLETE combined recipe from all images.`;

  const startTime = Date.now();

  try {
    console.log(`[Gemini] Starting multi-image extraction (${imagesBase64.length} images)...`);

    // Optimize all images and build content array
    const contentParts: any[] = [{ text: prompt }];
    
    for (let i = 0; i < imagesBase64.length; i++) {
      const optimized = await optimizeImageForVision(imagesBase64[i]);
      contentParts.push({
        inlineData: {
          mimeType: optimized.mimeType,
          data: optimized.data,
        },
      });
    }

    const result = await model.generateContent(contentParts);
    const response = result.response;
    const text = response.text();

    const elapsed = Date.now() - startTime;
    console.log(`[Gemini] Multi-image extraction completed in ${elapsed}ms`);

    // Parse JSON from response
    const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/) || text.match(/\{[\s\S]*\}/);
    const jsonStr = jsonMatch ? (jsonMatch[1] || jsonMatch[0]) : text;

    const parsed = JSON.parse(jsonStr) as ExtractedRecipeRaw;
    console.log("[Gemini] Parsed multi-image extraction result:", JSON.stringify(parsed, null, 2).substring(0, 500));

    return parsed;
  } catch (error) {
    const elapsed = Date.now() - startTime;
    console.error(`[Gemini] Multi-image extraction failed after ${elapsed}ms:`, error);
    throw error;
  }
}

// ============ Text Enrichment (Phase 2) ============

export interface GeminiEnrichmentResult {
  correctedTitle?: string;
  normalizedIngredients: any[];
  normalizedInstructions: any[];
  servings: number;
  prepTimeMinutes?: number;
  cookTimeMinutes?: number;
  totalTimeMinutes?: number;
  skillLevel?: string;
  skillLevelExplanation?: string;
  isVegetarian: boolean;
  isVegan: boolean;
  isPescatarian: boolean;
  isGlutenFree: boolean;
  isDairyFree: boolean;
  isKeto: boolean;
  isPaleo: boolean;
  isLowCarb: boolean;
  isHighProtein: boolean;
  isLowCalorie: boolean;
  isHighFiber: boolean;
  isLactoVegetarian: boolean;
  isMediterranean: boolean;
  isOvoVegetarian: boolean;
  isOvoLactoVegetarian: boolean;
  isFlexitarian: boolean;
  isCarnivore: boolean;
  isKosher: boolean;
  isHalal: boolean;
  isHindu: boolean;
  allergens: string[];
  cuisines: string[];
  mealType?: string[];
  cookingMethods: string[];
  seasonTags: string[];
  occasionTags: string[];
  standardEquipment: string[];
  specializedEquipment: string[];
  priceRangeMin?: number;
  priceRangeMax?: number;
  priceCategory?: string;
  totalCost?: number;
  costExcludingStaples?: number;
  healthScore?: number;
  healthScoreJustification?: string;
  calories?: number;
  protein?: number;
  fat?: number;
  carbohydrates?: number;
  fiber?: number;
  sugar?: number;
  sodium?: number;
  cholesterol?: number;
  tips: any[];
  variations: any[];
  servingSuggestions: string[];
  beveragePairings: any;
  recipeVariations: any;
  aiEnrichmentFields: string[];
}

export async function enrichRecipeWithGemini(
  raw: ExtractedRecipeRaw
): Promise<GeminiEnrichmentResult> {
  if (!genAI) {
    throw new Error("Gemini API not configured");
  }

  const model = genAI.getGenerativeModel({ 
    model: GEMINI_TEXT_MODEL,
    generationConfig: {
      responseMimeType: "application/json",
    },
  });

  const prompt = `Enrich this recipe with comprehensive metadata. Return valid JSON with ALL fields as top-level properties.

RECIPE DATA:
${JSON.stringify(raw, null, 2)}

REQUIRED TOP-LEVEL FIELDS (return exactly these field names):

// Title Correction (REQUIRED if title has errors)
correctedTitle: string (Review the recipe title "${raw.title}" for spelling errors, OCR mistakes, or awkward phrasing from handwritten extraction. If the title has any issues, provide the corrected version. Common issues: "Chiken" → "Chicken", "Lasange" → "Lasagna", "Beef Stew w/ Vegtables" → "Beef Stew with Vegetables". If the title is already correct, still provide it unchanged.)

// Arrays
normalizedIngredients: [{raw, quantity, unit, item, preparation, isOptional, isToolOrConsumable, emoji (single Unicode emoji character matching the ingredient - REQUIRED for each ingredient), nutrition: {calories, protein, carbohydrates, fat, fiber}, groceryMapping: {name, aisle, packageSize, category}}]
normalizedInstructions: [{stepNumber, text, ingredients[], tools[], timeMinutes, temperature: {value, scale: "F"|"C"}, stepType: "preheat"|"prep"|"cook"|"rest"|"chill"|"marinate"|"assemble"|"serve", donenessCue}]
cuisines: string[] (e.g. ["Italian", "Mediterranean"])
mealType: string[] (REQUIRED - ALWAYS assign at least one. Choose from: "Breakfast", "Lunch", "Dinner", "Snack", "Dessert", "Appetizer", "Side Dish", "Beverage", "Sauce", "Dip", "Marinade", "Rub". A recipe can have multiple types e.g. ["Dinner", "Side Dish"]. Never leave empty or null.)
allergens: string[] (only if present: "Shellfish", "Fish", "Gluten", "Dairy", "Peanuts", "Tree Nuts", "Soy", "Eggs", "Sesame", "Mustard", "Sulfites", "Nightshades")
cookingMethods: string[]
seasonTags: string[]
occasionTags: string[]
standardEquipment: string[] (common tools: knife, bowl, pan, etc)
specializedEquipment: string[] (advanced: food processor, sous vide, etc)
tips: [{type: "technique"|"storage"|"makeAhead"|"reheating"|"serving", text}] (3-5 items)
variations: [{type: "ingredient"|"flavor"|"protein"|"dietary", title, description}] (2-4 items)
servingSuggestions: string[] (2-3 items)
aiEnrichmentFields: string[]

// Beverage pairings
beveragePairings: {
  wines: [{name: string, styleOrVarietal: string, tastingNotes: string (optional), rationale: string}] (3+ items or empty)
  beers: [{name: string, styleOrVarietal: string, tastingNotes: string (optional), rationale: string}] (3+ items or empty)
  cocktails: [{name: string, ingredients: string[], rationale: string}] (2-3 items or empty)
  nonAlcoholic: [{name: string, description: string, rationale: string}] (2-3 items)
}

// Recipe variations (REQUIRED - provide EXACTLY 3 items per category)
recipeVariations: {
  lowerCalorie: [{targetIngredient: string (which ingredient to replace), replacement: string (what to use instead), reason: string (why this reduces calories), impactSummary: string (estimated calorie savings)}] (EXACTLY 3 items)
  higherProtein: [{targetIngredient: string, replacement: string, reason: string (why this adds protein), impactSummary: string (estimated protein increase)}] (EXACTLY 3 items)
  michelinUpgrade: [{focus: "presentation"|"technique"|"ingredient", recommendation: string (specific enhancement to elevate the dish), rationale: string (why this makes it restaurant-quality)}] (EXACTLY 3 items - one for each focus type)
  budgetFriendly: [{targetIngredient: string, replacement: string, reason: string (why this is cheaper), impactSummary: string (estimated cost savings)}] (EXACTLY 3 items)
}

// Cultural significance (REQUIRED - 2+ paragraphs with fun facts)
culturalSignificance: string (At least 2 paragraphs about the dish's history, origins, cultural importance, and little-known fun facts about the cooking methods, ingredients, and traditions. Include interesting trivia that home cooks would enjoy learning.)

// Celebrity chef reviews (REQUIRED - exactly 3 reviews)
// IMPORTANT: Each review MUST reference specific aspects of THIS recipe including:
// - At least 2 specific ingredients from the recipe
// - At least 1 cooking technique or method used
// - The flavor profile or texture outcomes
// - Constructive suggestions for improvement or praise for what works
celebrityChefReviews: [
  {
    chefName: "Gordon Ramsay",
    philosophy: "Technique",
    score: number (1-10, based on: freshness of ingredients, classical technique, proper seasoning, meat resting, simplicity vs over-fussy presentation),
    review: string (3-4 sentences in Gordon Ramsay's voice. MUST specifically critique the cooking techniques in this recipe - mention the specific methods like searing, braising, roasting, etc. Reference 2+ specific ingredients and whether they're being used properly. Use British expressions naturally: "Right, so...", "Look,", "bloody", "stunning", "beautiful". Be specific about what works or doesn't: "The way you're browning that chicken is spot on" or "You're overcooking the garlic - that's going to turn bitter". For low scores: be direct but constructive. For high scores: genuine respect for technique.)
  },
  {
    chefName: "Ina Garten",
    philosophy: "Quality/Ease",
    score: number (1-10, based on: quality ingredients like "good olive oil" or "real vanilla", accessibility for home cooks, stress-free entertaining, comfort food appeal),
    review: string (3-4 sentences in Ina Garten's warm, conversational voice. MUST mention specific ingredients from this recipe and comment on their quality - reference "good [ingredient]" or "store-bought is fine" where appropriate. Discuss whether this recipe works for entertaining or weeknight cooking. Mention Jeffrey or guests naturally: "Jeffrey would love this" or "This is perfect when friends come over". Use signature phrases organically: "How easy is that?", "The secret is...", "Trust me on this". Be specific about the recipe's accessibility and what home cooks will appreciate.)
  },
  {
    chefName: "Matty Matheson",
    philosophy: "Flavor/Fat",
    score: number (1-10, based on: amount of butter/oil/cream/cheese, bold flavors, street food vibes, nostalgia factor, family-style cooking - penalize "white tablecloth" fancy foam/reduction dishes),
    review: string (3-4 sentences in Matty Matheson's enthusiastic voice. Use normal sentence case but emphasize KEY WORDS with caps: "This is ABSOLUTELY crushing it" or "We're talking SERIOUS flavor". MUST discuss the specific fats/oils used, the flavor intensity, and comfort food factor. Reference specific ingredients and techniques. Use his energy and slang naturally: "Let's GO", "This is what I'm talking about", "absolutely crushing", "heavy hitter", "this slaps". For low scores: "Where's the butter? Where's the love?" For high scores: celebrate the indulgence and bold flavors with genuine excitement about specific elements.)
  }
]

// Numeric scalars
servings: number (REQUIRED - infer from ingredient quantities if not stated)
prepTimeMinutes: number
cookTimeMinutes: number
totalTimeMinutes: number
calories: number (per serving)
protein: number (grams per serving)
carbohydrates: number (grams per serving)
fat: number (grams per serving)
fiber: number (grams per serving)
sugar: number (grams per serving)
sodium: number (mg per serving)
cholesterol: number (mg per serving)
priceRangeMin: number (USD, total recipe cost minimum)
priceRangeMax: number (USD, total recipe cost maximum)
totalCost: number (USD, midpoint estimate)
costExcludingStaples: number (USD, excluding salt, pepper, oil, flour)
healthScore: number (0-100, based on nutritional balance)
skillLevel: string ("Beginner"|"Intermediate"|"Advanced")
skillLevelExplanation: string
priceCategory: string ("$"|"$$"|"$$$")
healthScoreJustification: string

// Boolean dietary flags (analyze ingredients carefully)
isVegetarian: boolean
isVegan: boolean
isPescatarian: boolean
isGlutenFree: boolean
isDairyFree: boolean
isKeto: boolean
isPaleo: boolean
isLowCarb: boolean
isHighProtein: boolean
isLowCalorie: boolean
isHighFiber: boolean
isLactoVegetarian: boolean
isMediterranean: boolean
isOvoVegetarian: boolean
isOvoLactoVegetarian: boolean
isFlexitarian: boolean
isCarnivore: boolean
isKosher: boolean
isHalal: boolean
isHindu: boolean

CRITICAL RULES:
1. Analyze the recipe carefully and return ALL fields at the top level
2. Calculate accurate nutrition per serving based on ingredients
3. Determine dietary flags based on actual ingredient analysis
4. Infer servings from ingredient quantities if not explicitly stated
5. celebrityChefReviews is REQUIRED - generate exactly 3 reviews with unique chef personalities
6. Return valid JSON only`;

  const startTime = Date.now();

  try {
    console.log("[Gemini] Starting recipe enrichment...");

    const result = await model.generateContent(prompt);
    const response = result.response;
    const text = response.text();

    const elapsed = Date.now() - startTime;
    console.log(`[Gemini] Enrichment completed in ${elapsed}ms`);

    // Parse JSON with repair for truncated responses
    let parsed: GeminiEnrichmentResult;
    try {
      const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/) || text.match(/\{[\s\S]*\}/);
      const jsonStr = jsonMatch ? (jsonMatch[1] || jsonMatch[0]) : text;
      parsed = JSON.parse(jsonStr) as GeminiEnrichmentResult;
    } catch (parseError) {
      console.log(`[Gemini] Initial JSON parse failed, attempting repair...`);
      const repairedJson = repairJson(text);
      parsed = JSON.parse(repairedJson) as GeminiEnrichmentResult;
      console.log(`[Gemini] JSON repair successful`);
    }

    console.log(`[Gemini] Enrichment result: ${Object.keys(parsed).length} fields`);
    console.log(`[Gemini] Critical fields - calories: ${parsed.calories}, healthScore: ${parsed.healthScore}, tips: ${parsed.tips?.length}`);

    return parsed;
  } catch (error) {
    const elapsed = Date.now() - startTime;
    console.error(`[Gemini] Enrichment failed after ${elapsed}ms:`, error);
    throw error;
  }
}

// ============ Image Generation (Phase 3) ============

export interface GeminiImageContext {
  instructions?: Array<{ step: string }> | string[];
  cookingMethods?: string[];
  cuisines?: string[];
  mealType?: string[];
  skillLevel?: string;
  description?: string;
}

export async function generateRecipeImageWithGemini(
  recipeName: string,
  cuisines: string[],
  cookingMethods: string[],
  context?: GeminiImageContext
): Promise<string> {
  if (!genAI) {
    throw new Error("Gemini API not configured");
  }

  const model = genAI.getGenerativeModel({ model: GEMINI_IMAGE_MODEL });

  const cuisineStr = cuisines.length > 0 ? cuisines.join(" and ") : "";
  const methodsStr = cookingMethods.length > 0 ? `, ${cookingMethods.join(" and ")}` : "";

  let mealContext = "";
  if (context?.mealType && context.mealType.length > 0) {
    const meal = context.mealType[0].toLowerCase();
    if (meal === "breakfast") mealContext = " served as a breakfast dish";
    else if (meal === "dessert") mealContext = " presented as an elegant dessert";
    else if (meal === "appetizer") mealContext = " presented as a refined appetizer";
    else if (meal === "beverage") mealContext = " served in an appropriate glass or cup";
    else if (meal === "sauce" || meal === "dip" || meal === "marinade" || meal === "rub") mealContext = ` presented in a small bowl or ramekin as a ${meal}`;
    else if (meal === "side dish") mealContext = " served as a side dish";
    else if (meal === "snack") mealContext = " presented as an appetizing snack";
  }

  let platingStyle = "home-style";
  if (context?.skillLevel) {
    const skill = context.skillLevel.toLowerCase();
    if (skill.includes("advanced")) platingStyle = "Michelin-star";
    else if (skill.includes("intermediate")) platingStyle = "restaurant-quality";
  }

  const cuisinePresentation = cuisineStr ? ` Authentic ${cuisineStr} presentation.` : "";

  const prompt = `Generate a professional food photograph of the FINISHED, FULLY COOKED ${recipeName}${methodsStr}${mealContext}. Show ONLY the final plated result — the complete dish as it would arrive at the table, ready to eat.${cuisinePresentation} ${platingStyle} plating on appropriate dinnerware. Soft natural side lighting, shallow depth of field, appetizing warm colors. Photorealistic, high-resolution, food magazine cover quality. CRITICAL: Do NOT show any raw ingredients, cutting boards, prep bowls, cooking process, or individual uncooked components. Show ONLY the finished, assembled, ready-to-serve dish.`;

  const startTime = Date.now();

  try {
    console.log(`[Gemini] Generating image for: ${recipeName}`);

    // Use proper SDK format: pass generationConfig inside generateContent call
    const result = await model.generateContent({
      contents: [{
        role: "user",
        parts: [{ text: prompt }]
      }],
      generationConfig: {
        // @ts-ignore - responseModalities may not be in types yet
        responseModalities: ["TEXT", "IMAGE"],
      } as any,
    });
    const response = result.response;

    // Extract image from response
    const parts = response.candidates?.[0]?.content?.parts;
    if (!parts) {
      throw new Error("No image data in response");
    }

    for (const part of parts) {
      if ((part as any).inlineData) {
        const inlineData = (part as any).inlineData;
        const elapsed = Date.now() - startTime;
        const sizeKB = Math.round((inlineData.data.length * 3) / 4 / 1024);
        console.log(`[Gemini] Image generated in ${elapsed}ms (${sizeKB}KB)`);
        return inlineData.data; // Base64 encoded image
      }
    }

    throw new Error("No image found in Gemini response");
  } catch (error) {
    const elapsed = Date.now() - startTime;
    console.error(`[Gemini] Image generation failed after ${elapsed}ms:`, error);
    throw error;
  }
}

// ============ Social Media Caption Extraction ============

export interface SocialRecipeExtractionResult {
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
  inferredFields?: string[];
  hasEnoughContext: boolean;
}

export async function extractRecipeFromSocialPostWithGemini(
  caption: string,
  platform: string
): Promise<SocialRecipeExtractionResult | null> {
  if (!genAI) {
    throw new Error("Gemini API not configured");
  }

  const model = genAI.getGenerativeModel({ 
    model: GEMINI_TEXT_MODEL,
    generationConfig: {
      responseMimeType: "application/json",
    },
  });

  const prompt = `You are an expert chef and recipe analyst who extracts and completes recipe information from ${platform} post captions.

Your task is to extract recipe data AND fill in any missing components using your culinary expertise:

1. EXTRACT what's explicitly in the caption (ingredients, instructions, title, etc.)
2. INFER missing components based on what's available:
   - If title is missing: Generate a descriptive title from the ingredients/instructions
   - If ingredients are missing but instructions exist: Infer likely ingredients from the cooking steps
   - If instructions are missing but ingredients exist: Create logical cooking steps based on the ingredients
   - If both are partially available: Complete them based on culinary best practices

IMPORTANT: Always provide complete recipes. Never leave rawIngredients or rawInstructions empty if there's ANY food-related content.

Clean up promotional content like "Comment X and I'll DM you", "Link in bio", hashtag lists, or emoji spam.

TEXT:
${caption}

Return JSON with this exact structure:
{
  "title": "Recipe name (always provide one)",
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

  try {
    console.log(`[Gemini] Extracting recipe from ${platform} caption...`);

    const result = await model.generateContent(prompt);
    const response = result.response;
    const responseText = response.text();

    const elapsed = Date.now() - startTime;
    console.log(`[Gemini] Social post extraction completed in ${elapsed}ms`);

    // Parse JSON
    const jsonMatch = responseText.match(/```json\s*([\s\S]*?)\s*```/) || responseText.match(/\{[\s\S]*\}/);
    const jsonStr = jsonMatch ? (jsonMatch[1] || jsonMatch[0]) : responseText;
    const parsed = JSON.parse(jsonStr) as SocialRecipeExtractionResult;

    // Log inferred fields
    if (parsed.inferredFields && parsed.inferredFields.length > 0) {
      console.log(`[Gemini] AI inferred these fields: ${parsed.inferredFields.join(", ")}`);
    }

    return parsed;
  } catch (error) {
    const elapsed = Date.now() - startTime;
    console.error(`[Gemini] Social post extraction failed after ${elapsed}ms:`, error);
    throw error;
  }
}

export async function extractRecipeFromTextWithGemini(
  text: string
): Promise<ExtractedRecipeRaw> {
  if (!genAI) {
    throw new Error("Gemini API not configured");
  }

  const model = genAI.getGenerativeModel({ 
    model: GEMINI_TEXT_MODEL,
    generationConfig: {
      responseMimeType: "application/json",
    },
  });

  const prompt = `You are a recipe extraction assistant. Extract recipe data from the provided social media caption and return it in JSON format.

TEXT:
${text}

Return JSON with this exact structure:
{
  "title": "Recipe name",
  "ingredients": ["ingredient 1", "ingredient 2", ...],
  "instructions": ["step 1", "step 2", ...],
  "servings": number,
  "prepTimeMinutes": number or null,
  "cookTimeMinutes": number or null,
  "calories": number or null
}

Important:
- Extract ingredients as written (with quantities)
- Extract instructions as separate steps
- Estimate times if not explicitly stated
- Return null for fields you cannot determine
- If this doesn't appear to be a recipe, return null for all fields except an error message in title`;

  const startTime = Date.now();

  try {
    console.log("[Gemini] Extracting recipe from text...");

    const result = await model.generateContent(prompt);
    const response = result.response;
    const responseText = response.text();

    const elapsed = Date.now() - startTime;
    console.log(`[Gemini] Text extraction completed in ${elapsed}ms`);

    // Parse JSON
    const jsonMatch = responseText.match(/```json\s*([\s\S]*?)\s*```/) || responseText.match(/\{[\s\S]*\}/);
    const jsonStr = jsonMatch ? (jsonMatch[1] || jsonMatch[0]) : responseText;
    const parsed = JSON.parse(jsonStr) as ExtractedRecipeRaw;

    return parsed;
  } catch (error) {
    const elapsed = Date.now() - startTime;
    console.error(`[Gemini] Text extraction failed after ${elapsed}ms:`, error);
    throw error;
  }
}

// ============ Pantry Scan with Gemini ============

export interface PantryItem {
  name: string;
  quantity: number;
  unit: string;
  category: string;
  emoji: string;
}

export async function scanPantryWithGemini(imageBase64: string): Promise<PantryItem[]> {
  if (!genAI) {
    throw new Error("Gemini API not configured");
  }

  const model = genAI.getGenerativeModel({ model: GEMINI_TEXT_MODEL });

  const prompt = `You are a pantry inventory assistant. Analyze the image of a refrigerator, pantry, or food storage area and identify all visible food items.

For each item, provide:
- name: The common name of the food item
- quantity: Estimated quantity if visible (number)
- unit: The unit for the quantity (e.g., "count", "lbs", "oz", "packages")
- category: Category like "Dairy", "Produce", "Meat", "Beverages", "Condiments", "Grains", "Snacks", "Frozen", "Canned", "Baking", "Other"
- emoji: A relevant food emoji

Return a JSON object with an "items" array. Example:
{
  "items": [
    { "name": "Milk", "quantity": 1, "unit": "gallon", "category": "Dairy", "emoji": "🥛" },
    { "name": "Eggs", "quantity": 12, "unit": "count", "category": "Dairy", "emoji": "🥚" },
    { "name": "Apples", "quantity": 5, "unit": "count", "category": "Produce", "emoji": "🍎" }
  ]
}

Be thorough but realistic - only include items you can clearly see or reasonably infer from the image.`;

  const startTime = Date.now();

  try {
    console.log("[Gemini] Starting pantry scan...");

    // Optimize image
    const optimized = await optimizeImageForVision(imageBase64);

    const result = await model.generateContent([
      { text: prompt },
      {
        inlineData: {
          mimeType: optimized.mimeType,
          data: optimized.data,
        },
      },
    ]);

    const response = result.response;
    const text = response.text();

    const elapsed = Date.now() - startTime;
    console.log(`[Gemini] Pantry scan completed in ${elapsed}ms`);

    // Parse JSON
    const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/) || text.match(/\{[\s\S]*\}/);
    const jsonStr = jsonMatch ? (jsonMatch[1] || jsonMatch[0]) : text;
    const parsed = JSON.parse(jsonStr);

    return parsed.items || [];
  } catch (error) {
    const elapsed = Date.now() - startTime;
    console.error(`[Gemini] Pantry scan failed after ${elapsed}ms:`, error);
    throw error;
  }
}

// ============ Voice/Text Ingredient Parsing with Gemini ============

interface ParsedVoiceIngredient {
  name: string;
  quantity?: number;
  unit?: string;
  category?: string;
}

export async function parseVoiceIngredientsWithGemini(transcript: string): Promise<ParsedVoiceIngredient[]> {
  if (!genAI) {
    throw new Error("Gemini API not configured");
  }

  const model = genAI.getGenerativeModel({ model: GEMINI_TEXT_MODEL });

  const prompt = `You are a pantry inventory assistant. A user has spoken aloud the ingredients they have on hand. Parse their natural speech into a structured list of individual pantry items.

The user said: "${transcript}"

For each ingredient mentioned, extract:
- name: The common name of the food item (clean, normalized - e.g. "chicken breasts" not "some chicken breasts")
- quantity: The quantity if mentioned (number), omit if not stated
- unit: The unit if mentioned (e.g. "lbs", "oz", "cups", "pcs", "bunch", "can", "bag", "bottle", "box", "pack"), omit if not stated
- category: Best-fit category from: "produce", "dairy", "meat", "seafood", "bakery", "frozen", "canned", "dry-goods", "condiments", "beverages", "snacks", "other"

Important:
- Split compound mentions into separate items (e.g. "salt and pepper" → two items)
- Handle casual speech patterns like "a couple of", "some", "a bunch of", "like 3 or 4"
- "a couple" = 2, "a few" = 3, "a dozen" = 12, "half a" = 0.5
- Ignore filler words, pleasantries, or non-ingredient content
- If someone says something vague like "some spices" try to keep it as one item called "assorted spices"

Return a JSON object with an "items" array. Example:
{
  "items": [
    { "name": "chicken breasts", "quantity": 2, "unit": "lbs", "category": "meat" },
    { "name": "rice", "quantity": 1, "unit": "bag", "category": "dry-goods" },
    { "name": "bell peppers", "quantity": 3, "unit": "pcs", "category": "produce" },
    { "name": "soy sauce", "category": "condiments" }
  ]
}`;

  const startTime = Date.now();

  try {
    console.log("[Gemini] Parsing voice ingredients transcript...");

    const result = await model.generateContent([{ text: prompt }]);

    const response = result.response;
    const text = response.text();

    const elapsed = Date.now() - startTime;
    console.log(`[Gemini] Voice ingredient parsing completed in ${elapsed}ms`);

    const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/) || text.match(/\{[\s\S]*\}/);
    const jsonStr = jsonMatch ? (jsonMatch[1] || jsonMatch[0]) : text;
    const parsed = JSON.parse(jsonStr);

    return parsed.items || [];
  } catch (error) {
    const elapsed = Date.now() - startTime;
    console.error(`[Gemini] Voice ingredient parsing failed after ${elapsed}ms:`, error);
    throw error;
  }
}

// ============ Natural Language Query Parsing with Gemini ============

export async function parseQueryWithGemini(query: string, systemPrompt: string): Promise<any> {
  if (!genAI) {
    throw new Error("Gemini API not configured");
  }

  const model = genAI.getGenerativeModel({ model: GEMINI_TEXT_MODEL });

  const startTime = Date.now();

  try {
    console.log("[Gemini] Parsing search query...");

    const result = await model.generateContent([
      { text: systemPrompt },
      { text: query }
    ]);

    const response = result.response;
    const text = response.text();

    const elapsed = Date.now() - startTime;
    console.log(`[Gemini] Query parsing completed in ${elapsed}ms`);

    // Parse JSON
    const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/) || text.match(/\{[\s\S]*\}/);
    const jsonStr = jsonMatch ? (jsonMatch[1] || jsonMatch[0]) : text;
    return JSON.parse(jsonStr);
  } catch (error) {
    const elapsed = Date.now() - startTime;
    console.error(`[Gemini] Query parsing failed after ${elapsed}ms:`, error);
    throw error;
  }
}

// ============ Text Response Generation with Gemini ============

export async function generateTextWithGemini(systemPrompt: string, userPrompt: string): Promise<string> {
  if (!genAI) {
    throw new Error("Gemini API not configured");
  }

  const model = genAI.getGenerativeModel({ model: GEMINI_TEXT_MODEL });

  const startTime = Date.now();

  try {
    console.log("[Gemini] Generating text response...");

    const result = await model.generateContent([
      { text: systemPrompt },
      { text: userPrompt }
    ]);

    const response = result.response;
    const text = response.text();

    const elapsed = Date.now() - startTime;
    console.log(`[Gemini] Text generation completed in ${elapsed}ms`);

    return text.trim();
  } catch (error) {
    const elapsed = Date.now() - startTime;
    console.error(`[Gemini] Text generation failed after ${elapsed}ms:`, error);
    throw error;
  }
}

// ============ Recipe Variation Generation (Make Your Own) ============

export interface RecipeVariationRequest {
  originalRecipe: {
    title: string;
    description?: string;
    ingredients: string[];
    normalizedIngredients?: any[];
    instructions: string[];
    servings: number;
    prepTime?: string;
    cookTime?: string;
    totalTime?: string;
  };
  quickModifications: string[]; // e.g., ["low-calorie", "high-protein", "keto"]
  customInstructions?: string; // Free-text user instructions
  userName: string; // For title generation
}

export interface RecipeVariationResult {
  title: string;
  description: string;
  ingredients: string[];
  instructions: string[];
  servings: number;
  prepTime: string;
  cookTime: string;
  totalTime: string;
  variationNotes: string; // 1-2 sentence summary of changes
  appliedModifications: string[]; // Tags for what was changed
}

export async function generateRecipeVariationWithGemini(
  request: RecipeVariationRequest
): Promise<RecipeVariationResult> {
  if (!genAI) {
    throw new Error("Gemini API not configured");
  }

  const startTime = Date.now();
  console.log(`[Gemini] Generating recipe variation for: ${request.originalRecipe.title}`);
  console.log(`[Gemini] Modifications: ${request.quickModifications.join(", ")}${request.customInstructions ? " + custom" : ""}`);

  const model = genAI.getGenerativeModel({ 
    model: GEMINI_TEXT_MODEL,
    generationConfig: {
      responseMimeType: "application/json",
    },
  });

  const modificationsText = request.quickModifications.length > 0 
    ? `Apply these modifications: ${request.quickModifications.join(", ")}` 
    : "";
  
  const customText = request.customInstructions 
    ? `Additional user requests: ${request.customInstructions}` 
    : "";

  // Build ingredient list - use normalized ingredients for richer context if available
  let ingredientsList: string;
  if (request.originalRecipe.normalizedIngredients && request.originalRecipe.normalizedIngredients.length > 0) {
    // Use normalized ingredients with nutrition data for smarter substitutions
    ingredientsList = request.originalRecipe.normalizedIngredients.map((ni, idx) => {
      const parts = [`${idx + 1}. ${ni.originalText || ni.name}`];
      if (ni.quantity) parts.push(`(${ni.quantity} ${ni.unit || ''}`.trim() + ')');
      if (ni.calories) parts.push(`[${ni.calories} cal`);
      if (ni.protein) parts[parts.length - 1] += `, ${ni.protein}g protein`;
      if (ni.carbohydrates) parts[parts.length - 1] += `, ${ni.carbohydrates}g carb`;
      if (ni.fat) parts[parts.length - 1] += `, ${ni.fat}g fat`;
      if (ni.calories) parts[parts.length - 1] += ']';
      return parts.join(' ');
    }).join("\n");
    console.log(`[Gemini] Using ${request.originalRecipe.normalizedIngredients.length} normalized ingredients with nutrition data`);
  } else {
    // Fallback to raw ingredients
    ingredientsList = request.originalRecipe.ingredients.map((i, idx) => `${idx + 1}. ${i}`).join("\n");
  }

  const prompt = `You are a professional chef creating a personalized variation of a recipe. 
Transform the original recipe based on the requested modifications while maintaining the dish's essence.

ORIGINAL RECIPE:
Title: ${request.originalRecipe.title}
Description: ${request.originalRecipe.description || "N/A"}
Servings: ${request.originalRecipe.servings}
Prep Time: ${request.originalRecipe.prepTime || "N/A"}
Cook Time: ${request.originalRecipe.cookTime || "N/A"}
Total Time: ${request.originalRecipe.totalTime || "N/A"}

Ingredients (with nutrition data when available for smarter substitutions):
${ingredientsList}

Instructions:
${request.originalRecipe.instructions.map((i, idx) => `${idx + 1}. ${i}`).join("\n")}

REQUESTED MODIFICATIONS:
${modificationsText}
${customText}

MODIFICATION GUIDELINES:
- "low-calorie": Reduce calories by 30%+ through ingredient swaps, smaller portions of high-calorie items, or cooking method changes
- "high-protein": Increase protein significantly by adding/substituting protein sources
- "low-carb": Reduce carbohydrates by replacing starchy ingredients with low-carb alternatives
- "keto": Make keto-friendly (very low carb, high fat, moderate protein)
- "vegetarian": Remove all meat and fish, substitute with vegetarian alternatives
- "vegan": Remove all animal products, substitute with plant-based alternatives

Return a JSON object with these exact fields:
{
  "title": "${request.originalRecipe.title} ${request.userName}'s Version",
  "description": "A brief appetizing description of this variation (1-2 sentences)",
  "ingredients": ["Full list of modified ingredients with quantities"],
  "instructions": ["Complete step-by-step instructions reflecting any changes"],
  "servings": number,
  "prepTime": "X minutes" or "X hours Y minutes",
  "cookTime": "X minutes" or "X hours Y minutes", 
  "totalTime": "X minutes" or "X hours Y minutes",
  "variationNotes": "1-2 sentences explaining what was changed and why (e.g., 'Swapped pasta for zucchini noodles and used Greek yogurt instead of cream to reduce calories by approximately 40%.')",
  "appliedModifications": ["array", "of", "modification", "tags", "that", "were", "applied"]
}

IMPORTANT:
- Keep the spirit of the original dish while making requested changes
- Make practical substitutions that taste good
- Update cooking times if methods change
- Be specific about quantities in ingredients
- The variationNotes should be conversational and helpful`;

  try {
    const result = await model.generateContent(prompt);
    const response = result.response;
    const text = response.text();

    const elapsed = Date.now() - startTime;
    console.log(`[Gemini] Recipe variation generated in ${elapsed}ms`);

    // Parse the JSON response
    const cleanedJson = repairJson(text);
    const parsed = JSON.parse(cleanedJson) as RecipeVariationResult;

    // Validate required fields
    if (!parsed.title || !parsed.ingredients || !parsed.instructions) {
      throw new Error("Invalid variation response: missing required fields");
    }

    return parsed;
  } catch (error) {
    const elapsed = Date.now() - startTime;
    console.error(`[Gemini] Recipe variation failed after ${elapsed}ms:`, error);
    throw error;
  }
}

// ============ Test Comparison Function ============

export interface GeminiTestResult {
  available: boolean;
  textModel: string;
  imageModel: string;
  enrichmentTest?: {
    success: boolean;
    durationMs: number;
    fieldsReturned?: number;
    calories?: number;
    healthScore?: number;
    error?: string;
  };
  imageTest?: {
    success: boolean;
    durationMs: number;
    imageSizeBytes?: number;
    error?: string;
  };
}

export async function testGeminiCapabilities(): Promise<GeminiTestResult> {
  const result: GeminiTestResult = {
    available: hasGemini,
    textModel: GEMINI_TEXT_MODEL,
    imageModel: GEMINI_IMAGE_MODEL,
  };

  if (!hasGemini || !genAI) {
    return result;
  }

  // Test enrichment with a simple recipe
  const testRecipe: ExtractedRecipeRaw = {
    title: "Simple Pasta",
    ingredients: [
      "1 lb spaghetti",
      "2 tbsp olive oil",
      "4 cloves garlic, minced",
      "1/4 tsp red pepper flakes",
      "1/2 cup parmesan cheese",
      "Salt and pepper to taste",
    ],
    instructions: [
      "Boil pasta according to package directions",
      "Heat olive oil in a pan, add garlic and red pepper flakes",
      "Cook until fragrant, about 1 minute",
      "Toss pasta with garlic oil and parmesan",
      "Season with salt and pepper",
    ],
    servings: 4,
  };

  // Test enrichment
  try {
    const enrichStart = Date.now();
    const enriched = await enrichRecipeWithGemini(testRecipe);
    const enrichDuration = Date.now() - enrichStart;

    result.enrichmentTest = {
      success: true,
      durationMs: enrichDuration,
      fieldsReturned: Object.keys(enriched).length,
      calories: enriched.calories,
      healthScore: enriched.healthScore,
    };
  } catch (error: any) {
    result.enrichmentTest = {
      success: false,
      durationMs: 0,
      error: error.message,
    };
  }

  // Test image generation
  try {
    const imageStart = Date.now();
    const imageBase64 = await generateRecipeImageWithGemini(
      "Simple Garlic Pasta",
      ["Italian"],
      ["boil", "sauté"]
    );
    const imageDuration = Date.now() - imageStart;

    result.imageTest = {
      success: true,
      durationMs: imageDuration,
      imageSizeBytes: Math.round((imageBase64.length * 3) / 4),
    };
  } catch (error: any) {
    result.imageTest = {
      success: false,
      durationMs: 0,
      error: error.message,
    };
  }

  return result;
}
