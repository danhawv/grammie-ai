import { Router } from "express";
import { z } from "zod";
import { isAuthenticated } from "../clerkAuth";
import { storage } from "../storage";
import { getUserId, upload } from "./route-utils";
import { customTemplateDataSchema } from "@shared/schema";
import { getMediaStorage } from "../lib/media-storage";
import { analyzeCookbookStyleWithGemini, isGeminiAvailable } from "../gemini";
import { templateFromStyleAnalysis, styleAnalysisPrompt } from "@shared/template-from-photos";

const router = Router();

// Base64 inflates binary by ~4/3; these caps match the upload endpoints'
// 2MB image / 1MB font limits so a direct save request can't bypass them
const MAX_IMAGE_DATA_CHARS = 2_800_000;
const MAX_FONT_DATA_CHARS = 1_400_000;

const backgroundImageSchema = z.string()
  .max(MAX_IMAGE_DATA_CHARS, 'backgroundImage exceeds the 2MB limit')
  .nullable()
  .optional();

const customFontsSchema = z.array(z.object({
  name: z.string().min(1).max(100),
  format: z.string().min(1).max(20),
  dataUrl: z.string().max(MAX_FONT_DATA_CHARS, 'font dataUrl exceeds the 1MB limit'),
})).max(4, 'At most 4 custom fonts per template');

// ============================================================================
// CUSTOM TEMPLATE CRUD
// ============================================================================

// List user's templates (optionally include public)
router.get("/templates", isAuthenticated, async (req: any, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const includePublic = req.query.includePublic === "true";
    const templates = await storage.getCustomTemplates(userId, includePublic);
    res.json(templates);
  } catch (error) {
    console.error("Error fetching templates:", error);
    res.status(500).json({ error: "Failed to fetch templates" });
  }
});

// Get single template
router.get("/templates/:id", isAuthenticated, async (req: any, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid template ID" });

    const template = await storage.getCustomTemplate(id);
    if (!template) return res.status(404).json({ error: "Template not found" });

    res.json(template);
  } catch (error) {
    console.error("Error fetching template:", error);
    res.status(500).json({ error: "Failed to fetch template" });
  }
});

// Create template
router.post("/templates", isAuthenticated, async (req: any, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const bodySchema = z.object({
      name: z.string().min(1).max(100),
      description: z.string().max(500).optional(),
      isPublic: z.boolean().optional(),
      templateData: customTemplateDataSchema,
      backgroundImage: backgroundImageSchema,
      customFonts: customFontsSchema.optional(),
    });

    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid template data", details: parsed.error.flatten() });
    }

    const template = await storage.createCustomTemplate({
      ownerUserId: userId,
      name: parsed.data.name,
      description: parsed.data.description || null,
      isPublic: parsed.data.isPublic ?? false,
      templateData: parsed.data.templateData,
      backgroundImage: parsed.data.backgroundImage || null,
      customFonts: parsed.data.customFonts || null,
    });

    res.status(201).json(template);
  } catch (error) {
    console.error("Error creating template:", error);
    res.status(500).json({ error: "Failed to create template" });
  }
});

// Create a template that matches photos of an existing cookbook or recipe card.
// The AI picks colors, fonts and a recipe page layout; the result is an
// ordinary custom template the user can edit afterwards.
router.post("/templates/from-photos", isAuthenticated, upload.array("images", 5), async (req: any, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    if (!isGeminiAvailable()) return res.status(503).json({ error: "AI is not configured" });

    const files = (req.files as Express.Multer.File[] | undefined) ?? [];
    const images = files.filter((f) => f.mimetype.startsWith("image/"));
    if (images.length === 0) return res.status(400).json({ error: "Add at least one photo" });

    let raw: any;
    try {
      raw = await analyzeCookbookStyleWithGemini(
        images.map((f) => f.buffer.toString("base64")),
        styleAnalysisPrompt(images.length),
      );
    } catch (err) {
      console.error("[templates/from-photos] analysis failed:", err);
      return res.status(502).json({ error: "Couldn't read the style from those photos. Try clearer, straight-on shots." });
    }

    const { name, description, templateData } = templateFromStyleAnalysis(raw ?? {});
    const template = await storage.createCustomTemplate({
      ownerUserId: userId,
      name,
      description,
      isPublic: false,
      templateData,
      backgroundImage: null,
      customFonts: null,
    });
    res.status(201).json(template);
  } catch (error) {
    console.error("Error creating template from photos:", error);
    res.status(500).json({ error: "Failed to create template" });
  }
});

