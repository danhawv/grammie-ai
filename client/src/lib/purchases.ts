import { apiFetch, isNativeApp } from "./platform";
import type { CreditPack } from "@shared/credits";

// Buying credit packs inside the iPhone/iPad app (App Store consumables,
// StoreKit 2). The page calls buyCreditsInApp(pack); the native side (the
// Capacitor shell, client/src/native/) registers a StorePurchases adapter
// with registerStorePurchases() at startup. Until it does, buying in the app
// says "Coming soon in the app".
//
// The flow:
//   1. POST /api/credits/apple/token  -> this account's appAccountToken (a UUID)
//   2. adapter.purchase(productId, token): StoreKit 2
//      Product.purchase(options: [.appAccountToken(token)]); returns the
//      verified transaction's jwsRepresentation
//   3. POST /api/credits/apple/transaction {jws}: the server verifies it with
//      Apple's library and adds the credits (once per transaction)
//   4. adapter.finish(transactionId) when the server says finish: true. An
//      unfinished transaction comes back through adapter.unfinished() (and
//      StoreKit's Transaction.updates), so nothing is lost if the app closes.

export type StorePurchaseResult =
  | { status: "purchased"; jws: string; transactionId: string }
  | { status: "cancelled" }
  /** Ask to Buy or a payment that needs more steps: it arrives later through unfinished() */
  | { status: "pending" };

export interface StorePurchases {
  /** Buys one consumable; appAccountToken ties it to this Grammie account */
  purchase(productId: string, appAccountToken: string): Promise<StorePurchaseResult>;
  /** Marks a transaction finished once the server has the credits */
  finish(transactionId: string): Promise<void>;
  /** Transactions bought but not yet finished (Transaction.unfinished) */
  unfinished?(): Promise<Array<{ jws: string; transactionId: string }>>;
  /** Localized App Store prices by product id ("$4.99"), to show in place of the web price */
  prices?(productIds: string[]): Promise<Record<string, string>>;
}

let store: StorePurchases | null = null;

/** Called by the native shell at startup */
export function registerStorePurchases(adapter: StorePurchases | null): void {
  store = adapter;
}

/** True when the app can sell credits (native app with the store adapter registered) */
export function inAppPurchasesReady(): boolean {
  return isNativeApp() && !!store;
}

export type BuyResult =
  | { status: "added"; credits: number; balance: number | null }
  | { status: "cancelled" }
  | { status: "pending"; message: string }
  | { status: "unavailable"; message: string }
  | { status: "error"; message: string };

export const COMING_SOON = "Coming soon in the app. For now you can add credits at grammie.ai.";

async function post<T>(path: string, body?: unknown): Promise<{ ok: boolean; status: number; body: T & { error?: string } }> {
  const res = await apiFetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: any = {};
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    /* not JSON */
  }
  return { ok: res.ok, status: res.status, body: parsed };
}

/** Sends a finished StoreKit purchase to the server and finishes it when the credits are in */
async function deliver(jws: string, transactionId: string): Promise<BuyResult> {
  const sent = await post<{ credits: number; balance: number | null; finish?: boolean }>("/api/credits/apple/transaction", { jws });
  if (sent.body.finish && store) await store.finish(transactionId).catch(() => {});
  if (!sent.ok) return { status: "error", message: sent.body.error || "We couldn't add those credits yet. We'll try again next time you open the app." };
  return { status: "added", credits: sent.body.credits, balance: sent.body.balance };
}

/** Buys a credit pack in the app */
export async function buyCreditsInApp(pack: CreditPack): Promise<BuyResult> {
  if (!inAppPurchasesReady() || !store) return { status: "unavailable", message: COMING_SOON };
  try {
    const token = await post<{ appAccountToken: string }>("/api/credits/apple/token");
    if (!token.ok) return { status: "unavailable", message: token.body.error || COMING_SOON };
    const bought = await store.purchase(pack.appleProductId, token.body.appAccountToken);
    if (bought.status === "cancelled") return { status: "cancelled" };
    if (bought.status === "pending") return { status: "pending", message: "Your purchase is waiting for approval. The credits will appear when it goes through." };
    return await deliver(bought.jws, bought.transactionId);
  } catch (err) {
    console.error("[Purchases] Buying credits failed:", err);
    return { status: "error", message: "The purchase didn't go through. Please try again in a moment." };
  }
}

/** Delivers purchases that weren't finished (call at app start and when the app comes back) */
export async function syncUnfinishedPurchases(): Promise<number> {
  if (!inAppPurchasesReady() || !store?.unfinished) return 0;
  let added = 0;
  for (const t of await store.unfinished().catch(() => [])) {
    const r = await deliver(t.jws, t.transactionId).catch(() => null);
    if (r?.status === "added") added += r.credits;
  }
  return added;
}
