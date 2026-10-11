import { Router, type Response } from "express";
import multer from "multer";
import crypto from "crypto";
import { and, eq, sql } from "drizzle-orm";
import { isAuthenticated } from "../clerkAuth";
import { acceptImagePass } from "../lib/image-pass";
import { db } from "../db";
import { bulkIntakePhotos, bulkIntakes, cookbooks } from "@shared/schema";
import { buildPlan, estimateFirstLook, estimateImport, type IntakeStatus } from "@shared/bulk-intake";
import { getUserId } from "./route-utils";
import {
  bulkIntakeAvailable,
  bulkLimits,
  countOpenIntakes,
  existingRecipesFor,
  getIntake,
  importsToday,
  listIntakes,
  listPhotos,
  photoBytes,
  photosThisMonth,
  recipeStatuses,
  setIntake,
  toPlanPhoto,
} from "../bulk-intake/store";
import { freezePlan } from "../bulk-intake/worker";
import { prepareUpload } from "../bulk-intake/images";
import { bulkLane } from "../bulk-intake/handoff";

// Bringing in a whole box of recipes at once (docs/BULK_IMPORT.md). The
// browser shrinks each photo and sends them one per request, several at a
// time, retrying on failure; a photo already received is acknowledged
// without being stored twice, so an interrupted upload resumes by sending
// the same folder again.

const router = Router();

const uploadOne = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: bulkLimits().maxPhotoBytes, files: 1 },
});

/** Express 4 doesn't catch async errors; an uncaught one would stop the server */
const safe = (fn: (req: any, res: Response) => Promise<unknown>) => (req: any, res: Response) =>
  fn(req, res).catch((err) => {
    console.error("[Bulk intake] Request failed:", err);
    if (!res.headersSent) res.status(500).json({ error: "Something went wrong. Please try again." });
  });

const NOT_AVAILABLE = "Bringing in a whole box of recipes isn't turned on yet.";

/** Settings the page needs before it starts (limits, Google Drive keys when set up) */
router.get("/bulk-intake/config", isAuthenticated, safe(async (_req, res) => {
  const available = await bulkIntakeAvailable();
  const clientId = process.env.GOOGLE_DRIVE_CLIENT_ID;
  const apiKey = process.env.GOOGLE_DRIVE_API_KEY;
  const appId = process.env.GOOGLE_DRIVE_APP_ID;
  res.json({
    available,
    limits: bulkLimits(),
    lane: bulkLane(),
    drive: {
      // Picker: the person signs in to Google and picks photos (drive.file scope)
      picker: clientId && apiKey && appId ? { clientId, apiKey, appId } : null,
      // Shared link: a folder shared "Anyone with the link", read with the API key
      link: apiKey && process.env.GOOGLE_DRIVE_LINKS === "on" ? { apiKey } : null,
    },
  });
}));

router.get("/bulk-intake", isAuthenticated, safe(async (req: any, res) => {
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  if (!(await bulkIntakeAvailable())) return res.json([]);
  res.json(await listIntakes(userId));
}));

router.post("/bulk-intake", isAuthenticated, safe(async (req: any, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    if (!(await bulkIntakeAvailable())) return res.status(503).json({ error: NOT_AVAILABLE });
    const limits = bulkLimits();
    if ((await countOpenIntakes(userId)) >= limits.maxOpenBatches) {
      return res.status(429).json({ error: `You have ${limits.maxOpenBatches} boxes of recipes in progress. Finish or cancel one first.` });
    }
    const source = ["device", "drive_picker", "drive_link"].includes(req.body?.source) ? req.body.source : "device";
    const [row] = await db.insert(bulkIntakes).values({ ownerUserId: userId, source }).returning({ id: bulkIntakes.id });
    res.status(201).json({ id: row.id });
  } catch (error) {
    console.error("[Bulk intake] Couldn't start:", error);
    res.status(500).json({ error: "We couldn't start. Please try again." });
  }
}));

