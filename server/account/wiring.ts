// Production wiring for "Delete my account": Postgres, Clerk, media storage.

import { createClerkClient } from "@clerk/backend";
import { isAuthenticated, markClerkUserDeleted } from "../clerkAuth";
import { getSharedPool } from "../pg-pool";
import { getUserId } from "../routes/route-utils";
import { getMediaStorage } from "../lib/media-storage";
import { createAccountRouter } from "../routes/account";
import { createPgAccountStore } from "./store";

export function accountRouter() {
  const secretKey = process.env.CLERK_SECRET_KEY;
  const media = getMediaStorage();
  return createAccountRouter({
    store: createPgAccountStore(getSharedPool()),
    auth: isAuthenticated,
    userIdOf: getUserId,
    deleteClerkUser: secretKey
      ? async (clerkId) => {
          markClerkUserDeleted(clerkId);
          await createClerkClient({ secretKey }).users.deleteUser(clerkId);
        }
      : undefined,
    deleteMedia: media ? (key) => media.delete(key) : undefined,
  });
}
