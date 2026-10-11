import { and, asc, desc, eq, gte, inArray, isNotNull, sql } from "drizzle-orm";
import { db } from "../db";
import { getSharedPool } from "../pg-pool";
import { bulkIntakePhotos, bulkIntakes, cookbookRecipes, recipes, type BulkIntake } from "@shared/schema";
import { DEFAULT_BULK_LIMITS, type BulkLimits, type ExistingRecipe, type PlanPhoto } from "@shared/bulk-intake";

// Data access for bulk intake (docs/BULK_IMPORT.md). The two tables arrive
// with migrations/2026-10-bulk-intake.sql; until that runs, bulkIntakeAvailable()
// is false, the routes answer "not available yet" and the worker idles.

let availableUntil = 0;
let available = false;

/** True when the bulk intake tables exist (checked at most every 5 minutes) */
export async function bulkIntakeAvailable(): Promise<boolean> {
  if (process.env.BULK_INTAKE === "off") return false;
  if (Date.now() < availableUntil) return available;
  try {
    const { rows } = await getSharedPool().query(`SELECT to_regclass('public.bulk_intake_photos') IS NOT NULL AS ok`);
    available = rows[0]?.ok === true;
  } catch {
    available = false;
  }
  availableUntil = Date.now() + 5 * 60 * 1000;
  if (!available) console.warn("[Bulk intake] Tables missing; run migrations/2026-10-bulk-intake.sql to turn it on.");
  return available;
}

/** Per-person limits; each can be changed with an env var (BULK_MAX_PHOTOS_PER_BATCH etc.) */
export function bulkLimits(): BulkLimits {
  const num = (name: string, fallback: number) => {
    const v = Number(process.env[name]);
    return Number.isFinite(v) && v > 0 ? v : fallback;
  };
  return {
    maxPhotosPerBatch: num("BULK_MAX_PHOTOS_PER_BATCH", DEFAULT_BULK_LIMITS.maxPhotosPerBatch),
    maxPhotosPerMonth: num("BULK_MAX_PHOTOS_PER_MONTH", DEFAULT_BULK_LIMITS.maxPhotosPerMonth),
    maxOpenBatches: num("BULK_MAX_OPEN_BATCHES", DEFAULT_BULK_LIMITS.maxOpenBatches),
    maxImportsPerDay: num("BULK_MAX_IMPORTS_PER_DAY", DEFAULT_BULK_LIMITS.maxImportsPerDay),
    confirmAbove: num("BULK_CONFIRM_ABOVE", DEFAULT_BULK_LIMITS.confirmAbove),
    maxPhotoBytes: DEFAULT_BULK_LIMITS.maxPhotoBytes,
  };
}

export async function getIntake(id: string, ownerUserId?: string): Promise<BulkIntake | null> {
  const [row] = await db.select().from(bulkIntakes).where(ownerUserId ? and(eq(bulkIntakes.id, id), eq(bulkIntakes.ownerUserId, ownerUserId)) : eq(bulkIntakes.id, id));
  return row ?? null;
}

export async function setIntake(id: string, values: Partial<typeof bulkIntakes.$inferInsert>): Promise<void> {
  await db.update(bulkIntakes).set({ ...values, updatedAt: new Date() }).where(eq(bulkIntakes.id, id));
}

/** Piles still in progress (not imported, not cancelled) */
export async function countOpenIntakes(ownerUserId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(bulkIntakes)
    .where(and(eq(bulkIntakes.ownerUserId, ownerUserId), inArray(bulkIntakes.status, ["uploading", "pairing", "review", "importing"])));
  return row?.n ?? 0;
}

export async function listIntakes(ownerUserId: string) {
  return db
    .select({
      id: bulkIntakes.id,
      status: bulkIntakes.status,
      createdAt: bulkIntakes.createdAt,
      photos: sql<number>`(SELECT count(*)::int FROM bulk_intake_photos p WHERE p.intake_id = ${bulkIntakes.id})`,
    })
    .from(bulkIntakes)
    .where(eq(bulkIntakes.ownerUserId, ownerUserId))
    .orderBy(desc(bulkIntakes.createdAt))
    .limit(20);
}

export async function photosThisMonth(ownerUserId: string): Promise<number> {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(bulkIntakePhotos)
    .where(and(eq(bulkIntakePhotos.ownerUserId, ownerUserId), gte(bulkIntakePhotos.createdAt, since)));
  return row?.n ?? 0;
}

