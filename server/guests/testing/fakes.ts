// In-memory GuestStore for the route tests. Recipes and party dishes come
// from the party fake, which also makes and claims the guest users.

import type { MemoryPartyStore } from "../../parties/testing/fakes";
import type { GuestStore } from "../store";

export class MemoryGuestStore implements GuestStore {
  tokens = new Map<string, { userId: string; ipHash: string | null; createdAt: Date }>();
  /** Set to make every call fail like a database without the migration */
  missingTable = false;

  constructor(private parties: MemoryPartyStore, private now: () => Date = () => new Date()) {}

  private check() {
    if (this.missingTable) throw Object.assign(new Error('relation "guest_sessions" does not exist'), { code: "42P01" });
  }

  async userForToken(tokenHash: string) {
    this.check();
    return this.tokens.get(tokenHash)?.userId ?? null;
  }
  async addToken(row: { tokenHash: string; userId: string; ipHash: string | null }) {
    this.check();
    this.tokens.set(row.tokenHash, { userId: row.userId, ipHash: row.ipHash, createdAt: this.now() });
  }
  async tokensFromIpSince(ipHash: string, since: Date) {
    this.check();
    return Array.from(this.tokens.values()).filter((t) => t.ipHash === ipHash && t.createdAt >= since).length;
  }
  async addedRecipeCount(userId: string) {
    const onDishes = new Set(Array.from(this.parties.dishes.values()).map((d) => d.recipeId));
    return Array.from(this.parties.recipes.values()).filter((r) => r.ownerUserId === userId && !onDishes.has(r.id)).length;
  }
  async forgetUser(userId: string) {
    this.check();
    for (const [hash, t] of Array.from(this.tokens.entries())) if (t.userId === userId) this.tokens.delete(hash);
  }
}
