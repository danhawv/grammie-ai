import { Router } from "express";
import { z } from "zod";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import heicConvert from "heic-convert";
import { isAuthenticated, optionalAuth } from "../clerkAuth";
import { storage } from "../storage";
import type { RecipeFilterParams } from "../pg-storage";
import { parseFiltersFromQuery } from "./filter-parser";
import { db } from "../db";
import { eq, or, sql } from "drizzle-orm";
import {
  insertRecipeSchema,
  updateRecipeSchema,
  recipes,
  users,
} from "@shared/schema";
import {
  extractRecipeFromUrl,
  extractRecipeFromText,
} from "../enrichment";
import { buildScaledRecipeResponse } from "../scaling";
import { jobQueue } from "../job-queue";
import { generateThumbnail } from "../thumbnail";
import { detectPlatform, diagnoseInstagram, isValidSocialUrl, scrapePost, PLATFORM_NAMES, type SocialPlatform } from "../social-import-service";
import { detectLinkPlatform, normalizeUrl } from "@shared/link-platform";
import { extractRecipeFromSocialPostUnified } from "../ai-service";
import { getUserId, upload } from "./route-utils";
import { findPantryMatch } from "../../shared/pantry-matching";
import { getFoodProfile, ingredientMatchesAvoid } from "@shared/food-profile";
import { convertToBaseUnit } from "../unit-conversion";
import { recordImport } from "../recipe-imports";
import { straightenNewCard, rotateOriginalCard } from "../lib/original-card";
import { rankRecipesByPantry, recipeIngredients, normalizeIngredient, namesMatch } from "../../shared/pantry-match";

const router = Router();

// Get all recipes (with optional filtering by user scope)
router.get("/recipes", optionalAuth, async (req: any, res) => {
  try {
    const userId = getUserId(req);
    const scope = req.query.scope as string;
    const creatorId = req.query.creatorId as string;
    const cookbookIds = req.query.cookbookIds as string;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 24;

    const filters = parseFiltersFromQuery(req.query);
    const hasFilters = Object.keys(filters).length > 0;

    let result;
    if (creatorId) {
      result = await storage.getRecipesByCreatorPaginated(creatorId, page, limit, hasFilters ? filters : undefined);
    } else if (cookbookIds && userId) {
      const cookbookIdArray = cookbookIds.split(',').map((id: string) => parseInt(id.trim())).filter((id: number) => !isNaN(id));
      if (cookbookIdArray.length > 0) {
        result = await storage.getRecipesByCookbooksPaginated(userId, cookbookIdArray, page, limit, hasFilters ? filters : undefined);
      } else {
        result = await storage.getAllRecipesPaginated(userId, page, limit, hasFilters ? filters : undefined);
      }
    } else if (scope === 'my' && userId) {
      result = await storage.getMyRecipesPaginated(userId, page, limit, hasFilters ? filters : undefined);
    } else if (scope === 'shared' && userId) {
      result = await storage.getSharedWithMePaginated(userId, page, limit, hasFilters ? filters : undefined);
    } else if (scope === 'public') {
      result = await storage.getPublicRecipesPaginated(page, limit, hasFilters ? filters : undefined);
    } else {
      result = await storage.getAllRecipesPaginated(userId, page, limit, hasFilters ? filters : undefined);
    }

    res.json(result);
  } catch (error) {
    console.error("Error fetching recipes:", error);
    res.status(500).json({ error: "Failed to fetch recipes" });
  }
});

// Get filter counts for advanced filter panel
router.get("/recipes/filter-counts", async (req: any, res) => {
  try {
    const userId = getUserId(req);
    const scope = req.query.scope as string;

    const filters = parseFiltersFromQuery(req.query);

    // Determine base condition based on scope and user
    let baseCondition;
    const cookbookId = Number(req.query.cookbookId);
    if (Number.isInteger(cookbookId) && cookbookId > 0) {
      // Counts within one cookbook (search/filter inside a cookbook)
      const cookbook = await storage.getCookbook(cookbookId, userId);
      if (!cookbook) return res.status(404).json({ error: "Cookbook not found" });
      baseCondition = sql`${recipes.id} IN (SELECT recipe_id FROM cookbook_recipes WHERE cookbook_id = ${cookbookId})`;
    } else if (scope === 'my' && userId) {
      baseCondition = eq(recipes.ownerUserId, userId);
    } else if (scope === 'public') {
      baseCondition = eq(recipes.isPublic, true);
    } else if (userId) {
      baseCondition = or(
        eq(recipes.ownerUserId, userId),
        eq(recipes.isPublic, true)
      );
    } else {
      baseCondition = eq(recipes.isPublic, true);
    }

    const counts = await (storage as any).getFilterCounts(baseCondition, Object.keys(filters).length > 0 ? filters : undefined);
    res.json(counts);
  } catch (error) {
    console.error("Error fetching filter counts:", error);
    res.status(500).json({ error: "Failed to fetch filter counts" });
  }
});

// Get multiple recipes by IDs (for print preview)
router.get("/recipes/batch", async (req: any, res) => {
  try {
    const { ids } = req.query;
    if (!ids) {
      return res.json({ recipes: [] });
    }
    const idArray = (ids as string).split(',').filter(Boolean);
    if (idArray.length === 0) {
      return res.json({ recipes: [] });
    }
    const userId = getUserId(req);
    const recipesList = await Promise.all(
      idArray.map(id => storage.getRecipe(id, userId))
    );
    res.json({ recipes: recipesList.filter(Boolean) });
  } catch (error) {
    console.error("Error fetching recipes batch:", error);
    res.status(500).json({ error: "Failed to fetch recipes" });
  }
});

// ============================================================================
// "WHAT CAN I MAKE?" FEATURE - Match pantry to recipes
// NOTE: These routes must be defined BEFORE /api/recipes/:id to avoid
// "what-can-i-make" being interpreted as a recipe ID
// ============================================================================

// Get recipe suggestions based on pantry items.
// Ranks every recipe the user can see by how much of it the pantry covers
// ("You have 7 of 9"), lists what's missing, and treats salt, pepper, oil,
// water, flour, sugar and common dried spices as on hand. Matching rules live
// in shared/pantry-match.ts (tested).
router.get("/recipes/what-can-i-make", isAuthenticated, async (req: any, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const pantryItems = await storage.getPantryItems(userId);
    // Food profile: allergies and dislikes are both left out of suggestions
    const user = await storage.getUser(userId);
    const foodProfile = getFoodProfile(user?.preferences);
    const dietaryRestrictions: string[] = foodProfile.diets;
    const dislikedIngredients: string[] = foodProfile.avoidAll;
    const appliedFilters = { dietaryRestrictions, dislikedIngredients };

    if (pantryItems.length === 0) {
      return res.json({ pantryItemCount: 0, results: [], recipesChecked: 0, appliedFilters });
    }

    let recipesList = await storage.getRecipesForPantryMatching(userId);

    if (dietaryRestrictions.length > 0) {
      recipesList = recipesList.filter((recipe) => {
        if (dietaryRestrictions.includes('vegetarian') && !recipe.isVegetarian) return false;
        if (dietaryRestrictions.includes('vegan') && !recipe.isVegan) return false;
        if (dietaryRestrictions.includes('gluten-free') && !recipe.isGlutenFree) return false;
        if (dietaryRestrictions.includes('dairy-free') && !recipe.isDairyFree) return false;
        return true;
      });
    }

    if (dislikedIngredients.length > 0) {
      const disliked = dislikedIngredients.map((d) => normalizeIngredient(d)).filter(Boolean);
      recipesList = recipesList.filter((recipe) =>
        !recipeIngredients(recipe).some((ing) => {
          const n = normalizeIngredient(ing.name);
          return disliked.some((d) => n === d || namesMatch(n, d) || n.split(" ").includes(d));
        }),
      );
    }

    // Own recipes first, so a public copy of the same dish doesn't push yours out
    recipesList = [...recipesList].sort((a, b) => Number(b.ownerUserId === userId) - Number(a.ownerUserId === userId));
    const seenTitles = new Set<string>();
    const ranked = rankRecipesByPantry(recipesList, pantryItems)
      .filter((r) => {
        // Show each dish once (libraries often hold several copies)
        const key = r.recipe.title.trim().toLowerCase();
        if (seenTitles.has(key)) return false;
        seenTitles.add(key);
        return true;
      })
      .slice(0, 60);

    const now = Date.now();
    const expiryThreshold = now + 3 * 24 * 60 * 60 * 1000;
    const isExpiringSoon = (p: { expiresAt: Date | null }) =>
      !!p.expiresAt && new Date(p.expiresAt).getTime() <= expiryThreshold;

    const results = ranked.map((r) => ({
      recipe: {
        id: r.recipe.id,
        title: r.recipe.title,
        image: r.recipe.dishImageThumbnail,
        totalTimeMinutes:
          r.recipe.totalTimeMinutes ??
          ((r.recipe.prepTimeMinutes || r.recipe.cookTimeMinutes)
            ? (r.recipe.prepTimeMinutes || 0) + (r.recipe.cookTimeMinutes || 0)
            : null),
        servings: r.recipe.servings,
        cuisine: r.recipe.cuisines?.[0] ?? null,
      },
      haveCount: r.haveCount,
      total: r.total,
      have: r.have.map((h) => ({ ingredient: h.ingredient, pantryItem: h.pantryItem.name })),
      missing: r.missing,
      staples: r.staples,
      expiringItemsUsed: r.have.filter((h) => isExpiringSoon(h.pantryItem)).length,
    }));

    res.json({
      pantryItemCount: pantryItems.length,
      recipesChecked: recipesList.length,
      results,
      appliedFilters,
    });
  } catch (error) {
    console.error("Error getting recipe suggestions:", error);
    res.status(500).json({ error: "Failed to get recipe suggestions" });
  }
});

