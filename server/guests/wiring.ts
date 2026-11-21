// Production wiring for "add a recipe without an account": Postgres storage,
// the party store's guest users, and the normal sign-in checks.

import { db } from "../db";
import { isAuthenticated, optionalAuth } from "../clerkAuth";
import { getUserId } from "../routes/route-utils";
import { createPgPartyStore } from "../parties/store";
import { syncPartyShares } from "../routes/parties";
import { createGuestRouter } from "../routes/guest";
import { createGuestAccess } from "./access";
import { createPgGuestStore } from "./store";

const partyStore = createPgPartyStore(db);

export const guestAccess = createGuestAccess({
  store: createPgGuestStore(db),
  parties: partyStore,
  auth: isAuthenticated,
  optionalAuth,
  userIdOf: getUserId,
  afterClaim: async (partyIds) => {
    for (const id of partyIds) await syncPartyShares(partyStore, id);
  },
});

export function guestRouter() {
  return createGuestRouter(guestAccess);
}
