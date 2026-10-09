import { attachOriginalCards, originalCardJpeg } from "../lib/original-card";
import { Router } from "express";
import { parseFiltersFromQuery } from "./filter-parser";
import { z } from "zod";
import { isAuthenticated, optionalAuth } from "../clerkAuth";
import { storage } from "../storage";
import { db } from "../db";
import { eq, and, inArray, isNotNull, getTableColumns, sql } from "drizzle-orm";
import {
  insertCookbookSchema,
  printLayoutDataSchema,
  recipes,
  cookbooks,
  cookbookRecipes,
  cookbookPhotos,
  type PrintLayoutData,
} from "@shared/schema";
import { CHAPTERS, chapterForTags, buildCoursePlan } from "@shared/courses";
import { normalizeUsState } from "@shared/us-states";
import { validateAddress, estimateArrival } from "@shared/print-checkout";
import { checkReadiness, type RecipePrintFacts } from "@shared/print-readiness";
import { isGeminiAvailable, parseQueryWithGemini } from "../gemini";
import { generateInteriorPdf, generateCoverPdf, measureRecipeGaps, type CookbookPrintData } from "../lib/pdf/generator";
import { planFamilyPhotos } from "@shared/family-photos";
import { transformRecipe } from "../lib/pdf/recipe-transformer";
import { buildPodPackageId, BINDING_PAGE_LIMITS, BINDING_PAPER_COMPATIBILITY } from "../lib/lulu/pod-package";
import { BOOK_SIZES as LULU_BOOK_SIZES } from "../lib/lulu/book-sizes";
import { createPrintJob } from "../lib/lulu/client";
import type { BookConfig, LuluPrintJobRequest, ShippingLevel } from "../lib/lulu/types";
import { getUserId, upload, storePdf } from "./route-utils";
import { toEmbeddableImage } from "../lib/media-storage";

const router = Router();

// PDF generation renders dishImageThumbnail only, so skip the full base64
// image columns — with them, a large cookbook exceeds the Neon HTTP driver's
// 64MB response cap. Batch as a safety margin for very large cookbooks.
// Puppeteer pages built with setContent can't fetch relative /media URLs, so
// disk-stored template assets must be inlined as data URLs before rendering.
// Mutates templateData/fonts in place; returns the resolved background image.
async function embedTemplateMediaForPdf(
  templateData: any,
  fonts: { dataUrl?: string }[] | undefined,
  backgroundImage: string | undefined
): Promise<string | undefined> {
  if (templateData?.cover?.coverImage) {
    templateData.cover.coverImage = await toEmbeddableImage(templateData.cover.coverImage);
  }
  if (Array.isArray(fonts)) {
    for (const f of fonts) {
      if (f?.dataUrl) f.dataUrl = (await toEmbeddableImage(f.dataUrl)) || f.dataUrl;
    }
  }
  if (!backgroundImage) return undefined;
  return (await toEmbeddableImage(backgroundImage)) || undefined;
}

async function fetchPrintRecipesByIds(ids: string[]) {
  const { dishImage, handwrittenImage, dishImages, ...printColumns } = getTableColumns(recipes);
  const BATCH = 50;
  const rows: Record<string, any>[] = [];
  for (let i = 0; i < ids.length; i += BATCH) {
    rows.push(...await db.select(printColumns).from(recipes).where(inArray(recipes.id, ids.slice(i, i + BATCH))));
  }
  return rows.map(r => ({ ...r, dishImage: null, handwrittenImage: null, dishImages: null })) as (typeof recipes.$inferSelect)[];
}

// The public parts of a cookbook owner's profile, for "by Grandma Jean".
// The client used to expect this on GET /cookbooks/:id but it was never sent,
// so every cookbook showed "by Unknown".
async function ownerSummary(ownerUserId: string) {
  const owner = await storage.getUser(ownerUserId);
  if (!owner) return undefined;
  return {
    id: owner.id,
    username: owner.username ?? null,
    firstName: owner.firstName ?? null,
    lastName: owner.lastName ?? null,
    avatar: owner.profileImageUrl ?? null,
  };
}

