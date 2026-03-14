import { Router } from "express";
import { z } from "zod";
import heicConvert from "heic-convert";
import { isAuthenticated } from "../clerkAuth";
import { storage } from "../storage";
import { parseVoiceIngredientsWithGemini } from "../gemini";
import { getUserId, upload, processPantryScan } from "./route-utils";

const router = Router();

// Get all pantry items for the current user
router.get("/pantry", isAuthenticated, async (req: any, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const items = await storage.getPantryItems(userId);
    res.json(items);
  } catch (error) {
    console.error("Error fetching pantry items:", error);
    res.status(500).json({ error: "Failed to fetch pantry items" });
  }
});

// Get all pantry items (alias for /api/pantry)
router.get("/pantry/items", isAuthenticated, async (req: any, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const items = await storage.getPantryItems(userId);
    res.json(items);
  } catch (error) {
    console.error("Error fetching pantry items:", error);
    res.status(500).json({ error: "Failed to fetch pantry items" });
  }
});

// Get pantry items grouped by category
router.get("/pantry/by-category", isAuthenticated, async (req: any, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const grouped = await storage.getPantryItemsByCategory(userId);
    res.json(grouped);
  } catch (error) {
    console.error("Error fetching pantry by category:", error);
    res.status(500).json({ error: "Failed to fetch pantry items" });
  }
});

// Add a pantry item manually
router.post("/pantry/items", isAuthenticated, async (req: any, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const schema = z.object({
      name: z.string().min(1),
      quantity: z.coerce.number().optional(),
      unit: z.string().optional(),
      category: z.string().optional(),
      emoji: z.string().optional(),
      expiresAt: z.string().optional(),
      notes: z.string().optional(),
    });

    const data = schema.parse(req.body);

    const item = await storage.addPantryItem({
      userId,
      name: data.name,
      quantity: data.quantity,
      unit: data.unit,
      category: data.category,
      emoji: data.emoji,
      expiresAt: data.expiresAt ? new Date(data.expiresAt) : undefined,
      notes: data.notes,
      source: 'manual',
    });

    res.status(201).json(item);
  } catch (error) {
    console.error("Error adding pantry item:", error);
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Invalid data", details: error.errors });
    }
    res.status(500).json({ error: "Failed to add pantry item" });
  }
});

router.post("/pantry/voice", isAuthenticated, async (req: any, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const schema = z.object({
      transcript: z.string().min(1, "Transcript is required"),
    });

    const { transcript } = schema.parse(req.body);

    console.log(`[Voice Pantry] Parsing transcript for user ${userId}: "${transcript.substring(0, 100)}..."`);

    const parsedItems = await parseVoiceIngredientsWithGemini(transcript);

    if (!parsedItems || parsedItems.length === 0) {
      return res.json({ items: [], message: "No ingredients detected in your speech. Try again!" });
    }

    const addedItems = [];
    for (const item of parsedItems) {
      try {
        const added = await storage.addPantryItem({
          userId,
          name: item.name,
          quantity: item.quantity,
          unit: item.unit,
          category: item.category || 'other',
          source: 'voice',
        });
        addedItems.push(added);
      } catch (err) {
        console.error(`[Voice Pantry] Failed to add item "${item.name}":`, err);
      }
    }

    console.log(`[Voice Pantry] Added ${addedItems.length}/${parsedItems.length} items for user ${userId}`);

    res.json({
      items: addedItems,
      parsed: parsedItems,
      message: `Added ${addedItems.length} item${addedItems.length !== 1 ? 's' : ''} to your pantry`,
    });
  } catch (error) {
    console.error("Error processing voice pantry input:", error);
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Invalid data", details: error.errors });
    }
    res.status(500).json({ error: "Failed to process voice input" });
  }
});

