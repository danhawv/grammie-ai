import { afterEach, beforeEach, describe, expect, it } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createMcpRouter, type McpRouterDeps, type VerifiedToken } from "./mcp";
import type { CookbookSummary, McpData, McpEnrichment, MealPlanEntryView, MealPlanSummary, RecipeCard } from "../mcp/data";
import { READ_TOOLS, WRITE_TOOLS } from "../mcp/tools";
import { clerkIssuer } from "../mcp/config";

// ------------------------------------------------------------------ fakes

type FakeRecipe = RecipeCard & { ingredients: string[]; instructions: string[]; calories?: number | null; [k: string]: unknown };

class MemoryMcpData implements McpData {
  recipes = new Map<string, FakeRecipe>();
  shares: Array<{ recipeId: string; userId: string }> = [];
  cookbooks: Array<CookbookSummary & { recipeIds: string[]; collaborators: string[] }> = [];
  pantry = new Map<string, Array<{ id: string; name: string; quantity: number | null; unit: string | null; category: string | null; expiresAt: Date | null }>>();
  grocery = new Map<string, Array<{ item: string; displayName: string; quantity: number; unit: string; aisle: string | null; checked: boolean; recipeId: string | null; originalEntries: any[] }>>();
  plans: Array<MealPlanSummary & { collaborators: string[] }> = [];
  entries: Array<MealPlanEntryView & { mealPlanId: string }> = [];
  created: any[] = [];
  private n = 0;

  addRecipe(r: Partial<FakeRecipe> & { id: string; ownerUserId: string; title: string }) {
    this.recipes.set(r.id, { isPublic: false, servings: 4, ingredients: ["1 cup flour"], instructions: ["Mix."], ...r } as FakeRecipe);
  }
  private canSee(r: FakeRecipe, userId: string) {
    return r.isPublic || r.ownerUserId === userId || this.shares.some((s) => s.recipeId === r.id && s.userId === userId);
  }

  async searchRecipes(userId: string, opts: { scope: string; filters: any; limit: number }) {
    const q = (opts.filters.search ?? "").toLowerCase();
    const all = Array.from(this.recipes.values()).filter((r) => {
      if (opts.scope === "mine" && r.ownerUserId !== userId) return false;
      if (opts.scope === "shared" && !this.shares.some((s) => s.recipeId === r.id && s.userId === userId)) return false;
      return this.canSee(r, userId) && (!q || r.title.toLowerCase().includes(q));
    });
    return { recipes: all.slice(0, opts.limit), total: all.length };
  }
  async getRecipe(id: string, userId: string) {
    const r = this.recipes.get(id);
    return r && this.canSee(r, userId) ? (r as any) : undefined;
  }
  async listCookbooks(userId: string) {
    return {
      owned: this.cookbooks.filter((c) => c.ownerUserId === userId),
      shared: this.cookbooks.filter((c) => c.collaborators.includes(userId)),
    };
  }
  async getCookbook(id: number, userId: string) {
    const c = this.cookbooks.find((x) => x.id === id);
    if (!c) return undefined;
    if (c.ownerUserId === userId) return { cookbook: c, access: "owner" as const };
    if (c.collaborators.includes(userId)) return { cookbook: c, access: "collaborator" as const };
    return c.isPublic ? { cookbook: c, access: "public" as const } : undefined;
  }
  async getCookbookRecipes(id: number, limit: number) {
    const c = this.cookbooks.find((x) => x.id === id)!;
    const recipes = c.recipeIds.map((rid) => this.recipes.get(rid)!).filter(Boolean);
    return { recipes: recipes.slice(0, limit), total: recipes.length };
  }
  async getPantryItems(userId: string) { return (this.pantry.get(userId) ?? []) as any; }
  async getRecipesForPantryMatching(userId: string) {
    return Array.from(this.recipes.values()).filter((r) => this.canSee(r, userId)) as any;
  }
  async getPreferences() { return null; }
  async getGroceryItems(userId: string) { return (this.grocery.get(userId) ?? []) as any; }
  async addRecipeToGroceryList(userId: string, recipeId: string, scale: number) {
    const r = this.recipes.get(recipeId)!;
    const list = this.grocery.get(userId) ?? [];
    for (const line of r.ingredients) {
      list.push({ item: line, displayName: line, quantity: scale, unit: "x", aisle: null, checked: false, recipeId, originalEntries: [{ recipeId, recipeTitle: r.title }] });
    }
    this.grocery.set(userId, list);
  }
  async addGroceryItem(userId: string, item: { item: string; quantity?: number; unit?: string }) {
    const list = this.grocery.get(userId) ?? [];
    list.push({ item: item.item, displayName: item.item, quantity: item.quantity ?? 1, unit: item.unit ?? "count", aisle: null, checked: false, recipeId: null, originalEntries: [] });
    this.grocery.set(userId, list);
  }
  async listMealPlans(userId: string) {
    return this.plans.filter((p) => p.ownerUserId === userId || p.collaborators.includes(userId));
  }
  async getMealPlanEntries(id: string, userId: string) {
    const p = (await this.listMealPlans(userId)).find((x) => x.id === id);
    return p ? this.entries.filter((e) => e.mealPlanId === id) : undefined;
  }
  async canEditMealPlan(id: string, userId: string) {
    return this.plans.some((p) => p.id === id && p.ownerUserId === userId);
  }
  async createMealPlan(plan: { ownerUserId: string; name: string; startDate: Date; endDate: Date }) {
    const p = { ...plan, id: `plan-${++this.n}`, status: "active", updatedAt: new Date(), collaborators: [] };
    this.plans.push(p);
    return p;
  }
  async addMealPlanEntry(e: { mealPlanId: string; date: Date; mealSlot: string; recipeId: string; scaledServings?: number; notes?: string }) {
    const entry = {
      id: `entry-${++this.n}`, mealPlanId: e.mealPlanId, date: e.date, mealSlot: e.mealSlot, recipeId: e.recipeId,
      recipeTitle: this.recipes.get(e.recipeId)?.title ?? null, customMealName: null, scaledServings: e.scaledServings ?? null, notes: e.notes ?? null,
    };
    this.entries.push(entry);
    return { id: entry.id };
  }
  async createRecipe(recipe: any) {
    const id = `new-${++this.n}`;
    this.created.push({ id, ...recipe });
    this.recipes.set(id, { id, ...recipe });
    return { id, title: recipe.title };
  }
}

