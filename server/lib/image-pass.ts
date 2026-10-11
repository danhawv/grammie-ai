// Image passes: a short-lived signed note that lets an <img> load the
// signed-in person's private pictures (family photos, original cards, bulk
// import photos) when it can't carry sign-in itself.
//
// In a browser the sign-in cookie rides along with every <img> request. In the
// iPhone/iPad app the page lives on capacitor://localhost, so the cookie can't
// reach grammie.ai and an <img> can't send a bearer token. The app asks for a
// pass (GET /api/image-pass, signed in) and adds ?pass=... to those image URLs.
//
// A pass names one user and an expiry, signed with HMAC-SHA256 using the
// server secret. It is accepted only by the image routes wrapped with
// acceptImagePass(), never by the rest of the API.

import crypto from "crypto";
import type { RequestHandler } from "express";

/** How long a pass lasts; the app fetches a new one well before this */
export const IMAGE_PASS_TTL_SECONDS = 12 * 60 * 60;

function secret(): string | null {
  const s = process.env.IMAGE_PASS_SECRET || process.env.SESSION_SECRET;
  if (s) return s;
  return process.env.NODE_ENV === "development" ? "development-image-pass-secret" : null;
}

function sign(payload: string, key: string): string {
  return crypto.createHmac("sha256", key).update(`image-pass:${payload}`).digest("base64url");
}

/** A pass for this user, or null when the server has no secret to sign with */
export function createImagePass(userId: string, now = Date.now()): { pass: string; expiresAt: number } | null {
  const key = secret();
  if (!key) return null;
  const exp = Math.floor(now / 1000) + IMAGE_PASS_TTL_SECONDS;
  const payload = `${Buffer.from(userId).toString("base64url")}.${exp}`;
  return { pass: `${payload}.${sign(payload, key)}`, expiresAt: exp * 1000 };
}

/** The user a pass was made for, or null if it's forged, malformed or expired */
export function verifyImagePass(pass: unknown, now = Date.now()): string | null {
  const key = secret();
  if (!key || typeof pass !== "string" || pass.length > 512) return null;
  const parts = pass.split(".");
  if (parts.length !== 3) return null;
  const [user, expText, sig] = parts;
  const exp = Number(expText);
  if (!Number.isInteger(exp) || exp * 1000 < now) return null;
  const expected = Buffer.from(sign(`${user}.${expText}`, key));
  const given = Buffer.from(sig);
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;
  const userId = Buffer.from(user, "base64url").toString("utf8");
  return userId || null;
}

/**
 * For image routes: a valid ?pass= signs the request in as its user; anything
 * else goes through the route's usual sign-in check.
 */
export function acceptImagePass(fallback: RequestHandler): RequestHandler {
  return (req: any, res, next) => {
    const userId = req.query?.pass ? verifyImagePass(req.query.pass) : null;
    if (userId) {
      req.user = { claims: { sub: userId }, expires_at: Math.floor(Date.now() / 1000) + 300, isImagePass: true };
      return next();
    }
    return fallback(req, res, next);
  };
}