// Get substitution suggestions for missing ingredients
router.post("/recipes/substitutions", isAuthenticated, async (req: any, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const { ingredients, pantryItems: userPantryItems } = req.body;

    if (!ingredients || !Array.isArray(ingredients) || ingredients.length === 0) {
      return res.status(400).json({ error: "Missing ingredients array required" });
    }

    // Get pantry items if not provided
    let pantryForContext = userPantryItems;
    if (!pantryForContext) {
      const pantry = await storage.getPantryItems(userId);
      pantryForContext = pantry.map(item => item.name);
    }

    // Use AI to suggest substitutions
    const { getSubstitutionSuggestions } = await import('../ai-service');
    const substitutions = await getSubstitutionSuggestions(ingredients, pantryForContext);

    res.json({ substitutions });
  } catch (error) {
    console.error("Error getting substitution suggestions:", error);
    res.status(500).json({ error: "Failed to get substitution suggestions" });
  }
});

// Add missing ingredients to grocery list
router.post("/recipes/:recipeId/add-missing-to-grocery", isAuthenticated, async (req: any, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const { missingIngredients } = req.body;

    if (!missingIngredients || !Array.isArray(missingIngredients) || missingIngredients.length === 0) {
      return res.status(400).json({ error: "missingIngredients array is required" });
    }

    // Remember which recipe these came from so the grocery list can say so
    const recipe = await storage.getRecipe(req.params.recipeId, userId);

    let added = 0;
    for (const ingredientName of missingIngredients) {
      if (typeof ingredientName !== 'string' || !ingredientName.trim()) continue;
      const name = ingredientName.trim();
      await storage.addManualItemToGroceryList(userId, {
        item: name,
        quantity: 1,
        unit: 'count',
        displayName: name,
        aisle: 'Other',
        category: 'Other',
        ...(recipe
          ? {
              recipeId: recipe.id,
              originalEntries: [{ recipeId: recipe.id, recipeTitle: recipe.title, quantity: 1, unit: 'count', raw: name }],
            }
          : {}),
      } as any);
      added++;
    }

    res.json({ added });
  } catch (error) {
    console.error("Error adding missing ingredients to grocery list:", error);
    res.status(500).json({ error: "Failed to add missing ingredients to grocery list" });
  }
});

// Step 1: Suggest recipe concepts from AI prompt
router.post("/recipes/suggest-concepts", isAuthenticated, async (req: any, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const bodySchema = z.object({
      prompt: z.string().min(1).max(500),
      specifiedIngredients: z.array(z.string()).optional(),
    });
    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
    }
    const { prompt, specifiedIngredients } = parsed.data;

    // Fetch pantry items
    const pantryItems = await storage.getPantryItems(userId);
    const pantryNames = pantryItems.map(item => item.name);

    // Get user dietary prefs
    const user = await storage.getUser(userId);
    const foodProfile = getFoodProfile(user?.preferences);
    const dietaryRestrictions: string[] = foodProfile.diets;
    const dislikedIngredients: string[] = foodProfile.avoidAll;

    // Generate concept suggestions via AI
    const { suggestRecipeConceptsUnified } = await import('../ai-service');
    const result = await suggestRecipeConceptsUnified({
      prompt,
      specifiedIngredients,
      pantryItems: pantryNames,
      dietaryRestrictions,
      dislikedIngredients,
    });

    res.json({
      concepts: result.concepts,
      pantryItemCount: pantryItems.length,
    });
  } catch (error) {
    console.error("Error suggesting recipe concepts:", error);
    res.status(500).json({ error: "Failed to suggest recipe concepts" });
  }
});

// Step 2: Generate full recipe from a selected concept
router.post("/recipes/generate-full-recipe", isAuthenticated, async (req: any, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const bodySchema = z.object({
      concept: z.object({
        title: z.string(),
        description: z.string(),
        cuisine: z.string().optional(),
        difficulty: z.string().optional(),
        estimatedTimeMinutes: z.number(),
        keyIngredients: z.array(z.string()),
        whyItWorks: z.string(),
      }),
    });
    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
    }
    const { concept } = parsed.data;

    // Fetch pantry items
    const pantryItems = await storage.getPantryItems(userId);
    const pantryNames = pantryItems.map(item => item.name);

    // Get user dietary prefs
    const user = await storage.getUser(userId);
    const foodProfile = getFoodProfile(user?.preferences);
    // Allergies ride along as hard rules for the generated recipe
    const dietaryRestrictions: string[] = [
      ...foodProfile.diets,
      ...foodProfile.allergies.map((a) => `no ${a} (allergy)`),
    ];

    // Generate full recipe via AI
    const { generateFullRecipeUnified } = await import('../ai-service');
    const recipe = await generateFullRecipeUnified(concept, pantryNames, dietaryRestrictions);

    if (!recipe) {
      return res.status(500).json({ error: "Failed to generate full recipe" });
    }

    // Cross-reference ingredients against pantry
    const pantryItemsForMatching = pantryItems.map(p => ({
      name: p.name,
      normalizedName: p.normalizedName,
      quantity: p.quantity,
      unit: p.unit,
    }));

    const matched: string[] = [];
    const missing: string[] = [];

    for (const ing of recipe.ingredients) {
      const ingredientName = ing.replace(/^[\d\s\/½¼¾⅓⅔⅛]+\s*(cups?|tablespoons?|tbsp|teaspoons?|tsp|ounces?|oz|pounds?|lbs?|cloves?|cans?|pieces?|slices?|bunch|head|stalks?|sprigs?|pinch|dash|to taste)?\s*/i, '').trim() || ing;
      const matchResult = findPantryMatch(ingredientName, pantryItemsForMatching);
      if (matchResult.match !== null) {
        matched.push(ing);
      } else {
        missing.push(ing);
      }
    }

    const total = recipe.ingredients.length;
    const matchPercentage = total > 0 ? Math.round((matched.length / total) * 100) : 0;

    res.json({
      recipe,
      matchedIngredients: matched,
      missingIngredients: missing,
      matchPercentage,
      pantryItemCount: pantryItems.length,
    });
  } catch (error) {
    console.error("Error generating full recipe:", error);
    res.status(500).json({ error: "Failed to generate full recipe" });
  }
});

