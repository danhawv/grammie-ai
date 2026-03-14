import { Router } from "express";
import { isAuthenticated } from "../clerkAuth";
import { storage } from "../storage";
import { jobQueue } from "../job-queue";
import { getUserId } from "./route-utils";
import type { User } from "@shared/schema";
import {
  testGeminiCapabilities,
  isGeminiAvailable,
  enrichRecipeWithGemini,
  generateRecipeImageWithGemini,
} from "../gemini";
import {
  getCurrentProvider,
  getProviderInfo,
  isProviderAvailable,
  setProvider,
  hasRuntimeOverride,
  type AIProvider,
} from "../ai-service";

const router = Router();

// ============ Admin helper ============

function isAdminUser(user: User): boolean {
  const adminEmailsEnv = process.env.ADMIN_EMAILS || "";
  const adminEmails = adminEmailsEnv.split(",").map(e => e.trim().toLowerCase()).filter(e => e);
  const isDev = process.env.NODE_ENV === "development";
  const isAdminByEmail = adminEmails.includes(user.email?.toLowerCase() || "");
  const isAdminByFlag = user.isAdmin === true;
  return isAdminByFlag || isAdminByEmail || (isDev && adminEmails.length === 0);
}

// ============ Gemini AI Test Endpoint ============
// Rate limiter for Gemini test endpoints (max 5 requests per user per minute)
const geminiTestRateLimit = new Map<string, { count: number; resetAt: number }>();
const GEMINI_TEST_RATE_LIMIT = 5;
const GEMINI_TEST_RATE_WINDOW_MS = 60 * 1000; // 1 minute

function checkGeminiRateLimit(userId: string): boolean {
  const now = Date.now();
  const entry = geminiTestRateLimit.get(userId);

  if (!entry || now > entry.resetAt) {
    geminiTestRateLimit.set(userId, { count: 1, resetAt: now + GEMINI_TEST_RATE_WINDOW_MS });
    return true;
  }

  if (entry.count >= GEMINI_TEST_RATE_LIMIT) {
    return false;
  }

  entry.count++;
  return true;
}

// Migrate JSON recipes
router.post("/admin/migrate-json", async (req, res) => {
  try {
    const { readFileSync, existsSync } = await import("fs");

    if (!existsSync("recipes-data.json")) {
      return res.status(404).json({ error: "recipes-data.json not found" });
    }

    // Create system user
    await storage.upsertUser({
      id: "system",
      email: "system@recipes.local",
      username: "System",
      bio: "Legacy recipes owner",
    });

    const fileContent = readFileSync("recipes-data.json", "utf8");
    const data = JSON.parse(fileContent);
    const recipesArray = Object.values(data.recipes) as any[];

    let imported = 0;
    let skipped = 0;

    for (const recipe of recipesArray) {
      try {
        const existing = await storage.getRecipe(recipe.id, "system");
        if (existing) {
          skipped++;
          continue;
        }

        const recipeToImport = {
          ...recipe,
          ownerUserId: "system",
          isPublic: true,
          createdAt: recipe.createdAt ? new Date(recipe.createdAt) : undefined,
          updatedAt: recipe.updatedAt ? new Date(recipe.updatedAt) : undefined,
          publishedAt: recipe.publishedAt ? new Date(recipe.publishedAt) : undefined,
        };

        await storage.createRecipe(recipeToImport);
        imported++;
      } catch (err) {
        console.error(`Error importing recipe ${recipe.id}:`, err);
      }
    }

    res.json({
      message: "Migration complete",
      imported,
      skipped,
      total: recipesArray.length
    });
  } catch (error) {
    console.error("Migration error:", error);
    res.status(500).json({ error: "Migration failed" });
  }
});

// Test endpoint to compare Gemini vs OpenAI capabilities
router.get("/test/gemini", isAuthenticated, async (req, res) => {
  try {
    const user = req.user as User;

    const adminEmails = (process.env.ADMIN_EMAILS || "").split(",").map(e => e.trim().toLowerCase());
    if (!adminEmails.includes(user.email?.toLowerCase() || "")) {
      return res.status(403).json({ error: "Admin access required" });
    }

    if (!checkGeminiRateLimit(user.id)) {
      console.log(`[Gemini Test] Rate limit exceeded for user ${user.email}`);
      return res.status(429).json({ error: "Rate limit exceeded. Try again in 1 minute." });
    }

    console.log(`[Gemini Test] Running capability test for user ${user.email}`);

    const results = await testGeminiCapabilities();

    return res.json({
      gemini: results,
      openai: {
        available: !!(process.env.AI_INTEGRATIONS_OPENAI_BASE_URL && process.env.AI_INTEGRATIONS_OPENAI_API_KEY),
        model: "gpt-5",
        imageModel: "gpt-image-1",
      },
      recommendation: results.enrichmentTest?.success
        ? `Gemini enrichment completed in ${results.enrichmentTest.durationMs}ms with ${results.enrichmentTest.fieldsReturned} fields`
        : "Gemini test failed - continue using OpenAI",
    });
  } catch (error: any) {
    console.error("[Gemini Test] Error:", error);
    return res.status(500).json({ error: error.message });
  }
});

