import { randomUUID } from "crypto";
import {
  CREDIT_COSTS, MONTHLY_FREE_CREDITS, WELCOME_CREDITS, monthKey, needCreditsMessage,
  type CreditAction, type CreditKind, type CreditSource, type NeedCreditsError,
} from "@shared/credits";
import { GUEST_CREDITS } from "@shared/party";

// Pay-as-you-go credits. Every change to a balance is a row in credit_ledger,
// written in the same transaction as the running total in credit_balances,
// with the user's balance row locked so two requests can't both spend the
// last credit. Costs, packs and the free allowance live in shared/credits.ts.
//
//   balance / ensureFreeAllowance  the welcome gift once per account and the
//                                  monthly free credits, granted lazily on
//                                  the first balance check or spend in a month
//   canAfford                      the check before an AI action starts
//   spend(userId, action, jobRef)  charges once per jobRef (asking again is a
//                                  no-op until that job is refunded)
//   refund(jobRef)                 gives a failed job's credits back
//   grantPurchase / revokePurchase Stripe and App Store, once per payment
//
// The CREDITS_ENFORCED switch (default off): when off, everything is recorded
// and shown, but nothing is ever refused, and a spend the balance can't cover
// is recorded as waived (0) so balances never go below zero. Admin accounts
// are never charged.
//
// Guest users (anonymous party guests, users.is_guest) get GUEST_CREDITS as
// their welcome gift and no monthly credits, and their balance is always
// enforced, switch or no switch: nobody can run up AI costs without an account.
//
// Credits must never break an AI action because of a credits problem: until
// migrations/2026-10-credits.sql is applied, or if the database has a hiccup,
// checks and spends "fail open" (allowed, not charged) and log.

export function creditsEnforced(): boolean {
  return /^(1|true|on|yes)$/i.test(process.env.CREDITS_ENFORCED ?? "");
}

export interface LedgerEntry {
  id: string;
  userId: string;
  delta: number;
  kind: CreditKind;
  source: CreditSource;
  externalId: string | null;
  jobRef: string | null;
  meta: Record<string, unknown> | null;
  createdAt: Date;
}

export type NewLedgerEntry = Omit<LedgerEntry, "id" | "createdAt">;

export interface BalanceState {
  balance: number;
  monthlyFreeGrantedFor: string | null;
  appleAccountToken: string | null;
}

/** Work inside one transaction, with the user's balance row locked */
export interface CreditTx {
  /** The user's balance row, locked until the transaction ends; made at 0 if missing */
  lock(userId: string): Promise<BalanceState>;
  save(userId: string, state: BalanceState): Promise<void>;
  /** Adds a row; false (and nothing added) when (source, externalId) is already there */
  insert(entry: NewLedgerEntry): Promise<boolean>;
  /** This user's spend and refund rows for a job, oldest first */
  jobEntries(userId: string, jobRef: string): Promise<LedgerEntry[]>;
}

export interface CreditStore {
  transaction<T>(fn: (tx: CreditTx) => Promise<T>): Promise<T>;
  isAdmin(userId: string): Promise<boolean>;
  /** Anonymous party guest (users.is_guest); omitted = nobody is */
  isGuest?(userId: string): Promise<boolean>;
  /** Who was charged for a job (the most recent spend) */
  jobOwner(jobRef: string): Promise<string | null>;
  findExternal(source: CreditSource, externalId: string): Promise<LedgerEntry | null>;
  history(userId: string, limit: number): Promise<LedgerEntry[]>;
  userForAppleToken(token: string): Promise<string | null>;
}

export type SpendResult =
  | { ok: true; charged: number; balance: number | null; already?: boolean; unlimited?: boolean; skipped?: boolean }
  | { ok: false; reason: "insufficient"; balance: number; cost: number };

export interface AffordResult {
  ok: boolean;
  enforced: boolean;
  balance: number | null;
  cost: number;
  unlimited: boolean;
}

export interface CreditsOptions {
  enforced?: () => boolean;
  now?: () => Date;
  log?: Pick<Console, "warn" | "error">;
}

