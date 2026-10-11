// The bulk lane's durable side: queues dish photos and content enrichment
// for Gemini's Batch API, submits them, polls, and saves the answers through
// the same code the real-time queue uses. Which work goes here, and why, is
// in server/lib/batch-lane.ts.
//
// Everything lives in gemini_batch_requests (migrations/2026-10-gemini-
// batch.sql), so a restart or redeploy loses nothing: the next poll carries
// on. Rows are claimed with conditional UPDATEs, so two servers overlapping
// during a deploy don't save an answer twice.
//
// If a batch fails, expires or loses a request, that work is redone in real
// time, so a recipe never waits forever.

import { getSharedPool } from "./pg-pool";
import { storage } from "./storage";
import { modelFor } from "./ai-models";
import { getCurrentProvider, contentEnrichmentPrompt, parseGeminiJsonText } from "./ai-service";
import { dishImagePrompt } from "./gemini";
import { buildImagePrompt } from "./openai";
import {
  BATCH_GIVE_UP_MS,
  batchLaneConfig,
  batchModelJob,
  batchRequestBody,
  chooseLane,
  shouldFlush,
  splitIntoBatches,
  submitMode,
  type BatchJob,
} from "./lib/batch-lane";
import {
  createFileBatch,
  createInlineBatch,
  getBatch,
  isFinished,
  mapInlineResults,
  readResultsFile,
  responseImage,
  responseProblem,
  responseText,
  type BatchResult,
} from "./lib/gemini-batch";

const TABLE = "gemini_batch_requests";
// A server that died mid-submit or mid-save leaves rows claimed; release them after this
const STALE_CLAIM_MS = 15 * 60 * 1000;
const MAX_SUBMIT_ATTEMPTS = 3;

interface Row {
  id: string;
  recipe_id: string;
  job: BatchJob;
  model: string;
  request: Record<string, unknown>;
  extra: Record<string, any> | null;
  attempts: number;
  batch_name?: string | null;
}

// ============ Which imports are bulk ============

// Recipes flagged bulk by whoever created them (jobQueue.addExtractionJob(id,
// image, { bulk: true }) or markBulkImport). Kept in memory: after a restart
// a recipe still counts as bulk if its upload session is big enough.
const markedBulk = new Set<string>();

/** Flags recipes as part of a bulk import, so their photos and extras go to batch */
export function markBulkImport(recipeIds: string[]) {
  for (const id of recipeIds) markedBulk.add(id);
}

// Whether the table exists, checked at most every 5 minutes, so the lane
// switches itself on once the migration is applied
let storeReady: boolean | null = null;
let storeCheckedAt = 0;
async function isStoreReady(): Promise<boolean> {
  if (storeReady && Date.now() - storeCheckedAt < 60 * 60 * 1000) return true;
  if (storeReady === false && Date.now() - storeCheckedAt < 5 * 60 * 1000) return false;
  try {
    const { rows } = await getSharedPool().query(`SELECT to_regclass($1) AS t`, [TABLE]);
    storeReady = !!rows[0]?.t;
    if (!storeReady) console.log(`[Batch] ${TABLE} not found (migration not applied); bulk lane off`);
  } catch {
    storeReady = false;
  }
  storeCheckedAt = Date.now();
  return storeReady;
}

/** Whether this recipe's `job` should go to batch rather than run now */
export async function useBatchLane(recipeId: string, job: BatchJob): Promise<boolean> {
  const config = batchLaneConfig();
  if (!config.enabled) return false;
  try {
    let sessionSize: number | null = null;
    if (!markedBulk.has(recipeId)) {
      const { rows } = await getSharedPool().query(
        `SELECT s.total_files FROM recipes r JOIN upload_sessions s ON s.id = r.upload_session_id WHERE r.id = $1`,
        [recipeId],
      );
      sessionSize = rows[0]?.total_files ?? null;
    }
    const lane = chooseLane(
      { job, provider: getCurrentProvider(), storeReady: await isStoreReady(), markedBulk: markedBulk.has(recipeId), sessionSize },
      config,
    );
    return lane === "batch";
  } catch (error) {
    console.error(`[Batch] Lane check failed for ${recipeId}, running now:`, error);
    return false;
  }
}