// Test Gemini enrichment on a specific recipe
router.post("/test/gemini/enrich/:id", isAuthenticated, async (req, res) => {
  try {
    const user = req.user as User;
    const { id } = req.params;

    const adminEmails = (process.env.ADMIN_EMAILS || "").split(",").map(e => e.trim().toLowerCase());
    if (!adminEmails.includes(user.email?.toLowerCase() || "")) {
      return res.status(403).json({ error: "Admin access required" });
    }

    if (!checkGeminiRateLimit(user.id)) {
      console.log(`[Gemini Test] Rate limit exceeded for user ${user.email}`);
      return res.status(429).json({ error: "Rate limit exceeded. Try again in 1 minute." });
    }

    if (!isGeminiAvailable()) {
      return res.status(400).json({ error: "Gemini API not configured" });
    }

    const recipe = await storage.getRecipe(id);
    if (!recipe) {
      return res.status(404).json({ error: "Recipe not found" });
    }

    console.log(`[Gemini Test] Testing enrichment on recipe: ${recipe.title}`);

    const rawRecipe = {
      title: recipe.title,
      ingredients: recipe.ingredients || [],
      instructions: recipe.instructions || [],
      servings: recipe.servings || 4,
      prepTime: recipe.prepTimeMinutes ? `${recipe.prepTimeMinutes} mins` : undefined,
      cookTime: recipe.cookTimeMinutes ? `${recipe.cookTimeMinutes} mins` : undefined,
    };

    const startTime = Date.now();
    const enriched = await enrichRecipeWithGemini(rawRecipe);
    const duration = Date.now() - startTime;

    return res.json({
      success: true,
      recipeTitle: recipe.title,
      durationMs: duration,
      enrichedData: {
        calories: enriched.calories,
        protein: enriched.protein,
        healthScore: enriched.healthScore,
        cuisines: enriched.cuisines,
        dietaryFlags: {
          isVegetarian: enriched.isVegetarian,
          isVegan: enriched.isVegan,
          isGlutenFree: enriched.isGlutenFree,
        },
        tips: enriched.tips?.length || 0,
        variations: enriched.variations?.length || 0,
        ingredients: enriched.normalizedIngredients?.length || 0,
        instructions: enriched.normalizedInstructions?.length || 0,
      },
    });
  } catch (error: any) {
    console.error("[Gemini Test] Enrichment error:", error);
    return res.status(500).json({ error: error.message });
  }
});

// Test Gemini image generation
router.post("/test/gemini/image", isAuthenticated, async (req, res) => {
  try {
    const user = req.user as User;

    const adminEmails = (process.env.ADMIN_EMAILS || "").split(",").map(e => e.trim().toLowerCase());
    if (!adminEmails.includes(user.email?.toLowerCase() || "")) {
      return res.status(403).json({ error: "Admin access required" });
    }

    if (!checkGeminiRateLimit(user.id)) {
      console.log(`[Gemini Test] Rate limit exceeded for user ${user.email}`);
      return res.status(429).json({ error: "Rate limit exceeded. Try again in 1 minute." });
    }

    if (!isGeminiAvailable()) {
      return res.status(400).json({ error: "Gemini API not configured" });
    }

    const { recipeName, cuisines, cookingMethods } = req.body;

    if (!recipeName) {
      return res.status(400).json({ error: "recipeName is required" });
    }

    console.log(`[Gemini Test] Testing image generation for: ${recipeName}`);

    const startTime = Date.now();
    const imageBase64 = await generateRecipeImageWithGemini(
      recipeName,
      cuisines || [],
      cookingMethods || []
    );
    const duration = Date.now() - startTime;

    return res.json({
      success: true,
      recipeName,
      durationMs: duration,
      imageSizeBytes: Math.round((imageBase64.length * 3) / 4),
      imagePreview: `data:image/png;base64,${imageBase64.substring(0, 100)}...`,
    });
  } catch (error: any) {
    console.error("[Gemini Test] Image generation error:", error);
    return res.status(500).json({ error: error.message });
  }
});

