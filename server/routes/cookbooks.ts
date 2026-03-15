import { Router } from "express";
import { z } from "zod";
import { isAuthenticated, optionalAuth } from "../clerkAuth";
import { storage } from "../storage";
import { db } from "../db";
import { eq, inArray } from "drizzle-orm";
import {
  insertCookbookSchema,
  printLayoutDataSchema,
  recipes,
  cookbooks,
} from "@shared/schema";
import { generateInteriorPdf, generateCoverPdf, type CookbookPrintData } from "../lib/pdf/generator";
import { transformRecipe } from "../lib/pdf/recipe-transformer";
import { buildPodPackageId, BINDING_PAGE_LIMITS } from "../lib/lulu/pod-package";
import { createPrintJob } from "../lib/lulu/client";
import type { BookConfig, LuluPrintJobRequest, ShippingLevel } from "../lib/lulu/types";
import { getUserId, upload, storePdf } from "./route-utils";

const router = Router();

router.get("/cookbooks", optionalAuth, async (req: any, res) => {
  try {
    const userId = getUserId(req);
    const scope = req.query.scope as string;
    let cookbooksList;

    if (scope === 'public') {
      cookbooksList = await storage.getPublicCookbooks();
    } else if (scope === 'following') {
      if (!userId) return res.status(401).json({ error: "Unauthorized" });
      cookbooksList = await storage.getFollowedCookbooks(userId);
    } else {
      if (!userId) return res.status(401).json({ error: "Unauthorized" });
      cookbooksList = await storage.getUserCookbooks(userId);
    }

    // Deduplicate by cookbook ID to prevent duplicates in dropdown
    const uniqueCookbooks = Array.from(
      new Map(cookbooksList.map(cookbook => [cookbook.id, cookbook])).values()
    );

    res.json(uniqueCookbooks);
  } catch (error) {
    console.error("Error fetching cookbooks:", error);
    res.status(500).json({ error: "Failed to fetch cookbooks" });
  }
});

// Get IDs of cookbooks the user is following (for quick UI lookup)
router.get("/cookbooks/following/ids", isAuthenticated, async (req: any, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const followedCookbooks = await storage.getFollowedCookbooks(userId);
    const ids = followedCookbooks.map(c => c.id);
    res.json(ids);
  } catch (error) {
    console.error("Error fetching followed cookbook IDs:", error);
    res.status(500).json({ error: "Failed to fetch followed cookbook IDs" });
  }
});

router.get("/cookbooks/:id", optionalAuth, async (req: any, res) => {
  try {
    const { id } = req.params;
    const userId = getUserId(req);
    const cookbook = await storage.getCookbook(Number(id), userId);
    if (!cookbook) return res.status(404).json({ error: "Cookbook not found" });
    res.json(cookbook);
  } catch (error) {
    console.error("Error fetching cookbook:", error);
    res.status(500).json({ error: "Failed to fetch cookbook" });
  }
});

router.post("/cookbooks", isAuthenticated, async (req: any, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const validated = insertCookbookSchema.parse({ ...req.body, ownerUserId: userId });
    const cookbook = await storage.createCookbook(validated);
    res.status(201).json(cookbook);
  } catch (error) {
    console.error("Error creating cookbook:", error);
    res.status(400).json({ error: "Invalid cookbook data" });
  }
});

router.patch("/cookbooks/:id", isAuthenticated, async (req: any, res) => {
  try {
    const { id } = req.params;
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const updates = insertCookbookSchema.partial().parse(req.body);
    const cookbook = await storage.updateCookbook(Number(id), updates, userId);
    if (!cookbook) return res.status(404).json({ error: "Cookbook not found or unauthorized" });
    res.json(cookbook);
  } catch (error) {
    console.error("Error updating cookbook:", error);
    res.status(400).json({ error: "Invalid update data" });
  }
});

router.delete("/cookbooks/:id", isAuthenticated, async (req: any, res) => {
  try {
    const { id } = req.params;
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const deleted = await storage.deleteCookbook(Number(id), userId);
    if (!deleted) return res.status(404).json({ error: "Cookbook not found or unauthorized" });
    res.status(204).send();
  } catch (error) {
    console.error("Error deleting cookbook:", error);
    res.status(500).json({ error: "Failed to delete cookbook" });
  }
});

// Upload cookbook cover image
router.post("/cookbooks/:id/cover-image", isAuthenticated, upload.single('image'), async (req: any, res) => {
  try {
    const { id } = req.params;
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const cookbook = await storage.getCookbook(Number(id), userId);
    if (!cookbook || cookbook.ownerUserId !== userId) {
      return res.status(403).json({ error: "Not authorized to modify this cookbook" });
    }

    if (!req.file) {
      return res.status(400).json({ error: "No image file provided" });
    }

    const mimeType = req.file.mimetype;
    const base64 = req.file.buffer.toString('base64');
    const coverImage = `data:${mimeType};base64,${base64}`;

    const updated = await storage.updateCookbook(Number(id), { coverImage }, userId);
    if (!updated) {
      return res.status(500).json({ error: "Failed to update cookbook" });
    }

    res.json({ success: true, coverImage });
  } catch (error) {
    console.error("Error uploading cookbook cover image:", error);
    res.status(500).json({ error: "Failed to upload cover image" });
  }
});

