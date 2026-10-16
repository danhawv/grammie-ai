// Recipe importers shared by the import routes (server/routes/recipes.ts)
// and the party dish imports (server/routes/parties.ts). Each one saves the
// recipe as `userId` and charges the import; the caller checks credits with
// gate() first. Imports are public unless `isPublic: false` (party guests).

import heicConvert from "heic-convert";
import { insertRecipeSchema } from "@shared/schema";
import { detectLinkPlatform, normalizeUrl } from "@shared/link-platform";
import { storage } from "../storage";
import { extractRecipeFromUrl, extractRecipeFromText } from "../enrichment";
import { jobQueue } from "../job-queue";
import { generateThumbnail } from "../thumbnail";
import { detectPlatform, scrapePost, PLATFORM_NAMES, type SocialPlatform } from "../social-import-service";
import { extractRecipeFromSocialPostUnified } from "../ai-service";
import { recordImport } from "../recipe-imports";
import { charge, jobRefs } from "./credits";
import { straightenNewCard } from "./original-card";

export interface ImportOptions {
  /** Default true, like every import before parties */
  isPublic?: boolean;
}

export interface ImportResult {
  status: number;
  body: any;
}

/** A social post link sent with screenshots or a pasted caption */
export function socialLinkFrom(raw: unknown): { url: string; platform: "instagram" | "tiktok" | "youtube" } | null {
  if (typeof raw !== "string") return null;
  const url = normalizeUrl(raw);
  const platform = url ? detectLinkPlatform(url) : null;
  return url && (platform === "instagram" || platform === "tiktok" || platform === "youtube") ? { url, platform } : null;
}

