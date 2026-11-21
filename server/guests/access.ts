// Who's asking, for the routes that work without an account (adding a recipe
// and seeing your own), plus the guest limits. Shapes and copy are in
// shared/guest.ts.
//
// A signed-in account always wins. Otherwise a valid guest token in the
// X-Grammie-Guest header makes the request act as that guest user: req.user
// gets { claims: { sub: guestUserId }, isGuest: true }, so getUserId() and
// everything after it work as for anyone. Requests without the header go
// through the normal sign-in check untouched.
//
// Limits (all per guest user or per address):
//   - GUEST_RECIPE_LIMIT recipes added (default 5), then a 403 guest_limit;
//     recipes on party dishes don't count (parties keep their own allowance)
//   - the party guests' per-address bursts: importIp for each add, joinIp
//     for starting a guest
//   - GUEST_STARTS_PER_IP_PER_DAY new guests from one address a day (default 10)
//   - guest credits, as for party guests (always enforced, see lib/credits.ts)

import crypto from "node:crypto";
import type { Request, RequestHandler, Response } from "express";
import {
  DEFAULT_GUEST_RECIPE_LIMIT, DEFAULT_GUEST_STARTS_PER_IP_PER_DAY, GUEST_LIMIT_CODE, GUEST_TOKEN_HEADER,
  guestLimitMessage,
} from "@shared/guest";
import { GUEST_HEADER as PARTY_GUEST_HEADER } from "@shared/party";
import type { PartyStore } from "../parties/store";
import { partyLimiters } from "../routes/parties";
import { hashShareToken, looksLikeShareToken } from "../meal-prep/share";
import { isMissingTable, type GuestStore } from "./store";

export interface GuestAccessDeps {
  store: GuestStore;
  /** Guest users are the party store's (one kind of guest) */
  parties: Pick<PartyStore, "createGuestUser" | "getUsers" | "findGuestByTokenHash" | "claimGuest">;
  /** isAuthenticated in production */
  auth: RequestHandler;
  /** optionalAuth in production */
  optionalAuth: RequestHandler;
  /** getUserId in production */
  userIdOf: (req: any) => string | undefined;
  /** After a claim moved party places: refresh those parties' shares */
  afterClaim?: (partyIds: string[]) => Promise<void>;
  recipeLimit?: () => number;
  startsPerIpPerDay?: () => number;
  /** Salt for address hashes (SESSION_SECRET in production) */
  ipSalt?: string;
  now?: () => Date;
  log?: Pick<Console, "warn" | "error">;
}

const envNumber = (name: string, fallback: number) => {
  const n = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};

export const guestRecipeLimit = () => envNumber("GUEST_RECIPE_LIMIT", DEFAULT_GUEST_RECIPE_LIMIT);
export const guestStartsPerIpPerDay = () => envNumber("GUEST_STARTS_PER_IP_PER_DAY", DEFAULT_GUEST_STARTS_PER_IP_PER_DAY);

/** True when this request is acting as a guest user (see accountOrGuest) */
export function isGuestRequest(req: any): boolean {
  return !!req?.user?.isGuest;
}

/** Recipe import options for this request: guests' recipes stay private */
export function importOptionsFor(req: any): { isPublic?: boolean } {
  return isGuestRequest(req) ? { isPublic: false } : {};
}

function runMiddleware(mw: RequestHandler, req: Request, res: Response): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      mw(req, res, (err?: unknown) => (err ? reject(err) : resolve()));
    } catch (err) {
      reject(err);
    }
  });
}

export type GuestAccess = ReturnType<typeof createGuestAccess>;

