import OpenAI from "openai";
import * as cheerio from "cheerio";
import { applyEmojiDefaults } from "./emoji-fallback";
import {
  type NormalizedIngredient,
  type InstructionStep,
  type Tip,
  type Variation,
  type ValidationWarning,
  type BeveragePairings,
  type RecipeVariations,
  type CelebrityChefReviews,
  normalizedIngredientSchema,
  instructionStepSchema,
  tipSchema,
  variationSchema,
  beveragePairingsSchema,
  recipeVariationsSchema,
  celebrityChefReviewsSchema,
  deriveAllergenFreeTags,
  deriveTimeConvenienceTags,
  deriveGroceryAisleTags,
  deriveLegacyCuisine,
  deriveLegacyEquipment,
  deriveNutritionFlags,
} from "@shared/schema";
import { z } from "zod";

const hasOpenAI = !!(process.env.AI_INTEGRATIONS_OPENAI_BASE_URL && process.env.AI_INTEGRATIONS_OPENAI_API_KEY);

const openai = hasOpenAI
  ? new OpenAI({
      baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
      apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
    })
  : null;

// Phase 1: Extract recipe from image/URL - ONLY literally visible data
// All enrichment (nutrition, diet types, cuisine, etc.) happens in Phase 2
export interface ExtractedRecipeRaw {
  title?: string; // Optional - many handwritten recipes don't have titles
  description?: string;
  prepTime?: string; // Optional - might not be visible in handwritten recipes
  cookTime?: string;
  totalTime?: string; // Optional - might not be visible in handwritten recipes
  coolingTime?: string;
  servings?: number; // Optional - might not be visible in handwritten recipes (fallback: 4)
  servingUnit?: string;
  servingSize?: string; // Portion size like "8 oz", "1 cup", "200g"
  yield?: string;
  ingredients: string[];
  instructions: string[];
  equipment?: string[];
  
  // Legacy fields for URL extraction (JSON-LD may include these)
  // These are optional and will be re-analyzed in Phase 2 anyway
  dietType?: string[];
  cuisine?: string | string[];
  mealType?: string[];
  calories?: number;
  protein?: number;
  carbohydrates?: number;
  fat?: number;
  fiber?: number;
  sugar?: number;
  sodium?: number;
  cholesterol?: number;
}

export async function extractRecipeFromImage(
  imageBase64: string
): Promise<ExtractedRecipeRaw> {
  if (!hasOpenAI || !openai) {
    console.warn("OpenAI not configured - using mock extraction");
    return getMockExtractedRecipe();
  }

  try {
    console.log("Phase 1: Extracting recipe from image with Vision...");
    const response = await openai.chat.completions.create({
      model: "gpt-5",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `You are an expert at reading handwritten recipes. Carefully analyze this ENTIRE image and extract ALL text that is visible.

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

Return ONLY valid JSON. Include ALL ingredients and ALL instructions that are visible.`,
            },
            {
              type: "image_url",
              image_url: {
                url: `data:image/jpeg;base64,${imageBase64}`,
                detail: "high", // Use high-resolution mode for better OCR accuracy
              },
            },
          ],
        },
      ],
      response_format: { type: "json_object" },
      max_completion_tokens: 16384,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error("No response from OpenAI Vision");
    }

    console.log("Vision extraction raw response:", content);
    const parsed = JSON.parse(content) as ExtractedRecipeRaw;
    console.log("Parsed extraction result:", JSON.stringify(parsed, null, 2));
    
    return parsed;
  } catch (error) {
    console.error("Error in Vision extraction:", error);
    
    // If OpenAI is configured, re-throw errors so retry logic can work
    // Only fall back to mock data when OpenAI is intentionally disabled
    if (hasOpenAI && openai) {
      console.error("OpenAI Vision extraction failed - re-throwing to trigger retries");
      throw error;
    }
    
    // Fallback for when OpenAI is not configured (testing/development)
    console.warn("OpenAI not configured: Falling back to mock data");
    return getMockExtractedRecipe();
  }
}

// Phase 1 (Alternative): Extract recipe from MULTIPLE images (e.g., front and back of recipe card)
export async function extractRecipeFromMultipleImages(
  imagesBase64: string[]
): Promise<ExtractedRecipeRaw> {
  if (!hasOpenAI || !openai) {
    console.warn("OpenAI not configured - using mock extraction");
    return getMockExtractedRecipe();
  }

  try {
    console.log(`Phase 1: Extracting recipe from ${imagesBase64.length} images with Vision...`);
    
    // Build content array with all images
    const content: Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string; detail: "high" | "low" | "auto" } }> = [
      {
        type: "text",
        text: `You are an expert at reading handwritten recipes. You have been given ${imagesBase64.length} images that together form ONE COMPLETE recipe (e.g., front and back of a recipe card, or multiple pages).

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

Return ONLY valid JSON with the COMPLETE combined recipe from all images.`,
      },
    ];
    
    // Add all images to the content
    for (let i = 0; i < imagesBase64.length; i++) {
      content.push({
        type: "image_url",
        image_url: {
          url: `data:image/jpeg;base64,${imagesBase64[i]}`,
          detail: "high",
        },
      });
    }
    
    const response = await openai.chat.completions.create({
      model: "gpt-5",
      messages: [
        {
          role: "user",
          content: content,
        },
      ],
      response_format: { type: "json_object" },
      max_completion_tokens: 16384,
    });

    const responseContent = response.choices[0]?.message?.content;
    if (!responseContent) {
      throw new Error("No response from OpenAI Vision");
    }

    console.log("Multi-image Vision extraction raw response:", responseContent);
    const parsed = JSON.parse(responseContent) as ExtractedRecipeRaw;
    console.log("Parsed multi-image extraction result:", JSON.stringify(parsed, null, 2));
    
    return parsed;
  } catch (error) {
    console.error("Error in multi-image Vision extraction:", error);
    
    if (hasOpenAI && openai) {
      console.error("OpenAI Vision extraction failed - re-throwing to trigger retries");
      throw error;
    }
    
    console.warn("OpenAI not configured: Falling back to mock data");
    return getMockExtractedRecipe();
  }
}

// Phase 1 (Alternative): Extract recipe from URL using JSON-LD or AI
export async function extractRecipeFromUrl(
  url: string
): Promise<ExtractedRecipeRaw> {
  try {
    console.log(`Phase 1: Fetching recipe from URL: ${url}`);
    
    // Validate URL for security
    validateUrl(url);
    
    // Check if Instagram URL and handle specially
    if (url.includes('instagram.com')) {
      console.log("Instagram URL detected, using special handling...");
      return await extractInstagramRecipe(url);
    }
    
    // Fetch HTML content with timeout and size limits
    const html = await fetchUrlSafely(url);
    
    // Try to extract JSON-LD structured data first
    console.log("Attempting JSON-LD extraction...");
    const jsonLdRecipe = extractJsonLdRecipe(html);
    if (jsonLdRecipe) {
      console.log("Successfully extracted recipe from JSON-LD");
      
      // Sanity check the extracted data
      if (!validateExtractedRecipe(jsonLdRecipe)) {
        console.warn("JSON-LD data failed sanity check, falling back to AI");
      } else {
        return jsonLdRecipe;
      }
    }
    
    // Fall back to AI extraction if JSON-LD not available or invalid
    console.log("JSON-LD not found or invalid, falling back to AI extraction...");
    return await extractRecipeFromHtmlWithAI(html);
  } catch (error) {
    console.error("Error extracting recipe from URL:", error);
    throw error;
  }
}

