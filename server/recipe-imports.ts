import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "./db";
import { recipeImports, recipes, users, type RecipeImport } from "@shared/schema";
import { wantsImportCheck } from "@shared/food-profile";

// Data access for the import review step (docs/DESIGN_PRINCIPLES.md §6).
//
// The recipe_imports table arrives with migrations/2026-10-ux-import-review.sql.
// Until that runs, every function here degrades quietly: writes are skipped,
// reads return "no record", and recipes behave exactly as before. Nothing in
// the upload path may fail because of this table.

type SourceType = RecipeImport["sourceType"];

let missingUntil = 0;
const RECHECK_MS = 5 * 60 * 1000;

function isMissingTable(err: unknown): boolean {
  const e = err as { code?: string; message?: string; cause?: { code?: string; message?: string } } | null;
  const code = e?.code ?? e?.cause?.code;
  const msg = `${e?.message ?? ""} ${e?.cause?.message ?? ""}`;
  return code === "42P01" || /recipe_imports.*does not exist/i.test(msg);
}

async function guarded<T>(label: string, fallback: T, fn: () => Promise<T>): Promise<T> {
  if (Date.now() < missingUntil) return fallback;
  try {
    return await fn();
  } catch (err) {
    if (isMissingTable(err)) {
      if (missingUntil === 0) {
        console.warn("[recipe-imports] Table recipe_imports is missing; run migrations/2026-10-ux-import-review.sql. Review tracking is off until then.");
      }
      missingUntil = Date.now() + RECHECK_MS;
      return fallback;
    }
    console.error(`[recipe-imports] ${label} failed:`, err);
    return fallback;
  }
}

/** True when review records can be stored (table exists) */
export function reviewTrackingAvailable(): boolean {
  return Date.now() >= missingUntil;
}

export async function recordImport(input: {
  recipeId: string;
  ownerUserId: string;
  sourceType: SourceType;
  extraPageImages?: string[];
  sourceUrl?: string | null;
  sourceText?: string | null;
}): Promise<boolean> {
  return guarded("recordImport", false, async () => {
    // Most people go straight to the recipe; the check step is opt-in
    const [owner] = await db.select({ preferences: users.preferences }).from(users).where(eq(users.id, input.ownerUserId));
    const reviewStatus = wantsImportCheck(owner?.preferences) ? "needs_review" : "reviewed";
    await db.insert(recipeImports).values({
      recipeId: input.recipeId,
      ownerUserId: input.ownerUserId,
      sourceType: input.sourceType,
      extraPageImages: input.extraPageImages?.length ? input.extraPageImages : null,
      sourceUrl: input.sourceUrl ?? null,
      sourceText: input.sourceText ? input.sourceText.slice(0, 50_000) : null,
      reviewStatus,
    }).onConflictDoNothing();
    return true;
  });
}

export async function getImport(recipeId: string): Promise<RecipeImport | null> {
  return guarded("getImport", null, async () => {
    const [row] = await db.select().from(recipeImports).where(eq(recipeImports.recipeId, recipeId));
    return row ?? null;
  });
}

/** Review status for several recipes (missing ids have no record) */
export async function getReviewStatuses(recipeIds: string[]): Promise<Map<string, RecipeImport["reviewStatus"]>> {
  if (recipeIds.length === 0) return new Map();
  return guarded("getReviewStatuses", new Map(), async () => {
    const rows = await db
      .select({ recipeId: recipeImports.recipeId, reviewStatus: recipeImports.reviewStatus })
      .from(recipeImports)
      .where(inArray(recipeImports.recipeId, recipeIds));
    return new Map(rows.map((r) => [r.recipeId, r.reviewStatus]));
  });
}

export async function setReviewStatus(
  recipeId: string,
  status: RecipeImport["reviewStatus"],
  opts: { amountsConfirmed?: boolean } = {},
): Promise<boolean> {
  return guarded("setReviewStatus", false, async () => {
    const now = new Date();
    const rows = await db
      .update(recipeImports)
      .set({
        reviewStatus: status,
        reviewedAt: status === "reviewed" ? now : null,
        ...(opts.amountsConfirmed ? { amountsConfirmedAt: now } : {}),
      })
      .where(eq(recipeImports.recipeId, recipeId))
      .returning({ recipeId: recipeImports.recipeId });
    return rows.length > 0;
  });
}

export interface PendingImportRow {
  recipeId: string;
  title: string;
  sourceType: SourceType;
  enrichmentStatus: string | null;
  enrichmentError: string | null;
  ingredients: string[];
  thumbnail: string | null;
  createdAt: Date;
}

/** The user's imports still waiting for a look, newest first */
export async function listPendingImports(ownerUserId: string, limit = 50): Promise<PendingImportRow[]> {
  return guarded("listPendingImports", [], async () => {
    const rows = await db
      .select({
        recipeId: recipeImports.recipeId,
        title: recipes.title,
        sourceType: recipeImports.sourceType,
        enrichmentStatus: recipes.enrichmentStatus,
        enrichmentError: recipes.enrichmentError,
        ingredients: recipes.ingredients,
        thumbnail: recipes.dishImageThumbnail,
        createdAt: recipeImports.createdAt,
      })
      .from(recipeImports)
      .innerJoin(recipes, eq(recipes.id, recipeImports.recipeId))
      .where(and(eq(recipeImports.ownerUserId, ownerUserId), eq(recipeImports.reviewStatus, "needs_review")))
      .orderBy(desc(recipeImports.createdAt))
      .limit(limit);
    return rows.map((r) => ({ ...r, ingredients: (r.ingredients ?? []).slice(0, 2) }));
  });
}