// ============ AI Provider Toggle ============

// Get current AI provider info (admin-only)
router.get("/admin/ai-provider", isAuthenticated, async (req, res) => {
  try {
    const user = req.user as User;

    if (!isAdminUser(user)) {
      return res.status(403).json({ error: "Admin access required" });
    }

    const info = getProviderInfo();

    return res.json({
      currentProvider: info.current,
      hasRuntimeOverride: hasRuntimeOverride(),
      envDefault: process.env.AI_PROVIDER?.toLowerCase() || "openai",
      providers: {
        openai: {
          available: info.openaiAvailable,
          description: "Replit AI Integrations (GPT-4 Vision, GPT-4, DALL-E)",
        },
        gemini: {
          available: info.geminiAvailable,
          description: "Google Gemini (2.0 Flash, Imagen 3)",
        },
      },
    });
  } catch (error: any) {
    console.error("[AI Provider] Error:", error);
    return res.status(500).json({ error: error.message });
  }
});

// Set AI provider at runtime (admin-only)
router.put("/admin/ai-provider", isAuthenticated, async (req, res) => {
  try {
    const user = req.user as User;

    if (!isAdminUser(user)) {
      return res.status(403).json({ error: "Admin access required" });
    }

    const { provider } = req.body;

    if (!provider || !["openai", "gemini"].includes(provider)) {
      return res.status(400).json({ error: "Invalid provider. Must be 'openai' or 'gemini'" });
    }

    if (!isProviderAvailable(provider)) {
      return res.status(400).json({
        error: `${provider.toUpperCase()} is not available. Please configure the required API keys.`
      });
    }

    setProvider(provider as AIProvider);

    console.log(`[AI Provider] Admin ${user.email} switched provider to: ${provider.toUpperCase()}`);

    return res.json({
      success: true,
      currentProvider: provider,
      message: `AI provider switched to ${provider.toUpperCase()}`,
    });
  } catch (error: any) {
    console.error("[AI Provider] Error setting provider:", error);
    return res.status(500).json({ error: error.message });
  }
});