export function createGuestAccess(deps: GuestAccessDeps) {
  const { store, parties } = deps;
  const log = deps.log ?? console;
  const now = deps.now ?? (() => new Date());
  const limitOf = deps.recipeLimit ?? guestRecipeLimit;
  const startsCap = deps.startsPerIpPerDay ?? guestStartsPerIpPerDay;
  const limits = partyLimiters();
  const salt = deps.ipSalt ?? process.env.SESSION_SECRET ?? "";
  /** Adds still running, per guest, so a burst can't slip past the count */
  const inFlight = new Map<string, number>();
  let warnedMissing = false;

  const ip = (req: any) => String(req.ip ?? req.socket?.remoteAddress ?? "unknown");
  const ipHash = (req: any) => crypto.createHash("sha256").update(`${salt}:${ip(req)}`, "utf8").digest("hex");
  const rawToken = (req: any, header = GUEST_TOKEN_HEADER): string | null => {
    const raw = req.header?.(header);
    return typeof raw === "string" && looksLikeShareToken(raw) ? raw : null;
  };

  function missing(err: unknown): boolean {
    if (!isMissingTable(err)) return false;
    if (!warnedMissing) {
      log.warn("[Guests] guest_sessions is missing; run migrations/2026-11-guest-add.sql. Adding without an account is off until then.");
      warnedMissing = true;
    }
    return true;
  }

  async function isGuestUser(userId: string): Promise<boolean> {
    const [user] = await parties.getUsers([userId]);
    return !!user?.isGuest;
  }

  /** The guest user named by the request's guest token, if it's a real, unclaimed guest */
  async function guestUserOf(req: any): Promise<string | null> {
    if (req._guestUserId !== undefined) return req._guestUserId;
    const token = rawToken(req);
    let userId: string | null = null;
    if (token) {
      try {
        const found = await store.userForToken(hashShareToken(token));
        if (found && await isGuestUser(found)) userId = found;
      } catch (err) {
        if (!missing(err)) throw err;
      }
    }
    req._guestUserId = userId;
    return userId;
  }

  /** The guest user behind an anonymous party place this device has (X-Party-Guest), to reuse */
  async function partyGuestUserOf(req: any): Promise<string | null> {
    const token = rawToken(req, PARTY_GUEST_HEADER);
    if (!token) return null;
    const place = await parties.findGuestByTokenHash(hashShareToken(token));
    if (!place) return null;
    return (await isGuestUser(place.userId)) ? place.userId : null;
  }

  /** For routes that need someone: a signed-in account, else this device's guest, else the usual 401 */
  const accountOrGuest: RequestHandler = async (req: any, res, next) => {
    try {
      if (!rawToken(req)) return deps.auth(req, res, next);
      await runMiddleware(deps.optionalAuth, req, res);
      if (deps.userIdOf(req)) return next();
      const guestId = await guestUserOf(req);
      if (guestId) {
        req.user = { claims: { sub: guestId }, isGuest: true };
        return next();
      }
      return deps.auth(req, res, next);
    } catch (err) {
      next(err);
    }
  };

  /** For public reads that show more to their owner: an account, else this device's guest, else nobody */
  const optionalAccountOrGuest: RequestHandler = async (req: any, res, next) => {
    try {
      await runMiddleware(deps.optionalAuth, req, res);
      if (!deps.userIdOf(req) && rawToken(req)) {
        const guestId = await guestUserOf(req);
        if (guestId) req.user = { claims: { sub: guestId }, isGuest: true };
      }
      next();
    } catch (err) {
      next(err);
    }
  };

  /**
   * Before anything that adds a recipe (after accountOrGuest): guests get
   * the per-address burst limit and GUEST_RECIPE_LIMIT. Accounts pass.
   */
  const recipeLimit: RequestHandler = async (req: any, res, next) => {
    if (!isGuestRequest(req)) return next();
    try {
      if (!limits.importIp.hit(ip(req))) {
        return res.status(429).json({ error: "That's a lot of recipes at once. Wait a minute and try again." });
      }
      const userId = deps.userIdOf(req)!;
      const limit = limitOf();
      const used = (await store.addedRecipeCount(userId)) + (inFlight.get(userId) ?? 0);
      if (used >= limit) {
        return res.status(403).json({ error: guestLimitMessage(limit), code: GUEST_LIMIT_CODE, limit });
      }
      inFlight.set(userId, (inFlight.get(userId) ?? 0) + 1);
      let released = false;
      const release = () => {
        if (released) return;
        released = true;
        const left = (inFlight.get(userId) ?? 1) - 1;
        if (left > 0) inFlight.set(userId, left);
        else inFlight.delete(userId);
      };
      res.on("finish", release);
      res.on("close", release);
      next();
    } catch (err) {
      next(err);
    }
  };

  return {
    /** Every route that adds a recipe: an account or this device's guest, then the guest limits */
    addRecipe: [accountOrGuest, recipeLimit] as RequestHandler[],
    guestUserOf,
    partyGuestUserOf,
    accountOrGuest,
    optionalAccountOrGuest,
    recipeLimit,
    limitOf,
    startsCap,
    limits,
    ip,
    ipHash,
    rawToken,
    missing,
    now,
    log,
    deps,
    /** Ends this guest user's tokens (after a claim); never fails the caller */
    async forget(userId: string): Promise<void> {
      try {
        await store.forgetUser(userId);
      } catch (err) {
        if (!missing(err)) log.error("[Guests] Couldn't end the guest's tokens:", err);
      }
    },
  };
}
