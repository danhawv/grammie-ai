import { buildImagePrompt } from "./openai";
import { storage } from "./storage";
import { 
  extractRecipeFromImageUnified,
  extractRecipeFromMultipleImagesUnified,
  enrichRecipeUnified,
  enrichRecipeParallel,
  enrichVariationRecipe,
  generateRecipeImageUnified,
  generateMissingInstructions,
  getCurrentProvider,
  type ExtractedRecipeRaw
} from "./ai-service";
import { generateThumbnail } from "./thumbnail";
import {
  deriveAllergenFreeTags,
  deriveTimeConvenienceTags,
  deriveGroceryAisleTags,
  deriveLegacyCuisine,
  deriveLegacyEquipment,
  deriveNutritionFlags,
} from "@shared/schema";
import { randomUUID } from "crypto";

interface ImageGenerationJob {
  type: 'image';
  id: string;
  recipeId: string;
  recipeName: string;
  ingredients: string[];
  retries: number;
}

interface EnrichmentJob {
  type: 'enrichment';
  id: string;
  recipeId: string;
  retries: number;
}

interface ExtractionJob {
  type: 'extraction';
  id: string;
  recipeId: string;
  imageBase64: string;
  retries: number;
  queuedAt?: number; // Timestamp when job was queued for timing analysis
}

interface MultiImageExtractionJob {
  type: 'multi-extraction';
  id: string;
  recipeId: string;
  imagesBase64: string[];
  retries: number;
  queuedAt?: number; // Timestamp when job was queued for timing analysis
}

type Job = ImageGenerationJob | EnrichmentJob | ExtractionJob | MultiImageExtractionJob;

// Helper: Update upload session progress after a recipe reaches terminal state
async function updateSessionProgress(recipeId: string) {
  try {
    const recipe = await storage.getRecipe(recipeId);
    if (!recipe || !recipe.uploadSessionId) return; // Not part of a session
    
    const sessionId = recipe.uploadSessionId;
    const sessionWithRecipes = await storage.getUploadSessionWithRecipes(sessionId);
    if (!sessionWithRecipes) return;
    
    // Count completed and failed recipes
    let completed = 0;
    let failed = 0;
    
    for (const r of sessionWithRecipes.recipes) {
      const isEnrichmentDone = r.enrichmentStatus === 'ready' || r.enrichmentStatus === 'failed';
      const isImageDone = r.imageGenerationStatus === 'ready' || r.imageGenerationStatus === 'failed';
      
      if (isEnrichmentDone && isImageDone) {
        if (r.enrichmentStatus === 'ready' && r.imageGenerationStatus === 'ready') {
          completed++;
        } else {
          failed++;
        }
      }
    }
    
    // Update session progress
    await storage.updateUploadSessionProgress(sessionId, completed, failed);
    
    // Mark session as completed if all recipes are done
    if (completed + failed === sessionWithRecipes.totalFiles) {
      await storage.completeUploadSession(sessionId);
      console.log(`Upload session ${sessionId} completed: ${completed} successful, ${failed} failed`);
    }
  } catch (error) {
    console.error(`Failed to update session progress for recipe ${recipeId}:`, error);
    // Don't throw - session progress is nice-to-have, not critical
  }
}

// Rate limit error detection helper
interface RateLimitInfo {
  isRateLimited: boolean;
  retryAfterMs: number | null;
  statusCode?: number;
}

function detectRateLimit(error: unknown): RateLimitInfo {
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    // Check for common rate limit indicators
    if (message.includes('429') || message.includes('rate limit') || message.includes('quota') || message.includes('too many requests')) {
      // Try to extract retry-after if present
      const retryMatch = message.match(/retry.?after[:\s]*(\d+)/i);
      const retryAfterMs = retryMatch ? parseInt(retryMatch[1]) * 1000 : 60000; // Default 60s
      return { isRateLimited: true, retryAfterMs, statusCode: 429 };
    }
    // Check for 503 service unavailable (often temporary)
    if (message.includes('503') || message.includes('service unavailable')) {
      return { isRateLimited: true, retryAfterMs: 30000, statusCode: 503 };
    }
  }
  return { isRateLimited: false, retryAfterMs: null };
}

// Fast job types (extraction/enrichment - quick AI operations)
type FastJob = ExtractionJob | MultiImageExtractionJob | EnrichmentJob;

class JobQueue {
  // Separate queues for fast jobs (extraction/enrichment) and slow jobs (image generation)
  private fastQueue: FastJob[] = []; // Extraction and enrichment jobs
  private imageQueue: ImageGenerationJob[] = []; // Image generation jobs (slow)
  
  private readonly MAX_RETRIES = 3; // Allow up to 2 retry attempts (3 total tries)
  private readonly JOB_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes timeout for fast jobs
  private readonly IMAGE_JOB_TIMEOUT_MS = 3 * 60 * 1000; // 3 minutes for image jobs (fail fast)
  
  // Separate worker pools to prevent blocking
  private readonly MAX_FAST_WORKERS = 3; // Extraction/enrichment workers
  private readonly MAX_IMAGE_WORKERS = 2; // Image generation workers (separate pool)
  private activeFastWorkers = 0;
  private activeImageWorkers = 0;
  
  // Legacy getter for backward compatibility
  private get queue(): Job[] {
    return [...this.fastQueue, ...this.imageQueue];
  }
  private get activeWorkers(): number {
    return this.activeFastWorkers + this.activeImageWorkers;
  }

