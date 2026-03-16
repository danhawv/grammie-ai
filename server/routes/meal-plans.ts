import { Router } from "express";
import { z } from "zod";
import { isAuthenticated } from "../clerkAuth";
import { storage } from "../storage";
import { getUserId } from "./route-utils";

const router = Router();

// ============================================================================
// MEAL PLAN CRUD
// ============================================================================

// List user's meal plans
router.get("/meal-plans", isAuthenticated, async (req: any, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const status = (req.query.status as string) || 'active';
    const includeTemplates = req.query.includeTemplates === 'true';

    const plans = await storage.getUserMealPlans(userId, status, includeTemplates);
    res.json(plans);
  } catch (error) {
    console.error("Error fetching meal plans:", error);
    res.status(500).json({ error: "Failed to fetch meal plans" });
  }
});

// Get meal plan templates
router.get("/meal-plans/templates", isAuthenticated, async (req: any, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const templates = await storage.getUserMealPlanTemplates(userId);
    res.json(templates);
  } catch (error) {
    console.error("Error fetching templates:", error);
    res.status(500).json({ error: "Failed to fetch templates" });
  }
});

// Create meal plan
router.post("/meal-plans", isAuthenticated, async (req: any, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const schema = z.object({
      name: z.string().min(1).max(100),
      description: z.string().optional(),
      startDate: z.string().transform(s => new Date(s)),
      endDate: z.string().transform(s => new Date(s)),
    });

    const data = schema.parse(req.body);

    const plan = await storage.createMealPlan({
      ...data,
      ownerUserId: userId,
      status: 'active',
      isTemplate: false,
    });

    res.status(201).json(plan);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Invalid input", details: error.errors });
    }
    console.error("Error creating meal plan:", error);
    res.status(500).json({ error: "Failed to create meal plan" });
  }
});

// Get single meal plan with entries
router.get("/meal-plans/:id", isAuthenticated, async (req: any, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const plan = await storage.getMealPlan(req.params.id, userId);
    if (!plan) return res.status(404).json({ error: "Meal plan not found" });

    res.json(plan);
  } catch (error) {
    console.error("Error fetching meal plan:", error);
    res.status(500).json({ error: "Failed to fetch meal plan" });
  }
});

// Update meal plan
router.patch("/meal-plans/:id", isAuthenticated, async (req: any, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const schema = z.object({
      name: z.string().min(1).max(100).optional(),
      description: z.string().optional(),
      startDate: z.string().transform(s => new Date(s)).optional(),
      endDate: z.string().transform(s => new Date(s)).optional(),
      status: z.enum(['active', 'archived']).optional(),
    });

    const data = schema.parse(req.body);
    const plan = await storage.updateMealPlan(req.params.id, data, userId);
    if (!plan) return res.status(404).json({ error: "Meal plan not found" });

    res.json(plan);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Invalid input", details: error.errors });
    }
    console.error("Error updating meal plan:", error);
    res.status(500).json({ error: "Failed to update meal plan" });
  }
});

// Delete meal plan
router.delete("/meal-plans/:id", isAuthenticated, async (req: any, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const success = await storage.deleteMealPlan(req.params.id, userId);
    if (!success) return res.status(404).json({ error: "Meal plan not found" });

    res.json({ success: true });
  } catch (error) {
    console.error("Error deleting meal plan:", error);
    res.status(500).json({ error: "Failed to delete meal plan" });
  }
});

// ============================================================================
// MEAL PLAN ENTRIES (recipe assignments to slots)
// ============================================================================

// Add entry to meal plan
router.post("/meal-plans/:id/entries", isAuthenticated, async (req: any, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    // Verify access
    const canEdit = await storage.canEditMealPlan(req.params.id, userId);
    if (!canEdit) return res.status(403).json({ error: "No edit access to this meal plan" });

    const schema = z.object({
      date: z.string().transform(s => new Date(s)),
      mealSlot: z.enum(['breakfast', 'lunch', 'dinner', 'snack']),
      recipeId: z.string().optional(),
      customMealName: z.string().optional(),
      scaledServings: z.number().int().min(1).optional(),
      notes: z.string().optional(),
      isLeftover: z.boolean().optional(),
      leftoverFromEntryId: z.string().optional(),
    });

    const data = schema.parse(req.body);

    if (!data.recipeId && !data.customMealName) {
      return res.status(400).json({ error: "Either recipeId or customMealName is required" });
    }

    const entry = await storage.addMealPlanEntry({
      mealPlanId: req.params.id,
      ...data,
      position: 0,
      isLeftover: data.isLeftover ?? false,
    });

    res.status(201).json(entry);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Invalid input", details: error.errors });
    }
    console.error("Error adding meal plan entry:", error);
    res.status(500).json({ error: "Failed to add entry" });
  }
});