// Recover stuck jobs
router.post("/admin/recover-jobs", async (req: any, res) => {
  const isInternal = req.headers['x-internal-recovery'] === 'true';
  if (!isInternal) {
    if (!req.user) {
      return res.status(401).json({ error: "Authentication required" });
    }
    const user = req.user as User;
    if (!isAdminUser(user)) {
      return res.status(403).json({ error: "Admin access required" });
    }
  }

  try {
    const { getSharedPool } = await import("../pg-pool");
    const pool = getSharedPool();
    const results: any = { extraction: 0, enrichment: 0, imageReset: 0, imageQueued: 0 };

    // Phase 1: Re-queue stuck extraction jobs
    try {
      const { rows: extractionRows } = await pool.query(
        `SELECT id FROM recipes WHERE enrichment_status = 'extracting'`
      );

      for (const row of extractionRows) {
        const fullRecipe = await storage.getRecipe(row.id);
        if (fullRecipe?.handwrittenImage) {
          const base64Match = fullRecipe.handwrittenImage.match(/^data:image\/[a-z]+;base64,(.+)$/);
          const imageBase64 = base64Match ? base64Match[1] : fullRecipe.handwrittenImage;
          jobQueue.addExtractionJob(row.id, imageBase64);
          results.extraction++;
        }
      }
    } catch (error: any) {
      results.extractionError = error.message;
    }

    // Phase 2: Re-queue stuck enrichment jobs
    try {
      const { rows: enrichmentRows } = await pool.query(
        `SELECT id FROM recipes WHERE enrichment_status IN ('enriching', 'failed')`
      );

      for (const row of enrichmentRows) {
        jobQueue.addEnrichmentJob(row.id);
        results.enrichment++;
      }
    } catch (error: any) {
      results.enrichmentError = error.message;
    }

    // Phase 3: Re-queue stuck image generation jobs
    try {
      const { rows: stuckRows } = await pool.query(
        `SELECT id FROM recipes WHERE image_generation_status = 'generating'`
      );

      for (const row of stuckRows) {
        await pool.query(
          `UPDATE recipes SET image_generation_status = 'pending', image_generation_error = NULL, updated_at = NOW() WHERE id = $1`,
          [row.id]
        );
        results.imageReset++;
      }

      const { rows: pendingRows } = await pool.query(
        `SELECT id, title, ingredients FROM recipes WHERE image_generation_status = 'pending'`
      );

      for (const row of pendingRows) {
        if (row.ingredients && row.ingredients.length > 0 && row.title) {
          jobQueue.addImageGenerationJob(row.id, row.title, row.ingredients);
          results.imageQueued++;
        }
      }
    } catch (error: any) {
      results.imageError = error.message;
    }

    res.json(results);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Batch classify meal types
router.post("/admin/batch-meal-type", isAuthenticated, async (req: any, res) => {
  try {
    const user = req.user as User;
    if (!isAdminUser(user)) {
      return res.status(403).json({ error: "Admin access required" });
    }

    const { db } = await import("../db");
    const { recipes: recipesTable } = await import("@shared/schema");
    const { sql, isNull, or } = await import("drizzle-orm");

    const allCount = await db.select({ count: sql<number>`count(*)` }).from(recipesTable);
    const totalRecipes = Number(allCount[0]?.count || 0);

    const recipesNeedingTags = await db.select({
      id: recipesTable.id,
      title: recipesTable.title,
      description: recipesTable.description,
      ingredients: recipesTable.ingredients,
    }).from(recipesTable).where(
      or(
        isNull(recipesTable.mealType),
        sql`${recipesTable.mealType} = '{}'`
      )
    );

    if (recipesNeedingTags.length === 0) {
      return res.json({ message: "All recipes already have meal type tags", updated: 0, total: totalRecipes });
    }

    console.log(`[Batch MealType] Found ${recipesNeedingTags.length}/${totalRecipes} recipes missing mealType`);

    const provider = getCurrentProvider();
    const batchSize = 10;
    let updated = 0;
    const errors: string[] = [];

    for (let i = 0; i < recipesNeedingTags.length; i += batchSize) {
      const batch = recipesNeedingTags.slice(i, i + batchSize);
      const batchData = batch.map((r: any) => ({
        id: r.id,
        title: r.title,
        ingredients: (r.ingredients || []).slice(0, 5).join(", "),
        description: r.description?.substring(0, 100) || "",
      }));

      const prompt = `Classify each recipe into meal types. For EVERY recipe, assign at least one meal type.

Choose from EXACTLY these values: "Breakfast", "Lunch", "Dinner", "Snack", "Dessert", "Appetizer", "Side Dish", "Beverage", "Sauce", "Dip", "Marinade", "Rub"

A recipe can have multiple types (e.g. a pasta salad could be ["Lunch", "Side Dish"]).
NEVER return an empty array. Every recipe MUST have at least one meal type.

RECIPES:
${JSON.stringify(batchData, null, 2)}

Return JSON array with this structure:
[{"id": number, "mealType": ["Type1", "Type2"]}]`;

      try {
        const { GoogleGenerativeAI } = await import("@google/generative-ai");
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) throw new Error("GEMINI_API_KEY not configured");

        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({
          model: "gemini-2.0-flash",
          generationConfig: { responseMimeType: "application/json" },
        });

        const result = await model.generateContent(prompt);
        const text = result.response.text();
        const parsed = JSON.parse(text);

        const validMealTypes = new Set(["Breakfast", "Lunch", "Dinner", "Snack", "Dessert", "Appetizer", "Side Dish", "Beverage", "Sauce", "Dip", "Marinade", "Rub"]);

        if (Array.isArray(parsed)) {
          for (const item of parsed) {
            if (item.id && Array.isArray(item.mealType) && item.mealType.length > 0) {
              const validated = item.mealType.filter((t: string) => validMealTypes.has(t));
              if (validated.length === 0) {
                errors.push(`Recipe ${item.id}: invalid meal types [${item.mealType.join(", ")}]`);
                continue;
              }
              try {
                await storage.updateRecipe(item.id, { mealType: validated });
                updated++;
              } catch (err) {
                errors.push(`Failed to update recipe ${item.id}`);
              }
            }
          }
        }

        console.log(`[Batch MealType] Processed batch ${Math.floor(i / batchSize) + 1}, updated ${updated} so far`);

        if (i + batchSize < recipesNeedingTags.length) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      } catch (batchErr: any) {
        console.error(`[Batch MealType] Batch error:`, batchErr.message);
        errors.push(`Batch ${Math.floor(i / batchSize) + 1}: ${batchErr.message}`);
      }
    }

    console.log(`[Batch MealType] Complete: ${updated}/${recipesNeedingTags.length} updated`);

    res.json({
      message: `Updated ${updated} of ${recipesNeedingTags.length} recipes missing meal types`,
      updated,
      needingTags: recipesNeedingTags.length,
      total: totalRecipes,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error: any) {
    console.error("[Batch MealType] Error:", error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
