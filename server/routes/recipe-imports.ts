import { Router } from "express";
import { z } from "zod";
import { and, eq, inArray } from "drizzle-orm";
import { isAuthenticated } from "../clerkAuth";
import { storage } from "../storage";
import { db } from "../db";
import { jobQueue } from "../job-queue";
import { recipes } from "@shared/schema";
import {
  hasExtractedContent,
  importStatusOf,
  friendlyImportError,
  reconcileNormalizedIngredients,
  reconcileNormalizedInstructions,
  stripUnsureMarkers,
} from "@shared/import-review";
import {
  getImport,
  getReviewStatuses,
  listPendingImports,
  reviewTrackingAvailable,
  setReviewStatus,
} from "../recipe-imports";
import { getUserId } from "./route-utils";

// The review step for AI imports (docs/DESIGN_PRINCIPLES.md §6.2): status for
// JobStatus, the import record for the review screen, saving the checked
// recipe, and Retry for failed reads.

const router = Router();

const sameLines = (a: string[] | null | undefined, b: string[]) =>
  Array.isArray(a) && a.length === b.length && a.every((line, i) => line === b[i]);

// Imports still waiting for a look (persists across devices and sessions)
router.get("/recipe-imports/pending", isAuthenticated, async (req: any, res) => {
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  const rows = await listPendingImports(userId);
  res.json({
    tracking: reviewTrackingAvailable(),
    items: rows.map((r) => ({
      recipeId: r.recipeId,
      title: r.title,
      sourceType: r.sourceType,
      thumbnail: r.thumbnail,
      createdAt: r.createdAt,
      status: importStatusOf({ ...r, reviewStatus: "needs_review" }),
      error: r.enrichmentStatus === "failed" ? friendlyImportError(r.enrichmentError) : null,
    })),
  });
});

// Light status for polling (no images, no full recipe)
router.get("/recipe-imports/status", isAuthenticated, async (req: any, res) => {
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  const ids = String(req.query.ids ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 50);
  if (ids.length === 0) return res.json({ items: [] });
  try {
    const rows = await db
      .select({
        id: recipes.id,
        title: recipes.title,
        enrichmentStatus: recipes.enrichmentStatus,
        enrichmentError: recipes.enrichmentError,
        ingredients: recipes.ingredients,
      })
      .from(recipes)
      .where(and(inArray(recipes.id, ids), eq(recipes.ownerUserId, userId)));
    const reviews = await getReviewStatuses(rows.map((r) => r.id));
    res.json({
      tracking: reviewTrackingAvailable(),
      items: rows.map((r) => {
        const reviewStatus = reviews.get(r.id) ?? null;
        return {
          recipeId: r.id,
          title: r.title,
          reviewStatus,
          status: importStatusOf({ ...r, reviewStatus }, true),
          // extracting -> enriching -> ready, so the recipe page can reload at each step
          stage: r.enrichmentStatus,
          error: r.enrichmentStatus === "failed" && !hasExtractedContent(r) ? friendlyImportError(r.enrichmentError) : null,
        };
      }),
    });
  } catch (error) {
    console.error("Error fetching import status:", error);
    res.status(500).json({ error: "Couldn't check on your recipes. Try again." });
  }
});

// The import record: kept source (extra pages, link, pasted text) and review state
router.get("/recipe-imports/:id", isAuthenticated, async (req: any, res) => {
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  const recipe = await storage.getRecipe(req.params.id, userId);
  if (!recipe) return res.status(404).json({ error: "Recipe not found" });
  const record = await getImport(recipe.id);
  res.json({
    tracking: reviewTrackingAvailable(),
    import: record
      ? {
          sourceType: record.sourceType,
          extraPageImages: record.extraPageImages ?? [],
          sourceUrl: record.sourceUrl,
          sourceText: record.sourceText,
          reviewStatus: record.reviewStatus,
          reviewedAt: record.reviewedAt,
        }
      : null,
  });
});

const reviewSchema = z.object({
  title: z.string().trim().min(1, "Give the recipe a name.").max(200),
  servings: z.number().int().min(1).max(500).optional(),
  ingredients: z.array(z.string().max(500)).max(200),
  instructions: z.array(z.string().max(4000)).max(100),
  amountsConfirmed: z.literal(true, { errorMap: () => ({ message: "Tick “Check the amounts” first." }) }),
});