/** Everything the page shows: progress, the plan, estimates */
router.get("/bulk-intake/:id", isAuthenticated, safe(async (req: any, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    if (!(await bulkIntakeAvailable())) return res.status(503).json({ error: NOT_AVAILABLE });
    const intake = await getIntake(req.params.id, userId);
    if (!intake) return res.status(404).json({ error: "We couldn't find this box of recipes." });

    const photos = await listPhotos(intake.id);
    const recipeIds = photos.map((p) => p.recipeId).filter(Boolean) as string[];
    const plan = buildPlan(photos.map(toPlanPhoto), await existingRecipesFor(intake, recipeIds));
    const statuses = await recipeStatuses(recipeIds);
    const lane = bulkLane();

    res.json({
      id: intake.id,
      status: intake.status,
      source: intake.source,
      cookbookId: intake.cookbookId,
      createdAt: intake.createdAt,
      spentCents: Math.round(intake.spentMicros / 10_000),
      progress: {
        uploaded: photos.length,
        expected: intake.expectedPhotos,
        checked: photos.filter((p) => p.status === "checked").length,
        failed: photos.filter((p) => p.status === "failed").length,
      },
      received: photos.map((p) => p.clientKey),
      photos: photos.map((p) => ({
        id: p.id,
        fileName: p.fileName,
        status: p.status,
        title: p.catalog?.title ?? "",
        kind: p.catalog?.kind ?? null,
        side: p.catalog?.side ?? null,
        pairedTo: p.pairedTo,
        pairSource: p.pairSource,
        problem: p.problem,
      })),
      plan: {
        ...plan,
        groups: plan.groups.map((g) => ({
          ...g,
          recipe: g.recipeId ? statuses.get(g.recipeId) ?? null : null,
          problem: photos.find((p) => p.id === g.key)?.problem ?? null,
        })),
      },
      estimates: {
        firstLook: estimateFirstLook(photos.length),
        import: estimateImport(plan.summary.toImport, lane),
        lane,
      },
    });
  } catch (error) {
    console.error("[Bulk intake] Couldn't load:", error);
    res.status(500).json({ error: "We couldn't load this box of recipes. Please try again." });
  }
}));

const SHA256 = /^[a-f0-9]{64}$/;

/** One photo. Safe to send twice: a photo already here is acknowledged, not stored again */
router.post("/bulk-intake/:id/photos", isAuthenticated, uploadOne.single("photo"), safe(async (req: any, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    if (!(await bulkIntakeAvailable())) return res.status(503).json({ error: NOT_AVAILABLE });
    const intake = await getIntake(req.params.id, userId);
    if (!intake) return res.status(404).json({ error: "We couldn't find this box of recipes." });
    if (!["uploading", "review"].includes(intake.status)) return res.status(409).json({ error: "This box of recipes is already being imported." });
    if (!req.file) return res.status(400).json({ error: "No photo was sent." });

    const clientKey = String(req.body.clientKey ?? "").toLowerCase();
    const sourceHash = SHA256.test(clientKey) ? clientKey : crypto.createHash("sha256").update(req.file.buffer).digest("hex");
    const [already] = await db
      .select({ id: bulkIntakePhotos.id })
      .from(bulkIntakePhotos)
      .where(and(eq(bulkIntakePhotos.intakeId, intake.id), eq(bulkIntakePhotos.clientKey, sourceHash)));
    if (already) return res.json({ id: already.id, duplicate: true });

    const limits = bulkLimits();
    const [{ n: inPile }] = await db.select({ n: sql<number>`count(*)::int` }).from(bulkIntakePhotos).where(eq(bulkIntakePhotos.intakeId, intake.id));
    if (inPile >= limits.maxPhotosPerBatch) {
      return res.status(413).json({ error: `One box can hold up to ${limits.maxPhotosPerBatch} photos. Start another for the rest.`, limit: "batch" });
    }
    if ((await photosThisMonth(userId)) >= limits.maxPhotosPerMonth) {
      return res.status(429).json({ error: `You've brought in ${limits.maxPhotosPerMonth} photos this month, the most we allow for now. Write to us if you need more.`, limit: "month" });
    }

    // A missing back added from the review screen
    // A missing side added from the review screen (attachAs "front" when the card here is a back)
    const asFront = req.body.attachAs === "front";
    let attachTo: { id: string; seq: number } | null = null;
    if (req.body.attachTo) {
      const [front] = await db
        .select({ id: bulkIntakePhotos.id, seq: bulkIntakePhotos.seq })
        .from(bulkIntakePhotos)
        .where(and(eq(bulkIntakePhotos.id, String(req.body.attachTo)), eq(bulkIntakePhotos.intakeId, intake.id)));
      if (!front) return res.status(400).json({ error: "We couldn't find the card to add this to." });
      attachTo = front;
    }

    let prepared;
    try {
      prepared = await prepareUpload(req.file.buffer, req.file.originalname ?? "", req.file.mimetype ?? "");
    } catch {
      return res.status(415).json({ error: "We couldn't open this photo. Try saving it as a JPEG.", permanent: true });
    }
    const seq = Number.isFinite(Number(req.body.seq)) ? Math.max(0, Math.floor(Number(req.body.seq))) : inPile;
    const takenAt = req.body.takenAt && !Number.isNaN(Date.parse(req.body.takenAt)) ? new Date(req.body.takenAt) : null;

    const [row] = await db.insert(bulkIntakePhotos).values({
      intakeId: intake.id,
      ownerUserId: userId,
      clientKey: sourceHash,
      sourceHash,
      fileName: String(req.body.name ?? req.file.originalname ?? "").slice(0, 200),
      seq: attachTo ? attachTo.seq : seq,
      takenAt,
      image: prepared.image,
      thumb: prepared.thumb,
      ...(attachTo && !asFront ? { pairedTo: attachTo.id, pairSource: "person" } : {}),
    }).onConflictDoNothing().returning({ id: bulkIntakePhotos.id });
    // A missing front: the card already here becomes its back
    if (attachTo && asFront && row) {
      await db.update(bulkIntakePhotos).set({ pairedTo: row.id, pairSource: "person", pairLocked: false }).where(eq(bulkIntakePhotos.id, attachTo.id));
    }
    res.status(201).json({ id: row?.id ?? null });
  } catch (error) {
    console.error("[Bulk intake] Photo upload failed:", error);
    res.status(500).json({ error: "This photo didn't upload. We'll try again." });
  }
}));