// Generate cookbook cover image with AI
router.post("/cookbooks/:id/generate-cover", isAuthenticated, async (req: any, res) => {
  try {
    const { id } = req.params;
    const { prompt } = req.body;
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const cookbook = await storage.getCookbook(Number(id), userId);
    if (!cookbook || cookbook.ownerUserId !== userId) {
      return res.status(403).json({ error: "Not authorized to modify this cookbook" });
    }

    const cookbookRecipes = await storage.getCookbookRecipes(Number(id));
    const recipeNames = cookbookRecipes.slice(0, 10).map(r => r.title).join(", ");

    const imagePrompt = prompt ||
      `A beautiful cookbook cover for "${cookbook.name}". ${cookbook.description ? cookbook.description : ''} ` +
      `Features recipes like: ${recipeNames || 'various delicious dishes'}. ` +
      `Professional food photography style, warm lighting, appetizing presentation, ` +
      `elegant cookbook aesthetic, high-quality culinary imagery.`;

    console.log(`[Cookbook Cover] Generating cover image for cookbook ${id}: "${cookbook.name}"`);

    const { generateRecipeImageUnified } = await import("../ai-service");
    const imageResult = await generateRecipeImageUnified(imagePrompt, [], [], []);

    if (!imageResult.imageBuffer) {
      console.error("[Cookbook Cover] Image generation failed");
      return res.status(500).json({ error: "Failed to generate cover image" });
    }

    const coverImage = `data:image/${imageResult.format || 'png'};base64,${imageResult.imageBuffer.toString('base64')}`;

    const updated = await storage.updateCookbook(Number(id), { coverImage }, userId);
    if (!updated) {
      return res.status(500).json({ error: "Failed to save cover image" });
    }

    console.log(`[Cookbook Cover] Successfully generated cover for cookbook ${id}`);
    res.json({ success: true, coverImage });
  } catch (error) {
    console.error("Error generating cookbook cover image:", error);
    res.status(500).json({ error: "Failed to generate cover image" });
  }
});

// Delete cookbook cover image
router.delete("/cookbooks/:id/cover-image", isAuthenticated, async (req: any, res) => {
  try {
    const { id } = req.params;
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const cookbook = await storage.getCookbook(Number(id), userId);
    if (!cookbook || cookbook.ownerUserId !== userId) {
      return res.status(403).json({ error: "Not authorized to modify this cookbook" });
    }

    const updated = await storage.updateCookbook(Number(id), { coverImage: null }, userId);
    if (!updated) {
      return res.status(500).json({ error: "Failed to remove cover image" });
    }

    res.json({ success: true });
  } catch (error) {
    console.error("Error removing cookbook cover image:", error);
    res.status(500).json({ error: "Failed to remove cover image" });
  }
});

router.get("/cookbooks/:id/recipes", optionalAuth, async (req: any, res) => {
  try {
    const { id } = req.params;
    const { page = "1", limit = "24" } = req.query;
    const userId = getUserId(req);

    const cookbook = await storage.getCookbook(Number(id), userId);
    if (!cookbook) {
      return res.status(404).json({ error: "Cookbook not found or not accessible" });
    }

    const result = await storage.getCookbookRecipesPaginated(
      Number(id),
      Number(page),
      Number(limit)
    );

    res.json(result);
  } catch (error) {
    console.error("Error fetching cookbook recipes:", error);
    res.status(500).json({ error: "Failed to fetch cookbook recipes" });
  }
});

router.post("/cookbooks/:id/recipes", isAuthenticated, async (req: any, res) => {
  try {
    const { id } = req.params;
    const { recipeId } = req.body;
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const [cookbook] = await db.select().from(cookbooks).where(eq(cookbooks.id, Number(id)));
    if (!cookbook || cookbook.ownerUserId !== userId) {
      return res.status(403).json({ error: "Not authorized to modify this cookbook" });
    }

    await storage.addRecipeToCookbook(Number(id), recipeId);
    res.status(201).json({ message: "Recipe added to cookbook" });
  } catch (error) {
    console.error("Error adding recipe to cookbook:", error);
    res.status(400).json({ error: "Failed to add recipe" });
  }
});

