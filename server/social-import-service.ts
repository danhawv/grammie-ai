import OpenAI from "openai";

const APIFY_API_KEY = process.env.APIFY_API_KEY;

// Use Replit AI Integrations OpenAI
const hasOpenAI = !!(process.env.AI_INTEGRATIONS_OPENAI_BASE_URL && process.env.AI_INTEGRATIONS_OPENAI_API_KEY);
const openai = hasOpenAI
  ? new OpenAI({
      baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
      apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
    })
  : null;

// ============ Platform Detection ============

export type PlatformType = "instagram" | "tiktok" | "web";

export function detectPlatform(url: string): PlatformType {
  const lowerUrl = url.toLowerCase();
  
  if (lowerUrl.includes("instagram.com") && (lowerUrl.includes("/p/") || lowerUrl.includes("/reel/"))) {
    return "instagram";
  }
  
  // Support both full URLs (/video/) and short share links (/t/)
  if (lowerUrl.includes("tiktok.com") && (lowerUrl.includes("/video/") || lowerUrl.includes("/t/"))) {
    return "tiktok";
  }
  
  // Default to generic web scraping
  return "web";
}

export function isValidSocialUrl(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

// ============ Shared Types ============

export interface SocialPost {
  platform: PlatformType;
  id: string;
  caption: string;
  creatorUsername?: string;
  creatorDisplayName?: string;
  creatorAvatarUrl?: string;
  url: string;
  coverImageUrl?: string;
  postDate?: Date;
}

export interface ExtractedRecipeData {
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
  sourceType: PlatformType;
  creatorUsername?: string;
  inferredFields?: string[];
}

export interface ScrapeResult {
  success: boolean;
  post?: SocialPost;
  error?: string;
}

// ============ Instagram Scraper ============

interface InstagramApiPost {
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

async function scrapeInstagram(url: string): Promise<ScrapeResult> {
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
      `https://api.apify.com/v2/acts/apify~instagram-scraper/run-sync-get-dataset-items?token=${APIFY_API_KEY}`,
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

    const data = await response.json() as InstagramApiPost[];
    
    if (!data || data.length === 0) {
      return { success: false, error: "No data returned from Instagram. The post may be private or deleted." };
    }

    const post = data[0];
    
    if (!post.caption) {
      return { success: false, error: "This Instagram post has no caption. Recipes require a caption with ingredients and instructions." };
    }

    console.log(`[Instagram Scraper] Successfully scraped post: ${post.shortCode}`);
    
    return { 
      success: true, 
      post: {
        platform: "instagram",
        id: post.shortCode,
        caption: post.caption,
        creatorUsername: post.ownerUsername,
        url: post.url || normalizedUrl,
        coverImageUrl: post.displayUrl,
        postDate: post.timestamp ? new Date(post.timestamp) : undefined,
      }
    };
  } catch (error: any) {
    console.error(`[Instagram Scraper] Error:`, error);
    return { success: false, error: error.message || "Failed to scrape Instagram post" };
  }
}

// ============ TikTok Scraper ============

interface TikTokApiPost {
  id: string;
  text: string;
  textLanguage: string;
  createTime: number;
  authorMeta: {
    id: string;
    name: string;
    nickName: string;
    verified: boolean;
    signature: string;
    avatar: string;
  };
  webVideoUrl: string;
  videoMeta: {
    height: number;
    width: number;
    duration: number;
    coverUrl: string;
  };
}

function normalizeTikTokUrl(url: string): string | null {
  try {
    if (!url.includes("tiktok.com")) {
      return null;
    }

    const urlObj = new URL(url);
    const pathname = urlObj.pathname;

    // Match patterns like /@username/video/1234567890
    const videoMatch = pathname.match(/\/@[\w.-]+\/video\/(\d+)/);
    if (videoMatch) {
      // Return clean URL without query params
      return `${urlObj.origin}${urlObj.pathname}`;
    }

    // Support short share links like /t/ZP8ySsfwK/
    const shortLinkMatch = pathname.match(/\/t\/[\w]+/);
    if (shortLinkMatch) {
      // Return the short link as-is - the scraper should handle redirects
      return url;
    }

    return null;
  } catch {
    return null;
  }
}

async function scrapeTikTok(url: string): Promise<ScrapeResult> {
  if (!APIFY_API_KEY) {
    return { success: false, error: "Apify API key not configured" };
  }

  const normalizedUrl = normalizeTikTokUrl(url);
  if (!normalizedUrl) {
    return { success: false, error: "Invalid TikTok URL. Please provide a valid TikTok video URL." };
  }

  try {
    console.log(`[TikTok Scraper] Scraping: ${normalizedUrl}`);
    
    const response = await fetch(
      `https://api.apify.com/v2/acts/clockworks~tiktok-video-scraper/run-sync-get-dataset-items?token=${APIFY_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          postURLs: [normalizedUrl],
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[TikTok Scraper] Apify API error: ${response.status} - ${errorText}`);
      return { success: false, error: `Failed to scrape TikTok video: ${response.status}` };
    }

    const data = await response.json() as TikTokApiPost[];
    
    if (!data || data.length === 0) {
      return { success: false, error: "No data returned from TikTok. The video may be private or deleted." };
    }

    const post = data[0];
    
    if (!post.text) {
      return { success: false, error: "This TikTok video has no caption. Recipes require a caption with ingredients and instructions." };
    }

    console.log(`[TikTok Scraper] Successfully scraped video: ${post.id}`);
    
    return { 
      success: true, 
      post: {
        platform: "tiktok",
        id: post.id,
        caption: post.text,
        creatorUsername: post.authorMeta?.name,
        creatorDisplayName: post.authorMeta?.nickName,
        creatorAvatarUrl: post.authorMeta?.avatar,
        url: post.webVideoUrl || normalizedUrl,
        coverImageUrl: post.videoMeta?.coverUrl,
        postDate: post.createTime ? new Date(post.createTime * 1000) : undefined,
      }
    };
  } catch (error: any) {
    console.error(`[TikTok Scraper] Error:`, error);
    return { success: false, error: error.message || "Failed to scrape TikTok video" };
  }
}