// Gray placeholder shown until the dish photo is generated. The title is
// escaped: an "&" in "Mac & Cheese" would otherwise break the SVG.
export function placeholderImage(title: string, subtitle: string): string {
  const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const svg = `<svg width="1024" height="1024" xmlns="http://www.w3.org/2000/svg">
      <rect width="1024" height="1024" fill="#f3f4f6"/>
      <text x="512" y="462" font-family="Arial" font-size="48" fill="#9ca3af" text-anchor="middle">${esc(title)}</text>
      <text x="512" y="530" font-family="Arial" font-size="24" fill="#9ca3af" text-anchor="middle">${esc(subtitle)}</text>
    </svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;
}

// Web page import: structured data (JSON-LD) when the page has it, otherwise
// the AI reads the page text. `foundVia` is the social post that linked here.
export async function importWebLink(url: string, userId: string, foundVia?: string, opts: ImportOptions = {}): Promise<ImportResult> {
  const started = Date.now();
  const rawRecipe = await extractRecipeFromUrl(url);

  if (!rawRecipe.title || !rawRecipe.ingredients?.length || !rawRecipe.instructions?.length) {
    console.error("Invalid recipe data from URL extraction:", rawRecipe.title, rawRecipe.ingredients?.length, rawRecipe.instructions?.length);
    return {
      status: 400,
      body: { error: "We couldn't find a full recipe on that page. If the page shows one, copy it and use Paste text." },
    };
  }

  if (!rawRecipe.servings || rawRecipe.servings <= 0) rawRecipe.servings = 4;
  if (!rawRecipe.prepTime) rawRecipe.prepTime = "0 mins";
  if (!rawRecipe.totalTime) rawRecipe.totalTime = rawRecipe.cookTime || "0 mins";

  const cuisinesArray = rawRecipe.cuisine
    ? (Array.isArray(rawRecipe.cuisine) ? rawRecipe.cuisine : [rawRecipe.cuisine])
    : [];

  // Save what the page says now; enrichment fills in the rest in the background
  const recipeData = {
    ownerUserId: userId,
    isPublic: opts.isPublic ?? true,

    title: rawRecipe.title,
    description: rawRecipe.description,
    prepTime: rawRecipe.prepTime,
    cookTime: rawRecipe.cookTime,
    totalTime: rawRecipe.totalTime,
    coolingTime: rawRecipe.coolingTime,
    servings: rawRecipe.servings,
    servingUnit: rawRecipe.servingUnit,
    yield: rawRecipe.yield,
    ingredients: rawRecipe.ingredients,
    instructions: rawRecipe.instructions,
    equipment: rawRecipe.equipment,
    dietType: rawRecipe.dietType,
    cuisine: cuisinesArray[0] || null,
    cuisines: cuisinesArray,
    mealType: rawRecipe.mealType,

    calories: rawRecipe.calories,
    protein: rawRecipe.protein,
    carbohydrates: rawRecipe.carbohydrates,
    fat: rawRecipe.fat,
    fiber: rawRecipe.fiber,
    sugar: rawRecipe.sugar,
    sodium: rawRecipe.sodium,
    cholesterol: rawRecipe.cholesterol,

    dishImage: placeholderImage(rawRecipe.title, "Enriching metadata..."),

    enrichmentStatus: 'enriching' as const,
    enrichmentRetryCount: 0,
  };

  const validatedData = insertRecipeSchema.parse(recipeData);
  const recipe = await storage.createRecipe(validatedData);
  await recordImport({ recipeId: recipe.id, ownerUserId: userId, sourceType: foundVia ? 'social' : 'link', sourceUrl: foundVia || url });
  await charge(userId, "recipe_import", jobRefs.recipeImport(recipe.id));
  console.log(`[URL import] Recipe ${recipe.id} saved from ${new URL(url).hostname} in ${Date.now() - started}ms, queuing enrichment`);
  jobQueue.addEnrichmentJob(recipe.id);
  // Start the dish photo now, alongside enrichment, so it's ready sooner
  jobQueue.addImageGenerationJob(recipe.id, recipe.title, recipe.ingredients);

  return { status: 201, body: { recipeId: recipe.id } };
}

/** A pasted link: web pages go to the web importer, posts to the social one */
export async function importLink(url: string, userId: string, opts: ImportOptions = {}): Promise<ImportResult> {
  return detectPlatform(url) === "web" ? importWebLink(url, userId, undefined, opts) : importSocialLink(url, userId, opts);
}

// Social import (Instagram, TikTok, YouTube): read the caption, turn it into
// a recipe, save it, and queue enrichment. If the caption only points
// somewhere else ("full recipe at mysite.com/..."), import that page instead.
export async function importSocialLink(url: string, userId: string, opts: ImportOptions = {}): Promise<ImportResult> {
  const platform = detectPlatform(url) as SocialPlatform;
  const platformName = PLATFORM_NAMES[platform];
  const started = Date.now();

  const scrapeResult = await scrapePost(url);
  if (!scrapeResult.success || !scrapeResult.post) {
    return { status: 400, body: { error: scrapeResult.error || `We couldn't read that ${platformName} post.` } };
  }
  const post = scrapeResult.post;

  const extractedRecipe = await extractRecipeFromSocialPostUnified(post);
  // When the caption only describes the dish, the linked recipe page beats
  // a recipe the AI would have to make up
  if (!extractedRecipe || (extractedRecipe.captionHasRecipe === false && post.links.length)) {
    for (const link of post.links) {
      try {
        console.log(`[Social Import] Caption has no recipe, trying linked page ${link}`);
        const result = await importWebLink(link, userId, url, opts);
        if (result.status === 201) return result;
      } catch (err: any) {
        console.warn(`[Social Import] Linked page failed: ${err?.message}`);
      }
    }
    if (!extractedRecipe) return {
      status: 400,
      body: {
        error: post.links.length
          ? `That ${platformName} caption doesn't include the recipe, and we couldn't read the page it links to. Open the full recipe, copy it, and use Paste text.`
          : `That ${platformName} caption doesn't include the recipe. If the creator says the recipe is in the video or a link in their bio, copy it from there and use Paste text.`,
      },
    };
  }

  const recipeData = {
    ownerUserId: userId,
    isPublic: opts.isPublic ?? true,

    title: extractedRecipe.title,
    description: extractedRecipe.description || `Recipe imported from ${platformName}${post.creatorUsername ? ` @${post.creatorUsername}` : ""}`,

    ingredients: extractedRecipe.rawIngredients,
    instructions: extractedRecipe.rawInstructions,

    servings: extractedRecipe.servings || 4,
    prepTime: extractedRecipe.prepTimeMinutes ? `${extractedRecipe.prepTimeMinutes} mins` : "Not specified",
    cookTime: extractedRecipe.cookTimeMinutes ? `${extractedRecipe.cookTimeMinutes} mins` : null,
    totalTime: extractedRecipe.totalTimeMinutes ? `${extractedRecipe.totalTimeMinutes} mins` : null,

    cuisine: extractedRecipe.cuisineType || null,
    cuisines: extractedRecipe.cuisineType ? [extractedRecipe.cuisineType] : [],
    mealType: extractedRecipe.mealType ? [extractedRecipe.mealType] : [],
    dietType: extractedRecipe.dietaryTags || [],

    calories: extractedRecipe.nutritionInfo?.calories || null,
    protein: extractedRecipe.nutritionInfo?.protein || null,
    carbohydrates: extractedRecipe.nutritionInfo?.carbs || null,
    fat: extractedRecipe.nutritionInfo?.fat || null,

    dishImage: placeholderImage(extractedRecipe.title, `Imported from ${platformName}`),

    enrichmentStatus: 'enriching' as const,
    enrichmentRetryCount: 0,

    socialSourcePlatform: platform,
    socialSourceUrl: post.url,
    socialSourceCreatorUsername: post.creatorUsername || null,
    socialSourceCreatorAvatar: post.creatorAvatarUrl || null,
    socialSourcePostDate: post.postDate || null,
  };

  const validatedData = insertRecipeSchema.parse(recipeData);
  const recipe = await storage.createRecipe(validatedData);
  await recordImport({ recipeId: recipe.id, ownerUserId: userId, sourceType: 'social', sourceUrl: url });
  await charge(userId, "recipe_import", jobRefs.recipeImport(recipe.id));
  console.log(`[Social Import] Recipe ${recipe.id} saved from ${platformName} in ${Date.now() - started}ms, queuing enrichment`);
  jobQueue.addEnrichmentJob(recipe.id);
  // Start the dish photo now, alongside enrichment, so it's ready sooner
  jobQueue.addImageGenerationJob(recipe.id, recipe.title, recipe.ingredients);

  return {
    status: 201,
    body: {
      recipeId: recipe.id,
      message: `Recipe "${extractedRecipe.title}" imported from ${platformName}`,
      source: { type: platform, url: post.url, creator: post.creatorUsername },
      inferredFields: extractedRecipe.inferredFields,
    },
  };
}

