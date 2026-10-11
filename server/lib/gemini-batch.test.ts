import { describe, expect, it } from "vitest";
import {
  batchJsonl,
  inlineBatchBody,
  isFinished,
  mapInlineResults,
  normalizeState,
  parseBatchStatus,
  readBatchAnswer,
  responseImage,
  responseProblem,
  responseText,
} from "./gemini-batch";

const answer = (text: string, key: string) => ({
  response: { candidates: [{ content: { parts: [{ text, thoughtSignature: "x" }], role: "model" }, finishReason: "STOP" }] },
  metadata: { key },
});

// Trimmed from a real batch status response (gemini-3.5-flash-lite, Oct 2026)
const finishedInline = {
  name: "batches/abc",
  metadata: {
    "@type": "type.googleapis.com/google.ai.generativelanguage.v1main.GenerateContentBatch",
    model: "models/gemini-3.5-flash-lite",
    output: { inlinedResponses: { inlinedResponses: [answer('{"ok": true}', "r1"), answer('{"n": 4}', "r2")] } },
    batchStats: { requestCount: "2", successfulRequestCount: "2" },
    state: "BATCH_STATE_SUCCEEDED",
    name: "batches/abc",
  },
  done: true,
  response: {
    "@type": "type.googleapis.com/google.ai.generativelanguage.v1main.GenerateContentBatchOutput",
    inlinedResponses: { inlinedResponses: [answer('{"ok": true}', "r1"), answer('{"n": 4}', "r2")] },
  },
};

describe("batch requests", () => {
  it("builds an inline create body with our keys", () => {
    const body = inlineBatchBody("grammie-test", [{ key: "r1", request: { contents: [] } }]);
    expect(body.batch.display_name).toBe("grammie-test");
    expect(body.batch.input_config.requests.requests).toEqual([{ request: { contents: [] }, metadata: { key: "r1" } }]);
  });

  it("writes one {key, request} line per request", () => {
    const lines = batchJsonl([{ key: "a", request: { x: 1 } }, { key: "b", request: { x: 2 } }]).trim().split("\n");
    expect(lines.map((l) => JSON.parse(l))).toEqual([{ key: "a", request: { x: 1 } }, { key: "b", request: { x: 2 } }]);
  });
});

describe("batch status", () => {
  it("accepts both BATCH_STATE_ and JOB_STATE_ names", () => {
    expect(normalizeState("BATCH_STATE_RUNNING")).toBe("running");
    expect(normalizeState("JOB_STATE_SUCCEEDED")).toBe("succeeded");
    expect(normalizeState("BATCH_STATE_EXPIRED")).toBe("expired");
    expect(normalizeState(undefined)).toBe("unknown");
    expect(isFinished("pending")).toBe(false);
    expect(isFinished("expired")).toBe(true);
  });

  it("reads a pending operation", () => {
    const status = parseBatchStatus({ name: "batches/abc", metadata: { state: "BATCH_STATE_PENDING", name: "batches/abc" } });
    expect(status).toEqual({ name: "batches/abc", state: "pending" });
  });

  it("reads inline answers from a finished operation", () => {
    const status = parseBatchStatus(finishedInline);
    expect(status.state).toBe("succeeded");
    expect(status.inlinedResponses).toHaveLength(2);
  });

  it("reads the answer file of a file batch", () => {
    const status = parseBatchStatus({ name: "batches/f", metadata: { state: "BATCH_STATE_SUCCEEDED" }, response: { responsesFile: "files/out-1" } });
    expect(status.responsesFile).toBe("files/out-1");
  });
});

describe("batch results", () => {
  it("maps inline answers back by key", () => {
    const results = mapInlineResults(parseBatchStatus(finishedInline).inlinedResponses!);
    expect(responseText(results.get("r1")!.response)).toBe('{"ok": true}');
    expect(responseText(results.get("r2")!.response)).toBe('{"n": 4}');
  });

  it("falls back to position when an answer has no key", () => {
    const results = mapInlineResults([{ response: { candidates: [] } }], ["only"]);
    expect(results.has("only")).toBe(true);
  });

  it("reads a per-request error", () => {
    expect(readBatchAnswer({ key: "k", error: { code: 400, message: "bad" } })).toEqual(["k", { error: "[400] bad" }]);
  });

  it("reads answer-file lines with a top-level key", () => {
    const [key, result] = readBatchAnswer({ key: "img-1", response: { candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: "AAAA" } }] } }] } });
    expect(key).toBe("img-1");
    expect(responseImage(result.response)).toEqual({ data: "AAAA", mimeType: "image/png" });
  });

  it("skips thought parts and notices empty or blocked answers", () => {
    expect(responseText({ candidates: [{ content: { parts: [{ text: "thinking", thought: true }, { text: "{}" }] } }] })).toBe("{}");
    expect(responseProblem({ candidates: [{ finishReason: "SAFETY" }] })).toMatch(/SAFETY/);
    expect(responseProblem({ promptFeedback: { blockReason: "OTHER" } })).toMatch(/Blocked/);
    expect(responseProblem(finishedInline.response.inlinedResponses.inlinedResponses[0].response)).toBeNull();
    expect(responseImage({ candidates: [{ content: { parts: [{ text: "no image" }] } }] })).toBeNull();
  });
});
