// Buying credits inside the iPhone/iPad app, through the App Store (Apple
// requires in-app purchase for credits used in the app). The website buys
// credits with Stripe on /credits and doesn't use this file.
//
// The flow, for one consumable pack:
//   1. POST /api/credits/apple/token     → a UUID tying the purchase to this account
//   2. StoreKit purchase with that appAccountToken
//   3. POST /api/credits/apple/transaction with Apple's signed transaction (JWS);
//      the server checks it with Apple and adds the credits once
//   4. finish the transaction, only after the server has recorded it
// A purchase interrupted between 2 and 4 (app closed, no signal) is finished
// by recoverUnfinishedPurchases() on the next launch or resume.
//
// The native plugin is loaded on demand so the website never downloads it.

import { apiFetch, isNativeApp } from "./platform";

/** App Store product ids are "ai.grammie.app.credits.<pack id>" (shared/credits.ts) */
export const APPLE_PRODUCT_PREFIX = "ai.grammie.app.credits.";
export const appleProductId = (packId: string) => `${APPLE_PRODUCT_PREFIX}${packId}`;

export interface StorePack {
  packId: string;
  productId: string;
  /** Local price from the App Store, e.g. "$4.99" */
  price: string;
  title: string;
}

export type BuyResult =
  | { status: "purchased"; balance?: number }
  | { status: "cancelled" }
  | { status: "pending" } // Ask to Buy or a payment that needs approval
  | { status: "failed"; message: string };

async function plugin() {
  return import("@capgo/native-purchases");
}

/** Whether credits can be bought through the App Store here */
export function canBuyInApp(): boolean {
  return isNativeApp();
}

/** The packs as the App Store prices them for this person (empty on the web) */
export async function availablePacks(packIds: string[]): Promise<StorePack[]> {
  if (!isNativeApp() || packIds.length === 0) return [];
  const { NativePurchases, PURCHASE_TYPE } = await plugin();
  const { products } = await NativePurchases.getProducts({
    productIdentifiers: packIds.map(appleProductId),
    productType: PURCHASE_TYPE.INAPP,
  });
  return products.map((p) => ({
    packId: p.identifier.slice(APPLE_PRODUCT_PREFIX.length),
    productId: p.identifier,
    price: p.priceString,
    title: p.title,
  }));
}

async function readJson(res: Response): Promise<any> {
  return res.json().catch(() => ({}));
}

/** Records a StoreKit transaction with our server; true once the credits are on the account */
async function recordWithServer(tx: { transactionId: string; productIdentifier: string; jwsRepresentation?: string }): Promise<{ ok: boolean; balance?: number; message?: string }> {
  if (!tx.jwsRepresentation) return { ok: false, message: "The App Store didn't send a receipt for this purchase." };
  const res = await apiFetch("/api/credits/apple/transaction", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jws: tx.jwsRepresentation, transactionId: tx.transactionId, productId: tx.productIdentifier }),
  });
  const body = await readJson(res);
  if (!res.ok) return { ok: false, message: body?.error || body?.message };
  return { ok: true, balance: typeof body?.balance === "number" ? body.balance : undefined };
}

/** Buys one credits pack through the App Store */
export async function buyCredits(packId: string): Promise<BuyResult> {
  if (!isNativeApp()) return { status: "failed", message: "Credits are bought on the Credits page on the website." };
  const { NativePurchases, PURCHASE_TYPE } = await plugin();

  const tokenRes = await apiFetch("/api/credits/apple/token", { method: "POST" });
  const tokenBody = await readJson(tokenRes);
  const appAccountToken: string | undefined = tokenBody?.appAccountToken ?? tokenBody?.token;
  if (!tokenRes.ok || !appAccountToken) {
    return { status: "failed", message: tokenBody?.error || "Couldn't start the purchase. Check you're signed in and try again." };
  }

  let tx;
  try {
    tx = await NativePurchases.purchaseProduct({
      productIdentifier: appleProductId(packId),
      productType: PURCHASE_TYPE.INAPP,
      quantity: 1,
      appAccountToken,
      autoAcknowledgePurchases: false,
    });
  } catch (err) {
    const message = String((err as Error)?.message ?? err);
    if (/cancel/i.test(message)) return { status: "cancelled" };
    if (/pending|deferred/i.test(message)) return { status: "pending" };
    return { status: "failed", message: "The App Store couldn't complete the purchase. You weren't charged." };
  }

  const recorded = await recordWithServer(tx).catch(() => ({ ok: false as const, balance: undefined, message: undefined }));
  if (!recorded.ok) {
    // Left unfinished on purpose: StoreKit keeps it, and the next launch
    // records it (recoverUnfinishedPurchases), so nothing paid for is lost
    return {
      status: "failed",
      message: recorded.message || "Your payment went through, but the credits haven't arrived yet. They'll be added automatically the next time you open Grammie.",
    };
  }
  await NativePurchases.finishTransaction({ transactionId: tx.transactionId }).catch(() => {});
  return { status: "purchased", balance: recorded.balance };
}

let recovering = false;

/** Records and finishes any credits purchase that was paid for but not finished */
export async function recoverUnfinishedPurchases(): Promise<number> {
  if (!isNativeApp() || recovering) return 0;
  recovering = true;
  try {
    const { NativePurchases } = await plugin();
    const { transactions } = await NativePurchases.getUnfinishedTransactions();
    let finished = 0;
    for (const tx of transactions) {
      if (!tx.productIdentifier.startsWith(APPLE_PRODUCT_PREFIX)) continue;
      const recorded = await recordWithServer(tx).catch(() => ({ ok: false }));
      if (recorded.ok) {
        await NativePurchases.finishTransaction({ transactionId: tx.transactionId }).catch(() => {});
        finished += 1;
      }
    }
    return finished;
  } finally {
    recovering = false;
  }
}