/**
 * Pasted recipe text (already checked to be 20+ characters). `sourceUrl` is
 * the post a caption came from, if any. Throws when the model fails.
 */
export async function importPastedText(text: string, sourceUrl: unknown, userId: string, opts: ImportOptions = {}): Promise<ImportResult> {
  // A caption pasted after a post couldn't be read keeps its link
  const link = typeof sourceUrl === "string" ? normalizeUrl(sourceUrl) : null;
  const linkPlatform = link ? detectLinkPlatform(link) : null;
  const social = linkPlatform === "instagram" || linkPlatform === "tiktok" || linkPlatform === "youtube" ? linkPlatform : null;

  console.log(`Extracting recipe from pasted text (${text.length} chars)`);

  const rawRecipe = await extractRecipeFromText(text, social ? "caption" : "pasted");

  if (!rawRecipe.title || !rawRecipe.ingredients?.length || !rawRecipe.instructions?.length) {
    return { status: 400, body: { error: "We couldn't find a full recipe in that text. Include the title, the ingredients and the steps." } };
  }

  if (!rawRecipe.servings || rawRecipe.servings <= 0) rawRecipe.servings = 4;
  if (!rawRecipe.prepTime) rawRecipe.prepTime = "0 mins";
  if (!rawRecipe.totalTime) rawRecipe.totalTime = rawRecipe.cookTime || "0 mins";
  const placeholderDataUrl = placeholderImage(rawRecipe.title, "Generating image...");

  // Handle cuisines array
  const cuisinesArray = rawRecipe.cuisine
    ? (Array.isArray(rawRecipe.cuisine) ? rawRecipe.cuisine : [rawRecipe.cuisine])
    : [];

  // Save Phase 1 data immediately
  const recipeData = {
    ownerUserId: userId,
    isPublic: opts.isPublic ?? true,

    title: rawRecipe.title,
    description: rawRecipe.description,
    prepTime: rawRecipe.prepTime,
    cookTime: rawRecipe.cookTime,
    totalTime: rawRecipe.totalTime,
    coolingTime: rawRecipe.coolingTime,
    servings: rawRecipe.servings,
    servingUnit: rawRecipe.servingUnit,
    yield: rawRecipe.yield,
    ingredients: rawRecipe.ingredients,
    instructions: rawRecipe.instructions,
    equipment: rawRecipe.equipment,
    dietType: rawRecipe.dietType,
    cuisine: cuisinesArray[0] || null,
    cuisines: cuisinesArray,
    mealType: rawRecipe.mealType,

    calories: rawRecipe.calories,
    protein: rawRecipe.protein,
    carbohydrates: rawRecipe.carbohydrates,
    fat: rawRecipe.fat,
    fiber: rawRecipe.fiber,
    sugar: rawRecipe.sugar,
    sodium: rawRecipe.sodium,
    cholesterol: rawRecipe.cholesterol,

    dishImage: placeholderDataUrl,
    ...(social ? { socialSourcePlatform: social, socialSourceUrl: link } : link ? { sourceUrl: link } : {}),

    enrichmentStatus: 'enriching' as const,
    enrichmentRetryCount: 0,
  };

  const validatedData = insertRecipeSchema.parse(recipeData);
  const recipe = await storage.createRecipe(validatedData);
  await recordImport({ recipeId: recipe.id, ownerUserId: userId, sourceType: social ? 'social' : 'text', sourceText: text, ...(link ? { sourceUrl: link } : {}) });
  await charge(userId, "recipe_import", jobRefs.recipeImport(recipe.id));
  console.log(`Recipe ${recipe.id} saved from pasted text, queuing enrichment...`);

  // Queue Phase 2 enrichment
  jobQueue.addEnrichmentJob(recipe.id);
  // Start the dish photo now, alongside enrichment, so it's ready sooner
  jobQueue.addImageGenerationJob(recipe.id, recipe.title, recipe.ingredients);

  return { status: 201, body: { recipeId: recipe.id } };
}

