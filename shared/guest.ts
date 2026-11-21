// "Add a recipe without an account": someone who isn't signed in can add a
// few recipes before being asked to make a free account. They get a guest
// user (users.is_guest), the same kind of user anonymous party guests get, so
// imports, credits and the claim on sign-up work the same way. The device
// keeps a guest token and sends it in GUEST_TOKEN_HEADER on every API call
// (client/src/lib/platform.ts); the server turns it back into that guest user
// (server/guests/access.ts). Signing in moves the recipes to the account.

/** Sent on every API call by a device that has added recipes as a guest */
export const GUEST_TOKEN_HEADER = "X-Grammie-Guest";

/** localStorage key holding this device's guest token */
export const GUEST_TOKEN_STORAGE_KEY = "grammie.guestToken";

/** Recipes a guest can add before making an account (GUEST_RECIPE_LIMIT overrides on the server) */
export const DEFAULT_GUEST_RECIPE_LIMIT = 5;

/** New guests one address can start in a day (GUEST_STARTS_PER_IP_PER_DAY overrides) */
export const DEFAULT_GUEST_STARTS_PER_IP_PER_DAY = 10;

/** The 403 code when a guest has used up their free recipes */
export const GUEST_LIMIT_CODE = "guest_limit";

/** The 429 code when too many guests were started from one address today */
export const GUEST_IP_LIMIT_CODE = "guest_ip_limit";

/** The 503 code when adding without an account isn't available (e.g. before its migration) */
export const GUEST_UNAVAILABLE_CODE = "guest_unavailable";

export function guestLimitMessage(limit: number): string {
  const n = limit === 1 ? "1 recipe" : `${limit} recipes`;
  return `You've added ${n}. Make a free account to keep going — your ${n} come with you.`;
}

/** GET /api/guest/me */
export interface GuestStatus {
  /** false when the token isn't (or is no longer) a guest's */
  isGuest: boolean;
  recipeCount: number;
  limit: number;
}

/** POST /api/guest/claim */
export interface GuestClaimResult {
  claimed: boolean;
  /** recipes moved to the account */
  moved: number;
}
