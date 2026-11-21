import { afterEach, beforeEach, describe, expect, it } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createAccountRouter, PRINT_ORDER_IN_PROGRESS_CODE } from "./account";
import type { AccountStore } from "../account/store";
import { DELETION_STEPS, printOrderInProgress, type DeletionResult } from "../account/plan";

// DELETE /api/account on an in-memory store: rows keyed by "table.column"
// (the deletion plan's own keys), so the fake deletes exactly what the plan
// says and nothing else.

interface Row { [col: string]: any }

class MemoryAccountStore implements AccountStore {
  users = new Map<string, { clerkId: string | null; isGuest: boolean }>();
  tables = new Map<string, Row[]>();
  media = new Set<string>();
  failDelete = false;

  rows(table: string): Row[] {
    if (!this.tables.has(table)) this.tables.set(table, []);
    return this.tables.get(table)!;
  }
  async find(userId: string) {
    const u = this.users.get(userId);
    return u ? { isGuest: u.isGuest } : null;
  }
  async printOrdersInProgress(userId: string) {
    return this.rows("print_orders").filter((o) => o.owner_user_id === userId && printOrderInProgress({
      status: o.status, luluStatus: o.lulu_status ?? null, updatedAt: o.updated_at ?? new Date(),
    })).length;
  }
  async deleteAll(userId: string): Promise<DeletionResult> {
    if (this.failDelete) throw new Error("database down");
    const user = this.users.get(userId)!;
    const mediaKeys = this.rows("recipes").filter((r) => r.owner_user_id === userId && r.media).map((r) => r.media);
    const counts: Record<string, number> = {};
    for (const step of DELETION_STEPS) {
      const rows = this.rows(step.table);
      const hits = rows.filter((r) => r[step.column] === userId);
      if (step.action === "nullify") hits.forEach((r) => { r[step.column] = null; });
      else this.tables.set(step.table, rows.filter((r) => r[step.column] !== userId));
      counts[`${step.table}.${step.column}`] = hits.length;
    }
    this.users.delete(userId);
    counts["users.id"] = 1;
    return { counts, skipped: [], clerkId: user.clerkId, mediaKeys };
  }
  async unusedMediaKeys(keys: string[]) {
    const used = new Set(this.rows("recipes").map((r) => r.media));
    return keys.filter((k) => !used.has(k));
  }
}

interface Ctx {
  base: string;
  server: Server;
  store: MemoryAccountStore;
  clerkDeleted: string[];
  mediaDeleted: string[];
  logs: string[];
  clerkFails?: number;
}

let ctx: Ctx;

beforeEach(async () => {
  const store = new MemoryAccountStore();
  const c: Partial<Ctx> = { store, clerkDeleted: [], mediaDeleted: [], logs: [] };
  const app = express();
  app.use("/api", createAccountRouter({
    store,
    auth: (req: any, res, next) => {
      const user = req.header("x-user");
      if (!user) return res.status(401).json({ message: "Unauthorized" });
      req.user = { claims: { sub: user } };
      next();
    },
    userIdOf: (req: any) => req.user?.claims?.sub,
    deleteClerkUser: async (id) => {
      if (c.clerkFails) throw Object.assign(new Error("clerk"), { status: c.clerkFails });
      c.clerkDeleted!.push(id);
    },
    deleteMedia: async (key) => { c.mediaDeleted!.push(key); },
    log: { info: (m: string) => c.logs!.push(m), warn: () => {}, error: (m: string) => c.logs!.push(m) },
  }));
  const server = await new Promise<Server>((resolve) => { const s = app.listen(0, () => resolve(s)); });
  c.server = server;
  c.base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  ctx = c as Ctx;

  // Alice (Clerk user) owns a lot; Bob owns his own things and shares with Alice
  store.users.set("alice", { clerkId: "user_clerk_alice", isGuest: false });
  store.users.set("bob", { clerkId: "user_clerk_bob", isGuest: false });
  store.users.set("guest-1", { clerkId: null, isGuest: true });
  store.rows("recipes").push(
    { id: "r1", owner_user_id: "alice", media: "a-photo.jpg" },
    { id: "r2", owner_user_id: "alice", media: "shared-photo.jpg" },
    { id: "r3", owner_user_id: "bob", media: "shared-photo.jpg" },
  );
  store.rows("cookbooks").push({ id: 1, owner_user_id: "alice" }, { id: 2, owner_user_id: "bob" });
  store.rows("parties").push({ id: "p1", owner_user_id: "alice" });
  store.rows("party_guests").push({ id: "g1", user_id: "alice" }, { id: "g2", user_id: "bob" });
  store.rows("credit_balances").push({ user_id: "alice", balance: 40 });
  store.rows("meal_plan_entries").push({ id: "e1", assigned_user_id: "alice", meal_plan_id: "bobs-plan" });
  store.rows("cookbook_collaborators").push({ cookbook_id: 2, user_id: "alice", added_by_user_id: "bob" });
});

