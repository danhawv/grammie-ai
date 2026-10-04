import { Router } from "express";
import sharp from "sharp";
import { and, count, eq } from "drizzle-orm";
import { isAuthenticated } from "../clerkAuth";
import { storage } from "../storage";
import { db } from "../db";
import { cookbookPhotos } from "@shared/schema";
import { getUserId, upload } from "./route-utils";

// Family photos for printed cookbooks: upload, view and delete. Placement
// (which recipe each photo goes under) lives in the print layout; see
// POST /cookbooks/:id/photos/place in cookbooks.ts.

const router = Router();

const MAX_PHOTOS_PER_COOKBOOK = 200;
/** Long side for print copies: ~300 DPI at 8in, the widest a photo prints */
const PRINT_MAX_PX = 2400;
const THUMB_MAX_PX = 600;

async function ownedCookbook(cookbookId: number, userId: string) {
  const cookbook = await storage.getCookbook(cookbookId);
  return cookbook && cookbook.ownerUserId === userId ? cookbook : null;
}

router.post("/cookbooks/:id/photos", isAuthenticated, upload.array("photos", 10), async (req: any, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    const cookbookId = parseInt(req.params.id);
    if (!(await ownedCookbook(cookbookId, userId))) return res.status(403).json({ error: "Not authorized" });

    const files = (req.files as Express.Multer.File[] | undefined) ?? [];
    const [{ value: existing }] = await db.select({ value: count() }).from(cookbookPhotos).where(eq(cookbookPhotos.cookbookId, cookbookId));
    const room = MAX_PHOTOS_PER_COOKBOOK - Number(existing);
    if (room <= 0) return res.status(400).json({ error: `A cookbook can hold up to ${MAX_PHOTOS_PER_COOKBOOK} photos` });

    const added: { id: string; width: number; height: number }[] = [];
    const failed: string[] = [];
    for (const file of files.slice(0, room)) {
      try {
        // rotate() applies the phone's EXIF orientation before it's stripped
        const base = sharp(file.buffer, { failOn: "none" }).rotate();
        const { data: print, info } = await base.clone()
          .resize({ width: PRINT_MAX_PX, height: PRINT_MAX_PX, fit: "inside", withoutEnlargement: true })
          .jpeg({ quality: 86, mozjpeg: true })
          .toBuffer({ resolveWithObject: true });
        const thumb = await base.clone()
          .resize({ width: THUMB_MAX_PX, height: THUMB_MAX_PX, fit: "inside", withoutEnlargement: true })
          .jpeg({ quality: 76 })
          .toBuffer();
        const [row] = await db.insert(cookbookPhotos).values({
          cookbookId,
          ownerUserId: userId,
          image: `data:image/jpeg;base64,${print.toString("base64")}`,
          thumbnail: `data:image/jpeg;base64,${thumb.toString("base64")}`,
          width: info.width,
          height: info.height,
        }).returning({ id: cookbookPhotos.id, width: cookbookPhotos.width, height: cookbookPhotos.height });
        added.push(row);
      } catch (err) {
        console.error("[cookbook-photos] could not process", file.originalname, err);
        failed.push(file.originalname);
      }
    }
    res.status(201).json({ added, failed, skipped: Math.max(0, files.length - room) });
  } catch (error) {
    console.error("Error uploading cookbook photos:", error);
    res.status(500).json({ error: "Failed to upload photos" });
  }
});

// Serves a photo as an image (thumbnail by default, ?size=full for print copy)
router.get("/cookbook-photos/:photoId", isAuthenticated, async (req: any, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    const full = req.query.size === "full";
    const [row] = await db
      .select({
        ownerUserId: cookbookPhotos.ownerUserId,
        data: full ? cookbookPhotos.image : cookbookPhotos.thumbnail,
      })
      .from(cookbookPhotos)
      .where(eq(cookbookPhotos.id, req.params.photoId));
    if (!row || row.ownerUserId !== userId) return res.status(404).json({ error: "Not found" });

    const buf = Buffer.from(row.data.slice(row.data.indexOf(",") + 1), "base64");
    res.setHeader("Content-Type", "image/jpeg");
    res.setHeader("Cache-Control", "private, max-age=604800, immutable");
    res.send(buf);
  } catch (error) {
    console.error("Error serving cookbook photo:", error);
    res.status(500).json({ error: "Failed to load photo" });
  }
});

router.delete("/cookbook-photos/:photoId", isAuthenticated, async (req: any, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    const deleted = await db
      .delete(cookbookPhotos)
      .where(and(eq(cookbookPhotos.id, req.params.photoId), eq(cookbookPhotos.ownerUserId, userId)))
      .returning({ id: cookbookPhotos.id });
    if (deleted.length === 0) return res.status(404).json({ error: "Not found" });
    res.json({ ok: true });
  } catch (error) {
    console.error("Error deleting cookbook photo:", error);
    res.status(500).json({ error: "Failed to delete photo" });
  }
});

export default router;
