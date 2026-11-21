// "Add a recipe without an account", mounted at /api (shapes in shared/guest.ts):
//
//   POST /guest/start  a guest token for this device (the same one again if
//                      it already has a working one); signed-in people get none
//   GET  /guest/me     how many recipes this device's guest has added
//   POST /guest/claim  signed in: move this device's guest recipes (and any
//                      party places) to the account and end the token
//
// The add routes themselves are the normal ones (routes/recipes.ts) behind
// accountOrGuest + recipeLimit (guests/access.ts).

import { Router } from "express";
import {
  GUEST_IP_LIMIT_CODE, GUEST_UNAVAILABLE_CODE,
  type GuestClaimResult, type GuestStatus,
} from "@shared/guest";
import { newShareToken } from "../meal-prep/share";
import type { GuestAccess } from "../guests/access";

const DAY_MS = 24 * 60 * 60 * 1000;
const UNAVAILABLE = "Adding recipes without an account isn't available right now. Sign in or make a free account to add recipes.";

export function createGuestRouter(access: GuestAccess): Router {
  const router = Router();
  const { deps } = access;
  const { store, parties } = deps;

  router.use("/guest", (_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });

  router.post("/guest/start", deps.optionalAuth, async (req: any, res) => {
    try {
      if (deps.userIdOf(req)) return res.json({ guestToken: null, signedIn: true });
      // One guest per token: a device that already has one keeps it
      const current = access.rawToken(req);
      if (current && await access.guestUserOf(req)) {
        return res.json({ guestToken: current, limit: access.limitOf() });
      }
      if (!access.limits.joinIp.hit(access.ip(req))) {
        return res.status(429).json({ error: "Lots of people started from here just now. Wait a few minutes and try again." });
      }
      const ipHash = access.ipHash(req);
      let startedToday: number;
      try {
        startedToday = await store.tokensFromIpSince(ipHash, new Date(access.now().getTime() - DAY_MS));
      } catch (err) {
        if (access.missing(err)) return res.status(503).json({ error: UNAVAILABLE, code: GUEST_UNAVAILABLE_CODE });
        throw err;
      }
      if (startedToday >= access.startsCap()) {
        return res.status(429).json({
          error: "A lot of recipes were added from this internet connection today. Make a free account to keep going.",
          code: GUEST_IP_LIMIT_CODE,
        });
      }
      // A party guest on this device keeps their one guest user: one set of
      // credits, and one claim moves everything
      const userId = (await access.partyGuestUserOf(req)) ?? await parties.createGuestUser("Guest");
      const { token, tokenHash } = newShareToken();
      await store.addToken({ tokenHash, userId, ipHash });
      res.status(201).json({ guestToken: token, limit: access.limitOf() });
    } catch (err) {
      access.log.error("[Guests] Starting a guest:", err);
      res.status(500).json({ error: "Something went wrong. Please try again." });
    }
  });

  router.get("/guest/me", async (req: any, res) => {
    try {
      const userId = await access.guestUserOf(req);
      const limit = access.limitOf();
      const body: GuestStatus = userId
        ? { isGuest: true, recipeCount: await store.addedRecipeCount(userId), limit }
        : { isGuest: false, recipeCount: 0, limit };
      res.json(body);
    } catch (err) {
      access.log.error("[Guests] Guest status:", err);
      res.status(500).json({ error: "Something went wrong. Please try again." });
    }
  });

  router.post("/guest/claim", deps.auth, async (req: any, res) => {
    try {
      const accountId = deps.userIdOf(req);
      if (!accountId) return res.status(401).json({ error: "Sign in first, then we'll move your recipes to your account." });
      const guestId = await access.guestUserOf(req);
      const nothing: GuestClaimResult = { claimed: false, moved: 0 };
      if (!guestId || guestId === accountId) return res.json(nothing);
      const moved = await store.addedRecipeCount(guestId);
      const touched = await parties.claimGuest(guestId, accountId);
      await access.forget(guestId);
      if (touched.length && deps.afterClaim) {
        await deps.afterClaim(touched).catch((err) => access.log.error("[Guests] Party shares after a claim:", err));
      }
      const body: GuestClaimResult = { claimed: true, moved };
      res.json(body);
    } catch (err) {
      access.log.error("[Guests] Claim:", err);
      res.status(500).json({ error: "Something went wrong moving your recipes to your account. Please try again." });
    }
  });

  return router;
}
