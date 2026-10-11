import fs from "fs";
import path from "path";
import { eq } from "drizzle-orm";
import { packByAppleProduct } from "@shared/credits";
import type { Credits } from "./credits";

// Credit packs bought in the iPhone/iPad app: App Store consumables
// (ai.grammie.app.credits.<pack>), StoreKit 2. The app sends the signed
// transaction (JWS) here; we verify it with Apple's own library
// (@apple/app-store-server-library), record it in apple_transactions and
// grant the pack once per transactionId. App Store Server Notifications V2
// (REFUND, REFUND_REVERSED, ONE_TIME_CHARGE, CONSUMPTION_REQUEST) arrive at
// /api/credits/apple/notifications.
//
// Everything here is off until it's configured (APPLE_IAP_ENVIRONMENT and
// Apple's root certificates): the endpoints answer 503.
//
// Purchases are tied to accounts with appAccountToken: a stable UUID per
// account (POST /api/credits/apple/token) that the app passes to
// Product.purchase(options: [.appAccountToken(uuid)]).

export const DEFAULT_BUNDLE_ID = "ai.grammie.app";

export interface AppleConfig {
  bundleId: string;
  /** "Production" or "Sandbox" */
  environment: "Production" | "Sandbox";
  /** The app's Apple ID (number in App Store Connect); needed for Production */
  appAppleId?: number;
  /** Apple's root certificates, DER */
  rootCerts: Buffer[];
  /** In Production, also accept Sandbox purchases (TestFlight and App Review buy in the sandbox) */
  allowSandbox: boolean;
}

/** Reads APPLE_IAP_* settings; null (off) unless the environment and root certificates are there */
export function appleConfig(env: NodeJS.ProcessEnv = process.env): AppleConfig | null {
  const environment = env.APPLE_IAP_ENVIRONMENT === "Production" ? "Production" : env.APPLE_IAP_ENVIRONMENT === "Sandbox" ? "Sandbox" : null;
  if (!environment) return null;
  const rootCerts: Buffer[] = [];
  for (const b64 of (env.APPLE_IAP_ROOT_CERTS ?? "").split(",").map((s) => s.trim()).filter(Boolean)) {
    rootCerts.push(Buffer.from(b64, "base64"));
  }
  const dir = env.APPLE_IAP_ROOT_CERTS_DIR;
  if (dir && fs.existsSync(dir)) {
    for (const f of fs.readdirSync(dir).filter((f) => /\.(cer|der)$/i.test(f))) rootCerts.push(fs.readFileSync(path.join(dir, f)));
  }
  if (rootCerts.length === 0) return null;
  const appAppleId = Number(env.APPLE_IAP_APP_APPLE_ID) || undefined;
  if (environment === "Production" && !appAppleId) return null;
  return {
    bundleId: env.APPLE_IAP_BUNDLE_ID || DEFAULT_BUNDLE_ID,
    environment,
    appAppleId,
    rootCerts,
    allowSandbox: env.APPLE_IAP_ALLOW_SANDBOX !== "false",
  };
}

/** The parts of a verified transaction we use (JWSTransactionDecodedPayload) */
export interface AppleTransaction {
  transactionId?: string;
  originalTransactionId?: string;
  bundleId?: string;
  productId?: string;
  purchaseDate?: number;
  quantity?: number;
  type?: string;
  appAccountToken?: string;
  revocationDate?: number;
  revocationReason?: number;
  environment?: string;
  [key: string]: unknown;
}

/** The parts of a verified notification we use (ResponseBodyV2DecodedPayload) */
export interface AppleNotification {
  notificationType?: string;
  subtype?: string;
  notificationUUID?: string;
  data?: { signedTransactionInfo?: string; environment?: string; bundleId?: string; consumptionRequestReason?: string };
}

export interface AppleVerifier {
  verifyTransaction(jws: string): Promise<AppleTransaction>;
  verifyNotification(signedPayload: string): Promise<AppleNotification>;
}