// Save the checked recipe. Only touches what the person saw and edited
// (title, servings, ingredients, steps), and keeps normalized data in step.
router.post("/recipe-imports/:id/review", isAuthenticated, async (req: any, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    const parsed = reviewSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Check the recipe and try again." });
    }
    const body = parsed.data;
    const clean = (lines: string[]) => lines.map(stripUnsureMarkers).filter(Boolean);
    const ingredients = clean(body.ingredients);
    const instructions = clean(body.instructions);
    if (ingredients.length === 0) return res.status(400).json({ error: "Add at least one ingredient." });

    const recipe = await storage.getRecipe(req.params.id, userId);
    if (!recipe) return res.status(404).json({ error: "Recipe not found" });
    if (recipe.enrichmentStatus === "extracting" || recipe.enrichmentStatus === "enriching") {
      return res.status(409).json({ error: "Grammie is still reading this recipe. Try again in a moment." });
    }

    const updates: Record<string, unknown> = { title: stripUnsureMarkers(body.title) };
    if (body.servings) updates.servings = body.servings;
    if (!sameLines(recipe.ingredients, ingredients)) {
      updates.ingredients = ingredients;
      updates.normalizedIngredients = reconcileNormalizedIngredients(recipe.ingredients ?? [], ingredients, recipe.normalizedIngredients);
    }
    if (!sameLines(recipe.instructions, instructions)) {
      updates.instructions = instructions;
      updates.normalizedInstructions = reconcileNormalizedInstructions(recipe.instructions ?? [], instructions, recipe.normalizedInstructions);
    }

    // storage.updateRecipe enforces owner-or-editor when given the user id
    const updated = await storage.updateRecipe(recipe.id, updates as any, userId);
    if (!updated) return res.status(403).json({ error: "Only the person who added this recipe can check it." });

    const tracked = await setReviewStatus(recipe.id, "reviewed", { amountsConfirmed: true });
    res.json({ recipeId: recipe.id, tracked });
  } catch (error) {
    console.error("Error saving reviewed recipe:", error);
    res.status(500).json({ error: "Couldn't save the recipe. Your changes are still here; try again." });
  }
});

// "Not now": stop asking about this import; the recipe stays as it is
router.post("/recipe-imports/:id/dismiss", isAuthenticated, async (req: any, res) => {
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  const recipe = await storage.getRecipe(req.params.id, userId);
  if (!recipe || recipe.ownerUserId !== userId) return res.status(404).json({ error: "Recipe not found" });
  const tracked = await setReviewStatus(recipe.id, "dismissed");
  res.json({ recipeId: recipe.id, tracked });
});

function base64FromDataUrl(url: string | null | undefined): string | null {
  const m = url?.match(/^data:[^;]+;base64,(.+)$/);
  return m ? m[1] : null;
}

// Retry a failed import: re-read the kept photo(s), or re-run enrichment
router.post("/recipe-imports/:id/retry", isAuthenticated, async (req: any, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    const recipe = await storage.getRecipe(req.params.id, userId);
    if (!recipe || recipe.ownerUserId !== userId) return res.status(404).json({ error: "Recipe not found" });

    if (recipe.enrichmentStatus === "extracting" || recipe.enrichmentStatus === "enriching") {
      return res.json({ status: "reading" });
    }

    if (!hasExtractedContent(recipe)) {
      const record = await getImport(recipe.id);
      const pages = [recipe.handwrittenImage, ...(record?.extraPageImages ?? [])]
        .map(base64FromDataUrl)
        .filter((p): p is string => !!p);
      if (pages.length === 0) {
        return res.status(400).json({ error: "The original photo isn't available to read again. Add the recipe again." });
      }
      await storage.updateRecipe(recipe.id, {
        title: "Your Recipe",
        enrichmentStatus: "extracting",
        enrichmentError: null,
        imageGenerationStatus: "pending",
        imageGenerationError: null,
      } as any, userId);
      if (pages.length > 1) jobQueue.addMultiImageExtractionJob(recipe.id, pages);
      else jobQueue.addExtractionJob(recipe.id, pages[0]);
      return res.json({ status: "reading" });
    }

    await storage.updateRecipe(recipe.id, { enrichmentStatus: "enriching", enrichmentError: null } as any, userId);
    jobQueue.addEnrichmentJob(recipe.id);
    res.json({ status: "reading" });
  } catch (error) {
    console.error("Error retrying import:", error);
    res.status(500).json({ error: "Couldn't start again. Try again in a minute." });
  }
});

export default router;