// Update template
router.patch("/templates/:id", isAuthenticated, async (req: any, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid template ID" });

    const bodySchema = z.object({
      name: z.string().min(1).max(100).optional(),
      description: z.string().max(500).optional(),
      isPublic: z.boolean().optional(),
      templateData: customTemplateDataSchema.optional(),
      backgroundImage: backgroundImageSchema,
      customFonts: customFontsSchema.nullable().optional(),
      thumbnail: z.string().max(MAX_IMAGE_DATA_CHARS, 'thumbnail exceeds the 2MB limit').nullable().optional(),
    });

    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid update data", details: parsed.error.flatten() });
    }

    const template = await storage.updateCustomTemplate(id, parsed.data as any, userId);
    if (!template) {
      return res.status(404).json({ error: "Template not found or unauthorized" });
    }

    res.json(template);
  } catch (error) {
    console.error("Error updating template:", error);
    res.status(500).json({ error: "Failed to update template" });
  }
});

// Delete template
router.delete("/templates/:id", isAuthenticated, async (req: any, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid template ID" });

    // Deleting a template that a print project uses silently un-themes that
    // book (FK is ON DELETE SET NULL) — require explicit confirmation
    if (req.query.force !== 'true') {
      const projectCount = await storage.countPrintProjectsUsingTemplate(id);
      if (projectCount > 0) {
        return res.status(409).json({
          error: 'Template is in use',
          projectCount,
          message: `This template is used by ${projectCount} print project${projectCount === 1 ? '' : 's'}. Deleting it will reset ${projectCount === 1 ? 'that project' : 'those projects'} to the default style.`,
        });
      }
    }

    const deleted = await storage.deleteCustomTemplate(id, userId);
    if (!deleted) {
      return res.status(404).json({ error: "Template not found or unauthorized" });
    }

    res.status(204).send();
  } catch (error) {
    console.error("Error deleting template:", error);
    res.status(500).json({ error: "Failed to delete template" });
  }
});

// Duplicate a template (for using someone else's public template)
router.post("/templates/:id/duplicate", isAuthenticated, async (req: any, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid template ID" });

    const original = await storage.getCustomTemplate(id);
    if (!original) return res.status(404).json({ error: "Template not found" });

    // Allow duplicating own templates or public templates
    if (original.ownerUserId !== userId && !original.isPublic) {
      return res.status(403).json({ error: "Cannot duplicate private template" });
    }

    const duplicate = await storage.createCustomTemplate({
      ownerUserId: userId,
      name: `${original.name} (Copy)`,
      description: original.description,
      isPublic: false,
      templateData: original.templateData,
      customFonts: original.customFonts,
      backgroundImage: original.backgroundImage,
    });

    res.status(201).json(duplicate);
  } catch (error) {
    console.error("Error duplicating template:", error);
    res.status(500).json({ error: "Failed to duplicate template" });
  }
});

// ============================================================================
// FONT & ASSET UPLOADS
// ============================================================================

// Upload background texture/pattern image
router.post("/templates/upload-background", isAuthenticated, upload.single("image"), async (req: any, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No image file provided" });
    }

    // Limit to 2MB
    if (req.file.size > 2 * 1024 * 1024) {
      return res.status(400).json({ error: "Image must be under 2MB" });
    }

    const mimeType = req.file.mimetype;
    if (!['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'].includes(mimeType)) {
      return res.status(400).json({ error: "Unsupported image format. Use PNG, JPEG, WebP, or SVG." });
    }

    // Store as a file when a media driver is configured; otherwise inline base64
    const media = getMediaStorage();
    if (media) {
      const { url } = await media.put(req.file.buffer, { contentType: mimeType, keyHint: 'template-bg' });
      return res.json({ dataUrl: url });
    }
    const dataUrl = `data:${mimeType};base64,${req.file.buffer.toString('base64')}`;
    res.json({ dataUrl });
  } catch (error) {
    console.error("Error uploading background:", error);
    res.status(500).json({ error: "Failed to upload background image" });
  }
});

// Upload custom font file
router.post("/templates/upload-font", isAuthenticated, upload.single("font"), async (req: any, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No font file provided" });
    }

    // Limit to 1MB
    if (req.file.size > 1 * 1024 * 1024) {
      return res.status(400).json({ error: "Font file must be under 1MB" });
    }

    const originalName = req.file.originalname || 'custom-font';
    const ext = originalName.split('.').pop()?.toLowerCase() || '';

    let format = 'truetype';
    let mimeType = 'font/ttf';
    if (ext === 'woff2') {
      format = 'woff2';
      mimeType = 'font/woff2';
    } else if (ext === 'woff') {
      format = 'woff';
      mimeType = 'font/woff';
    } else if (ext === 'otf') {
      format = 'opentype';
      mimeType = 'font/otf';
    }

    const media = getMediaStorage();
    const dataUrl = media
      ? (await media.put(req.file.buffer, { contentType: mimeType, keyHint: 'template-font' })).url
      : `data:${mimeType};base64,${req.file.buffer.toString('base64')}`;

    res.json({
      name: originalName.replace(/\.[^/.]+$/, ''),
      format,
      dataUrl,
    });
  } catch (error) {
    console.error("Error uploading font:", error);
    res.status(500).json({ error: "Failed to upload font file" });
  }
});