// Helper: Extract recipe from Instagram post caption
async function extractInstagramRecipe(url: string): Promise<ExtractedRecipeRaw> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  
  try {
    console.log("Fetching Instagram page with meta tag extraction...");
    
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });
    
    if (!response.ok) {
      throw new Error(`Failed to fetch Instagram URL: ${response.status}`);
    }
    
    // Read response (limit to 512KB - enough for meta tags, not full page)
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error("Unable to read response");
    }
    
    const chunks: Uint8Array[] = [];
    let totalSize = 0;
    const maxSize = 512 * 1024; // 512KB should include all meta tags
    
    // Read up to size limit (don't try to detect </head> as it can be misleading)
    while (totalSize < maxSize) {
      const { done, value } = await reader.read();
      if (done) break;
      
      chunks.push(value);
      totalSize += value.length;
    }
    
    // Cancel remaining stream
    await reader.cancel();
    
    const decoder = new TextDecoder();
    const html = decoder.decode(Buffer.concat(chunks));
    
    // Extract caption from meta tags
    console.log(`Extracting caption from meta tags... (HTML size: ${html.length} chars)`);
    console.log(`Has og:description in HTML: ${html.includes('og:description')}`);
    console.log(`Has </head> in HTML: ${html.includes('</head>')}`);
    const caption = extractInstagramCaption(html);
    
    if (!caption) {
      console.log("Caption extraction failed - no caption found in meta tags");
      throw new Error("Could not extract recipe text from Instagram post. Please copy and paste the recipe text manually.");
    }
    
    console.log(`Extracted caption (${caption.length} chars), parsing with GPT-4...`);
    
    // Use GPT-4 to extract recipe from caption
    return await extractRecipeFromText(caption);
    
  } catch (error: any) {
    if (error.name === "AbortError") {
      throw new Error("Request timeout");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

// Helper: Extract caption from Instagram HTML meta tags
function extractInstagramCaption(html: string): string | null {
  try {
    const $ = cheerio.load(html);
    
    // Debug: check what meta tags exist
    const allMeta = $('meta').length;
    const ogMeta = $('meta[property^="og:"]').length;
    console.log(`Found ${allMeta} total meta tags, ${ogMeta} og: tags`);
    
    // Try og:description meta tag (most reliable for Instagram)
    const ogDesc = $('meta[property="og:description"]').attr('content');
    console.log(`og:description found: ${!!ogDesc}, length: ${ogDesc?.length || 0}`);
    
    if (ogDesc && ogDesc.length > 50) {
      // Decode HTML entities and clean up
      const decoded = $('<div>').html(ogDesc).text();
      console.log(`Extracted caption: ${decoded.substring(0, 200)}...`);
      return decoded;
    }
    
    // Try twitter:description
    const twitterDesc = $('meta[name="twitter:description"]').attr('content');
    if (twitterDesc && twitterDesc.length > 50) {
      const decoded = $('<div>').html(twitterDesc).text();
      return decoded;
    }
    
    // Try regular description meta tag
    const desc = $('meta[name="description"]').attr('content');
    if (desc && desc.length > 50) {
      const decoded = $('<div>').html(desc).text();
      return decoded;
    }
    
    return null;
  } catch (error) {
    console.error("Error extracting Instagram caption:", error);
    return null;
  }
}

// Extract recipe from plain text using GPT-4 (used for Instagram captions and pasted text)
export async function extractRecipeFromText(text: string): Promise<ExtractedRecipeRaw> {
  if (!openai) {
    throw new Error("OpenAI API is not configured");
  }
  
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: `You are a recipe extraction assistant. Extract recipe data from the provided text and return it in JSON format.

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
- If this doesn't appear to be a recipe, return null for all fields except an error message in title`
        },
        {
          role: "user",
          content: text
        }
      ],
      response_format: { type: "json_object" },
      max_completion_tokens: 4096,
    });
    
    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error("No response from GPT-4");
    }
    
    const parsed = JSON.parse(content) as ExtractedRecipeRaw;
    
    // Validate it looks like a recipe
    if (!parsed.title || !parsed.ingredients || parsed.ingredients.length === 0) {
      throw new Error("The text does not appear to contain a valid recipe. Please check the Instagram post contains recipe instructions.");
    }
    
    return parsed;
    
  } catch (error) {
    console.error("Error extracting recipe from text:", error);
    throw new Error("Could not parse recipe from text. Please ensure the Instagram post contains complete recipe instructions.");
  }
}