router.delete("/cookbooks/:id/recipes/:recipeId", isAuthenticated, async (req: any, res) => {
  try {
    const { id, recipeId } = req.params;
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const [cookbook] = await db.select().from(cookbooks).where(eq(cookbooks.id, Number(id)));
    if (!cookbook || cookbook.ownerUserId !== userId) {
      return res.status(403).json({ error: "Not authorized to modify this cookbook" });
    }

    await storage.removeRecipeFromCookbook(Number(id), recipeId);
    res.status(204).send();
  } catch (error) {
    console.error("Error removing recipe from cookbook:", error);
    res.status(500).json({ error: "Failed to remove recipe" });
  }
});

router.get("/cookbooks/:id/recipes/print", optionalAuth, async (req: any, res) => {
  try {
    const { id } = req.params;
    const userId = getUserId(req);

    const cookbook = await storage.getCookbook(Number(id), userId);
    if (!cookbook) {
      return res.status(404).json({ error: "Cookbook not found or not accessible" });
    }

    const fullRecipes = await storage.getCookbookRecipesForPrint(Number(id));
    res.json({ recipes: fullRecipes });
  } catch (error) {
    console.error("Error fetching cookbook recipes for print:", error);
    res.status(500).json({ error: "Failed to fetch recipes for printing" });
  }
});

// ============================================================================
// FOLLOWING ROUTES
// ============================================================================

router.post("/cookbooks/:id/follow", isAuthenticated, async (req: any, res) => {
  try {
    const { id } = req.params;
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const cookbook = await storage.getCookbook(Number(id), userId);
    if (!cookbook) {
      return res.status(404).json({ error: "Cookbook not found" });
    }
    if (!cookbook.isPublic) {
      return res.status(403).json({ error: "Cannot follow private cookbook" });
    }

    await storage.followCookbook(Number(id), userId);
    res.status(201).json({ message: "Cookbook followed successfully" });
  } catch (error) {
    console.error("Error following cookbook:", error);
    res.status(400).json({ error: "Failed to follow cookbook" });
  }
});

router.delete("/cookbooks/:id/follow", isAuthenticated, async (req: any, res) => {
  try {
    const { id } = req.params;
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    await storage.unfollowCookbook(Number(id), userId);
    res.status(204).send();
  } catch (error) {
    console.error("Error unfollowing cookbook:", error);
    res.status(500).json({ error: "Failed to unfollow cookbook" });
  }
});

router.get("/cookbooks/:id/followers", optionalAuth, async (req: any, res) => {
  try {
    const { id } = req.params;
    const userId = getUserId(req);

    const cookbook = await storage.getCookbook(Number(id), userId);
    if (!cookbook) {
      return res.status(404).json({ error: "Cookbook not found" });
    }

    if (!cookbook.isPublic && cookbook.ownerUserId !== userId) {
      return res.status(403).json({ error: "Not authorized to view followers" });
    }

    const followers = await storage.getCookbookFollowers(Number(id));
    res.json(followers);
  } catch (error) {
    console.error("Error fetching followers:", error);
    res.status(500).json({ error: "Failed to fetch followers" });
  }
});

// ============================================================================
// COOKBOOK COLLABORATION
// ============================================================================

router.get("/cookbooks/:id/collaborators", isAuthenticated, async (req: any, res) => {
  try {
    const { id } = req.params;
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const cookbook = await storage.getCookbook(Number(id), userId);
    if (!cookbook) {
      return res.status(404).json({ error: "Cookbook not found" });
    }

    const canView = cookbook.ownerUserId === userId ||
      await storage.isCookbookCollaborator(Number(id), userId);

    if (!canView) {
      return res.status(403).json({ error: "Not authorized to view collaborators" });
    }

    const collaborators = await storage.getCookbookCollaborators(Number(id));
    res.json(collaborators);
  } catch (error) {
    console.error("Error fetching collaborators:", error);
    res.status(500).json({ error: "Failed to fetch collaborators" });
  }
});

router.delete("/cookbooks/:id/collaborators/:userId", isAuthenticated, async (req: any, res) => {
  try {
    const { id, userId: targetUserId } = req.params;
    const requesterId = getUserId(req);
    if (!requesterId) return res.status(401).json({ error: "Unauthorized" });

    const removed = await storage.removeCookbookCollaborator(Number(id), targetUserId, requesterId);

    if (!removed) {
      return res.status(403).json({ error: "Not authorized to remove this collaborator" });
    }

    res.status(204).send();
  } catch (error) {
    console.error("Error removing collaborator:", error);
    res.status(500).json({ error: "Failed to remove collaborator" });
  }
});

router.get("/cookbooks/:id/can-edit", isAuthenticated, async (req: any, res) => {
  try {
    const { id } = req.params;
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const canEdit = await storage.canEditCookbook(Number(id), userId);
    res.json({ canEdit });
  } catch (error) {
    console.error("Error checking edit permission:", error);
    res.status(500).json({ error: "Failed to check permission" });
  }
});

// ============================================================================
// COOKBOOK INVITATIONS
// ============================================================================

