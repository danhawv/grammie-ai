import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { acceptImagePass, createImagePass, IMAGE_PASS_TTL_SECONDS, verifyImagePass } from "./image-pass";

describe("image passes", () => {
  beforeEach(() => { vi.stubEnv("SESSION_SECRET", "test-secret"); vi.stubEnv("IMAGE_PASS_SECRET", ""); });
  afterEach(() => vi.unstubAllEnvs());

  it("round-trips the user", () => {
    const made = createImagePass("user-123")!;
    expect(verifyImagePass(made.pass)).toBe("user-123");
  });

  it("refuses an expired pass", () => {
    const made = createImagePass("u1", Date.now() - (IMAGE_PASS_TTL_SECONDS + 5) * 1000)!;
    expect(verifyImagePass(made.pass)).toBeNull();
  });

  it("refuses a pass for another user with the same signature", () => {
    const [, exp, sig] = createImagePass("u1")!.pass.split(".");
    const forged = `${Buffer.from("u2").toString("base64url")}.${exp}.${sig}`;
    expect(verifyImagePass(forged)).toBeNull();
  });

  it("refuses a pass signed with another secret", () => {
    const made = createImagePass("u1")!;
    vi.stubEnv("SESSION_SECRET", "other-secret");
    expect(verifyImagePass(made.pass)).toBeNull();
  });

  it("refuses junk", () => {
    for (const junk of [undefined, "", "a.b", "a.b.c", 42, "x".repeat(600)]) expect(verifyImagePass(junk)).toBeNull();
  });

  it("signs the request in only with a valid pass, else falls back", () => {
    const fallback = vi.fn((_req, _res, next) => next());
    const mw = acceptImagePass(fallback as any);
    const next = vi.fn();
    const req: any = { query: { pass: createImagePass("u9")!.pass } };
    mw(req, {} as any, next);
    expect(req.user.claims.sub).toBe("u9");
    expect(fallback).not.toHaveBeenCalled();

    const req2: any = { query: { pass: "bad.pass.here" } };
    mw(req2, {} as any, next);
    expect(req2.user).toBeUndefined();
    expect(fallback).toHaveBeenCalledTimes(1);
  });
});
