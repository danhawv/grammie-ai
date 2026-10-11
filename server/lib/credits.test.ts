import { describe, expect, it, vi, afterEach } from "vitest";
import type Stripe from "stripe";
import { CREDIT_COSTS, CREDIT_PACKS, MONTHLY_FREE_CREDITS, WELCOME_CREDITS } from "@shared/credits";
import { charge, createCredits, gate, jobRefs, refundJob, setCredits } from "./credits";
import { MemoryCreditStore } from "./credits-memory";
import { handleCreditStripeEvent } from "./credit-stripe";
import { createAppleIap, type AppleTransaction, type AppleTxRecord, type AppleTxStore, type AppleVerifier } from "./apple-iap";

const START = WELCOME_CREDITS + MONTHLY_FREE_CREDITS;
const quiet = { warn: () => {}, error: () => {} };

function setup(opts: { enforced?: boolean; date?: string } = {}) {
  const store = new MemoryCreditStore();
  let enforced = opts.enforced ?? false;
  let now = new Date(opts.date ?? "2026-10-11T12:00:00Z");
  const credits = createCredits(store, { enforced: () => enforced, now: () => now, log: quiet });
  return {
    store, credits,
    setEnforced: (v: boolean) => { enforced = v; },
    setNow: (iso: string) => { now = new Date(iso); },
  };
}

function fakeRes() {
  const out: { status?: number; body?: any } = {};
  return { out, res: { status(code: number) { out.status = code; return { json(body: unknown) { out.body = body; return body; } }; } } };
}

afterEach(() => setCredits(null));

describe("free allowance", () => {
  it("gives the welcome gift and this month's credits on the first check", async () => {
    const { credits, store } = setup();
    expect(await credits.balance("u1")).toBe(START);
    expect(await credits.balance("u1")).toBe(START);
    expect(store.entries.map((e) => e.kind)).toEqual(["welcome", "monthly_free"]);
    expect(store.ledgerSum("u1")).toBe(START);
  });

  it("adds the monthly credits once per month, never the welcome gift again, and doesn't make up missed months", async () => {
    const { credits, store, setNow } = setup({ date: "2026-10-31T23:59:00Z" });
    await credits.balance("u1");
    setNow("2026-11-01T00:01:00Z");
    expect(await credits.balance("u1")).toBe(START + MONTHLY_FREE_CREDITS);
    expect(await credits.balance("u1")).toBe(START + MONTHLY_FREE_CREDITS);
    setNow("2027-03-15T00:00:00Z"); // four months away: one month's credits
    expect(await credits.balance("u1")).toBe(START + 2 * MONTHLY_FREE_CREDITS);
    expect(store.entries.filter((e) => e.kind === "welcome")).toHaveLength(1);
    expect(store.ledgerSum("u1")).toBe(await credits.balance("u1"));
  });

  it("keeps accounts apart", async () => {
    const { credits } = setup();
    await credits.spend("u1", "recipe_import", "a");
    expect(await credits.balance("u2")).toBe(START);
  });
});