// Update a pantry item
router.patch("/pantry/items/:id", isAuthenticated, async (req: any, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const { id } = req.params;
    const schema = z.object({
      name: z.string().min(1).optional(),
      quantity: z.coerce.number().nullable().optional(),
      unit: z.string().nullable().optional(),
      category: z.string().nullable().optional(),
      emoji: z.string().nullable().optional(),
      expiresAt: z.string().nullable().optional(),
      notes: z.string().nullable().optional(),
    });

    const data = schema.parse(req.body);
    const updates: any = { ...data };
    if (data.expiresAt !== undefined) {
      updates.expiresAt = data.expiresAt ? new Date(data.expiresAt) : null;
    }

    const item = await storage.updatePantryItem(id, updates, userId);
    if (!item) {
      return res.status(404).json({ error: "Item not found" });
    }

    res.json(item);
  } catch (error) {
    console.error("Error updating pantry item:", error);
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Invalid data", details: error.errors });
    }
    res.status(500).json({ error: "Failed to update pantry item" });
  }
});

// Delete a pantry item
router.delete("/pantry/items/:id", isAuthenticated, async (req: any, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const { id } = req.params;
    await storage.deletePantryItem(id, userId);
    res.json({ message: "Item deleted" });
  } catch (error) {
    console.error("Error deleting pantry item:", error);
    res.status(500).json({ error: "Failed to delete item" });
  }
});

// Clear all pantry items
router.delete("/pantry", isAuthenticated, async (req: any, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    await storage.clearPantry(userId);
    res.json({ message: "Pantry cleared" });
  } catch (error) {
    console.error("Error clearing pantry:", error);
    res.status(500).json({ error: "Failed to clear pantry" });
  }
});

// Scan pantry with AI (upload image)
router.post("/pantry/scan", isAuthenticated, upload.single("image"), async (req: any, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    if (!req.file) {
      return res.status(400).json({ error: "No image provided" });
    }

    let imageBase64: string;
    const mimeType = req.file.mimetype;

    if (mimeType === 'image/heic' || mimeType === 'image/heif' ||
        req.file.originalname.toLowerCase().endsWith('.heic') ||
        req.file.originalname.toLowerCase().endsWith('.heif')) {
      const converted = await heicConvert({
        buffer: req.file.buffer,
        format: 'JPEG',
        quality: 0.85,
      });
      imageBase64 = `data:image/jpeg;base64,${Buffer.from(converted).toString('base64')}`;
    } else {
      imageBase64 = `data:${mimeType};base64,${req.file.buffer.toString('base64')}`;
    }

    const session = await storage.createPantryScanSession({
      userId,
      imageUrl: imageBase64,
      status: 'processing',
    });

    processPantryScan(session.id, imageBase64);

    res.status(202).json({
      sessionId: session.id,
      status: 'processing',
      message: 'Scanning pantry image...',
    });
  } catch (error) {
    console.error("Error starting pantry scan:", error);
    res.status(500).json({ error: "Failed to start scan" });
  }
});

// Get pantry scan session status
router.get("/pantry/scan/:sessionId", isAuthenticated, async (req: any, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const { sessionId } = req.params;
    const session = await storage.getPantryScanSession(sessionId, userId);

    if (!session) {
      return res.status(404).json({ error: "Session not found" });
    }

    res.json(session);
  } catch (error) {
    console.error("Error fetching scan session:", error);
    res.status(500).json({ error: "Failed to fetch session" });
  }
});

// Confirm extracted items from scan and add to pantry
router.post("/pantry/scan/:sessionId/confirm", isAuthenticated, async (req: any, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const { sessionId } = req.params;
    const session = await storage.getPantryScanSession(sessionId, userId);

    if (!session) {
      return res.status(404).json({ error: "Session not found" });
    }

    if (session.status !== 'ready') {
      return res.status(400).json({ error: "Scan not ready" });
    }

    const schema = z.object({
      items: z.array(z.object({
        name: z.string(),
        quantity: z.number().optional(),
        unit: z.string().optional(),
        category: z.string().optional(),
        emoji: z.string().optional(),
      })),
    });

    const { items } = schema.parse(req.body);

    const pantryItems = await storage.bulkAddPantryItems(
      items.map(item => ({
        userId,
        name: item.name,
        quantity: item.quantity,
        unit: item.unit,
        category: item.category,
        emoji: item.emoji,
        source: 'ai_vision' as const,
      }))
    );

    res.status(201).json({ added: pantryItems.length, items: pantryItems });
  } catch (error) {
    console.error("Error confirming scan items:", error);
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Invalid data", details: error.errors });
    }
    res.status(500).json({ error: "Failed to add items" });
  }
});

export default router;
