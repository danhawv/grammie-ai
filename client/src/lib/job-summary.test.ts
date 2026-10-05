import { describe, expect, it } from "vitest";
import { countJobs, jobBreakdown, jobPercent } from "./job-summary";

describe("job summary", () => {
  const items = [
    { state: "working" as const },
    { state: "queued" as const },
    { state: "done" as const },
    { state: "needs_review" as const },
    { state: "needs_review" as const },
    { state: "failed" as const },
  ];

  it("counts finished work for '3 of 12'", () => {
    const c = countJobs(items);
    expect(c).toEqual({ total: 6, finished: 4, working: 2, done: 1, needsReview: 2, failed: 1 });
    expect(jobPercent(c)).toBe(67);
  });

  it("describes the partial state in plain words", () => {
    expect(jobBreakdown(countJobs(items), "couldn't be read")).toEqual(["2 need a look", "1 couldn't be read"]);
    expect(jobBreakdown(countJobs([{ state: "needs_review" }]))).toEqual(["1 needs a look"]);
    expect(jobBreakdown(countJobs([{ state: "done" }]))).toEqual([]);
  });

  it("handles an empty list", () => {
    expect(jobPercent(countJobs([]))).toBe(0);
  });
});
