// Meal-prep storage (tables in migrations/2026-10-meal-prep-api.sql). The
// routes use these interfaces so tests can run on in-memory fakes; the
// Postgres versions are at the bottom.

import { and, desc, eq, inArray, or } from "drizzle-orm";
import {
  prepCheckins, prepPlanShares, prepPlans, prepProfiles, prepTaskProgress,
  pantryItems, recipeShares, recipes,
  type PrepPlanRow, type PrepPlanShareRow,
} from "@shared/schema";
import type { PrepSetup, MealSlot } from "@shared/meal-prep/contract";
import type { CheckinOutcome, PrepProfileDefaults } from "@shared/meal-prep/api";

export type { PrepPlanRow, PrepPlanShareRow };

export interface ProfileRecord {
  defaults: PrepProfileDefaults;
  walkthroughDone: boolean;
  updatedAt: Date;
}

export interface ProgressRecord {
  taskId: string;
  doneAt: Date;
  doneBy: "owner" | "cook";
}

export interface CheckinRecord {
  id: string;
  personId: string;
  day: number;
  slot: MealSlot;
  outcome: CheckinOutcome;
  note: string | null;
  updatedAt: Date;
}

export type PlanUpdate = Partial<Omit<PrepPlanRow, "id" | "ownerUserId" | "createdAt">>;

export interface PrepStore {
  getProfile(ownerId: string): Promise<ProfileRecord | null>;
  putProfile(ownerId: string, defaults: PrepProfileDefaults, walkthroughDone?: boolean): Promise<ProfileRecord>;

  createPlan(ownerId: string, setup: PrepSetup): Promise<PrepPlanRow>;
  getPlan(id: string): Promise<PrepPlanRow | null>;
  listPlans(ownerId: string, limit: number): Promise<PrepPlanRow[]>;
  updatePlan(id: string, update: PlanUpdate): Promise<PrepPlanRow | null>;

  createShare(share: { planId: string; tokenHash: string; label: string | null; expiresAt: Date }): Promise<PrepPlanShareRow>;
  findShareByHash(tokenHash: string): Promise<PrepPlanShareRow | null>;
  listShares(planId: string): Promise<PrepPlanShareRow[]>;
  revokeShare(planId: string, shareId: string, at: Date): Promise<boolean>;

  setTaskDone(planId: string, taskId: string, done: boolean, by: "owner" | "cook"): Promise<void>;
  listProgress(planId: string): Promise<ProgressRecord[]>;

  upsertCheckin(planId: string, checkin: Omit<CheckinRecord, "id" | "updatedAt">): Promise<CheckinRecord>;
  listCheckins(planId: string): Promise<CheckinRecord[]>;
}

/** The owner's recipes, as far as meal prep needs them */
export interface PrepRecipes {
  /** ids of recipes the owner wrote (the default pool) */
  ownRecipeIds(ownerId: string): Promise<string[]>;
  /** the subset of ids the owner may use: their own, shared with them, or public */
  usableRecipeIds(ownerId: string, ids: string[]): Promise<string[]>;
  /** text the cook needs for these recipes only */
  forCook(ids: string[]): Promise<Array<{ id: string; title: string; servings: number; ingredients: string[]; instructions: string[] }>>;
  /** pantry item names, for the shopping list's "already have" */
  pantryNames(ownerId: string): Promise<string[]>;
}

// ---------------------------------------------------------------------------
// Postgres
// ---------------------------------------------------------------------------

type Db = typeof import("../db").db;

