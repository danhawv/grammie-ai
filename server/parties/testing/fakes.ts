// In-memory PartyStore for the route tests, with just enough of the users,
// recipes, cookbooks and shares tables to check access and syncing.

import { randomUUID } from "node:crypto";
import type {
  PartyDishRow, PartyGuestRow, PartyRow, PartySlotRow, PartyStore, PartyUser, RecipeFactsRow,
} from "../store";

export interface FakeRecipe {
  id: string;
  ownerUserId: string;
  isPublic: boolean;
  title: string;
  servings?: number;
  ingredients?: string[];
  allergens?: string[];
  diets?: string[];
  status?: string;
}

export class MemoryPartyStore implements PartyStore {
  parties = new Map<string, PartyRow>();
  slots = new Map<string, PartySlotRow>();
  guests = new Map<string, PartyGuestRow>();
  dishes = new Map<string, PartyDishRow>();
  users = new Map<string, PartyUser>();
  recipes = new Map<string, FakeRecipe>();
  /** cookbook id -> owner, recipe ids, members */
  cookbooks = new Map<number, { ownerUserId: string; name: string; isPublic: boolean; recipeIds: Set<string>; members: Set<string> }>();
  /** "recipeId:userId" */
  shares = new Set<string>();
  private nextCookbook = 1;
  private clock = 0;
  private tick() { return new Date(Date.UTC(2026, 9, 1) + this.clock++ * 1000); }

  addUser(id: string, firstName: string | null, opts: Partial<PartyUser> = {}) {
    this.users.set(id, { id, firstName, isGuest: false, defaultRecipeVisibility: "public", ...opts });
  }

  addRecipe(r: FakeRecipe) {
    this.recipes.set(r.id, r);
  }

  async createParty(party: Parameters<PartyStore["createParty"]>[0], slots: Parameters<PartyStore["createParty"]>[1], host: { name: string }, cookbook: { name: string; description: string }) {
    const cookbookId = this.nextCookbook++;
    this.cookbooks.set(cookbookId, { ownerUserId: party.ownerUserId, name: cookbook.name, isPublic: false, recipeIds: new Set(), members: new Set() });
    const now = this.tick();
    const row: PartyRow = { ...party, id: randomUUID(), cookbookId, status: "active", createdAt: now, updatedAt: now };
    this.parties.set(row.id, row);
    slots.forEach((s, i) => {
      const id = randomUUID();
      this.slots.set(id, { id, partyId: row.id, course: s.course, label: s.label, position: i });
    });
    await this.addGuest({
      partyId: row.id, userId: party.ownerUserId, name: host.name, rsvp: "yes", partySize: 1,
      allergies: [], diets: [], dietNote: null, isHost: true, guestTokenHash: null,
    });
    return { ...row };
  }

  async getParty(id: string) { const p = this.parties.get(id); return p ? { ...p } : null; }
  async getPartyByToken(token: string) {
    const p = Array.from(this.parties.values()).find((x) => x.inviteToken === token);
    return p ? { ...p } : null;
  }

  async listPartiesFor(userId: string) {
    const mine = Array.from(this.guests.values()).filter((g) => g.userId === userId);
    return mine
      .map((g) => this.parties.get(g.partyId)!)
      .filter((p) => p.status === "active")
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map((party) => ({
        party: { ...party },
        isHost: party.ownerUserId === userId,
        dishCount: Array.from(this.dishes.values()).filter((d) => d.partyId === party.id).length,
        guestCount: Array.from(this.guests.values()).filter((g) => g.partyId === party.id && g.rsvp !== "no").length,
      }));
  }

  async updateParty(id: string, update: Parameters<PartyStore["updateParty"]>[1]) {
    const p = this.parties.get(id);
    if (!p) return null;
    const next = { ...p, ...update, updatedAt: this.tick() };
    this.parties.set(id, next);
    return { ...next };
  }

  async listSlots(partyId: string) {
    return Array.from(this.slots.values()).filter((s) => s.partyId === partyId).sort((a, b) => a.position - b.position).map((s) => ({ ...s }));
  }

  async replaceSlots(partyId: string, slots: Parameters<PartyStore["replaceSlots"]>[1]) {
    const existing = await this.listSlots(partyId);
    const keep = new Set(slots.map((s) => s.id).filter((id) => id && existing.some((e) => e.id === id)));
    for (const e of existing) {
      if (keep.has(e.id)) continue;
      this.slots.delete(e.id);
      for (const d of Array.from(this.dishes.values())) if (d.slotId === e.id) d.slotId = null;
    }
    slots.forEach((s, i) => {
      if (s.id && keep.has(s.id)) {
        this.slots.set(s.id, { id: s.id, partyId, course: s.course, label: s.label, position: i });
        for (const d of Array.from(this.dishes.values())) if (d.slotId === s.id) d.course = s.course;
      } else {
        const id = randomUUID();
        this.slots.set(id, { id, partyId, course: s.course, label: s.label, position: i });
      }
    });
    return this.listSlots(partyId);
  }

