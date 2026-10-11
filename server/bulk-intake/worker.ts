import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "../db";
import { getSharedPool } from "../pg-pool";
import { storage } from "../storage";
import { detectRateLimit } from "../lib/rate-limit";
import { bulkIntakePhotos, bulkIntakes } from "@shared/schema";
import { CATALOG_VERSION, buildPlan, pairBySequence, pairingCandidates, type PairCandidate, type PhotoCatalog } from "@shared/bulk-intake";
import { catalogPhoto, pairBacksWithAI } from "./catalog";
import { smallCopy, upright } from "./images";
import { createImportSession, handOffRecipe } from "./handoff";
import { bulkIntakeAvailable, existingRecipesFor, getIntake, importSessionOf, listPhotos, setIntake, toPlanPhoto } from "./store";

// Background work for bulk intake, driven entirely by the database so a
// restart (or a deploy) picks up where it left off:
//  1. First look: each uploaded photo gets one cheap AI call (catalog.ts),
//     a few at a time, while the rest are still uploading. Repeats of a photo
//     the person sent before reuse the earlier answer at no cost.
//  2. Pairing: once every photo is in and looked at, backs are matched to
//     fronts, then the pile waits for the person on the review screen.
//  3. Import: after the person presses Import, recipes are handed to the
//     normal pipeline (handoff.ts) a few at a time.

const CHECK_WORKERS = Number(process.env.BULK_CHECK_WORKERS) || 8;
/** Bulk recipes being read at once, per pile (keeps memory and the shared queue calm) */
const IMPORT_IN_FLIGHT = Number(process.env.BULK_IMPORT_IN_FLIGHT) || 6;
const MAX_ATTEMPTS = 3;
const TICK_MS = 2000;

let activeChecks = 0;
let ticking = false;
const importing = new Set<string>();

export function startBulkIntakeWorker(): void {
  setInterval(() => void tick(), TICK_MS);
  // Cancelled piles are kept 7 days (so Cancel can be undone), then removed
  setInterval(() => void cleanup(), 60 * 60 * 1000);
  console.log("[Bulk intake] Worker started");
}

async function tick(): Promise<void> {
  if (ticking) return;
  ticking = true;
  try {
    if (!(await bulkIntakeAvailable())) return;
    await claimAndCheck();
    await advanceToPairing();
    await feedImports();
  } catch (err) {
    console.error("[Bulk intake] Worker tick failed:", err);
  } finally {
    ticking = false;
  }
}

// ---- 1. First look ----------------------------------------------------------

async function claimAndCheck(): Promise<void> {
  const room = CHECK_WORKERS - activeChecks;
  if (room <= 0) return;
  const pool = getSharedPool();
  // Photos that ran out of tries (or whose worker died) stop here
  await pool.query(
    `UPDATE bulk_intake_photos SET status = 'failed', problem = COALESCE(problem, 'We couldn''t look at this photo.')
     WHERE status IN ('uploaded', 'checking') AND attempts >= $1
       AND (status = 'uploaded' OR claimed_at < now() - interval '3 minutes')`,
    [MAX_ATTEMPTS],
  );
  const { rows } = await pool.query(
    `UPDATE bulk_intake_photos SET status = 'checking', claimed_at = now(), attempts = attempts + 1
     WHERE id IN (
       SELECT p.id FROM bulk_intake_photos p JOIN bulk_intakes i ON i.id = p.intake_id
       WHERE i.status IN ('uploading', 'review')
         AND (p.status = 'uploaded' OR (p.status = 'checking' AND p.claimed_at < now() - interval '3 minutes'))
         AND p.attempts < $2
       ORDER BY p.created_at
       LIMIT $1
       FOR UPDATE OF p SKIP LOCKED)
     RETURNING id, intake_id, owner_user_id, source_hash`,
    [room, MAX_ATTEMPTS],
  );
  for (const row of rows) {
    activeChecks++;
    void checkPhoto(row.id, row.intake_id, row.owner_user_id, row.source_hash)
      .catch((err) => console.error(`[Bulk intake] Couldn't record the first look for ${row.id}:`, err))
      .finally(() => { activeChecks--; });
  }
}

