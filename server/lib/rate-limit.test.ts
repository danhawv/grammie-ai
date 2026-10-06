import { describe, expect, it } from "vitest";
import { detectRateLimit } from "./rate-limit";

describe("detectRateLimit", () => {
  it("uses the delay Google asks for", () => {
    const err = new Error('[429 Too Many Requests] Resource has been exhausted [{"@type":"type.googleapis.com/google.rpc.RetryInfo","retryDelay":"23s"}]');
    expect(detectRateLimit(err)).toMatchObject({ isRateLimited: true, retryAfterMs: 23000 });
  });

  it("retries a bare 429 after 15s, not a minute", () => {
    expect(detectRateLimit(new Error("[429 Too Many Requests] Resource has been exhausted (e.g. check quota)."))).toMatchObject({ retryAfterMs: 15000 });
  });

  it("retries Google server errors quickly", () => {
    expect(detectRateLimit(new Error("[500 Internal Server Error] Internal error encountered."))).toMatchObject({ isRateLimited: true, retryAfterMs: 5000 });
  });

  it("caps very long waits at a minute", () => {
    expect(detectRateLimit(new Error('429 quota "retryDelay":"900s"')).retryAfterMs).toBe(60000);
  });

  it("leaves other errors to normal backoff", () => {
    expect(detectRateLimit(new Error("Gemini returned invalid JSON"))).toEqual({ isRateLimited: false, retryAfterMs: null });
  });
});