// Helper: Validate URL for security (prevent SSRF)
function validateUrl(url: string): void {
  let parsedUrl: URL;
  
  try {
    parsedUrl = new URL(url);
  } catch (error) {
    throw new Error("Invalid URL format");
  }
  
  // Only allow http and https
  if (!["http:", "https:"].includes(parsedUrl.protocol)) {
    throw new Error("Only HTTP and HTTPS protocols are allowed");
  }
  
  // Block private/loopback addresses (SSRF prevention with numeric encoding checks)
  const hostname = parsedUrl.hostname.toLowerCase();
  const blockedHosts = [
    "localhost",
    "127.0.0.1",
    "0.0.0.0",
    "::1",
    "[::1]",
    "127.1", // Short notation
    "0x7f000001", // Hex
    "2130706433", // Decimal
  ];
  
  if (blockedHosts.includes(hostname)) {
    throw new Error("Access to local/private addresses is not allowed");
  }
  
  // Block numeric IP encodings and private ranges
  if (
    hostname.startsWith("10.") ||
    hostname.startsWith("192.168.") ||
    hostname.match(/^172\.(1[6-9]|2[0-9]|3[0-1])\./) ||
    hostname.match(/^127\./) || // All 127.x.x.x
    hostname.match(/^0\./) || // 0.0.0.0/8
    hostname.match(/^169\.254\./) || // Link-local
    hostname.match(/^::/) || // IPv6 loopback
    hostname.match(/^\[::ffff:/) || // IPv6-mapped IPv4
    hostname.match(/^[0-9]+$/) || // Pure decimal
    hostname.match(/^0x[0-9a-f]+$/i) || // Hex notation
    hostname.match(/^0[0-7]+$/) // Octal notation
  ) {
    throw new Error("Access to private IP ranges is not allowed");
  }
}

// Helper: Fetch URL with timeout and size limits
async function fetchUrlSafely(url: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000); // 15 second timeout
  
  try {
    // Use realistic browser headers to avoid anti-scraping blocks
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "gzip, deflate, br",
        "Referer": "https://www.google.com/",
        "Connection": "keep-alive",
        "Upgrade-Insecure-Requests": "1",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
        "Sec-Fetch-User": "?1",
        "Cache-Control": "max-age=0",
      },
    });
    
    if (!response.ok) {
      throw new Error(`Failed to fetch URL: ${response.status} ${response.statusText}`);
    }
    
    // Check content type (strict validation)
    const contentType = (response.headers.get("content-type") || "").toLowerCase();
    if (!contentType.startsWith("text/html") && !contentType.startsWith("application/xhtml+xml")) {
      throw new Error("URL does not appear to be an HTML page");
    }
    
    // Read response with size limit (1MB)
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error("Unable to read response body");
    }
    
    const chunks: Uint8Array[] = [];
    let totalSize = 0;
    const maxSize = 1024 * 1024; // 1MB
    
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      
      totalSize += value.length;
      if (totalSize > maxSize) {
        reader.cancel();
        throw new Error("Response too large (max 1MB)");
      }
      
      chunks.push(value);
    }
    
    const decoder = new TextDecoder();
    const html = decoder.decode(Buffer.concat(chunks));
    
    return html;
  } catch (error: any) {
    if (error.name === "AbortError") {
      throw new Error("Request timeout (10 seconds exceeded)");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

// Helper: Validate extracted recipe has minimum required data
function validateExtractedRecipe(recipe: ExtractedRecipeRaw): boolean {
  if (!recipe.title || recipe.title.length < 2) {
    console.warn("Recipe title missing or too short");
    return false;
  }
  
  if (!recipe.ingredients || recipe.ingredients.length < 1) {
    console.warn("Recipe has no ingredients");
    return false;
  }
  
  if (!recipe.instructions || recipe.instructions.length < 1) {
    console.warn("Recipe has no instructions");
    return false;
  }
  
  // Servings is now optional (fallback handled in job-queue.ts)
  if (recipe.servings !== undefined && recipe.servings < 1) {
    console.warn("Recipe servings must be at least 1");
    return false;
  }
  
  return true;
}

// Helper: Extract recipe from JSON-LD structured data
function extractJsonLdRecipe(html: string): ExtractedRecipeRaw | null {
  try {
    const $ = cheerio.load(html);
    const jsonLdScripts = $("script[type='application/ld+json']");
    
    if (jsonLdScripts.length === 0) {
      return null;
    }
    
    // Try each JSON-LD script tag (with size limits)
    const maxScriptSize = 100000; // 100KB per script
    const maxTotalSize = 200000; // 200KB cumulative
    const maxScriptCount = 10; // Max 10 scripts to parse
    let totalSize = 0;
    
    for (let i = 0; i < Math.min(jsonLdScripts.length, maxScriptCount); i++) {
      try {
        const scriptContent = $(jsonLdScripts[i]).html();
        if (!scriptContent) continue;
        
        // Guard against oversized JSON-LD payloads (per-script and cumulative)
        if (scriptContent.length > maxScriptSize) {
          console.warn(`Skipping JSON-LD script ${i}: too large (${scriptContent.length} bytes)`);
          continue;
        }
        
        totalSize += scriptContent.length;
        if (totalSize > maxTotalSize) {
          console.warn(`Stopping JSON-LD parsing: cumulative size limit reached (${totalSize} bytes)`);
          break;
        }
        
        let jsonData = JSON.parse(scriptContent);
        
        // Handle different JSON-LD structures
        if (Array.isArray(jsonData)) {
          jsonData = jsonData.find((item: any) => item["@type"] === "Recipe");
        } else if (jsonData["@graph"]) {
          jsonData = jsonData["@graph"].find((item: any) => item["@type"] === "Recipe");
        }
        
        if (jsonData && jsonData["@type"] === "Recipe") {
          return convertJsonLdToExtracted(jsonData);
        }
      } catch (e) {
        continue;
      }
    }
    
    return null;
  } catch (error) {
    console.error("Error parsing JSON-LD:", error);
    return null;
  }
}

// Helper: Convert schema.org Recipe to our ExtractedRecipeRaw format
function convertJsonLdToExtracted(recipe: any): ExtractedRecipeRaw {
  // Parse ISO 8601 duration (PT1H30M15S = 1 hour 30 minutes 15 seconds)
  const parseDuration = (iso: string | undefined): string => {
    if (!iso) return "";
    
    // Handle ISO 8601 format
    const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
    if (match) {
      const hours = parseInt(match[1] || "0");
      const minutes = parseInt(match[2] || "0");
      const seconds = parseInt(match[3] || "0");
      
      // Round seconds to nearest minute if > 30 seconds
      const totalMinutes = minutes + (seconds > 30 ? 1 : 0);
      
      if (hours > 0 && totalMinutes > 0) return `${hours} hour ${totalMinutes} mins`;
      if (hours > 0) return hours === 1 ? "1 hour" : `${hours} hours`;
      if (totalMinutes > 0) return totalMinutes === 1 ? "1 min" : `${totalMinutes} mins`;
      return "";
    }
    
    // If not ISO format, return as-is
    return iso;
  };
  
  // Parse instructions from different formats (handle HowToStep, HowToSection, etc.)
  const parseInstructions = (instructions: any): string[] => {
    if (!instructions) return [];
    if (typeof instructions === "string") return [instructions];
    
    if (Array.isArray(instructions)) {
      const steps: string[] = [];
      
      instructions.forEach((inst: any) => {
        if (typeof inst === "string") {
          steps.push(inst);
        } else if (inst["@type"] === "HowToStep" && inst.text) {
          steps.push(inst.text);
        } else if (inst["@type"] === "HowToSection" && inst.itemListElement) {
          // Handle nested sections
          inst.itemListElement.forEach((item: any) => {
            if (typeof item === "string") steps.push(item);
            else if (item.text) steps.push(item.text);
          });
        } else if (inst.text) {
          steps.push(inst.text);
        }
      });
      
      return steps.filter(Boolean);
    }
    
    return [];
  };
  
  // Parse category (can be string or array)
  const parseCategory = (category: any): string[] => {
    if (!category) return [];
    if (typeof category === "string") return [category];
    if (Array.isArray(category)) return category;
    return [];
  };
  
  // Parse servings (can be number, string, or structured)
  const parseServings = (recipeYield: any): number => {
    if (typeof recipeYield === "number") return Math.max(1, recipeYield);
    if (typeof recipeYield === "string") {
      const match = recipeYield.match(/(\d+)/);
      return match ? Math.max(1, parseInt(match[1])) : 4;
    }
    return 4; // default
  };
  
  // Parse nutrition value (can be string with units like "240 calories")
  // Always returns integers since database schema expects integer nutrition values
  const parseNutrition = (value: any): number | undefined => {
    if (!value) return undefined;
    if (typeof value === "number") return Math.round(value);
    if (typeof value === "string") {
      const match = value.match(/(\d+(?:\.\d+)?)/);
      return match ? Math.round(parseFloat(match[1])) : undefined;
    }
    return undefined;
  };
  
  // Parse cuisine (can be string or array, keep as-is for flexibility)
  const parseCuisine = (value: any): string | string[] | undefined => {
    if (!value) return undefined;
    if (typeof value === "string") return value;
    if (Array.isArray(value)) return value;
    return undefined;
  };

  return {
    title: recipe.name || "Untitled Recipe",
    description: recipe.description || "",
    prepTime: parseDuration(recipe.prepTime),
    cookTime: parseDuration(recipe.cookTime),
    totalTime: parseDuration(recipe.totalTime),
    servings: parseServings(recipe.recipeYield),
    servingUnit: typeof recipe.recipeYield === "string" ? recipe.recipeYield : "servings",
    yield: typeof recipe.recipeYield === "string" ? recipe.recipeYield : undefined,
    ingredients: Array.isArray(recipe.recipeIngredient) ? recipe.recipeIngredient : [],
    instructions: parseInstructions(recipe.recipeInstructions),
    equipment: [],
    cuisine: parseCuisine(recipe.recipeCuisine || recipe.cuisine),
    mealType: parseCategory(recipe.recipeCategory),
    dietType: parseCategory(recipe.suitableForDiet),
    calories: parseNutrition(recipe.nutrition?.calories),
    protein: parseNutrition(recipe.nutrition?.proteinContent),
    carbohydrates: parseNutrition(recipe.nutrition?.carbohydrateContent),
    fat: parseNutrition(recipe.nutrition?.fatContent),
    fiber: parseNutrition(recipe.nutrition?.fiberContent),
    sugar: parseNutrition(recipe.nutrition?.sugarContent),
    sodium: parseNutrition(recipe.nutrition?.sodiumContent),
    cholesterol: parseNutrition(recipe.nutrition?.cholesterolContent),
  };
}

// Helper: Extract recipe from HTML using AI when JSON-LD isn't available
async function extractRecipeFromHtmlWithAI(html: string): Promise<ExtractedRecipeRaw> {
  if (!hasOpenAI || !openai) {
    throw new Error(
      "Cannot extract recipe from this URL: AI extraction is unavailable (OpenAI not configured). " +
      "This URL does not have structured recipe data (JSON-LD)."
    );
  }
  
  // Clean HTML comprehensively to prevent prompt injection
  const $ = cheerio.load(html);
  
  // Multi-pass sanitization: remove dangerous elements
  // Pass 1: Remove executable/embedded content
  $("script, style, noscript, iframe, object, embed, applet").remove();
  
  // Pass 2: Remove navigation and non-content elements
  $("nav, footer, header, aside, form, button, input, select, textarea").remove();
  
  // Pass 3: Remove ads and social elements
  $(".ad, .advertisement, .sidebar, .comments, .social, #sidebar, #ads").remove();
  
  // Pass 4: Remove all elements with event handlers (prevents nested handlers)
  $("[onclick], [onload], [onerror], [onmouseover], [onmouseout], [onfocus], [onblur]").remove();
  
  // Pass 5: Remove data attributes that could contain instructions
  $("*").removeAttr("data-*");
  
  // Get text content from main content area (prefer article, main, or body)
  const mainContent = $("article, main, [role='main'], body").first();
  let cleanedText = mainContent.text();
  
  // Aggressive normalization to prevent prompt injection
  cleanedText = cleanedText
    .replace(/[\x00-\x1F\x7F-\x9F]/g, "") // Remove control characters
    .replace(/[^\x20-\x7E\n]/g, " ") // Keep only ASCII printable + newlines
    .replace(/\s+/g, " ") // Collapse whitespace
    .replace(/\n\s*\n/g, "\n") // Remove empty lines
    .trim();
  
  // Limit to 15k characters (preserve UTF-8, don't split mid-character)
  const maxLength = 15000;
  if (cleanedText.length > maxLength) {
    // Find the last complete space before the limit
    const truncatePoint = cleanedText.lastIndexOf(" ", maxLength);
    cleanedText = cleanedText.slice(0, truncatePoint > 0 ? truncatePoint : maxLength) + "... [truncated]";
  }
  
  if (cleanedText.length < 100) {
    throw new Error("Insufficient text content found on the page");
  }
  
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-5",
      messages: [
        {
          role: "user",
          content: `You are an expert recipe extraction AI. Analyze this text content from a recipe website and extract ALL recipe information into structured JSON.

Text Content:
${cleanedText}

Extract the following (if visible or inferable):
- title: Recipe name
- description: Brief description
- prepTime, cookTime, totalTime: In format "15 mins", "1 hr", etc.
- servings: Number as integer
- servingUnit: What it makes (e.g., "cookies", "servings", "slices")
- servingSize: Portion size per serving (e.g., "8 oz", "1 cup", "200g", "1 slice")
- yield: Complete yield description (e.g., "Makes 12 cookies")
- ingredients: Array of exact ingredient strings with quantities
- instructions: Array of step-by-step instructions (preserve order)
- equipment: Array of tools/equipment mentioned or implied
- dietType: Array like ["vegetarian", "vegan", "gluten-free", "dairy-free"] - infer from ingredients
- cuisine: E.g., "Italian", "Mexican", "American" - infer from recipe style
- mealType: Array like ["dinner", "dessert", "breakfast", "sauce", "dip", "marinade", "rub"] - infer appropriately

ALWAYS provide estimated nutrition per serving based on ingredients:
- calories, protein, carbohydrates, fat, fiber, sugar (numbers)
- sodium, cholesterol (in mg)

Return ONLY valid JSON with all fields. Make reasonable estimates for missing data.`,
        },
      ],
      response_format: { type: "json_object" },
      max_completion_tokens: 16384,
    });
    
    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error("No response from AI");
    }
    
    const extracted = JSON.parse(content) as ExtractedRecipeRaw;
    
    // Validate the AI-extracted recipe
    if (!validateExtractedRecipe(extracted)) {
      throw new Error("AI extraction failed to produce valid recipe data");
    }
    
    return extracted;
  } catch (error: any) {
    console.error("Error in AI HTML extraction:", error);
    if (error.message && error.message.includes("Cannot extract recipe")) {
      throw error; // Re-throw our custom error messages
    }
    throw new Error(`Failed to extract recipe using AI: ${error.message || "Unknown error"}`);
  }
}

