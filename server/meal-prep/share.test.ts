import { describe, it, expect } from "vitest";
import { hashShareToken, looksLikeShareToken, newShareToken, shareExpiry, shareState } from "./share";

describe("share tokens", () => {
  it("makes long, unique, url-safe tokens and stores only a hash", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const { token, tokenHash } = newShareToken();
      expect(looksLikeShareToken(token)).toBe(true);
      expect(tokenHash).toBe(hashShareToken(token));
      expect(tokenHash).not.toContain(token);
      expect(tokenHash).toMatch(/^[0-9a-f]{64}$/);
      seen.add(token);
    }
    expect(seen.size).toBe(200);
  });

  it("rejects malformed tokens before any lookup", () => {
    expect(looksLikeShareToken("")).toBe(false);
    expect(looksLikeShareToken("abc")).toBe(false);
    expect(looksLikeShareToken("a".repeat(42) + "!")).toBe(false);
    expect(looksLikeShareToken("../" + "a".repeat(40))).toBe(false);
  });

  it("expires a few days after the session, within limits", () => {
    const now = new Date("2026-10-11T12:00:00Z");
    expect(shareExpiry(now, "2026-10-18").toISOString()).toBe("2026-10-21T23:59:59.000Z");
    // a past session still gives the cook at least a day
    expect(shareExpiry(now, "2026-09-01").getTime()).toBe(now.getTime() + 86_400_000);
    // never more than 30 days
    expect(shareExpiry(now, "2027-03-01").getTime()).toBe(now.getTime() + 30 * 86_400_000);
    expect(shareExpiry(now, null, 2).getTime()).toBe(now.getTime() + 2 * 86_400_000);
  });

  it("reports revoked and expired links", () => {
    const now = new Date("2026-10-11T12:00:00Z");
    expect(shareState({ expiresAt: new Date("2026-10-12"), revokedAt: null }, now)).toBe("active");
    expect(shareState({ expiresAt: new Date("2026-10-10"), revokedAt: null }, now)).toBe("expired");
    expect(shareState({ expiresAt: new Date("2026-10-12"), revokedAt: new Date("2026-10-11") }, now)).toBe("revoked");
  });
});
