// Production wiring for the party router: Postgres storage, the shared
// recipe importers, credits and the invite-page preview.

import { db } from "../db";
import { isAuthenticated, optionalAuth } from "../clerkAuth";
import { getUserId } from "../routes/route-utils";
import { createPartyRouter } from "../routes/parties";
import { createPgPartyStore } from "./store";
import { fetchInvitePreview } from "./invite-preview";
import { credits, gate } from "../lib/credits";
import { importLink, importPastedText, importPhoto } from "../lib/recipe-importers";

export function partyRouter() {
  return createPartyRouter({
    store: createPgPartyStore(db),
    auth: isAuthenticated,
    optionalAuth,
    userIdOf: getUserId,
    importer: {
      link: (url, userId, opts) => importLink(url, userId, opts),
      text: (text, userId, opts) => importPastedText(text, null, userId, opts),
      photo: (file, userId, opts) => importPhoto(file, userId, {}, opts),
    },
    credits: {
      gate: (res, userId) => gate(res, userId, "recipe_import"),
      balance: async (userId) => (await credits()?.balance(userId)) ?? null,
    },
    preview: (url) => fetchInvitePreview(url),
  });
}