/** The browser has sent everything; once every photo is looked at, pairing runs */
router.post("/bulk-intake/:id/uploads-done", isAuthenticated, safe(async (req: any, res) => {
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  const intake = await getIntake(req.params.id, userId);
  if (!intake) return res.status(404).json({ error: "We couldn't find this box of recipes." });
  const expected = Number(req.body?.expected);
  await setIntake(intake.id, {
    uploadsDoneAt: intake.uploadsDoneAt ?? new Date(),
    expectedPhotos: Number.isFinite(expected) && expected >= 0 ? expected : intake.expectedPhotos,
  });
  res.json({ ok: true });
}));

/** How many photos are coming (so progress can say "45 of 231") */
router.post("/bulk-intake/:id/expect", isAuthenticated, safe(async (req: any, res) => {
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  const intake = await getIntake(req.params.id, userId);
  if (!intake) return res.status(404).json({ error: "We couldn't find this box of recipes." });
  const expected = Number(req.body?.expected);
  if (!Number.isFinite(expected) || expected < 0) return res.status(400).json({ error: "Bad count" });
  // Adding more photos to a pile that was already reviewed goes back to uploading
  await setIntake(intake.id, { expectedPhotos: expected, ...(intake.status === "review" ? { status: "uploading", uploadsDoneAt: null } : {}) });
  res.json({ ok: true });
}));

for (const which of ["thumb", "image"] as const) {
  router.get(`/bulk-intake/:id/photos/:photoId/${which}`, acceptImagePass(isAuthenticated), safe(async (req: any, res) => {
    const userId = getUserId(req);
    if (!userId) return res.status(401).end();
    const intake = await getIntake(req.params.id, userId);
    if (!intake) return res.status(404).end();
    const bytes = (await photoBytes(req.params.photoId, intake.id, which)) ?? (which === "image" ? await photoBytes(req.params.photoId, intake.id, "thumb") : null);
    if (!bytes) return res.status(404).end();
    res.setHeader("Content-Type", "image/jpeg");
    res.setHeader("Cache-Control", "private, max-age=300");
    res.end(bytes);
  }));
}

/**
 * The person's fixes on the review screen:
 *  include / exclude a recipe; pair a back with a front; split a pair;
 *  look at a photo again (after it failed).
 */
