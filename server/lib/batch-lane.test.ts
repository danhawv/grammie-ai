import { describe, expect, it } from "vitest";
import {
  batchLaneConfig,
  batchModelJob,
  batchRequestBody,
  chooseLane,
  shouldFlush,
  splitIntoBatches,
  submitMode,
} from "./batch-lane";

const config = batchLaneConfig({});
const lane = (over: Partial<Parameters<typeof chooseLane>[0]> = {}, cfg = config) =>
  chooseLane({ job: "dishImage", provider: "gemini", storeReady: true, markedBulk: false, sessionSize: null, ...over }, cfg);

describe("batch lane config", () => {
  it("defaults to on, 20 recipes, photos and extras", () => {
    expect(config).toMatchObject({ enabled: true, minRecipes: 20, jobs: ["dishImage", "enrichContent"], pollMs: 60_000, flushMs: 180_000, maxPerBatch: 200 });
  });

  it("reads the env switches", () => {
    expect(batchLaneConfig({ GEMINI_BATCH: "off" }).enabled).toBe(false);
    expect(batchLaneConfig({ GEMINI_BATCH: "on" }).enabled).toBe(true);
    expect(batchLaneConfig({ GEMINI_BATCH_MIN_RECIPES: "50" }).minRecipes).toBe(50);
    expect(batchLaneConfig({ GEMINI_BATCH_JOBS: "dishImage, vision" }).jobs).toEqual(["dishImage"]);
    expect(batchLaneConfig({ GEMINI_BATCH_FLUSH_MS: "0" }).flushMs).toBe(0);
  });
});

describe("chooseLane", () => {
  it("keeps single and small imports real-time", () => {
    expect(lane()).toBe("realtime");
    expect(lane({ sessionSize: 5 })).toBe("realtime");
    expect(lane({ sessionSize: 19 })).toBe("realtime");
  });

  it("batches big sessions and imports flagged bulk", () => {
    expect(lane({ sessionSize: 20 })).toBe("batch");
    expect(lane({ sessionSize: 177, job: "enrichContent" })).toBe("batch");
    expect(lane({ markedBulk: true })).toBe("batch");
  });

  it("stays real-time when off, unmigrated, not Gemini, or the job isn't batched", () => {
    expect(lane({ markedBulk: true }, batchLaneConfig({ GEMINI_BATCH: "off" }))).toBe("realtime");
    expect(lane({ markedBulk: true, storeReady: false })).toBe("realtime");
    expect(lane({ markedBulk: true, provider: "openai" })).toBe("realtime");
    expect(lane({ markedBulk: true, job: "enrichContent" }, batchLaneConfig({ GEMINI_BATCH_JOBS: "dishImage" }))).toBe("realtime");
  });
});

describe("batch requests", () => {
  it("asks for an image for dish photos", () => {
    const body: any = batchRequestBody("dishImage", "a pie", { model: "gemini-3.1-flash-lite-image" });
    expect(body.contents[0].parts[0].text).toBe("a pie");
    expect(body.generationConfig).toEqual({ responseModalities: ["TEXT", "IMAGE"] });
  });

  it("asks for JSON with the model's thinking setting for content", () => {
    const body: any = batchRequestBody("enrichContent", "tips please", { model: "m", thinkingLevel: "low" });
    expect(body.generationConfig).toEqual({ responseMimeType: "application/json", thinkingConfig: { thinkingLevel: "low" } });
  });

  it("uses the bulk photo model and sends photos by file", () => {
    expect(batchModelJob("dishImage")).toBe("dishImageBulk");
    expect(batchModelJob("enrichContent")).toBe("enrichContent");
    expect(submitMode("dishImage")).toBe("file");
    expect(submitMode("enrichContent")).toBe("inline");
  });
});

describe("splitIntoBatches", () => {
  const row = (key: string, model = "m", size = 10) => ({ key, model, request: { text: "x".repeat(size) } });

  it("keeps one model per batch and caps the count", () => {
    const rows = [row("a"), row("b", "other"), row("c"), row("d")];
    const batches = splitIntoBatches(rows, "file", 2);
    expect(batches.map((b) => b.map((r) => r.key))).toEqual([["a", "c"], ["d"], ["b"]]);
  });

  it("keeps inline batches under the size limit", () => {
    const rows = [row("a", "m", 8_000_000), row("b", "m", 8_000_000), row("c", "m", 100)];
    expect(splitIntoBatches(rows, "inline", 100).map((b) => b.length)).toEqual([1, 2]);
  });
});

describe("shouldFlush", () => {
  it("waits for more unless the batch is full or the oldest has waited long enough", () => {
    expect(shouldFlush(0, 10 ** 9, config)).toBe(false);
    expect(shouldFlush(5, 60_000, config)).toBe(false);
    expect(shouldFlush(5, 180_000, config)).toBe(true);
    expect(shouldFlush(200, 0, config)).toBe(true);
  });
});