// ------------------------------------------------------------------ setup

interface Ctx {
  base: string;
  server: Server;
  data: MemoryMcpData;
  audit: Array<Record<string, unknown>>;
  charges: string[];
  queued: string[];
  flags: { enabled: boolean; writes: boolean; afford: boolean };
}
let ctx: Ctx;

const TOKENS: Record<string, VerifiedToken> = {
  "tok-alice": { subject: "clerk_alice", clientId: "claude", scopes: ["openid"] },
  "tok-alice-2": { subject: "clerk_alice", clientId: "chatgpt", scopes: ["openid"] },
  "tok-bob": { subject: "clerk_bob", clientId: "claude", scopes: ["openid"] },
};
const USERS: Record<string, string> = { clerk_alice: "alice", clerk_bob: "bob" };

async function setup(): Promise<Ctx> {
  const data = new MemoryMcpData();
  data.addRecipe({ id: "a-soup", ownerUserId: "alice", title: "Alice's Tomato Soup", ingredients: ["4 tomatoes", "1 onion"], calories: 120 });
  data.addRecipe({ id: "b-secret", ownerUserId: "bob", title: "Bob's Secret Chili", ingredients: ["1 lb beef", "2 cans beans"] });
  data.addRecipe({ id: "b-shared", ownerUserId: "bob", title: "Bob's Shared Bread", ingredients: ["3 cups flour"] });
  data.addRecipe({ id: "c-public", ownerUserId: "carol", title: "Public Tomato Salad", isPublic: true, ingredients: ["2 tomatoes"] });
  data.shares.push({ recipeId: "b-shared", userId: "alice" });
  data.cookbooks.push(
    { id: 1, name: "Alice Family", ownerUserId: "alice", isPublic: false, recipeCount: 1, recipeIds: ["a-soup"], collaborators: [] },
    { id: 2, name: "Bob Private", ownerUserId: "bob", isPublic: false, recipeCount: 1, recipeIds: ["b-secret"], collaborators: [] },
    { id: 3, name: "Bob Public", ownerUserId: "bob", isPublic: true, recipeCount: 2, recipeIds: ["b-secret", "c-public"], collaborators: [] },
  );
  data.pantry.set("alice", [{ id: "p1", name: "tomatoes", quantity: 6, unit: null, category: "Produce", expiresAt: null }]);
  data.pantry.set("bob", [{ id: "p2", name: "bob's caviar", quantity: 1, unit: null, category: null, expiresAt: null }]);
  data.grocery.set("alice", [{ item: "milk", displayName: "milk", quantity: 1, unit: "gallon", aisle: "Dairy", checked: false, recipeId: null, originalEntries: [] }]);
  data.grocery.set("bob", [{ item: "bob's beer", displayName: "bob's beer", quantity: 6, unit: "count", aisle: null, checked: false, recipeId: null, originalEntries: [] }]);

  const audit: Ctx["audit"] = [];
  const charges: string[] = [];
  const queued: string[] = [];
  const flags = { enabled: true, writes: true, afford: true };
  const enrichment: McpEnrichment = {
    canAfford: async () => (flags.afford ? { ok: true } : { ok: false, message: "You're out of credits." }),
    charge: async (_u, id) => { charges.push(id); },
    queue: ({ id }) => { queued.push(id); },
  };
  const deps: McpRouterDeps = {
    enabled: () => flags.enabled,
    verifyToken: async (t) => TOKENS[t] ?? null,
    resolveUserId: async (sub) => USERS[sub] ?? null,
    authorizationServer: () => "https://clerk.grammie.test",
    fetchAuthServerMetadata: async () => ({ issuer: "https://clerk.grammie.test" }),
    publicOrigin: () => "https://grammie.test",
    data,
    enrichment,
    writesEnabled: () => flags.writes,
    audit: (e) => audit.push(e),
    now: () => new Date("2026-10-18T15:00:00Z"),
  };
  const app = express();
  app.use(express.json());
  app.use("/", createMcpRouter(deps));
  const server = await new Promise<Server>((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { base, server, data, audit, charges, queued, flags };
}

beforeEach(async () => { ctx = await setup(); });
afterEach(async () => { await new Promise((r) => ctx.server.close(r)); });

let rpcId = 0;
async function rpc(method: string, params: unknown, token: string | null = "tok-alice") {
  const res = await fetch(`${ctx.base}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }),
  });
  const text = await res.text();
  let body: any = null;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, headers: res.headers, body };
}

async function tool(name: string, args: Record<string, unknown> = {}, token = "tok-alice") {
  const r = await rpc("tools/call", { name, arguments: args }, token);
  expect(r.status).toBe(200);
  const result = r.body.result;
  const text = result.content?.[0]?.text ?? "";
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* error text */ }
  return { isError: !!result.isError, text, json };
}

// ------------------------------------------------------------------ tests

describe("connector switch", () => {
  it("answers 404 everywhere but the status route when MCP is off", async () => {
    ctx.flags.enabled = false;
    expect((await rpc("tools/list", {})).status).toBe(404);
    expect((await fetch(`${ctx.base}/.well-known/oauth-protected-resource/mcp`)).status).toBe(404);
    expect((await fetch(`${ctx.base}/.well-known/oauth-protected-resource`)).status).toBe(404);
    expect((await fetch(`${ctx.base}/.well-known/oauth-authorization-server`)).status).toBe(404);
    expect(await (await fetch(`${ctx.base}/api/mcp/status`)).json()).toEqual({ enabled: false });
  });

  it("reports enabled on the status route", async () => {
    expect(await (await fetch(`${ctx.base}/api/mcp/status`)).json()).toEqual({ enabled: true });
  });
});

describe("auth", () => {
  it("401s without a token and points at the protected resource metadata", async () => {
    const r = await rpc("tools/list", {}, null);
    expect(r.status).toBe(401);
    expect(r.headers.get("www-authenticate")).toBe('Bearer resource_metadata="https://grammie.test/.well-known/oauth-protected-resource/mcp"');
  });

  it("401s with invalid_token for a bad token", async () => {
    const r = await rpc("tools/list", {}, "nope");
    expect(r.status).toBe(401);
    expect(r.headers.get("www-authenticate")).toContain('error="invalid_token"');
    expect(r.headers.get("www-authenticate")).toContain("resource_metadata=");
  });

  it("serves RFC 9728 metadata naming Clerk as the authorization server", async () => {
    for (const path of ["/.well-known/oauth-protected-resource/mcp", "/.well-known/oauth-protected-resource"]) {
      const meta = await (await fetch(`${ctx.base}${path}`)).json();
      expect(meta.resource).toBe("https://grammie.test/mcp");
      expect(meta.authorization_servers).toEqual(["https://clerk.grammie.test"]);
      expect(meta.bearer_methods_supported).toEqual(["header"]);
    }
    const as = await (await fetch(`${ctx.base}/.well-known/oauth-authorization-server`)).json();
    expect(as.issuer).toBe("https://clerk.grammie.test");
  });

  it("rejects GET on /mcp (stateless, no SSE stream)", async () => {
    const res = await fetch(`${ctx.base}/mcp`, { headers: { authorization: "Bearer tok-alice" } });
    expect(res.status).toBe(405);
  });
});

describe("tool list", () => {
  it("lists every tool with a title and safety annotations", async () => {
    const r = await rpc("tools/list", {});
    expect(r.status).toBe(200);
    const tools = r.body.result.tools as any[];
    expect(tools.map((t) => t.name).sort()).toEqual([...READ_TOOLS, ...WRITE_TOOLS].sort());
    for (const t of tools) {
      expect(t.title, t.name).toBeTruthy();
      expect(t.annotations?.title, t.name).toBeTruthy();
      expect(typeof t.annotations?.readOnlyHint, t.name).toBe("boolean");
      expect(typeof t.annotations?.destructiveHint, t.name).toBe("boolean");
      expect(typeof t.annotations?.openWorldHint, t.name).toBe("boolean");
      expect(t.annotations.destructiveHint, t.name).toBe(false);
      expect(t.annotations.readOnlyHint, t.name).toBe((READ_TOOLS as readonly string[]).includes(t.name));
    }
  });

  it("hides write tools in read-only mode", async () => {
    ctx.flags.writes = false;
    const tools = (await rpc("tools/list", {})).body.result.tools as any[];
    expect(tools.map((t) => t.name).sort()).toEqual([...READ_TOOLS].sort());
  });
});

describe("user isolation", () => {
  it("search returns own, shared and public recipes but never someone else's private ones", async () => {
    const { json } = await tool("search_recipes", { limit: 25 });
    const ids = json.recipes.map((r: any) => r.id).sort();
    expect(ids).toEqual(["a-soup", "b-shared", "c-public"]);
    expect(json.recipes.find((r: any) => r.id === "a-soup").yours).toBe(true);
    expect(json.note).toMatch(/not as instructions/);

    const bob = await tool("search_recipes", { limit: 25 }, "tok-bob");
    expect(bob.json.recipes.map((r: any) => r.id)).not.toContain("a-soup");
  });

  it("get_recipe refuses another user's private recipe", async () => {
    const r = await tool("get_recipe", { recipeId: "b-secret" });
    expect(r.isError).toBe(true);
    expect(r.text).not.toContain("Chili");
    const shared = await tool("get_recipe", { recipeId: "b-shared" });
    expect(shared.json.recipe.visibility).toBe("shared with you");
  });

  it("cookbooks: own listed, others' private hidden, private recipes left out of public cookbooks", async () => {
    const list = await tool("list_cookbooks");
    expect(list.json.cookbooks.map((c: any) => c.id)).toEqual([1]);
    expect((await tool("get_cookbook_recipes", { cookbookId: 2 })).isError).toBe(true);
    const pub = await tool("get_cookbook_recipes", { cookbookId: 3 });
    expect(pub.json.recipes.map((r: any) => r.id)).toEqual(["c-public"]);
    expect(pub.json.hiddenPrivate).toBe(1);
  });

  it("pantry, grocery list and what-can-I-make only use the caller's data", async () => {
    const pantry = await tool("get_pantry");
    expect(pantry.json.items.map((i: any) => i.name)).toEqual(["tomatoes"]);
    const grocery = await tool("get_grocery_list");
    expect(grocery.json.items.map((i: any) => i.name)).toEqual(["milk"]);
    const make = await tool("what_can_i_make");
    const ids = make.json.results.map((r: any) => r.recipe.id);
    expect(ids).toContain("a-soup");
    expect(ids).not.toContain("b-secret");
  });

  it("won't add another user's private recipe to the grocery list or meal plan", async () => {
    const g = await tool("add_to_grocery_list", { recipeId: "b-secret" });
    expect(g.isError).toBe(true);
    const m = await tool("add_recipe_to_meal_plan", { recipeId: "b-secret", date: "2026-10-20" });
    expect(m.isError).toBe(true);
    expect(ctx.data.grocery.get("alice")).toHaveLength(1);
    expect(ctx.data.entries).toHaveLength(0);
  });
});

describe("recipes", () => {
  it("scales ingredients and keeps nutrition per serving", async () => {
    ctx.data.addRecipe({ id: "a-cake", ownerUserId: "alice", title: "Cake", servings: 4, ingredients: ["2 cups flour", "salt to taste"], calories: 300 });
    const r = await tool("get_recipe", { recipeId: "a-cake", servings: 8 });
    expect(r.json.recipe.servings).toBe(8);
    expect(r.json.recipe.originalServings).toBe(4);
    expect(r.json.recipe.ingredients[0]).toBe("4 cups flour");
    expect(r.json.recipe.nutritionPerServing.calories).toBe(300);
  });

  it("cuts very long recipe text short", async () => {
    ctx.data.addRecipe({ id: "a-long", ownerUserId: "alice", title: "Long", instructions: ["x".repeat(10_000)], ingredients: Array.from({ length: 500 }, (_, i) => `${i} eggs`) });
    const r = await tool("get_recipe", { recipeId: "a-long" });
    expect(r.json.recipe.steps[0].length).toBeLessThanOrEqual(1500);
    expect(r.json.recipe.ingredients).toHaveLength(100);
    expect(r.json.recipe.ingredientsTruncated).toBe(true);
  });
});

describe("writes", () => {
  it("add_to_grocery_list only adds, and audits", async () => {
    const r = await tool("add_to_grocery_list", { recipeId: "a-soup", scale: 2, items: [{ name: "basil", quantity: 1, unit: "bunch" }] });
    expect(r.isError).toBe(false);
    expect(r.json.added.recipe).toEqual({ id: "a-soup", title: "Alice's Tomato Soup", scale: 2 });
    expect(r.json.undo).toMatch(/remove/);
    const names = ctx.data.grocery.get("alice")!.map((i) => i.item);
    expect(names[0]).toBe("milk"); // what was there stays
    expect(names).toEqual(["milk", "4 tomatoes", "1 onion", "basil"]);
    expect(ctx.data.grocery.get("alice")![1].quantity).toBe(2);
    expect(ctx.data.grocery.get("bob")).toHaveLength(1);
    expect(ctx.audit).toEqual([expect.objectContaining({ tool: "add_to_grocery_list", userId: "alice", outcome: "ok", recipeId: "a-soup", items: 1, client: "claude" })]);
  });

  it("add_to_grocery_list needs items or a recipe", async () => {
    expect((await tool("add_to_grocery_list", {})).isError).toBe(true);
  });

  it("add_recipe_to_meal_plan starts a week plan once, then adds to it without touching other entries", async () => {
    const first = await tool("add_recipe_to_meal_plan", { recipeId: "a-soup", date: "2026-10-21", mealSlot: "dinner", servings: 6 });
    expect(first.isError).toBe(false);
    expect(first.json.added.startedNewPlan).toBe(true);
    expect(first.json.added.mealPlan).toMatchObject({ startDate: "2026-10-19", endDate: "2026-10-25", name: "Week of October 19" });
    expect(first.json.undo).toMatch(/Wednesday, October 21 \(dinner\)/);

    const second = await tool("add_recipe_to_meal_plan", { recipeId: "c-public", date: "2026-10-25", mealSlot: "lunch" });
    expect(second.json.added.startedNewPlan).toBe(false);
    expect(second.json.added.mealPlan.id).toBe(first.json.added.mealPlan.id);
    expect(ctx.data.plans).toHaveLength(1);
    expect(ctx.data.entries.map((e) => e.recipeId)).toEqual(["a-soup", "c-public"]);

    const plan = await tool("get_meal_plan", { date: "2026-10-22" });
    expect(plan.json.plan.id).toBe(first.json.added.mealPlan.id);
    expect(plan.json.entries.map((e: any) => [e.date, e.mealSlot, e.recipe.id])).toEqual([
      ["2026-10-21", "dinner", "a-soup"],
      ["2026-10-25", "lunch", "c-public"],
    ]);
    expect(ctx.audit.filter((a) => a.tool === "add_recipe_to_meal_plan")).toHaveLength(2);
  });

  it("won't add to a meal plan the user can't edit", async () => {
    ctx.data.plans.push({ id: "bob-plan", name: "Bob's week", ownerUserId: "bob", startDate: new Date("2026-10-19T00:00:00Z"), endDate: new Date("2026-10-25T00:00:00Z"), status: "active", collaborators: ["alice"] });
    const r = await tool("add_recipe_to_meal_plan", { recipeId: "a-soup", date: "2026-10-20", mealPlanId: "bob-plan" });
    expect(r.isError).toBe(true);
    expect(ctx.data.entries).toHaveLength(0);
  });

  it("create_recipe saves a private recipe for free by default", async () => {
    const r = await tool("create_recipe", { title: "Grandma's Pie", ingredients: ["6 apples"], steps: ["Bake."], servings: 8, prepMinutes: 20, cookMinutes: 50, source: "Grandma Rose" });
    expect(r.isError).toBe(false);
    expect(r.json.saved).toMatchObject({ visibility: "private", creditsUsed: 0, enriching: false });
    const saved = ctx.data.created[0];
    expect(saved).toMatchObject({ ownerUserId: "alice", isPublic: false, enrichmentStatus: "ready", servings: 8, totalTimeMinutes: 70 });
    expect(saved.description).toContain("Source: Grandma Rose");
    expect(ctx.charges).toEqual([]);
    expect(ctx.queued).toEqual([]);
    expect(ctx.audit).toEqual([expect.objectContaining({ tool: "create_recipe", outcome: "ok", enrich: false })]);
  });

  it("create_recipe with enrich goes through the credit check", async () => {
    ctx.flags.afford = false;
    const broke = await tool("create_recipe", { title: "Pie", ingredients: ["apples"], steps: ["Bake."], servings: 8, enrich: true });
    expect(broke.isError).toBe(true);
    expect(broke.text).toMatch(/out of credits/);
    expect(ctx.data.created).toHaveLength(0);

    ctx.flags.afford = true;
    const ok = await tool("create_recipe", { title: "Pie", ingredients: ["apples"], steps: ["Bake."], servings: 8, enrich: true });
    expect(ok.json.saved.creditsUsed).toBe(1);
    expect(ctx.data.created[0].enrichmentStatus).toBe("enriching");
    expect(ctx.charges).toEqual([ok.json.saved.id]);
    expect(ctx.queued).toEqual([ok.json.saved.id]);
  });

  it("rate-limits writes per user across tokens", async () => {
    for (let i = 0; i < 10; i++) expect((await tool("add_to_grocery_list", { items: [{ name: `a${i}` }] })).isError).toBe(false);
    for (let i = 0; i < 10; i++) expect((await tool("add_to_grocery_list", { items: [{ name: `b${i}` }] }, "tok-alice-2")).isError).toBe(false);
    const over = await tool("add_to_grocery_list", { items: [{ name: "one more" }] });
    expect(over.isError).toBe(true);
    expect(over.text).toMatch(/Too many changes/);
    expect((await tool("add_to_grocery_list", { items: [{ name: "bob ok" }] }, "tok-bob")).isError).toBe(false);
  });
});

describe("clerkIssuer", () => {
  it("reads the Frontend API host from the publishable key", () => {
    const key = `pk_live_${Buffer.from("clerk.grammie.ai$").toString("base64")}`;
    expect(clerkIssuer({ CLERK_PUBLISHABLE_KEY: key } as any)).toBe("https://clerk.grammie.ai");
    expect(clerkIssuer({ MCP_AUTH_SERVER_URL: "https://auth.example/" } as any)).toBe("https://auth.example");
    expect(clerkIssuer({} as any)).toBeNull();
  });
});