// Save an AI-generated recipe to the user's collection
router.post("/recipes/save-generated", isAuthenticated, async (req: any, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const { recipe } = req.body;
    if (!recipe || !recipe.title || !recipe.ingredients || !recipe.instructions) {
      return res.status(400).json({ error: "Invalid recipe data" });
    }

    const totalMinutes = (recipe.prepTimeMinutes || 0) + (recipe.cookTimeMinutes || 0);

    const recipeData: any = {
      title: recipe.title,
      description: recipe.description || '',
      prepTime: recipe.prepTimeMinutes ? `${recipe.prepTimeMinutes} mins` : '0 mins',
      cookTime: recipe.cookTimeMinutes ? `${recipe.cookTimeMinutes} mins` : '0 mins',
      totalTime: totalMinutes ? `${totalMinutes} mins` : '0 mins',
      prepTimeMinutes: recipe.prepTimeMinutes || 0,
      cookTimeMinutes: recipe.cookTimeMinutes || 0,
      totalTimeMinutes: totalMinutes,
      servings: recipe.servings || 4,
      ingredients: recipe.ingredients,
      instructions: recipe.instructions,
      cuisine: recipe.cuisine || null,
      skillLevel: recipe.difficulty || null,
      ownerUserId: userId,
      isPublic: true,
      enrichmentStatus: 'extracting' as const,
      aiEnriched: false,
      variationNotes: 'AI-generated recipe from Recipe Creator',
    };

    const validated = insertRecipeSchema.parse(recipeData);
    const savedRecipe = await storage.createRecipe(validated);
    // The person checks Grammie's draft on the review screen before it's final
    await recordImport({ recipeId: savedRecipe.id, ownerUserId: userId, sourceType: 'creator' });

    // Queue enrichment job
    try {
      jobQueue.addEnrichmentJob(savedRecipe.id);
    } catch (jobError) {
      console.error("Failed to queue enrichment job:", jobError);
    }

    res.status(201).json(savedRecipe);
  } catch (error) {
    console.error("Error saving generated recipe:", error);
    res.status(500).json({ error: "Failed to save recipe" });
  }
});

// Add arbitrary items to grocery list (for AI-generated recipe missing ingredients)
router.post("/recipes/add-items-to-grocery", isAuthenticated, async (req: any, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const { items } = req.body;
    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: "items array is required" });
    }

    let added = 0;
    for (const itemName of items) {
      if (typeof itemName !== 'string' || !itemName.trim()) continue;
      const name = itemName.trim();
      await storage.addManualItemToGroceryList(userId, {
        item: name,
        quantity: 1,
        unit: 'count',
        displayName: name,
        aisle: 'Other',
        category: 'Other',
      } as any);
      added++;
    }

    res.json({ added });
  } catch (error) {
    console.error("Error adding items to grocery list:", error);
    res.status(500).json({ error: "Failed to add items to grocery list" });
  }
});

// Find the user's duplicate recipes, grouped by normalized title.
// MUST register before /recipes/:id or "duplicates" is parsed as an id.
router.get("/recipes/duplicates", isAuthenticated, async (req: any, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    const groups = await storage.findDuplicateRecipes(userId);
    res.json({ groups });
  } catch (error) {
    console.error("Error finding duplicate recipes:", error);
    res.status(500).json({ error: "Failed to find duplicates" });
  }
});

// Merge duplicates: keep one recipe, repoint cookbook/meal-plan/bookmark
// references from the others to it, then delete the others.
router.post("/recipes/merge-duplicates", isAuthenticated, async (req: any, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const schema = z.object({
      keepId: z.string().min(1),
      removeIds: z.array(z.string().min(1)).min(1).max(20),
    }).refine((d) => !d.removeIds.includes(d.keepId), { message: "keepId cannot be in removeIds" });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
    }

    const result = await storage.mergeDuplicateRecipes(userId, parsed.data.keepId, parsed.data.removeIds);
    res.json(result);
  } catch (error: any) {
    console.error("Error merging duplicate recipes:", error);
    res.status(error.message?.includes('not found') ? 404 : 500).json({ error: error.message || "Failed to merge duplicates" });
  }
});

// Get single recipe by ID
router.get("/recipes/:id", optionalAuth, async (req: any, res) => {
  try {
    const { id } = req.params;
    const userId = getUserId(req);
    const recipe = await storage.getRecipe(id, userId);

    if (!recipe) {
      return res.status(404).json({ error: "Recipe not found" });
    }

    res.json(recipe);
  } catch (error) {
    console.error("Error fetching recipe:", error);
    res.status(500).json({ error: "Failed to fetch recipe" });
  }
});

// Create recipe manually (requires auth)
router.post("/recipes", isAuthenticated, async (req: any, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    // Ensure required time fields exist (provide defaults if missing)
    const recipeData = { ...req.body };
    if (!recipeData.prepTime) recipeData.prepTime = "0 mins";
    if (!recipeData.totalTime) recipeData.totalTime = recipeData.cookTime || "0 mins";

    // Add ownership
    recipeData.ownerUserId = userId;
    recipeData.isPublic = recipeData.isPublic !== undefined ? recipeData.isPublic : true;

    const validated = insertRecipeSchema.parse(recipeData);
    const recipe = await storage.createRecipe(validated);
    res.status(201).json(recipe);
  } catch (error) {
    console.error("Error creating recipe:", error);
    res.status(400).json({ error: "Invalid recipe data" });
  }
});

// ===== UPLOAD SESSION ROUTES =====

// Create a new upload session for multi-image uploads
router.post("/uploads/sessions", isAuthenticated, async (req: any, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { totalFiles } = req.body;
    if (!totalFiles || totalFiles < 1 || totalFiles > 10) {
      return res.status(400).json({ error: "Total files must be between 1 and 10" });
    }

    const session = await storage.createUploadSession({
      userId,
      totalFiles,
      completedCount: 0,
      failedCount: 0,
      status: 'processing',
    });

    res.status(201).json(session);
  } catch (error) {
    console.error("Error creating upload session:", error);
    res.status(500).json({ error: "Failed to create upload session" });
  }
});

// Get upload session status with recipe details
router.get("/uploads/sessions/:id", isAuthenticated, async (req: any, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { id } = req.params;
    const session = await storage.getUploadSessionWithRecipes(id, userId);

    if (!session) {
      return res.status(404).json({ error: "Upload session not found" });
    }

    res.json(session);
  } catch (error) {
    console.error("Error fetching upload session:", error);
    res.status(500).json({ error: "Failed to fetch upload session" });
  }
});

// Upload and extract recipe from handwritten image with two-phase enrichment (requires auth)
router.post(
  "/recipes/upload",
  isAuthenticated,
  upload.single("image"),
  async (req: any, res) => {
    try {
      const userId = getUserId(req);
      if (!userId) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      if (!req.file) {
        return res.status(400).json({ error: "No image file provided" });
      }

      // Convert HEIC/HEIF files to JPEG (OpenAI Vision doesn't support HEIC)
      let imageBuffer = req.file.buffer;
      let mimetype = req.file.mimetype;
      const isHeic = mimetype === 'image/heic' ||
                     mimetype === 'image/heif' ||
                     req.file.originalname?.toLowerCase().endsWith('.heic') ||
                     req.file.originalname?.toLowerCase().endsWith('.heif');

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
          return res.status(400).json({
            error: "Failed to convert HEIC image. Please try a different format."
          });
        }
      }

      const imageBase64 = imageBuffer.toString("base64");
      const handwrittenImageDataUrl = `data:${mimetype};base64,${imageBase64}`;

      // Screenshots of a post whose link couldn't be read keep its link
      const shotOf = socialLinkFrom(req.body.sourceUrl);

      // Get optional session metadata for multi-image uploads
      const sessionId = req.body.sessionId;
      const sourceImageIndex = req.body.sourceImageIndex;

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
        isPublic: true,
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
      console.log(`Recipe ${recipe.id} created${sessionId ? ` for session ${sessionId}` : ''}, queuing extraction...`);

      // Queue Vision extraction for background processing
      jobQueue.addExtractionJob(recipe.id, imageBase64);
      if (!shotOf) straightenNewCard(recipe.id);

      // Return immediately so the progress banner appears
      res.status(201).json({ recipeId: recipe.id });
    } catch (error) {
      console.error("Error uploading recipe:", error);
      res.status(500).json({
        error:
          error instanceof Error
            ? error.message
            : "Failed to process recipe",
      });
    }
  }
);