afterEach(async () => {
  await new Promise((r) => ctx.server.close(r));
});

const del = (user?: string) =>
  fetch(`${ctx.base}/api/account`, { method: "DELETE", headers: user ? { "x-user": user } : {} });

describe("DELETE /api/account", () => {
  it("needs a signed-in account", async () => {
    expect((await del()).status).toBe(401);
    const guest = await del("guest-1");
    expect(guest.status).toBe(400);
    expect(ctx.store.users.has("guest-1")).toBe(true);
    expect((await del("nobody")).status).toBe(404);
  });

  it("deletes everything the person owns, their Clerk user and unused media, and nothing of anyone else's", async () => {
    const res = await del("alice");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deleted: true });

    const s = ctx.store;
    expect(s.users.has("alice")).toBe(false);
    expect(s.rows("recipes").map((r) => r.id)).toEqual(["r3"]);
    expect(s.rows("cookbooks").map((r) => r.id)).toEqual([2]);
    expect(s.rows("parties")).toEqual([]);
    expect(s.rows("party_guests").map((r) => r.id)).toEqual(["g2"]);
    expect(s.rows("credit_balances")).toEqual([]);
    expect(s.rows("cookbook_collaborators")).toEqual([]);
    // Bob's meal plan stays; it just no longer says Alice is cooking
    expect(s.rows("meal_plan_entries")).toEqual([{ id: "e1", assigned_user_id: null, meal_plan_id: "bobs-plan" }]);
    expect(s.users.has("bob")).toBe(true);

    expect(ctx.clerkDeleted).toEqual(["user_clerk_alice"]);
    // Bob's recipe still uses the shared photo
    expect(ctx.mediaDeleted).toEqual(["a-photo.jpg"]);

    // One audit line: id and counts, no names or emails
    const audit = ctx.logs.find((l) => l.startsWith("[Account] Deleted user alice"));
    expect(audit).toContain("recipes.owner_user_id=2");
    expect(audit).toContain("clerk=deleted");
    expect(audit).not.toMatch(/@/);
  });

  it("waits for print orders in progress", async () => {
    ctx.store.rows("print_orders").push({ id: "o1", owner_user_id: "alice", status: "submitted", lulu_status: "IN_PRODUCTION" });
    const res = await del("alice");
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe(PRINT_ORDER_IN_PROGRESS_CODE);
    expect(body.error).toMatch(/on its way/);
    expect(ctx.store.users.has("alice")).toBe(true);
    expect(ctx.clerkDeleted).toEqual([]);

    // Once it ships, deleting works (and the finished order goes too)
    ctx.store.rows("print_orders")[0].lulu_status = "SHIPPED";
    expect((await del("alice")).status).toBe(200);
    expect(ctx.store.rows("print_orders")).toEqual([]);
  });

  it("reports a database failure without touching Clerk", async () => {
    ctx.store.failDelete = true;
    const res = await del("alice");
    expect(res.status).toBe(500);
    expect((await res.json()).error).toMatch(/Nothing was removed/);
    expect(ctx.clerkDeleted).toEqual([]);
  });

  it("still succeeds when Clerk already has no such user", async () => {
    ctx.clerkFails = 404;
    expect((await del("alice")).status).toBe(200);
    expect(ctx.logs.some((l) => l.includes("clerk=already-gone"))).toBe(true);
  });
});
