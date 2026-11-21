import { afterEach, beforeEach, describe, expect, it } from "vitest";
import express, { Router } from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createGuestRouter } from "./guest";
import { createPartyRouter } from "./parties";
import { createGuestAccess, importOptionsFor, type GuestAccess } from "../guests/access";
import { MemoryGuestStore } from "../guests/testing/fakes";
import { MemoryPartyStore } from "../parties/testing/fakes";
import { MemoryCreditStore } from "../lib/credits-memory";
import { charge, createCredits, credits, gate, jobRefs, setCredits } from "../lib/credits";
import { GUEST_IP_LIMIT_CODE, GUEST_LIMIT_CODE, GUEST_TOKEN_HEADER, GUEST_UNAVAILABLE_CODE, guestLimitMessage } from "@shared/guest";
import { GUEST_HEADER as PARTY_GUEST_HEADER } from "@shared/party";

// The guest routes, plus stand-ins for the add routes in routes/recipes.ts
// behind the same guards (access.addRecipe), and the party router wired the
// way parties/wiring.ts does it.

interface Ctx {
  base: string;
  server: Server;
  parties: MemoryPartyStore;
  guests: MemoryGuestStore;
  access: GuestAccess;
  /** ms each fake import takes */
  importDelay: number;
}

let ctx: Ctx;