// ============ Queueing ============

/**
 * Queues a recipe's dish photo or content for the next batch and marks the
 * recipe "queued" (the page shows "coming soon"). Returns false if it
 * couldn't, and the caller runs the work in real time instead.
 */
export async function queueForBatch(recipeId: string, job: BatchJob): Promise<boolean> {
  try {
    const recipe = await storage.getRecipe(recipeId);
    if (!recipe) return false;
    const choice = modelFor(batchModelJob(job));
    let prompt: string;
    let extra: Record<string, unknown> | null = null;

    if (job === "dishImage") {
      // Same prompt the real-time photo uses (job-queue processImageJob)
      const ingredientNames = recipe.normalizedIngredients?.map((i) => i.item) || recipe.ingredients;
      const context = {
        instructions: recipe.instructions,
        cookingMethods: recipe.cookingMethods || undefined,
        cuisines: recipe.cuisines || undefined,
        mealType: recipe.mealType || undefined,
        skillLevel: recipe.skillLevel || undefined,
      };
      prompt = dishImagePrompt(recipe.title, context.cuisines || [], context.cookingMethods || [], context);
      // Saved with the photo so it can be edited later, as in real time
      extra = { imagePrompt: buildImagePrompt(recipe.title, ingredientNames, context) };
    } else {
      const { contentEnrichmentInput } = await import("./job-queue");
      prompt = contentEnrichmentPrompt(contentEnrichmentInput(recipe));
    }

    const { rowCount } = await getSharedPool().query(
      `INSERT INTO ${TABLE} (recipe_id, job, model, request, extra) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT DO NOTHING`,
      [recipeId, job, choice.model, JSON.stringify(batchRequestBody(job, prompt, choice)), extra && JSON.stringify(extra)],
    );
    if (!rowCount) console.log(`[Batch] ${job} for ${recipeId} already waiting on a batch`);

    await storage.updateRecipe(
      recipeId,
      job === "dishImage" ? { imageGenerationStatus: "queued", imageGenerationError: null } : { contentEnrichmentStatus: "queued" },
    );
    console.log(`[Batch] Queued ${job} for ${recipeId} (${choice.model})`);
    return true;
  } catch (error) {
    console.error(`[Batch] Couldn't queue ${job} for ${recipeId}, running now:`, error);
    return false;
  }
}

// ============ Submitting ============