/** One photo of a recipe card (or a screenshot of a post); extraction runs in the background */
export async function importPhoto(
  file: { buffer: Buffer; mimetype: string; originalname?: string },
  userId: string,
  fields: { sourceUrl?: unknown; sessionId?: string; sourceImageIndex?: string },
  opts: ImportOptions = {},
): Promise<ImportResult> {
  // Convert HEIC/HEIF files to JPEG (OpenAI Vision doesn't support HEIC)
  let imageBuffer = file.buffer;
  let mimetype = file.mimetype;
  const isHeic = mimetype === 'image/heic' ||
                 mimetype === 'image/heif' ||
                 file.originalname?.toLowerCase().endsWith('.heic') ||
                 file.originalname?.toLowerCase().endsWith('.heif');

  if (isHeic) {
    console.log("Converting HEIC/HEIF image to JPEG...");
    try {
      const jpegBuffer = await heicConvert({
        buffer: imageBuffer,
        format: 'JPEG',
        quality: 0.95
      });
      imageBuffer = Buffer.from(jpegBuffer);
      mimetype = 'image/jpeg';
      console.log("HEIC conversion successful");
    } catch (conversionError) {
      console.error("HEIC conversion failed:", conversionError);
      return { status: 400, body: { error: "Failed to convert HEIC image. Please try a different format." } };
    }
  }

  const imageBase64 = imageBuffer.toString("base64");
  const handwrittenImageDataUrl = `data:${mimetype};base64,${imageBase64}`;

  // Screenshots of a post whose link couldn't be read keep its link
  const shotOf = socialLinkFrom(fields.sourceUrl);

  // Get optional session metadata for multi-image uploads
  const sessionId = fields.sessionId;
  const sourceImageIndex = fields.sourceImageIndex;

  // Generate thumbnail for the uploaded source image
  let sourceImageThumbnail: string | null = null;
  try {
    sourceImageThumbnail = await generateThumbnail(handwrittenImageDataUrl, 256);
  } catch (thumbError) {
    console.warn("Failed to generate source image thumbnail:", thumbError);
  }

  // Create initial dishImages entry with the uploaded source image as preview
  const { randomUUID } = await import("crypto");
  const initialDishImages = [{
    id: randomUUID(),
    url: handwrittenImageDataUrl,
    thumbnailUrl: sourceImageThumbnail || undefined,
    isAiGenerated: false,
    order: 0,
    createdAt: new Date().toISOString(),
  }];

  // Create minimal placeholder recipe record IMMEDIATELY
  const recipeData: any = {
    ownerUserId: userId,
    isPublic: opts.isPublic ?? true,
    title: "Your Recipe", // Placeholder title
    prepTime: "0 mins",
    totalTime: "0 mins",
    servings: 1,
    ingredients: ["Extracting..."],
    instructions: ["Extracting from image..."],
    handwrittenImage: handwrittenImageDataUrl,
    dishImage: handwrittenImageDataUrl, // Use source image as initial preview
    dishImageThumbnail: sourceImageThumbnail,
    dishImages: initialDishImages, // Store source image in dishImages array
    enrichmentStatus: 'extracting' as const,
    enrichmentRetryCount: 0,
    ...(shotOf ? { socialSourcePlatform: shotOf.platform, socialSourceUrl: shotOf.url } : {}),
  };

  // Add session metadata if this is part of a multi-image upload
  if (sessionId) {
    recipeData.uploadSessionId = sessionId;
  }
  if (sourceImageIndex !== undefined) {
    // Parse string to number (FormData sends strings)
    recipeData.sourceImageIndex = parseInt(sourceImageIndex, 10);
  }

  // Validate and save minimal data
  const validatedData = insertRecipeSchema.parse(recipeData);
  const recipe = await storage.createRecipe(validatedData);
  // The original photo stays in handwrittenImage; this row tracks the review step
  await recordImport({ recipeId: recipe.id, ownerUserId: userId, sourceType: shotOf ? 'social' : 'photo', ...(shotOf ? { sourceUrl: shotOf.url } : {}) });
  await charge(userId, "recipe_import", jobRefs.recipeImport(recipe.id));
  console.log(`Recipe ${recipe.id} created${sessionId ? ` for session ${sessionId}` : ''}, queuing extraction...`);

  // Queue Vision extraction for background processing
  jobQueue.addExtractionJob(recipe.id, imageBase64);
  if (!shotOf) straightenNewCard(recipe.id);

  // Return immediately so the progress banner appears
  return { status: 201, body: { recipeId: recipe.id } };
}
