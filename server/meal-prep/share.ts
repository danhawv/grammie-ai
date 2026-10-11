// Cook share links. The token is 32 random bytes (256 bits, base64url), so
// it can't be guessed; only its SHA-256 is stored, so a database leak doesn't
// hand out working links. A link ends when it expires or is revoked.

import crypto from "node:crypto";

const DAY_MS = 24 * 60 * 60 * 1000;
/** Links stay open this long after the cooking day, for reheating and labels */
export const DAYS_AFTER_SESSION = 3;
export const MAX_SHARE_DAYS = 30;

export function newShareToken(): { token: string; tokenHash: string } {
  const token = crypto.randomBytes(32).toString("base64url");
  return { token, tokenHash: hashShareToken(token) };
}

export function hashShareToken(token: string): string {
  return crypto.createHash("sha256").update(token, "utf8").digest("hex");
}

/** Cheap shape check before touching the database (43 base64url chars) */
export function looksLikeShareToken(token: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(token);
}

/**
 * When a new link expires: expiresInDays from now if given, otherwise a few
 * days after the session (at least one day from now), never beyond 30 days.
 */
export function shareExpiry(now: Date, sessionDate: string | null, expiresInDays?: number): Date {
  const max = now.getTime() + MAX_SHARE_DAYS * DAY_MS;
  if (expiresInDays) return new Date(Math.min(now.getTime() + expiresInDays * DAY_MS, max));
  const session = sessionDate ? Date.parse(`${sessionDate}T23:59:59Z`) : NaN;
  const fromSession = Number.isNaN(session) ? now.getTime() + 7 * DAY_MS : session + DAYS_AFTER_SESSION * DAY_MS;
  return new Date(Math.min(Math.max(fromSession, now.getTime() + DAY_MS), max));
}

export type ShareState = "active" | "expired" | "revoked";

export function shareState(share: { expiresAt: Date; revokedAt: Date | null }, now: Date): ShareState {
  if (share.revokedAt) return "revoked";
  if (share.expiresAt.getTime() <= now.getTime()) return "expired";
  return "active";
}
