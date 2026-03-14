import { Router } from "express";
import { z } from "zod";
import crypto from "node:crypto";
import { isAuthenticated } from "../clerkAuth";
import { storage } from "../storage";
import { groceryListWsManager } from "../websocket";
import { getUserId } from "./route-utils";

const router = Router();

// Get user's active grocery list with items
router.get("/grocery-list", isAuthenticated, async (req: any, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const list = await storage.getActiveGroceryList(userId);
    res.json(list || { items: [] });
  } catch (error) {
    console.error("Error fetching grocery list:", error);
    res.status(500).json({ error: "Failed to fetch grocery list" });
  }
});

// Get grocery list items grouped by aisle
router.get("/grocery-list/by-aisle", isAuthenticated, async (req: any, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const itemsByAisle = await storage.getGroceryListItemsByAisle(userId);
    res.json(itemsByAisle);
  } catch (error) {
    console.error("Error fetching grocery list by aisle:", error);
    res.status(500).json({ error: "Failed to fetch grocery list" });
  }
});

// Bulk add multiple recipes to the grocery list
// NOTE: This route MUST come before /api/grocery-list/recipes/:recipeId to avoid "bulk" being matched as a recipeId
router.post("/grocery-list/recipes/bulk", isAuthenticated, async (req: any, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const { recipeIds } = req.body;
    if (!Array.isArray(recipeIds) || recipeIds.length === 0) {
      return res.status(400).json({ error: "recipeIds must be a non-empty array" });
    }

    let added = 0;
    const errors: string[] = [];

    for (const recipeId of recipeIds) {
      try {
        const recipe = await storage.getRecipe(recipeId, userId);
        if (!recipe) {
          errors.push(`Recipe ${recipeId} not found or access denied`);
          continue;
        }

        await storage.addRecipeToGroceryList(userId, recipeId);
        added++;
      } catch (error: any) {
        errors.push(`Failed to add recipe ${recipeId}: ${error.message}`);
      }
    }

    res.status(201).json({
      message: `${added} recipe${added !== 1 ? 's' : ''} added to grocery list`,
      added,
      errors: errors.length > 0 ? errors : undefined
    });
  } catch (error) {
    console.error("Error bulk adding recipes to grocery list:", error);
    res.status(400).json({ error: "Failed to add recipes to grocery list" });
  }
});

// Add a single recipe to the grocery list
router.post("/grocery-list/recipes/:recipeId", isAuthenticated, async (req: any, res) => {
  try {
    const { recipeId } = req.params;
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const recipe = await storage.getRecipe(recipeId, userId);
    if (!recipe) {
      return res.status(404).json({ error: "Recipe not found or access denied" });
    }

    await storage.addRecipeToGroceryList(userId, recipeId);
    res.status(201).json({ message: "Recipe added to grocery list" });
  } catch (error) {
    console.error("Error adding recipe to grocery list:", error);
    res.status(400).json({ error: (error as Error).message || "Failed to add recipe to grocery list" });
  }
});

// Add a manual item to the grocery list
router.post("/grocery-list/items", isAuthenticated, async (req: any, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const itemSchema = z.object({
      item: z.string().min(1),
      quantity: z.coerce.number().positive().optional(),
      unit: z.string().optional(),
      displayName: z.string().optional(),
      aisle: z.string().optional(),
      category: z.string().optional(),
      emoji: z.string().max(2).optional(),
    });

    const validatedItem = itemSchema.parse(req.body);

    await storage.addManualItemToGroceryList(userId, validatedItem);
    res.status(201).json({ message: "Item added to grocery list" });
  } catch (error) {
    console.error("Error adding manual item to grocery list:", error);
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Invalid request data", details: error.errors });
    }
    res.status(400).json({ error: "Failed to add item to grocery list" });
  }
});

// Toggle item checked state
router.patch("/grocery-list/items/:itemId/toggle", isAuthenticated, async (req: any, res) => {
  try {
    const { itemId } = req.params;
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const toggleSchema = z.object({
      checked: z.coerce.boolean(),
    });

    const { checked } = toggleSchema.parse(req.body);

    await storage.toggleGroceryListItem(itemId, userId, checked);
    res.json({ message: "Item updated" });
  } catch (error) {
    console.error("Error toggling grocery list item:", error);
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Invalid request data", details: error.errors });
    }
    res.status(400).json({ error: (error as Error).message || "Failed to update item" });
  }
});

// Remove an item from the grocery list
router.delete("/grocery-list/items/:itemId", isAuthenticated, async (req: any, res) => {
  try {
    const { itemId } = req.params;
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const removed = await storage.removeItemFromGroceryList(itemId, userId);
    if (!removed) {
      return res.status(404).json({ error: "Item not found or unauthorized" });
    }
    res.json({ message: "Item removed" });
  } catch (error) {
    console.error("Error removing grocery list item:", error);
    res.status(500).json({ error: "Failed to remove item" });
  }
});

// Clear all items from the grocery list
router.delete("/grocery-list", isAuthenticated, async (req: any, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    await storage.clearGroceryList(userId);
    res.json({ message: "Grocery list cleared" });
  } catch (error) {
    console.error("Error clearing grocery list:", error);
    res.status(500).json({ error: "Failed to clear grocery list" });
  }
});

