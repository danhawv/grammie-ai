// The bulk lane: which AI work waits for Gemini's Batch API (half price,
// minutes to hours) instead of running right away. Pure decisions only; the
// database and polling side is server/batch-queue.ts.
//
// Only work nobody is waiting on goes to batch:
// - dishImage: the dish photo (~6.9¢ of the ~9¢ a card costs). Batched
//   photos use their own model, modelFor("dishImageBulk") (Nano Banana 2
//   Lite, ~1.7¢ batched). The recipe shows the card photo and "Photo coming
//   soon" until it arrives.
// - enrichContent: tips, pairings, history (~a third of the enrichment
//   tokens). Optional extras that already load after the recipe is usable.
// Card reading (vision) and core enrichment (ingredients, steps, nutrition)
// stay real-time, so every recipe is readable and editable in seconds.

import { generationConfigFor, type AIJob, type ModelChoice } from "../ai-models";
import type { BatchRequest } from "./gemini-batch";

export type BatchJob = "dishImage" | "enrichContent";
export const BATCH_JOBS: BatchJob[] = ["dishImage", "enrichContent"];

export interface BatchLaneConfig {
  enabled: boolean;
  /** An import of at least this many recipes goes to batch */
  minRecipes: number;
  jobs: BatchJob[];
  /** How often the poller runs */
  pollMs: number;
  /** Longest a queued request waits for more to join its batch */
  flushMs: number;
  /** Most requests in one batch */
  maxPerBatch: number;
}

/**
 * GEMINI_BATCH=off turns the lane off (everything real-time).
 * GEMINI_BATCH_MIN_RECIPES (default 20): imports this big go to batch.
 * GEMINI_BATCH_JOBS (default "dishImage,enrichContent"): which work is batched.
 * GEMINI_BATCH_POLL_MS (default 60s), GEMINI_BATCH_FLUSH_MS (default 3 min),
 * GEMINI_BATCH_MAX_REQUESTS (default 200).
 */
export function batchLaneConfig(env: Record<string, string | undefined> = process.env): BatchLaneConfig {
  const off = /^(off|0|false|no)$/i.test(env.GEMINI_BATCH ?? "");
  const jobs = (env.GEMINI_BATCH_JOBS ?? BATCH_JOBS.join(","))
    .split(",")
    .map((j) => j.trim())
    .filter((j): j is BatchJob => (BATCH_JOBS as string[]).includes(j));
  return {
    enabled: !off,
    minRecipes: Math.max(1, Number(env.GEMINI_BATCH_MIN_RECIPES) || 20),
    jobs,
    pollMs: Math.max(5_000, Number(env.GEMINI_BATCH_POLL_MS) || 60_000),
    flushMs: Math.max(0, Number(env.GEMINI_BATCH_FLUSH_MS ?? NaN) >= 0 ? Number(env.GEMINI_BATCH_FLUSH_MS) : 3 * 60_000),
    maxPerBatch: Math.max(1, Number(env.GEMINI_BATCH_MAX_REQUESTS) || 200),
  };
}

export interface LaneInput {
  job: BatchJob;
  provider: string;
  /** The batch table exists (the migration has been applied) */
  storeReady: boolean;
  /** The import was flagged bulk by whoever created it */
  markedBulk: boolean;
  /** Size of the upload session the recipe belongs to, if any */
  sessionSize?: number | null;
}

export function chooseLane(input: LaneInput, config: BatchLaneConfig): "batch" | "realtime" {
  if (!config.enabled || !input.storeReady || input.provider !== "gemini") return "realtime";
  if (!config.jobs.includes(input.job)) return "realtime";
  if (input.markedBulk) return "batch";
  return (input.sessionSize ?? 0) >= config.minRecipes ? "batch" : "realtime";
}

/**
 * The generateContent body for one batched job, matching what the real-time
 * call sends: same prompt, same model settings.
 */
export function batchRequestBody(job: BatchJob, prompt: string, choice: ModelChoice): Record<string, unknown> {
  const contents = [{ role: "user", parts: [{ text: prompt }] }];
  if (job === "dishImage") return { contents, generationConfig: { responseModalities: ["TEXT", "IMAGE"] } };
  return { contents, generationConfig: generationConfigFor(choice) };
}

/** Which model setting a batched job uses (see ai-models.ts) */
export function batchModelJob(job: BatchJob): AIJob {
  return job === "dishImage" ? "dishImageBulk" : job;
}

/** Dish photos go by file (big answers); text goes inline */
export function submitMode(job: BatchJob): "file" | "inline" {
  return job === "dishImage" ? "file" : "inline";
}

// Inline batches must stay under 20MB; leave room for the envelope
const INLINE_BYTES = 15 * 1024 * 1024;

/**
 * Splits queued requests into batches: one model per batch, at most
 * `maxPerBatch` requests, and inline batches under the size limit.
 */
export function splitIntoBatches<T extends BatchRequest & { model: string }>(
  rows: T[],
  mode: "file" | "inline",
  maxPerBatch: number,
): T[][] {
  const byModel = new Map<string, T[]>();
  for (const r of rows) byModel.set(r.model, [...(byModel.get(r.model) ?? []), r]);
  const batches: T[][] = [];
  for (const group of Array.from(byModel.values())) {
    let current: T[] = [];
    let bytes = 0;
    for (const r of group) {
      const size = mode === "inline" ? JSON.stringify(r.request).length : 0;
      if (current.length && (current.length >= maxPerBatch || bytes + size > INLINE_BYTES)) {
        batches.push(current);
        current = [];
        bytes = 0;
      }
      current.push(r);
      bytes += size;
    }
    if (current.length) batches.push(current);
  }
  return batches;
}

/** Whether queued requests should be sent now rather than wait for more */
export function shouldFlush(queuedCount: number, oldestAgeMs: number, config: BatchLaneConfig): boolean {
  if (!queuedCount) return false;
  return queuedCount >= config.maxPerBatch || oldestAgeMs >= config.flushMs;
}

// Google expires batches after 48h; give up a little later in case a status
// never arrives, and redo the work in real time
export const BATCH_GIVE_UP_MS = 50 * 60 * 60 * 1000;
