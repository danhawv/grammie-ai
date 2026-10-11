// Small in-memory rate limits for the meal-prep routes (one server process,
// like the admin Gemini test limiter). Planning runs the solver and the
// model, so it gets a tighter limit than reads.

import type { RequestHandler } from "express";

export interface RateLimiter {
  /** true = allowed (and counted) */
  hit(key: string, now?: number): boolean;
}

export function createRateLimiter(max: number, windowMs: number): RateLimiter {
  const hits = new Map<string, { count: number; resetAt: number }>();
  let lastSweep = 0;
  return {
    hit(key, now = Date.now()) {
      if (now - lastSweep > windowMs) {
        for (const [k, v] of Array.from(hits.entries())) if (v.resetAt <= now) hits.delete(k);
        lastSweep = now;
      }
      const entry = hits.get(key);
      if (!entry || entry.resetAt <= now) {
        hits.set(key, { count: 1, resetAt: now + windowMs });
        return true;
      }
      if (entry.count >= max) return false;
      entry.count++;
      return true;
    },
  };
}

/** Express middleware; keyOf returns null to skip limiting */
export function limit(limiter: RateLimiter, keyOf: (req: any) => string | null, message: string): RequestHandler {
  return (req, res, next) => {
    const key = keyOf(req);
    if (key && !limiter.hit(key)) return res.status(429).json({ error: message });
    next();
  };
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** One set of limiters per router, so tests start fresh */
export function mealPrepLimiters() {
  return {
    /** any signed-in route */
    general: createRateLimiter(120, MINUTE),
    /** solving a plan: create, re-plan, swap options */
    planMinute: createRateLimiter(6, MINUTE),
    planDay: createRateLimiter(60, DAY),
    share: createRateLimiter(20, HOUR),
    instacart: createRateLimiter(10, HOUR),
    /** cook page, per link */
    cookRead: createRateLimiter(120, MINUTE),
    cookWrite: createRateLimiter(60, MINUTE),
    /** cook page, per address, so tokens can't be tried in bulk */
    cookIp: createRateLimiter(240, MINUTE),
  };
}

export type MealPrepLimiters = ReturnType<typeof mealPrepLimiters>;
