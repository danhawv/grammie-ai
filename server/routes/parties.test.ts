import { afterEach, beforeEach, describe, expect, it } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createPartyRouter, type PartyRouterDeps } from "./parties";
import { MemoryPartyStore } from "../parties/testing/fakes";
import { MemoryCreditStore } from "../lib/credits-memory";
import { charge, createCredits, credits, gate, jobRefs, setCredits } from "../lib/credits";
import { GUEST_CREDITS, GUEST_HEADER, MAX_DISHES_PER_GUEST, defaultSlots, type InvitePreview } from "@shared/party";
import type { ImportOptions } from "../lib/recipe-importers";

interface Ctx {
  base: string;
  server: Server;
  store: MemoryPartyStore;
  creditStore: MemoryCreditStore;
  imports: Array<{ kind: string; userId: string; opts: ImportOptions }>;
}

let ctx: Ctx;

async function setup(): Promise<Ctx> {
  const store = new MemoryPartyStore();
  store.addUser("alice", "Alice");
  store.addUser("bob", "Bob");
  store.addUser("carol", "Carol");
  store.addRecipe({ id: "a-pie", ownerUserId: "alice", isPublic: false, title: "Apple Pie", servings: 8, ingredients: ["6 apples", "1 cup butter", "2 cups flour"] });
  store.addRecipe({ id: "b-nuts", ownerUserId: "bob", isPublic: false, title: "Peanut Brittle", servings: 4, ingredients: ["1 cup peanuts", "1 cup sugar"] });
  store.addRecipe({ id: "c-public", ownerUserId: "carol", isPublic: true, title: "Green Salad", servings: 4, ingredients: ["1 head lettuce"] });

  // Credits switch off, like production today: guests are still capped
  const creditStore = new MemoryCreditStore();
  creditStore.isGuest = async (id: string) => store.users.get(id)?.isGuest ?? false;
  setCredits(createCredits(creditStore, { enforced: () => false, log: { warn: () => {}, error: () => {} } }));

  const imports: Ctx["imports"] = [];
  let n = 0;
  const fakeImport = (kind: string) => async (userId: string, opts: ImportOptions) => {
    imports.push({ kind, userId, opts });
    const id = `imp-${++n}`;
    store.addRecipe({ id, ownerUserId: userId, isPublic: opts.isPublic ?? true, title: "Imported Cake", status: "enriching", servings: 4 });
    await charge(userId, "recipe_import", jobRefs.recipeImport(id));
    return { status: 201, body: { recipeId: id } };
  };
  const signIn = (req: any, _res: any, next: any) => {
    const user = req.header("x-user");
    if (user) req.user = { claims: { sub: user } };
    next();
  };
  const deps: PartyRouterDeps = {
    store,
    auth: signIn,
    optionalAuth: signIn,
    userIdOf: (req: any) => req.user?.claims?.sub,
    importer: {
      link: (_url, userId, opts) => fakeImport("link")(userId, opts),
      text: (_text, userId, opts) => fakeImport("text")(userId, opts),
      photo: (_file, userId, opts) => fakeImport("photo")(userId, opts),
    },
    credits: {
      gate: (res, userId) => gate(res, userId, "recipe_import"),
      balance: async (userId) => (await credits()?.balance(userId)) ?? null,
    },
    preview: async (url): Promise<InvitePreview> => ({ site: "partiful", title: "Fall Feast", image: `https://images.example/${encodeURIComponent(url)}.jpg` }),
    publicOrigin: "https://grammie.test",
  };
  const app = express();
  app.use(express.json());
  app.use("/api", createPartyRouter(deps));
  const server = await new Promise<Server>((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  return { base, server, store, creditStore, imports };
}

async function call(method: string, path: string, body?: unknown, opts: { user?: string | null; guest?: string } = {}) {
  const user = opts.user === undefined ? null : opts.user;
  const res = await fetch(`${ctx.base}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(user ? { "x-user": user } : {}),
      ...(opts.guest ? { [GUEST_HEADER]: opts.guest } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, headers: res.headers };
}

async function makeParty(body: Record<string, unknown> = {}) {
  const res = await call("POST", "/parties", { title: "Fall Feast", style: "dinner", headcount: 10, ...body }, { user: "alice" });
  expect(res.status).toBe(201);
  const token = String(res.body.inviteUrl).split("/p/")[1];
  return { party: res.body, token };
}

async function joinAnon(token: string, body: Record<string, unknown> = {}) {
  const res = await call("POST", `/party/${token}/join`, { name: "Sam", rsvp: "yes", ...body });
  expect(res.status).toBe(201);
  return res.body as { guestId: string; guestToken: string };
}

beforeEach(async () => { ctx = await setup(); });
afterEach(async () => {
  setCredits(null);
  await new Promise((r) => ctx.server.close(r));
});

describe("making a party", () => {
  it("creates the host's place, a private party cookbook and the default courses", async () => {
    const { party, token } = await makeParty();
    expect(party.role).toBe("host");
    expect(party.hostName).toBe("Alice");
    expect(party.inviteUrl).toBe(`https://grammie.test/p/${token}`);
    expect(token.length).toBeGreaterThanOrEqual(22);
    expect(party.guests).toHaveLength(1);
    expect(party.guests[0]).toMatchObject({ name: "Alice", isHost: true, rsvp: "yes", hasAccount: true, isYou: true });
    expect(party.slots.map((s: any) => s.course)).toEqual(defaultSlots("dinner", 10).map((s) => s.course));
    const book = ctx.store.cookbooks.get(party.cookbookId)!;
    expect(book).toMatchObject({ ownerUserId: "alice", name: "Fall Feast", isPublic: false });
    expect(party.confirmedPeople).toBe(1);

    const list = await call("GET", "/parties", undefined, { user: "alice" });
    expect(list.body).toHaveLength(1);
    expect(list.body[0]).toMatchObject({ title: "Fall Feast", role: "host", guestCount: 1, dishCount: 0 });
  });

  it("uses the host's courses and fills the cover from a pasted invite link", async () => {
    const { party } = await makeParty({ slots: [{ course: "main", label: "Turkey" }, { course: "dessert" }], externalInviteUrl: "https://partiful.com/e/abc" });
    expect(party.slots.map((s: any) => [s.course, s.label])).toEqual([["main", "Turkey"], ["dessert", null]]);
    await new Promise((r) => setTimeout(r, 20));
    expect(ctx.store.parties.get(party.id)!.coverImage).toMatch(/^https:\/\/images\.example\//);
  });

  it("rejects bad answers with a readable message", async () => {
    const res = await call("POST", "/parties", { title: "", style: "dinner", headcount: 10 }, { user: "alice" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/name/);
    expect((await call("POST", "/parties", { title: "x", style: "dinner", headcount: 4 })).status).toBe(401);
  });
});

describe("the invite link", () => {
  it("lets an anonymous guest join and recognises them by their guest token", async () => {
    const { token } = await makeParty();
    const visitor = await call("GET", `/party/${token}`);
    expect(visitor.status).toBe(200);
    expect(visitor.body.role).toBe("visitor");
    expect(visitor.body.inviteUrl).toBe(`https://grammie.test/p/${token}`);
    expect(visitor.headers.get("cache-control")).toBe("no-store");
    expect(visitor.headers.get("referrer-policy")).toBe("no-referrer");

    const joined = await joinAnon(token, { allergies: ["Peanuts"], diets: ["vegetarian"] });
    expect(joined.guestToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const me = await call("GET", `/party/${token}`, undefined, { guest: joined.guestToken });
    expect(me.body.role).toBe("guest");
    expect(me.body.youGuestId).toBe(joined.guestId);
    const sam = me.body.guests.find((g: any) => g.id === joined.guestId);
    expect(sam).toMatchObject({ name: "Sam", hasAccount: false, isYou: true, allergies: ["Peanuts"] });
    // Guests see what their own guest account has left
    expect(me.body.credits).toBe(GUEST_CREDITS);
    // A guest user was made for them, flagged as a guest
    const guestRow = Array.from(ctx.store.guests.values()).find((g) => g.id === joined.guestId)!;
    expect(ctx.store.users.get(guestRow.userId)?.isGuest).toBe(true);
    expect(guestRow.guestTokenHash).not.toBe(joined.guestToken);
  });

  it("treats a wrong guest token as a visitor who can't change anything", async () => {
    const { token } = await makeParty();
    await joinAnon(token);
    const wrong = "x".repeat(43);
    expect((await call("GET", `/party/${token}`, undefined, { guest: wrong })).body.role).toBe("visitor");
    const add = await call("POST", `/party/${token}/dishes`, { course: "drink", title: "Wine" }, { guest: wrong });
    expect(add.status).toBe(403);
    // A token from another party doesn't work here either
    const other = await call("POST", "/parties", { title: "Other", style: "potluck", headcount: 6 }, { user: "bob" });
    const otherToken = String(other.body.inviteUrl).split("/p/")[1];
    const elsewhere = await joinAnon(otherToken);
    expect((await call("GET", `/party/${token}`, undefined, { guest: elsewhere.guestToken })).body.role).toBe("visitor");
  });

  it("answers 404 for an unknown link", async () => {
    expect((await call("GET", "/party/notarealtokenatallxxxxxxxx")).status).toBe(404);
    expect((await call("GET", "/party/short")).status).toBe(404);
  });

  it("only shows other guests' allergies to the host", async () => {
    const { party, token } = await makeParty();
    const sam = await joinAnon(token, { allergies: ["Peanuts"] });
    await call("POST", `/party/${token}/join`, { name: "Bob", rsvp: "maybe" }, { user: "bob" });
    const bobView = await call("GET", `/party/${token}`, undefined, { user: "bob" });
    expect(bobView.body.guests.find((g: any) => g.id === sam.guestId).allergies).toEqual([]);
    const hostView = await call("GET", `/parties/${party.id}`, undefined, { user: "alice" });
    expect(hostView.body.guests.find((g: any) => g.id === sam.guestId).allergies).toEqual(["Peanuts"]);
  });
});

describe("dishes", () => {
  it("adds the guest's own recipe to the cookbook and shares it with members, but not someone else's private recipe", async () => {
    const { party, token } = await makeParty();
    await call("POST", `/party/${token}/join`, { name: "Bob", rsvp: "yes" }, { user: "bob" });
    await call("POST", `/party/${token}/join`, { name: "Carol", rsvp: "yes" }, { user: "carol" });

    const theirs = await call("POST", `/party/${token}/dishes`, { course: "dessert", recipeId: "a-pie" }, { user: "bob" });
    expect(theirs.status).toBe(404);

    const mine = await call("POST", `/party/${token}/dishes`, { course: "dessert", recipeId: "b-nuts" }, { user: "bob" });
    expect(mine.status).toBe(201);
    expect(mine.body).toMatchObject({ title: "Peanut Brittle", guestName: "Bob", course: "dessert" });
    expect(ctx.store.cookbooks.get(party.cookbookId)!.recipeIds.has("b-nuts")).toBe(true);
    expect(ctx.store.shares.has("b-nuts:alice")).toBe(true);
    expect(ctx.store.shares.has("b-nuts:carol")).toBe(true);

    // Someone else's public recipe is fine
    expect((await call("POST", `/party/${token}/dishes`, { course: "salad", recipeId: "c-public" }, { user: "bob" })).status).toBe(201);

    // Removing it takes it out of the cookbook
    await call("DELETE", `/party/${token}/dishes/${mine.body.id}`, undefined, { user: "bob" });
    expect(ctx.store.cookbooks.get(party.cookbookId)!.recipeIds.has("b-nuts")).toBe(false);
  });

  it("works out the scale for a dinner and flags conflicts", async () => {
    const { party, token } = await makeParty();
    await joinAnon(token, { name: "Sam", allergies: ["Peanuts"] });
    await call("POST", `/party/${token}/join`, { name: "Bob", rsvp: "yes" }, { user: "bob" });
    const dish = await call("POST", `/party/${token}/dishes`, { course: "dessert", recipeId: "b-nuts" }, { user: "bob" });
    expect(dish.body.scale).toBe(2.5);
    expect(dish.body.makeServings).toBe(10);
    expect(dish.body.conflicts).toEqual([expect.objectContaining({ kind: "allergy", what: "Peanuts", guests: ["Sam"] })]);
    expect(dish.body.recipe).toMatchObject({ id: "b-nuts", servings: 4, status: "ready" });

    // Potluck: as written
    await call("PATCH", `/parties/${party.id}`, { style: "potluck" }, { user: "alice" });
    const after = await call("GET", `/party/${token}`, undefined, { user: "bob" });
    expect(after.body.dishes[0]).toMatchObject({ scale: 1, makeServings: 4 });
  });

  it("keeps a slot for whoever picked it first and moves dishes when courses change", async () => {
    const { party, token } = await makeParty({ slots: [{ course: "main" }, { course: "dessert" }] });
    const sam = await joinAnon(token);
    const [main, dessert] = party.slots;
    const first = await call("POST", `/party/${token}/dishes`, { slotId: main.id, course: "drink", title: "Roast chicken" }, { guest: sam.guestToken });
    expect(first.body).toMatchObject({ slotId: main.id, course: "main", title: "Roast chicken" });
    await call("POST", `/party/${token}/join`, { name: "Bob", rsvp: "yes" }, { user: "bob" });
    const second = await call("POST", `/party/${token}/dishes`, { slotId: main.id, course: "main", title: "Lasagna" }, { user: "bob" });
    expect(second.status).toBe(409);

    const put = await call("PUT", `/parties/${party.id}/slots`, { slots: [{ id: dessert.id, course: "dessert" }, { course: "side", label: "Something green" }] }, { user: "alice" });
    expect(put.status).toBe(200);
    expect(put.body.slots.map((s: any) => s.course)).toEqual(["dessert", "side"]);
    expect(put.body.dishes[0]).toMatchObject({ slotId: null, course: "main" });
  });

  it("caps dishes per guest", async () => {
    const { token } = await makeParty({ slots: [] });
    const sam = await joinAnon(token);
    for (let i = 0; i < MAX_DISHES_PER_GUEST; i++) {
      const res = await call("POST", `/party/${token}/dishes`, { course: "other", title: `Thing ${i}` }, { guest: sam.guestToken });
      expect(res.status).toBe(201);
    }
    const over = await call("POST", `/party/${token}/dishes`, { course: "other", title: "One more" }, { guest: sam.guestToken });
    expect(over.status).toBe(409);
    const imported = await call("POST", `/party/${token}/dishes/import-text`, { course: "other", text: "x".repeat(40) }, { guest: sam.guestToken });
    expect(imported.status).toBe(409);
    expect(ctx.imports).toHaveLength(0);
  });

  it("lets only the cook or the host change a dish", async () => {
    const { token } = await makeParty();
    const sam = await joinAnon(token);
    const pat = await joinAnon(token, { name: "Pat" });
    const dish = await call("POST", `/party/${token}/dishes`, { course: "drink", title: "Wine" }, { guest: sam.guestToken });
    expect((await call("PATCH", `/party/${token}/dishes/${dish.body.id}`, { title: "Beer" }, { guest: pat.guestToken })).status).toBe(403);
    expect((await call("DELETE", `/party/${token}/dishes/${dish.body.id}`, undefined, { guest: pat.guestToken })).status).toBe(403);
    const edit = await call("PATCH", `/party/${token}/dishes/${dish.body.id}`, { note: "Red and white" }, { guest: sam.guestToken });
    expect(edit.body).toMatchObject({ title: "Wine", note: "Red and white" });
    expect((await call("PATCH", `/party/${token}/dishes/${dish.body.id}`, { title: "Cider" }, { user: "alice" })).body.title).toBe("Cider");
  });

  it("opens a dish's recipe for anyone with the link, even signed out", async () => {
    const { token } = await makeParty();
    await call("POST", `/party/${token}/join`, { name: "Bob", rsvp: "yes" }, { user: "bob" });
    const dish = await call("POST", `/party/${token}/dishes`, { course: "dessert", recipeId: "b-nuts" }, { user: "bob" });
    const recipe = await call("GET", `/party/${token}/dishes/${dish.body.id}/recipe`);
    expect(recipe.status).toBe(200);
    expect(recipe.body).toMatchObject({ id: "b-nuts", title: "Peanut Brittle", instructions: ["Mix", "Bake"] });
    const noRecipe = await call("POST", `/party/${token}/dishes`, { course: "drink", title: "Wine" }, { user: "bob" });
    expect((await call("GET", `/party/${token}/dishes/${noRecipe.body.id}/recipe`)).status).toBe(404);
  });
});

describe("guest imports and credits", () => {
  it("imports as the guest's own private recipe and charges their guest credits", async () => {
    const { token } = await makeParty();
    const sam = await joinAnon(token);
    const res = await call("POST", `/party/${token}/dishes/import-link`, { course: "dessert", url: "https://example.com/cake" }, { guest: sam.guestToken });
    expect(res.status).toBe(201);
    expect(res.body.recipe).toMatchObject({ title: "Imported Cake", status: "enriching" });
    expect(res.body.title).toBe("Imported Cake");
    expect(ctx.imports[0].opts.isPublic).toBe(false);
    const guestUser = ctx.imports[0].userId;
    expect(ctx.store.recipes.get(res.body.recipe.id)).toMatchObject({ ownerUserId: guestUser, isPublic: false });
    expect(await credits()!.balance(guestUser)).toBe(GUEST_CREDITS - 1);
  });

  it("stops a guest at zero credits even with the credits switch off", async () => {
    const { token } = await makeParty();
    const sam = await joinAnon(token);
    const guestUser = Array.from(ctx.store.guests.values()).find((g) => g.id === sam.guestId)!.userId;
    await credits()!.balance(guestUser);
    ctx.creditStore.balances.get(guestUser)!.balance = 0;
    const res = await call("POST", `/party/${token}/dishes/import-text`, { course: "main", text: "Grandma's pot roast with carrots and onions" }, { guest: sam.guestToken });
    expect(res.status).toBe(402);
    expect(res.body.code).toBe("needs_credits");
    expect(ctx.imports).toHaveLength(0);
  });

  it("doesn't limit a signed-in account's imports when credits are off", async () => {
    const { token } = await makeParty();
    await call("POST", `/party/${token}/join`, { name: "Bob", rsvp: "yes" }, { user: "bob" });
    await credits()!.balance("bob");
    ctx.creditStore.balances.get("bob")!.balance = 0;
    const res = await call("POST", `/party/${token}/dishes/import-link`, { course: "main", url: "https://example.com/roast" }, { user: "bob" });
    expect(res.status).toBe(201);
    // Account holders' imports follow their own visibility setting (public by default)
    expect(ctx.imports[0].opts.isPublic).toBe(true);
  });
});

describe("claiming a guest place", () => {
  it("moves the guest's recipes and dishes to the account, merging into its place", async () => {
    const { party, token } = await makeParty();
    const sam = await joinAnon(token, { name: "Sam" });
    const imported = await call("POST", `/party/${token}/dishes/import-link`, { course: "dessert", url: "https://example.com/cake" }, { guest: sam.guestToken });
    const guestUser = ctx.imports[0].userId;
    // The same guest joined another party too
    const other = await call("POST", "/parties", { title: "Brunch", style: "potluck", headcount: 6 }, { user: "bob" });
    const otherToken = String(other.body.inviteUrl).split("/p/")[1];
    const otherPlace = (await call("POST", `/party/${otherToken}/join`, { name: "Sam", rsvp: "yes" }, { guest: sam.guestToken })).body;
    expect(otherPlace.guestId).toBe(Array.from(ctx.store.guests.values()).find((g) => g.partyId === other.body.id && g.userId === guestUser)?.id);

    // Carol already joined the first party with her account
    const carolPlace = (await call("POST", `/party/${token}/join`, { name: "Carol", rsvp: "yes" }, { user: "carol" })).body;
    expect((await call("POST", `/party/${token}/claim`, undefined, { guest: sam.guestToken })).status).toBe(401);
    const claim = await call("POST", `/party/${token}/claim`, undefined, { user: "carol", guest: sam.guestToken });
    expect(claim.status).toBe(200);
    expect(claim.body.guestId).toBe(carolPlace.guestId);

    expect(ctx.store.recipes.get(imported.body.recipe.id)!.ownerUserId).toBe("carol");
    expect(ctx.store.guests.has(sam.guestId)).toBe(false);
    expect(ctx.store.dishes.get(imported.body.id)!.guestId).toBe(carolPlace.guestId);
    // The other party's place is now Carol's
    expect(ctx.store.guests.get(otherPlace.guestId)).toMatchObject({ userId: "carol", guestTokenHash: null });
    // The host can still open the (private) recipe
    expect(ctx.store.shares.has(`${imported.body.recipe.id}:alice`)).toBe(true);
    const view = await call("GET", `/parties/${party.id}`, undefined, { user: "carol" });
    expect(view.body.dishes[0].guestName).toBe("Carol");
  });

  it("refuses without a guest place on this device", async () => {
    const { token } = await makeParty();
    expect((await call("POST", `/party/${token}/claim`, undefined, { user: "carol" })).status).toBe(400);
  });
});

describe("host-only actions", () => {
  it("keeps guests out of the host's controls", async () => {
    const { party, token } = await makeParty();
    const sam = await joinAnon(token);
    await call("POST", `/party/${token}/join`, { name: "Bob", rsvp: "yes" }, { user: "bob" });
    const dish = await call("POST", `/party/${token}/dishes`, { course: "drink", title: "Wine" }, { guest: sam.guestToken });

    expect((await call("GET", `/parties/${party.id}`, undefined, { user: "bob" })).body.role).toBe("guest");
    for (const [method, path, body] of [
      ["PATCH", `/parties/${party.id}`, { title: "Mine now" }],
      ["DELETE", `/parties/${party.id}`, undefined],
      ["PUT", `/parties/${party.id}/slots`, { slots: [] }],
      ["POST", `/parties/${party.id}/invite/rotate`, {}],
      ["DELETE", `/parties/${party.id}/guests/${sam.guestId}`, undefined],
      ["DELETE", `/parties/${party.id}/dishes/${dish.body.id}`, undefined],
    ] as const) {
      expect((await call(method, path, body, { user: "bob" })).status, `${method} ${path}`).toBe(403);
      expect((await call(method, path, body, { user: "carol" })).status, `${method} ${path} (stranger)`).toBe(404);
      expect((await call(method, path, body, { guest: sam.guestToken })).status, `${method} ${path} (anonymous)`).toBe(401);
    }
    expect(ctx.store.parties.get(party.id)!.title).toBe("Fall Feast");

    // The host can remove a guest and their dishes
    expect((await call("DELETE", `/parties/${party.id}/guests/${sam.guestId}`, undefined, { user: "alice" })).status).toBe(204);
    expect(ctx.store.dishes.size).toBe(0);
  });

  it("rotating the invite link stops the old one", async () => {
    const { party, token } = await makeParty();
    const rotated = await call("POST", `/parties/${party.id}/invite/rotate`, {}, { user: "alice" });
    const fresh = String(rotated.body.inviteUrl).split("/p/")[1];
    expect(fresh).not.toBe(token);
    expect((await call("GET", `/party/${token}`)).status).toBe(404);
    expect((await call("GET", `/party/${fresh}`)).status).toBe(200);
  });

  it("cancelling hides the party", async () => {
    const { party, token } = await makeParty();
    expect((await call("DELETE", `/parties/${party.id}`, undefined, { user: "alice" })).status).toBe(204);
    expect((await call("GET", `/party/${token}`)).status).toBe(410);
    expect((await call("GET", "/parties", undefined, { user: "alice" })).body).toEqual([]);
  });
});

describe("the party cookbook", () => {
  it("is added to a member's cookbooks", async () => {
    const { party, token } = await makeParty();
    await call("POST", `/party/${token}/join`, { name: "Bob", rsvp: "yes" }, { user: "bob" });
    expect((await call("POST", `/party/${token}/save-cookbook`, undefined, { user: "carol" })).status).toBe(403);
    const saved = await call("POST", `/party/${token}/save-cookbook`, undefined, { user: "bob" });
    expect(saved.body).toEqual({ cookbookId: party.cookbookId });
    expect(ctx.store.cookbooks.get(party.cookbookId)!.members.has("bob")).toBe(true);
    // Signed-in members also see the party on their list
    expect((await call("GET", "/parties", undefined, { user: "bob" })).body[0]).toMatchObject({ id: party.id, role: "guest" });
  });
});
