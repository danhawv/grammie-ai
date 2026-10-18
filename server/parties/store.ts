// Party storage (tables in migrations/2026-10-parties.sql). The routes use
// this interface so tests can run on the in-memory fake in testing/fakes.ts;
// the Postgres version is at the bottom.
//
// users.is_guest isn't in the Drizzle users table (see shared/schema.ts), so
// guest users are made and read here with plain SQL.

import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm";
import {
  cookbookCollaborators, cookbookRecipes, cookbooks, parties, partyDishes, partyGuests, partySlots,
  recipeImports, recipeShares, recipes,
  type PartyDishRow, type PartyGuestRow, type PartyRow, type PartySlotRow,
} from "@shared/schema";
import type { PartyCourse } from "@shared/party";

export type { PartyDishRow, PartyGuestRow, PartyRow, PartySlotRow };

export interface PartyUser {
  id: string;
  firstName: string | null;
  isGuest: boolean;
  defaultRecipeVisibility: "public" | "private" | null;
}

/** The recipe columns a dish needs (menu, labels, conflicts, access checks) */
export interface RecipeFactsRow {
  id: string;
  title: string;
  description: string | null;
  image: string | null;
  servings: number | null;
  allergens: string[];
  /** dietType plus the is* flags, as lower-case ids ("vegetarian", "gluten-free") */
  diets: string[];
  ingredients: string[];
  status: string | null;
  ownerUserId: string | null;
  isPublic: boolean;
}

export type NewParty = Pick<PartyRow, "ownerUserId" | "title" | "style" | "startsAt" | "location" | "theme" | "hostNote" | "headcount" | "externalInviteUrl" | "coverImage" | "inviteToken">;
export type PartyUpdate = Partial<Omit<PartyRow, "id" | "ownerUserId" | "createdAt" | "updatedAt">>;
export type SlotInput = { id?: string; course: PartyCourse; label: string | null };
export type NewGuest = Pick<PartyGuestRow, "partyId" | "userId" | "name" | "rsvp" | "partySize" | "allergies" | "diets" | "dietNote" | "isHost" | "guestTokenHash">;
export type GuestUpdate = Partial<Pick<PartyGuestRow, "name" | "rsvp" | "partySize" | "allergies" | "diets" | "dietNote">>;
export type NewDish = Pick<PartyDishRow, "partyId" | "guestId" | "slotId" | "course" | "recipeId" | "title" | "note">;
export type DishUpdate = Partial<Pick<PartyDishRow, "slotId" | "course" | "title" | "note">>;

export interface PartyStore {
  /** The party, its slots, the host's guest row and a private party cookbook, together */
  createParty(party: NewParty, slots: SlotInput[], host: { name: string }, cookbook: { name: string; description: string }): Promise<PartyRow>;
  getParty(id: string): Promise<PartyRow | null>;
  getPartyByToken(token: string): Promise<PartyRow | null>;
  /** Parties the user hosts or has joined, with counts */
  listPartiesFor(userId: string): Promise<Array<{ party: PartyRow; isHost: boolean; dishCount: number; guestCount: number }>>;
  updateParty(id: string, update: PartyUpdate): Promise<PartyRow | null>;

  listSlots(partyId: string): Promise<PartySlotRow[]>;
  /** Replaces the list in order; kept ids stay, dishes on removed slots keep their course */
  replaceSlots(partyId: string, slots: SlotInput[]): Promise<PartySlotRow[]>;

  listGuests(partyId: string): Promise<PartyGuestRow[]>;
  findGuestByUser(partyId: string, userId: string): Promise<PartyGuestRow | null>;
  findGuestByTokenHash(tokenHash: string): Promise<PartyGuestRow | null>;
  addGuest(guest: NewGuest): Promise<PartyGuestRow>;
  updateGuest(id: string, update: GuestUpdate): Promise<PartyGuestRow | null>;
  /** Removes the guest and their dishes */
  deleteGuest(id: string): Promise<void>;

  listDishes(partyId: string): Promise<PartyDishRow[]>;
  getDish(id: string): Promise<PartyDishRow | null>;
  addDish(dish: NewDish): Promise<PartyDishRow>;
  updateDish(id: string, update: DishUpdate): Promise<PartyDishRow | null>;
  deleteDish(id: string): Promise<void>;

  getUsers(ids: string[]): Promise<PartyUser[]>;
  /** A users row for an anonymous guest (is_guest, no email or sign-in) */
  createGuestUser(name: string): Promise<string>;