// ============================================================================
// GROCERY LIST SHARING ROUTES
// ============================================================================

router.post("/grocery-list/share", isAuthenticated, async (req: any, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const list = await storage.getActiveGroceryList(userId);
    if (!list) {
      return res.status(404).json({ error: "No active grocery list" });
    }

    const schema = z.object({
      canEdit: z.boolean().default(true),
      expiresInHours: z.number().optional(),
    });

    const data = schema.parse(req.body);

    const token = crypto.randomBytes(32).toString('hex');

    const share = await storage.createGroceryListShare({
      listId: list.id,
      token,
      createdByUserId: userId,
      canEdit: data.canEdit,
      expiresAt: data.expiresInHours
        ? new Date(Date.now() + data.expiresInHours * 60 * 60 * 1000)
        : null,
    });

    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const shareUrl = `${baseUrl}/shared-list/${token}`;

    res.status(201).json({
      shareId: share.id,
      token: share.token,
      shareUrl,
      canEdit: share.canEdit,
      expiresAt: share.expiresAt,
    });
  } catch (error) {
    console.error("Error creating share link:", error);
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Invalid data", details: error.errors });
    }
    res.status(500).json({ error: "Failed to create share link" });
  }
});

router.get("/grocery-list/shares", isAuthenticated, async (req: any, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const list = await storage.getActiveGroceryList(userId);
    if (!list) {
      return res.status(404).json({ error: "No active grocery list" });
    }

    const shares = await storage.getGroceryListShares(list.id, userId);
    res.json(shares);
  } catch (error) {
    console.error("Error fetching share links:", error);
    res.status(500).json({ error: "Failed to fetch share links" });
  }
});

router.delete("/grocery-list/shares/:shareId", isAuthenticated, async (req: any, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const { shareId } = req.params;

    const share = await storage.getGroceryListShareById(shareId, userId);
    if (share) {
      groceryListWsManager.revokeShareConnections(share.token);
    }

    await storage.revokeGroceryListShare(shareId, userId);
    res.json({ message: "Share link revoked" });
  } catch (error) {
    console.error("Error revoking share link:", error);
    res.status(500).json({ error: "Failed to revoke share link" });
  }
});

// Get shared grocery list (PUBLIC - no auth required)
router.get("/shared-list/:token", async (req: any, res) => {
  try {
    const { token } = req.params;
    const list = await storage.getSharedGroceryList(token);

    if (!list) {
      return res.status(404).json({ error: "List not found or expired" });
    }

    const share = await storage.getGroceryListShareByToken(token);

    res.json({
      ...list,
      canEdit: share?.canEdit ?? false,
    });
  } catch (error) {
    console.error("Error fetching shared list:", error);
    res.status(500).json({ error: "Failed to fetch list" });
  }
});

// Toggle item on shared list (PUBLIC - no auth required if canEdit)
router.patch("/shared-list/:token/items/:itemId/toggle", async (req: any, res) => {
  try {
    const { token, itemId } = req.params;
    const schema = z.object({ checked: z.boolean() });
    const { checked } = schema.parse(req.body);

    await storage.toggleSharedGroceryListItem(token, itemId, checked);
    res.json({ message: "Item updated", checked });
  } catch (error) {
    console.error("Error toggling shared list item:", error);
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Invalid data" });
    }
    res.status(400).json({ error: (error as Error).message || "Failed to update item" });
  }
});

// Join shared list as collaborator (PUBLIC)
router.post("/shared-list/:token/join", async (req: any, res) => {
  try {
    const { token } = req.params;
    const schema = z.object({
      displayName: z.string().min(1).max(50),
    });

    const { displayName } = schema.parse(req.body);

    const share = await storage.getGroceryListShareByToken(token);
    if (!share) {
      return res.status(404).json({ error: "List not found or expired" });
    }

    if (share.expiresAt && new Date(share.expiresAt) < new Date()) {
      return res.status(410).json({ error: "Share link has expired" });
    }

    const userId = getUserId(req);

    const collaborator = await storage.addCollaborator({
      shareId: share.id,
      userId: userId || null,
      displayName,
      isActive: true,
    });

    res.status(201).json({
      collaboratorId: collaborator.id,
      displayName: collaborator.displayName,
    });
  } catch (error) {
    console.error("Error joining shared list:", error);
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Invalid name" });
    }
    res.status(500).json({ error: "Failed to join list" });
  }
});

// Get active collaborators for a shared list
router.get("/shared-list/:token/collaborators", async (req: any, res) => {
  try {
    const { token } = req.params;

    const share = await storage.getGroceryListShareByToken(token);
    if (!share) {
      return res.status(404).json({ error: "List not found" });
    }

    const collaborators = await storage.getActiveCollaborators(share.id);
    res.json(collaborators);
  } catch (error) {
    console.error("Error fetching collaborators:", error);
    res.status(500).json({ error: "Failed to fetch collaborators" });
  }
});

export default router;