  // Helper to wrap a job with timeout (prevents memory leaks by cleaning up timer)
  private async withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    jobDescription: string
  ): Promise<T> {
    let timeoutHandle: NodeJS.Timeout | null = null;
    
    const timeoutPromise = new Promise<T>((_, reject) => {
      timeoutHandle = setTimeout(
        () => reject(new Error(`${jobDescription} timed out after ${timeoutMs / 1000} seconds`)),
        timeoutMs
      );
    });

    try {
      const result = await Promise.race([promise, timeoutPromise]);
      return result;
    } finally {
      // Clean up timeout to prevent memory leaks and unhandled rejections
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
    }
  }

  private isJobQueued(recipeId: string, type: string): boolean {
    if (type === 'image') {
      return this.imageQueue.some(j => j.recipeId === recipeId);
    }
    return this.fastQueue.some(j => j.recipeId === recipeId && j.type === type);
  }

  async addImageGenerationJob(
    recipeId: string,
    recipeName: string,
    ingredients: string[]
  ) {
    if (this.isJobQueued(recipeId, 'image')) {
      console.log(`[Queue] Skipping duplicate image job for ${recipeId}`);
      return;
    }

    const job: ImageGenerationJob = {
      type: 'image',
      id: `img-${recipeId}`,
      recipeId,
      recipeName,
      ingredients,
      retries: 0,
    };

    this.imageQueue.push(job);
    console.log(`[Queue] Added image job for ${recipeId} (image queue: ${this.imageQueue.length}, fast queue: ${this.fastQueue.length})`);

    this.startImageWorkers();
  }

  async addExtractionJob(recipeId: string, imageBase64: string) {
    if (this.isJobQueued(recipeId, 'extraction')) {
      console.log(`[Queue] Skipping duplicate extraction job for ${recipeId}`);
      return;
    }

    const job: ExtractionJob = {
      type: 'extraction',
      id: `extract-${recipeId}`,
      recipeId,
      imageBase64,
      retries: 0,
      queuedAt: Date.now(), // Track when job was queued
    };

    // PRIORITY: Add extraction jobs to FRONT of queue so new uploads aren't blocked by enrichments
    // This prevents the 60+ second queue wait when enrichment jobs are running
    this.fastQueue.unshift(job);
    console.log(`[Queue] Added extraction job for ${recipeId} to FRONT (fast queue: ${this.fastQueue.length}, image queue: ${this.imageQueue.length})`);

    // Start fast worker if we have capacity
    this.startFastWorkers();
  }

  async addEnrichmentJob(recipeId: string) {
    if (this.isJobQueued(recipeId, 'enrichment')) {
      console.log(`[Queue] Skipping duplicate enrichment job for ${recipeId}`);
      return;
    }

    const job: EnrichmentJob = {
      type: 'enrichment',
      id: `enrich-${recipeId}`,
      recipeId,
      retries: 0,
    };

    // Add to fast queue (enrichment is fast)
    this.fastQueue.push(job);
    console.log(`[Queue] Added enrichment job for ${recipeId} (fast queue: ${this.fastQueue.length}, image queue: ${this.imageQueue.length})`);

    // Start fast worker if we have capacity
    this.startFastWorkers();
  }

  async addMultiImageExtractionJob(recipeId: string, imagesBase64: string[]) {
    const job: MultiImageExtractionJob = {
      type: 'multi-extraction',
      id: `multi-extract-${recipeId}`,
      recipeId,
      imagesBase64,
      retries: 0,
      queuedAt: Date.now(), // Track when job was queued
    };

    // PRIORITY: Add extraction jobs to FRONT of queue so new uploads aren't blocked by enrichments
    this.fastQueue.unshift(job);
    console.log(`[Queue] Added multi-extraction job for ${recipeId} with ${imagesBase64.length} images to FRONT (fast queue: ${this.fastQueue.length})`);

    // Start fast worker if we have capacity
    this.startFastWorkers();
  }

  // Start workers for fast jobs (extraction/enrichment)
  private startFastWorkers() {
    while (this.activeFastWorkers < this.MAX_FAST_WORKERS && this.fastQueue.length > 0) {
      const job = this.fastQueue.shift();
      if (!job) break;
      
      this.activeFastWorkers++;
      console.log(`[Worker] Starting FAST worker for ${job.type} (fast: ${this.activeFastWorkers}/${this.MAX_FAST_WORKERS}, image: ${this.activeImageWorkers}/${this.MAX_IMAGE_WORKERS})`);
      
      // Spawn async processing
      this.processFastJob(job);
    }
  }

  // Start workers for slow jobs (image generation)
  private startImageWorkers() {
    while (this.activeImageWorkers < this.MAX_IMAGE_WORKERS && this.imageQueue.length > 0) {
      const job = this.imageQueue.shift();
      if (!job) break;
      
      this.activeImageWorkers++;
      console.log(`[Worker] Starting IMAGE worker (fast: ${this.activeFastWorkers}/${this.MAX_FAST_WORKERS}, image: ${this.activeImageWorkers}/${this.MAX_IMAGE_WORKERS})`);
      
      // Spawn async processing
      this.processImageJobWrapper(job);
    }
  }

  // Legacy method for compatibility
  private startWorkers() {
    this.startFastWorkers();
    this.startImageWorkers();
  }

  // Process fast jobs (extraction/enrichment) with improved error handling
  private async processFastJob(job: ExtractionJob | MultiImageExtractionJob | EnrichmentJob) {
    const startTime = Date.now();
    
    // Log queue wait time for extraction jobs (they have queuedAt)
    if ('queuedAt' in job && job.queuedAt) {
      const queueWaitMs = startTime - job.queuedAt;
      console.log(`[Timing] ${job.type} for ${job.recipeId}: waited ${queueWaitMs}ms in queue before pickup`);
    }
    
    try {
      if (job.type === 'extraction') {
        await this.processExtractionJob(job);
      } else if (job.type === 'multi-extraction') {
        await this.processMultiImageExtractionJob(job);
      } else if (job.type === 'enrichment') {
        await this.processEnrichmentJob(job);
      }
      
      const durationMs = Date.now() - startTime;
      console.log(`[Timing] ${job.type} for ${job.recipeId}: completed in ${durationMs}ms (processing time only)`);
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      console.error(`[Worker] FAST job ${job.type} failed after ${durationMs}ms: ${errorMsg}`);

      // Check for rate limiting
      const rateLimitInfo = detectRateLimit(error);
      
      if (job.retries < this.MAX_RETRIES) {
        job.retries++;
        
        // Use rate limit delay if detected, otherwise exponential backoff
        let retryDelay: number;
        if (rateLimitInfo.isRateLimited && rateLimitInfo.retryAfterMs) {
          retryDelay = rateLimitInfo.retryAfterMs;
          console.log(`[Worker] Rate limit detected (${rateLimitInfo.statusCode}), waiting ${retryDelay}ms before retry`);
        } else {
          const baseDelay = Math.pow(2, job.retries) * 1000;
          const jitter = Math.random() * 1000;
          retryDelay = baseDelay + jitter;
        }
        
        console.log(`[Worker] Re-queuing ${job.type} job (retry ${job.retries}/${this.MAX_RETRIES}) after ${Math.round(retryDelay)}ms`);
        
        await new Promise(resolve => setTimeout(resolve, retryDelay));
        this.fastQueue.push(job);
        this.startFastWorkers();
      } else {
        console.error(`[Worker] Max retries reached for ${job.type} job on recipe ${job.recipeId}`);
        
        const updateData: any = {
          enrichmentStatus: 'failed',
          enrichmentError: errorMsg,
        };
        
        if (job.type === 'extraction' || job.type === 'multi-extraction') {
          updateData.title = 'Failed to Extract Recipe';
          updateData.imageGenerationStatus = 'failed';
          updateData.imageGenerationError = 'Extraction failed - image generation skipped';
        }
        
        await storage.updateRecipe(job.recipeId, updateData);
        await updateSessionProgress(job.recipeId);
      }
    } finally {
      this.activeFastWorkers--;
      console.log(`[Worker] FAST worker finished (fast: ${this.activeFastWorkers}/${this.MAX_FAST_WORKERS}, image: ${this.activeImageWorkers}/${this.MAX_IMAGE_WORKERS})`);
      
      if (this.fastQueue.length > 0) {
        this.startFastWorkers();
      } else if (this.activeFastWorkers === 0 && this.activeImageWorkers === 0 && this.imageQueue.length === 0) {
        console.log("[Queue] All workers complete");
      }
    }
  }

  // Process image jobs with separate error handling and graceful degradation
  private async processImageJobWrapper(job: ImageGenerationJob) {
    const startTime = Date.now();
    try {
      await this.processImageJob(job);
      
      const durationMs = Date.now() - startTime;
      console.log(`[Worker] IMAGE job completed in ${durationMs}ms for ${job.recipeId}`);
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      console.error(`[Worker] IMAGE job failed after ${durationMs}ms: ${errorMsg}`);

      const rateLimitInfo = detectRateLimit(error);
      
      // Graceful degradation: fewer retries for image jobs to avoid blocking
      const imageMaxRetries = 2; // Only 2 retries for images (less than enrichment)
      
      if (job.retries < imageMaxRetries) {
        job.retries++;
        
        let retryDelay: number;
        if (rateLimitInfo.isRateLimited && rateLimitInfo.retryAfterMs) {
          retryDelay = rateLimitInfo.retryAfterMs;
          console.log(`[Worker] Image rate limit (${rateLimitInfo.statusCode}), waiting ${retryDelay}ms`);
        } else {
          // Longer backoff for image jobs
          const baseDelay = Math.pow(2, job.retries) * 2000; // 4s, 8s
          const jitter = Math.random() * 2000;
          retryDelay = baseDelay + jitter;
        }
        
        console.log(`[Worker] Re-queuing image job (retry ${job.retries}/${imageMaxRetries}) after ${Math.round(retryDelay)}ms`);
        
        await new Promise(resolve => setTimeout(resolve, retryDelay));
        this.imageQueue.push(job);
        this.startImageWorkers();
      } else {
        // Mark as failed after graceful degradation - recipe still usable without image
        console.log(`[Worker] Image generation failed for ${job.recipeId} after ${imageMaxRetries} retries - skipping (recipe still usable)`);
        
        await storage.updateRecipe(job.recipeId, {
          imageGenerationStatus: 'failed',
          imageGenerationError: `Image generation failed: ${errorMsg}`,
        });
        await updateSessionProgress(job.recipeId);
      }
    } finally {
      this.activeImageWorkers--;
      console.log(`[Worker] IMAGE worker finished (fast: ${this.activeFastWorkers}/${this.MAX_FAST_WORKERS}, image: ${this.activeImageWorkers}/${this.MAX_IMAGE_WORKERS})`);
      
      if (this.imageQueue.length > 0) {
        this.startImageWorkers();
      } else if (this.activeFastWorkers === 0 && this.activeImageWorkers === 0 && this.fastQueue.length === 0) {
        console.log("[Queue] All workers complete");
      }
    }
  }

  // Legacy processJob for backward compatibility
  private async processJob(job: Job) {
    if (job.type === 'image') {
      await this.processImageJobWrapper(job as ImageGenerationJob);
    } else {
      await this.processFastJob(job as ExtractionJob | MultiImageExtractionJob | EnrichmentJob);
    }
  }

  private async processImageJob(job: ImageGenerationJob) {
    console.log(`Processing image generation job for recipe ${job.recipeId}...`);

    try {
      // Mark as generating and set start time
      await storage.updateRecipe(job.recipeId, {
        imageGenerationStatus: 'generating',
        imageGenerationStartedAt: new Date(),
        imageGenerationError: null,
      });

      // Fetch full recipe to get instructions and metadata for better image generation
      const recipe = await storage.getRecipe(job.recipeId);
      
      // Build context for image generation
      const recipeContext = recipe ? {
        instructions: recipe.instructions,
        cookingMethods: recipe.cookingMethods || undefined,
        cuisines: recipe.cuisines || undefined,
        mealType: recipe.mealType || undefined,
        skillLevel: recipe.skillLevel || undefined,
      } : undefined;

      // Build and store the prompt for future editing
      const imagePrompt = buildImagePrompt(job.recipeName, job.ingredients, recipeContext);

      // Wrap image generation in timeout - use unified AI service
      const provider = getCurrentProvider();
      console.log(`[Job Queue] Generating image using ${provider.toUpperCase()}`);
      
      const imageGenStart = Date.now();
      const imageResult = await this.withTimeout(
        generateRecipeImageUnified(
          job.recipeName, 
          job.ingredients, 
          recipeContext?.cuisines || [],
          recipeContext?.cookingMethods || [],
          recipeContext // Pass full context for OpenAI prompt enhancement
        ),
        this.IMAGE_JOB_TIMEOUT_MS, // Use shorter timeout for images (fail fast)
        'Image generation'
      );
      const imageGenMs = Date.now() - imageGenStart;

      const dishImageBuffer = imageResult.imageBuffer;
      console.log(`[Job Queue] Image generated by ${imageResult.provider} in ${imageResult.durationMs}ms (${imageResult.format})`);
      console.log(`[Timing] Phase 3 image generation: ${imageGenMs}ms (${imageResult.provider})`);

      // Check if it's an SVG (placeholder) or real image
      const isSvg = dishImageBuffer.toString("utf8").startsWith("<svg");
      const mimeType = isSvg ? "image/svg+xml" : (imageResult.format === "png" ? "image/png" : "image/webp");
      const dishImageDataUrl = `data:${mimeType};base64,${dishImageBuffer.toString("base64")}`;

      // Generate thumbnail (256x256, ~150KB)
      let thumbnailDataUrl: string | null = null;
      if (!isSvg) {
        try {
          thumbnailDataUrl = await generateThumbnail(dishImageDataUrl, 256);
          console.log(`Generated thumbnail for recipe ${job.recipeId}`);
        } catch (error) {
          console.error(`Failed to generate thumbnail for recipe ${job.recipeId}:`, error);
          // Continue without thumbnail - not critical
        }
      }

      // Create the new image entry for dishImages array
      const newDishImage = {
        id: randomUUID(),
        url: dishImageDataUrl,
        thumbnailUrl: thumbnailDataUrl || undefined,
        isAiGenerated: true,
        order: 0,
        createdAt: new Date().toISOString(),
      };

      // Get existing dishImages array and add new image at front (AI image becomes primary)
      const existingImages = recipe?.dishImages || [];
      const updatedImages = [newDishImage, ...existingImages.map((img, idx) => ({ ...img, order: idx + 1 }))].slice(0, 5);

      // Update the recipe with the generated image, thumbnail, prompt, and images array
      await storage.updateRecipe(job.recipeId, {
        dishImage: dishImageDataUrl,
        dishImageThumbnail: thumbnailDataUrl,
        imagePrompt: imagePrompt,
        dishImages: updatedImages,
        imageGenerationStatus: 'ready',
      });

      console.log(
        `Successfully generated and saved dish image${thumbnailDataUrl ? ' with thumbnail' : ''} for recipe ${job.recipeId}`
      );
      
      // Update session progress if part of multi-upload
      await updateSessionProgress(job.recipeId);
    } catch (error) {
      // Mark as failed with error message
      const errorMessage = error instanceof Error ? error.message : 'Unknown error during image generation';
      await storage.updateRecipe(job.recipeId, {
        imageGenerationStatus: 'failed',
        imageGenerationError: errorMessage,
      });
      throw error; // Re-throw to trigger retry logic
    }
  }

  private async processExtractionJob(job: ExtractionJob) {
    const provider = getCurrentProvider();
    console.log(`Processing extraction job for recipe ${job.recipeId} using ${provider.toUpperCase()}...`);
    
    const { insertRecipeSchema } = await import('@shared/schema');

    try {
      // Mark as extracting
      await storage.updateRecipe(job.recipeId, {
        enrichmentStatus: 'extracting',
      });

      // Extract recipe data from image with timeout - use unified AI service
      const extractionStart = Date.now();
      let rawRecipe = await this.withTimeout(
        extractRecipeFromImageUnified(job.imageBase64),
        this.JOB_TIMEOUT_MS,
        'Vision extraction'
      );
      const extractionMs = Date.now() - extractionStart;
      console.log(`[Timing] Phase 1 extraction: ${extractionMs}ms (${provider})`);
      

      // Handle error responses from Vision (e.g., "text is too small/blurry")
      if ((rawRecipe as any).error) {
        console.warn(`Vision extraction returned error: ${(rawRecipe as any).error}`);
        throw new Error(`Vision extraction failed: ${(rawRecipe as any).error}`);
      }

      // Handle multiple recipes extracted from a single page - use first recipe
      if (Array.isArray((rawRecipe as any).recipes)) {
        console.log(`Vision extracted ${(rawRecipe as any).recipes.length} recipes from page, using first one`);
        rawRecipe = (rawRecipe as any).recipes[0];
      }

      // Validate extracted recipe has required fields - only ingredients is truly required
      if (!rawRecipe.ingredients || rawRecipe.ingredients.length === 0) {
        throw new Error('Invalid recipe data from AI extraction - missing ingredients');
      }

      // If instructions are empty/missing, provide a placeholder so enrichment can add cooking steps
      if (!rawRecipe.instructions || rawRecipe.instructions.length === 0) {
        console.warn('Vision extraction returned no instructions - using placeholder for enrichment');
        rawRecipe.instructions = ['Instructions could not be extracted from the image. Please review and update after enrichment.'];
      }

      // Provide fallbacks for optional fields
      if (!rawRecipe.title) {
        // Generate placeholder title from first ingredient if available
        const firstIngredient = rawRecipe.ingredients[0]?.toLowerCase() || '';
        if (firstIngredient.includes('chicken')) rawRecipe.title = "Chicken Recipe";
        else if (firstIngredient.includes('beef')) rawRecipe.title = "Beef Recipe";
        else if (firstIngredient.includes('pork')) rawRecipe.title = "Pork Recipe";
        else if (firstIngredient.includes('fish') || firstIngredient.includes('salmon') || firstIngredient.includes('tuna')) rawRecipe.title = "Fish Recipe";
        else if (firstIngredient.includes('pasta') || firstIngredient.includes('spaghetti')) rawRecipe.title = "Pasta Recipe";
        else if (firstIngredient.includes('rice')) rawRecipe.title = "Rice Recipe";
        else rawRecipe.title = "Your Recipe"; // Generic fallback
      }
      if (!rawRecipe.prepTime) rawRecipe.prepTime = "0 mins";
      if (!rawRecipe.totalTime) rawRecipe.totalTime = rawRecipe.cookTime || "0 mins";

      // Update recipe with extracted data (servings will be determined by enrichment)
      await storage.updateRecipe(job.recipeId, {
        title: rawRecipe.title,
        description: rawRecipe.description,
        prepTime: rawRecipe.prepTime,
        cookTime: rawRecipe.cookTime,
        totalTime: rawRecipe.totalTime,
        coolingTime: rawRecipe.coolingTime,
        servings: rawRecipe.servings || undefined, // Keep if extracted, otherwise let enrichment determine it
        servingUnit: rawRecipe.servingUnit,
        servingSize: rawRecipe.servingSize,
        yield: rawRecipe.yield,
        ingredients: rawRecipe.ingredients,
        instructions: rawRecipe.instructions,
        equipment: rawRecipe.equipment,
        dietType: rawRecipe.dietType,
        cuisine: Array.isArray(rawRecipe.cuisine) ? rawRecipe.cuisine[0] : rawRecipe.cuisine,
        mealType: rawRecipe.mealType,
        calories: rawRecipe.calories,
        protein: rawRecipe.protein,
        carbohydrates: rawRecipe.carbohydrates,
        fat: rawRecipe.fat,
        fiber: rawRecipe.fiber,
        sugar: rawRecipe.sugar,
        sodium: rawRecipe.sodium,
        cholesterol: rawRecipe.cholesterol,
        enrichmentStatus: 'enriching',
      });

      console.log(`Recipe ${job.recipeId} extracted, queuing enrichment...`);

      // Queue enrichment job (image generation will happen after enrichment completes)
      this.addEnrichmentJob(job.recipeId);
    } catch (error) {
      // Mark extraction as failed but don't update imageGenerationStatus yet
      // (retries might still succeed, and we need imageGenerationStatus='pending' for that)
      const errorMessage = error instanceof Error ? error.message : 'Unknown error during extraction';
      await storage.updateRecipe(job.recipeId, {
        enrichmentStatus: 'failed',
        enrichmentError: errorMessage,
      });
      
      throw error; // Re-throw to trigger retry logic (or mark as permanently failed)
    }
  }

  private async processMultiImageExtractionJob(job: MultiImageExtractionJob) {
    console.log(`Processing multi-image extraction job for recipe ${job.recipeId} with ${job.imagesBase64.length} images...`);

    try {
      // Mark as extracting
      await storage.updateRecipe(job.recipeId, {
        enrichmentStatus: 'extracting',
      });

      // Extract recipe data from multiple images with timeout - uses unified AI service (Gemini/OpenAI)
      let rawRecipe = await this.withTimeout(
        extractRecipeFromMultipleImagesUnified(job.imagesBase64),
        this.JOB_TIMEOUT_MS,
        'Multi-image vision extraction'
      );

      // Handle error responses from Vision
      if ((rawRecipe as any).error) {
        console.warn(`Vision extraction returned error: ${(rawRecipe as any).error}`);
        throw new Error(`Vision extraction failed: ${(rawRecipe as any).error}`);
      }

      // Validate extracted recipe has required fields - only ingredients is truly required
      if (!rawRecipe.ingredients || rawRecipe.ingredients.length === 0) {
        throw new Error('Invalid recipe data from AI extraction - missing ingredients');
      }

      // If instructions are empty/missing, provide a placeholder
      if (!rawRecipe.instructions || rawRecipe.instructions.length === 0) {
        console.warn('Vision extraction returned no instructions - using placeholder for enrichment');
        rawRecipe.instructions = ['Instructions could not be extracted from the images. Please review and update after enrichment.'];
      }

      // Provide fallbacks for optional fields
      if (!rawRecipe.title) {
        const firstIngredient = rawRecipe.ingredients[0]?.toLowerCase() || '';
        if (firstIngredient.includes('chicken')) rawRecipe.title = "Chicken Recipe";
        else if (firstIngredient.includes('beef')) rawRecipe.title = "Beef Recipe";
        else if (firstIngredient.includes('pork')) rawRecipe.title = "Pork Recipe";
        else if (firstIngredient.includes('fish') || firstIngredient.includes('salmon') || firstIngredient.includes('tuna')) rawRecipe.title = "Fish Recipe";
        else if (firstIngredient.includes('pasta') || firstIngredient.includes('spaghetti')) rawRecipe.title = "Pasta Recipe";
        else if (firstIngredient.includes('rice')) rawRecipe.title = "Rice Recipe";
        else rawRecipe.title = "Your Recipe";
      }
      if (!rawRecipe.prepTime) rawRecipe.prepTime = "0 mins";
      if (!rawRecipe.totalTime) rawRecipe.totalTime = rawRecipe.cookTime || "0 mins";

      // Update recipe with extracted data
      await storage.updateRecipe(job.recipeId, {
        title: rawRecipe.title,
        description: rawRecipe.description,
        prepTime: rawRecipe.prepTime,
        cookTime: rawRecipe.cookTime,
        totalTime: rawRecipe.totalTime,
        coolingTime: rawRecipe.coolingTime,
        servings: rawRecipe.servings || undefined,
        servingUnit: rawRecipe.servingUnit,
        servingSize: rawRecipe.servingSize,
        yield: rawRecipe.yield,
        ingredients: rawRecipe.ingredients,
        instructions: rawRecipe.instructions,
        equipment: rawRecipe.equipment,
        dietType: rawRecipe.dietType,
        cuisine: Array.isArray(rawRecipe.cuisine) ? rawRecipe.cuisine[0] : rawRecipe.cuisine,
        mealType: rawRecipe.mealType,
        calories: rawRecipe.calories,
        protein: rawRecipe.protein,
        carbohydrates: rawRecipe.carbohydrates,
        fat: rawRecipe.fat,
        fiber: rawRecipe.fiber,
        sugar: rawRecipe.sugar,
        sodium: rawRecipe.sodium,
        cholesterol: rawRecipe.cholesterol,
        enrichmentStatus: 'enriching',
      });

      console.log(`Recipe ${job.recipeId} extracted from ${job.imagesBase64.length} images, queuing enrichment...`);

      // Queue enrichment job (image generation will happen after enrichment completes)
      this.addEnrichmentJob(job.recipeId);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error during multi-image extraction';
      await storage.updateRecipe(job.recipeId, {
        enrichmentStatus: 'failed',
        enrichmentError: errorMessage,
      });
      
      throw error; // Re-throw to trigger retry logic
    }
  }

  private async processEnrichmentJob(job: EnrichmentJob) {
    console.log(`Processing enrichment job for recipe ${job.recipeId}...`);

    try {
      // Load the recipe
      const recipe = await storage.getRecipe(job.recipeId);
      if (!recipe) {
        throw new Error(`Recipe ${job.recipeId} not found`);
      }
      
      // Check if this is a variation (Make Your Own) - use lightweight enrichment
      const isVariation = !!recipe.derivedFromRecipeId;
      if (isVariation) {
        console.log(`[Job Queue] Recipe ${job.recipeId} is a variation - using LIGHTWEIGHT enrichment`);
        await this.processVariationEnrichment(job, recipe);
        return;
      }

      // Validate recipe has minimum required fields (guard against tampered storage)
      // Note: servings is optional here, will be determined by enrichment
      // Note: instructions can be missing - they will be generated if needed
      if (!recipe.title || !recipe.ingredients || recipe.ingredients.length === 0 ||
          !recipe.prepTime || !recipe.totalTime) {
        throw new Error(`Recipe ${job.recipeId} is missing required Phase 1 fields`);
      }
      
      // Generate instructions if missing, insufficient, or too terse
      // The generateMissingInstructions function handles all the logic for when generation is needed
      let instructionsToUse = recipe.instructions || [];
      let instructionsGenerated = recipe.instructionsGenerated || false;
      
      // Store original extracted instructions before any AI modification
      // This allows users to toggle between AI-enhanced and original instructions
      const originalInstructions = [...instructionsToUse]; // Copy of original extracted instructions
      
      // Delegate instruction generation decision to ai-service (handles count + terseness checks)
      const rawForInstructions: ExtractedRecipeRaw = {
        title: recipe.title,
        ingredients: recipe.ingredients,
        instructions: instructionsToUse,
      };
      const generationResult = await generateMissingInstructions(rawForInstructions, instructionsGenerated);
      if (generationResult.wasGenerated && generationResult.instructions.length > 0) {
        instructionsToUse = generationResult.instructions;
        instructionsGenerated = true;
        console.log(`[Job Queue] Generated ${instructionsToUse.length} instructions for recipe ${job.recipeId}`);
        // Update recipe with generated instructions and save original for toggle feature
        await storage.updateRecipe(job.recipeId, {
          instructions: instructionsToUse,
          instructionsGenerated: true,
          originalInstructions: originalInstructions.length > 0 ? originalInstructions : null,
        });
      }

      // CRITICAL: Increment retry counter at START of attempt (not end)
      // This ensures every attempt is tracked, even if it fails and gets re-queued
      const currentRetryCount = recipe.enrichmentRetryCount || 0;
      await storage.updateRecipe(job.recipeId, {
        enrichmentRetryCount: currentRetryCount + 1,
        enrichmentStartedAt: new Date(),
        enrichmentError: null,
      });

      // Build ExtractedRecipeRaw from the saved recipe (use generated instructions if applicable)
      const raw: ExtractedRecipeRaw = {
        title: recipe.title,
        description: recipe.description || undefined,
        prepTime: recipe.prepTime,
        cookTime: recipe.cookTime || undefined,
        totalTime: recipe.totalTime,
        coolingTime: recipe.coolingTime || undefined,
        servings: recipe.servings,
        servingUnit: recipe.servingUnit || undefined,
        yield: recipe.yield || undefined,
        ingredients: recipe.ingredients,
        instructions: instructionsToUse,
        equipment: recipe.equipment || undefined,
        dietType: recipe.dietType || undefined,
        cuisine: recipe.cuisine || undefined,
        mealType: recipe.mealType || undefined,
        calories: recipe.calories || undefined,
        protein: recipe.protein || undefined,
        carbohydrates: recipe.carbohydrates || undefined,
        fat: recipe.fat || undefined,
        fiber: recipe.fiber || undefined,
        sugar: recipe.sugar || undefined,
        sodium: recipe.sodium || undefined,
        cholesterol: recipe.cholesterol || undefined,
      };

      // Run Phase 2 PARALLEL enrichment with timeout - use unified AI service
      const provider = getCurrentProvider();
      console.log(`[Job Queue] Enriching recipe using ${provider.toUpperCase()} (PARALLEL)`);
      
      const enrichmentStart = Date.now();
      const parallelResult = await this.withTimeout(
        enrichRecipeParallel(raw),
        this.JOB_TIMEOUT_MS,
        'Recipe enrichment (parallel)'
      );
      const enriched = parallelResult.enrichedData;
      const enrichmentMs = Date.now() - enrichmentStart;
      console.log(`[Timing] Phase 2 enrichment: ${enrichmentMs}ms (${provider}) [parallel: G1=${parallelResult.timings.group1Ms}ms, G2=${parallelResult.timings.group2Ms}ms, G3=${parallelResult.timings.group3Ms}ms]`);
      
      
      // Update recipe with all enriched fields
      // If AI provided a corrected title, use it (fixes OCR/handwriting extraction errors)
      const titleUpdate = enriched.correctedTitle ? { title: enriched.correctedTitle } : {};
      if (enriched.correctedTitle && enriched.correctedTitle !== recipe.title) {
        console.log(`[Job Queue] Title corrected: "${recipe.title}" → "${enriched.correctedTitle}"`);
      }
      
      await storage.updateRecipe(job.recipeId, {
        // Title correction (from AI enrichment - fixes misspellings from handwritten extraction)
        ...titleUpdate,
        
        // Normalized structures
        normalizedIngredients: enriched.normalizedIngredients,
        normalizedInstructions: enriched.normalizedInstructions,
        
        // Servings (determined by enrichment from ingredient quantities)
        servings: enriched.servings || 4, // Fallback to 4 if AI doesn't provide
        
        // Time fields
        prepTimeMinutes: enriched.prepTimeMinutes,
        cookTimeMinutes: enriched.cookTimeMinutes,
        totalTimeMinutes: enriched.totalTimeMinutes,
        
        // Skill
        skillLevel: enriched.skillLevel,
        skillLevelExplanation: enriched.skillLevelExplanation,
        
        // All 19 dietary flags
        isVegetarian: enriched.isVegetarian,
        isVegan: enriched.isVegan,
        isPescatarian: enriched.isPescatarian,
        isGlutenFree: enriched.isGlutenFree,
        isDairyFree: enriched.isDairyFree,
        isKeto: enriched.isKeto,
        isPaleo: enriched.isPaleo,
        isLowCarb: enriched.isLowCarb,
        isHighProtein: enriched.isHighProtein,
        isLowCalorie: enriched.isLowCalorie,
        isHighFiber: enriched.isHighFiber,
        isLactoVegetarian: enriched.isLactoVegetarian,
        isMediterranean: enriched.isMediterranean,
        isOvoVegetarian: enriched.isOvoVegetarian,
        isOvoLactoVegetarian: enriched.isOvoLactoVegetarian,
        isFlexitarian: enriched.isFlexitarian,
        isCarnivore: enriched.isCarnivore,
        isKosher: enriched.isKosher,
        isHalal: enriched.isHalal,
        isHindu: enriched.isHindu,
        
        // Allergens
        allergens: enriched.allergens,
        allergenFreeTags: enriched.allergenFreeTags,
        
        // Cuisines (multi-select)
        cuisines: enriched.cuisines,
        cuisine: enriched.cuisine,
        
        // Meal type (from enrichment - ensure non-empty)
        mealType: Array.isArray(enriched.mealType) && enriched.mealType.length > 0
          ? enriched.mealType
          : (recipe.mealType && recipe.mealType.length > 0 ? recipe.mealType : ["Dinner"]),
        
        // Methods and tags
        cookingMethods: enriched.cookingMethods,
        seasonTags: enriched.seasonTags,
        occasionTags: enriched.occasionTags,
        
        // Equipment split
        standardEquipment: enriched.standardEquipment,
        specializedEquipment: enriched.specializedEquipment,
        equipment: enriched.equipment,
        
        // Grocery
        groceryAisleTags: enriched.groceryAisleTags,
        
        // Time convenience
        timeConvenienceTags: enriched.timeConvenienceTags,
        
        // Pricing
        priceRangeMin: enriched.priceRangeMin,
        priceRangeMax: enriched.priceRangeMax,
        priceCategory: enriched.priceCategory,
        totalCost: enriched.totalCost,
        costExcludingStaples: enriched.costExcludingStaples,
        
        // Health
        healthScore: enriched.healthScore,
        
        // Nutrition facts (NEW - per serving)
        calories: enriched.calories,
        protein: enriched.protein,
        carbohydrates: enriched.carbohydrates,
        fat: enriched.fat,
        fiber: enriched.fiber,
        sugar: enriched.sugar,
        sodium: enriched.sodium,
        cholesterol: enriched.cholesterol,
        
        // Nutrition flags
        isLowFat: enriched.isLowFat,
        isLowSodium: enriched.isLowSodium,
        isLowSugar: enriched.isLowSugar,
        
        // Content
        tips: enriched.tips,
        variations: enriched.variations,
        servingSuggestions: enriched.servingSuggestions,
        
        // NEW: Beverage pairings (wines, beers, cocktails, non-alcoholic)
        beveragePairings: enriched.beveragePairings,
        
        // NEW: Recipe variations (lower calorie, higher protein, Michelin upgrades, budget-friendly)
        recipeVariations: enriched.recipeVariations,
        
        // NEW: Cultural significance and history
        culturalSignificance: enriched.culturalSignificance,
        
        // NEW: Celebrity chef reviews
        celebrityChefReviews: enriched.celebrityChefReviews,
        
        // Metadata
        aiEnriched: true,
        aiEnrichmentFields: enriched.aiEnrichmentFields,
        
        // CRITICAL: Mark enrichment as complete
        enrichmentStatus: 'ready',
        enrichmentError: null,
      });

      console.log(`Successfully enriched recipe ${job.recipeId} (attempt ${currentRetryCount + 1})`);
      
      // Update session progress if part of multi-upload
      await updateSessionProgress(job.recipeId);
      
      // Queue image generation if not already started/completed
      const updatedRecipe = await storage.getRecipe(job.recipeId);
      if (updatedRecipe && updatedRecipe.imageGenerationStatus === 'pending') {
        console.log(`Queuing image generation for recipe ${job.recipeId}...`);
        const ingredientNames = updatedRecipe.normalizedIngredients?.map(i => i.item) || updatedRecipe.ingredients;
        this.addImageGenerationJob(job.recipeId, updatedRecipe.title, ingredientNames);
      }
    } catch (error) {
      // Mark as failed with error message
      const errorMessage = error instanceof Error ? error.message : 'Unknown error during enrichment';
      await storage.updateRecipe(job.recipeId, {
        enrichmentStatus: 'failed',
        enrichmentError: errorMessage,
      });
      
      // Update session progress even for failed recipes
      await updateSessionProgress(job.recipeId);
      throw error; // Re-throw to trigger retry logic
    }
  }

  // Lightweight enrichment for recipe variations (Make Your Own)
  // Preserves AI-generated ingredients/instructions, only adds dietary analysis + nutrition
  private async processVariationEnrichment(job: EnrichmentJob, recipe: any) {
    const provider = getCurrentProvider();
    console.log(`[Job Queue] VARIATION enrichment for "${recipe.title}" using ${provider.toUpperCase()}`);
    
    try {
      // Track retry count
      const currentRetryCount = recipe.enrichmentRetryCount || 0;
      await storage.updateRecipe(job.recipeId, {
        enrichmentRetryCount: currentRetryCount + 1,
        enrichmentStartedAt: new Date(),
        enrichmentError: null,
      });
      
      // Build minimal raw recipe for variation enrichment
      const raw: ExtractedRecipeRaw = {
        title: recipe.title,
        description: recipe.description || undefined,
        prepTime: recipe.prepTime,
        cookTime: recipe.cookTime || undefined,
        totalTime: recipe.totalTime,
        servings: recipe.servings,
        ingredients: recipe.ingredients,
        instructions: recipe.instructions || [],
      };
      
      const enrichmentStart = Date.now();
      const variationResult = await this.withTimeout(
        enrichVariationRecipe(raw),
        this.JOB_TIMEOUT_MS,
        'Variation enrichment (lightweight)'
      );
      const enriched = variationResult.enrichedData;
      const enrichmentMs = Date.now() - enrichmentStart;
      console.log(`[Timing] Variation enrichment: ${enrichmentMs}ms (${provider}) [dietary=${variationResult.timings.dietaryMs}ms, nutrition=${variationResult.timings.nutritionMs}ms]`);
      
      // Helper to coerce values to integers (AI may return decimals like "7.5")
      const toInt = (val: any): number | undefined => {
        if (val === null || val === undefined) return undefined;
        const num = typeof val === 'string' ? parseFloat(val) : val;
        return isNaN(num) ? undefined : Math.round(num);
      };
      
      // Update recipe with enriched fields (but NOT normalizedIngredients/normalizedInstructions!)
      await storage.updateRecipe(job.recipeId, {
        // Servings (preserve AI-generated or use enrichment estimate)
        servings: toInt(recipe.servings) || toInt(enriched.servings) || 4,
        
        // Time fields from enrichment (coerce to integers)
        prepTimeMinutes: toInt(enriched.prepTimeMinutes),
        cookTimeMinutes: toInt(enriched.cookTimeMinutes),
        totalTimeMinutes: toInt(enriched.totalTimeMinutes),
        
        // Skill
        skillLevel: enriched.skillLevel,
        skillLevelExplanation: enriched.skillLevelExplanation,
        
        // All dietary flags (critical for variation accuracy)
        isVegetarian: enriched.isVegetarian,
        isVegan: enriched.isVegan,
        isPescatarian: enriched.isPescatarian,
        isGlutenFree: enriched.isGlutenFree,
        isDairyFree: enriched.isDairyFree,
        isKeto: enriched.isKeto,
        isPaleo: enriched.isPaleo,
        isLowCarb: enriched.isLowCarb,
        isHighProtein: enriched.isHighProtein,
        isLowCalorie: enriched.isLowCalorie,
        isHighFiber: enriched.isHighFiber,
        isLactoVegetarian: enriched.isLactoVegetarian,
        isMediterranean: enriched.isMediterranean,
        isOvoVegetarian: enriched.isOvoVegetarian,
        isOvoLactoVegetarian: enriched.isOvoLactoVegetarian,
        isFlexitarian: enriched.isFlexitarian,
        isCarnivore: enriched.isCarnivore,
        isKosher: enriched.isKosher,
        isHalal: enriched.isHalal,
        isHindu: enriched.isHindu,
        
        // Allergens
        allergens: enriched.allergens,
        allergenFreeTags: enriched.allergenFreeTags,
        
        // Cuisines
        cuisines: enriched.cuisines,
        cuisine: enriched.cuisine,
        
        // Methods and tags
        cookingMethods: enriched.cookingMethods,
        seasonTags: enriched.seasonTags,
        occasionTags: enriched.occasionTags,
        
        // Pricing (real types accept decimals)
        priceRangeMin: enriched.priceRangeMin,
        priceRangeMax: enriched.priceRangeMax,
        priceCategory: enriched.priceCategory,
        totalCost: enriched.totalCost,
        costExcludingStaples: enriched.costExcludingStaples,
        
        // Health (coerce to integer for schema compatibility)
        healthScore: toInt(enriched.healthScore),
        
        // Nutrition facts (per serving) - coerce to integers for schema compatibility
        calories: toInt(enriched.calories),
        protein: toInt(enriched.protein),
        carbohydrates: toInt(enriched.carbohydrates),
        fat: toInt(enriched.fat),
        fiber: toInt(enriched.fiber),
        sugar: toInt(enriched.sugar),
        sodium: toInt(enriched.sodium),
        cholesterol: toInt(enriched.cholesterol),
        
        // Nutrition flags
        isLowFat: enriched.isLowFat,
        isLowSodium: enriched.isLowSodium,
        isLowSugar: enriched.isLowSugar,
        
        // Metadata
        aiEnriched: true,
        aiEnrichmentFields: enriched.aiEnrichmentFields,
        
        // CRITICAL: Mark enrichment as complete
        enrichmentStatus: 'ready',
        enrichmentError: null,
      });
      
      console.log(`Successfully enriched variation "${recipe.title}" (${job.recipeId}) with lightweight enrichment`);
      
      // Queue image generation (variations need images too!)
      const updatedRecipe = await storage.getRecipe(job.recipeId);
      if (updatedRecipe && updatedRecipe.imageGenerationStatus === 'pending') {
        console.log(`Queuing image generation for variation ${job.recipeId}...`);
        this.addImageGenerationJob(job.recipeId, updatedRecipe.title, updatedRecipe.ingredients);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error during variation enrichment';
      await storage.updateRecipe(job.recipeId, {
        enrichmentStatus: 'failed',
        enrichmentError: errorMessage,
      });
      throw error;
    }
  }

  getQueueLength(): number {
    return this.fastQueue.length + this.imageQueue.length;
  }

  // Get detailed queue status for monitoring
  getQueueStatus(): { fastQueue: number; imageQueue: number; fastWorkers: number; imageWorkers: number } {
    return {
      fastQueue: this.fastQueue.length,
      imageQueue: this.imageQueue.length,
      fastWorkers: this.activeFastWorkers,
      imageWorkers: this.activeImageWorkers,
    };
  }

  startStuckJobWatchdog(intervalMs: number = 5 * 60 * 1000) {
    setInterval(async () => {
      try {
        const { getSharedPool } = await import("./pg-pool");
        const pool = getSharedPool();
        
        const { rows: stuckRows } = await pool.query(
          `SELECT id, title, ingredients FROM recipes 
           WHERE image_generation_status = 'generating' 
           AND updated_at < NOW() - INTERVAL '5 minutes'`
        );
        
        if (stuckRows.length > 0) {
          console.log(`[Watchdog] Found ${stuckRows.length} stuck image generation jobs, resetting...`);
          for (const row of stuckRows) {
            await pool.query(
              `UPDATE recipes SET image_generation_status = 'pending', image_generation_error = NULL, updated_at = NOW() WHERE id = $1`,
              [row.id]
            );
            if (row.ingredients?.length > 0 && row.title) {
              this.addImageGenerationJob(row.id, row.title, row.ingredients);
            }
          }
        }
      } catch (error) {
        console.error('[Watchdog] Error checking for stuck jobs:', error);
      }
    }, intervalMs);
    console.log(`[Watchdog] Started stuck-job watchdog (checking every ${intervalMs / 1000}s)`);
  }
}

export const jobQueue = new JobQueue();