describe("spend and refund", () => {
  it("charges the configured cost and keeps the ledger and balance in step", async () => {
    const { credits, store } = setup({ enforced: true });
    const r = await credits.spend("u1", "meal_prep_plan", "prep-plan:1");
    expect(r).toMatchObject({ ok: true, charged: CREDIT_COSTS.meal_prep_plan, balance: START - CREDIT_COSTS.meal_prep_plan });
    expect(store.ledgerSum("u1")).toBe(store.balances.get("u1")!.balance);
  });

  it("charges once per job until it's refunded, then again on a retry", async () => {
    const { credits } = setup({ enforced: true });
    await credits.spend("u1", "recipe_import", "recipe:r1:import");
    const again = await credits.spend("u1", "recipe_import", "recipe:r1:import");
    expect(again).toMatchObject({ ok: true, charged: 0, already: true, balance: START - 1 });

    expect(await credits.refund("recipe:r1:import")).toBe(true);
    expect(await credits.refund("recipe:r1:import")).toBe(false); // only once
    expect(await credits.balance("u1")).toBe(START);

    const retry = await credits.spend("u1", "recipe_import", "recipe:r1:import");
    expect(retry).toMatchObject({ ok: true, charged: 1 });
    expect(await credits.balance("u1")).toBe(START - 1);
  });

  it("does nothing when refunding a job that was never charged", async () => {
    const { credits, store } = setup();
    expect(await credits.refund("recipe:nope:import")).toBe(false);
    expect(store.entries).toHaveLength(0);
  });

  it("never charges admins", async () => {
    const { credits, store } = setup({ enforced: true });
    store.admins.add("boss");
    expect(await credits.spend("boss", "meal_prep_plan", "p")).toMatchObject({ ok: true, charged: 0, unlimited: true });
    expect(store.entries.filter((e) => e.kind === "spend")).toHaveLength(0);
    expect((await credits.canAfford("boss", "meal_prep_plan")).ok).toBe(true);
  });

  it("two spends at once can't both use the last credit", async () => {
    const { credits, store } = setup({ enforced: true });
    await credits.balance("u1");
    store.balances.get("u1")!.balance = 1;
    store.entries.push({ id: "x", userId: "u1", delta: 1 - START, kind: "adjust", source: "system", externalId: null, jobRef: null, meta: null, createdAt: new Date() });
    const [a, b] = await Promise.all([credits.spend("u1", "recipe_import", "a"), credits.spend("u1", "recipe_import", "b")]);
    expect([a.ok, b.ok].sort()).toEqual([false, true]);
    expect(await credits.balance("u1")).toBe(0);
  });
});

describe("the CREDITS_ENFORCED switch", () => {
  async function drain(c: ReturnType<typeof setup>) {
    for (let i = 0; i < START; i++) await c.credits.spend("u1", "recipe_import", `job-${i}`);
    expect(await c.credits.balance("u1")).toBe(0);
  }

  it("off: records but never refuses, and the balance stays at zero", async () => {
    const c = setup({ enforced: false });
    await drain(c);
    const r = await c.credits.spend("u1", "meal_prep_plan", "p1");
    expect(r).toMatchObject({ ok: true, charged: 0 });
    const last = c.store.entries[c.store.entries.length - 1];
    expect(last).toMatchObject({ kind: "spend", delta: 0, meta: { action: "meal_prep_plan", cost: 2, waived: true } });
    expect(await c.credits.balance("u1")).toBe(0);
    expect((await c.credits.canAfford("u1", "meal_prep_plan")).ok).toBe(true);

    setCredits(c.credits);
    const { res, out } = fakeRes();
    expect(await gate(res, "u1", "recipe_import")).toBe(true);
    expect(out.status).toBeUndefined();
  });

  it("on: refuses with a friendly 402 and a way to add credits", async () => {
    const c = setup({ enforced: true });
    await drain(c);
    expect(await c.credits.spend("u1", "recipe_import", "late")).toEqual({ ok: false, reason: "insufficient", balance: 0, cost: 1 });
    setCredits(c.credits);
    const { res, out } = fakeRes();
    expect(await gate(res, "u1", "recipe_import")).toBe(false);
    expect(out.status).toBe(402);
    expect(out.body).toMatchObject({ code: "needs_credits", cost: 1, balance: 0, addCreditsUrl: "/credits" });
    expect(out.body.error).toMatch(/Add credits/);
  });

  it("on: a bulk import checks the whole count up front", async () => {
    const c = setup({ enforced: true });
    setCredits(c.credits);
    const { res, out } = fakeRes();
    expect(await gate(res, "u1", "recipe_import", START + 1)).toBe(false);
    expect(out.body.cost).toBe(START + 1);
    expect(await gate(fakeRes().res, "u1", "recipe_import", START)).toBe(true);
  });

  it("on: work that already passed the check is charged even if a race emptied the balance", async () => {
    const c = setup({ enforced: true });
    await drain(c);
    setCredits(c.credits);
    await charge("u1", "recipe_import", jobRefs.recipeImport("r9"));
    expect(await c.credits.balance("u1")).toBe(-1);
    await refundJob(jobRefs.recipeImport("r9"));
    expect(await c.credits.balance("u1")).toBe(0);
  });

  it("fails open when the credit tables aren't there yet", async () => {
    const store = new MemoryCreditStore();
    const missing = Object.assign(new Error('relation "credit_balances" does not exist'), { code: "42P01" });
    store.transaction = async () => { throw missing; };
    const credits = createCredits(store, { enforced: () => true, log: quiet });
    expect(await credits.spend("u1", "recipe_import", "j")).toMatchObject({ ok: true, charged: 0, skipped: true });
    expect((await credits.canAfford("u1", "recipe_import")).ok).toBe(true);
    expect(await credits.balance("u1")).toBeNull();
    setCredits(null);
    expect(await gate(fakeRes().res, "u1", "recipe_import")).toBe(true); // not started at all
  });
});

