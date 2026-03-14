import { Router } from "express";
import { isAuthenticated } from "../clerkAuth";
import { storage } from "../storage";
import { getUserId } from "./route-utils";

const router = Router();

// Get user's bookmarked recipe IDs (for optimistic UI)
router.get("/bookmarks", isAuthenticated, async (req: any, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const bookmarkedIds = await storage.getBookmarkedRecipeIds(userId);
    res.json(bookmarkedIds);
  } catch (error) {
    console.error("Error fetching bookmark IDs:", error);
    res.status(500).json({ error: "Failed to fetch bookmarks" });
  }
});

// Get user's bookmarked recipes with full card data (for Favorites view)
router.get("/bookmarks/recipes", isAuthenticated, async (req: any, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const bookmarkedRecipes = await storage.getBookmarkedRecipes(userId);
    res.json(bookmarkedRecipes);
  } catch (error) {
    console.error("Error fetching bookmarked recipes:", error);
    res.status(500).json({ error: "Failed to fetch bookmarked recipes" });
  }
});

// Check if a recipe is bookmarked
router.get("/bookmarks/:recipeId", isAuthenticated, async (req: any, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const { recipeId } = req.params;
    const isBookmarked = await storage.isRecipeBookmarked(userId, recipeId);
    res.json({ isBookmarked });
  } catch (error) {
    console.error("Error checking bookmark:", error);
    res.status(500).json({ error: "Failed to check bookmark status" });
  }
});

// Add a bookmark
router.post("/bookmarks/:recipeId", isAuthenticated, async (req: any, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const { recipeId } = req.params;
    await storage.addBookmark(userId, recipeId);
    res.json({ message: "Recipe bookmarked", isBookmarked: true });
  } catch (error) {
    console.error("Error adding bookmark:", error);
    res.status(500).json({ error: "Failed to bookmark recipe" });
  }
});

// Remove a bookmark
router.delete("/bookmarks/:recipeId", isAuthenticated, async (req: any, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const { recipeId } = req.params;
    await storage.removeBookmark(userId, recipeId);
    res.json({ message: "Bookmark removed", isBookmarked: false });
  } catch (error) {
    console.error("Error removing bookmark:", error);
    res.status(500).json({ error: "Failed to remove bookmark" });
  }
});

export default router;