router.get("/cookbooks/:id/invitations", isAuthenticated, async (req: any, res) => {
  try {
    const { id } = req.params;
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const cookbook = await storage.getCookbook(Number(id), userId);
    if (!cookbook) {
      return res.status(404).json({ error: "Cookbook not found" });
    }

    if (cookbook.ownerUserId !== userId) {
      return res.status(403).json({ error: "Only cookbook owner can view invitations" });
    }

    const invitations = await storage.getCookbookInvitations(Number(id));
    res.json(invitations);
  } catch (error) {
    console.error("Error fetching invitations:", error);
    res.status(500).json({ error: "Failed to fetch invitations" });
  }
});

router.post("/cookbooks/:id/invitations", isAuthenticated, async (req: any, res) => {
  try {
    const { id } = req.params;
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const cookbook = await storage.getCookbook(Number(id), userId);
    if (!cookbook) {
      return res.status(404).json({ error: "Cookbook not found" });
    }

    if (cookbook.ownerUserId !== userId) {
      return res.status(403).json({ error: "Only cookbook owner can invite collaborators" });
    }

    const { email, message } = req.body;

    if (!email || typeof email !== 'string') {
      return res.status(400).json({ error: "Email is required" });
    }

    const inviteeUser = await storage.findUserByEmailOrUsername(email);

    const token = `inv_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    const invitation = await storage.createCookbookInvitation({
      cookbookId: Number(id),
      inviterUserId: userId,
      inviteeEmail: email,
      inviteeUserId: inviteeUser?.id || null,
      token,
      message: message || null,
      expiresAt,
    });

    res.status(201).json(invitation);
  } catch (error) {
    console.error("Error creating invitation:", error);
    res.status(500).json({ error: "Failed to create invitation" });
  }
});

router.delete("/cookbooks/:id/invitations/:invitationId", isAuthenticated, async (req: any, res) => {
  try {
    const { invitationId } = req.params;
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const cancelled = await storage.cancelCookbookInvitation(Number(invitationId), userId);

    if (!cancelled) {
      return res.status(403).json({ error: "Not authorized to cancel this invitation" });
    }

    res.status(204).send();
  } catch (error) {
    console.error("Error cancelling invitation:", error);
    res.status(500).json({ error: "Failed to cancel invitation" });
  }
});

// ============================================================================
// COOKBOOK PRINT PROJECTS
// ============================================================================

router.post("/cookbooks/:id/print-projects", isAuthenticated, async (req: any, res) => {
  try {
    const { id } = req.params;
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const cookbook = await storage.getCookbook(Number(id), userId);
    if (!cookbook) {
      return res.status(404).json({ error: "Cookbook not found" });
    }
    if (cookbook.ownerUserId !== userId) {
      return res.status(403).json({ error: "Not authorized to create print project for this cookbook" });
    }

    const { layoutData, templateStyle } = req.body;

    const validatedLayout = printLayoutDataSchema.parse(layoutData || { sections: [] });

    const validStyles = ['classic', 'modern', 'rustic', 'elegant'] as const;
    const validTemplateStyle = validStyles.includes(templateStyle) ? templateStyle : 'classic';

    const project = await storage.createPrintProject({
      cookbookId: Number(id),
      ownerUserId: userId,
      layoutData: validatedLayout,
      templateStyle: validTemplateStyle,
    });

    res.status(201).json(project);
  } catch (error: any) {
    console.error("Error creating print project:", error);
    if (error.name === 'ZodError') {
      return res.status(400).json({ error: "Invalid layout data", details: error.errors });
    }
    res.status(500).json({ error: "Failed to create print project" });
  }
});

router.get("/cookbooks/:id/print-projects", isAuthenticated, async (req: any, res) => {
  try {
    const { id } = req.params;
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const cookbook = await storage.getCookbook(Number(id), userId);
    if (!cookbook) {
      return res.status(404).json({ error: "Cookbook not found" });
    }
    if (cookbook.ownerUserId !== userId) {
      return res.status(403).json({ error: "Not authorized to view print projects for this cookbook" });
    }

    const projects = await storage.getPrintProjectsByCookbook(Number(id), userId);
    res.json(projects);
  } catch (error) {
    console.error("Error fetching print projects:", error);
    res.status(500).json({ error: "Failed to fetch print projects" });
  }
});

router.get("/print-projects", isAuthenticated, async (req: any, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const projects = await storage.getPrintProjectsByUser(userId);
    res.json(projects);
  } catch (error) {
    console.error("Error fetching print projects:", error);
    res.status(500).json({ error: "Failed to fetch print projects" });
  }
});

router.get("/print-projects/:projectId", isAuthenticated, async (req: any, res) => {
  try {
    const { projectId } = req.params;
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const project = await storage.getPrintProject(Number(projectId), userId);
    if (!project) {
      return res.status(404).json({ error: "Print project not found" });
    }

    res.json(project);
  } catch (error) {
    console.error("Error fetching print project:", error);
    res.status(500).json({ error: "Failed to fetch print project" });
  }
});

router.patch("/print-projects/:projectId", isAuthenticated, async (req: any, res) => {
  try {
    const { projectId } = req.params;
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const { layoutData, templateStyle } = req.body;
    const updates: any = {};

    if (layoutData !== undefined) {
      updates.layoutData = printLayoutDataSchema.parse(layoutData);
    }

    if (templateStyle !== undefined) {
      const validStyles = ['classic', 'modern', 'rustic', 'elegant'] as const;
      if (!validStyles.includes(templateStyle)) {
        return res.status(400).json({ error: "Invalid template style" });
      }
      updates.templateStyle = templateStyle;
    }

    const project = await storage.updatePrintProject(Number(projectId), updates, userId);
    if (!project) {
      return res.status(404).json({ error: "Print project not found" });
    }

    res.json(project);
  } catch (error: any) {
    console.error("Error updating print project:", error);
    if (error.name === 'ZodError') {
      return res.status(400).json({ error: "Invalid layout data", details: error.errors });
    }
    res.status(500).json({ error: "Failed to update print project" });
  }
});

router.delete("/print-projects/:projectId", isAuthenticated, async (req: any, res) => {
  try {
    const { projectId } = req.params;
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    await storage.deletePrintProject(Number(projectId), userId);
    res.status(204).send();
  } catch (error) {
    console.error("Error deleting print project:", error);
    res.status(500).json({ error: "Failed to delete print project" });
  }
});

// ============================================================================
// PRINT PREFLIGHT CHECK
// ============================================================================

router.post("/cookbooks/:id/preflight", isAuthenticated, async (req: any, res) => {
  try {
    const { id } = req.params;
    const cookbookId = parseInt(id);
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const { layoutData, templateStyle } = req.body;

    if (!layoutData || !layoutData.sections) {
      return res.status(400).json({ error: "Layout data is required" });
    }

    const cookbook = await storage.getCookbook(cookbookId, userId);
    if (!cookbook || cookbook.ownerUserId !== userId) {
      return res.status(403).json({ error: "Access denied" });
    }

    // Get all recipe IDs from sections
    const allRecipeIds: string[] = [];
    for (const section of layoutData.sections) {
      if (section.recipeIds && Array.isArray(section.recipeIds)) {
        allRecipeIds.push(...section.recipeIds);
      }
    }

    if (allRecipeIds.length === 0) {
      return res.json({
        status: 'error',
        message: 'No recipes in project',
        issues: [{ type: 'error', category: 'content', message: 'Add at least one recipe to your cookbook' }],
        stats: { totalRecipes: 0, estimatedPages: 0, recipesWithImages: 0, recipesWithoutImages: 0 }
      });
    }

    // Fetch all recipes with full data including images
    const recipesList = await Promise.all(
      allRecipeIds.map(id => storage.getRecipe(id, userId))
    );
    const validRecipes = recipesList.filter(Boolean);

    const issues: Array<{ type: 'error' | 'warning' | 'info'; category: string; message: string; recipeId?: string; recipeName?: string }> = [];

    let recipesWithImages = 0;
    let recipesWithoutImages = 0;
    let lowQualityImages = 0;

    for (const recipe of validRecipes) {
      if (!recipe) continue;

      if (recipe.dishImage) {
        recipesWithImages++;

        if (recipe.dishImage.startsWith('data:image')) {
          const base64Length = recipe.dishImage.length - recipe.dishImage.indexOf(',') - 1;
          const estimatedBytes = (base64Length * 3) / 4;
          const estimatedKB = Math.round(estimatedBytes / 1024);

          if (estimatedKB < 100) {
            lowQualityImages++;
            issues.push({
              type: 'warning',
              category: 'image',
              message: `Image may be too small for print (${estimatedKB}KB) - recommend regenerating`,
              recipeId: recipe.id,
              recipeName: recipe.title
            });
          }
        } else if (recipe.dishImage.startsWith('http')) {
          issues.push({
            type: 'info',
            category: 'image',
            message: 'External image URL - quality cannot be verified',
            recipeId: recipe.id,
            recipeName: recipe.title
          });
        }
      } else {
        recipesWithoutImages++;
        issues.push({
          type: 'warning',
          category: 'image',
          message: 'No dish image - a placeholder will be used',
          recipeId: recipe.id,
          recipeName: recipe.title
        });
      }

      if (!recipe.title || recipe.title.trim() === '') {
        issues.push({ type: 'error', category: 'content', message: 'Recipe is missing a title', recipeId: recipe.id, recipeName: recipe.title || 'Untitled' });
      }

      if (!recipe.instructions || recipe.instructions.length === 0) {
        issues.push({ type: 'warning', category: 'content', message: 'Recipe has no instructions', recipeId: recipe.id, recipeName: recipe.title });
      }

      if (!recipe.ingredients || recipe.ingredients.length === 0) {
        issues.push({ type: 'warning', category: 'content', message: 'Recipe has no ingredients', recipeId: recipe.id, recipeName: recipe.title });
      }

      if ((recipe as any).status === 'pending' || (recipe as any).status === 'processing') {
        issues.push({ type: 'warning', category: 'status', message: 'Recipe is still processing - wait for completion', recipeId: recipe.id, recipeName: recipe.title });
      }

      if ((recipe as any).status === 'failed') {
        issues.push({ type: 'error', category: 'status', message: 'Recipe processing failed - re-enrich or remove', recipeId: recipe.id, recipeName: recipe.title });
      }
    }

    if (!layoutData.title || layoutData.title.trim() === '') {
      issues.push({ type: 'info', category: 'layout', message: 'Consider adding a title for your cookbook cover' });
    }

    if (!layoutData.authorName || layoutData.authorName.trim() === '') {
      issues.push({ type: 'info', category: 'layout', message: 'Consider adding an author name' });
    }

    const emptySections = layoutData.sections.filter((s: any) => !s.recipeIds || s.recipeIds.length === 0);
    if (emptySections.length > 0) {
      issues.push({ type: 'warning', category: 'layout', message: `${emptySections.length} empty section(s) will appear blank in print` });
    }

    const pageSize = layoutData.customizations?.pageSize || '6x9';

    let pagesPerRecipe: number;
    let minPages: number;
    let maxPages: number;

    switch (pageSize) {
      case '6x9':
        pagesPerRecipe = 2.5;
        minPages = 24;
        maxPages = 800;
        break;
      case '8.5x11':
        pagesPerRecipe = 2;
        minPages = 24;
        maxPages = 600;
        break;
      case 'a4':
        pagesPerRecipe = 2;
        minPages = 24;
        maxPages = 600;
        break;
      default:
        pagesPerRecipe = 2;
        minPages = 24;
        maxPages = 600;
    }

    const frontMatterPages = 4;
    const sectionDividerPages = layoutData.sections.length;
    const estimatedPages = Math.ceil(validRecipes.length * pagesPerRecipe + frontMatterPages + sectionDividerPages);

    if (estimatedPages > maxPages) {
      issues.push({ type: 'error', category: 'pages', message: `Estimated ${estimatedPages} pages exceeds maximum ${maxPages} for ${pageSize} format - split into volumes` });
    } else if (estimatedPages > maxPages * 0.9) {
      issues.push({ type: 'warning', category: 'pages', message: `Estimated ${estimatedPages} pages is near the ${maxPages} page limit` });
    }

    if (estimatedPages < minPages) {
      issues.push({ type: 'warning', category: 'pages', message: `Estimated ${estimatedPages} pages - print services require minimum ${minPages} pages. Add more recipes or content.` });
    }

    issues.push({ type: 'info', category: 'bleed', message: `Using ${pageSize} format with 0.5" safety margins for print binding` });

    const hasErrors = issues.some(i => i.type === 'error');
    const hasWarnings = issues.some(i => i.type === 'warning');
    let status: 'ready' | 'warnings' | 'error' = 'ready';
    if (hasErrors) status = 'error';
    else if (hasWarnings) status = 'warnings';

    res.json({
      status,
      message: status === 'ready'
        ? 'Your cookbook is ready for printing!'
        : status === 'warnings'
          ? 'Your cookbook has some issues to review'
          : 'Your cookbook has errors that need to be fixed',
      issues,
      stats: {
        totalRecipes: validRecipes.length,
        estimatedPages,
        recipesWithImages,
        recipesWithoutImages,
        lowQualityImages,
        pageSize,
        templateStyle: templateStyle || 'classic',
        minPages,
        maxPages
      }
    });
  } catch (error) {
    console.error("Error running preflight check:", error);
    res.status(500).json({ error: "Failed to run preflight check" });
  }
});