describe("Stripe", () => {
  const pack = CREDIT_PACKS[1]; // Family, 90
  const completed = (over: Partial<Stripe.Checkout.Session> = {}) => ({
    id: "evt_1", type: "checkout.session.completed",
    data: { object: { id: "cs_test_1", payment_status: "paid", payment_intent: "pi_1", amount_total: pack.priceCents, metadata: { kind: "credits", userId: "u1", pack: pack.id, credits: String(pack.credits) }, ...over } },
  }) as unknown as Stripe.Event;

  it("grants a paid credit checkout once, however many times the webhook comes", async () => {
    const { credits, store } = setup();
    expect(await handleCreditStripeEvent(credits, completed())).toBe("handled");
    expect(await handleCreditStripeEvent(credits, completed())).toBe("handled");
    expect(await credits.balance("u1")).toBe(START + pack.credits);
    expect(store.entries.filter((e) => e.kind === "purchase")).toEqual([expect.objectContaining({ source: "stripe", externalId: "pi_1", delta: 90 })]);
  });

  it("leaves book orders to the print code", async () => {
    const { credits, store } = setup();
    const bookOrder = completed({ metadata: { orderId: "order-1" } });
    expect(await handleCreditStripeEvent(credits, bookOrder)).toBe("ignored");
    const bookRefund = { type: "charge.refunded", data: { object: { id: "ch_9", payment_intent: "pi_book", refunded: true, amount: 2000, amount_refunded: 2000, metadata: {} } } } as unknown as Stripe.Event;
    expect(await handleCreditStripeEvent(credits, bookRefund)).toBe("ignored");
    expect(store.entries).toHaveLength(0);
  });

  it("doesn't grant an unpaid checkout", async () => {
    const { credits, store } = setup();
    await handleCreditStripeEvent(credits, completed({ payment_status: "unpaid" }));
    expect(store.entries.filter((e) => e.kind === "purchase")).toHaveLength(0);
  });

  it("takes the credits back once on a full refund", async () => {
    const { credits } = setup();
    await handleCreditStripeEvent(credits, completed());
    const refund = { type: "charge.refunded", data: { object: { id: "ch_1", payment_intent: "pi_1", refunded: true, amount: 999, amount_refunded: 999, metadata: { kind: "credits" } } } } as unknown as Stripe.Event;
    expect(await handleCreditStripeEvent(credits, refund)).toBe("handled");
    expect(await handleCreditStripeEvent(credits, refund)).toBe("handled");
    expect(await credits.balance("u1")).toBe(START);
    const h = await credits.history("u1");
    expect(h[0]).toMatchObject({ kind: "refund", delta: -90, source: "stripe", externalId: "refund:pi_1" });
  });

  it("throws (so Stripe retries) when credits aren't running", async () => {
    await expect(handleCreditStripeEvent(null, completed())).rejects.toThrow();
  });
});