export function createPgPrepStore(db: Db): PrepStore {
  return {
    async getProfile(ownerId) {
      const [row] = await db.select().from(prepProfiles).where(eq(prepProfiles.ownerUserId, ownerId));
      return row ? { defaults: row.defaults, walkthroughDone: row.walkthroughDone, updatedAt: row.updatedAt } : null;
    },

    async putProfile(ownerId, defaults, walkthroughDone) {
      const now = new Date();
      const [row] = await db.insert(prepProfiles)
        .values({ ownerUserId: ownerId, defaults, walkthroughDone: walkthroughDone ?? false, updatedAt: now })
        .onConflictDoUpdate({
          target: prepProfiles.ownerUserId,
          set: {
            defaults,
            updatedAt: now,
            // leave the flag alone unless the request sets it
            ...(walkthroughDone === undefined ? {} : { walkthroughDone }),
          },
        })
        .returning();
      return { defaults: row.defaults, walkthroughDone: row.walkthroughDone, updatedAt: row.updatedAt };
    },

    async createPlan(ownerId, setup) {
      const [row] = await db.insert(prepPlans).values({
        ownerUserId: ownerId,
        setup,
        sessionDate: setup.session.date,
        status: "draft",
        buildStatus: "building",
      }).returning();
      return row;
    },

    async getPlan(id) {
      const [row] = await db.select().from(prepPlans).where(eq(prepPlans.id, id));
      return row ?? null;
    },

    async listPlans(ownerId, limit) {
      return db.select().from(prepPlans)
        .where(eq(prepPlans.ownerUserId, ownerId))
        .orderBy(desc(prepPlans.createdAt))
        .limit(limit);
    },

    async updatePlan(id, update) {
      const [row] = await db.update(prepPlans)
        .set({ ...update, updatedAt: new Date() })
        .where(eq(prepPlans.id, id))
        .returning();
      return row ?? null;
    },

    async createShare(share) {
      const [row] = await db.insert(prepPlanShares).values({ ...share, role: "cook" }).returning();
      return row;
    },

    async findShareByHash(tokenHash) {
      const [row] = await db.select().from(prepPlanShares).where(eq(prepPlanShares.tokenHash, tokenHash));
      return row ?? null;
    },

    async listShares(planId) {
      return db.select().from(prepPlanShares)
        .where(eq(prepPlanShares.planId, planId))
        .orderBy(desc(prepPlanShares.createdAt));
    },

    async revokeShare(planId, shareId, at) {
      const rows = await db.update(prepPlanShares)
        .set({ revokedAt: at })
        .where(and(eq(prepPlanShares.id, shareId), eq(prepPlanShares.planId, planId)))
        .returning({ id: prepPlanShares.id });
      return rows.length > 0;
    },

    async setTaskDone(planId, taskId, done, by) {
      if (done) {
        await db.insert(prepTaskProgress).values({ planId, taskId, doneBy: by })
          .onConflictDoNothing();
      } else {
        await db.delete(prepTaskProgress)
          .where(and(eq(prepTaskProgress.planId, planId), eq(prepTaskProgress.taskId, taskId)));
      }
    },

    async listProgress(planId) {
      const rows = await db.select().from(prepTaskProgress).where(eq(prepTaskProgress.planId, planId));
      return rows.map(r => ({ taskId: r.taskId, doneAt: r.doneAt, doneBy: r.doneBy }));
    },

    async upsertCheckin(planId, c) {
      const now = new Date();
      const [row] = await db.insert(prepCheckins)
        .values({ planId, ...c, updatedAt: now })
        .onConflictDoUpdate({
          target: [prepCheckins.planId, prepCheckins.personId, prepCheckins.day, prepCheckins.slot],
          set: { outcome: c.outcome, note: c.note, updatedAt: now },
        })
        .returning();
      return { id: row.id, personId: row.personId, day: row.day, slot: row.slot, outcome: row.outcome, note: row.note, updatedAt: row.updatedAt };
    },

    async listCheckins(planId) {
      const rows = await db.select().from(prepCheckins).where(eq(prepCheckins.planId, planId));
      return rows.map(row => ({ id: row.id, personId: row.personId, day: row.day, slot: row.slot, outcome: row.outcome, note: row.note, updatedAt: row.updatedAt }));
    },
  };
}

export function createPgPrepRecipes(db: Db): PrepRecipes {
  return {
    async ownRecipeIds(ownerId) {
      const rows = await db.select({ id: recipes.id }).from(recipes).where(eq(recipes.ownerUserId, ownerId));
      return rows.map(r => r.id);
    },

    async usableRecipeIds(ownerId, ids) {
      if (ids.length === 0) return [];
      const shared = db.select({ id: recipeShares.recipeId }).from(recipeShares).where(eq(recipeShares.userId, ownerId));
      const rows = await db.select({ id: recipes.id }).from(recipes).where(and(
        inArray(recipes.id, ids),
        or(eq(recipes.ownerUserId, ownerId), eq(recipes.isPublic, true), inArray(recipes.id, shared)),
      ));
      return rows.map(r => r.id);
    },

    async forCook(ids) {
      if (ids.length === 0) return [];
      return db.select({
        id: recipes.id,
        title: recipes.title,
        servings: recipes.servings,
        ingredients: recipes.ingredients,
        instructions: recipes.instructions,
      }).from(recipes).where(inArray(recipes.id, ids));
    },

    async pantryNames(ownerId) {
      const rows = await db.select({ name: pantryItems.name }).from(pantryItems)
        .where(eq(pantryItems.userId, ownerId))
        .limit(1000);
      return rows.map(r => r.name);
    },
  };
}