async function checkPhoto(id: string, intakeId: string, ownerUserId: string, sourceHash: string): Promise<void> {
  try {
    const [row] = await db.select({ image: bulkIntakePhotos.image }).from(bulkIntakePhotos).where(eq(bulkIntakePhotos.id, id));
    if (!row?.image) throw new Error("The photo is missing");

    // The same photo, sent before by this person: reuse that answer
    const { rows: cached } = await getSharedPool().query(
      `SELECT catalog FROM bulk_intake_photos
       WHERE owner_user_id = $1 AND source_hash = $2 AND status = 'checked' AND id <> $3
         AND (catalog->>'v')::int = $4
       LIMIT 1`,
      [ownerUserId, sourceHash, id, CATALOG_VERSION],
    );
    let catalog: PhotoCatalog;
    let cost = 0;
    if (cached[0]?.catalog) {
      catalog = cached[0].catalog;
    } else {
      const result = await catalogPhoto(row.image);
      catalog = result.catalog;
      cost = result.usage.costMicros;
    }
    const thumb = await smallCopy(row.image, catalog.rotate);
    await db.update(bulkIntakePhotos)
      .set({ status: "checked", catalog: { ...catalog, v: CATALOG_VERSION }, thumb, costMicros: cost, problem: null })
      .where(eq(bulkIntakePhotos.id, id));
    if (cost) await db.update(bulkIntakes).set({ spentMicros: sql`${bulkIntakes.spentMicros} + ${cost}` }).where(eq(bulkIntakes.id, intakeId));
  } catch (err: any) {
    const limited = detectRateLimit(err).isRateLimited;
    console.warn(`[Bulk intake] First look failed for photo ${id}${limited ? " (rate limited)" : ""}: ${err?.message}`);
    // Back in line; claimAndCheck marks it failed after MAX_ATTEMPTS
    await db.update(bulkIntakePhotos)
      .set({ status: "uploaded", problem: "We couldn't look at this photo." , ...(limited ? { attempts: sql`${bulkIntakePhotos.attempts} - 1` } : {}) })
      .where(eq(bulkIntakePhotos.id, id));
  }
}

// ---- 2. Pairing ---------------------------------------------------------------

async function advanceToPairing(): Promise<void> {
  const pool = getSharedPool();
  // Every photo is in and has been looked at (or gave up); a stuck "pairing"
  // (the server restarted mid-way) is picked up again after 5 minutes
  const { rows } = await pool.query(
    `UPDATE bulk_intakes i SET status = 'pairing', updated_at = now()
     WHERE ((i.status = 'uploading' AND i.uploads_done_at IS NOT NULL)
            OR (i.status = 'pairing' AND i.updated_at < now() - interval '5 minutes'))
       AND NOT EXISTS (SELECT 1 FROM bulk_intake_photos p WHERE p.intake_id = i.id AND p.status IN ('uploaded', 'checking'))
     RETURNING i.id`,
  );
  for (const { id } of rows) {
    try {
      await pairIntake(id);
    } catch (err) {
      // Pairing is a help, not a must: the person can pair on the review screen
      console.error(`[Bulk intake] Pairing failed for ${id}:`, err);
    }
    await setIntake(id, { status: "review" });
  }
}

export async function pairIntake(intakeId: string): Promise<void> {
  const photos = await listPhotos(intakeId);
  const free = photos.filter((p) => p.status === "checked" && p.catalog && !p.pairLocked && p.pairSource !== "person");
  const taken = new Set(photos.filter((p) => p.pairSource === "person").flatMap((p) => [p.id, p.pairedTo!]));
  // Real capture times in order: a back right after its front is enough
  const timed = photos.filter((p) => p.takenAt).map((p) => +p.takenAt!);
  const orderIsReliable = timed.length === photos.length && new Set(timed).size === timed.length;
  const rank = new Map([...photos].sort((a, b) => (orderIsReliable ? +a.takenAt! - +b.takenAt! : a.seq - b.seq)).map((p, i) => [p.id, i]));
  const candidates: PairCandidate[] = free.filter((p) => !taken.has(p.id)).map((p) => ({ id: p.id, seq: rank.get(p.id)!, catalog: p.catalog! }));
  const bySequence = pairBySequence(candidates, orderIsReliable);
  const pairs = new Map(bySequence);

  const rest = candidates.filter((c) => !pairs.has(c.id) && !Array.from(pairs.values()).includes(c.id));
  const { fronts, backs, others } = pairingCandidates(rest);
  if (fronts.length && (backs.length || others.length)) {
    const ai = await pairBacksWithAI(fronts, backs, others);
    ai.pairs.forEach((front, back) => pairs.set(back, front));
    if (ai.usage) await db.update(bulkIntakes).set({ spentMicros: sql`${bulkIntakes.spentMicros} + ${ai.usage.costMicros}` }).where(eq(bulkIntakes.id, intakeId));
  }

  for (const [back, front] of Array.from(pairs)) {
    await db.update(bulkIntakePhotos)
      .set({ pairedTo: front, pairSource: bySequence.has(back) ? "sequence" : "ai" })
      .where(and(eq(bulkIntakePhotos.id, back), eq(bulkIntakePhotos.intakeId, intakeId)));
  }
}

// ---- 3. Import ------------------------------------------------------------------

/**
 * Freezes the plan the person approved: each recipe's front row gets an
 * explicit include flag, and backs point straight at their front.
 * Returns how many recipes will be imported.
 */
