// Storage for "add a recipe without an account" (shared/guest.ts): guest
// tokens (guest_sessions, migrations/2026-11-guest-add.sql) and the counts
// the limits need. Guest users themselves are made, read and claimed by the
// party store (server/parties/store.ts), so there's one kind of guest.
// The routes use this interface so tests can run on testing/fakes.ts.

import { and, count, eq, gte, sql } from "drizzle-orm";
import { guestSessions } from "@shared/schema";

export interface GuestStore {
  /** The guest user a token hash belongs to */
  userForToken(tokenHash: string): Promise<string | null>;
  addToken(row: { tokenHash: string; userId: string; ipHash: string | null }): Promise<void>;
  /** New guest tokens started from this address since then */
  tokensFromIpSince(ipHash: string, since: Date): Promise<number>;
  /**
   * Recipes the guest added themselves: everything they own except the
   * recipes of their party dishes (those count against the party's own
   * allowance, not this one)
   */
  addedRecipeCount(userId: string): Promise<number>;
  /** Ends every token of this guest user (after the claim) */
  forgetUser(userId: string): Promise<void>;
}

/** The table isn't there yet (migration not applied) */
export function isMissingTable(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } } | null;
  return e?.code === "42P01" || e?.cause?.code === "42P01";
}

export function createPgGuestStore(db: any): GuestStore {
  return {
    async userForToken(tokenHash) {
      const [row] = await db.select({ userId: guestSessions.userId }).from(guestSessions).where(eq(guestSessions.tokenHash, tokenHash));
      return row?.userId ?? null;
    },

    async addToken(row) {
      await db.insert(guestSessions).values(row);
    },

    async tokensFromIpSince(ipHash, since) {
      const [row] = await db.select({ n: count() }).from(guestSessions)
        .where(and(eq(guestSessions.ipHash, ipHash), gte(guestSessions.createdAt, since)));
      return Number(row?.n ?? 0);
    },

    async addedRecipeCount(userId) {
      const result = await db.execute(sql`
        SELECT count(*)::int AS n FROM recipes r
        WHERE r.owner_user_id = ${userId}
          AND NOT EXISTS (SELECT 1 FROM party_dishes d WHERE d.recipe_id = r.id)`);
      return Number((result.rows[0] as { n?: number } | undefined)?.n ?? 0);
    },

    async forgetUser(userId) {
      await db.delete(guestSessions).where(eq(guestSessions.userId, userId));
    },
  };
}