// Upload multiple images for a single recipe (requires auth)
router.post(
  "/recipes/upload-multi-image",
  isAuthenticated,
  upload.array("images", 5),
  async (req: any, res) => {
    try {
      const userId = getUserId(req);
      if (!userId) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const files = req.files as Express.Multer.File[];
      const shotOf = socialLinkFrom(req.body.sourceUrl);
      if (!files || files.length === 0) {
        return res.status(400).json({ error: "No image files provided" });
      }

      if (files.length > 5) {
        return res.status(400).json({ error: "Maximum 5 images allowed for single recipe" });
      }

      console.log(`Processing ${files.length} images for single recipe...`);

      // Process all images (convert HEIC if needed)
      const imagesBase64: string[] = [];
      const handwrittenImages: string[] = [];

      for (const file of files) {
        let imageBuffer = file.buffer;
        let mimetype = file.mimetype;
        const isHeic = mimetype === 'image/heic' ||
                       mimetype === 'image/heif' ||
                       file.originalname?.toLowerCase().endsWith('.heic') ||
                       file.originalname?.toLowerCase().endsWith('.heif');

        if (isHeic) {
          console.log(`Converting HEIC/HEIF image to JPEG...`);
          try {
            const jpegBuffer = await heicConvert({
              buffer: imageBuffer,
              format: 'JPEG',
              quality: 0.95
            });
            imageBuffer = Buffer.from(jpegBuffer);
            mimetype = 'image/jpeg';
          } catch (conversionError) {
            console.error("HEIC conversion failed:", conversionError);
            return res.status(400).json({
              error: "Failed to convert HEIC image. Please try a different format."
            });
          }
        }

        const base64 = imageBuffer.toString("base64");
        imagesBase64.push(base64);
        handwrittenImages.push(`data:${mimetype};base64,${base64}`);
      }

      // Generate thumbnail for the first uploaded source image
      let firstSourceThumbnail: string | null = null;
      try {
        firstSourceThumbnail = await generateThumbnail(handwrittenImages[0], 256);
      } catch (thumbError) {
        console.warn("Failed to generate source image thumbnail:", thumbError);
      }

      // Create initial dishImages entry with first uploaded source image as preview
      const { randomUUID } = await import("crypto");
      const initialDishImages = [{
        id: randomUUID(),
        url: handwrittenImages[0],
        thumbnailUrl: firstSourceThumbnail || undefined,
        isAiGenerated: false,
        order: 0,
        createdAt: new Date().toISOString(),
      }];

      // Create placeholder recipe with first handwritten image
      const recipeData: any = {
        ownerUserId: userId,
        isPublic: true,
        title: "Your Recipe",
        prepTime: "0 mins",
        totalTime: "0 mins",
        servings: 1,
        ingredients: ["Extracting..."],
        instructions: [`Extracting from ${files.length} images...`],
        handwrittenImage: handwrittenImages[0], // Store first image as primary
        dishImage: handwrittenImages[0], // Use source image as initial preview
        dishImageThumbnail: firstSourceThumbnail,
        dishImages: initialDishImages, // Store source image in dishImages array
        enrichmentStatus: 'extracting' as const,
        enrichmentRetryCount: 0,
        ...(shotOf ? { socialSourcePlatform: shotOf.platform, socialSourceUrl: shotOf.url } : {}),
      };

      const validatedData = insertRecipeSchema.parse(recipeData);
      const recipe = await storage.createRecipe(validatedData);
      // Keep every page, not just the first (handwrittenImage holds page 1)
      await recordImport({
        recipeId: recipe.id,
        ownerUserId: userId,
        sourceType: shotOf ? 'social' : 'photo',
        ...(shotOf ? { sourceUrl: shotOf.url } : {}),
        extraPageImages: handwrittenImages.slice(1),
      });
      console.log(`Recipe ${recipe.id} created, queuing multi-image extraction with ${files.length} images...`);

      // Queue multi-image extraction
      jobQueue.addMultiImageExtractionJob(recipe.id, imagesBase64);
      if (!shotOf) straightenNewCard(recipe.id);

      res.status(201).json({ recipeId: recipe.id });
    } catch (error) {
      console.error("Error uploading multi-image recipe:", error);
      res.status(500).json({
        error: error instanceof Error ? error.message : "Failed to process recipe",
      });
    }
  }
);

/** A social post link sent with screenshots or a pasted caption */
function socialLinkFrom(raw: unknown): { url: string; platform: "instagram" | "tiktok" | "youtube" } | null {
  if (typeof raw !== "string") return null;
  const url = normalizeUrl(raw);
  const platform = url ? detectLinkPlatform(url) : null;
  return url && (platform === "instagram" || platform === "tiktok" || platform === "youtube") ? { url, platform } : null;
}

// Turn the original card photo (sideways or upside-down uploads)
router.post("/recipes/:id/original-card/rotate", isAuthenticated, async (req: any, res) => {
  try {
    const userId = getUserId(req);
    const degrees = Number(req.body?.degrees);
    if (![90, 180, 270].includes(degrees)) return res.status(400).json({ error: "Turn by 90, 180 or 270 degrees" });
    const recipe = await storage.getRecipe(req.params.id);
    if (!recipe) return res.status(404).json({ error: "Recipe not found" });
    if (recipe.ownerUserId !== userId) return res.status(403).json({ error: "Only the recipe's owner can change its card" });
    if (!(await rotateOriginalCard(recipe.id, degrees as 90 | 180 | 270))) {
      return res.status(404).json({ error: "This recipe has no original card" });
    }
    res.json({ ok: true });
  } catch (error) {
    console.error("Error rotating original card:", error);
    res.status(500).json({ error: "Couldn't turn the card" });
  }
});

// Gray placeholder shown until the dish photo is generated. The title is
// escaped: an "&" in "Mac & Cheese" would otherwise break the SVG.
function placeholderImage(title: string, subtitle: string): string {
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
async function importWebLink(url: string, userId: string, foundVia?: string): Promise<{ status: number; body: any }> {
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
    isPublic: true,

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
  console.log(`[URL import] Recipe ${recipe.id} saved from ${new URL(url).hostname} in ${Date.now() - started}ms, queuing enrichment`);
  jobQueue.addEnrichmentJob(recipe.id);
  // Start the dish photo now, alongside enrichment, so it's ready sooner
  jobQueue.addImageGenerationJob(recipe.id, recipe.title, recipe.ingredients);

  return { status: 201, body: { recipeId: recipe.id } };
}

// Extract recipe from URL endpoint (requires auth). Social links pasted here
// go to the social importer.
router.post("/recipes/extract-url", isAuthenticated, async (req: any, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { url } = req.body;
    if (!url || typeof url !== "string") {
      return res.status(400).json({ error: "Valid URL is required" });
    }

    const result = detectPlatform(url) === "web" ? await importWebLink(url, userId) : await importSocialLink(url, userId);
    res.status(result.status).json(result.body);
  } catch (error) {
    console.error("Error extracting recipe from URL:", error);
    let errorMessage = error instanceof Error ? error.message : "We couldn't import that link.";
    if (errorMessage.includes("Only HTTP and HTTPS")) errorMessage = "That link isn't a web page. Paste a link that starts with https://";
    else if (/private|local addresses/i.test(errorMessage)) errorMessage = "That link points to a private address.";
    res.status(400).json({ error: errorMessage });
  }
});