// Update entry
router.patch("/meal-plans/:id/entries/:entryId", isAuthenticated, async (req: any, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const canEdit = await storage.canEditMealPlan(req.params.id, userId);
    if (!canEdit) return res.status(403).json({ error: "No edit access" });

    const schema = z.object({
      scaledServings: z.number().int().min(1).optional(),
      notes: z.string().optional(),
      isLeftover: z.boolean().optional(),
      leftoverFromEntryId: z.string().optional(),
      assignedUserId: z.string().optional(),
      customMealName: z.string().optional(),
    });

    const data = schema.parse(req.body);
    const entry = await storage.updateMealPlanEntry(req.params.entryId, data);
    if (!entry) return res.status(404).json({ error: "Entry not found" });

    res.json(entry);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Invalid input", details: error.errors });
    }
    console.error("Error updating entry:", error);
    res.status(500).json({ error: "Failed to update entry" });
  }
});

// Move entry (drag-and-drop)
router.patch("/meal-plans/:id/entries/:entryId/move", isAuthenticated, async (req: any, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const canEdit = await storage.canEditMealPlan(req.params.id, userId);
    if (!canEdit) return res.status(403).json({ error: "No edit access" });

    const schema = z.object({
      date: z.string().transform(s => new Date(s)),
      mealSlot: z.enum(['breakfast', 'lunch', 'dinner', 'snack']),
      position: z.number().int().min(0).default(0),
    });

    const data = schema.parse(req.body);
    const entry = await storage.moveMealPlanEntry(req.params.entryId, data.date, data.mealSlot, data.position);
    if (!entry) return res.status(404).json({ error: "Entry not found" });

    res.json(entry);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Invalid input", details: error.errors });
    }
    console.error("Error moving entry:", error);
    res.status(500).json({ error: "Failed to move entry" });
  }
});

// Delete entry
router.delete("/meal-plans/:id/entries/:entryId", isAuthenticated, async (req: any, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const canEdit = await storage.canEditMealPlan(req.params.id, userId);
    if (!canEdit) return res.status(403).json({ error: "No edit access" });

    const success = await storage.removeMealPlanEntry(req.params.entryId);
    if (!success) return res.status(404).json({ error: "Entry not found" });

    res.json({ success: true });
  } catch (error) {
    console.error("Error removing entry:", error);
    res.status(500).json({ error: "Failed to remove entry" });
  }
});

// ============================================================================
// GROCERY LIST GENERATION
// ============================================================================

router.post("/meal-plans/:id/generate-grocery-list", isAuthenticated, async (req: any, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const canEdit = await storage.canEditMealPlan(req.params.id, userId);
    if (!canEdit) return res.status(403).json({ error: "No edit access" });

    const schema = z.object({
      excludeLeftovers: z.boolean().default(true),
      excludePantryItems: z.boolean().default(false),
      mode: z.enum(['create_new', 'add_to_existing']).default('create_new'),
    });

    const options = schema.parse(req.body || {});

    const groceryList = await storage.generateGroceryListFromMealPlan(
      req.params.id,
      userId,
      options,
    );

    res.json({ success: true, groceryListId: groceryList.id });
  } catch (error) {
    console.error("Error generating grocery list:", error);
    res.status(500).json({ error: "Failed to generate grocery list" });
  }
});

// ============================================================================
// NUTRITION SUMMARY
// ============================================================================

router.get("/meal-plans/:id/nutrition", isAuthenticated, async (req: any, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const plan = await storage.getMealPlan(req.params.id, userId);
    if (!plan) return res.status(404).json({ error: "Meal plan not found" });

    // Calculate nutrition from entries
    const summary = calculateNutritionSummary(plan.entries);
    res.json(summary);
  } catch (error) {
    console.error("Error calculating nutrition:", error);
    res.status(500).json({ error: "Failed to calculate nutrition" });
  }
});

// ============================================================================
// SUGGESTIONS
// ============================================================================

