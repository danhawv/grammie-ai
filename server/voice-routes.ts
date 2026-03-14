import { Router } from "express";
import crypto from "node:crypto";
import { db } from "./db";
import { eq, and, gt, desc } from "drizzle-orm";
import {
  voiceSessions,
  pantryItems,
  users,
  recipes,
  voiceAddPantryItemSchema,
  voiceGetPantrySchema,
  voiceUpdatePreferencesSchema,
  voiceCreateRecipeSchema,
  type VoiceSession,
} from "@shared/schema";
import { isAuthenticated } from "./clerkAuth";
import { jobQueue } from "./job-queue";

function getUserId(req: any): string | undefined {
  return req.user?.claims?.sub;
}

const router = Router();

const SESSION_EXPIRY_MS = 30 * 60 * 1000; // 30 minutes
const MAX_REQUESTS_PER_SESSION = 100; // Rate limit per session

const sessionRequestCounts = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(token: string): boolean {
  const now = Date.now();
  const entry = sessionRequestCounts.get(token);
  
  if (!entry || entry.resetAt < now) {
    sessionRequestCounts.set(token, { count: 1, resetAt: now + 60000 });
    return true;
  }
  
  if (entry.count >= MAX_REQUESTS_PER_SESSION) {
    return false;
  }
  
  entry.count++;
  return true;
}

async function validateVoiceToken(token: string): Promise<VoiceSession | null> {
  if (!token || token.length < 32) return null;
  
  const session = await db.query.voiceSessions.findFirst({
    where: and(
      eq(voiceSessions.token, token),
      gt(voiceSessions.expiresAt, new Date())
    ),
  });
  
  return session || null;
}

async function validateVoiceRequest(req: any, res: any): Promise<VoiceSession | null> {
  const authHeader = req.headers.authorization;
  const token = authHeader?.replace("Bearer ", "");
  
  if (!token) {
    res.status(401).json({ error: "Missing voice session token" });
    return null;
  }

  if (!checkRateLimit(token)) {
    res.status(429).json({ error: "Rate limit exceeded. Please slow down." });
    return null;
  }

  const session = await validateVoiceToken(token);
  if (!session) {
    res.status(401).json({ error: "Invalid or expired voice session" });
    return null;
  }

  return session;
}

router.post("/session/start", isAuthenticated, async (req, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    const { mode = "general", recipeId } = req.body;

    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + SESSION_EXPIRY_MS);

    const [session] = await db.insert(voiceSessions).values({
      userId,
      token,
      mode,
      recipeId: mode === "cooking" ? recipeId : null,
      expiresAt,
    }).returning();

    const user = await db.query.users.findFirst({
      where: eq(users.id, userId),
    });

    const preferences = user?.preferences || {};

    res.json({
      token: session.token,
      expiresAt: session.expiresAt,
      userContext: {
        name: user?.firstName || user?.username || "there",
        preferences: {
          allergies: preferences.allergies || [],
          dietaryRestrictions: preferences.dietaryRestrictions || [],
          dislikedIngredients: preferences.dislikedIngredients || [],
          cookingSkillLevel: preferences.cookingSkillLevel || "intermediate",
          cuisinePreferences: preferences.cuisinePreferences || [],
          householdSize: preferences.householdSize || 2,
          cookingGoals: preferences.cookingGoals || [],
          grammieNotes: preferences.grammieNotes || "",
          unitSystem: preferences.unitSystem || "us",
        },
      },
    });
  } catch (error) {
    console.error("Error starting voice session:", error);
    res.status(500).json({ error: "Failed to start voice session" });
  }
});

router.post("/session/end", isAuthenticated, async (req, res) => {
  try {
    const { token } = req.body;
    
    if (token) {
      await db.delete(voiceSessions).where(eq(voiceSessions.token, token));
    }
    
    res.json({ success: true });
  } catch (error) {
    console.error("Error ending voice session:", error);
    res.status(500).json({ error: "Failed to end voice session" });
  }
});