// Extract recipe from pasted text (requires auth)
router.post("/recipes/extract-text", isAuthenticated, async (req: any, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { text } = req.body;
    // A caption pasted after a post couldn't be read keeps its link
    const link = typeof req.body.sourceUrl === "string" ? normalizeUrl(req.body.sourceUrl) : null;
    const linkPlatform = link ? detectLinkPlatform(link) : null;
    const social = linkPlatform === "instagram" || linkPlatform === "tiktok" || linkPlatform === "youtube" ? linkPlatform : null;

    if (!text || typeof text !== "string" || text.trim().length < 20) {
      return res.status(400).json({ error: "Please provide complete recipe text" });
    }

    console.log(`Extracting recipe from pasted text (${text.length} chars)`);

    const rawRecipe = await extractRecipeFromText(text, social ? "caption" : "pasted");

    if (!rawRecipe.title || !rawRecipe.ingredients?.length || !rawRecipe.instructions?.length) {
      return res.status(400).json({
        error: "We couldn't find a full recipe in that text. Include the title, the ingredients and the steps.",
      });
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
      isPublic: true,

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
    console.log(`Recipe ${recipe.id} saved from pasted text, queuing enrichment...`);

    // Queue Phase 2 enrichment
    jobQueue.addEnrichmentJob(recipe.id);
    // Start the dish photo now, alongside enrichment, so it's ready sooner
    jobQueue.addImageGenerationJob(recipe.id, recipe.title, recipe.ingredients);

    res.status(201).json({ recipeId: recipe.id });
  } catch (error) {
    console.error("Error extracting recipe from text:", error);
    const errorMessage = error instanceof Error ? error.message : "Failed to process recipe text";
    res.status(400).json({ error: errorMessage });
  }
});

// Social import (Instagram, TikTok, YouTube): read the caption, turn it into
// a recipe, save it, and queue enrichment. If the caption only points
// somewhere else ("full recipe at mysite.com/..."), import that page instead.
async function importSocialLink(url: string, userId: string): Promise<{ status: number; body: any }> {
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
        const result = await importWebLink(link, userId, url);
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
    isPublic: true,

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

// Admin: what each Instagram route returns from this server (Instagram
// treats data-center addresses differently from home connections)
router.get("/admin/instagram-check", isAuthenticated, async (req: any, res) => {
  const user = await storage.getUser(getUserId(req) ?? "");
  if (!user?.isAdmin) return res.status(403).json({ error: "Admins only" });
  if (typeof req.query.url !== "string") return res.status(400).json({ error: "Add ?url=" });
  res.json(await diagnoseInstagram(req.query.url));
});

router.post("/recipes/import-social", isAuthenticated, async (req: any, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { url } = req.body;
    if (!url || typeof url !== "string" || !isValidSocialUrl(url)) {
      return res.status(400).json({ error: "That doesn't look like a link. Copy the whole link and paste it again." });
    }

    // Web pages go through the web importer
    const result = detectPlatform(url) === "web" ? await importWebLink(url, userId) : await importSocialLink(url, userId);
    res.status(result.status).json(result.body);
  } catch (error) {
    console.error("[Social Import] Error:", error);
    const errorMessage = error instanceof Error ? error.message : "Failed to import recipe";
    res.status(400).json({ error: errorMessage });
  }
});

// Retry enrichment for failed recipes
router.post("/recipes/:id/enrich", isAuthenticated, async (req: any, res) => {
  try {
    const { id } = req.params;
    const force = req.query.force === 'true'; // Allow forcing re-enrichment
    const userId = getUserId(req);

    const recipe = await storage.getRecipe(id, userId);
    if (!recipe) {
      return res.status(404).json({ error: "Recipe not found" });
    }

    // Check ownership (or allow in development mode)
    const isDevelopment = process.env.NODE_ENV === 'development';
    if (!isDevelopment && recipe.ownerUserId !== userId) {
      return res.status(403).json({ error: "Only the recipe owner can re-enrich the recipe" });
    }

    // Only allow retry if enrichment failed (unless forced)
    if (recipe.enrichmentStatus === 'ready' && !force) {
      return res.status(400).json({
        error: "Recipe enrichment is already complete",
        currentStatus: 'ready'
      });
    }

    // If already enriching, don't queue duplicate job
    if (recipe.enrichmentStatus === 'enriching') {
      return res.json({
        message: "Enrichment is already in progress",
        status: 'enriching'
      });
    }

    // Validate recipe has minimum required fields before retrying
    if (!recipe.ingredients || recipe.ingredients.length === 0 ||
        !recipe.instructions || recipe.instructions.length === 0) {
      return res.status(400).json({
        error: "Recipe is missing required fields (ingredients or instructions)",
      });
    }

    // Reset status and queue enrichment
    await storage.updateRecipe(id, {
      enrichmentStatus: 'enriching',
      enrichmentError: null,
    }, userId);

    // Queue enrichment job
    jobQueue.addEnrichmentJob(id);

    console.log(`Manually queued enrichment retry for recipe ${id} by user ${userId}`);
    res.json({ message: "Enrichment retry queued successfully", status: 'enriching' });
  } catch (error) {
    console.error("Error queueing enrichment retry:", error);
    res.status(500).json({ error: "Failed to queue enrichment retry" });
  }
});

// Regenerate dish image for a recipe
router.post("/recipes/:id/regenerate-image", isAuthenticated, async (req: any, res) => {
  try {
    const { id } = req.params;
    const userId = getUserId(req);

    const recipe = await storage.getRecipe(id, userId);
    if (!recipe) {
      return res.status(404).json({ error: "Recipe not found" });
    }

    // Check ownership (or allow in development mode)
    const isDevelopment = process.env.NODE_ENV === 'development';
    if (!isDevelopment && recipe.ownerUserId !== userId) {
      return res.status(403).json({ error: "Only the recipe owner can regenerate the image" });
    }

    // Validate recipe has required fields
    if (!recipe.title || !recipe.ingredients || recipe.ingredients.length === 0) {
      return res.status(400).json({
        error: "Recipe is missing required fields (title or ingredients)",
      });
    }

    // Queue image generation job
    const ingredientNames = recipe.ingredients.map((ing: any) => ing.item || '');
    jobQueue.addImageGenerationJob(id, recipe.title, ingredientNames);

    console.log(`Manually queued image regeneration for recipe ${id}`);
    res.json({ message: "Image regeneration queued successfully" });
  } catch (error) {
    console.error("Error queueing image regeneration:", error);
    res.status(500).json({ error: "Failed to queue image regeneration" });
  }
});

// Get the image prompt for a recipe (for editing before regeneration)
router.get("/recipes/:id/image-prompt", isAuthenticated, async (req: any, res) => {
  try {
    const { id } = req.params;
    const userId = getUserId(req);

    const recipe = await storage.getRecipe(id, userId);
    if (!recipe) {
      return res.status(404).json({ error: "Recipe not found" });
    }

    // Check ownership
    if (recipe.ownerUserId !== userId) {
      return res.status(403).json({ error: "Only the recipe owner can view the image prompt" });
    }

    // If no stored prompt, generate one from recipe context
    let prompt = recipe.imagePrompt;
    if (!prompt && recipe.title && recipe.ingredients) {
      const { buildImagePrompt } = await import("../openai");
      const ingredientNames = recipe.ingredients.map((ing: any) => ing.item || ing.name || '');
      prompt = buildImagePrompt(recipe.title, ingredientNames, {
        instructions: recipe.instructions,
        cookingMethods: recipe.cookingMethods || undefined,
        cuisines: recipe.cuisines || undefined,
        mealType: recipe.mealType || undefined,
        skillLevel: recipe.skillLevel || undefined,
      });
    }

    res.json({
      prompt: prompt || '',
      dishImages: recipe.dishImages || [],
      currentImage: recipe.dishImage || null,
    });
  } catch (error) {
    console.error("Error getting image prompt:", error);
    res.status(500).json({ error: "Failed to get image prompt" });
  }
});