// Zod schema for enriched data to ensure AI responses are valid
// Exported for use in parallel enrichment validation
export const enrichedRecipeDataSchema = z.object({
  // Title correction - fix misspellings from handwritten extraction
  correctedTitle: z.string().optional(),
  
  normalizedIngredients: z.array(normalizedIngredientSchema),
  normalizedInstructions: z.array(instructionStepSchema),
  servings: z.number().min(1), // REQUIRED - AI must determine from ingredients
  prepTimeMinutes: z.number().optional(),
  cookTimeMinutes: z.number().optional(),
  totalTimeMinutes: z.number().optional(),
  skillLevel: z.string().optional(),
  skillLevelExplanation: z.string().optional(),
  
  // All 19 dietary flags
  isVegetarian: z.boolean().default(false),
  isVegan: z.boolean().default(false),
  isPescatarian: z.boolean().default(false),
  isGlutenFree: z.boolean().default(false),
  isDairyFree: z.boolean().default(false),
  isKeto: z.boolean().default(false),
  isPaleo: z.boolean().default(false),
  isLowCarb: z.boolean().default(false),
  isHighProtein: z.boolean().default(false),
  isLowCalorie: z.boolean().default(false),
  isHighFiber: z.boolean().default(false),
  isLactoVegetarian: z.boolean().default(false),
  isMediterranean: z.boolean().default(false),
  isOvoVegetarian: z.boolean().default(false),
  isOvoLactoVegetarian: z.boolean().default(false),
  isFlexitarian: z.boolean().default(false),
  isCarnivore: z.boolean().default(false),
  isKosher: z.boolean().default(false),
  isHalal: z.boolean().default(false),
  isHindu: z.boolean().default(false),
  
  allergens: z.array(z.string()).default([]),
  cuisines: z.array(z.string()).default([]),
  mealType: z.array(z.string()).default([]),
  cookingMethods: z.array(z.string()).default([]),
  seasonTags: z.array(z.string()).default([]),
  occasionTags: z.array(z.string()).default([]),
  standardEquipment: z.array(z.string()).default([]),
  specializedEquipment: z.array(z.string()).default([]),
  
  // Pricing with specific estimates
  priceRangeMin: z.number().optional(),
  priceRangeMax: z.number().optional(),
  priceCategory: z.string().optional(),
  totalCost: z.number().optional(), // NEW: Total recipe cost
  costExcludingStaples: z.number().optional(), // NEW: Cost excluding pantry staples
  
  // Health score (0-100) with justification
  healthScore: z.number().min(0).max(100).optional(),
  healthScoreJustification: z.string().optional(), // For auditability, discarded after validation
  
  // Nutrition facts (per serving)
  calories: z.number().optional(),
  protein: z.number().optional(),
  fat: z.number().optional(),
  carbohydrates: z.number().optional(),
  fiber: z.number().optional(),
  sugar: z.number().optional(),
  sodium: z.number().optional(),
  cholesterol: z.number().optional(),
  
  tips: z.array(tipSchema).default([]),
  variations: z.array(variationSchema).default([]),
  servingSuggestions: z.array(z.string()).default([]),
  aiEnrichmentFields: z.array(z.string()).default([]),
  
  // Beverage pairings (wines, beers, cocktails, non-alcoholic)
  beveragePairings: beveragePairingsSchema,
  
  // Recipe variations (lower calorie, higher protein, Michelin upgrades, budget-friendly)
  recipeVariations: recipeVariationsSchema,
  
  // Cultural significance and history (2+ paragraphs with fun facts)
  culturalSignificance: z.string().optional(),
  
  // Celebrity chef reviews (3 reviews from famous chefs)
  celebrityChefReviews: celebrityChefReviewsSchema,
  
  // Derived fields (computed deterministically, not from AI)
  allergenFreeTags: z.array(z.string()).optional(),
  timeConvenienceTags: z.array(z.string()).optional(),
  groceryAisleTags: z.array(z.string()).optional(),
  cuisine: z.string().nullable().optional(),
  equipment: z.array(z.string()).optional(),
  isLowFat: z.boolean().optional(),
  isLowSodium: z.boolean().optional(),
  isLowSugar: z.boolean().optional(),
});

export type EnrichedRecipeData = z.infer<typeof enrichedRecipeDataSchema>;