export function isMissingCreditTable(err: unknown): boolean {
  const e = err as { code?: string; message?: string; cause?: { code?: string; message?: string } } | null;
  const code = e?.code ?? e?.cause?.code;
  const msg = `${e?.message ?? ""} ${e?.cause?.message ?? ""}`;
  return code === "42P01" || code === "42703" || /(credit_ledger|credit_balances|apple_transactions).*does not exist/i.test(msg);
}

export function createCredits(store: CreditStore, options: CreditsOptions = {}) {
  const enforced = options.enforced ?? creditsEnforced;
  const now = options.now ?? (() => new Date());
  const log = options.log ?? console;

  // Missing tables: stay quiet and inert, look again in a few minutes
  let missingUntil = 0;
  const RECHECK_MS = 5 * 60 * 1000;
  /** Runs fn; on any failure logs and returns the fallback (credits never block an action by mistake) */
  async function failOpen<T>(label: string, fallback: T, fn: () => Promise<T>): Promise<T> {
    if (Date.now() < missingUntil) return fallback;
    try {
      return await fn();
    } catch (err) {
      if (isMissingCreditTable(err)) {
        if (missingUntil === 0) log.warn("[credits] Credit tables are missing; run migrations/2026-10-credits.sql. Credits are off until then.");
        missingUntil = Date.now() + RECHECK_MS;
      } else {
        log.error(`[credits] ${label} failed:`, err);
      }
      return fallback;
    }
  }

  const isGuest = (userId: string) => store.isGuest ? store.isGuest(userId) : Promise.resolve(false);

  /** The welcome gift (once ever) and this month's free credits (once a month), inside a locked transaction */
  async function grantAllowance(tx: CreditTx, userId: string, state: BalanceState): Promise<BalanceState> {
    const month = monthKey(now());
    if (state.monthlyFreeGrantedFor === month) return state;
    let balance = state.balance;
    const guest = await isGuest(userId);
    const welcome = guest ? GUEST_CREDITS : WELCOME_CREDITS;
    // Unique on (source, external_id), so this adds the gift exactly once per account
    if (await tx.insert({ userId, delta: welcome, kind: "welcome", source: "system", externalId: `welcome:${userId}`, jobRef: null, meta: guest ? { guest: true } : null })) {
      balance += welcome;
    }
    if (!guest && MONTHLY_FREE_CREDITS > 0 && await tx.insert({ userId, delta: MONTHLY_FREE_CREDITS, kind: "monthly_free", source: "system", externalId: `monthly:${userId}:${month}`, jobRef: null, meta: { month } })) {
      balance += MONTHLY_FREE_CREDITS;
    }
    const next = { ...state, balance, monthlyFreeGrantedFor: month };
    await tx.save(userId, next);
    return next;
  }

  async function lockWithAllowance(tx: CreditTx, userId: string) {
    return grantAllowance(tx, userId, await tx.lock(userId));
  }

  /** Grants anything due and returns the balance (throws on database trouble) */
  async function ensureFreeAllowance(userId: string): Promise<number> {
    return store.transaction(async (tx) => (await lockWithAllowance(tx, userId)).balance);
  }

  /** A spend counts until a refund row matches it */
  function activeSpend(entries: LedgerEntry[]): LedgerEntry | null {
    const spends = entries.filter((e) => e.kind === "spend");
    const refunds = entries.filter((e) => e.kind === "refund");
    return spends.length > refunds.length ? spends[spends.length - 1] : null;
  }

  async function spendNow(userId: string, action: CreditAction, jobRef: string, allowOverdraw: boolean): Promise<SpendResult> {
    if (await store.isAdmin(userId)) return { ok: true, charged: 0, balance: null, unlimited: true };
    const cost = CREDIT_COSTS[action];
    const isEnforced = enforced() || await isGuest(userId);
    return store.transaction(async (tx) => {
      const state = await lockWithAllowance(tx, userId);
      if (activeSpend(await tx.jobEntries(userId, jobRef))) {
        return { ok: true as const, charged: 0, balance: state.balance, already: true };
      }
      let charge = cost;
      let waived = false;
      if (state.balance < cost) {
        if (isEnforced && !allowOverdraw) {
          return { ok: false as const, reason: "insufficient" as const, balance: state.balance, cost };
        }
        if (!isEnforced) {
          // Tracking only: note what it would have cost, keep the balance at or above zero
          charge = 0;
          waived = true;
        }
      }
      await tx.insert({
        userId, delta: charge ? -charge : 0, kind: "spend", source: "system", externalId: null, jobRef,
        meta: { action, cost, ...(waived ? { waived: true } : {}), ...(allowOverdraw && state.balance < cost && !waived ? { overdrawn: true } : {}) },
      });
      const balance = state.balance - charge;
      await tx.save(userId, { ...state, balance });
      return { ok: true as const, charged: charge, balance };
    });
  }

  return {
    enforced,
    ensureFreeAllowance,

    /** Current balance with any free credits due; null when credits aren't available */
    async balance(userId: string): Promise<number | null> {
      return failOpen("balance", null, () => ensureFreeAllowance(userId));
    },

    /** Whether an action may start. Always ok when not enforced, for admins, or if credits are unavailable. */
    async canAfford(userId: string, action: CreditAction): Promise<AffordResult> {
      const cost = CREDIT_COSTS[action];
      const open: AffordResult = { ok: true, enforced: enforced(), balance: null, cost, unlimited: false };
      return failOpen("canAfford", open, async () => {
        if (await store.isAdmin(userId)) return { ...open, unlimited: true };
        const isEnforced = open.enforced || await isGuest(userId);
        const balance = await ensureFreeAllowance(userId);
        return { ok: !isEnforced || balance >= cost, enforced: isEnforced, balance, cost, unlimited: false };
      });
    },

    /**
     * Charges for an action once per jobRef. Refused (ok: false) only when
     * enforced and the balance is short; `allowOverdraw` charges anyway, for
     * work that was already checked and has been done (it may dip below zero
     * if two requests raced).
     */
    async spend(userId: string, action: CreditAction, jobRef: string, opts: { allowOverdraw?: boolean } = {}): Promise<SpendResult> {
      return failOpen("spend", { ok: true, charged: 0, balance: null, skipped: true } as SpendResult,
        () => spendNow(userId, action, jobRef, !!opts.allowOverdraw));
    },

    /** Gives a job's credits back (once per spend); false when there was nothing to give back */
    async refund(jobRef: string, reason = "failed"): Promise<boolean> {
      return failOpen("refund", false, async () => {
        const userId = await store.jobOwner(jobRef);
        if (!userId) return false;
        return store.transaction(async (tx) => {
          const state = await tx.lock(userId);
          const spend = activeSpend(await tx.jobEntries(userId, jobRef));
          if (!spend) return false;
          const amount = spend.delta ? -spend.delta : 0;
          await tx.insert({
            userId, delta: amount, kind: "refund", source: "system", externalId: null, jobRef,
            meta: { reason, action: spend.meta?.action ?? null },
          });
          await tx.save(userId, { ...state, balance: state.balance + amount });
          return true;
        });
      });
    },

    /** Adds bought credits once per payment. Throws on failure so the webhook is retried. */
    async grantPurchase(input: { userId: string; source: CreditSource; externalId: string; credits: number; meta?: Record<string, unknown> }) {
      return store.transaction(async (tx) => {
        const state = await lockWithAllowance(tx, input.userId);
        const added = await tx.insert({
          userId: input.userId, delta: input.credits, kind: "purchase", source: input.source,
          externalId: input.externalId, jobRef: null, meta: input.meta ?? null,
        });
        const balance = state.balance + (added ? input.credits : 0);
        if (added) await tx.save(input.userId, { ...state, balance });
        return { granted: added, balance };
      });
    },

    /** Takes back a refunded purchase's credits (once). The balance may go below zero if they were used. */
    async revokePurchase(input: { source: CreditSource; externalId: string; meta?: Record<string, unknown> }) {
      const purchase = await store.findExternal(input.source, input.externalId);
      if (!purchase || purchase.kind !== "purchase") return { revoked: false, balance: null as number | null };
      return store.transaction(async (tx) => {
        const state = await tx.lock(purchase.userId);
        const added = await tx.insert({
          userId: purchase.userId, delta: -purchase.delta, kind: "refund", source: input.source,
          externalId: `refund:${input.externalId}`, jobRef: null,
          meta: { reason: "purchase_refunded", pack: purchase.meta?.pack ?? null, ...(input.meta ?? {}) },
        });
        const balance = state.balance - (added ? purchase.delta : 0);
        if (added) await tx.save(purchase.userId, { ...state, balance });
        return { revoked: added, balance };
      });
    },

    /** The account's stable App Store appAccountToken (made on first ask) */
    async appleAccountToken(userId: string): Promise<string> {
      return store.transaction(async (tx) => {
        const state = await tx.lock(userId);
        if (state.appleAccountToken) return state.appleAccountToken;
        const token = randomUUID();
        await tx.save(userId, { ...state, appleAccountToken: token });
        return token;
      });
    },

    userForAppleToken: (token: string) => store.userForAppleToken(token),
    history: (userId: string, limit = 20) => store.history(userId, limit),
    isAdmin: (userId: string) => store.isAdmin(userId),
  };
}

