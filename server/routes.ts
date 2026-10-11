import type { Express } from "express";
import { createServer, type Server } from "http";
import voiceRoutes from "./voice-routes";
import { setupAuth } from "./clerkAuth";

// Import route modules
import authRoutes from "./routes/auth";
import recipesRoutes from "./routes/recipes";
import recipeImportRoutes from "./routes/recipe-imports";
import cookbooksRoutes from "./routes/cookbooks";
import groceryRoutes from "./routes/grocery";
import pantryRoutes from "./routes/pantry";
import bookmarksRoutes from "./routes/bookmarks";
import usersRoutes from "./routes/users";
import adminRoutes from "./routes/admin";
import printRoutes from "./routes/print";
import socialRoutes from "./routes/social";
import grammieRoutes from "./routes/grammie";
import mealPlanRoutes from "./routes/meal-plans";
import templateRoutes from "./routes/templates";
import cookbookPhotoRoutes from "./routes/cookbook-photos";
import bulkIntakeRoutes from "./routes/bulk-intake";
import creditsRoutes from "./routes/credits";
import { startCredits } from "./lib/credits-pg";
import { mealPrepRouter } from "./meal-prep/wiring";
import { setMealPrepEngines } from "./meal-prep/engines";
import { createFoodData } from "./meal-prep/food";
import { createPlanner } from "./meal-prep/planner";
import { createSessionBuilder } from "./meal-prep/session";

export async function registerRoutes(app: Express): Promise<Server> {
  // Setup authentication
  await setupAuth(app);

  // Register voice assistant routes
  app.use("/api/voice", voiceRoutes);

  // Mount API route modules at /api
  app.use("/api", authRoutes);
  app.use("/api", recipeImportRoutes);
  app.use("/api", recipesRoutes);
  app.use("/api", cookbooksRoutes);
  app.use("/api", groceryRoutes);
  app.use("/api", pantryRoutes);
  app.use("/api", bookmarksRoutes);
  app.use("/api", usersRoutes);
  app.use("/api", adminRoutes);
  app.use("/api", grammieRoutes);
  app.use("/api", mealPlanRoutes);
  app.use("/api", templateRoutes);
  app.use("/api", bulkIntakeRoutes);
  app.use("/api", cookbookPhotoRoutes);
  // Pay-as-you-go credits (inert until migrations/2026-10-credits.sql runs)
  startCredits();
  app.use("/api", creditsRoutes);
  // Meal prep; its cook pages (/api/meal-prep/cook/:token) need no account.
  setMealPrepEngines({ food: createFoodData(), planner: createPlanner(), session: createSessionBuilder() });
  app.use("/api/meal-prep", mealPrepRouter());

  // Mount print routes (has both /lulu/* and /api/print/* paths)
  // The /lulu/pdfs/:id route is public and not under /api
  // The /print/* routes are under /api
  app.use("/", printRoutes);

  // Mount social/OG routes at root (handles /og-image/*, /cookbook/:id, /recipe/:id)
  app.use("/", socialRoutes);

  const httpServer = createServer(app);
  return httpServer;
}