// Regenerate image with custom prompt
router.post("/recipes/:id/regenerate-image-custom", isAuthenticated, async (req: any, res) => {
  try {
    const { id } = req.params;
    const { prompt, replaceExisting = false } = req.body;
    const userId = getUserId(req);

    if (!prompt || typeof prompt !== 'string') {
      return res.status(400).json({ error: "Prompt is required" });
    }

    const recipe = await storage.getRecipe(id, userId);
    if (!recipe) {
      return res.status(404).json({ error: "Recipe not found" });
    }

    if (recipe.ownerUserId !== userId) {
      return res.status(403).json({ error: "Only the recipe owner can regenerate images" });
    }

    // Build existing images array - include legacy dishImage if dishImages array is empty
    let existingImages = recipe.dishImages || [];
    if (existingImages.length === 0 && recipe.dishImage && !recipe.dishImage.startsWith('data:image/svg')) {
      // Migrate legacy dishImage to dishImages array
      const { randomUUID } = await import("crypto");
      existingImages = [{
        id: randomUUID(),
        url: recipe.dishImage,
        thumbnailUrl: recipe.dishImageThumbnail || undefined,
        isAiGenerated: true,
        order: 0,
        createdAt: new Date().toISOString(),
      }];
    }

    // Check image limit (max 3 images) if not replacing
    if (!replaceExisting && existingImages.length >= 3) {
      return res.status(400).json({ error: "Maximum 3 images allowed. Delete an existing image first." });
    }

    // Generate the image
    const { generateDishImageWithCustomPrompt } = await import("../openai");
    const { generateThumbnail: genThumb } = await import("../thumbnail");
    const { randomUUID } = await import("crypto");

    const { buffer } = await generateDishImageWithCustomPrompt(prompt);

    const isSvg = buffer.toString("utf8").startsWith("<svg");
    const dishImageDataUrl = isSvg
      ? `data:image/svg+xml;base64,${buffer.toString("base64")}`
      : `data:image/png;base64,${buffer.toString("base64")}`;

    let thumbnailDataUrl: string | null = null;
    if (!isSvg) {
      try {
        thumbnailDataUrl = await genThumb(dishImageDataUrl, 256);
      } catch (e) {
        console.error("Failed to generate thumbnail:", e);
      }
    }

    // Create new image entry
    const newImage = {
      id: randomUUID(),
      url: dishImageDataUrl,
      thumbnailUrl: thumbnailDataUrl || undefined,
      isAiGenerated: true,
      order: 0,
      createdAt: new Date().toISOString(),
    };

    // Update images array based on replaceExisting flag
    let updatedImages;
    if (replaceExisting) {
      // Replace the first/primary image
      updatedImages = [newImage, ...existingImages.slice(1).map((img: any, idx: number) => ({ ...img, order: idx + 1 }))];
    } else {
      // Add to the beginning
      updatedImages = [newImage, ...existingImages.map((img: any, idx: number) => ({ ...img, order: idx + 1 }))].slice(0, 3);
    }

    // Update recipe
    await storage.updateRecipe(id, {
      dishImage: dishImageDataUrl,
      dishImageThumbnail: thumbnailDataUrl,
      imagePrompt: prompt,
      dishImages: updatedImages,
      imageGenerationStatus: 'ready',
    }, userId);

    res.json({
      success: true,
      image: newImage,
      dishImages: updatedImages,
    });
  } catch (error) {
    console.error("Error regenerating image with custom prompt:", error);
    res.status(500).json({ error: "Failed to regenerate image" });
  }
});

// Upload user dish image
router.post("/recipes/:id/upload-image", isAuthenticated, upload.single('image'), async (req: any, res) => {
  try {
    const { id } = req.params;
    const userId = getUserId(req);

    const recipe = await storage.getRecipe(id, userId);
    if (!recipe) {
      return res.status(404).json({ error: "Recipe not found" });
    }

    if (recipe.ownerUserId !== userId) {
      return res.status(403).json({ error: "Only the recipe owner can upload images" });
    }

    const { generateThumbnail: genThumb } = await import("../thumbnail");
    const { randomUUID } = await import("crypto");

    // Build existing images array - include legacy dishImage if dishImages array is empty
    let existingImages = recipe.dishImages || [];
    if (existingImages.length === 0 && recipe.dishImage && !recipe.dishImage.startsWith('data:image/svg')) {
      // Migrate legacy dishImage to dishImages array
      existingImages = [{
        id: randomUUID(),
        url: recipe.dishImage,
        thumbnailUrl: recipe.dishImageThumbnail || undefined,
        isAiGenerated: true,
        order: 0,
        createdAt: new Date().toISOString(),
      }];
    }

    // Check image limit
    if (existingImages.length >= 3) {
      return res.status(400).json({ error: "Maximum 3 images allowed. Delete an existing image first." });
    }

    if (!req.file) {
      return res.status(400).json({ error: "No image file provided" });
    }

    // Handle HEIC conversion if needed
    let imageBuffer = req.file.buffer;
    let mimeType = req.file.mimetype;

    if (mimeType === 'image/heic' || mimeType === 'image/heif') {
      const heicConvertModule = await import('heic-convert');
      imageBuffer = Buffer.from(await heicConvertModule.default({
        buffer: imageBuffer,
        format: 'JPEG',
        quality: 0.9,
      }));
      mimeType = 'image/jpeg';
    }

    const imageDataUrl = `data:${mimeType};base64,${imageBuffer.toString('base64')}`;

    let thumbnailDataUrl: string | null = null;
    try {
      thumbnailDataUrl = await genThumb(imageDataUrl, 256);
    } catch (e) {
      console.error("Failed to generate thumbnail:", e);
    }

    // Create new image entry
    const newImage = {
      id: randomUUID(),
      url: imageDataUrl,
      thumbnailUrl: thumbnailDataUrl || undefined,
      isAiGenerated: false,
      order: existingImages.length,
      createdAt: new Date().toISOString(),
    };

    const updatedImages = [...existingImages, newImage];

    // If this is the first image, set it as the primary
    const updates: any = {
      dishImages: updatedImages,
    };

    if (existingImages.length === 0) {
      updates.dishImage = imageDataUrl;
      updates.dishImageThumbnail = thumbnailDataUrl;
    }

    await storage.updateRecipe(id, updates, userId);

    res.json({
      success: true,
      image: newImage,
      dishImages: updatedImages,
    });
  } catch (error) {
    console.error("Error uploading dish image:", error);
    res.status(500).json({ error: "Failed to upload image" });
  }
});

// Reorder dish images
router.post("/recipes/:id/reorder-images", isAuthenticated, async (req: any, res) => {
  try {
    const { id } = req.params;
    const { imageIds } = req.body;
    const userId = getUserId(req);

    if (!Array.isArray(imageIds)) {
      return res.status(400).json({ error: "imageIds must be an array" });
    }

    const recipe = await storage.getRecipe(id, userId);
    if (!recipe) {
      return res.status(404).json({ error: "Recipe not found" });
    }

    if (recipe.ownerUserId !== userId) {
      return res.status(403).json({ error: "Only the recipe owner can reorder images" });
    }

    const existingImages = recipe.dishImages || [];

    // Reorder based on provided imageIds order
    const reorderedImages = imageIds.map((imageId: string, index: number) => {
      const img = existingImages.find((i: any) => i.id === imageId);
      if (!img) return null;
      return { ...img, order: index };
    }).filter(Boolean);

    // Set primary image (first in order)
    const primaryImage = reorderedImages[0];

    const updates: any = {
      dishImages: reorderedImages,
    };

    if (primaryImage) {
      updates.dishImage = primaryImage.url;
      updates.dishImageThumbnail = primaryImage.thumbnailUrl || null;
    }

    await storage.updateRecipe(id, updates, userId);

    res.json({
      success: true,
      dishImages: reorderedImages,
    });
  } catch (error) {
    console.error("Error reordering images:", error);
    res.status(500).json({ error: "Failed to reorder images" });
  }
});