// Preprocess AI response to handle common GPT-4 output inconsistencies
function preprocessAIResponse(parsed: any): any {
  const result = { ...parsed };
  
  // GPT-5 uses inconsistent section naming - normalize and flatten all variants
  // Map common section name variations to their normalized form
  const sectionAliases: Record<string, string> = {
    'time': 'time',
    'skill': 'skill',
    'skill level': 'skill',
    'dietary flags': 'dietaryflags',
    'dietaryflags': 'dietaryflags',
    'equipment split': 'equipmentsplit',
    'equipmentsplit': 'equipmentsplit',
    'nutrition facts': 'nutritionfacts',
    'nutritionfacts': 'nutritionfacts',
    'nutritionfactsperserving': 'nutritionfacts',
    'nutrition': 'nutritionfacts',
    'pricing': 'pricing',
    'cost analysis': 'pricing',
    'health score': 'health',
    'healthscore': 'health',
    'health': 'health',
    'tips variations serving': 'tipsvariationsserving',
    'tipsvariationsserving': 'tipsvariationsserving',
    'tips and variations': 'tipsvariationsserving'
  };
  
  // Flatten any sections found with normalized names
  for (const [key, value] of Object.entries(result)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      // Normalize key: trim, lowercase, remove punctuation
      const normalizedKey = key.trim().toLowerCase().replace(/[^a-z\s]/g, '').replace(/\s+/g, '');
      
      // Check if this is a section we should flatten
      if (sectionAliases[normalizedKey]) {
        Object.assign(result, value);
        delete result[key];
      }
    }
  }
  
  // Fix equipment: If it's an object with arrays, extract them
  if (result.equipment && typeof result.equipment === 'object' && !Array.isArray(result.equipment)) {
    // GPT-5 might return { standardEquipment: [...], specializedEquipment: [...] }
    if (result.equipment.standardEquipment || result.equipment.specializedEquipment) {
      result.standardEquipment = result.equipment.standardEquipment || [];
      result.specializedEquipment = result.equipment.specializedEquipment || [];
      delete result.equipment;
    } else {
      // If it's just a random object, try to convert values to array
      result.equipment = Object.values(result.equipment).flat();
    }
  }
  
  // Fix tips: Convert strings to proper objects
  if (Array.isArray(result.tips)) {
    result.tips = result.tips.map((tip: any) => {
      if (typeof tip === 'string') {
        return { type: 'technique', text: tip };
      }
      return tip;
    });
  }
  
  // Fix variations: Convert strings to proper objects
  if (Array.isArray(result.variations)) {
    result.variations = result.variations.map((variation: any) => {
      if (typeof variation === 'string') {
        return { type: 'ingredient', title: 'Variation', description: variation };
      }
      return variation;
    });
  }
  
  // Fix aiEnrichmentFields: Convert object to array if needed
  if (result.aiEnrichmentFields && !Array.isArray(result.aiEnrichmentFields)) {
    result.aiEnrichmentFields = Object.keys(result.aiEnrichmentFields);
  }
  
  // Helper: Recursively extract numeric value from nested objects
  // Handles patterns like { value: 320 }, { amount: 50 }, { score: 85, reasoning: "..." }, { healthScore: 82, justification: "..." }
  function extractNumber(obj: any, fieldName?: string): number | undefined {
    if (typeof obj === 'number') return obj;
    if (typeof obj === 'string') {
      const parsed = parseFloat(obj);
      return isNaN(parsed) ? undefined : parsed;
    }
    if (typeof obj !== 'object' || obj === null) return undefined;
    
    // Common numeric field names in order of preference
    const numericKeys = ['score', 'value', 'amount', 'perServing', 'total', 'number', 'quantity'];
    
    // If field name provided, check for self-nested pattern first (e.g., { healthScore: 82 } when extracting healthScore)
    if (fieldName && fieldName in obj) {
      const val = obj[fieldName];
      if (typeof val === 'number') return val;
      if (typeof val === 'string') {
        const parsed = parseFloat(val);
        if (!isNaN(parsed)) return parsed;
      }
    }
    
    // Then check common numeric keys
    for (const key of numericKeys) {
      if (key in obj) {
        const val = obj[key];
        if (typeof val === 'number') return val;
        if (typeof val === 'string') {
          const parsed = parseFloat(val);
          if (!isNaN(parsed)) return parsed;
        }
      }
    }
    return undefined;
  }
  
  // Extract numeric values from potentially nested nutrition/health/cost fields
  const numericFields = [
    'healthScore', 'calories', 'protein', 'carbohydrates', 'fat', 
    'fiber', 'sugar', 'sodium', 'cholesterol', 'totalCost', 'costExcludingStaples',
    'prepTimeMinutes', 'cookTimeMinutes', 'totalTimeMinutes', 'coolingTimeMinutes'
  ];
  
  // Fields that must be integers (database schema expects integers, not floats)
  const integerFields = new Set([
    'healthScore', 'calories', 'protein', 'carbohydrates', 'fat', 
    'fiber', 'sugar', 'sodium', 'cholesterol',
    'prepTimeMinutes', 'cookTimeMinutes', 'totalTimeMinutes', 'coolingTimeMinutes'
  ]);
  
  for (const field of numericFields) {
    if (result[field]) {
      const extracted = extractNumber(result[field], field); // Pass field name to handle self-nested patterns
      if (extracted !== undefined) {
        // Round to integer for fields that require integers
        result[field] = integerFields.has(field) ? Math.round(extracted) : extracted;
      }
    }
  }
  
  // Clean normalizedIngredients: Remove null values from nested objects
  if (Array.isArray(result.normalizedIngredients)) {
    result.normalizedIngredients = result.normalizedIngredients.map((ing: any) => {
      const cleaned: any = { ...ing };
      
      // Remove null values from nutrition object
      if (cleaned.nutrition) {
        Object.keys(cleaned.nutrition).forEach(key => {
          if (cleaned.nutrition[key] === null) {
            delete cleaned.nutrition[key];
          }
        });
        // Remove empty nutrition object
        if (Object.keys(cleaned.nutrition).length === 0) {
          delete cleaned.nutrition;
        }
      }
      
      // Remove null values from groceryMapping object
      if (cleaned.groceryMapping) {
        Object.keys(cleaned.groceryMapping).forEach(key => {
          if (cleaned.groceryMapping[key] === null) {
            delete cleaned.groceryMapping[key];
          }
        });
        // Remove empty groceryMapping object
        if (Object.keys(cleaned.groceryMapping).length === 0) {
          delete cleaned.groceryMapping;
        }
      }
      
      // Remove null preparation field
      if (cleaned.preparation === null) {
        delete cleaned.preparation;
      }
      
      // Remove null quantity field
      if (cleaned.quantity === null) {
        delete cleaned.quantity;
      }
      
      // Fix null unit field (convert to empty string)
      if (cleaned.unit === null) {
        cleaned.unit = '';
      }
      
      return cleaned;
    });
  }
  
  // Clean normalizedInstructions: Remove null values from nested objects
  if (Array.isArray(result.normalizedInstructions)) {
    result.normalizedInstructions = result.normalizedInstructions.map((step: any) => {
      const cleaned: any = { ...step };
      
      // Clean temperature object: Remove null values inside
      if (cleaned.temperature && typeof cleaned.temperature === 'object') {
        Object.keys(cleaned.temperature).forEach(key => {
          if (cleaned.temperature[key] === null) {
            delete cleaned.temperature[key];
          }
        });
        // Remove empty temperature object
        if (Object.keys(cleaned.temperature).length === 0) {
          delete cleaned.temperature;
        }
      } else if (cleaned.temperature === null) {
        // Remove null temperature object
        delete cleaned.temperature;
      }
      
      // Remove null donenessCue field
      if (cleaned.donenessCue === null) {
        delete cleaned.donenessCue;
      }
      
      // Remove null timeMinutes field (optional field)
      if (cleaned.timeMinutes === null) {
        delete cleaned.timeMinutes;
      }
      
      return cleaned;
    });
  }
  
  return result;
}

