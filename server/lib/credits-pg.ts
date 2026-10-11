import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db";
import { creditBalances, creditLedger, users, type CreditLedgerRow } from "@shared/schema";
import { createCredits, setCredits, type CreditStore, type CreditTx, type LedgerEntry } from "./credits";

// Postgres storage for credits (tables in migrations/2026-10-credits.sql).
// The logic is in credits.ts; this is only the SQL.

const toEntry = (r: CreditLedgerRow): LedgerEntry => ({
  id: r.id, userId: r.userId, delta: r.delta, kind: r.kind, source: r.source,
  externalId: r.externalId, jobRef: r.jobRef, meta: r.meta ?? null, createdAt: r.createdAt,
});

type Db = typeof db;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

function txOps(tx: Tx): CreditTx {
  return {
    async lock(userId) {
      await tx.insert(creditBalances).values({ userId, balance: 0 }).onConflictDoNothing();
      const [row] = await tx.select().from(creditBalances).where(eq(creditBalances.userId, userId)).for("update");
      return { balance: row.balance, monthlyFreeGrantedFor: row.monthlyFreeGrantedFor, appleAccountToken: row.appleAccountToken };
    },
    async save(userId, state) {
      await tx.update(creditBalances).set({
        balance: state.balance,
        monthlyFreeGrantedFor: state.monthlyFreeGrantedFor,
        appleAccountToken: state.appleAccountToken,
        updatedAt: new Date(),
      }).where(eq(creditBalances.userId, userId));
    },
    async insert(entry) {
      // ON CONFLICT on the partial unique index (source, external_id): a
      // repeat payment or grant adds nothing and doesn't abort the transaction
      const rows = await tx.insert(creditLedger).values(entry)
        .onConflictDoNothing({ target: [creditLedger.source, creditLedger.externalId], where: sql`external_id IS NOT NULL` })
        .returning({ id: creditLedger.id });
      return rows.length > 0;
    },
    async jobEntries(userId, jobRef) {
      const rows = await tx.select().from(creditLedger)
        .where(and(eq(creditLedger.userId, userId), eq(creditLedger.jobRef, jobRef), inArray(creditLedger.kind, ["spend", "refund"])))
        .orderBy(creditLedger.createdAt);
      return rows.map(toEntry);
    },
  };
}

export function createPgCreditStore(database: Db = db): CreditStore {
  return {
    transaction: (fn) => database.transaction((tx) => fn(txOps(tx))),
    async isAdmin(userId) {
      const [u] = await database.select({ isAdmin: users.isAdmin }).from(users).where(eq(users.id, userId));
      return !!u?.isAdmin;
    },
    async jobOwner(jobRef) {
      const [row] = await database.select({ userId: creditLedger.userId }).from(creditLedger)
        .where(and(eq(creditLedger.jobRef, jobRef), eq(creditLedger.kind, "spend")))
        .orderBy(desc(creditLedger.createdAt)).limit(1);
      return row?.userId ?? null;
    },
    async findExternal(source, externalId) {
      const [row] = await database.select().from(creditLedger)
        .where(and(eq(creditLedger.source, source), eq(creditLedger.externalId, externalId)));
      return row ? toEntry(row) : null;
    },
    async history(userId, limit) {
      const rows = await database.select().from(creditLedger)
        .where(eq(creditLedger.userId, userId))
        .orderBy(desc(creditLedger.createdAt)).limit(limit);
      return rows.map(toEntry);
    },
    async userForAppleToken(token) {
      const [row] = await database.select({ userId: creditBalances.userId }).from(creditBalances)
        .where(eq(creditBalances.appleAccountToken, token));
      return row?.userId ?? null;
    },
  };
}

/** Called once at startup (server/routes.ts) */
export function startCredits() {
  setCredits(createCredits(createPgCreditStore()));
}
