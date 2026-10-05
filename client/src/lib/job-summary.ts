// Counting for JobStatus (pure, so it's unit-tested): "3 of 12" plus the
// partial-state breakdown required by docs/DESIGN_PRINCIPLES.md §7.

export type JobState = "queued" | "working" | "needs_review" | "done" | "failed";

export interface JobCounts {
  total: number;
  /** Items no longer in progress (done, needs a look, or failed) */
  finished: number;
  working: number;
  done: number;
  needsReview: number;
  failed: number;
}

export function countJobs(items: ReadonlyArray<{ state: JobState }>): JobCounts {
  const c: JobCounts = { total: items.length, finished: 0, working: 0, done: 0, needsReview: 0, failed: 0 };
  for (const { state } of items) {
    if (state === "queued" || state === "working") c.working++;
    else {
      c.finished++;
      if (state === "done") c.done++;
      else if (state === "needs_review") c.needsReview++;
      else c.failed++;
    }
  }
  return c;
}

/** Fraction finished, 0–100 (for the overall bar) */
export function jobPercent(c: JobCounts): number {
  return c.total === 0 ? 0 : Math.round((c.finished / c.total) * 100);
}

/** e.g. ["1 needs a look", "2 couldn't be finished"] — empty when nothing to report */
export function jobBreakdown(c: JobCounts, failedLabel = "couldn't be finished"): string[] {
  const parts: string[] = [];
  if (c.needsReview) parts.push(`${c.needsReview} ${c.needsReview === 1 ? "needs" : "need"} a look`);
  if (c.failed) parts.push(`${c.failed} ${failedLabel}`);
  return parts;
}