export async function freezePlan(intakeId: string): Promise<number> {
  const intake = await getIntake(intakeId);
  if (!intake) return 0;
  const photos = await listPhotos(intakeId);
  const plan = buildPlan(photos.map(toPlanPhoto), await existingRecipesFor(intake, photos.map((p) => p.recipeId).filter(Boolean) as string[]));
  let count = 0;
  for (const g of plan.groups) {
    if (g.include && !g.recipeId) count++;
    await db.update(bulkIntakePhotos).set({ includeOverride: g.include, pairedTo: null }).where(eq(bulkIntakePhotos.id, g.key));
    const backs = g.photoIds.slice(1);
    if (backs.length) await db.update(bulkIntakePhotos).set({ pairedTo: g.key }).where(inArray(bulkIntakePhotos.id, backs));
  }
  return count;
}

async function feedImports(): Promise<void> {
  const piles = await db.select({ id: bulkIntakes.id }).from(bulkIntakes).where(eq(bulkIntakes.status, "importing"));
  for (const { id } of piles) {
    if (importing.has(id)) continue;
    importing.add(id);
    void feedPile(id).catch((err) => console.error(`[Bulk intake] Import step failed for ${id}:`, err)).finally(() => importing.delete(id));
  }
}

async function feedPile(intakeId: string): Promise<void> {
  const intake = await getIntake(intakeId);
  if (!intake || intake.status !== "importing") return;
  const pool = getSharedPool();

  const { rows: [counts] } = await pool.query(
    `SELECT
       count(*) FILTER (WHERE p.recipe_id IS NULL)::int AS waiting,
       count(*) FILTER (WHERE r.enrichment_status = 'extracting')::int AS reading
     FROM bulk_intake_photos p LEFT JOIN recipes r ON r.id = p.recipe_id
     WHERE p.intake_id = $1 AND p.include_override = true AND p.paired_to IS NULL`,
    [intakeId],
  );
  if (counts.waiting === 0) {
    await setIntake(intakeId, { status: "done", importFinishedAt: new Date() });
    console.log(`[Bulk intake] ${intakeId}: every recipe handed to the import pipeline`);
    return;
  }
  const room = IMPORT_IN_FLIGHT - counts.reading;
  if (room <= 0) return;

  // Claim fronts (imported_at marks the claim; a claim with no recipe after
  // 10 minutes means the server stopped mid-way, so it's taken again)
  const { rows: fronts } = await pool.query(
    `UPDATE bulk_intake_photos SET imported_at = now()
     WHERE id IN (
       SELECT id FROM bulk_intake_photos
       WHERE intake_id = $1 AND include_override = true AND paired_to IS NULL AND recipe_id IS NULL
         AND (imported_at IS NULL OR imported_at < now() - interval '10 minutes')
       ORDER BY seq LIMIT $2
       FOR UPDATE SKIP LOCKED)
     RETURNING id, seq`,
    [intakeId, room],
  );
  if (!fronts.length) return;

  const total = await freezeCount(intakeId);
  const sessionId = (await importSessionOf(intakeId)) ?? (await createImportSession(intake.ownerUserId, total));

  for (const front of fronts) {
    try {
      const pages = await db
        .select({ id: bulkIntakePhotos.id, image: bulkIntakePhotos.image, catalog: bulkIntakePhotos.catalog })
        .from(bulkIntakePhotos)
        .where(and(eq(bulkIntakePhotos.intakeId, intakeId), sql`(${bulkIntakePhotos.id} = ${front.id} OR ${bulkIntakePhotos.pairedTo} = ${front.id})`))
        .orderBy(sql`${bulkIntakePhotos.id} = ${front.id} DESC`, asc(bulkIntakePhotos.seq));
      const images = await Promise.all(pages.filter((p) => p.image).map((p) => upright(p.image!, p.catalog?.rotate ?? 0)));
      const recipeId = await handOffRecipe({ ownerUserId: intake.ownerUserId, uploadSessionId: sessionId, index: front.seq, pages: images });
      if (intake.cookbookId) await storage.addRecipeToCookbook(intake.cookbookId, recipeId);
      await db.update(bulkIntakePhotos).set({ recipeId, problem: null }).where(eq(bulkIntakePhotos.id, front.id));
      // The photos now live in the recipe; drop the staged full-size copies
      await db.update(bulkIntakePhotos).set({ image: null, importedAt: new Date() }).where(inArray(bulkIntakePhotos.id, pages.map((p) => p.id)));
    } catch (err: any) {
      console.error(`[Bulk intake] Couldn't hand off ${front.id}:`, err);
      await db.update(bulkIntakePhotos).set({ problem: "We couldn't start this one. It will be tried again." }).where(eq(bulkIntakePhotos.id, front.id));
    }
  }
}

async function freezeCount(intakeId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(bulkIntakePhotos)
    .where(and(eq(bulkIntakePhotos.intakeId, intakeId), eq(bulkIntakePhotos.includeOverride, true), isNull(bulkIntakePhotos.pairedTo)));
  return row?.n ?? 0;
}

async function cleanup(): Promise<void> {
  try {
    if (!(await bulkIntakeAvailable())) return;
    await getSharedPool().query(`DELETE FROM bulk_intakes WHERE status = 'cancelled' AND updated_at < now() - interval '7 days'`);
  } catch (err) {
    console.error("[Bulk intake] Cleanup failed:", err);
  }
}