describe("App Store", () => {
  class MemoryAppleTx implements AppleTxStore {
    rows = new Map<string, AppleTxRecord>();
    async get(id: string) { return this.rows.get(id) ?? null; }
    async insert(r: AppleTxRecord) { if (!this.rows.has(r.transactionId)) this.rows.set(r.transactionId, r); }
    async setRevoked(id: string, at: Date | null) { const r = this.rows.get(id); if (r) r.revocationDate = at; }
  }

  // A stand-in for Apple's verifier: "good:<json>" verifies, anything else fails
  const verifier: AppleVerifier = {
    async verifyTransaction(jws) {
      if (!jws.startsWith("good:")) throw new Error("VerificationException");
      return JSON.parse(jws.slice(5)) as AppleTransaction;
    },
    async verifyNotification(payload) {
      if (!payload.startsWith("good:")) throw new Error("VerificationException");
      return JSON.parse(payload.slice(5));
    },
  };
  const jws = (t: Partial<AppleTransaction>) => "good:" + JSON.stringify({
    transactionId: "1000", productId: "ai.grammie.app.credits.starter", bundleId: "ai.grammie.app", quantity: 1, environment: "Sandbox", type: "Consumable", ...t,
  });

  function apple() {
    const c = setup();
    const txs = new MemoryAppleTx();
    const iap = createAppleIap({ verifier, credits: c.credits, transactions: txs, bundleId: "ai.grammie.app" });
    return { ...c, txs, iap };
  }

  it("verifies, records and grants a purchase once", async () => {
    const { iap, credits, txs } = apple();
    const first = await iap.recordTransaction("u1", jws({}));
    expect(first).toMatchObject({ granted: true, credits: 40, balance: START + 40 });
    const again = await iap.recordTransaction("u1", jws({}));
    expect(again).toMatchObject({ granted: false, balance: START + 40 });
    expect(await credits.balance("u1")).toBe(START + 40);
    expect(txs.rows.get("1000")).toMatchObject({ userId: "u1", credits: 40, productId: "ai.grammie.app.credits.starter" });
  });

  it("rejects what doesn't verify, other apps, unknown products and other accounts' purchases", async () => {
    const { iap, credits } = apple();
    await expect(iap.recordTransaction("u1", "forged")).rejects.toThrow(/couldn't confirm/);
    await expect(iap.recordTransaction("u1", jws({ bundleId: "com.other" }))).rejects.toThrow(/another app/);
    await expect(iap.recordTransaction("u1", jws({ productId: "ai.grammie.app.credits.gold" }))).rejects.toThrow(/recognize/);
    const token = await credits.appleAccountToken("u2");
    expect(await credits.appleAccountToken("u2")).toBe(token); // stable
    await expect(iap.recordTransaction("u1", jws({ transactionId: "2000", appAccountToken: token }))).rejects.toThrow(/another account/);
    await iap.recordTransaction("u2", jws({ transactionId: "2000", appAccountToken: token }));
    await expect(iap.recordTransaction("u1", jws({ transactionId: "2000" }))).rejects.toThrow(/another account/);
  });

  it("takes credits back on a REFUND notification and gives them again on REFUND_REVERSED", async () => {
    const { iap, credits } = apple();
    await iap.recordTransaction("u1", jws({ productId: "ai.grammie.app.credits.cookbook" }));
    const note = (type: string) => "good:" + JSON.stringify({ notificationType: type, data: { signedTransactionInfo: jws({ productId: "ai.grammie.app.credits.cookbook", revocationDate: 1 }) } });
    await iap.handleNotification(note("REFUND"));
    await iap.handleNotification(note("REFUND"));
    expect(await credits.balance("u1")).toBe(START);
    await iap.handleNotification(note("REFUND_REVERSED"));
    expect(await credits.balance("u1")).toBe(START + 200);
  });

  it("grants a ONE_TIME_CHARGE the app never reported, found by its account token", async () => {
    const { iap, credits } = apple();
    const token = await credits.appleAccountToken("u3");
    const note = "good:" + JSON.stringify({ notificationType: "ONE_TIME_CHARGE", data: { signedTransactionInfo: jws({ transactionId: "3000", appAccountToken: token }) } });
    expect(await iap.handleNotification(note)).toMatchObject({ handled: true });
    await iap.recordTransaction("u3", jws({ transactionId: "3000", appAccountToken: token })); // the app reports it late
    expect(await credits.balance("u3")).toBe(START + 40);
  });

  it("only logs a CONSUMPTION_REQUEST", async () => {
    const { iap, store } = apple();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const note = "good:" + JSON.stringify({ notificationType: "CONSUMPTION_REQUEST", data: { signedTransactionInfo: jws({}) } });
    expect(await iap.handleNotification(note)).toMatchObject({ handled: false });
    expect(store.entries).toHaveLength(0);
    log.mockRestore();
  });
});