// Delete a specific dish image
router.delete("/recipes/:id/images/:imageId", isAuthenticated, async (req: any, res) => {
  try {
    const { id, imageId } = req.params;
    const userId = getUserId(req);

    const recipe = await storage.getRecipe(id, userId);
    if (!recipe) {
      return res.status(404).json({ error: "Recipe not found" });
    }

    if (recipe.ownerUserId !== userId) {
      return res.status(403).json({ error: "Only the recipe owner can delete images" });
    }

    const existingImages = recipe.dishImages || [];
    const filteredImages = existingImages
      .filter((img: any) => img.id !== imageId)
      .map((img: any, idx: number) => ({ ...img, order: idx }));

    // Update primary image if needed
    const updates: any = {
      dishImages: filteredImages,
    };

    if (filteredImages.length === 0) {
      updates.dishImage = null;
      updates.dishImageThumbnail = null;
    } else if (existingImages[0]?.id === imageId) {
      // The deleted image was the primary, set new primary
      updates.dishImage = filteredImages[0].url;
      updates.dishImageThumbnail = filteredImages[0].thumbnailUrl || null;
    }

    await storage.updateRecipe(id, updates, userId);

    res.json({
      success: true,
      dishImages: filteredImages,
    });
  } catch (error) {
    console.error("Error deleting image:", error);
    res.status(500).json({ error: "Failed to delete image" });
  }
});

// Scale recipe endpoint
router.post("/recipes/:id/scale", async (req: any, res) => {
  try {
    const { id } = req.params;
    const { servings } = req.body;

    if (!servings || servings <= 0) {
      return res.status(400).json({ error: "Invalid servings count" });
    }

    const recipe = await storage.getRecipe(id);
    if (!recipe) {
      return res.status(404).json({ error: "Recipe not found" });
    }

    // Return full merged recipe with scaled data (not persisted to storage)
    const scaledRecipe = buildScaledRecipeResponse(recipe, servings);
    res.json(scaledRecipe);
  } catch (error) {
    console.error("Error scaling recipe:", error);
    res.status(500).json({ error: "Failed to scale recipe" });
  }
});

// Update recipe (requires auth - storage checks ownership OR editor permissions)
router.patch("/recipes/:id", isAuthenticated, async (req: any, res) => {
  try {
    const { id } = req.params;
    const userId = getUserId(req);
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    // Validate using the update schema which allows optional fields
    const updates = updateRecipeSchema.parse(req.body);
    const recipe = await storage.updateRecipe(id, updates, userId);

    if (!recipe) {
      return res.status(404).json({ error: "Recipe not found or unauthorized" });
    }

    res.json(recipe);
  } catch (error: any) {
    console.error("Error updating recipe:", error);
    res.status(400).json({ error: error.message || "Invalid update data" });
  }
});

// Bulk delete recipes (owner OR admin can delete)
// NOTE: This route MUST come BEFORE /api/recipes/:id to avoid Express matching "bulk" as :id
router.delete("/recipes/bulk", isAuthenticated, async (req: any, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    // Get the authenticated user's record to verify admin status
    const [authenticatedUser] = await db.select().from(users).where(eq(users.id, userId));
    if (!authenticatedUser) {
      return res.status(401).json({ error: "User not found" });
    }

    const schema = z.object({
      recipeIds: z.array(z.string()).min(1),
    });

    const { recipeIds } = schema.parse(req.body);

    // For admins, allow deletion of any recipe
    // For regular users, bulkDeleteRecipes will check ownership
    const isAdmin = authenticatedUser.isAdmin ?? false;

    const result = await storage.bulkDeleteRecipes(recipeIds, userId, isAdmin);

    res.json(result);
  } catch (error: any) {
    console.error("Error bulk deleting recipes:", error);
    res.status(400).json({ error: error.message || "Failed to delete recipes" });
  }
});

// Bulk add recipes to cookbook
router.post("/recipes/bulk/add-to-cookbook", isAuthenticated, async (req: any, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const schema = z.object({
      cookbookId: z.number(),
      recipeIds: z.array(z.string()).min(1),
    });

    const { cookbookId, recipeIds } = schema.parse(req.body);
    console.log(`[BULK ADD] Received cookbookId: ${cookbookId}, recipeIds: ${recipeIds.join(', ')}, userId: ${userId}`);
    const result = await storage.bulkAddRecipesToCookbook(cookbookId, recipeIds, userId);
    console.log(`[BULK ADD] Result: ${JSON.stringify(result)}`);

    res.json(result);
  } catch (error: any) {
    console.error("Error bulk adding recipes to cookbook:", error);
    res.status(400).json({ error: error.message || "Failed to add recipes to cookbook" });
  }
});

// Delete recipe (requires auth - owner OR admin can delete)
router.delete("/recipes/:id", isAuthenticated, async (req: any, res) => {
  try {
    const { id } = req.params;
    const userId = getUserId(req);
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    // Authorization check at route level (security hardening)
    // POLICY: Owner OR Admin can delete any recipe
    // Note: Storage-level authorization MUST stay aligned with this route-level check

    // Get the authenticated user's record to verify admin status
    const [authenticatedUser] = await db.select().from(users).where(eq(users.id, userId));
    if (!authenticatedUser) {
      return res.status(401).json({ error: "User not found" });
    }

    // Get the recipe to check ownership
    const [recipe] = await db.select().from(recipes).where(eq(recipes.id, id));
    if (!recipe) {
      return res.status(404).json({ error: "Recipe not found" });
    }

    // Allow deletion if user is owner OR user is admin
    const isOwner = recipe.ownerUserId === userId;
    const isAdmin = authenticatedUser.isAdmin;

    if (!isOwner && !isAdmin) {
      return res.status(403).json({ error: "Not authorized to delete this recipe" });
    }

    // Authorization passed, perform deletion
    const deleted = await storage.deleteRecipe(id, userId);
    if (!deleted) {
      return res.status(500).json({ error: "Failed to delete recipe" });
    }

    res.status(204).send();
  } catch (error) {
    console.error("Error deleting recipe:", error);
    res.status(500).json({ error: "Failed to delete recipe" });
  }
});