async function setup(opts: { startsPerIpPerDay?: number; limit?: number } = {}): Promise<Ctx> {
  const parties = new MemoryPartyStore();
  parties.addUser("alice", "Alice");
  parties.addUser("carol", "Carol");
  const guests = new MemoryGuestStore(parties);

  const creditStore = new MemoryCreditStore();
  creditStore.isGuest = async (id: string) => parties.users.get(id)?.isGuest ?? false;
  setCredits(createCredits(creditStore, { enforced: () => false, log: { warn: () => {}, error: () => {} } }));

  const auth = (req: any, res: any, next: any) => {
    const user = req.header("x-user");
    if (!user) return res.status(401).json({ message: "Unauthorized - not authenticated", code: "NOT_AUTHENTICATED" });
    req.user = { claims: { sub: user } };
    next();
  };
  const optionalAuth = (req: any, _res: any, next: any) => {
    const user = req.header("x-user");
    if (user) req.user = { claims: { sub: user } };
    next();
  };
  const userIdOf = (req: any) => req.user?.claims?.sub;

  const access = createGuestAccess({
    store: guests,
    parties,
    auth,
    optionalAuth,
    userIdOf,
    recipeLimit: () => opts.limit ?? 5,
    startsPerIpPerDay: () => opts.startsPerIpPerDay ?? 10,
    ipSalt: "test",
    log: { warn: () => {}, error: () => {} },
  });

  let n = 0;
  const c: Partial<Ctx> = { importDelay: 0 };
  const fakeImport = async (userId: string, isPublic: boolean) => {
    if (c.importDelay) await new Promise((r) => setTimeout(r, c.importDelay));
    const id = `r-${++n}`;
    parties.addRecipe({ id, ownerUserId: userId, isPublic, title: "Imported", status: "enriching" });
    await charge(userId, "recipe_import", jobRefs.recipeImport(id));
    return id;
  };

  // Like routes/recipes.ts: photo, link, text and typed-in recipes
  const recipes = Router();
  for (const path of ["/recipes/upload", "/recipes/extract-url", "/recipes/extract-text", "/recipes/import-social"]) {
    recipes.post(path, ...access.addRecipe, async (req: any, res) => {
      const userId = userIdOf(req);
      if (!(await gate(res, userId, "recipe_import"))) return;
      const recipeId = await fakeImport(userId, importOptionsFor(req).isPublic ?? true);
      res.status(201).json({ recipeId });
    });
  }
  recipes.post("/recipes", ...access.addRecipe, async (req: any, res) => {
    const id = `m-${++n}`;
    parties.addRecipe({ id, ownerUserId: userIdOf(req), isPublic: importOptionsFor(req).isPublic ?? true, title: req.body.title ?? "Typed" });
    res.status(201).json({ id });
  });
  recipes.get("/recipes", access.optionalAccountOrGuest, (req: any, res) => {
    const userId = userIdOf(req);
    const list = Array.from(parties.recipes.values()).filter((r) => (req.query.scope === "my" ? r.ownerUserId === userId : r.isPublic));
    res.json({ recipes: list, total: list.length });
  });

  const app = express();
  app.use(express.json());
  app.use("/api", createGuestRouter(access));
  app.use("/api", recipes);
  app.use("/api", createPartyRouter({
    store: parties,
    auth,
    optionalAuth,
    userIdOf,
    importer: {
      link: async (_url, userId, o) => ({ status: 201, body: { recipeId: await fakeImport(userId, o.isPublic ?? true) } }),
      text: async (_text, userId, o) => ({ status: 201, body: { recipeId: await fakeImport(userId, o.isPublic ?? true) } }),
      photo: async (_file, userId, o) => ({ status: 201, body: { recipeId: await fakeImport(userId, o.isPublic ?? true) } }),
    },
    credits: {
      gate: (res, userId) => gate(res, userId, "recipe_import"),
      balance: async (userId) => (await credits()?.balance(userId)) ?? null,
    },
    preview: async () => ({ site: "other", title: null, image: null }),
    publicOrigin: "https://grammie.test",
    appGuestUserOf: (req) => access.guestUserOf(req),
    onGuestClaimed: (id) => access.forget(id),
  }));
  const server = await new Promise<Server>((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  return Object.assign(c, { base, server, parties, guests, access }) as Ctx;
}

async function call(method: string, path: string, body?: unknown, opts: { user?: string; guest?: string; partyGuest?: string } = {}) {
  const res = await fetch(`${ctx.base}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(opts.user ? { "x-user": opts.user } : {}),
      ...(opts.guest ? { [GUEST_TOKEN_HEADER]: opts.guest } : {}),
      ...(opts.partyGuest ? { [PARTY_GUEST_HEADER]: opts.partyGuest } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

async function start(opts: { partyGuest?: string; guest?: string } = {}): Promise<string> {
  const res = await call("POST", "/guest/start", undefined, opts);
  expect([200, 201]).toContain(res.status);
  return res.body.guestToken as string;
}

/** One add of each kind, round and round */
const ADDS: Array<[string, Record<string, unknown>]> = [
  ["/recipes/upload", {}],
  ["/recipes/extract-url", { url: "https://example.com/cake" }],
  ["/recipes/extract-text", { text: "Grandma's pot roast with carrots and onions" }],
  ["/recipes", { title: "Typed-in pie" }],
  ["/recipes/import-social", { url: "https://www.instagram.com/p/abc/" }],
];
const add = (i: number, guest: string) => call("POST", ADDS[i % ADDS.length][0], ADDS[i % ADDS.length][1], { guest });

const ownedBy = (userId: string) => Array.from(ctx.parties.recipes.values()).filter((r) => r.ownerUserId === userId);

afterEach(async () => {
  setCredits(null);
  await new Promise((r) => ctx.server.close(r));
});

describe("adding recipes without an account", () => {
  beforeEach(async () => { ctx = await setup(); });

  it("starts a guest user for the device and reuses the same token after that", async () => {
    const first = await call("POST", "/guest/start");
    expect(first.status).toBe(201);
    expect(first.body.guestToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(first.body.limit).toBe(5);
    const guestId = await ctx.access.guestUserOf({ header: (h: string) => (h === GUEST_TOKEN_HEADER ? first.body.guestToken : undefined) });
    expect(guestId).toBeTruthy();
    expect(ctx.parties.users.get(guestId!)).toMatchObject({ isGuest: true, defaultRecipeVisibility: "private" });
    // Only the hash is kept
    expect(Array.from(ctx.guests.tokens.keys())).not.toContain(first.body.guestToken);

    const again = await call("POST", "/guest/start", undefined, { guest: first.body.guestToken });
    expect(again.status).toBe(200);
    expect(again.body.guestToken).toBe(first.body.guestToken);
    expect(ctx.guests.tokens.size).toBe(1);
    expect(Array.from(ctx.parties.users.values()).filter((u) => u.isGuest)).toHaveLength(1);
  });

  it("gives signed-in people no guest token", async () => {
    const res = await call("POST", "/guest/start", undefined, { user: "alice" });
    expect(res.body).toMatchObject({ guestToken: null, signedIn: true });
    expect(ctx.guests.tokens.size).toBe(0);
  });

  it("lets a guest add 5 recipes of any kind, privately, then asks them to make an account", async () => {
    const token = await start();
    for (let i = 0; i < 5; i++) {
      const res = await add(i, token);
      expect(res.status, `add ${i + 1} (${ADDS[i][0]})`).toBe(201);
    }
    const guestId = (await ctx.access.guestUserOf({ header: () => token }))!;
    expect(ownedBy(guestId)).toHaveLength(5);
    expect(ownedBy(guestId).every((r) => r.isPublic === false)).toBe(true);
    expect(await call("GET", "/guest/me", undefined, { guest: token })).toMatchObject({ body: { isGuest: true, recipeCount: 5, limit: 5 } });

    for (let i = 0; i < ADDS.length; i++) {
      const sixth = await add(i, token);
      expect(sixth.status, `6th via ${ADDS[i][0]}`).toBe(403);
      expect(sixth.body).toEqual({ code: GUEST_LIMIT_CODE, limit: 5, error: guestLimitMessage(5) });
    }
    expect(guestLimitMessage(5)).toBe("You've added 5 recipes. Make a free account to keep going — your 5 recipes come with you.");
    expect(ownedBy(guestId)).toHaveLength(5);
  });

  it("holds the limit when several adds arrive at once", async () => {
    ctx.importDelay = 30;
    const token = await start();
    const results = await Promise.all(Array.from({ length: 8 }, (_, i) => add(i, token)));
    expect(results.filter((r) => r.status === 201)).toHaveLength(5);
    expect(results.filter((r) => r.status === 403)).toHaveLength(3);
  });

  it("shows a guest their own recipes", async () => {
    const token = await start();
    await add(0, token);
    await add(1, token);
    const mine = await call("GET", "/recipes?scope=my", undefined, { guest: token });
    expect(mine.body.total).toBe(2);
    const someoneElse = await call("GET", "/recipes?scope=my", undefined, { guest: await start() });
    expect(someoneElse.body.total).toBe(0);
  });

  it("still needs an account or a guest token to add", async () => {
    expect((await add(0, "")).status).toBe(401);
    expect((await add(0, "x".repeat(43))).status).toBe(401);
  });

  it("lets a signed-in account win over a guest token, with no guest limit", async () => {
    const token = await start();
    for (let i = 0; i < 7; i++) {
      const res = await call("POST", "/recipes/extract-text", { text: "Some long enough recipe text here" }, { user: "alice", guest: token });
      expect(res.status).toBe(201);
    }
    expect(ownedBy("alice")).toHaveLength(7);
    expect(ownedBy("alice").every((r) => r.isPublic)).toBe(true);
  });
});

describe("the claim on sign-up", () => {
  beforeEach(async () => { ctx = await setup(); });

  it("moves the guest's recipes to the new account and ends the guest token", async () => {
    const token = await start();
    for (let i = 0; i < 5; i++) await add(i, token);
    const guestId = (await ctx.access.guestUserOf({ header: () => token }))!;

    expect((await call("POST", "/guest/claim", undefined, { guest: token })).status).toBe(401);

    const claim = await call("POST", "/guest/claim", undefined, { user: "carol", guest: token });
    expect(claim.status).toBe(200);
    expect(claim.body).toEqual({ claimed: true, moved: 5 });
    expect(ownedBy("carol")).toHaveLength(5);
    expect(ownedBy(guestId)).toHaveLength(0);
    expect(ctx.guests.tokens.size).toBe(0);

    // The old token is done: no guest behind it, can't add, nothing more to claim
    expect((await call("GET", "/guest/me", undefined, { guest: token })).body.isGuest).toBe(false);
    expect((await add(0, token)).status).toBe(401);
    expect((await call("POST", "/guest/claim", undefined, { user: "carol", guest: token })).body).toEqual({ claimed: false, moved: 0 });
    // Signed in, carol isn't held to the guest limit
    expect((await call("POST", "/recipes", { title: "Sixth" }, { user: "carol" })).status).toBe(201);
  });

  it("does nothing for a signed-in person without a guest token", async () => {
    expect((await call("POST", "/guest/claim", undefined, { user: "carol" })).body).toEqual({ claimed: false, moved: 0 });
  });
});

describe("abuse limits", () => {
  it("caps new guests from one address a day, while existing tokens keep working", async () => {
    ctx = await setup({ startsPerIpPerDay: 3 });
    const tokens = [await start(), await start(), await start()];
    const fourth = await call("POST", "/guest/start");
    expect(fourth.status).toBe(429);
    expect(fourth.body.code).toBe(GUEST_IP_LIMIT_CODE);
    expect(fourth.body.error).toMatch(/free account/);
    expect(Array.from(ctx.parties.users.values()).filter((u) => u.isGuest)).toHaveLength(3);
    // A device that already has a guest is unaffected
    expect((await call("POST", "/guest/start", undefined, { guest: tokens[0] })).body.guestToken).toBe(tokens[0]);
    expect((await add(0, tokens[1])).status).toBe(201);
  });

  it("is off, with a sign-in answer, until the migration has run", async () => {
    ctx = await setup();
    const token = await start();
    ctx.guests.missingTable = true;
    const res = await call("POST", "/guest/start");
    expect(res.status).toBe(503);
    expect(res.body.code).toBe(GUEST_UNAVAILABLE_CODE);
    expect(Array.from(ctx.parties.users.values()).filter((u) => u.isGuest)).toHaveLength(1);
    expect((await add(0, token)).status).toBe(401);
  });
});

describe("party guests who also add recipes", () => {
  beforeEach(async () => { ctx = await setup(); });

  async function partyToken() {
    const res = await call("POST", "/parties", { title: "Fall Feast", style: "potluck", headcount: 10 }, { user: "alice" });
    expect(res.status).toBe(201);
    return String(res.body.inviteUrl).split("/p/")[1];
  }

  it("keep one guest user, and party dishes don't use up the 5", async () => {
    const invite = await partyToken();
    const joined = await call("POST", `/party/${invite}/join`, { name: "Sam", rsvp: "yes" });
    expect(joined.status).toBe(201);
    const partyGuest = joined.body.guestToken as string;
    for (let i = 0; i < 3; i++) {
      const dish = await call("POST", `/party/${invite}/dishes/import-text`, { course: "other", text: "x".repeat(40) }, { partyGuest });
      expect(dish.status).toBe(201);
    }

    const token = await start({ partyGuest });
    const placeUser = Array.from(ctx.parties.guests.values()).find((g) => g.name === "Sam")!.userId;
    expect(await ctx.access.guestUserOf({ header: () => token })).toBe(placeUser);

    for (let i = 0; i < 5; i++) expect((await add(i, token)).status).toBe(201);
    expect((await add(0, token)).status).toBe(403);
    // The party allowance is its own
    const more = await call("POST", `/party/${invite}/dishes/import-text`, { course: "other", text: "y".repeat(40) }, { partyGuest });
    expect(more.status).toBe(201);
    expect(ownedBy(placeUser)).toHaveLength(9);
  });

  it("joining a party reuses the guest user from adding recipes, and a party claim ends the guest token", async () => {
    const token = await start();
    await add(0, token);
    const guestId = (await ctx.access.guestUserOf({ header: () => token }))!;
    const invite = await partyToken();
    const joined = await call("POST", `/party/${invite}/join`, { name: "Sam", rsvp: "yes" }, { guest: token });
    expect(joined.status).toBe(201);
    expect(ctx.parties.guests.get(joined.body.guestId)!.userId).toBe(guestId);

    const claim = await call("POST", `/party/${invite}/claim`, undefined, { user: "carol", partyGuest: joined.body.guestToken });
    expect(claim.status).toBe(200);
    expect(ownedBy("carol")).toHaveLength(1);
    expect(ctx.guests.tokens.size).toBe(0);
    expect((await call("GET", "/guest/me", undefined, { guest: token })).body.isGuest).toBe(false);
  });
});