// Validate that all critical enrichment fields are present
function validateEnrichmentCompleteness(data: any): string[] {
  const missingFields: string[] = [];
  
  // Critical nutrition fields (REQUIRED)
  const nutritionFields = ['calories', 'protein', 'carbohydrates', 'fat', 'fiber', 'sugar', 'sodium', 'cholesterol'];
  for (const field of nutritionFields) {
    if (data[field] === undefined || data[field] === null) {
      missingFields.push(field);
    }
  }
  
  // Critical metadata fields
  if (data.healthScore === undefined || data.healthScore === null) {
    missingFields.push('healthScore');
  }
  if (data.totalCost === undefined || data.totalCost === null) {
    missingFields.push('totalCost');
  }
  if (data.costExcludingStaples === undefined || data.costExcludingStaples === null) {
    missingFields.push('costExcludingStaples');
  }
  
  // Critical content arrays
  if (!Array.isArray(data.tips) || data.tips.length === 0) {
    missingFields.push('tips');
  }
  if (!Array.isArray(data.variations) || data.variations.length === 0) {
    missingFields.push('variations');
  }
  
  // Beverage pairings (at least some pairings should exist)
  if (!data.beveragePairings) {
    missingFields.push('beveragePairings');
  } else {
    const totalPairings = (data.beveragePairings.wines?.length || 0) +
                         (data.beveragePairings.beers?.length || 0) +
                         (data.beveragePairings.cocktails?.length || 0) +
                         (data.beveragePairings.nonAlcoholic?.length || 0);
    if (totalPairings === 0) {
      missingFields.push('beveragePairings (no pairings in any category)');
    }
  }
  
  // Recipe variations (all categories should have exactly 3 items)
  if (!data.recipeVariations) {
    missingFields.push('recipeVariations');
  } else {
    if (!Array.isArray(data.recipeVariations.lowerCalorie) || data.recipeVariations.lowerCalorie.length < 3) {
      missingFields.push('recipeVariations.lowerCalorie (need 3)');
    }
    if (!Array.isArray(data.recipeVariations.higherProtein) || data.recipeVariations.higherProtein.length < 3) {
      missingFields.push('recipeVariations.higherProtein (need 3)');
    }
    if (!Array.isArray(data.recipeVariations.michelinUpgrade) || data.recipeVariations.michelinUpgrade.length < 3) {
      missingFields.push('recipeVariations.michelinUpgrade (need 3)');
    }
    if (!Array.isArray(data.recipeVariations.budgetFriendly) || data.recipeVariations.budgetFriendly.length < 3) {
      missingFields.push('recipeVariations.budgetFriendly (need 3)');
    }
  }
  
  // Cultural significance (required, should be substantial text)
  if (!data.culturalSignificance || typeof data.culturalSignificance !== 'string' || data.culturalSignificance.length < 200) {
    missingFields.push('culturalSignificance (need 2+ paragraphs)');
  }
  
  // Celebrity chef reviews (required, exactly 3 reviews)
  if (!data.celebrityChefReviews || !Array.isArray(data.celebrityChefReviews) || data.celebrityChefReviews.length !== 3) {
    missingFields.push('celebrityChefReviews (need exactly 3 reviews)');
  } else {
    const requiredChefs = ['Gordon Ramsay', 'Ina Garten', 'Matty Matheson'];
    const foundChefs = data.celebrityChefReviews.map((r: any) => r.chefName);
    const missingChefs = requiredChefs.filter(chef => !foundChefs.includes(chef));
    if (missingChefs.length > 0) {
      missingFields.push(`celebrityChefReviews missing: ${missingChefs.join(', ')}`);
    }
    for (const review of data.celebrityChefReviews) {
      if (!review.score || review.score < 1 || review.score > 10) {
        missingFields.push(`celebrityChefReviews: ${review.chefName} needs valid score (1-10)`);
      }
      if (!review.review || review.review.length < 50) {
        missingFields.push(`celebrityChefReviews: ${review.chefName} needs 2-3 sentence review`);
      }
    }
  }
  
  // Skill level
  if (!data.skillLevel) {
    missingFields.push('skillLevel');
  }
  
  return missingFields;
}