  recipeFacts(ids: string[]): Promise<RecipeFactsRow[]>;
  /** The recipe page's JSON, without the original card or print copies */
  recipeForGuests(id: string): Promise<Record<string, unknown> | null>;

  addToCookbook(cookbookId: number, recipeId: string): Promise<void>;
  removeFromCookbook(cookbookId: number, recipeId: string): Promise<void>;
  /** Viewer shares on the private ones among these recipes, for these users (never their owner) */
  shareRecipes(recipeIds: string[], userIds: string[]): Promise<void>;
  /** Puts the cookbook in the user's Cookbooks ("Shared with me"); no-op for its owner */
  addCookbookMember(cookbookId: number, userId: string, addedBy: string): Promise<void>;

  /**
   * Moves a guest user's recipes and party places to an account. Where the
   * account is already in the same party, the guest's dishes move to that
   * place and the guest's place is removed. Returns the parties touched.
   */
  claimGuest(guestUserId: string, accountId: string): Promise<string[]>;
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const DIET_FLAGS: Array<[keyof typeof recipes.$inferSelect, string]> = [
  ["isVegetarian", "vegetarian"],
  ["isVegan", "vegan"],
  ["isPescatarian", "pescatarian"],
  ["isGlutenFree", "gluten-free"],
  ["isDairyFree", "dairy-free"],
];

/** Lower-case diet ids from a recipe's dietType and is* flags */
export function recipeDiets(row: Partial<typeof recipes.$inferSelect>): string[] {
  const out = new Set<string>();
  for (const d of row.dietType ?? []) out.add(String(d).toLowerCase().trim().replace(/\s+/g, "-"));
  for (const [flag, id] of DIET_FLAGS) if (row[flag] === true) out.add(id);
  return Array.from(out);
}

// ---------------------------------------------------------------------------
// Postgres
// ---------------------------------------------------------------------------

type Db = typeof import("../db").db;

export function createPgPartyStore(db: Db): PartyStore {
  return {
    async createParty(party, slots, host, cookbook) {
      return db.transaction(async (tx) => {
        const [book] = await tx.insert(cookbooks).values({
          ownerUserId: party.ownerUserId,
          name: cookbook.name,
          description: cookbook.description,
          isPublic: false,
        }).returning();
        const [row] = await tx.insert(parties).values({ ...party, cookbookId: book.id }).returning();
        if (slots.length) {
          await tx.insert(partySlots).values(slots.map((s, i) => ({ partyId: row.id, course: s.course, label: s.label, position: i })));
        }
        await tx.insert(partyGuests).values({
          partyId: row.id, userId: party.ownerUserId, name: host.name, rsvp: "yes", partySize: 1,
          allergies: [], diets: [], dietNote: null, isHost: true, guestTokenHash: null,
        });
        return row;
      });
    },

    async getParty(id) {
      const [row] = await db.select().from(parties).where(eq(parties.id, id));
      return row ?? null;
    },

    async getPartyByToken(token) {
      const [row] = await db.select().from(parties).where(eq(parties.inviteToken, token));
      return row ?? null;
    },

    async listPartiesFor(userId) {
      const rows = await db.select({ party: parties, isHost: partyGuests.isHost }).from(partyGuests)
        .innerJoin(parties, eq(partyGuests.partyId, parties.id))
        .where(and(eq(partyGuests.userId, userId), eq(parties.status, "active")))
        .orderBy(desc(parties.createdAt))
        .limit(200);
      if (rows.length === 0) return [];
      const ids = rows.map((r) => r.party.id);
      const [dishCounts, guestCounts] = await Promise.all([
        db.select({ partyId: partyDishes.partyId, n: sql<number>`count(*)::int` }).from(partyDishes)
          .where(inArray(partyDishes.partyId, ids)).groupBy(partyDishes.partyId),
        db.select({ partyId: partyGuests.partyId, n: sql<number>`count(*)::int` }).from(partyGuests)
          .where(and(inArray(partyGuests.partyId, ids), ne(partyGuests.rsvp, "no"))).groupBy(partyGuests.partyId),
      ]);
      const dishes = new Map(dishCounts.map((r) => [r.partyId, Number(r.n)]));
      const guests = new Map(guestCounts.map((r) => [r.partyId, Number(r.n)]));
      return rows.map((r) => ({
        party: r.party,
        isHost: r.party.ownerUserId === userId || r.isHost,
        dishCount: dishes.get(r.party.id) ?? 0,
        guestCount: guests.get(r.party.id) ?? 0,
      }));
    },

    async updateParty(id, update) {
      const [row] = await db.update(parties).set({ ...update, updatedAt: new Date() }).where(eq(parties.id, id)).returning();
      return row ?? null;
    },

    async listSlots(partyId) {
      return db.select().from(partySlots).where(eq(partySlots.partyId, partyId)).orderBy(asc(partySlots.position));
    },

    async replaceSlots(partyId, slots) {
      return db.transaction(async (tx) => {
        const existing = await tx.select().from(partySlots).where(eq(partySlots.partyId, partyId));
        const known = new Set(existing.map((s) => s.id));
        const keep = new Set(slots.map((s) => s.id).filter((id): id is string => !!id && known.has(id)));
        const gone = existing.filter((s) => !keep.has(s.id)).map((s) => s.id);
        // Dishes keep their course; ON DELETE SET NULL clears slot_id
        if (gone.length) await tx.delete(partySlots).where(inArray(partySlots.id, gone));
        for (let i = 0; i < slots.length; i++) {
          const s = slots[i];
          if (s.id && keep.has(s.id)) {
            await tx.update(partySlots).set({ course: s.course, label: s.label, position: i }).where(eq(partySlots.id, s.id));
          } else {
            await tx.insert(partySlots).values({ partyId, course: s.course, label: s.label, position: i });
          }
        }
        // A kept slot whose course changed takes its dish along
        for (const s of slots) {
          if (s.id && keep.has(s.id)) {
            await tx.update(partyDishes).set({ course: s.course }).where(and(eq(partyDishes.slotId, s.id), ne(partyDishes.course, s.course)));
          }
        }
        return tx.select().from(partySlots).where(eq(partySlots.partyId, partyId)).orderBy(asc(partySlots.position));
      });
    },

    async listGuests(partyId) {
      return db.select().from(partyGuests).where(eq(partyGuests.partyId, partyId)).orderBy(asc(partyGuests.createdAt));
    },

    async findGuestByUser(partyId, userId) {
      const [row] = await db.select().from(partyGuests).where(and(eq(partyGuests.partyId, partyId), eq(partyGuests.userId, userId)));
      return row ?? null;
    },

    async findGuestByTokenHash(tokenHash) {
      const [row] = await db.select().from(partyGuests).where(eq(partyGuests.guestTokenHash, tokenHash));
      return row ?? null;
    },

    async addGuest(guest) {
      const [row] = await db.insert(partyGuests).values(guest).returning();
      return row;
    },

    async updateGuest(id, update) {
      const [row] = await db.update(partyGuests).set({ ...update, updatedAt: new Date() }).where(eq(partyGuests.id, id)).returning();
      return row ?? null;
    },

    async deleteGuest(id) {
      await db.delete(partyGuests).where(eq(partyGuests.id, id));
    },

    async listDishes(partyId) {
      return db.select().from(partyDishes).where(eq(partyDishes.partyId, partyId)).orderBy(asc(partyDishes.createdAt));
    },

    async getDish(id) {
      const [row] = await db.select().from(partyDishes).where(eq(partyDishes.id, id));
      return row ?? null;
    },

    async addDish(dish) {
      const [row] = await db.insert(partyDishes).values(dish).returning();
      return row;
    },

    async updateDish(id, update) {
      const [row] = await db.update(partyDishes).set({ ...update, updatedAt: new Date() }).where(eq(partyDishes.id, id)).returning();
      return row ?? null;
    },

    async deleteDish(id) {
      await db.delete(partyDishes).where(eq(partyDishes.id, id));
    },

    async getUsers(ids) {
      if (ids.length === 0) return [];
      const result = await db.execute(sql`
        SELECT id, first_name, is_guest, default_recipe_visibility FROM users
        WHERE id IN (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})`);
      return (result.rows as Array<Record<string, unknown>>).map((r) => ({
        id: String(r.id),
        firstName: (r.first_name as string | null) ?? null,
        isGuest: !!r.is_guest,
        defaultRecipeVisibility: (r.default_recipe_visibility as "public" | "private" | null) ?? null,
      }));
    },

    async createGuestUser(name) {
      // Guest recipes stay private; no email or Clerk id, so nobody can sign in as one
      const result = await db.execute(sql`
        INSERT INTO users (first_name, is_guest, default_recipe_visibility, default_cookbook_visibility)
        VALUES (${name.slice(0, 100)}, true, 'private', 'private')
        RETURNING id`);
      return String((result.rows[0] as { id: string }).id);
    },

    async recipeFacts(ids) {
      if (ids.length === 0) return [];
      const rows = await db.select({
        id: recipes.id, title: recipes.title, description: recipes.description,
        dishImage: recipes.dishImage, dishImageThumbnail: recipes.dishImageThumbnail,
        servings: recipes.servings, allergens: recipes.allergens, dietType: recipes.dietType,
        isVegetarian: recipes.isVegetarian, isVegan: recipes.isVegan, isPescatarian: recipes.isPescatarian,
        isGlutenFree: recipes.isGlutenFree, isDairyFree: recipes.isDairyFree,
        ingredients: recipes.ingredients, enrichmentStatus: recipes.enrichmentStatus,
        ownerUserId: recipes.ownerUserId, isPublic: recipes.isPublic,
      }).from(recipes).where(inArray(recipes.id, ids));
      return rows.map((r) => ({
        id: r.id,
        title: r.title,
        description: r.description,
        image: r.dishImageThumbnail || r.dishImage || null,
        servings: r.servings,
        allergens: r.allergens ?? [],
        diets: recipeDiets(r),
        ingredients: r.ingredients ?? [],
        status: r.enrichmentStatus ?? null,
        ownerUserId: r.ownerUserId,
        isPublic: r.isPublic,
      }));
    },

    async recipeForGuests(id) {
      const [row] = await db.select().from(recipes).where(eq(recipes.id, id));
      if (!row) return null;
      const { handwrittenImage: _card, dishImagePrint: _print, ...rest } = row;
      return rest;
    },

    async addToCookbook(cookbookId, recipeId) {
      const [maxPos] = await db.select({ max: sql<number>`MAX(${cookbookRecipes.position})` }).from(cookbookRecipes)
        .where(eq(cookbookRecipes.cookbookId, cookbookId));
      await db.insert(cookbookRecipes).values({ cookbookId, recipeId, position: (maxPos?.max ?? -1) + 1 }).onConflictDoNothing();
    },

    async removeFromCookbook(cookbookId, recipeId) {
      await db.delete(cookbookRecipes).where(and(eq(cookbookRecipes.cookbookId, cookbookId), eq(cookbookRecipes.recipeId, recipeId)));
    },

    async shareRecipes(recipeIds, userIds) {
      if (recipeIds.length === 0 || userIds.length === 0) return;
      const privateOnes = await db.select({ id: recipes.id, ownerUserId: recipes.ownerUserId }).from(recipes)
        .where(and(inArray(recipes.id, recipeIds), eq(recipes.isPublic, false)));
      const values = privateOnes.flatMap((r) => userIds
        .filter((u) => u !== r.ownerUserId)
        .map((userId) => ({ recipeId: r.id, userId, role: "viewer" as const })));
      if (values.length) await db.insert(recipeShares).values(values).onConflictDoNothing();
    },

    async addCookbookMember(cookbookId, userId, addedBy) {
      const [book] = await db.select({ ownerUserId: cookbooks.ownerUserId }).from(cookbooks).where(eq(cookbooks.id, cookbookId));
      if (!book || book.ownerUserId === userId) return;
      await db.insert(cookbookCollaborators).values({ cookbookId, userId, role: "editor", addedByUserId: addedBy }).onConflictDoNothing();
    },

    async claimGuest(guestUserId, accountId) {
      return db.transaction(async (tx) => {
        await tx.update(recipes).set({ ownerUserId: accountId }).where(eq(recipes.ownerUserId, guestUserId));
        await tx.update(recipeImports).set({ ownerUserId: accountId }).where(eq(recipeImports.ownerUserId, guestUserId));
        const places = await tx.select().from(partyGuests).where(eq(partyGuests.userId, guestUserId));
        for (const place of places) {
          const [mine] = await tx.select().from(partyGuests)
            .where(and(eq(partyGuests.partyId, place.partyId), eq(partyGuests.userId, accountId)));
          if (mine) {
            await tx.update(partyDishes).set({ guestId: mine.id }).where(eq(partyDishes.guestId, place.id));
            await tx.delete(partyGuests).where(eq(partyGuests.id, place.id));
          } else {
            await tx.update(partyGuests).set({ userId: accountId, guestTokenHash: null, updatedAt: new Date() }).where(eq(partyGuests.id, place.id));
          }
        }
        return Array.from(new Set(places.map((p) => p.partyId)));
      });
    },
  };
}
