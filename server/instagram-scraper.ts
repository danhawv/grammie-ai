import OpenAI from "openai";

const APIFY_API_KEY = process.env.APIFY_API_KEY;
const APIFY_ACTOR_ID = "apify~instagram-scraper";

// Use Replit AI Integrations OpenAI (same as main openai.ts)
const hasOpenAI = !!(process.env.AI_INTEGRATIONS_OPENAI_BASE_URL && process.env.AI_INTEGRATIONS_OPENAI_API_KEY);
const openai = hasOpenAI
  ? new OpenAI({
      baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
      apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
    })
  : null;

interface InstagramPost {
  id: string;
  type: string;
  shortCode: string;
  caption: string;
  hashtags: string[];
  mentions: string[];
  url: string;
  commentsCount: number;
  displayUrl?: string;
  ownerUsername?: string;
  timestamp?: string;
}

interface InstagramScrapeResult {
  success: boolean;
  post?: InstagramPost;
  error?: string;
}

interface ExtractedRecipeData {
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
  sourceType: "instagram";
  creatorUsername?: string;
  inferredFields?: string[];
}

export async function scrapeInstagramPost(url: string): Promise<InstagramScrapeResult> {
  if (!APIFY_API_KEY) {
    return { success: false, error: "Apify API key not configured" };
  }

  const normalizedUrl = normalizeInstagramUrl(url);
  if (!normalizedUrl) {
    return { success: false, error: "Invalid Instagram URL. Please provide a valid Instagram post or reel URL." };
  }

  try {
    console.log(`[Instagram Scraper] Scraping: ${normalizedUrl}`);
    
    const response = await fetch(
      `https://api.apify.com/v2/acts/${APIFY_ACTOR_ID}/run-sync-get-dataset-items?token=${APIFY_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          directUrls: [normalizedUrl],
          resultsLimit: 1,
          resultsType: "posts",
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Instagram Scraper] Apify API error: ${response.status} - ${errorText}`);
      return { success: false, error: `Failed to scrape Instagram post: ${response.status}` };
    }

    const data = await response.json() as InstagramPost[];
    
    if (!data || data.length === 0) {
      return { success: false, error: "No data returned from Instagram. The post may be private or deleted." };
    }

    const post = data[0];
    
    if (!post.caption) {
      return { success: false, error: "This Instagram post has no caption. Recipes require a caption with ingredients and instructions." };
    }

    // Enhanced logging for debugging extraction issues
    console.log(`[Instagram Scraper] Successfully scraped post: ${post.shortCode}`);
    console.log(`[Instagram Scraper] Creator: @${post.ownerUsername || 'unknown'}`);
    console.log(`[Instagram Scraper] Caption length: ${post.caption.length} characters`);
    console.log(`[Instagram Scraper] Caption preview (first 500 chars):\n${post.caption.substring(0, 500)}`);
    if (post.caption.length > 500) {
      console.log(`[Instagram Scraper] Caption continues (last 300 chars):\n...${post.caption.substring(post.caption.length - 300)}`);
    }
    console.log(`[Instagram Scraper] Hashtags found: ${post.hashtags?.length || 0}`);
    
    return { success: true, post };
  } catch (error: any) {
    console.error(`[Instagram Scraper] Error:`, error);
    return { success: false, error: error.message || "Failed to scrape Instagram post" };
  }
}

function normalizeInstagramUrl(url: string): string | null {
  try {
    if (!url.includes("instagram.com")) {
      return null;
    }

    const urlObj = new URL(url);
    const pathname = urlObj.pathname;

    const postMatch = pathname.match(/^\/(p|reel)\/([A-Za-z0-9_-]+)/);
    if (postMatch) {
      return `https://www.instagram.com/${postMatch[1]}/${postMatch[2]}/`;
    }

    return null;
  } catch {
    return null;
  }
}