// Generate PDF for cookbook print project
router.post("/cookbooks/:id/generate-pdf", isAuthenticated, async (req: any, res) => {
  try {
    const { id } = req.params;
    const cookbookId = parseInt(id);
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const cookbook = await storage.getCookbook(cookbookId);
    if (!cookbook) return res.status(404).json({ error: "Cookbook not found" });
    if (cookbook.ownerUserId !== userId) {
      return res.status(403).json({ error: "Not authorized to generate PDF for this cookbook" });
    }

    const { layoutData, templateStyle } = req.body;

    const validatedLayout = printLayoutDataSchema.safeParse(layoutData);
    if (!validatedLayout.success) {
      return res.status(400).json({ error: "Invalid layout data", details: validatedLayout.error.issues });
    }

    const allRecipeIds = validatedLayout.data.sections
      .flatMap(s => Array.isArray(s.recipeIds) ? s.recipeIds : [])
      .filter((rid): rid is string => typeof rid === 'string' && rid.length > 0);

    if (allRecipeIds.length === 0) {
      return res.status(400).json({ error: "No recipes in layout" });
    }

    // Fetch full recipe data for transformation
    const recipesResult = await db.select()
      .from(recipes)
      .where(inArray(recipes.id, allRecipeIds));

    if (recipesResult.length === 0) {
      return res.status(400).json({ error: "No recipes found in database for this layout" });
    }

    // Get print project for specs (or use defaults)
    const printProjects = await storage.getPrintProjectsByCookbook(cookbookId, userId);
    const printProject = printProjects[0];

    const trimSize = printProject?.trimSize || '0600X0900';
    const bindingType = printProject?.bindingType || 'PB';
    const paperType = printProject?.paperType || '080CW444';
    const templateId = printProject?.templateStyle || templateStyle || 'classic';
    const recipePrintSettings = validatedLayout.data.recipePrintSettings || {};

    // Build cookbook print data using recipe transformer
    const cookbookPrintData: CookbookPrintData = {
      title: validatedLayout.data.title || cookbook.name,
      subtitle: validatedLayout.data.subtitle,
      authorName: validatedLayout.data.authorName || 'Unknown',
      templateId,
      trimSize,
      bindingType,
      paperType,
      sections: validatedLayout.data.sections.map((s, i) => ({
        id: s.id,
        title: s.title,
        sortOrder: i,
      })),
      recipes: validatedLayout.data.sections.flatMap((section, sIdx) =>
        (section.recipeIds || []).map((recipeId, rIdx) => {
          const recipeData = recipesResult.find(r => r.id === recipeId);
          if (!recipeData) return null;
          const settings = recipePrintSettings[recipeId];
          return {
            sectionId: section.id,
            sortOrder: rIdx,
            layoutOverride: settings?.layoutOverride,
            data: transformRecipe(recipeData),
          };
        }).filter(Boolean)
      ) as CookbookPrintData['recipes'],
      coverData: validatedLayout.data.coverData,
    };

    console.log(`[PDF Generation] Starting PDF generation for cookbook ${cookbookId} with ${cookbookPrintData.recipes.length} recipes`);

    const result = await generateInteriorPdf(cookbookPrintData);

    console.log(`[PDF Generation] Success - ${result.pageCount} pages generated`);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${(validatedLayout.data.title || 'cookbook').replace(/[^a-zA-Z0-9]/g, '_')}.pdf"`);
    res.setHeader('Content-Length', result.buffer.length);
    res.send(result.buffer);
  } catch (error) {
    console.error("Error generating PDF:", error);
    res.status(500).json({ error: "Failed to generate PDF" });
  }
});

