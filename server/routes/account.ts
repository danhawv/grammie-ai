// "Delete my account" (Me > Account), mounted at /api:
//
//   DELETE /account  signed in only (guests have no account): removes
//                    everything the person owns (account/plan.ts), their
//                    users row, their Clerk sign-in, and media files nobody
//                    else uses. Refused while a print order is in progress.
//
// Logs one audit line: the user id and row counts, nothing personal.

import { Router, type RequestHandler } from "express";
import type { AccountStore } from "../account/store";

export const PRINT_ORDER_IN_PROGRESS_CODE = "PRINT_ORDER_IN_PROGRESS";

export interface AccountRouterDeps {
  store: AccountStore;
  auth: RequestHandler;
  userIdOf: (req: any) => string | undefined;
  /** Deletes the person in Clerk (users.clerk_id); missing when Clerk isn't set up */
  deleteClerkUser?: (clerkId: string) => Promise<void>;
  /** Removes a /media/ file; missing when media lives in the database */
  deleteMedia?: (key: string) => Promise<void>;
  log?: { info: (...a: any[]) => void; warn: (...a: any[]) => void; error: (...a: any[]) => void };
}

export function createAccountRouter(deps: AccountRouterDeps): Router {
  const router = Router();
  const log = deps.log ?? console;

  router.delete("/account", deps.auth, async (req: any, res) => {
    res.setHeader("Cache-Control", "no-store");
    const userId = deps.userIdOf(req);
    if (!userId) return res.status(401).json({ error: "Please sign in first." });
    try {
      const user = await deps.store.find(userId);
      if (!user) return res.status(404).json({ error: "We couldn't find your account. It may already be deleted." });
      if (user.isGuest) {
        return res.status(400).json({ error: "You're adding recipes without an account, so there's no account to delete." });
      }

      const inProgress = await deps.store.printOrdersInProgress(userId);
      if (inProgress > 0) {
        return res.status(409).json({
          code: PRINT_ORDER_IN_PROGRESS_CODE,
          error: inProgress === 1
            ? "You have a printed book on its way. Once it's delivered you can delete your account. If you need help sooner, email danhawv@gmail.com."
            : "You have printed books on their way. Once they're delivered you can delete your account. If you need help sooner, email danhawv@gmail.com.",
        });
      }

      const result = await deps.store.deleteAll(userId);

      // The database part is done; the rest is cleanup that shouldn't undo it
      let clerk = "none";
      if (result.clerkId && deps.deleteClerkUser) {
        try {
          await deps.deleteClerkUser(result.clerkId);
          clerk = "deleted";
        } catch (err: any) {
          // A 404 means Clerk already has no such user
          if (err?.status === 404 || err?.statusCode === 404) clerk = "already-gone";
          else { clerk = "failed"; log.error(`[Account] Clerk delete failed for user ${userId}:`, err?.message || err); }
        }
      } else if (result.clerkId) {
        clerk = "not-configured";
      }

      let mediaRemoved = 0;
      if (deps.deleteMedia && result.mediaKeys.length) {
        try {
          for (const key of await deps.store.unusedMediaKeys(result.mediaKeys)) {
            await deps.deleteMedia(key);
            mediaRemoved++;
          }
        } catch (err: any) {
          log.warn(`[Account] Media cleanup for user ${userId} stopped:`, err?.message || err);
        }
      }

      const nonZero = Object.entries(result.counts).filter(([, n]) => n > 0).map(([k, n]) => `${k}=${n}`).join(" ");
      log.info(`[Account] Deleted user ${userId}: ${nonZero || "no rows"}; media=${mediaRemoved}; clerk=${clerk}${result.skipped.length ? `; skipped=${result.skipped.join(",")}` : ""}`);

      res.json({ deleted: true });
    } catch (err) {
      log.error(`[Account] Deleting user ${userId} failed:`, err);
      res.status(500).json({ error: "We couldn't delete your account just now. Nothing was removed. Please try again, or email danhawv@gmail.com." });
    }
  });

  return router;
}
