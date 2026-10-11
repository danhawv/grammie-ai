import { Router } from "express";
import { isAuthenticated } from "../clerkAuth";
import { getUserId } from "./route-utils";
import { storage } from "../storage";
import {
  CREDIT_COSTS, CREDIT_PACKS, MONTHLY_FREE_CREDITS, WELCOME_CREDITS, historyLabel, packById,
  type CreditsSummary,
} from "@shared/credits";
import { credits, type Credits } from "../lib/credits";
import { paymentsEnabled, stripe } from "../lib/print-orders";
import { createCreditCheckout, grantFromSession } from "../lib/credit-stripe";
import { AppleProblem, appleConfig, createAppleIap, createAppleVerifier, createPgAppleTxStore, type AppleIap } from "../lib/apple-iap";

// Credits API (shared/credits.ts has the shapes and prices):
//   GET  /api/credits                       balance, costs, packs, history
//   POST /api/credits/checkout {pack}       Stripe Checkout for a pack (web)
//   POST /api/credits/checkout/confirm      grants a paid checkout on return
//   POST /api/credits/apple/token           the account's appAccountToken
//   POST /api/credits/apple/transaction     a verified App Store purchase
//   POST /api/credits/apple/notifications   App Store Server Notifications V2
// The Stripe webhook is /api/stripe/webhook (routes/print.ts).

const router = Router();

function running(res: any): Credits | null {
  const c = credits();
  if (!c) res.status(503).json({ error: "Credits aren't available right now. Please try again later." });
  return c;
}

let appleIap: Promise<AppleIap | null> | null = null;
/** Apple purchases, set up on first use; null when not configured */
function apple(): Promise<AppleIap | null> {
  if (!appleIap) {
    const config = appleConfig();
    const c = credits();
    if (!config || !c) return Promise.resolve(null);
    appleIap = (async () => createAppleIap({
      verifier: await createAppleVerifier(config),
      credits: c,
      transactions: await createPgAppleTxStore(),
      bundleId: config.bundleId,
    }))().catch((err) => {
      console.error("[Credits] App Store purchases couldn't start:", err);
      appleIap = null;
      return null;
    });
  }
  return appleIap;
}

const siteOrigin = (req: any) => (process.env.PUBLIC_URL || `https://${req.get("host")}`).replace(/\/$/, "");

router.get("/credits", isAuthenticated, async (req: any, res) => {
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  const c = running(res);
  if (!c) return;
  try {
    const balance = await c.ensureFreeAllowance(userId);
    const [history, unlimited] = await Promise.all([c.history(userId, 20), c.isAdmin(userId)]);
    const body: CreditsSummary = {
      balance,
      enforced: c.enforced(),
      unlimited,
      packs: CREDIT_PACKS,
      costs: CREDIT_COSTS,
      welcomeCredits: WELCOME_CREDITS,
      monthlyFreeCredits: MONTHLY_FREE_CREDITS,
      purchase: { web: paymentsEnabled(), apple: !!appleConfig() },
      history: history.map((e) => ({
        id: e.id, delta: e.delta, kind: e.kind, source: e.source,
        label: historyLabel(e.kind, e.meta), createdAt: e.createdAt.toISOString(),
      })),
    };
    res.setHeader("Cache-Control", "no-store");
    res.json(body);
  } catch (err) {
    console.error("[Credits] Loading credits failed:", err);
    res.status(503).json({ error: "Your credits didn't load. Please try again in a minute." });
  }
});

router.post("/credits/checkout", isAuthenticated, async (req: any, res) => {
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  const pack = packById(req.body?.pack);
  if (!pack) return res.status(400).json({ error: "Choose one of the credit packs." });
  if (!paymentsEnabled()) return res.status(503).json({ error: "Buying credits isn't open yet. Please try again later." });
  const c = running(res);
  if (!c) return;
  try {
    await c.ensureFreeAllowance(userId); // the tables are there before anyone pays
    const user = await storage.getUser(userId);
    const session = await createCreditCheckout(stripe(), { userId, pack, origin: siteOrigin(req), email: user?.email });
    res.json({ url: session.url, sessionId: session.id });
  } catch (err) {
    console.error("[Credits] Checkout failed to start:", err);
    res.status(500).json({ error: "We couldn't open the payment page. Nothing was charged. Please try again." });
  }
});

// The /credits page calls this on return from Stripe, so credits show up
// even if the webhook is slow or not set up. Safe to repeat.
router.post("/credits/checkout/confirm", isAuthenticated, async (req: any, res) => {
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  const sessionId = typeof req.body?.sessionId === "string" ? req.body.sessionId : "";
  if (!/^cs_[A-Za-z0-9_]+$/.test(sessionId) || !paymentsEnabled()) return res.status(400).json({ error: "We couldn't find that payment." });
  const c = running(res);
  if (!c) return;
  try {
    const session = await stripe().checkout.sessions.retrieve(sessionId);
    if (session.metadata?.userId !== userId) return res.status(404).json({ error: "We couldn't find that payment." });
    if (session.payment_status !== "paid") return res.json({ status: "pending", balance: await c.balance(userId) });
    const result = await grantFromSession(c, session);
    res.json({ status: "paid", credits: Number(session.metadata?.credits) || null, balance: result?.balance ?? await c.balance(userId) });
  } catch (err) {
    console.error("[Credits] Confirming checkout failed:", err);
    res.status(500).json({ error: "We couldn't check that payment yet. If you were charged, your credits will appear shortly." });
  }
});

// ---- App Store --------------------------------------------------------------

router.post("/credits/apple/token", isAuthenticated, async (req: any, res) => {
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  if (!appleConfig()) return res.status(503).json({ error: "Buying credits in the app isn't open yet." });
  const c = running(res);
  if (!c) return;
  try {
    res.json({ appAccountToken: await c.appleAccountToken(userId) });
  } catch (err) {
    console.error("[Credits] App Store token failed:", err);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

router.post("/credits/apple/transaction", isAuthenticated, async (req: any, res) => {
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });
  const jws = typeof req.body?.jws === "string" ? req.body.jws.trim() : "";
  if (!jws) return res.status(400).json({ error: "The purchase details are missing." });
  const iap = await apple();
  if (!iap) return res.status(503).json({ error: "Buying credits in the app isn't open yet." });
  try {
    // finish: tell the app it can finish() the StoreKit transaction now
    res.json({ ...(await iap.recordTransaction(userId, jws)), finish: true });
  } catch (err) {
    if (err instanceof AppleProblem) return res.status(err.status).json({ error: err.message, finish: err.status === 409 });
    console.error("[Credits] App Store purchase failed to record:", err);
    res.status(500).json({ error: "We couldn't add those credits yet. Keep the app open and we'll try again.", finish: false });
  }
});

// Apple calls this (no sign-in); the signed payload is the proof
router.post("/credits/apple/notifications", async (req: any, res) => {
  const iap = await apple();
  if (!iap) return res.status(503).json({ error: "Not configured" });
  const payload = typeof req.body?.signedPayload === "string" ? req.body.signedPayload : "";
  if (!payload) return res.status(400).json({ error: "Missing signedPayload" });
  try {
    const result = await iap.handleNotification(payload);
    res.json({ received: true, ...result });
  } catch (err) {
    if (err instanceof AppleProblem) {
      console.warn("[Credits] App Store notification ignored:", err.message);
      return res.json({ received: true, handled: false });
    }
    // A notification that didn't verify, or a database problem: Apple retries
    console.error("[Credits] App Store notification failed:", err);
    res.status(500).json({ error: "Not handled" });
  }
});

export default router;
