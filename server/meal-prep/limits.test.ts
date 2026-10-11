import { describe, it, expect } from "vitest";
import { createRateLimiter } from "./limits";

describe("createRateLimiter", () => {
  it("allows up to the limit per key per window", () => {
    const l = createRateLimiter(2, 1000);
    expect(l.hit("a", 0)).toBe(true);
    expect(l.hit("a", 10)).toBe(true);
    expect(l.hit("a", 20)).toBe(false);
    expect(l.hit("b", 20)).toBe(true);
    expect(l.hit("a", 1001)).toBe(true);
  });
});
