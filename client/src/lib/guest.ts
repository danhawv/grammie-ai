import {
  GUEST_IP_LIMIT_CODE, GUEST_LIMIT_CODE, GUEST_UNAVAILABLE_CODE,
  type GuestClaimResult, type GuestStatus,
} from "@shared/guest";
import { GUEST_HEADER as PARTY_GUEST_HEADER, GUEST_STORAGE_KEY as PARTY_GUEST_STORAGE_KEY } from "@shared/party";
import { apiFetch, guestToken, setGuestToken } from "./platform";

// Adding recipes without an account (shared/guest.ts). The first add on a
// device that isn't signed in asks the server for a guest token
// (ensureGuest); platform.ts keeps it and sends it on every call. After the
// guest limit the add routes answer 403 guest_limit and the Add sheet asks
// them to make a free account; signing in moves the recipes over (claim).

export { guestToken, setGuestToken };

/** Why adding without an account stopped: the sheet shows sign-up / sign-in for these */
export type GuestStop = { kind: "limit" | "signin"; message?: string; limit?: number };

/** Turns an API error into a guest stop, or null when it's an ordinary error */
export function guestStopFrom(err: unknown): GuestStop | null {
  const raw = err instanceof Error ? err.message : String(err ?? "");
  const m = raw.match(/^(\d{3}):\s*([\s\S]*)$/);
  if (!m) return null;
  const status = Number(m[1]);
  let body: { code?: string; error?: string; limit?: number } = {};
  try { body = JSON.parse(m[2]); } catch { /* not JSON */ }
  if (status === 403 && body.code === GUEST_LIMIT_CODE) return { kind: "limit", message: body.error, limit: body.limit };
  if ((status === 429 && body.code === GUEST_IP_LIMIT_CODE) || (status === 503 && body.code === GUEST_UNAVAILABLE_CODE)) {
    return { kind: "signin", message: body.error };
  }
  // Not signed in and no working guest token (e.g. it was moved to an account)
  if (status === 401) return { kind: "signin" };
  return null;
}

/** A party guest token this device has, so the server keeps one guest user per person */
function anyPartyGuestToken(): string | null {
  try {
    const all = JSON.parse(localStorage.getItem(PARTY_GUEST_STORAGE_KEY) || "{}");
    const first = all && typeof all === "object" ? Object.values(all).find((v) => typeof v === "string" && v) : null;
    return (first as string | undefined) ?? null;
  } catch {
    return null;
  }
}

async function failure(res: Response): Promise<Error> {
  const text = await res.text().catch(() => "");
  return new Error(`${res.status}: ${text || res.statusText}`);
}

/**
 * Makes sure this device has a guest token before an add (no-op when it has
 * one, or when the server says it's signed in). Throws apiRequest-style
 * "status: body" errors, which guestStopFrom understands.
 */
export async function ensureGuest(): Promise<void> {
  const party = anyPartyGuestToken();
  const res = await apiFetch("/api/guest/start", {
    method: "POST",
    headers: party ? { [PARTY_GUEST_HEADER]: party } : {},
  });
  if (!res.ok) throw await failure(res);
  const body = (await res.json()) as { guestToken: string | null };
  if (body.guestToken) setGuestToken(body.guestToken);
}

export async function fetchGuestStatus(): Promise<GuestStatus> {
  const res = await apiFetch("/api/guest/me");
  if (!res.ok) throw await failure(res);
  return res.json();
}

/** Signed in: moves this device's guest recipes to the account and forgets the token */
export async function claimGuestRecipes(): Promise<GuestClaimResult> {
  const res = await apiFetch("/api/guest/claim", { method: "POST" });
  if (!res.ok) throw await failure(res);
  const body = (await res.json()) as GuestClaimResult;
  setGuestToken(null);
  return body;
}

/** Sign-up and sign-in that come back to where they were (the claim runs on its own, see GuestClaimer) */
export function guestSignInPath(mode: "signup" | "signin", next = "/"): string {
  return `/login?${mode === "signup" ? "mode=signup&" : ""}next=${encodeURIComponent(next)}`;
}