async function submitDue() {
  const config = batchLaneConfig();
  const pool = getSharedPool();

  // Release claims left by a server that stopped mid-submit
  await pool.query(
    `UPDATE ${TABLE} SET status = 'queued', updated_at = now() WHERE status = 'submitting' AND updated_at < now() - ($1 || ' milliseconds')::interval`,
    [STALE_CLAIM_MS],
  );

  const { rows: waiting } = await pool.query(
    `SELECT job, count(*)::int AS n, extract(epoch FROM now() - min(created_at)) * 1000 AS age_ms FROM ${TABLE} WHERE status = 'queued' GROUP BY job`,
  );
  for (const w of waiting) {
    if (!shouldFlush(w.n, Number(w.age_ms), config)) continue;
    const job = w.job as BatchJob;

    // Claim up to a few batches' worth at once
    const { rows } = await pool.query<Row>(
      `UPDATE ${TABLE} SET status = 'submitting', updated_at = now()
       WHERE id IN (SELECT id FROM ${TABLE} WHERE status = 'queued' AND job = $1 ORDER BY created_at LIMIT $2 FOR UPDATE SKIP LOCKED)
       RETURNING id, recipe_id, job, model, request, extra, attempts`,
      [job, config.maxPerBatch * 5],
    );
    const requests = rows.map((r) => ({ ...r, key: r.id }));
    for (const batch of splitIntoBatches(requests, submitMode(job), config.maxPerBatch)) {
      const model = batch[0].model;
      const displayName = `grammie-${job}-${new Date().toISOString().slice(0, 16)}-${batch.length}`;
      try {
        const name = submitMode(job) === "file"
          ? await createFileBatch(model, displayName, batch)
          : await createInlineBatch(model, displayName, batch);
        await pool.query(
          `UPDATE ${TABLE} SET status = 'submitted', batch_name = $2, submitted_at = now(), attempts = attempts + 1, updated_at = now() WHERE id = ANY($1)`,
          [batch.map((r) => r.id), name],
        );
        console.log(`[Batch] Submitted ${name}: ${batch.length} ${job} request(s) on ${model}`);
      } catch (error: any) {
        console.error(`[Batch] Submitting ${batch.length} ${job} request(s) failed: ${error.message}`);
        const giveUp = batch.filter((r) => r.attempts + 1 >= MAX_SUBMIT_ATTEMPTS);
        const retry = batch.filter((r) => r.attempts + 1 < MAX_SUBMIT_ATTEMPTS);
        if (retry.length) {
          await pool.query(
            `UPDATE ${TABLE} SET status = 'queued', attempts = attempts + 1, error = $2, updated_at = now() WHERE id = ANY($1)`,
            [retry.map((r) => r.id), error.message],
          );
        }
        for (const r of giveUp) await fallBack(r, `Couldn't submit batch: ${error.message}`);
      }
    }
  }
}

// ============ Collecting ============

async function collectFinished() {
  const pool = getSharedPool();

  // Release saves left by a server that stopped mid-save (answers stay
  // downloadable for 6 weeks, so they're fetched again)
  await pool.query(
    `UPDATE ${TABLE} SET status = 'submitted', updated_at = now() WHERE status = 'applying' AND updated_at < now() - ($1 || ' milliseconds')::interval`,
    [STALE_CLAIM_MS],
  );

  const { rows: batches } = await pool.query(
    `SELECT batch_name, extract(epoch FROM now() - min(submitted_at)) * 1000 AS age_ms FROM ${TABLE} WHERE status = 'submitted' GROUP BY batch_name`,
  );
  for (const b of batches) {
    try {
      await collectBatch(b.batch_name, Number(b.age_ms));
    } catch (error: any) {
      console.error(`[Batch] Checking ${b.batch_name} failed: ${error.message}`);
    }
  }
}

async function collectBatch(name: string, ageMs: number) {
  const pool = getSharedPool();
  const status = await getBatch(name);

  if (!isFinished(status.state)) {
    if (ageMs > BATCH_GIVE_UP_MS) {
      console.warn(`[Batch] ${name} still ${status.state} after 50h; redoing its work now`);
      await fallBackBatch(name, `Batch still ${status.state} after 50 hours`);
    }
    return;
  }
  if (status.state !== "succeeded") {
    console.warn(`[Batch] ${name} ended ${status.state}; redoing its work now`);
    await fallBackBatch(name, `Batch ${status.state}${status.error ? `: ${status.error}` : ""}`);
    return;
  }

  const { rows } = await pool.query<Row>(
    `SELECT id, recipe_id, job, model, request, extra, attempts, batch_name FROM ${TABLE} WHERE batch_name = $1 AND status = 'submitted'`,
    [name],
  );
  const byId = new Map(rows.map((r) => [r.id, r]));
  let saved = 0;

  const handle = async (key: string | undefined, result: BatchResult) => {
    const row = key ? byId.get(key) : undefined;
    if (!row) return;
    byId.delete(row.id);
    if (await applyResult(row, result)) saved++;
  };

  if (status.inlinedResponses) {
    // Inline answers come back in request order; rows are matched by key
    for (const [key, result] of Array.from(mapInlineResults(status.inlinedResponses))) await handle(key, result);
  } else if (status.responsesFile) {
    for await (const [key, result] of readResultsFile(status.responsesFile)) await handle(key, result);
  }

  // Requests the batch didn't answer
  for (const row of Array.from(byId.values())) await fallBack(row, "No answer in batch results");
  console.log(`[Batch] ${name} done: ${saved} saved, ${rows.length - saved} redone in real time`);
}