// Phase 2: Enrich with advanced metadata, normalization, tips, and variations
export async function enrichRecipeData(
  raw: ExtractedRecipeRaw
): Promise<EnrichedRecipeData> {
  if (!hasOpenAI || !openai) {
    console.warn("OpenAI not configured - using basic enrichment");
    return getBasicEnrichment(raw);
  }

  // Retry logic with exponential backoff + jitter
  const maxAttempts = 3;
  const baseDelays = [2000, 4000, 8000]; // 2s, 4s, 8s base delays
  
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      console.log(`Phase 2: AI enrichment attempt ${attempt}/${maxAttempts}...`);
      
      const response = await openai.chat.completions.create({
      model: "gpt-5",
      messages: [
        {
          role: "user",
          content: `Enrich this recipe with comprehensive metadata. Return valid JSON with ALL fields as top-level properties.

RECIPE DATA:
${JSON.stringify(raw, null, 2)}

REQUIRED TOP-LEVEL FIELDS (return exactly these field names):

// Title Correction (REQUIRED if title has errors)
correctedTitle: string (Review the recipe title "${raw.title}" for spelling errors, OCR mistakes, or awkward phrasing from handwritten extraction. If the title has any issues, provide the corrected version. Common issues: "Chiken" → "Chicken", "Lasange" → "Lasagna", "Beef Stew w/ Vegtables" → "Beef Stew with Vegetables". If the title is already correct, still provide it unchanged.)

// Arrays
normalizedIngredients: [{raw, quantity, unit, item, preparation, isOptional, isToolOrConsumable, emoji (single Unicode emoji character matching the ingredient - REQUIRED for each ingredient), nutrition: {calories, protein, carbohydrates, fat, fiber}, groceryMapping: {name, aisle, packageSize, category}}]
normalizedInstructions: [{stepNumber, text, ingredients[], tools[], timeMinutes, temperature: {value, scale: "F"|"C"}, stepType: "preheat"|"prep"|"cook"|"rest"|"chill"|"marinate"|"assemble"|"serve", donenessCue}]
cuisines: string[] (e.g. ["Italian", "Mediterranean"])
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

// Beverage pairings (REQUIRED - provide 3+ per category when applicable)
beveragePairings: {
  wines: [{name: string (specific wine name/type), styleOrVarietal: string (e.g., "Pinot Noir", "Chardonnay"), tastingNotes: string (optional), rationale: string (why it pairs well)}] (3+ items or empty if truly not applicable)
  beers: [{name: string (specific beer name/style), styleOrVarietal: string (e.g., "IPA", "Stout"), tastingNotes: string (optional), rationale: string}] (3+ items or empty if truly not applicable)
  cocktails: [{name: string (cocktail name), styleOrVarietal: string (optional, e.g., "Whiskey-based"), tastingNotes: string (optional), rationale: string}] (3+ items or empty if truly not applicable)
  nonAlcoholic: [{name: string (drink name), styleOrVarietal: string (optional), tastingNotes: string (optional), rationale: string}] (3+ items or empty if truly not applicable)
}

// Recipe variations (REQUIRED - provide EXACTLY 3 items per category)
recipeVariations: {
  lowerCalorie: [{targetIngredient: string (which ingredient to replace), replacement: string (what to use instead), reason: string (why this reduces calories), impactSummary: string (estimated calorie savings)}] (EXACTLY 3 items)
  higherProtein: [{targetIngredient: string, replacement: string, reason: string (why this adds protein), impactSummary: string (estimated protein increase)}] (EXACTLY 3 items)
  michelinUpgrade: [{focus: "presentation"|"technique"|"ingredient", recommendation: string (specific enhancement), rationale: string (why this elevates the dish)}] (EXACTLY 3 items - one for each focus type)
  budgetFriendly: [{targetIngredient: string, replacement: string, reason: string (why this is cheaper), impactSummary: string (estimated cost savings)}] (EXACTLY 3 items)
}

// Cultural significance (REQUIRED - 2+ paragraphs)
culturalSignificance: string (At least 2 detailed paragraphs about the dish's history, origins, cultural importance, and little-known fun facts about the cooking methods, ingredients, and traditions. Include interesting trivia that home cooks would enjoy learning.)

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

// Numbers (REQUIRED - must provide estimates)
servings: number (REQUIRED - if not provided in input, determine from ingredient quantities. E.g., "2 lbs chicken, 4 potatoes" → 4-6 servings. Always provide a reasonable estimate)
prepTimeMinutes: number (if input is a range like "20-30 min", use the midpoint: 25)
cookTimeMinutes: number (if input is a range like "20-30 min", use the midpoint: 25)
totalTimeMinutes: number (if input is a range, use the midpoint)
calories: number (per serving)
protein: number (grams per serving)
carbohydrates: number (grams per serving)
fat: number (grams per serving)
fiber: number (grams per serving)
sugar: number (grams per serving)
sodium: number (mg per serving)
cholesterol: number (mg per serving)
priceRangeMin: number (dollars per serving)
priceRangeMax: number (dollars per serving)
totalCost: number (total dollars for recipe)
costExcludingStaples: number (dollars)
healthScore: number (0-100 integer)

// Strings
skillLevel: "Beginner"|"Intermediate"|"Advanced"
skillLevelExplanation: string
priceCategory: "budget"|"moderate"|"premium"
healthScoreJustification: string

// Booleans (19 dietary flags - default false)
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

CRITICAL: All nutrition fields (calories, protein, carbohydrates, fat, fiber, sugar, sodium, cholesterol), totalCost, healthScore, tips, variations, beveragePairings (with 3+ items per category), recipeVariations (with EXACTLY 3 items per category), culturalSignificance (2+ paragraphs), and celebrityChefReviews (exactly 3 reviews with unique chef personalities) are REQUIRED. Estimate if needed.

EMOJI REQUIREMENTS:
- Every ingredient in normalizedIngredients MUST have an emoji field
- Use single Unicode emoji characters (🍅, 🧄, 🥩, etc.)
- Choose emojis that visually match the ingredient
- Never duplicate emojis across different ingredient items unless they are truly the same item`,
        },
      ],
      response_format: { type: "json_object" },
      max_completion_tokens: 16384,
    });

    const content = response.choices[0]?.message?.content;
    
    // Early detection of empty/invalid responses
    if (!content || content.trim().length === 0) {
      throw new Error("Empty response from GPT-5 API");
    }
    
    let parsed: any;
    try {
      parsed = JSON.parse(content);
    } catch (parseError) {
      throw new Error(`Failed to parse GPT-5 response as JSON: ${parseError instanceof Error ? parseError.message : 'Unknown error'}`);
    }
    
    // Enhanced logging for debugging
    console.log('\n📋 GPT-5 RESPONSE STRUCTURE:');
    console.log('├─ Content length:', content.length, 'characters');
    console.log('├─ Top-level keys:', Object.keys(parsed).length, 'fields');
    console.log('└─ Keys:', Object.keys(parsed).join(', '));
    
    console.log('\n📋 CRITICAL FIELD CHECK:');
    const criticalFields = {
      'calories': parsed.calories,
      'protein': parsed.protein,
      'healthScore': parsed.healthScore,
      'totalCost': parsed.totalCost,
      'tips': parsed.tips?.length,
      'variations': parsed.variations?.length
    };
    
    for (const [field, value] of Object.entries(criticalFields)) {
      const present = value !== undefined && value !== null && value !== 0;
      console.log((present ? '  ✓' : '  ✗'), `${field}:`, value);
    }
    
    // Preprocess AI response to handle inconsistencies before validation
    const preprocessed = preprocessAIResponse(parsed);
    console.log('\n📋 AFTER PREPROCESSING:');
    console.log('├─ calories:', preprocessed.calories);
    console.log('├─ healthScore:', preprocessed.healthScore);
    console.log('├─ totalCost:', preprocessed.totalCost);
    console.log('├─ tips count:', preprocessed.tips?.length);
    console.log('└─ variations count:', preprocessed.variations?.length);
    
    // Completeness validation - check critical fields before proceeding
    const missingFields = validateEnrichmentCompleteness(preprocessed);
    if (missingFields.length > 0) {
      throw new Error(`Incomplete enrichment data - missing fields: ${missingFields.join(', ')}`);
    }
    
    // Validate using Zod schema with defaults - this will throw if invalid
    const aiEnriched = enrichedRecipeDataSchema.parse(preprocessed);
    
    // Post-processing: Compute all derived fields deterministically
    // This ensures comprehensive 50+ field coverage as promised to user
    
    // Compute nutrition qualitative tags from raw nutrition data (FDA standards)
    const nutritionFlags = deriveNutritionFlags({ fat: raw.fat, sodium: raw.sodium, sugar: raw.sugar });
    
    // Apply emoji fallback to all ingredients (ensures all have emojis)
    const ingredientsWithEmojis = applyEmojiDefaults(aiEnriched.normalizedIngredients);
    
    const result: EnrichedRecipeData = {
      ...aiEnriched,
      
      // Apply emoji-enriched ingredients
      normalizedIngredients: ingredientsWithEmojis,
      
      // Compute allergen-free tags from allergens present
      allergenFreeTags: deriveAllergenFreeTags(aiEnriched.allergens),
      
      // Compute time convenience tags from total minutes
      timeConvenienceTags: deriveTimeConvenienceTags(aiEnriched.totalTimeMinutes),
      
      // Compute grocery aisle summary from normalized ingredients
      groceryAisleTags: deriveGroceryAisleTags(aiEnriched.normalizedIngredients),
      
      // Compute legacy cuisine field for backward compatibility
      cuisine: deriveLegacyCuisine(aiEnriched.cuisines),
      
      // Compute legacy equipment field as union of standard + specialized
      equipment: deriveLegacyEquipment(aiEnriched.standardEquipment, aiEnriched.specializedEquipment),
      
      // Spread nutrition qualitative flags
      ...nutritionFlags,
    };
    
      return result;
    } catch (error) {
      const isLastAttempt = attempt === maxAttempts;
      console.error(`❌ Enrichment attempt ${attempt}/${maxAttempts} failed:`, error instanceof Error ? error.message : error);
      
      if (isLastAttempt) {
        console.error("All enrichment attempts exhausted, falling back to basic enrichment");
        return getBasicEnrichment(raw);
      }
      
      // Wait before retry with jitter to prevent synchronized retry storms
      const baseDelay = baseDelays[attempt - 1];
      // Add random jitter: 0-50% of base delay (e.g., 2s base → 2-3s actual)
      const jitter = Math.random() * (baseDelay * 0.5);
      const delayWithJitter = baseDelay + jitter;
      console.log(`⏳ Retrying in ${Math.round(delayWithJitter)}ms (base: ${baseDelay}ms + jitter: ${Math.round(jitter)}ms)...`);
      await new Promise(resolve => setTimeout(resolve, delayWithJitter));
    }
  }
  
  // This should never be reached, but TypeScript needs it
  return getBasicEnrichment(raw);
}