router.get("/meal-plans/:id/suggestions", isAuthenticated, async (req: any, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const plan = await storage.getMealPlan(req.params.id, userId);
    if (!plan) return res.status(404).json({ error: "Meal plan not found" });

    const mealSlot = req.query.mealSlot as string | undefined;

    // Collect all ingredient items from planned recipes
    const plannedIngredients = new Set<string>();
    const plannedRecipeIds = new Set<string>();

    for (const entry of plan.entries) {
      if (entry.recipe?.normalizedIngredients) {
        plannedRecipeIds.add(entry.recipe.id);
        for (const ing of entry.recipe.normalizedIngredients as any[]) {
          if (ing.item) plannedIngredients.add(ing.item.toLowerCase());
        }
      }
    }

    // Get user's recipes to suggest from
    const allRecipes = await storage.getAllRecipes(userId);

    // Score by ingredient overlap
    const suggestions = allRecipes
      .filter(r => !plannedRecipeIds.has(r.id))
      .filter(r => !mealSlot || (r.mealType && r.mealType.includes(mealSlot)))
      .map(recipe => {
        const recipeIngredients = (recipe.normalizedIngredients as any[] || [])
          .map((i: any) => i.item?.toLowerCase())
          .filter(Boolean);
        const shared = recipeIngredients.filter((i: string) => plannedIngredients.has(i));
        return {
          recipe: {
            id: recipe.id,
            title: recipe.title,
            description: recipe.description,
            dishImageThumbnail: recipe.dishImageThumbnail,
            totalTime: recipe.totalTime,
            servings: recipe.servings,
            mealType: recipe.mealType,
          },
          overlapCount: shared.length,
          sharedIngredients: shared,
        };
      })
      .filter(s => s.overlapCount > 0)
      .sort((a, b) => b.overlapCount - a.overlapCount)
      .slice(0, 10);

    res.json(suggestions);
  } catch (error) {
    console.error("Error getting suggestions:", error);
    res.status(500).json({ error: "Failed to get suggestions" });
  }
});

// ============================================================================
// TEMPLATES
// ============================================================================

router.post("/meal-plans/:id/save-as-template", isAuthenticated, async (req: any, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const schema = z.object({
      templateName: z.string().min(1).max(100),
    });

    const { templateName } = schema.parse(req.body);
    const template = await storage.saveMealPlanAsTemplate(req.params.id, templateName, userId);

    res.status(201).json(template);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Invalid input", details: error.errors });
    }
    console.error("Error saving template:", error);
    res.status(500).json({ error: "Failed to save template" });
  }
});

router.post("/meal-plans/from-template/:templateId", isAuthenticated, async (req: any, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const schema = z.object({
      startDate: z.string().transform(s => new Date(s)),
      name: z.string().min(1).max(100).optional(),
    });

    const data = schema.parse(req.body);
    const plan = await storage.createMealPlanFromTemplate(
      req.params.templateId,
      data.startDate,
      userId,
      data.name,
    );

    res.status(201).json(plan);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Invalid input", details: error.errors });
    }
    console.error("Error creating from template:", error);
    res.status(500).json({ error: "Failed to create from template" });
  }
});

// ============================================================================
// COLLABORATION
// ============================================================================

router.get("/meal-plans/:id/collaborators", isAuthenticated, async (req: any, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const collaborators = await storage.getMealPlanCollaborators(req.params.id);
    res.json(collaborators);
  } catch (error) {
    console.error("Error fetching collaborators:", error);
    res.status(500).json({ error: "Failed to fetch collaborators" });
  }
});

router.post("/meal-plans/:id/invite", isAuthenticated, async (req: any, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    // Only owner can invite
    const plan = await storage.getMealPlan(req.params.id, userId);
    if (!plan || plan.ownerUserId !== userId) {
      return res.status(403).json({ error: "Only the owner can invite collaborators" });
    }

    const schema = z.object({
      email: z.string().email(),
      role: z.enum(['editor', 'viewer']).default('editor'),
      message: z.string().optional(),
    });

    const data = schema.parse(req.body);

    // Generate secure token
    const crypto = await import("node:crypto");
    const token = crypto.randomBytes(32).toString('hex');

    // Check if invitee is already a user
    const invitee = await storage.findUserByEmailOrUsername(data.email);

    const invitation = await storage.createMealPlanInvitation({
      mealPlanId: req.params.id,
      inviterUserId: userId,
      inviteeEmail: data.email,
      inviteeUserId: invitee?.id,
      status: 'pending',
      token,
      message: data.message,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
    });

    res.status(201).json(invitation);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Invalid input", details: error.errors });
    }
    console.error("Error inviting collaborator:", error);
    res.status(500).json({ error: "Failed to invite collaborator" });
  }
});