/** Saves one answer. Returns true if saved, false if it fell back to real time */
async function applyResult(row: Row, result: BatchResult): Promise<boolean> {
  const pool = getSharedPool();
  // Claim it, so an overlapping server doesn't save it too
  const claimed = await pool.query(
    `UPDATE ${TABLE} SET status = 'applying', updated_at = now() WHERE id = $1 AND status = 'submitted'`,
    [row.id],
  );
  if (!claimed.rowCount) return false;

  try {
    if (result.error) throw new Error(result.error);
    const problem = responseProblem(result.response);
    if (problem) throw new Error(problem);
    const { saveDishImage, saveContentEnrichment } = await import("./job-queue");

    if (row.job === "dishImage") {
      const image = responseImage(result.response);
      if (!image) throw new Error("No image in batch answer");
      await saveDishImage(row.recipe_id, Buffer.from(image.data, "base64"), image.mimeType, row.extra?.imagePrompt ?? "");
    } else {
      await saveContentEnrichment(row.recipe_id, parseGeminiJsonText(responseText(result.response)));
    }
    await pool.query(`UPDATE ${TABLE} SET status = 'done', finished_at = now(), error = NULL, updated_at = now() WHERE id = $1`, [row.id]);
    return true;
  } catch (error: any) {
    await fallBack(row, error.message);
    return false;
  }
}

// ============ Falling back to real time ============

async function fallBackBatch(name: string, reason: string) {
  const { rows } = await getSharedPool().query<Row>(
    `SELECT id, recipe_id, job, model, request, extra, attempts FROM ${TABLE} WHERE batch_name = $1 AND status = 'submitted'`,
    [name],
  );
  for (const row of rows) await fallBack(row, reason);
}

/** Redoes one request through the real-time queue */
async function fallBack(row: Pick<Row, "id" | "recipe_id" | "job">, reason: string) {
  console.warn(`[Batch] ${row.job} for ${row.recipe_id} redone in real time: ${reason}`);
  await getSharedPool().query(
    `UPDATE ${TABLE} SET status = 'fallback', error = $2, finished_at = now(), updated_at = now() WHERE id = $1`,
    [row.id, reason.slice(0, 1000)],
  );
  const recipe = await storage.getRecipe(row.recipe_id);
  if (!recipe) return;
  const { jobQueue } = await import("./job-queue");
  if (row.job === "dishImage") {
    await storage.updateRecipe(row.recipe_id, { imageGenerationStatus: "pending" });
    const ingredientNames = recipe.normalizedIngredients?.map((i) => i.item) || recipe.ingredients;
    jobQueue.addImageGenerationJob(row.recipe_id, recipe.title, ingredientNames);
  } else {
    await storage.updateRecipe(row.recipe_id, { contentEnrichmentStatus: "enriching" });
    jobQueue.addContentEnrichmentJob(row.recipe_id);
  }
}

// ============ Poller ============

let running = false;

/** One pass: send what's due, save what's finished */
export async function pollBatches() {
  if (running) return;
  running = true;
  try {
    if (!(await isStoreReady())) return;
    await submitDue();
    await collectFinished();
  } catch (error) {
    console.error("[Batch] Poll failed:", error);
  } finally {
    running = false;
  }
}

/** Starts the in-process poller. Runs even with GEMINI_BATCH=off, so work already queued still finishes */
export function startBatchPoller() {
  const { pollMs, enabled, minRecipes } = batchLaneConfig();
  setInterval(pollBatches, pollMs);
  setTimeout(pollBatches, 10_000);
  console.log(`[Batch] Poller started (every ${pollMs / 1000}s; bulk lane ${enabled ? `on for imports of ${minRecipes}+` : "off"})`);
}