// Phase 3: Validation - comprehensive deterministic checks
export async function validateRecipe(
  raw: ExtractedRecipeRaw,
  enriched: EnrichedRecipeData
): Promise<ValidationWarning[]> {
  const warnings: ValidationWarning[] = [];

  // Check if all ingredients are used in steps (with synonym matching)
  const usedIngredientNames = new Set(
    enriched.normalizedInstructions.flatMap((step) => 
      step.ingredients.map(ing => ing.toLowerCase())
    )
  );
  
  enriched.normalizedIngredients.forEach((ing) => {
    if (ing.isToolOrConsumable || ing.isOptional) return;
    
    const itemLower = ing.item.toLowerCase();
    const isUsed = usedIngredientNames.has(itemLower) ||
      Array.from(usedIngredientNames).some(used => 
        used.includes(itemLower) || itemLower.includes(used)
      );
    
    if (!isUsed) {
      warnings.push({
        severity: "warning",
        category: "unusedIngredient",
        message: `Ingredient "${ing.item}" is not referenced in any instruction step`,
      });
    }
  });

  // Check for ingredients mentioned in steps but not in ingredient list
  const ingredientItemsLower = new Set(
    enriched.normalizedIngredients.map(ing => ing.item.toLowerCase())
  );
  
  enriched.normalizedInstructions.forEach((step) => {
    step.ingredients.forEach(stepIng => {
      const stepIngLower = stepIng.toLowerCase();
      const found = ingredientItemsLower.has(stepIngLower) ||
        Array.from(ingredientItemsLower).some(item =>
          item.includes(stepIngLower) || stepIngLower.includes(item)
        );
      
      if (!found) {
        warnings.push({
          severity: "info",
          category: "missingIngredient",
          message: `Step ${step.stepNumber} mentions "${stepIng}" which is not in the ingredient list`,
        });
      }
    });
  });

  // Check time consistency between raw and normalized
  if (enriched.prepTimeMinutes && enriched.totalTimeMinutes) {
    const expectedTotal = (enriched.prepTimeMinutes || 0) + (enriched.cookTimeMinutes || 0);
    if (expectedTotal > 0 && Math.abs(expectedTotal - enriched.totalTimeMinutes) > 15) {
      warnings.push({
        severity: "info",
        category: "timeInconsistency",
        message: `Prep+Cook time (${expectedTotal} min) doesn't match total time (${enriched.totalTimeMinutes} min)`,
      });
    }
  }

  // Check step times vs stated times
  const stepTimes = enriched.normalizedInstructions
    .filter((s) => s.timeMinutes)
    .reduce((sum, s) => sum + (s.timeMinutes || 0), 0);
  
  if (stepTimes > 0 && enriched.totalTimeMinutes && stepTimes > enriched.totalTimeMinutes * 1.5) {
    warnings.push({
      severity: "warning",
      category: "timeInconsistency",
      message: `Individual step times (${stepTimes} min) significantly exceed stated total time (${enriched.totalTimeMinutes} min)`,
    });
  }

  // Check for oven temp in baking/roasting recipes
  const requiresOvenTemp = raw.instructions.some((inst) => {
    const lower = inst.toLowerCase();
    return lower.includes("bake") || lower.includes("oven") || 
           lower.includes("roast") || lower.includes("broil");
  });
  
  const hasPreheatStep = enriched.normalizedInstructions.some((step) => 
    step.stepType === "preheat"
  );
  const hasOvenTemp = enriched.normalizedInstructions.some((step) => 
    step.temperature && step.temperature.value
  );
  
  if (requiresOvenTemp && !hasOvenTemp) {
    warnings.push({
      severity: "error",
      category: "missingTemp",
      message: "Recipe requires oven but no temperature was found",
    });
  }
  
  if (requiresOvenTemp && !hasPreheatStep) {
    warnings.push({
      severity: "info",
      category: "other",
      message: "Oven recipe should include a preheat step",
    });
  }

  // Check for required tools in instructions but missing from equipment list
  const mentionedTools = new Set(
    enriched.normalizedInstructions.flatMap(step => step.tools)
  );
  const equipmentSet = new Set(raw.equipment || []);
  
  mentionedTools.forEach(tool => {
    if (!equipmentSet.has(tool)) {
      warnings.push({
        severity: "info",
        category: "other",
        message: `Tool "${tool}" mentioned in steps but not listed in equipment`,
      });
    }
  });

  console.log(`Phase 3: Validation complete - found ${warnings.length} warnings (${warnings.filter(w => w.severity === 'error').length} errors)`);
  return warnings;
}

// Helper: Mock extraction for when OpenAI is unavailable
// Note: Returns only raw extracted data - no enrichment
function getMockExtractedRecipe(): ExtractedRecipeRaw {
  return {
    title: "Extracted Recipe",
    description: "A delicious recipe extracted from your handwritten note. (AI extraction unavailable - using placeholder)",
    prepTime: "15 mins",
    cookTime: "20 mins",
    totalTime: "35 mins",
    servings: 4,
    servingUnit: "servings",
    ingredients: [
      "2 cups main ingredient",
      "1 cup secondary ingredient",
      "1/2 teaspoon seasoning",
      "Salt and pepper to taste",
    ],
    instructions: [
      "Prepare all ingredients by washing and chopping as needed.",
      "Combine main ingredients in a large bowl or pot.",
      "Cook according to your preferred method (bake, sauté, or simmer).",
      "Season to taste and serve hot.",
    ],
    equipment: ["large bowl", "pot"],
    // No enrichment fields (nutrition, diet, cuisine) - those will be added in Phase 2
  };
}

// Helper: Basic enrichment when AI is unavailable
function getBasicEnrichment(raw: ExtractedRecipeRaw): EnrichedRecipeData {
  const normalizedIngredients = raw.ingredients.map((ing) => ({
    raw: ing,
    item: ing,
    isOptional: ing.toLowerCase().includes("optional"),
    isToolOrConsumable: false,
  }));
  
  const totalTimeMinutes = raw.totalTime ? parseTimeToMinutes(raw.totalTime) : undefined;
  const allergens: string[] = [];
  const cuisines = raw.cuisine 
    ? (Array.isArray(raw.cuisine) ? raw.cuisine : [raw.cuisine])
    : [];
  const standardEquipment = raw.equipment || [];
  const specializedEquipment: string[] = [];
  
  // Compute all derived fields using helper functions
  const nutritionFlags = deriveNutritionFlags({ fat: raw.fat, sodium: raw.sodium, sugar: raw.sugar });
  const allergenFreeTags = deriveAllergenFreeTags(allergens);
  const timeConvenienceTags = deriveTimeConvenienceTags(totalTimeMinutes);
  const groceryAisleTags = deriveGroceryAisleTags(normalizedIngredients);
  const cuisine = deriveLegacyCuisine(cuisines);
  const equipment = deriveLegacyEquipment(standardEquipment, specializedEquipment);
  
  return {
    normalizedIngredients,
    normalizedInstructions: raw.instructions.map((text, idx) => ({
      stepNumber: idx + 1,
      text,
      ingredients: [],
      tools: [],
    })),
    servings: raw.servings || 4, // Fallback to 4 if not provided
    prepTimeMinutes: raw.prepTime ? parseTimeToMinutes(raw.prepTime) : undefined,
    cookTimeMinutes: raw.cookTime ? parseTimeToMinutes(raw.cookTime) : undefined,
    totalTimeMinutes,
    skillLevel: "Intermediate",
    isVegetarian: raw.dietType?.includes("vegetarian") ?? false,
    isVegan: raw.dietType?.includes("vegan") ?? false,
    isPescatarian: false,
    isGlutenFree: raw.dietType?.includes("gluten-free") ?? false,
    isDairyFree: raw.dietType?.includes("dairy-free") ?? false,
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
    allergens,
    cuisines,
    cookingMethods: [],
    seasonTags: ["Year-Round"],
    occasionTags: ["Weeknight"],
    standardEquipment,
    specializedEquipment,
    priceRangeMin: 3,
    priceRangeMax: 6,
    priceCategory: "moderate",
    totalCost: undefined,
    costExcludingStaples: undefined,
    healthScore: undefined,
    healthScoreJustification: undefined,
    tips: [
      {
        type: "storage",
        text: "Store leftovers in an airtight container in the refrigerator for up to 3 days.",
      },
    ],
    variations: [],
    servingSuggestions: ["Serve with a side salad or bread"],
    aiEnrichmentFields: [],
    
    // Derived fields (computed deterministically)
    allergenFreeTags,
    timeConvenienceTags,
    groceryAisleTags,
    cuisine,
    equipment,
    ...nutritionFlags,
  } as unknown as EnrichedRecipeData;
}

// Helper: Parse time strings to minutes
function parseTimeToMinutes(timeStr: string): number {
  const hourMatch = timeStr.match(/(\d+)\s*(hr|hour)/i);
  const minMatch = timeStr.match(/(\d+)\s*(min|minute)/i);
  
  let minutes = 0;
  if (hourMatch) minutes += parseInt(hourMatch[1]) * 60;
  if (minMatch) minutes += parseInt(minMatch[1]);
  
  return minutes || 30; // Default to 30 if can't parse
}