  async listGuests(partyId: string) {
    return Array.from(this.guests.values()).filter((g) => g.partyId === partyId).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()).map((g) => ({ ...g }));
  }
  async findGuestByUser(partyId: string, userId: string) {
    const g = Array.from(this.guests.values()).find((x) => x.partyId === partyId && x.userId === userId);
    return g ? { ...g } : null;
  }
  async findGuestByTokenHash(hash: string) {
    const g = Array.from(this.guests.values()).find((x) => x.guestTokenHash === hash);
    return g ? { ...g } : null;
  }
  async addGuest(guest: Parameters<PartyStore["addGuest"]>[0]) {
    if (Array.from(this.guests.values()).some((g) => g.partyId === guest.partyId && g.userId === guest.userId)) {
      throw Object.assign(new Error("duplicate key value violates unique constraint"), { code: "23505" });
    }
    const now = this.tick();
    const row: PartyGuestRow = { ...guest, id: randomUUID(), createdAt: now, updatedAt: now };
    this.guests.set(row.id, row);
    return { ...row };
  }
  async updateGuest(id: string, update: Parameters<PartyStore["updateGuest"]>[1]) {
    const g = this.guests.get(id);
    if (!g) return null;
    Object.assign(g, update, { updatedAt: this.tick() });
    return { ...g };
  }
  async deleteGuest(id: string) {
    this.guests.delete(id);
    for (const d of Array.from(this.dishes.values())) if (d.guestId === id) this.dishes.delete(d.id);
  }

  async listDishes(partyId: string) {
    return Array.from(this.dishes.values()).filter((d) => d.partyId === partyId).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()).map((d) => ({ ...d }));
  }
  async getDish(id: string) { const d = this.dishes.get(id); return d ? { ...d } : null; }
  async addDish(dish: Parameters<PartyStore["addDish"]>[0]) {
    const now = this.tick();
    const row: PartyDishRow = { ...dish, id: randomUUID(), createdAt: now, updatedAt: now };
    this.dishes.set(row.id, row);
    return { ...row };
  }
  async updateDish(id: string, update: Parameters<PartyStore["updateDish"]>[1]) {
    const d = this.dishes.get(id);
    if (!d) return null;
    Object.assign(d, update, { updatedAt: this.tick() });
    return { ...d };
  }
  async deleteDish(id: string) { this.dishes.delete(id); }

  async getUsers(ids: string[]) {
    return ids.map((id) => this.users.get(id)).filter((u): u is PartyUser => !!u).map((u) => ({ ...u }));
  }
  async createGuestUser(name: string) {
    const id = `guest-${randomUUID().slice(0, 8)}`;
    this.users.set(id, { id, firstName: name, isGuest: true, defaultRecipeVisibility: "private" });
    return id;
  }

  async recipeFacts(ids: string[]): Promise<RecipeFactsRow[]> {
    return ids.map((id) => this.recipes.get(id)).filter((r): r is FakeRecipe => !!r).map((r) => ({
      id: r.id, title: r.title, description: null, image: `/media/${r.id}.jpg`, servings: r.servings ?? 4,
      allergens: r.allergens ?? [], diets: r.diets ?? [], ingredients: r.ingredients ?? [], status: r.status ?? "ready",
      ownerUserId: r.ownerUserId, isPublic: r.isPublic,
    }));
  }
  async recipeForGuests(id: string) {
    const r = this.recipes.get(id);
    return r ? { ...r, instructions: ["Mix", "Bake"] } : null;
  }

  async addToCookbook(cookbookId: number, recipeId: string) { this.cookbooks.get(cookbookId)?.recipeIds.add(recipeId); }
  async removeFromCookbook(cookbookId: number, recipeId: string) { this.cookbooks.get(cookbookId)?.recipeIds.delete(recipeId); }
  async shareRecipes(recipeIds: string[], userIds: string[]) {
    for (const id of recipeIds) {
      const r = this.recipes.get(id);
      if (!r || r.isPublic) continue;
      for (const u of userIds) if (u !== r.ownerUserId) this.shares.add(`${id}:${u}`);
    }
  }
  async addCookbookMember(cookbookId: number, userId: string) {
    const book = this.cookbooks.get(cookbookId);
    if (book && book.ownerUserId !== userId) book.members.add(userId);
  }

  async claimGuest(guestUserId: string, accountId: string) {
    for (const r of Array.from(this.recipes.values())) if (r.ownerUserId === guestUserId) r.ownerUserId = accountId;
    const places = Array.from(this.guests.values()).filter((g) => g.userId === guestUserId);
    for (const place of places) {
      const mine = Array.from(this.guests.values()).find((g) => g.partyId === place.partyId && g.userId === accountId);
      if (mine) {
        for (const d of Array.from(this.dishes.values())) if (d.guestId === place.id) d.guestId = mine.id;
        this.guests.delete(place.id);
      } else {
        place.userId = accountId;
        place.guestTokenHash = null;
      }
    }
    return Array.from(new Set(places.map((p) => p.partyId)));
  }
}
