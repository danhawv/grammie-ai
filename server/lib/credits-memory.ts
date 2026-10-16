import { randomUUID } from "crypto";
import type { BalanceState, CreditStore, CreditTx, LedgerEntry } from "./credits";

// An in-memory CreditStore for tests: transactions run one at a time (like
// the row lock) and roll back if they throw.

export class MemoryCreditStore implements CreditStore {
  entries: LedgerEntry[] = [];
  balances = new Map<string, BalanceState>();
  admins = new Set<string>();
  guests = new Set<string>();
  private queue: Promise<unknown> = Promise.resolve();
  private clock = 0;

  async transaction<T>(fn: (tx: CreditTx) => Promise<T>): Promise<T> {
    const run = async () => {
      const entries = [...this.entries];
      const balances = new Map(Array.from(this.balances, ([k, v]) => [k, { ...v }]));
      try {
        return await fn(this.tx());
      } catch (err) {
        this.entries = entries;
        this.balances = balances;
        throw err;
      }
    };
    const result = this.queue.then(run, run);
    this.queue = result.catch(() => {});
    return result;
  }

  private tx(): CreditTx {
    return {
      lock: async (userId) => {
        if (!this.balances.has(userId)) this.balances.set(userId, { balance: 0, monthlyFreeGrantedFor: null, appleAccountToken: null });
        return { ...this.balances.get(userId)! };
      },
      save: async (userId, state) => {
        this.balances.set(userId, { ...state });
      },
      insert: async (e) => {
        if (e.externalId && this.entries.some((x) => x.source === e.source && x.externalId === e.externalId)) return false;
        this.entries.push({ ...e, id: randomUUID(), createdAt: new Date(Date.UTC(2026, 0, 1) + this.clock++) });
        return true;
      },
      jobEntries: async (userId, jobRef) =>
        this.entries.filter((e) => e.userId === userId && e.jobRef === jobRef && (e.kind === "spend" || e.kind === "refund")),
    };
  }

  async isAdmin(userId: string) {
    return this.admins.has(userId);
  }
  async isGuest(userId: string) {
    return this.guests.has(userId);
  }
  async jobOwner(jobRef: string) {
    const spends = this.entries.filter((e) => e.jobRef === jobRef && e.kind === "spend");
    return spends.length ? spends[spends.length - 1].userId : null;
  }
  async findExternal(source: string, externalId: string) {
    return this.entries.find((e) => e.source === source && e.externalId === externalId) ?? null;
  }
  async history(userId: string, limit: number) {
    return this.entries.filter((e) => e.userId === userId).reverse().slice(0, limit);
  }
  async userForAppleToken(token: string) {
    for (const [userId, b] of Array.from(this.balances)) if (b.appleAccountToken === token) return userId;
    return null;
  }

  /** The balance must always equal the sum of the ledger */
  ledgerSum(userId: string): number {
    return this.entries.filter((e) => e.userId === userId).reduce((n, e) => n + e.delta, 0);
  }
}