// Create a print job order (auto-generates PDFs)
router.post("/cookbooks/:id/print-order", isAuthenticated, async (req: any, res) => {
  try {
    const { id } = req.params;
    const cookbookId = parseInt(id);
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    if (!process.env.LULU_CLIENT_ID || !process.env.LULU_CLIENT_SECRET) {
      return res.status(503).json({
        error: "Lulu Print API not configured",
        message: "Please set LULU_CLIENT_ID and LULU_CLIENT_SECRET environment variables."
      });
    }

    const cookbook = await storage.getCookbook(cookbookId);
    if (!cookbook) return res.status(404).json({ error: "Cookbook not found" });
    if (cookbook.ownerUserId !== userId) {
      return res.status(403).json({ error: "Not authorized to order prints for this cookbook" });
    }

    const {
      layoutData,
      quantity,
      shippingAddress,
      shippingLevel,
    } = req.body;

    if (!layoutData) {
      return res.status(400).json({ error: "Layout data is required" });
    }
    const validatedLayout = printLayoutDataSchema.safeParse(layoutData);
    if (!validatedLayout.success) {
      return res.status(400).json({ error: "Invalid layout data", details: validatedLayout.error.issues });
    }

    const allRecipeIds = validatedLayout.data.sections
      .flatMap(s => Array.isArray(s.recipeIds) ? s.recipeIds : [])
      .filter((rid): rid is string => typeof rid === 'string' && rid.length > 0);

    if (allRecipeIds.length === 0) {
      return res.status(400).json({ error: "No recipes in layout" });
    }

    // Fetch full recipe data
    const recipesResult = await db.select()
      .from(recipes)
      .where(inArray(recipes.id, allRecipeIds));

    if (recipesResult.length === 0) {
      return res.status(400).json({ error: "No recipes found in database for this layout" });
    }

    // Get print project for specs
    const printProjects = await storage.getPrintProjectsByCookbook(cookbookId, userId);
    const printProject = printProjects[0];

    const trimSize = printProject?.trimSize || '0600X0900';
    const bindingType = printProject?.bindingType || 'PB';
    const paperType = printProject?.paperType || '080CW444';
    const colorType = printProject?.colorType || 'FC';
    const coverFinishVal = printProject?.coverFinish || 'M';
    const templateId = printProject?.templateStyle || 'classic';
    const recipePrintSettings = validatedLayout.data.recipePrintSettings || {};

    // Build cookbook print data
    const cookbookPrintData: CookbookPrintData = {
      title: validatedLayout.data.title || cookbook.name,
      subtitle: validatedLayout.data.subtitle,
      authorName: validatedLayout.data.authorName || 'Unknown',
      templateId,
      trimSize,
      bindingType,
      paperType,
      sections: validatedLayout.data.sections.map((s, i) => ({
        id: s.id,
        title: s.title,
        sortOrder: i,
      })),
      recipes: validatedLayout.data.sections.flatMap((section, sIdx) =>
        (section.recipeIds || []).map((recipeId, rIdx) => {
          const recipeData = recipesResult.find(r => r.id === recipeId);
          if (!recipeData) return null;
          const settings = recipePrintSettings[recipeId];
          return {
            sectionId: section.id,
            sortOrder: rIdx,
            layoutOverride: settings?.layoutOverride,
            data: transformRecipe(recipeData),
          };
        }).filter(Boolean)
      ) as CookbookPrintData['recipes'],
      coverData: validatedLayout.data.coverData,
    };

    console.log(`[Print Order] Generating PDF for cookbook ${cookbookId} with ${cookbookPrintData.recipes.length} recipes`);

    // Generate interior PDF
    const pdfResult = await generateInteriorPdf(cookbookPrintData);

    // Validate page count
    const limits = BINDING_PAGE_LIMITS[bindingType] || { min: 32, max: 800 };
    if (pdfResult.pageCount > limits.max) {
      return res.status(400).json({
        error: `Cookbook has ${pdfResult.pageCount} pages but maximum is ${limits.max} for this binding type. Please reduce the number of recipes.`
      });
    }

    const pageCount = Math.max(limits.min, pdfResult.pageCount);
    console.log(`[Print Order] Interior PDF generated with ${pageCount} pages`);

    const safeTitle = (validatedLayout.data.title || 'cookbook').replace(/[^a-zA-Z0-9]/g, '_');
    const interiorPdfId = storePdf(pdfResult.buffer, `${safeTitle}_interior.pdf`);

    // Generate cover PDF
    console.log(`[Print Order] Generating cover PDF for ${pageCount} pages`);
    const coverBuffer = await generateCoverPdf(cookbookPrintData, pageCount);
    const coverPdfId = storePdf(coverBuffer, `${safeTitle}_cover.pdf`);
    console.log(`[Print Order] Cover PDF generated successfully`);

    const protocol = req.protocol === 'http' && req.get('host')?.includes('repl') ? 'https' : req.protocol;
    const baseUrl = `${protocol}://${req.get('host')}`;
    const interiorUrl = `${baseUrl}/lulu/pdfs/${interiorPdfId}`;
    const coverUrl = `${baseUrl}/lulu/pdfs/${coverPdfId}`;

    console.log(`[Print Order] PDFs staged at: interior=${interiorUrl}, cover=${coverUrl}`);

    // Build POD package ID from print project specs
    const bookConfig: BookConfig = {
      trimSize: trimSize as BookConfig['trimSize'],
      colorType: colorType as BookConfig['colorType'],
      printQuality: 'STD',
      bindingType: bindingType as BookConfig['bindingType'],
      paperType: paperType as BookConfig['paperType'],
      coverFinish: coverFinishVal as BookConfig['coverFinish'],
      linenColor: 'X',
      foilType: 'X',
    };
    const podPackageId = buildPodPackageId(bookConfig);

    const externalId = `cookbook-${cookbookId}-${Date.now()}`;

    const orderRequest: LuluPrintJobRequest = {
      contact_email: shippingAddress.email || '',
      line_items: [{
        title: cookbook.name,
        cover: coverUrl,
        interior: interiorUrl,
        pod_package_id: podPackageId,
        quantity: quantity || 1,
      }],
      shipping_address: shippingAddress,
      shipping_level: (shippingLevel || 'GROUND') as ShippingLevel,
      external_id: externalId,
    };

    const order = await createPrintJob(orderRequest);

    if (printProjects.length > 0) {
      await storage.updatePrintProjectLuluOrder(printProjects[0].id, String(order.id), order.status.name);
    }

    res.json({
      success: true,
      orderId: order.id,
      status: order.status.name,
      message: "Print order submitted successfully",
      podPackageId,
      pdfUrls: { interior: interiorUrl, cover: coverUrl },
    });
  } catch (error: any) {
    console.error("Error creating print order:", error);
    res.status(500).json({ error: error.message || "Failed to create print order" });
  }
});

export default router;