router.get("/cookbooks", optionalAuth, async (req: any, res) => {
  try {
    const userId = getUserId(req);
    const scope = req.query.scope as string;
    let cookbooksList;

    if (scope === 'public') {
      cookbooksList = await storage.getPublicCookbooks();
    } else if (scope === 'shared') {
      // Cookbooks other people shared with this user (collaborator), with owners
      if (!userId) return res.status(401).json({ error: "Unauthorized" });
      const shared = await storage.getCollaboratingCookbooks(userId);
      const owners = new Map<string, Awaited<ReturnType<typeof ownerSummary>>>();
      for (const id of Array.from(new Set(shared.map((c) => c.ownerUserId)))) owners.set(id, await ownerSummary(id));
      return res.json(shared.map((c) => ({ ...c, owner: owners.get(c.ownerUserId) })));
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
    res.json({ ...cookbook, owner: await ownerSummary(cookbook.ownerUserId) });
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

    const filters = parseFiltersFromQuery(req.query);
    const result = await storage.getCookbookRecipesPaginated(
      Number(id),
      Number(page),
      Math.min(Number(limit) || 24, 100),
      Object.keys(filters).length > 0 ? filters : undefined,
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
    // Which recipes have an original card (the preview loads small copies on demand)
    const withCards = fullRecipes.length
      ? new Set((await db.select({ id: recipes.id }).from(recipes).where(and(inArray(recipes.id, fullRecipes.map((r) => r.id)), isNotNull(recipes.handwrittenImage)))).map((r) => r.id))
      : new Set<string>();
    res.json({ recipes: fullRecipes.map((r) => ({ ...r, hasOriginalCard: withCards.has(r.id) })) });
  } catch (error) {
    console.error("Error fetching cookbook recipes for print:", error);
    res.status(500).json({ error: "Failed to fetch recipes for printing" });
  }
});

// A small copy of a recipe's original handwritten card, for the print preview
router.get("/cookbooks/:id/original-cards/:recipeId", optionalAuth, async (req: any, res) => {
  try {
    const userId = getUserId(req);
    const cookbook = await storage.getCookbook(Number(req.params.id), userId);
    if (!cookbook) return res.status(404).json({ error: "Cookbook not found or not accessible" });
    const [link] = await db.select({ id: cookbookRecipes.recipeId }).from(cookbookRecipes)
      .where(and(eq(cookbookRecipes.cookbookId, Number(req.params.id)), eq(cookbookRecipes.recipeId, req.params.recipeId)));
    if (!link) return res.status(404).json({ error: "Recipe isn't in this cookbook" });
    const jpeg = await originalCardJpeg(req.params.recipeId, 700);
    if (!jpeg) return res.status(404).json({ error: "This recipe has no original card" });
    res.setHeader("Content-Type", "image/jpeg");
    res.setHeader("Cache-Control", "private, max-age=3600");
    res.send(jpeg);
  } catch (error) {
    console.error("Error serving original card:", error);
    res.status(500).json({ error: "Couldn't load the original card" });
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

// Everything about the book besides the layout: template and print specs.
// The editor autosaves these with the layout so the order uses exactly what
// the person chose (they used to live only in the page and were lost).
const TEMPLATE_STYLES = ['classic', 'modern', 'rustic', 'elegant', 'card', 'heirloom'] as const;
type TemplateStyle = typeof TEMPLATE_STYLES[number];

async function parseBookSettings(body: any, userId: string): Promise<{ error: string } | { updates: Record<string, any> }> {
  const updates: Record<string, any> = {};
  if (body.templateStyle !== undefined) {
    if (!TEMPLATE_STYLES.includes(body.templateStyle)) return { error: "Invalid template style" };
    updates.templateStyle = body.templateStyle as TemplateStyle;
  }
  if (body.customTemplateId !== undefined) {
    if (body.customTemplateId === null) {
      updates.customTemplateId = null;
    } else {
      const template = await storage.getCustomTemplate(Number(body.customTemplateId));
      if (!template || (template.ownerUserId !== userId && !template.isPublic)) return { error: "Template not found" };
      updates.customTemplateId = template.id;
    }
  }
  if (body.trimSize !== undefined) {
    if (!(body.trimSize in LULU_BOOK_SIZES)) return { error: "Invalid book size" };
    updates.trimSize = body.trimSize;
  }
  if (body.bindingType !== undefined) {
    if (!(body.bindingType in BINDING_PAPER_COMPATIBILITY)) return { error: "Invalid binding" };
    updates.bindingType = body.bindingType;
  }
  if (body.paperType !== undefined) {
    const binding = updates.bindingType ?? body.bindingType ?? 'PB';
    if (!(BINDING_PAPER_COMPATIBILITY[binding] || []).includes(body.paperType)) return { error: "That paper doesn't work with this binding" };
    updates.paperType = body.paperType;
  }
  if (body.colorType !== undefined) {
    if (!['BW', 'FC'].includes(body.colorType)) return { error: "Invalid color option" };
    updates.colorType = body.colorType;
  }
  if (body.coverFinish !== undefined) {
    if (!['M', 'G'].includes(body.coverFinish)) return { error: "Invalid cover finish" };
    updates.coverFinish = body.coverFinish;
  }
  return { updates };
}

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

    // One project per cookbook: a second create (e.g. two tabs autosaving at
    // once) updates the existing one instead of forking the book
    const existing = (await storage.getPrintProjectsByCookbook(Number(id), userId))[0];

    const validatedLayout = printLayoutDataSchema.parse(req.body.layoutData || { sections: [] });
    const settings = await parseBookSettings(req.body, userId);
    if ("error" in settings) return res.status(400).json({ error: settings.error });

    if (existing) {
      const project = await storage.updatePrintProject(existing.id, { layoutData: validatedLayout, ...settings.updates }, userId);
      return res.json(project);
    }

    const project = await storage.createPrintProject({
      cookbookId: Number(id),
      ownerUserId: userId,
      layoutData: validatedLayout,
      templateStyle: 'classic',
      ...settings.updates,
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

    const { layoutData } = req.body;
    const settings = await parseBookSettings(req.body, userId);
    if ("error" in settings) return res.status(400).json({ error: settings.error });
    const updates: any = { ...settings.updates };

    if (layoutData !== undefined) {
      updates.layoutData = printLayoutDataSchema.parse(layoutData);
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

// "Ready to print?": gathers facts about each recipe in the layout and
// returns plain-language findings (see shared/print-readiness.ts)
router.post("/cookbooks/:id/preflight", isAuthenticated, async (req: any, res) => {
  try {
    const cookbookId = parseInt(req.params.id);
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const parsed = printLayoutDataSchema.safeParse(req.body.layoutData);
    if (!parsed.success) return res.status(400).json({ error: "Layout data is required" });
    const layoutData = parsed.data;

    const cookbook = await storage.getCookbook(cookbookId, userId);
    if (!cookbook || cookbook.ownerUserId !== userId) {
      return res.status(403).json({ error: "Access denied" });
    }

    const allRecipeIds = layoutData.sections.flatMap((s) => s.recipeIds);
    const bindingType = typeof req.body.bindingType === "string" ? req.body.bindingType : "PB";
    const trimSize = typeof req.body.trimSize === "string" ? req.body.trimSize : "0600X0900";

    // Only the columns the check needs: the photo's size, not the photo
    // itself (loading 50 full-size photos made this take minutes). Recipes
    // must belong to this cookbook, the same rule printing uses.
    const memberIds = new Set(
      (await db.select({ id: cookbookRecipes.recipeId }).from(cookbookRecipes).where(eq(cookbookRecipes.cookbookId, cookbookId))).map((r) => r.id),
    );
    const wanted = allRecipeIds.filter((rid) => memberIds.has(rid));
    const rows: { id: string; title: string; ingredients: string[] | null; normalizedIngredients: unknown[] | null; instructions: string[] | null; photoBytes: number | null; isDataUrl: boolean | null }[] = [];
    for (let i = 0; i < wanted.length; i += 50) {
      rows.push(...await db.select({
        id: recipes.id,
        title: recipes.title,
        ingredients: recipes.ingredients,
        normalizedIngredients: recipes.normalizedIngredients,
        instructions: recipes.instructions,
        photoBytes: sql<number | null>`length(${recipes.dishImage})`,
        isDataUrl: sql<boolean | null>`left(${recipes.dishImage}, 10) = 'data:image'`,
      }).from(recipes).where(inArray(recipes.id, wanted.slice(i, i + 50))) as any);
    }
    const byId = new Map(rows.map((r) => [r.id, r]));
    const facts: RecipePrintFacts[] = allRecipeIds.map((rid) => {
      const r = byId.get(rid);
      if (!r) return { id: rid, title: "", found: false, hasPhoto: false, hasIngredients: false, hasInstructions: false };
      const bytes = Number(r.photoBytes) || 0;
      return {
        id: r.id,
        title: r.title,
        found: true,
        hasPhoto: bytes > 0,
        // base64 is 4/3 the size of the image it holds
        photoKB: r.isDataUrl ? Math.round((bytes * 3) / 4 / 1024) : undefined,
        hasIngredients: !!(r.ingredients?.length || r.normalizedIngredients?.length),
        hasInstructions: !!r.instructions?.length,
      };
    });

    const result = checkReadiness({
      recipes: facts,
      sections: layoutData.sections,
      title: layoutData.title,
      authorName: layoutData.authorName,
      trimSize,
      pageLimits: BINDING_PAGE_LIMITS[bindingType] || { min: 32, max: 800 },
    });
    res.json(result);
  } catch (error) {
    console.error("Error running preflight check:", error);
    res.status(500).json({ error: "Failed to run preflight check" });
  }
});

// Generate PDF for cookbook print project
// Propose book chapters by course. Recipes with no recognizable course tag
// are classified by Gemini first, and those tags are saved back to the
// recipe so the rest of the app's meal filters benefit too.
router.post("/cookbooks/:id/course-plan", isAuthenticated, async (req: any, res) => {
  try {
    const cookbookId = parseInt(req.params.id);
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const cookbook = await storage.getCookbook(cookbookId);
    if (!cookbook) return res.status(404).json({ error: "Cookbook not found" });
    if (cookbook.ownerUserId !== userId) {
      return res.status(403).json({ error: "Not authorized to organize this cookbook" });
    }

    const rows = await db
      .select({
        id: recipes.id,
        title: recipes.title,
        description: recipes.description,
        mealType: recipes.mealType,
        ownerUserId: recipes.ownerUserId,
      })
      .from(cookbookRecipes)
      .innerJoin(recipes, eq(cookbookRecipes.recipeId, recipes.id))
      .where(eq(cookbookRecipes.cookbookId, cookbookId));

    // Only the user's own recipes get tags written back; others are
    // classified in memory for this plan
    const needsClassification = rows.filter((r) => chapterForTags(r.mealType) === null);
    let classified = 0;

    if (needsClassification.length > 0 && isGeminiAvailable()) {
      const chapterList = CHAPTERS.map((c) => `- ${c.key}: ${c.title}`).join("\n");
      const systemPrompt = `You sort recipes into cookbook chapters. Chapters:\n${chapterList}\n\nRespond with JSON only: {"assignments": [{"id": "<recipe id>", "chapter": "<chapter key>"}]}. Use exactly one chapter key per recipe. A main dish served at lunch or dinner is "mains".`;

      const BATCH = 40;
      for (let i = 0; i < needsClassification.length; i += BATCH) {
        const batch = needsClassification.slice(i, i + BATCH);
        const list = batch
          .map((r) => `${r.id} | ${r.title}${r.description ? ` | ${r.description.slice(0, 120)}` : ""}`)
          .join("\n");
        try {
          const result = await parseQueryWithGemini(list, systemPrompt);
          for (const a of result?.assignments ?? []) {
            const chapter = CHAPTERS.find((c) => c.key === a.chapter);
            const recipe = batch.find((r) => r.id === a.id);
            if (!chapter || !recipe) continue;
            recipe.mealType = [chapter.canonicalTag];
            if (recipe.ownerUserId === userId) {
              await db.update(recipes).set({ mealType: [chapter.canonicalTag] }).where(eq(recipes.id, recipe.id));
            }
            classified++;
          }
        } catch (err) {
          // A failed batch falls back to "More Recipes" rather than failing the plan
          console.error("[course-plan] Gemini classification batch failed:", err);
        }
      }
    }

    const chapters = buildCoursePlan(rows.map((r) => ({ id: r.id, title: r.title, mealType: r.mealType })));
    res.json({ chapters, classified, total: rows.length });
  } catch (error) {
    console.error("Error building course plan:", error);
    res.status(500).json({ error: "Failed to organize recipes" });
  }
});

// Recipe Card pages show nutrition and tips. These two routes report which of
// the cookbook's recipes lack them and fill the gaps with Gemini estimates.
// Only the owner's own recipes are written; existing values are never replaced.
async function recipesMissingPrintDetails(cookbookId: number) {
  const rows = await db
    .select({
      id: recipes.id,
      title: recipes.title,
      servings: recipes.servings,
      ingredients: recipes.ingredients,
      instructions: recipes.instructions,
      calories: recipes.calories,
      protein: recipes.protein,
      carbohydrates: recipes.carbohydrates,
      fat: recipes.fat,
      fiber: recipes.fiber,
      sugar: recipes.sugar,
      sodium: recipes.sodium,
      cholesterol: recipes.cholesterol,
      tips: recipes.tips,
      ownerUserId: recipes.ownerUserId,
    })
    .from(cookbookRecipes)
    .innerJoin(recipes, eq(cookbookRecipes.recipeId, recipes.id))
    .where(eq(cookbookRecipes.cookbookId, cookbookId));
  return rows.filter((r) => r.calories == null || !Array.isArray(r.tips) || r.tips.length === 0);
}

router.get("/cookbooks/:id/print-details-status", isAuthenticated, async (req: any, res) => {
  try {
    const cookbookId = parseInt(req.params.id);
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    const cookbook = await storage.getCookbook(cookbookId);
    if (!cookbook) return res.status(404).json({ error: "Cookbook not found" });
    if (cookbook.ownerUserId !== userId) return res.status(403).json({ error: "Not authorized" });

    const missing = await recipesMissingPrintDetails(cookbookId);
    res.json({
      missing: missing.length,
      fillable: missing.filter((r) => r.ownerUserId === userId).length,
      aiAvailable: isGeminiAvailable(),
    });
  } catch (error) {
    console.error("Error checking print details:", error);
    res.status(500).json({ error: "Failed to check recipes" });
  }
});

router.post("/cookbooks/:id/fill-print-details", isAuthenticated, async (req: any, res) => {
  try {
    const cookbookId = parseInt(req.params.id);
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    const cookbook = await storage.getCookbook(cookbookId);
    if (!cookbook) return res.status(404).json({ error: "Cookbook not found" });
    if (cookbook.ownerUserId !== userId) return res.status(403).json({ error: "Not authorized" });
    if (!isGeminiAvailable()) return res.status(503).json({ error: "AI is not configured" });

    const todo = (await recipesMissingPrintDetails(cookbookId)).filter((r) => r.ownerUserId === userId);
    const systemPrompt = `You estimate per-serving nutrition and write short cooking tips for recipes.
Respond with JSON only: {"recipes": [{"id": "<recipe id>", "calories": number, "protein": number, "carbohydrates": number, "fat": number, "fiber": number, "sugar": number, "sodium": number, "cholesterol": number, "tips": [{"type": "technique"|"storage"|"makeAhead"|"reheating"|"serving", "text": string}]}]}
Grams for protein/carbohydrates/fat/fiber/sugar, milligrams for sodium/cholesterol, rounded to whole numbers. Give 3 or 4 tips per recipe, each one practical sentence under 120 characters.`;

    const num = (v: unknown) => {
      const n = Number(v);
      return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
    };
    const tipTypes = new Set(["technique", "storage", "makeAhead", "reheating", "serving"]);

    let filled = 0;
    const BATCH = 6;
    for (let i = 0; i < todo.length; i += BATCH) {
      const batch = todo.slice(i, i + BATCH);
      const payload = batch.map((r) => ({
        id: r.id,
        title: r.title,
        servings: r.servings,
        ingredients: r.ingredients,
        instructions: Array.isArray(r.instructions) ? (r.instructions as any[]).slice(0, 15) : r.instructions,
      }));
      try {
        const result = await parseQueryWithGemini(JSON.stringify(payload), systemPrompt);
        for (const est of result?.recipes ?? []) {
          const r = batch.find((b) => b.id === est.id);
          if (!r) continue;
          const update: Record<string, any> = {};
          for (const key of ["calories", "protein", "carbohydrates", "fat", "fiber", "sugar", "sodium", "cholesterol"] as const) {
            if (r[key] == null && num(est[key]) != null) update[key] = num(est[key]);
          }
          if (!Array.isArray(r.tips) || r.tips.length === 0) {
            const tips = (Array.isArray(est.tips) ? est.tips : [])
              .filter((t: any) => typeof t?.text === "string" && t.text.trim())
              .slice(0, 4)
              .map((t: any) => ({ type: tipTypes.has(t.type) ? t.type : "technique", text: String(t.text).trim().slice(0, 200) }));
            if (tips.length) update.tips = tips;
          }
          if (Object.keys(update).length) {
            await db.update(recipes).set(update).where(eq(recipes.id, r.id));
            filled++;
          }
        }
      } catch (err) {
        console.error("[fill-print-details] Gemini batch failed:", err);
      }
    }

    res.json({ filled, attempted: todo.length });
  } catch (error) {
    console.error("Error filling print details:", error);
    res.status(500).json({ error: "Failed to fill recipe details" });
  }
});

// Builds the PDF input for a cookbook layout exactly as "Download PDF" does.
// Shared with family photo placement so gaps are measured on the same book.
async function buildPrintDataFromLayout(
  cookbookId: number,
  cookbookName: string,
  userId: string,
  layout: PrintLayoutData,
  templateStyle?: string,
  customTemplateId?: number | null,
  /** The editor's unsaved book size, when it differs from the saved project */
  specs?: { trimSize?: string; bindingType?: string; paperType?: string },
): Promise<{ data: CookbookPrintData } | { error: string }> {
    const allRecipeIds = layout.sections
      .flatMap(s => Array.isArray(s.recipeIds) ? s.recipeIds : [])
      .filter((rid): rid is string => typeof rid === 'string' && rid.length > 0);

    if (allRecipeIds.length === 0) {
      return { error: "No recipes in layout" };
    }

    // Backfill print-resolution derivatives (no-op once generated), then fetch
    const generatedCount = await storage.ensurePrintImagesForRecipes(allRecipeIds);
    if (generatedCount > 0) {
      console.log(`[PDF Generation] Generated ${generatedCount} print-resolution image derivatives`);
    }
    const recipesResult = await fetchPrintRecipesByIds(allRecipeIds);

    if (recipesResult.length === 0) {
      return { error: "No recipes found in database for this layout" };
    }

    // Get print project for specs (or use defaults)
    const printProjects = await storage.getPrintProjectsByCookbook(cookbookId, userId);
    const printProject = printProjects[0];

    const trimSize = specs?.trimSize || printProject?.trimSize || '0600X0900';
    const bindingType = specs?.bindingType || printProject?.bindingType || 'PB';
    const paperType = specs?.paperType || printProject?.paperType || '080CW444';
    // The editor sends what's on screen (possibly unsaved); it wins over the saved project
    const templateId = templateStyle || printProject?.templateStyle || 'classic';
    const recipePrintSettings = layout.recipePrintSettings || {};

    // Resolve custom template if provided
    let customTemplateData = undefined;
    let customFonts = undefined;
    let backgroundImage = undefined;

    const resolvedCustomTemplateId = templateStyle !== undefined ? customTemplateId : printProject?.customTemplateId;
    if (resolvedCustomTemplateId) {
      const customTemplate = await storage.getCustomTemplate(resolvedCustomTemplateId);
      if (customTemplate) {
        customTemplateData = customTemplate.templateData as any;
        customFonts = customTemplate.customFonts as any;
        backgroundImage = await embedTemplateMediaForPdf(customTemplateData, customFonts, customTemplate.backgroundImage || undefined);
      }
    }

    // Build cookbook print data using recipe transformer
    const cookbookPrintData: CookbookPrintData = {
      title: layout.title || cookbookName,
      subtitle: layout.subtitle,
      authorName: layout.authorName || 'Unknown',
      dedication: layout.dedication,
      minPages: (BINDING_PAGE_LIMITS[bindingType] || { min: 32 }).min,
      templateId,
      trimSize,
      bindingType,
      paperType,
      sections: layout.sections.map((s, i) => ({
        id: s.id,
        title: s.title,
        sortOrder: i,
      })),
      recipes: layout.sections.flatMap((section, sIdx) =>
        (section.recipeIds || []).map((recipeId, rIdx) => {
          const recipeData = recipesResult.find(r => r.id === recipeId);
          if (!recipeData) return null;
          const settings = recipePrintSettings[recipeId];
          return {
            sectionId: section.id,
            sortOrder: rIdx,
            layoutOverride: settings?.layoutOverride,
            data: transformRecipe(recipeData, layout.customizations?.unitSystem || 'original'),
          };
        }).filter(Boolean)
      ) as CookbookPrintData['recipes'],
      coverData: layout.coverData,
      customizations: layout.customizations ? {
        showNutrition: layout.customizations.showNutrition,
        showTips: layout.customizations.showTips,
        showVariations: layout.customizations.showVariations,
      } : undefined,
      customTemplateData,
      customFonts,
      backgroundImage,
    };

    cookbookPrintData.familyPhotos = await loadFamilyPhotosForPrint(cookbookId, layout);
    await attachOriginalCards(cookbookPrintData);
    return { data: cookbookPrintData };
}

/**
 * Embeds the family photos a layout uses: one per recipe (placed under it)
 * and the Family Album. Photos are read in small batches; each is ~0.5-1MB.
 */
async function loadFamilyPhotosForPrint(cookbookId: number, layout: PrintLayoutData): Promise<CookbookPrintData["familyPhotos"]> {
  const entries = layout.familyPhotos ?? [];
  const inBook = new Set(layout.sections.flatMap((s) => s.recipeIds));
  const sectionIds = new Set(layout.sections.map((s) => s.id));
  const wanted = entries.filter((e) =>
    e.placement?.type === "album" || e.placement?.type === "dedication" ||
    (e.placement?.type === "section" && e.placement.sectionId && sectionIds.has(e.placement.sectionId)) ||
    (e.placement?.type === "recipe" && e.placement.recipeId && inBook.has(e.placement.recipeId)));
  if (wanted.length === 0) return undefined;

  const images = new Map<string, string>();
  for (let i = 0; i < wanted.length; i += 8) {
    const rows = await db
      .select({ id: cookbookPhotos.id, image: cookbookPhotos.image })
      .from(cookbookPhotos)
      .where(and(eq(cookbookPhotos.cookbookId, cookbookId), inArray(cookbookPhotos.id, wanted.slice(i, i + 8).map((e) => e.id))));
    rows.forEach((r) => images.set(r.id, r.image));
  }

  const byRecipe: Record<string, { src: string; aspect: number }> = {};
  const album: { src: string; aspect: number }[] = [];
  const bySection: Record<string, { src: string; aspect: number }[]> = {};
  let dedication: { src: string; aspect: number } | undefined;
  for (const e of wanted) {
    const src = images.get(e.id);
    if (!src) continue;
    const photo = { src, aspect: e.width / e.height };
    if (e.placement?.type === "album") album.push(photo);
    else if (e.placement?.type === "dedication") dedication ??= photo;
    else if (e.placement?.type === "section" && e.placement.sectionId) (bySection[e.placement.sectionId] ??= []).push(photo);
    else if (e.placement?.recipeId && !byRecipe[e.placement.recipeId]) byRecipe[e.placement.recipeId] = photo;
  }
  return { byRecipe, album, bySection, dedication };
}

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

    const { layoutData, templateStyle, customTemplateId } = req.body;

    const validatedLayout = printLayoutDataSchema.safeParse(layoutData);
    if (!validatedLayout.success) {
      return res.status(400).json({ error: "Invalid layout data", details: validatedLayout.error.issues });
    }

    const built = await buildPrintDataFromLayout(cookbookId, cookbook.name, userId, validatedLayout.data, templateStyle, customTemplateId);
    if ("error" in built) return res.status(400).json({ error: built.error });
    const cookbookPrintData = built.data;

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

// Places family photos into the empty space under recipes. Lays the book out
// exactly as the PDF would (current template, sizes, fonts), measures each
// recipe's leftover space, and returns the updated photo list for the layout.
router.post("/cookbooks/:id/photos/place", isAuthenticated, async (req: any, res) => {
  try {
    const cookbookId = parseInt(req.params.id);
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    const cookbook = await storage.getCookbook(cookbookId);
    if (!cookbook) return res.status(404).json({ error: "Cookbook not found" });
    if (cookbook.ownerUserId !== userId) return res.status(403).json({ error: "Not authorized" });

    const { layoutData, templateStyle, customTemplateId, trimSize, bindingType } = req.body;
    const parsed = printLayoutDataSchema.safeParse(layoutData);
    if (!parsed.success) return res.status(400).json({ error: "Invalid layout data" });
    const photos = parsed.data.familyPhotos ?? [];
    if (photos.length === 0) return res.json({ familyPhotos: [], placed: 0, unplaced: 0 });

    const built = await buildPrintDataFromLayout(
      cookbookId, cookbook.name, userId, { ...parsed.data, familyPhotos: undefined }, templateStyle, customTemplateId,
      { trimSize: typeof trimSize === "string" ? trimSize : undefined, bindingType: typeof bindingType === "string" ? bindingType : undefined },
    );
    if ("error" in built) return res.status(400).json({ error: built.error });

    const gaps = await measureRecipeGaps(built.data);
    const familyPhotos = planFamilyPhotos(photos, gaps, parsed.data.sections);
    res.json({
      familyPhotos,
      placed: familyPhotos.filter((p) => p.placement?.type === "recipe" || p.placement?.type === "section").length,
      unplaced: familyPhotos.filter((p) => p.placement?.type === "unplaced").length,
    });
  } catch (error) {
    console.error("Error placing family photos:", error);
    res.status(500).json({ error: "Failed to place photos" });
  }
});

// Orders in flight or just placed, by person + idempotency key. A double tap,
// a retry after a dropped connection, or a second tab gets the first
// attempt's result instead of placing a second order. In memory, like the
// staged PDFs; an hour is far longer than any retry.
type OrderReply = { status: number; body: any };
const orderAttempts = new Map<string, { at: number; result: Promise<OrderReply> }>();
const ORDER_ATTEMPT_TTL_MS = 60 * 60 * 1000;
const reply = (status: number, body: any): OrderReply => ({ status, body });

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

    const now = Date.now();
    orderAttempts.forEach((v, k) => { if (now - v.at > ORDER_ATTEMPT_TTL_MS) orderAttempts.delete(k); });

    const key = typeof req.body.idempotencyKey === "string" && req.body.idempotencyKey.length >= 8
      ? `${userId}:${cookbookId}:${req.body.idempotencyKey.slice(0, 100)}`
      : null;
    const previous = key ? orderAttempts.get(key) : undefined;
    if (previous) {
      const r = await previous.result;
      return res.status(r.status).json({ ...r.body, repeated: true });
    }

    const result = placePrintOrder(req, userId, cookbook, cookbookId);
    if (key) {
      orderAttempts.set(key, { at: now, result });
      // A failed attempt can be tried again with the same key
      result.then((r) => { if (r.status >= 400) orderAttempts.delete(key); }, () => orderAttempts.delete(key));
    }
    const r = await result;
    res.status(r.status).json(r.body);
  } catch (error: any) {
    console.error("Error creating print order:", error);
    res.status(500).json({ error: error.message || "Failed to create print order" });
  }
});

async function placePrintOrder(req: any, userId: string, cookbook: { id: number; name: string }, cookbookId: number): Promise<OrderReply> {
    const {
      layoutData,
      quantity,
      shippingAddress,
      shippingLevel,
    } = req.body;

    if (!layoutData) {
      return reply(400, { error: "Layout data is required" });
    }
    if (!shippingAddress) return reply(400, { error: "Enter a shipping address." });
    const addressErrors = validateAddress(shippingAddress);
    const firstAddressError = Object.values(addressErrors)[0];
    if (firstAddressError) return reply(400, { error: firstAddressError, fieldErrors: addressErrors });
    const copies = Math.floor(Number(quantity) || 1);
    if (copies < 1 || copies > 100) return reply(400, { error: "Order between 1 and 100 copies." });
    if (shippingAddress?.country_code === 'US') {
      const state = normalizeUsState(shippingAddress.state_code);
      if (!state) return reply(400, { error: "Enter a valid US state, like OH or Ohio." });
      shippingAddress.state_code = state;
    }
    const validatedLayout = printLayoutDataSchema.safeParse(layoutData);
    if (!validatedLayout.success) {
      return reply(400, { error: "Invalid layout data", details: validatedLayout.error.issues });
    }

    const allRecipeIds = validatedLayout.data.sections
      .flatMap(s => Array.isArray(s.recipeIds) ? s.recipeIds : [])
      .filter((rid): rid is string => typeof rid === 'string' && rid.length > 0);

    if (allRecipeIds.length === 0) {
      return reply(400, { error: "No recipes in layout" });
    }

    // Backfill print-resolution derivatives (no-op once generated), then fetch
    await storage.ensurePrintImagesForRecipes(allRecipeIds);
    const recipesResult = await fetchPrintRecipesByIds(allRecipeIds);

    if (recipesResult.length === 0) {
      return reply(400, { error: "No recipes found in database for this layout" });
    }

    // The print project holds the specs and template, and is where the order
    // is recorded. Save the book exactly as ordered (creating the project if
    // the editor never saved one) so the order shows up in the app.
    const settings = await parseBookSettings(req.body, userId);
    if ("error" in settings) return reply(400, { error: settings.error });
    let printProject = (await storage.getPrintProjectsByCookbook(cookbookId, userId))[0];
    if (printProject) {
      printProject = (await storage.updatePrintProject(printProject.id, { layoutData: validatedLayout.data, ...settings.updates }, userId)) ?? printProject;
    } else {
      printProject = await storage.createPrintProject({
        cookbookId,
        ownerUserId: userId,
        layoutData: validatedLayout.data,
        templateStyle: 'classic',
        ...settings.updates,
      });
    }

    const trimSize = printProject?.trimSize || '0600X0900';
    const bindingType = printProject?.bindingType || 'PB';
    const paperType = printProject?.paperType || '080CW444';
    const colorType = printProject?.colorType || 'FC';
    const coverFinishVal = printProject?.coverFinish || 'M';
    const templateId = printProject?.templateStyle || 'classic';
    const recipePrintSettings = validatedLayout.data.recipePrintSettings || {};

    // Resolve custom template if the print project uses one
    let orderCustomTemplateData = undefined;
    let orderCustomFonts = undefined;
    let orderBackgroundImage = undefined;

    if (printProject?.customTemplateId) {
      const customTemplate = await storage.getCustomTemplate(printProject.customTemplateId);
      if (customTemplate) {
        orderCustomTemplateData = customTemplate.templateData as any;
        orderCustomFonts = customTemplate.customFonts as any;
        orderBackgroundImage = await embedTemplateMediaForPdf(orderCustomTemplateData, orderCustomFonts, customTemplate.backgroundImage || undefined);
      }
    }

    // Build cookbook print data
    const cookbookPrintData: CookbookPrintData = {
      title: validatedLayout.data.title || cookbook.name,
      subtitle: validatedLayout.data.subtitle,
      authorName: validatedLayout.data.authorName || 'Unknown',
      dedication: validatedLayout.data.dedication,
      minPages: (BINDING_PAGE_LIMITS[bindingType] || { min: 32 }).min,
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
            data: transformRecipe(recipeData, validatedLayout.data.customizations?.unitSystem || 'original'),
          };
        }).filter(Boolean)
      ) as CookbookPrintData['recipes'],
      coverData: validatedLayout.data.coverData,
      customizations: validatedLayout.data.customizations ? {
        showNutrition: validatedLayout.data.customizations.showNutrition,
        showTips: validatedLayout.data.customizations.showTips,
        showVariations: validatedLayout.data.customizations.showVariations,
      } : undefined,
      customTemplateData: orderCustomTemplateData,
      customFonts: orderCustomFonts,
      backgroundImage: orderBackgroundImage,
      familyPhotos: await loadFamilyPhotosForPrint(cookbookId, validatedLayout.data),
    };

    await attachOriginalCards(cookbookPrintData);
    console.log(`[Print Order] Generating PDF for cookbook ${cookbookId} with ${cookbookPrintData.recipes.length} recipes`);

    // Generate interior PDF
    const pdfResult = await generateInteriorPdf(cookbookPrintData);

    // Validate page count
    const limits = BINDING_PAGE_LIMITS[bindingType] || { min: 32, max: 800 };
    if (pdfResult.pageCount > limits.max) {
      return reply(400, {
        error: `Cookbook has ${pdfResult.pageCount} pages but maximum is ${limits.max} for this binding type. Please reduce the number of recipes.`
      });
    }

    // The interior is padded to the binding minimum, so this is the true count
    const pageCount = pdfResult.pageCount;
    console.log(`[Print Order] Interior PDF generated with ${pageCount} pages`);

    const safeTitle = (validatedLayout.data.title || 'cookbook').replace(/[^a-zA-Z0-9]/g, '_');
    const interiorPdfId = storePdf(pdfResult.buffer, `${safeTitle}_interior.pdf`);

    // Generate cover PDF
    console.log(`[Print Order] Generating cover PDF for ${pageCount} pages`);
    const coverBuffer = await generateCoverPdf(cookbookPrintData, pageCount);
    const coverPdfId = storePdf(coverBuffer, `${safeTitle}_cover.pdf`);
    console.log(`[Print Order] Cover PDF generated successfully`);

    const baseUrl = process.env.PUBLIC_URL || `https://${req.get('host')}`;
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

    // Lulu requires a contact email; fall back to the account's email when the form field is blank
    const contactEmail = shippingAddress.email?.trim() || (await storage.getUser(userId))?.email || '';
    if (!contactEmail) {
      return reply(400, { error: "Please enter an email address for order updates." });
    }

    const orderRequest: LuluPrintJobRequest = {
      contact_email: contactEmail,
      line_items: [{
        title: cookbook.name,
        cover: coverUrl,
        interior: interiorUrl,
        pod_package_id: podPackageId,
        quantity: copies,
      }],
      shipping_address: shippingAddress,
      shipping_level: (shippingLevel || 'GROUND_HD') as ShippingLevel,
      external_id: externalId,
    };

    const order = await createPrintJob(orderRequest);

    // Record it; if this fails the order still exists at Lulu, so report
    // success with the number rather than inviting a duplicate order
    try {
      await storage.updatePrintProjectLuluOrder(printProject.id, String(order.id), order.status.name);
    } catch (err) {
      console.error(`[Print Order] Order ${order.id} placed but not recorded on project ${printProject.id}:`, err);
    }

    const arrival = order.estimated_shipping_dates?.arrival_min && order.estimated_shipping_dates?.arrival_max
      ? { min: order.estimated_shipping_dates.arrival_min.slice(0, 10), max: order.estimated_shipping_dates.arrival_max.slice(0, 10) }
      : estimateArrival(orderRequest.shipping_level);

    return reply(200, {
      success: true,
      orderId: order.id,
      status: order.status.name,
      quantity: copies,
      arrival,
      total: order.costs?.total_cost_incl_tax ? parseFloat(order.costs.total_cost_incl_tax) : null,
      projectId: printProject.id,
      message: "Print order submitted successfully",
      podPackageId,
      pdfUrls: { interior: interiorUrl, cover: coverUrl },
    });
}

export default router;