// Seed initial Asparagus Quiche recipe
const seedRecipe = async () => {
  const allRecipes = await storage.getAllRecipes();
  if (allRecipes.length === 0) {
    console.log("Seeding initial Asparagus Quiche recipe...");

    // Create system user if it doesn't exist
    await storage.upsertUser({
      id: "system",
      email: "system@recipes.local",
      username: "System",
      bio: "Legacy recipes owner",
    });

    const heroImagePath = join(
      process.cwd(),
      "attached_assets/generated_images/Asparagus_quiche_hero_image_06de363a.png"
    );

    // Check if hero image exists before trying to read it
    if (existsSync(heroImagePath)) {
      const heroImageBuffer = readFileSync(heroImagePath);
      const heroImageBase64 = `data:image/png;base64,${heroImageBuffer.toString("base64")}`;

      await storage.createRecipe({
        ownerUserId: "system",
        isPublic: true,
      title: "Asparagus Quiche",
      description:
        "A delicious and savory quiche featuring fresh asparagus and Swiss cheese, perfect for brunch or a light dinner.",
      prepTime: "15 mins",
      cookTime: "45 mins",
      totalTime: "1 hr 10 mins",
      coolingTime: "10 mins",
      prepTimeMinutes: 15,
      cookTimeMinutes: 45,
      totalTimeMinutes: 70,
      servings: 8,
      ingredients: [
        "1 (9 inch) pie shell, unbaked",
        "6 eggs, beaten",
        "1/2 pound fresh asparagus, cut into 1-inch pieces",
        "1/2 cup (2 ounces) shredded Swiss cheese",
        "1 cup milk",
        "1 cup sour cream",
        "1 tablespoon instant minced onion",
        "1/2 teaspoon salt",
        "1/4 teaspoon white pepper",
      ],
      instructions: [
        "Preheat the oven to 450\u00B0F for a metal pan or 425\u00B0F for a glass pan.",
        "Brush the pie shell with a small amount of the beaten eggs.",
        "Pierce the bottom and sides of the pie shell with a fork.",
        "Bake the pie shell for 5 minutes or until slightly golden. Cool on a rack.",
        "In a large skillet over medium heat, cook the asparagus in boiling water for 3-4 minutes until tender-crisp. Drain well.",
        "Arrange the asparagus and cheese in the bottom of the pie shell.",
        "In a medium bowl, combine the remaining eggs, milk, sour cream, onion, salt, and white pepper. Mix well.",
        "Pour the egg mixture over the asparagus and cheese.",
        "Reduce oven temperature to 325\u00B0F and bake for 40-45 minutes or until a knife inserted in the center comes out clean.",
        "Let stand for 10 minutes before serving.",
      ],
      dietType: ["vegetarian"],
      cuisine: "French",
      mealType: ["breakfast", "brunch", "lunch"],
      dishImage: heroImageBase64,

      // Nutritional Information
      calories: 285,
      protein: 12.5,
      carbohydrates: 18.2,
      fat: 18.5,
      fiber: 1.8,
      sugar: 3.2,
      sodium: 380,
      cholesterol: 185,

      // Dietary Flags
      isVegetarian: true,
      isVegan: false,
      isPescatarian: false,
      isGlutenFree: false,
      isDairyFree: false,
      isKeto: false,
      isPaleo: false,
      isLowCarb: false,
      isHighProtein: true,
      isLowCalorie: false,
      isHighFiber: false,

      // Skill & Difficulty
      skillLevel: "Intermediate",
      skillLevelExplanation: "Requires blind baking a pie crust and properly cooking eggs without curdling. Timing and temperature control are important.",

      // Cooking Details
      cookingMethods: ["Baking"],
      seasonTags: ["Spring"],
      occasionTags: ["Brunch", "Weeknight"],

      // Pricing
      priceRangeMin: 2.50,
      priceRangeMax: 3.50,
      priceCategory: "Moderate",

      // Allergens
      allergens: ["Eggs", "Dairy", "Gluten"],
      });
      console.log("Seed recipe created successfully!");
    } else {
      console.log("Hero image not found, skipping seed recipe");
    }
  }
};

seedRecipe().catch(console.error);

// ============================================================================
// RECIPE SHARING ROUTES
// ============================================================================

router.get("/recipes/:id/shares", isAuthenticated, async (req: any, res) => {
  try {
    const { id } = req.params;
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    // Direct database query for ownership check (security hardening)
    const [recipe] = await db.select().from(recipes).where(eq(recipes.id, id));
    if (!recipe || recipe.ownerUserId !== userId) {
      return res.status(403).json({ error: "Not authorized to view shares for this recipe" });
    }

    const shares = await storage.getRecipeShares(id);
    res.json(shares);
  } catch (error) {
    console.error("Error fetching recipe shares:", error);
    res.status(500).json({ error: "Failed to fetch shares" });
  }
});

router.post("/recipes/:id/share", isAuthenticated, async (req: any, res) => {
  try {
    const { id } = req.params;
    const { targetUserId, role } = req.body;
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    // Direct database query for ownership check (security hardening)
    const [recipe] = await db.select().from(recipes).where(eq(recipes.id, id));
    if (!recipe || recipe.ownerUserId !== userId) {
      return res.status(403).json({ error: "Not authorized to share this recipe" });
    }

    await storage.shareRecipe(id, targetUserId, role);
    res.status(201).json({ message: "Recipe shared successfully" });
  } catch (error) {
    console.error("Error sharing recipe:", error);
    res.status(400).json({ error: "Failed to share recipe" });
  }
});

router.delete("/recipes/:id/share/:targetUserId", isAuthenticated, async (req: any, res) => {
  try {
    const { id, targetUserId } = req.params;
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    // Direct database query for ownership check (security hardening)
    const [recipe] = await db.select().from(recipes).where(eq(recipes.id, id));
    if (!recipe || recipe.ownerUserId !== userId) {
      return res.status(403).json({ error: "Not authorized to modify sharing for this recipe" });
    }

    await storage.unshareRecipe(id, targetUserId);
    res.status(204).send();
  } catch (error) {
    console.error("Error unsharing recipe:", error);
    res.status(500).json({ error: "Failed to unshare recipe" });
  }
});

// ============================================================================
// RECIPE FORKING
// ============================================================================

router.post("/recipes/:id/fork", isAuthenticated, async (req: any, res) => {
  try {
    const { id } = req.params;
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const forkedRecipe = await storage.forkRecipe(id, userId);
    res.status(201).json(forkedRecipe);
  } catch (error) {
    console.error("Error forking recipe:", error);
    res.status(400).json({ error: "Failed to fork recipe" });
  }
});

// ============================================================================
// MAKE YOUR OWN (Recipe Variations)
// ============================================================================

router.post("/recipes/:id/make-your-own", isAuthenticated, async (req: any, res) => {
  try {
    const { id } = req.params;
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const { quickModifications, customInstructions }: {
      quickModifications: string[];
      customInstructions?: string;
    } = req.body;

    // Validate input
    if (!quickModifications?.length && !customInstructions?.trim()) {
      return res.status(400).json({ error: "Please select at least one modification or provide custom instructions" });
    }

    // Get the original recipe (any user can view public recipes)
    const originalRecipe = await storage.getRecipe(id, userId);
    if (!originalRecipe) {
      return res.status(404).json({ error: "Recipe not found" });
    }

    // Get user info for the title
    const user = await storage.getUser(userId);
    const displayName = user?.firstName || user?.email?.split("@")[0] || "User";

    // Import the AI service function
    const { generateRecipeVariationUnified } = await import("../ai-service");

    // Generate the variation using AI
    const variation = await generateRecipeVariationUnified({
      originalRecipe: {
        title: originalRecipe.title,
        description: originalRecipe.description || undefined,
        ingredients: originalRecipe.ingredients,
        normalizedIngredients: originalRecipe.normalizedIngredients || undefined,
        instructions: originalRecipe.instructions,
        servings: originalRecipe.servings,
        prepTime: originalRecipe.prepTime,
        cookTime: originalRecipe.cookTime || undefined,
        totalTime: originalRecipe.totalTime,
      },
      quickModifications: quickModifications || [],
      customInstructions: customInstructions?.trim(),
      userName: displayName,
    });

    // Create the new recipe owned by the current user
    const newRecipe = await storage.createRecipe({
      title: variation.title,
      description: variation.description,
      ingredients: variation.ingredients,
      instructions: variation.instructions,
      servings: variation.servings,
      prepTime: variation.prepTime,
      cookTime: variation.cookTime,
      totalTime: variation.totalTime,
      ownerUserId: userId,
      isPublic: true,
      derivedFromRecipeId: id,
      variationNotes: variation.variationNotes,
      variationModifications: variation.appliedModifications,
      // Variations already have data, skip extraction and go to enrichment
      enrichmentStatus: "enriching",
      imageGenerationStatus: "pending",
    });

    // Queue enrichment job only - image generation will be queued after enrichment completes
    jobQueue.addEnrichmentJob(newRecipe.id);

    console.log(`[Make Your Own] Created variation "${variation.title}" (${newRecipe.id}) from "${originalRecipe.title}" (${id}), queued for lightweight enrichment`);

    res.status(201).json({
      id: newRecipe.id,
      title: newRecipe.title,
      variationNotes: variation.variationNotes,
      appliedModifications: variation.appliedModifications,
    });
  } catch (error: any) {
    console.error("Error creating recipe variation:", error);
    res.status(500).json({ error: error.message || "Failed to create recipe variation" });
  }
});

export default router;