router.post("/bulk-intake/:id/choices", isAuthenticated, safe(async (req: any, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    const intake = await getIntake(req.params.id, userId);
    if (!intake) return res.status(404).json({ error: "We couldn't find this box of recipes." });
    if (!["uploading", "review"].includes(intake.status)) return res.status(409).json({ error: "This box of recipes is already being imported." });

    const { action, front, back } = req.body ?? {};
    const photos = await listPhotos(intake.id);
    const has = (id: unknown) => typeof id === "string" && photos.some((p) => p.id === id);
    const set = (id: string, values: Partial<typeof bulkIntakePhotos.$inferInsert>) =>
      db.update(bulkIntakePhotos).set(values).where(and(eq(bulkIntakePhotos.id, id), eq(bulkIntakePhotos.intakeId, intake.id)));

    if ((action === "include" || action === "exclude") && has(front)) {
      await set(front, { includeOverride: action === "include" });
    } else if (action === "pair" && has(front) && has(back) && front !== back) {
      // The back joins the front; anything that was paired to the back moves with it
      await set(back, { pairedTo: front, pairSource: "person", pairLocked: false });
      await db.update(bulkIntakePhotos).set({ pairedTo: front }).where(and(eq(bulkIntakePhotos.intakeId, intake.id), eq(bulkIntakePhotos.pairedTo, back)));
      await set(front, { pairedTo: null });
    } else if (action === "unpair" && has(back)) {
      await set(back, { pairedTo: null, pairSource: "person", pairLocked: true });
    } else if (action === "retry" && has(front)) {
      await set(front, { status: "uploaded", attempts: 0, problem: null });
    } else if (action === "cookbook") {
      // Which cookbook to add to, and to compare against for "already in your cookbook"
      const id = req.body.cookbookId ? Number(req.body.cookbookId) : null;
      if (id !== null) {
        const [book] = await db.select({ owner: cookbooks.ownerUserId }).from(cookbooks).where(eq(cookbooks.id, id));
        if (!book || book.owner !== userId) return res.status(403).json({ error: "You can only add recipes to your own cookbooks." });
      }
      await setIntake(intake.id, { cookbookId: id });
    } else {
      return res.status(400).json({ error: "We didn't understand that change." });
    }
    res.json({ ok: true });
  } catch (error) {
    console.error("[Bulk intake] Change failed:", error);
    res.status(500).json({ error: "That change didn't save. Please try again." });
  }
}));

/** Import the recipes the person approved */
router.post("/bulk-intake/:id/import", isAuthenticated, safe(async (req: any, res) => {
  try {
    const userId = getUserId(req);
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    const intake = await getIntake(req.params.id, userId);
    if (!intake) return res.status(404).json({ error: "We couldn't find this box of recipes." });
    // Safe to press twice
    if (intake.status === "importing" || intake.status === "done") return res.json({ ok: true, status: intake.status });
    if (intake.status !== "review") return res.status(409).json({ error: "We're still looking at your photos. Import will be ready in a moment." });

    let cookbookId: number | null = null;
    if (req.body?.cookbookId) {
      const [book] = await db.select({ id: cookbooks.id, owner: cookbooks.ownerUserId }).from(cookbooks).where(eq(cookbooks.id, Number(req.body.cookbookId)));
      if (!book || book.owner !== userId) return res.status(403).json({ error: "You can only add recipes to your own cookbooks." });
      cookbookId = book.id;
    }
    // The comparison ("already in your cookbook") depends on the cookbook
    if (cookbookId !== intake.cookbookId) await setIntake(intake.id, { cookbookId });

    const count = await freezePlan(intake.id);
    if (count === 0) return res.status(400).json({ error: "No recipes are chosen to import." });
    const limits = bulkLimits();
    if (Number(req.body?.expectedCount) !== count) {
      return res.status(409).json({ error: "The list changed while you were looking. Check it again, then import.", count });
    }
    if (count > limits.confirmAbove && req.body?.confirmed !== true) {
      return res.status(400).json({ error: `Please confirm you want to add all ${count} recipes.`, needsConfirm: true });
    }
    if ((await importsToday(userId)) + count > limits.maxImportsPerDay) {
      return res.status(429).json({ error: `You can import up to ${limits.maxImportsPerDay} recipes a day from photos. Leave some out and import the rest tomorrow.` });
    }
    await db.update(bulkIntakes)
      .set({ status: "importing" as IntakeStatus, importRequestedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(bulkIntakes.id, intake.id), eq(bulkIntakes.status, "review")));
    res.json({ ok: true, status: "importing", count });
  } catch (error) {
    console.error("[Bulk intake] Import failed to start:", error);
    res.status(500).json({ error: "We couldn't start the import. Please try again." });
  }
}));

/** Cancel a pile (kept 7 days, so it can be brought back) */
router.post("/bulk-intake/:id/cancel", isAuthenticated, safe(async (req: any, res) => {
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  const intake = await getIntake(req.params.id, userId);
  if (!intake) return res.status(404).json({ error: "We couldn't find this box of recipes." });
  if (intake.status === "importing" || intake.status === "done") return res.status(409).json({ error: "These recipes are already being imported." });
  await setIntake(intake.id, { status: "cancelled" });
  res.json({ ok: true });
}));

router.post("/bulk-intake/:id/restore", isAuthenticated, safe(async (req: any, res) => {
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  const intake = await getIntake(req.params.id, userId);
  if (!intake || intake.status !== "cancelled") return res.status(404).json({ error: "We couldn't find this box of recipes." });
  // Back to the start of the line: photos not yet looked at continue, and
  // a finished pile is paired again and returns to review
  await setIntake(intake.id, { status: "uploading" });
  res.json({ ok: true });
}));

export default router;