router.post("/pantry/add", async (req, res) => {
  try {
    const session = await validateVoiceRequest(req, res);
    if (!session) return;

    const parsed = voiceAddPantryItemSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
    }

    const { items } = parsed.data;
    const addedItems = [];

    for (const item of items) {
      const emoji = getEmojiForItem(item.name);
      const category = item.category || guessCategoryFromName(item.name);

      const [newItem] = await db.insert(pantryItems).values({
        userId: session.userId,
        name: item.name,
        quantity: item.quantity,
        unit: item.unit,
        category,
        emoji,
        source: "manual",
        normalizedName: item.name.toLowerCase().trim(),
      }).returning();

      addedItems.push(newItem);
    }

    res.json({
      success: true,
      message: `Added ${addedItems.length} item${addedItems.length !== 1 ? "s" : ""} to your pantry`,
      items: addedItems.map(i => ({ id: i.id, name: i.name, category: i.category })),
    });
  } catch (error) {
    console.error("Error adding pantry items via voice:", error);
    res.status(500).json({ error: "Failed to add pantry items" });
  }
});

router.post("/pantry/list", async (req, res) => {
  try {
    const session = await validateVoiceRequest(req, res);
    if (!session) return;

    const parsed = voiceGetPantrySchema.safeParse(req.body);
    const { category, limit = 20 } = parsed.success ? parsed.data : { limit: 20 };

    let query = db.select({
      id: pantryItems.id,
      name: pantryItems.name,
      quantity: pantryItems.quantity,
      unit: pantryItems.unit,
      category: pantryItems.category,
      emoji: pantryItems.emoji,
    })
    .from(pantryItems)
    .where(eq(pantryItems.userId, session.userId))
    .orderBy(desc(pantryItems.createdAt))
    .limit(limit);

    const items = await query;

    const groupedByCategory: Record<string, string[]> = {};
    for (const item of items) {
      const cat = item.category || "Other";
      if (!groupedByCategory[cat]) groupedByCategory[cat] = [];
      const desc = item.quantity && item.unit 
        ? `${item.quantity} ${item.unit} ${item.name}`
        : item.name;
      groupedByCategory[cat].push(desc);
    }

    res.json({
      success: true,
      totalItems: items.length,
      byCategory: groupedByCategory,
      items: items.map(i => ({
        name: i.name,
        quantity: i.quantity,
        unit: i.unit,
        category: i.category,
      })),
    });
  } catch (error) {
    console.error("Error listing pantry via voice:", error);
    res.status(500).json({ error: "Failed to list pantry items" });
  }
});

router.post("/preferences/get", async (req, res) => {
  try {
    const session = await validateVoiceRequest(req, res);
    if (!session) return;

    const user = await db.query.users.findFirst({
      where: eq(users.id, session.userId),
    });

    const prefs = user?.preferences || {};

    res.json({
      success: true,
      preferences: {
        allergies: prefs.allergies || [],
        dietaryRestrictions: prefs.dietaryRestrictions || [],
        dislikedIngredients: prefs.dislikedIngredients || [],
        cookingSkillLevel: prefs.cookingSkillLevel || "intermediate",
        cuisinePreferences: prefs.cuisinePreferences || [],
        householdSize: prefs.householdSize || 2,
        cookingGoals: prefs.cookingGoals || [],
        grammieNotes: prefs.grammieNotes || "",
        unitSystem: prefs.unitSystem || "us",
      },
    });
  } catch (error) {
    console.error("Error getting preferences via voice:", error);
    res.status(500).json({ error: "Failed to get preferences" });
  }
});

router.post("/preferences/update", async (req, res) => {
  try {
    const session = await validateVoiceRequest(req, res);
    if (!session) return;

    const parsed = voiceUpdatePreferencesSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
    }

    const updates = parsed.data;

    const user = await db.query.users.findFirst({
      where: eq(users.id, session.userId),
    });

    const currentPrefs = user?.preferences || {};
    const newPrefs = {
      ...currentPrefs,
      ...Object.fromEntries(
        Object.entries(updates).filter(([_, v]) => v !== undefined)
      ),
    };

    await db.update(users)
      .set({ 
        preferences: newPrefs,
        updatedAt: new Date(),
      })
      .where(eq(users.id, session.userId));

    const updatedFields = Object.keys(updates).filter(k => updates[k as keyof typeof updates] !== undefined);

    res.json({
      success: true,
      message: `Updated your preferences: ${updatedFields.join(", ")}`,
      preferences: newPrefs,
    });
  } catch (error) {
    console.error("Error updating preferences via voice:", error);
    res.status(500).json({ error: "Failed to update preferences" });
  }
});