export async function importsToday(ownerUserId: string): Promise<number> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(bulkIntakePhotos)
    .where(and(eq(bulkIntakePhotos.ownerUserId, ownerUserId), gte(bulkIntakePhotos.importedAt, since)));
  return row?.n ?? 0;
}

/** Every photo in a pile, without the image bytes */
export async function listPhotos(intakeId: string) {
  return db
    .select({
      id: bulkIntakePhotos.id,
      clientKey: bulkIntakePhotos.clientKey,
      sourceHash: bulkIntakePhotos.sourceHash,
      fileName: bulkIntakePhotos.fileName,
      seq: bulkIntakePhotos.seq,
      takenAt: bulkIntakePhotos.takenAt,
      status: bulkIntakePhotos.status,
      catalog: bulkIntakePhotos.catalog,
      problem: bulkIntakePhotos.problem,
      pairedTo: bulkIntakePhotos.pairedTo,
      pairSource: bulkIntakePhotos.pairSource,
      pairLocked: bulkIntakePhotos.pairLocked,
      includeOverride: bulkIntakePhotos.includeOverride,
      recipeId: bulkIntakePhotos.recipeId,
      importedAt: bulkIntakePhotos.importedAt,
    })
    .from(bulkIntakePhotos)
    .where(eq(bulkIntakePhotos.intakeId, intakeId))
    .orderBy(asc(bulkIntakePhotos.seq), asc(bulkIntakePhotos.createdAt));
}

export type PhotoRow = Awaited<ReturnType<typeof listPhotos>>[number];

export function toPlanPhoto(p: PhotoRow): PlanPhoto {
  return {
    id: p.id,
    seq: p.seq,
    sourceHash: p.sourceHash,
    catalog: p.status === "checked" ? p.catalog ?? null : null,
    pairedTo: p.pairedTo,
    pairLocked: p.pairLocked,
    includeOverride: p.includeOverride,
    recipeId: p.recipeId,
  };
}

/**
 * Recipes to compare against for "already in your cookbook": the chosen
 * cookbook's recipes, or else all of the person's own. Leaves out recipes
 * this pile created.
 */
export async function existingRecipesFor(intake: BulkIntake, exclude: string[]): Promise<ExistingRecipe[]> {
  const fields = { id: recipes.id, title: recipes.title, first: sql<string | null>`${recipes.ingredients}[1]` };
  const rows = intake.cookbookId
    ? await db.select(fields).from(cookbookRecipes).innerJoin(recipes, eq(recipes.id, cookbookRecipes.recipeId)).where(eq(cookbookRecipes.cookbookId, intake.cookbookId)).limit(5000)
    : await db.select(fields).from(recipes).where(eq(recipes.ownerUserId, intake.ownerUserId)).limit(5000);
  const skip = new Set(exclude);
  return rows.filter((r) => !skip.has(r.id)).map((r) => ({ id: r.id, title: r.title, firstLine: r.first ?? "" }));
}

export async function photoBytes(photoId: string, intakeId: string, which: "image" | "thumb"): Promise<Buffer | null> {
  const [row] = await db
    .select({ bytes: which === "image" ? bulkIntakePhotos.image : bulkIntakePhotos.thumb })
    .from(bulkIntakePhotos)
    .where(and(eq(bulkIntakePhotos.id, photoId), eq(bulkIntakePhotos.intakeId, intakeId)));
  return row?.bytes ?? null;
}

/** The upload session this pile's recipes were put in (created on the first import) */
export async function importSessionOf(intakeId: string): Promise<string | null> {
  const [row] = await db
    .select({ session: recipes.uploadSessionId })
    .from(bulkIntakePhotos)
    .innerJoin(recipes, eq(recipes.id, bulkIntakePhotos.recipeId))
    .where(and(eq(bulkIntakePhotos.intakeId, intakeId), isNotNull(recipes.uploadSessionId)))
    .limit(1);
  return row?.session ?? null;
}

/** Enrichment status of the recipes a pile created */
export async function recipeStatuses(recipeIds: string[]) {
  if (!recipeIds.length) return new Map<string, { title: string; status: string | null; error: string | null }>();
  const rows = await db
    .select({ id: recipes.id, title: recipes.title, status: recipes.enrichmentStatus, error: recipes.enrichmentError })
    .from(recipes)
    .where(inArray(recipes.id, recipeIds));
  return new Map(rows.map((r) => [r.id, { title: r.title, status: r.status, error: r.error }]));
}