// ============ Unified Scraper ============

export async function scrapePost(url: string): Promise<ScrapeResult> {
  const platform = detectPlatform(url);
  
  switch (platform) {
    case "instagram":
      return scrapeInstagram(url);
    case "tiktok":
      return scrapeTikTok(url);
    case "web":
      return { success: false, error: "Web URL scraping should use the existing URL import feature." };
    default:
      return { success: false, error: "Unsupported platform" };
  }
}

// ============ Shared AI Recipe Extraction ============

export async function extractRecipeFromSocialPost(post: SocialPost): Promise<ExtractedRecipeData | null> {
  if (!hasOpenAI || !openai) {
    console.error(`[Social Recipe Extract] OpenAI not configured`);
    return null;
  }
  
  const platformName = post.platform === "instagram" ? "Instagram" : "TikTok";
  
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

  try {
    console.log(`[Social Recipe Extract] Processing ${post.platform} post ${post.id}`);
    
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
      console.error(`[Social Recipe Extract] No response from OpenAI`);
      return null;
    }

    const parsed = JSON.parse(content);
    
    // Check if the AI determined there's not enough food-related content
    if (parsed.hasEnoughContext === false) {
      console.error(`[Social Recipe Extract] No food/recipe content found in caption`);
      console.error(`[Social Recipe Extract] Caption preview: ${post.caption.substring(0, 200)}...`);
      return null;
    }
    
    // Log any fields that were inferred by the AI
    if (parsed.inferredFields && parsed.inferredFields.length > 0) {
      console.log(`[Social Recipe Extract] AI inferred these fields: ${parsed.inferredFields.join(", ")}`);
    }
    
    // Final validation - ensure we have the essential fields
    if (!parsed.title || !parsed.rawIngredients || parsed.rawIngredients.length === 0 || 
        !parsed.rawInstructions || parsed.rawInstructions.length === 0) {
      console.error(`[Social Recipe Extract] AI could not complete recipe - essential fields still missing`);
      console.error(`[Social Recipe Extract] Caption preview: ${post.caption.substring(0, 200)}...`);
      return null;
    }

    const recipeData: ExtractedRecipeData = {
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

    const inferredNote = recipeData.inferredFields && recipeData.inferredFields.length > 0 
      ? ` (AI completed: ${recipeData.inferredFields.join(", ")})` 
      : "";
    console.log(`[Social Recipe Extract] Successfully extracted: ${recipeData.title}${inferredNote}`);
    return recipeData;
  } catch (error: any) {
    console.error(`[Social Recipe Extract] Error:`, error);
    return null;
  }
}