router.post("/recipe/create", async (req, res) => {
  try {
    const session = await validateVoiceRequest(req, res);
    if (!session) return;

    const parsed = voiceCreateRecipeSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
    }

    const recipeData = parsed.data;

    const [newRecipe] = await db.insert(recipes).values({
      title: recipeData.title,
      description: recipeData.description || `Recipe created via voice assistant`,
      ingredients: recipeData.ingredients,
      instructions: recipeData.instructions,
      prepTime: recipeData.prepTime || "Unknown",
      totalTime: recipeData.prepTime || "Unknown",
      cookTime: recipeData.cookTime,
      servings: recipeData.servings || 4,
      cuisines: recipeData.cuisine ? [recipeData.cuisine] : [],
      notes: recipeData.notes,
      ownerUserId: session.userId,
      visibility: "private",
      enrichmentStatus: "extracting",
    } as any).returning();

    jobQueue.addEnrichmentJob(newRecipe.id);

    res.json({
      success: true,
      message: `Created recipe "${recipeData.title}" and queued for AI enrichment`,
      recipe: {
        id: newRecipe.id,
        title: newRecipe.title,
        servings: newRecipe.servings,
      },
    });
  } catch (error) {
    console.error("Error creating recipe via voice:", error);
    res.status(500).json({ error: "Failed to create recipe" });
  }
});

router.get("/session/validate", async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader?.replace("Bearer ", "");
    
    if (!token) {
      return res.status(401).json({ valid: false, error: "Missing token" });
    }

    const session = await validateVoiceToken(token);
    if (!session) {
      return res.status(401).json({ valid: false, error: "Invalid or expired session" });
    }

    res.json({ 
      valid: true, 
      userId: session.userId,
      mode: session.mode,
      expiresAt: session.expiresAt,
    });
  } catch (error) {
    console.error("Error validating voice session:", error);
    res.status(500).json({ valid: false, error: "Validation failed" });
  }
});

function getEmojiForItem(name: string): string {
  const emojiMap: Record<string, string> = {
    milk: "🥛",
    eggs: "🥚",
    egg: "🥚",
    butter: "🧈",
    cheese: "🧀",
    bread: "🍞",
    chicken: "🍗",
    beef: "🥩",
    pork: "🥓",
    fish: "🐟",
    salmon: "🐟",
    shrimp: "🦐",
    apple: "🍎",
    banana: "🍌",
    orange: "🍊",
    lemon: "🍋",
    tomato: "🍅",
    potato: "🥔",
    carrot: "🥕",
    onion: "🧅",
    garlic: "🧄",
    broccoli: "🥦",
    lettuce: "🥬",
    spinach: "🥬",
    rice: "🍚",
    pasta: "🍝",
    flour: "🌾",
    sugar: "🍬",
    salt: "🧂",
    pepper: "🌶️",
    oil: "🫒",
    olive: "🫒",
    wine: "🍷",
    coffee: "☕",
    tea: "🍵",
    water: "💧",
  };
  
  const lower = name.toLowerCase();
  for (const [key, emoji] of Object.entries(emojiMap)) {
    if (lower.includes(key)) return emoji;
  }
  return "🍴";
}

function guessCategoryFromName(name: string): string {
  const lower = name.toLowerCase();
  
  const categoryMap: Record<string, string[]> = {
    "Dairy": ["milk", "cheese", "butter", "yogurt", "cream", "sour cream", "cottage"],
    "Produce": ["apple", "banana", "orange", "lemon", "tomato", "potato", "carrot", "onion", "garlic", "broccoli", "lettuce", "spinach", "cucumber", "pepper", "celery", "mushroom"],
    "Meat": ["chicken", "beef", "pork", "steak", "bacon", "ham", "turkey", "sausage", "ground"],
    "Seafood": ["fish", "salmon", "shrimp", "tuna", "cod", "tilapia", "crab", "lobster"],
    "Eggs": ["egg"],
    "Grains": ["rice", "pasta", "bread", "flour", "oats", "cereal", "quinoa", "noodle"],
    "Pantry": ["oil", "vinegar", "sugar", "salt", "pepper", "spice", "sauce", "broth", "stock", "canned"],
    "Frozen": ["frozen", "ice cream"],
    "Beverages": ["juice", "soda", "water", "coffee", "tea", "wine", "beer"],
    "Condiments": ["ketchup", "mustard", "mayo", "mayonnaise", "dressing", "salsa"],
  };
  
  for (const [category, keywords] of Object.entries(categoryMap)) {
    for (const keyword of keywords) {
      if (lower.includes(keyword)) return category;
    }
  }
  
  return "Other";
}

export default router;