router.delete("/meal-plans/:id/collaborators/:userId", isAuthenticated, async (req: any, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const success = await storage.removeMealPlanCollaborator(req.params.id, req.params.userId, userId);
    if (!success) return res.status(404).json({ error: "Collaborator not found" });

    res.json({ success: true });
  } catch (error) {
    console.error("Error removing collaborator:", error);
    res.status(500).json({ error: "Failed to remove collaborator" });
  }
});

// Get user's pending invitations
router.get("/meal-plan-invitations", isAuthenticated, async (req: any, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const invitations = await storage.getUserMealPlanInvitations(userId);
    res.json(invitations);
  } catch (error) {
    console.error("Error fetching invitations:", error);
    res.status(500).json({ error: "Failed to fetch invitations" });
  }
});

// Respond to invitation
router.post("/meal-plan-invitations/:invitationId/respond", isAuthenticated, async (req: any, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const schema = z.object({ accept: z.boolean() });
    const { accept } = schema.parse(req.body);

    const success = await storage.respondToMealPlanInvitation(
      parseInt(req.params.invitationId),
      userId,
      accept,
    );

    if (!success) return res.status(404).json({ error: "Invitation not found" });
    res.json({ success: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Invalid input", details: error.errors });
    }
    console.error("Error responding to invitation:", error);
    res.status(500).json({ error: "Failed to respond to invitation" });
  }
});

// ============================================================================
// HELPER: Nutrition Calculation
// ============================================================================

function calculateNutritionSummary(entries: any[]): any {
  const daily: Record<string, any> = {};
  let budgetMin = 0;
  let budgetMax = 0;

  const emptyMealBreakdown = () => ({
    breakfast: { calories: 0, protein: 0, carbs: 0, fat: 0 },
    lunch: { calories: 0, protein: 0, carbs: 0, fat: 0 },
    dinner: { calories: 0, protein: 0, carbs: 0, fat: 0 },
    snack: { calories: 0, protein: 0, carbs: 0, fat: 0 },
  });

  for (const entry of entries) {
    if (entry.isLeftover || !entry.recipe) continue;

    const dateKey = new Date(entry.date).toISOString().split('T')[0];
    if (!daily[dateKey]) {
      daily[dateKey] = {
        calories: 0, protein: 0, carbs: 0, fat: 0,
        fiber: 0, sugar: 0, sodium: 0,
        mealBreakdown: emptyMealBreakdown(),
      };
    }

    const r = entry.recipe;
    const day = daily[dateKey];
    const slot = entry.mealSlot as 'breakfast' | 'lunch' | 'dinner' | 'snack';
    const meal = day.mealBreakdown[slot];

    // Per-serving nutrition (doesn't scale with servings — that's for grocery quantities)
    day.calories += r.calories || 0;
    day.protein += r.protein || 0;
    day.carbs += r.carbohydrates || 0;
    day.fat += r.fat || 0;
    day.fiber += r.fiber || 0;
    day.sugar += r.sugar || 0;
    day.sodium += r.sodium || 0;

    meal.calories += r.calories || 0;
    meal.protein += r.protein || 0;
    meal.carbs += r.carbohydrates || 0;
    meal.fat += r.fat || 0;

    // Budget scales with servings
    const scaleFactor = (entry.scaledServings || r.servings || 1) / (r.servings || 1);
    budgetMin += (r.priceRangeMin || 0) * scaleFactor;
    budgetMax += (r.priceRangeMax || 0) * scaleFactor;
  }

  // Weekly average
  const dayCount = Object.keys(daily).length || 1;
  const sumField = (field: string) =>
    Object.values(daily).reduce((sum: number, d: any) => sum + (d[field] || 0), 0);

  return {
    daily,
    weeklyAverage: {
      calories: Math.round(sumField('calories') / dayCount),
      protein: Math.round(sumField('protein') / dayCount),
      carbs: Math.round(sumField('carbs') / dayCount),
      fat: Math.round(sumField('fat') / dayCount),
      fiber: Math.round(sumField('fiber') / dayCount),
    },
    budgetEstimate: {
      min: Math.round(budgetMin * 100) / 100,
      max: Math.round(budgetMax * 100) / 100,
    },
  };
}

export default router;