// ============================================================================
// GOOGLE FONTS API PROXY
// ============================================================================

let cachedFontList: any = null;
let fontListCachedAt = 0;
const FONT_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

router.get("/fonts/google", async (_req, res) => {
  try {
    // Return cached list if fresh
    if (cachedFontList && Date.now() - fontListCachedAt < FONT_CACHE_TTL) {
      return res.json(cachedFontList);
    }

    // Curated list of popular Google Fonts suitable for cookbooks
    // This avoids needing a Google Fonts API key
    const fonts = [
      // Serif
      { family: "Merriweather", category: "serif", variants: ["300", "400", "700", "900"] },
      { family: "Playfair Display", category: "serif", variants: ["400", "500", "600", "700", "800", "900"] },
      { family: "Lora", category: "serif", variants: ["400", "500", "600", "700"] },
      { family: "Source Serif Pro", category: "serif", variants: ["200", "300", "400", "600", "700", "900"] },
      { family: "EB Garamond", category: "serif", variants: ["400", "500", "600", "700", "800"] },
      { family: "Crimson Text", category: "serif", variants: ["400", "600", "700"] },
      { family: "Libre Baskerville", category: "serif", variants: ["400", "700"] },
      { family: "Cormorant Garamond", category: "serif", variants: ["300", "400", "500", "600", "700"] },
      { family: "Spectral", category: "serif", variants: ["200", "300", "400", "500", "600", "700", "800"] },
      { family: "PT Serif", category: "serif", variants: ["400", "700"] },
      { family: "Bitter", category: "serif", variants: ["100", "200", "300", "400", "500", "600", "700", "800", "900"] },
      { family: "Josefin Slab", category: "serif", variants: ["100", "200", "300", "400", "500", "600", "700"] },
      { family: "Cardo", category: "serif", variants: ["400", "700"] },
      { family: "Old Standard TT", category: "serif", variants: ["400", "700"] },
      { family: "Vollkorn", category: "serif", variants: ["400", "500", "600", "700", "800", "900"] },
      // Sans-Serif
      { family: "Inter", category: "sans-serif", variants: ["100", "200", "300", "400", "500", "600", "700", "800", "900"] },
      { family: "Open Sans", category: "sans-serif", variants: ["300", "400", "500", "600", "700", "800"] },
      { family: "Lato", category: "sans-serif", variants: ["100", "300", "400", "700", "900"] },
      { family: "Montserrat", category: "sans-serif", variants: ["100", "200", "300", "400", "500", "600", "700", "800", "900"] },
      { family: "Poppins", category: "sans-serif", variants: ["100", "200", "300", "400", "500", "600", "700", "800", "900"] },
      { family: "Raleway", category: "sans-serif", variants: ["100", "200", "300", "400", "500", "600", "700", "800", "900"] },
      { family: "Nunito", category: "sans-serif", variants: ["200", "300", "400", "500", "600", "700", "800", "900"] },
      { family: "Work Sans", category: "sans-serif", variants: ["100", "200", "300", "400", "500", "600", "700", "800", "900"] },
      { family: "Quicksand", category: "sans-serif", variants: ["300", "400", "500", "600", "700"] },
      { family: "DM Sans", category: "sans-serif", variants: ["100", "200", "300", "400", "500", "600", "700", "800", "900"] },
      { family: "Cabin", category: "sans-serif", variants: ["400", "500", "600", "700"] },
      { family: "Josefin Sans", category: "sans-serif", variants: ["100", "200", "300", "400", "500", "600", "700"] },
      // Display
      { family: "Abril Fatface", category: "display", variants: ["400"] },
      { family: "Lobster", category: "display", variants: ["400"] },
      { family: "Pacifico", category: "display", variants: ["400"] },
      { family: "Righteous", category: "display", variants: ["400"] },
      { family: "Fredoka One", category: "display", variants: ["400"] },
      { family: "Alfa Slab One", category: "display", variants: ["400"] },
      // Handwriting
      { family: "Caveat", category: "handwriting", variants: ["400", "500", "600", "700"] },
      { family: "Dancing Script", category: "handwriting", variants: ["400", "500", "600", "700"] },
      { family: "Parisienne", category: "handwriting", variants: ["400"] },
      { family: "Great Vibes", category: "handwriting", variants: ["400"] },
      { family: "Satisfy", category: "handwriting", variants: ["400"] },
      { family: "Sacramento", category: "handwriting", variants: ["400"] },
      { family: "Allura", category: "handwriting", variants: ["400"] },
      { family: "Kalam", category: "handwriting", variants: ["300", "400", "700"] },
    ];

    cachedFontList = { fonts };
    fontListCachedAt = Date.now();

    res.json({ fonts });
  } catch (error) {
    console.error("Error fetching fonts:", error);
    res.status(500).json({ error: "Failed to fetch font list" });
  }
});

export default router;