export type Credits = ReturnType<typeof createCredits>;

/** The 402 answer for an action the balance can't cover */
export function needCreditsBody(action: CreditAction, balance: number | null): NeedCreditsError {
  return {
    error: needCreditsMessage(action, balance ?? 0),
    code: "needs_credits",
    balance: balance ?? 0,
    cost: CREDIT_COSTS[action],
    addCreditsUrl: "/credits",
  };
}

// ---- The app's instance -----------------------------------------------------
// Set at startup (server/lib/credits-pg.ts) so this file stays free of the
// database and can be tested with an in-memory store.

let instance: Credits | null = null;

export function setCredits(c: Credits | null) {
  instance = c;
}

/** The app's credits, or null before startup wiring (then every check is open) */
export function credits(): Credits | null {
  return instance;
}

/**
 * For routes: checks the balance before an AI action. Sends the 402 answer
 * and returns false when it can't go ahead; true otherwise (always true when
 * credits are off or unavailable).
 */
export async function gate(res: { status(code: number): { json(body: unknown): unknown } }, userId: string, action: CreditAction, count = 1): Promise<boolean> {
  const c = instance;
  if (!c) return true;
  const check = await c.canAfford(userId, action);
  if (!check.enforced || check.unlimited || check.balance === null || check.balance >= check.cost * count) return true;
  const body = needCreditsBody(action, check.balance);
  if (count > 1) {
    body.cost = check.cost * count;
    body.error = `Importing ${count} recipes uses ${count * check.cost} credits, and you have ${Math.max(0, check.balance ?? 0)}. Add credits, or leave some out and import the rest later.`;
  }
  res.status(402).json(body);
  return false;
}

/** Charges for work that has been checked with gate() and has now started; never refuses. Fire and forget is fine. */
export async function charge(userId: string, action: CreditAction, jobRef: string): Promise<void> {
  await instance?.spend(userId, action, jobRef, { allowOverdraw: true });
}

/** Gives a failed job's credits back; safe to call when nothing was charged */
export async function refundJob(jobRef: string, reason = "failed"): Promise<void> {
  await instance?.refund(jobRef, reason);
}

/** Job references, so the route that charges and the job that fails agree */
export const jobRefs = {
  recipeImport: (recipeId: string) => `recipe:${recipeId}:import`,
  photo: (recipeId: string, id: string = randomUUID()) => `recipe:${recipeId}:photo:${id}`,
  prepPlan: (planId: string) => `prep-plan:${planId}`,
};
