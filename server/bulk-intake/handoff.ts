import { randomUUID } from "crypto";
import { insertRecipeSchema } from "@shared/schema";
import type { ImportLane } from "@shared/bulk-intake";
import { storage } from "../storage";
import { jobQueue } from "../job-queue";
import { generateThumbnail } from "../thumbnail";
import { recordImport } from "../recipe-imports";
import { batchLaneConfig } from "../lib/batch-lane";
import { charge, jobRefs } from "../lib/credits";

// THE HANDOFF: where a reviewed bulk-intake recipe enters the normal import
// pipeline. Everything before this (upload, first look, pairing, review) is
// bulk-only; everything after it is the path a single photo takes (POST
// /api/recipes/upload and /upload-multi-image in routes/recipes.ts): a
// placeholder recipe, a recipe_imports row, then extraction -> enrichment ->
// dish photo in server/job-queue.ts.
//
// Bulk recipes are marked for the Gemini Batch API lane two ways (docs/BULK_IMPORT.md, "Handoff"):
//  - jobQueue.add(MultiImage)ExtractionJob(..., { bulk: true }): in memory
//  - recipes.upload_session_id: one upload session per import, sized to the
//    whole import (not capped at 10), which survives a restart. The batch
//    lane treats sessions of GEMINI_BATCH_MIN_RECIPES+ files as bulk.
// The pile itself is linked through bulk_intake_photos.recipe_id.

/** Which lane bulk imports use, for the estimate shown before Import */
export function bulkLane(): ImportLane {
  return batchLaneConfig().enabled ? "batch" : "standard";
}

/** One upload session for a whole import: what the batch lane uses to recognize bulk work */
export async function createImportSession(ownerUserId: string, totalRecipes: number): Promise<string> {
  const session = await storage.createUploadSession({
    userId: ownerUserId,
    totalFiles: totalRecipes,
    completedCount: 0,
    failedCount: 0,
    status: "processing",
  });
  return session.id;
}

export interface HandOffInput {
  ownerUserId: string;
  uploadSessionId: string;
  /** Position in the import (recipes.source_image_index) */
  index: number;
  /** Upright JPEG pages: the front first, then any backs */
  pages: Buffer[];
}

/** Creates the recipe and queues it; returns the new recipe id */
export async function handOffRecipe({ ownerUserId, uploadSessionId, index, pages }: HandOffInput): Promise<string> {
  if (!pages.length) throw new Error("No photos for this recipe");
  const imagesBase64 = pages.map((p) => p.toString("base64"));
  const dataUrls = imagesBase64.map((b) => `data:image/jpeg;base64,${b}`);

  let thumbnail: string | null = null;
  try {
    thumbnail = await generateThumbnail(dataUrls[0], 256);
  } catch (err) {
    console.warn("[Bulk intake] Couldn't make a thumbnail:", err);
  }

  // Same placeholder as a single photo upload
  const recipe = await storage.createRecipe(insertRecipeSchema.parse({
    ownerUserId,
    isPublic: true,
    title: "Your Recipe",
    prepTime: "0 mins",
    totalTime: "0 mins",
    servings: 1,
    ingredients: ["Extracting..."],
    instructions: [pages.length > 1 ? `Extracting from ${pages.length} images...` : "Extracting from image..."],
    handwrittenImage: dataUrls[0],
    dishImage: dataUrls[0],
    dishImageThumbnail: thumbnail,
    dishImages: [{ id: randomUUID(), url: dataUrls[0], thumbnailUrl: thumbnail || undefined, isAiGenerated: false, order: 0, createdAt: new Date().toISOString() }],
    enrichmentStatus: "extracting",
    enrichmentRetryCount: 0,
    uploadSessionId,
    sourceImageIndex: index,
  }));
  await recordImport({ recipeId: recipe.id, ownerUserId, sourceType: "photo", extraPageImages: dataUrls.slice(1) });
  // 1 credit per recipe, checked for the whole import when Import was pressed
  // (routes/bulk-intake.ts); the free first look before it costs nothing
  await charge(ownerUserId, "recipe_import", jobRefs.recipeImport(recipe.id));

  // Photos were turned upright during the first look, so no straightenNewCard()
  if (pages.length > 1) jobQueue.addMultiImageExtractionJob(recipe.id, imagesBase64, { bulk: true });
  else jobQueue.addExtractionJob(recipe.id, imagesBase64[0], { bulk: true });
  return recipe.id;
}
