import {
  GUEST_HEADER,
  GUEST_STORAGE_KEY,
  type AddDishRequest,
  type CreatePartyRequest,
  type InvitePreview,
  type JoinPartyRequest,
  type PartyCourse,
  type PartyDetail,
  type PartyDish,
  type PartySummary,
  type UpdatePartyRequest,
} from "@shared/party";
import { apiFetch } from "./platform";

// Every call the party screens make: /api/parties (host and signed-in
// members) and /api/party/:token (the invite link, works signed out). Typed
// against shared/party.ts so endpoint details change in one place.
//
// Anonymous guests get a guest token when they join. It's kept on this device
// as { [inviteToken]: guestToken } and sent in the X-Party-Guest header on
// every /api/party/:token call.

// ---------- Guest tokens on this device ----------

type Store = Pick<Storage, "getItem" | "setItem">;

function defaultStore(): Store | null {
  try { return typeof localStorage === "undefined" ? null : localStorage; } catch { return null; }
}

function readAll(store: Store | null): Record<string, string> {
  try {
    const parsed = JSON.parse(store?.getItem(GUEST_STORAGE_KEY) || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function writeAll(store: Store | null, all: Record<string, string>) {
  try { store?.setItem(GUEST_STORAGE_KEY, JSON.stringify(all)); } catch { /* private mode: not remembered */ }
}

export function getGuestToken(inviteToken: string, store: Store | null = defaultStore()): string | null {
  const v = readAll(store)[inviteToken];
  return typeof v === "string" && v ? v : null;
}

export function setGuestToken(inviteToken: string, guestToken: string, store: Store | null = defaultStore()): void {
  writeAll(store, { ...readAll(store), [inviteToken]: guestToken });
}

export function clearGuestToken(inviteToken: string, store: Store | null = defaultStore()): void {
  const all = readAll(store);
  delete all[inviteToken];
  writeAll(store, all);
}

// ---------- Errors ----------

/** The API answers errors as {error} in plain words; keep them for the screen */
export class PartyApiError extends Error {
  constructor(public status: number, message: string, public code?: string) {
    super(message);
  }
}

const FALLBACK: Record<number, string> = {
  402: "You're out of free credits for adding recipes. You can still bring a dish by name.",
  404: "We couldn't find this party. The link may have changed. Ask the host for a new one.",
  429: "That's a lot of requests. Wait a minute and try again.",
};

/** Words for an error, safe to show: the server's own sentence, else a calm default */
export function partyErrorText(err: unknown, fallback = "Check your connection and try again."): string {
  if (err instanceof PartyApiError) return err.message || FALLBACK[err.status] || fallback;
  return fallback;
}

async function call<T>(method: string, path: string, body?: unknown, inviteToken?: string): Promise<T> {
  const headers: Record<string, string> = {};
  const isForm = typeof FormData !== "undefined" && body instanceof FormData;
  if (body !== undefined && !isForm) headers["Content-Type"] = "application/json";
  const guest = inviteToken ? getGuestToken(inviteToken) : null;
  if (guest) headers[GUEST_HEADER] = guest;
  const res = await apiFetch(path, {
    method,
    headers,
    body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body),
    credentials: "include",
  });
  const text = await res.text().catch(() => "");
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
  if (!res.ok) throw new PartyApiError(res.status, json?.error || FALLBACK[res.status] || "", json?.code);
  return json as T;
}

// ---------- Calls ----------

const host = (id: string) => `/api/parties/${encodeURIComponent(id)}`;
const link = (token: string) => `/api/party/${encodeURIComponent(token)}`;

export type SlotInput = { id?: string; course: PartyCourse; label?: string | null };

export const partyApi = {
  // Host and signed-in members
  list: () => call<PartySummary[]>("GET", "/api/parties"),
  create: (body: CreatePartyRequest) => call<PartyDetail>("POST", "/api/parties", body),
  get: (id: string) => call<PartyDetail>("GET", host(id)),
  update: (id: string, body: UpdatePartyRequest) => call<PartyDetail>("PATCH", host(id), body),
  cancel: (id: string) => call<unknown>("DELETE", host(id)),
  setSlots: (id: string, slots: SlotInput[]) => call<PartyDetail>("PUT", `${host(id)}/slots`, { slots }),
  rotateInvite: (id: string) => call<{ inviteUrl: string }>("POST", `${host(id)}/invite/rotate`),
  removeGuest: (id: string, guestId: string) => call<unknown>("DELETE", `${host(id)}/guests/${encodeURIComponent(guestId)}`),
  removeDishAsHost: (id: string, dishId: string) => call<unknown>("DELETE", `${host(id)}/dishes/${encodeURIComponent(dishId)}`),
  invitePreview: (url: string) => call<InvitePreview>("POST", "/api/parties/invite-preview", { url }),

  // The invite link (signed in or not)
  byToken: (token: string) => call<PartyDetail>("GET", link(token), undefined, token),
  join: (token: string, body: JoinPartyRequest) => call<{ guestId: string; guestToken?: string }>("POST", `${link(token)}/join`, body, token),
  updateMe: (token: string, body: Partial<JoinPartyRequest>) => call<unknown>("PATCH", `${link(token)}/me`, body, token),
  addDish: (token: string, body: AddDishRequest) => call<PartyDish>("POST", `${link(token)}/dishes`, body, token),
  importLink: (token: string, body: { url: string; course: PartyCourse; slotId?: string | null }) =>
    call<PartyDish>("POST", `${link(token)}/dishes/import-link`, body, token),
  importText: (token: string, body: { text: string; course: PartyCourse; slotId?: string | null }) =>
    call<PartyDish>("POST", `${link(token)}/dishes/import-text`, body, token),
  importPhoto: (token: string, image: Blob, course: PartyCourse, slotId?: string | null) => {
    const form = new FormData();
    form.append("image", image, image instanceof File && image.name ? image.name : "recipe.jpg");
    form.append("course", course);
    if (slotId) form.append("slotId", slotId);
    return call<PartyDish>("POST", `${link(token)}/dishes/import-photo`, form, token);
  },
  updateDish: (token: string, dishId: string, body: { slotId?: string | null; course?: PartyCourse; title?: string; note?: string | null }) =>
    call<PartyDish>("PATCH", `${link(token)}/dishes/${encodeURIComponent(dishId)}`, body, token),
  removeDish: (token: string, dishId: string) => call<unknown>("DELETE", `${link(token)}/dishes/${encodeURIComponent(dishId)}`, undefined, token),
  dishRecipe: (token: string, dishId: string) => call<any>("GET", `${link(token)}/dishes/${encodeURIComponent(dishId)}/recipe`, undefined, token),
  claim: (token: string) => call<unknown>("POST", `${link(token)}/claim`, {}, token),
  saveCookbook: (token: string) => call<{ cookbookId?: number | string } | null>("POST", `${link(token)}/save-cookbook`, {}, token),
};

export const partyKeys = {
  list: ["parties"] as const,
  host: (id: string) => ["parties", "host", id] as const,
  invite: (token: string) => ["parties", "invite", token] as const,
  dishRecipe: (token: string, dishId: string) => ["parties", "invite", token, "dish", dishId] as const,
};