export async function extractRecipeFromInstagram(post: InstagramPost): Promise<ExtractedRecipeData | null> {
  if (!hasOpenAI || !openai) {
    console.error(`[Instagram Recipe Extract] OpenAI not configured`);
    return null;
  }
  
  const systemPrompt = `You are an expert chef and recipe analyst who extracts COMPLETE recipe information from Instagram post captions.

CRITICAL RULES FOR INGREDIENT EXTRACTION:
1. EXTRACT EVERY SINGLE INGREDIENT mentioned in the caption - do not skip any
2. Look for ingredients in ALL parts of the caption: ingredient lists, instructions, tips, and variations
3. Include quantities and measurements when provided (e.g., "2 cups flour", "1 lb chicken")
4. If an ingredient is mentioned in instructions but not in a list, STILL include it
5. Common ingredients that are often missed: salt, pepper, oil, butter, garlic, onion, water, seasoning
6. For compound ingredients (e.g., "taco seasoning"), include the full item
7. If the caption mentions "for the sauce" or "for the topping", extract those ingredients too

INGREDIENT INFERENCE RULES:
- If instructions mention "season" or "salt to taste", add "salt" and "black pepper" to ingredients
- If instructions mention "sear" or "fry", ensure cooking oil/fat is in ingredients
- If a dish clearly requires an ingredient not explicitly listed (e.g., tacos need tortillas), ADD IT

INSTRUCTION EXTRACTION:
- Extract step-by-step cooking instructions
- Convert casual language to clear steps
- If instructions are implied but not explicit, create logical cooking steps

COMPLETENESS CHECK:
Before finalizing, verify: Does this recipe have EVERYTHING needed to make the dish?
- All proteins/mains
- All vegetables/produce  
- All seasonings/spices
- All sauces/condiments
- All dairy/cheese
- All starches/grains
- Cooking fats/oils

Clean up promotional content like "Comment X and I'll DM you", "Link in bio", or hashtag lists.

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
  "inferredFields": ["list of fields you had to infer/complete - be specific about which ingredients were inferred"],
  "hasEnoughContext": true or false (false only if caption has no food/recipe content at all),
  "extractionNotes": "any notes about missing info or assumptions made"
}`;

  try {
    console.log(`[Instagram Recipe Extract] Processing caption for post ${post.shortCode}`);
    
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Extract recipe information from this Instagram caption:\n\n${post.caption}` }
      ],
      response_format: { type: "json_object" },
      temperature: 0.3,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      console.error(`[Instagram Recipe Extract] No response from OpenAI`);
      return null;
    }

    const parsed = JSON.parse(content);
    
    // Check if the AI determined there's not enough food-related content
    if (parsed.hasEnoughContext === false) {
      console.error(`[Instagram Recipe Extract] No food/recipe content found in caption`);
      console.error(`[Instagram Recipe Extract] Caption preview: ${post.caption.substring(0, 200)}...`);
      return null;
    }
    
    // Detailed extraction logging
    console.log(`[Instagram Recipe Extract] === EXTRACTION RESULTS ===`);
    console.log(`[Instagram Recipe Extract] Title: ${parsed.title}`);
    console.log(`[Instagram Recipe Extract] Ingredients extracted: ${parsed.rawIngredients?.length || 0}`);
    if (parsed.rawIngredients && parsed.rawIngredients.length > 0) {
      parsed.rawIngredients.forEach((ing: string, i: number) => {
        console.log(`[Instagram Recipe Extract]   ${i + 1}. ${ing}`);
      });
    }
    console.log(`[Instagram Recipe Extract] Instructions extracted: ${parsed.rawInstructions?.length || 0} steps`);
    
    // Log any fields that were inferred by the AI
    if (parsed.inferredFields && parsed.inferredFields.length > 0) {
      console.log(`[Instagram Recipe Extract] AI inferred these fields: ${parsed.inferredFields.join(", ")}`);
    }
    
    // Log extraction notes if provided
    if (parsed.extractionNotes) {
      console.log(`[Instagram Recipe Extract] Notes: ${parsed.extractionNotes}`);
    }
    
    // Final validation - ensure we have the essential fields
    if (!parsed.title || !parsed.rawIngredients || parsed.rawIngredients.length === 0 || 
        !parsed.rawInstructions || parsed.rawInstructions.length === 0) {
      console.error(`[Instagram Recipe Extract] AI could not complete recipe - essential fields still missing`);
      console.error(`[Instagram Recipe Extract] Caption preview: ${post.caption.substring(0, 200)}...`);
      return null;
    }

    // Helper to safely parse numbers from AI response (may return strings)
    const toNumber = (val: any): number | undefined => {
      if (val === null || val === undefined) return undefined;
      const num = Number(val);
      return isNaN(num) ? undefined : num;
    };

    const recipeData: ExtractedRecipeData = {
      title: parsed.title,
      description: parsed.description || "",
      rawIngredients: parsed.rawIngredients || [],
      rawInstructions: parsed.rawInstructions || [],
      servings: toNumber(parsed.servings),
      prepTimeMinutes: toNumber(parsed.prepTimeMinutes),
      cookTimeMinutes: toNumber(parsed.cookTimeMinutes),
      totalTimeMinutes: toNumber(parsed.totalTimeMinutes),
      cuisineType: parsed.cuisineType,
      mealType: parsed.mealType,
      difficulty: parsed.difficulty,
      dietaryTags: parsed.dietaryTags || [],
      nutritionInfo: parsed.nutritionInfo ? {
        calories: toNumber(parsed.nutritionInfo.calories),
        protein: toNumber(parsed.nutritionInfo.protein),
        carbs: toNumber(parsed.nutritionInfo.carbs),
        fat: toNumber(parsed.nutritionInfo.fat),
      } : undefined,
      sourceUrl: post.url,
      sourceType: "instagram",
      creatorUsername: post.ownerUsername,
      inferredFields: parsed.inferredFields || [],
    };

    const inferredNote = recipeData.inferredFields && recipeData.inferredFields.length > 0 
      ? ` (AI completed: ${recipeData.inferredFields.join(", ")})` 
      : "";
    console.log(`[Instagram Recipe Extract] Successfully extracted: ${recipeData.title}${inferredNote}`);
    return recipeData;
  } catch (error: any) {
    console.error(`[Instagram Recipe Extract] Error:`, error);
    return null;
  }
}

export function isInstagramUrl(url: string): boolean {
  return url.includes("instagram.com") && (url.includes("/p/") || url.includes("/reel/"));
}