// The library is loaded only when Apple purchases are configured
const APPLE_LIBRARY = "@apple/app-store-server-library";

/** Apple's verifier: checks the certificate chain to Apple's root, the bundle id and the environment */
export async function createAppleVerifier(config: AppleConfig): Promise<AppleVerifier> {
  const lib: any = await import(/* @vite-ignore */ APPLE_LIBRARY);
  const make = (env: string) => new lib.SignedDataVerifier(
    config.rootCerts, true, env === "Production" ? lib.Environment.PRODUCTION : lib.Environment.SANDBOX,
    config.bundleId, env === "Production" ? config.appAppleId : undefined,
  );
  const verifiers = [make(config.environment)];
  if (config.environment === "Production" && config.allowSandbox) verifiers.push(make("Sandbox"));
  // A sandbox purchase fails the production check with "invalid environment"; try the next one
  async function first<T>(fn: (v: any) => Promise<T>): Promise<T> {
    let lastErr: unknown;
    for (const v of verifiers) {
      try {
        return await fn(v);
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr;
  }
  return {
    verifyTransaction: (jws) => first((v) => v.verifyAndDecodeTransaction(jws)),
    verifyNotification: (payload) => first((v) => v.verifyAndDecodeNotification(payload)),
  };
}

// ---- Storage of verified transactions -----------------------------------------

export interface AppleTxRecord {
  transactionId: string;
  originalTransactionId: string | null;
  userId: string;
  productId: string;
  environment: string;
  appAccountToken: string | null;
  quantity: number;
  credits: number;
  purchaseDate: Date | null;
  revocationDate: Date | null;
  payload: unknown;
}

export interface AppleTxStore {
  get(transactionId: string): Promise<AppleTxRecord | null>;
  /** Adds the row unless the transaction is already there */
  insert(rec: AppleTxRecord): Promise<void>;
  setRevoked(transactionId: string, at: Date | null): Promise<void>;
}

export async function createPgAppleTxStore(): Promise<AppleTxStore> {
  const { db } = await import("../db");
  const { appleTransactions } = await import("@shared/schema");
  return {
    async get(id) {
      const [row] = await db.select().from(appleTransactions).where(eq(appleTransactions.transactionId, id));
      return row ? { ...row, appAccountToken: row.appAccountToken ?? null } : null;
    },
    async insert(rec) {
      await db.insert(appleTransactions).values(rec).onConflictDoNothing();
    },
    async setRevoked(id, at) {
      await db.update(appleTransactions).set({ revocationDate: at, updatedAt: new Date() }).where(eq(appleTransactions.transactionId, id));
    },
  };
}

// ---- What the endpoints do ----------------------------------------------------

export class AppleProblem extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

export interface AppleIapDeps {
  verifier: AppleVerifier;
  credits: Credits;
  transactions: AppleTxStore;
  bundleId: string;
}

const toDate = (ms: unknown) => (typeof ms === "number" && ms > 0 ? new Date(ms) : null);

export function createAppleIap(deps: AppleIapDeps) {
  const { verifier, credits, transactions } = deps;

  /** Records a verified transaction for a user and grants its credits (once). */
  async function apply(userId: string, tx: AppleTransaction) {
    const transactionId = tx.transactionId;
    if (!transactionId) throw new AppleProblem("That purchase is missing its id.");
    if (tx.bundleId && tx.bundleId !== deps.bundleId) throw new AppleProblem("That purchase is for another app.");
    const pack = packByAppleProduct(tx.productId);
    if (!pack) throw new AppleProblem("We don't recognize that purchase.");
    const quantity = Math.max(1, Number(tx.quantity) || 1);
    const amount = pack.credits * quantity;

    const existing = await transactions.get(transactionId);
    if (existing && existing.userId !== userId) throw new AppleProblem("That purchase belongs to another account.", 409);
    if (!existing) {
      await transactions.insert({
        transactionId,
        originalTransactionId: tx.originalTransactionId ?? null,
        userId,
        productId: pack.appleProductId,
        environment: String(tx.environment ?? ""),
        appAccountToken: tx.appAccountToken ?? null,
        quantity,
        credits: amount,
        purchaseDate: toDate(tx.purchaseDate),
        revocationDate: toDate(tx.revocationDate),
        payload: tx,
      });
    }
    if (tx.revocationDate) {
      return { granted: false, revoked: true, credits: 0, balance: await credits.balance(userId), transactionId };
    }
    const result = await credits.grantPurchase({
      userId, source: "apple", externalId: transactionId, credits: amount,
      meta: { pack: pack.id, productId: pack.appleProductId, environment: tx.environment ?? null, quantity },
    });
    if (result.granted) console.log(`[Credits] ${amount} credits (${pack.id}) for user ${userId} from App Store ${transactionId}`);
    return { granted: result.granted, revoked: false, credits: amount, balance: result.balance, transactionId };
  }

  return {
    /** POST /api/credits/apple/transaction: the app finished a purchase */
    async recordTransaction(userId: string, jws: string) {
      let tx: AppleTransaction;
      try {
        tx = await verifier.verifyTransaction(jws);
      } catch (err) {
        console.warn("[Credits] App Store transaction didn't verify:", (err as Error)?.message ?? err);
        throw new AppleProblem("We couldn't confirm that purchase with the App Store.", 400);
      }
      // Purchases made with this account's token must come from this account
      if (tx.appAccountToken) {
        const owner = await credits.userForAppleToken(tx.appAccountToken);
        if (owner && owner !== userId) throw new AppleProblem("That purchase belongs to another account.", 409);
      }
      return apply(userId, tx);
    },

    /** POST /api/credits/apple/notifications: App Store Server Notifications V2 */
    async handleNotification(signedPayload: string) {
      const note = await verifier.verifyNotification(signedPayload);
      const type = note.notificationType;
      const signedTx = note.data?.signedTransactionInfo;
      const tx = signedTx ? await verifier.verifyTransaction(signedTx) : null;
      const id = tx?.transactionId;

      if (type === "REFUND" && id) {
        await transactions.setRevoked(id, toDate(tx?.revocationDate) ?? new Date()).catch(() => {});
        const r = await credits.revokePurchase({ source: "apple", externalId: id, meta: { reason: "purchase_refunded", revocationReason: tx?.revocationReason ?? null } });
        console.log(`[Credits] App Store refund ${id}: ${r.revoked ? `credits taken back (balance ${r.balance})` : "nothing to take back"}`);
        return { type, handled: true };
      }
      if (type === "REFUND_REVERSED" && id) {
        const original = await transactions.get(id);
        if (original) {
          await transactions.setRevoked(id, null).catch(() => {});
          await credits.grantPurchase({
            userId: original.userId, source: "apple", externalId: `refund-reversed:${id}`, credits: original.credits,
            meta: { pack: packByAppleProduct(original.productId)?.id ?? null, reason: "refund_reversed" },
          });
        }
        return { type, handled: !!original };
      }
      if (type === "ONE_TIME_CHARGE" && tx) {
        // A purchase the app may not have reported (closed mid-purchase): grant it by its account token
        const userId = tx.appAccountToken ? await credits.userForAppleToken(tx.appAccountToken) : null;
        if (!userId) {
          console.warn(`[Credits] App Store purchase ${id} has no account token we know; the app will report it`);
          return { type, handled: false };
        }
        await apply(userId, tx);
        return { type, handled: true };
      }
      if (type === "CONSUMPTION_REQUEST") {
        // Apple asks how much of a consumable was used before deciding a
        // refund. Answering needs the customer's consent and an App Store
        // Server API key, so for now we only log it; Apple decides without us.
        console.log(`[Credits] App Store consumption request for ${id ?? "unknown"} (${note.data?.consumptionRequestReason ?? "no reason given"})`);
        return { type, handled: false };
      }
      return { type, handled: false };
    },
  };
}

export type AppleIap = ReturnType<typeof createAppleIap>;
