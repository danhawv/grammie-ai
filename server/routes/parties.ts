// Dinner parties and potlucks API, mounted at /api. Shapes and rules are in
// shared/party.ts.
//
//   /parties/*       the host's and signed-in members' screens (signed in)
//   /party/:token/*  the invite link: works signed out. The unguessable
//                    token is the key; an anonymous guest who joined also
//                    sends their own guest token in the X-Party-Guest header.
//
// Anonymous guests get a "guest user" (users.is_guest), so their imports and
// credits work like anyone's. Their recipes are private; party members with
// an account get viewer shares (recipe_shares) so the party's recipes open on
// /recipe/:id, and signed-out guests read them through
// GET /party/:token/dishes/:dishId/recipe. The party cookbook (owned by the
// host, private) follows the dishes: adding a dish with a recipe adds it,
// removing the last dish with that recipe takes it out.

import crypto from "node:crypto";
import { Router, type RequestHandler, type Response } from "express";
import multer from "multer";
import { z } from "zod";
import {
  ALLERGENS, COURSES, GUEST_HEADER, MAX_DISHES_PER_GUEST, MAX_GUESTS, MAX_SLOTS, PARTY_DIETS, defaultSlots,
  type InvitePreview, type PartyCourse, type PartyDetail,
} from "@shared/party";
import type { PartyGuestRow, PartyRow, PartyStore, SlotInput } from "../parties/store";
import { sortSummaries, toPartyDetail, toSummary } from "../parties/views";
import { createRateLimiter, limit } from "../meal-prep/limits";
import { hashShareToken, looksLikeShareToken, newShareToken } from "../meal-prep/share";
import type { ImportOptions, ImportResult } from "../lib/recipe-importers";

export interface PartyImporter {
  link(url: string, userId: string, opts: ImportOptions): Promise<ImportResult>;
  text(text: string, userId: string, opts: ImportOptions): Promise<ImportResult>;
  photo(file: { buffer: Buffer; mimetype: string; originalname?: string }, userId: string, opts: ImportOptions): Promise<ImportResult>;
}

export interface PartyRouterDeps {
  store: PartyStore;
  /** isAuthenticated in production */
  auth: RequestHandler;
  /** optionalAuth in production */
  optionalAuth: RequestHandler;
  /** getUserId in production */
  userIdOf: (req: any) => string | undefined;
  importer: PartyImporter;
  credits: {
    /** false (with the 402 answer sent) when the user can't afford an import */
    gate(res: Response, userId: string): Promise<boolean>;
    balance(userId: string): Promise<number | null>;
  };
  preview(url: string): Promise<InvitePreview>;
  /** Where invite links point, e.g. https://grammie.ai */
  publicOrigin?: string;
  now?: () => Date;
}

const MINUTE = 60_000;

/** Per-address limits against abuse: short bursts only, never daily caps */
export function partyLimiters() {
  return {
    /** any invite-link request, so tokens can't be tried in bulk */
    linkIp: createRateLimiter(300, MINUTE),
    /** joining as a new anonymous guest */
    joinIp: createRateLimiter(30, 5 * MINUTE),
    /** recipe imports (each one runs the model) */
    importIp: createRateLimiter(20, MINUTE),
    /** the host screens, per user */
    hostUser: createRateLimiter(120, MINUTE),
    preview: createRateLimiter(20, MINUTE),
  };
}

const LINK_BROKEN = "This invite link doesn't work. Ask the host for a new one.";
const NOT_FOUND = "We couldn't find that party.";

class PartyProblem extends Error {
  constructor(message: string, public status: number) { super(message); }
}

// ---------------------------------------------------------------- validation

const course = z.enum(COURSES.map((c) => c.id) as [PartyCourse, ...PartyCourse[]], {
  errorMap: () => ({ message: "Choose a course" }),
});
const text = (max: number) => z.string().trim().max(max, `Keep it under ${max} characters`);
const optText = (max: number) => text(max).nullish().transform((v) => (v ? v : null));
const httpUrl = z.string().trim().max(2000).refine((v) => {
  try { const u = new URL(v); return u.protocol === "https:" || u.protocol === "http:"; } catch { return false; }
}, "That doesn't look like a link. Copy the whole link and paste it again.");
const startsAt = z.string().nullish().refine((v) => !v || !Number.isNaN(Date.parse(v)), "That date doesn't look right")
  .transform((v) => (v ? new Date(v) : null));
const slotList = z.array(z.object({
  id: z.string().max(64).optional(),
  course,
  label: optText(80).optional(),
})).max(MAX_SLOTS, `A party can have up to ${MAX_SLOTS} courses`);

const createSchema = z.object({
  title: text(120).min(1, "Give the party a name"),
  style: z.enum(["dinner", "potluck"]),
  startsAt: startsAt.optional(),
  location: optText(200).optional(),
  theme: optText(200).optional(),
  hostNote: optText(2000).optional(),
  headcount: z.coerce.number().int().min(1, "At least 1 person").max(500, "Up to 500 people"),
  slots: slotList.optional(),
  externalInviteUrl: httpUrl.nullish(),
});

const updateSchema = createSchema.omit({ slots: true }).partial();

const joinSchema = z.object({
  name: text(60).min(1, "Add your name"),
  rsvp: z.enum(["yes", "maybe", "no"]),
  partySize: z.coerce.number().int().min(1).max(20).optional(),
  allergies: z.array(z.enum(ALLERGENS)).max(ALLERGENS.length).optional(),
  diets: z.array(z.enum(PARTY_DIETS.map((d) => d.id) as [string, ...string[]])).max(PARTY_DIETS.length).optional(),
  dietNote: optText(300).optional(),
});

const placeSchema = z.object({ slotId: z.string().max(64).nullish(), course });
const addDishSchema = placeSchema.extend({
  recipeId: z.string().max(64).optional(),
  title: text(120).optional(),
  note: optText(300).optional(),
});
const patchDishSchema = z.object({
  slotId: z.string().max(64).nullish(),
  course: course.optional(),
  title: text(120).optional(),
  note: optText(300).optional(),
});

function firstIssue(err: z.ZodError): string {
  return err.issues[0]?.message ?? "Something in that form isn't right.";
}

// ---------------------------------------------------------------- router

export function createPartyRouter(deps: PartyRouterDeps): Router {
  const router = Router();
  const { store } = deps;
  const now = deps.now ?? (() => new Date());
  const origin = (deps.publicOrigin ?? process.env.PUBLIC_ORIGIN ?? process.env.VITE_PUBLIC_ORIGIN ?? "https://grammie.ai").replace(/\/$/, "");
  const limits = partyLimiters();
  const ip = (req: any) => String(req.ip ?? req.socket?.remoteAddress ?? "unknown");
  const me = (req: any) => deps.userIdOf(req) ?? null;
  const inviteUrl = (party: PartyRow) => `${origin}/p/${party.inviteToken}`;
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024, files: 1 } });

  const fail = (res: Response, err: unknown, what: string) => {
    if (err instanceof PartyProblem) return res.status(err.status).json({ error: err.message });
    if (err instanceof z.ZodError) return res.status(400).json({ error: firstIssue(err) });
    console.error(`[Parties] ${what}:`, err);
    return res.status(500).json({ error: `Something went wrong ${what}. Please try again.` });
  };

  // ------------------------------------------------------------ shared work

  async function detailFor(party: PartyRow, role: PartyDetail["role"], viewer: PartyGuestRow | null): Promise<PartyDetail> {
    const [slots, guests, dishes] = await Promise.all([store.listSlots(party.id), store.listGuests(party.id), store.listDishes(party.id)]);
    const recipeIds = Array.from(new Set(dishes.map((d) => d.recipeId).filter((id): id is string => !!id)));
    const [facts, users] = await Promise.all([store.recipeFacts(recipeIds), store.getUsers(Array.from(new Set(guests.map((g) => g.userId))))]);
    const viewerUser = viewer ? users.find((u) => u.id === viewer.userId) : undefined;
    const credits = viewerUser?.isGuest ? await deps.credits.balance(viewerUser.id).catch(() => null) : null;
    return toPartyDetail({
      party, slots, guests, dishes, facts, users, role,
      viewerGuestId: viewer?.id ?? null,
      inviteUrl: inviteUrl(party),
      credits,
    });
  }

  /** Account holders in the party get viewer shares on its private recipes */
  async function syncShares(partyId: string) {
    const [guests, dishes] = await Promise.all([store.listGuests(partyId), store.listDishes(partyId)]);
    const recipeIds = Array.from(new Set(dishes.map((d) => d.recipeId).filter((id): id is string => !!id)));
    if (recipeIds.length === 0) return;
    const users = await store.getUsers(guests.map((g) => g.userId));
    await store.shareRecipes(recipeIds, users.filter((u) => !u.isGuest).map((u) => u.id));
  }

  /** After a dish with a recipe is added: party cookbook and shares */
  async function recipeAdded(party: PartyRow, recipeId: string) {
    if (party.cookbookId) await store.addToCookbook(party.cookbookId, recipeId);
    await syncShares(party.id);
  }

  /** After dishes are removed: take recipes no other dish uses out of the cookbook */
  async function recipesRemoved(party: PartyRow, recipeIds: Array<string | null>) {
    if (!party.cookbookId) return;
    const still = new Set((await store.listDishes(party.id)).map((d) => d.recipeId));
    for (const id of Array.from(new Set(recipeIds))) {
      if (id && !still.has(id)) await store.removeFromCookbook(party.cookbookId, id);
    }
  }

  /** Best effort: the invite page's picture becomes the cover when there isn't one */
  function fillCoverFrom(party: PartyRow) {
    if (!party.externalInviteUrl || party.coverImage) return;
    const url = party.externalInviteUrl;
    void deps.preview(url)
      .then(async (p) => {
        if (!p.image) return;
        const fresh = await store.getParty(party.id);
        if (fresh && !fresh.coverImage && fresh.externalInviteUrl === url) await store.updateParty(party.id, { coverImage: p.image });
      })
      .catch((err) => console.warn("[Parties] Cover from invite page failed:", (err as Error).message));
  }

  /** Where a dish goes: a slot of this party that nobody else has, or just a course */
  async function placement(party: PartyRow, body: { slotId?: string | null; course: PartyCourse }, dishId?: string) {
    if (!body.slotId) return { slotId: null, course: body.course };
    const slot = (await store.listSlots(party.id)).find((s) => s.id === body.slotId);
    if (!slot) throw new PartyProblem("That course isn't on the menu any more. Pick another.", 400);
    const taken = (await store.listDishes(party.id)).some((d) => d.slotId === slot.id && d.id !== dishId);
    if (taken) throw new PartyProblem("Someone already picked that one. Choose another spot.", 409);
    return { slotId: slot.id, course: slot.course };
  }

  async function checkDishLimit(guest: PartyGuestRow) {
    const mine = (await store.listDishes(guest.partyId)).filter((d) => d.guestId === guest.id);
    if (mine.length >= MAX_DISHES_PER_GUEST) {
      throw new PartyProblem(`You're already bringing ${MAX_DISHES_PER_GUEST} dishes. That's plenty!`, 409);
    }
  }

  async function dishResponse(res: Response, party: PartyRow, viewer: PartyGuestRow, dishId: string, status = 200) {
    const detail = await detailFor(party, viewer.isHost ? "host" : "guest", viewer);
    const dish = detail.dishes.find((d) => d.id === dishId);
    if (!dish) return res.status(404).json({ error: "We couldn't find that dish." });
    return res.status(status).json(dish);
  }

  // ------------------------------------------------------------ host & members (/parties)

  const signedIn: RequestHandler[] = [
    deps.auth,
    (req, res, next) => (me(req) ? next() : res.status(401).json({ error: "Please sign in again." })),
    limit(limits.hostUser, me, "That's a lot of requests at once. Wait a minute and try again."),
  ];

  /** The party if the signed-in user hosts it or has joined it; else a 404 sent */
  async function memberParty(req: any, res: Response): Promise<{ party: PartyRow; guest: PartyGuestRow | null; isHost: boolean } | null> {
    const party = await store.getParty(String(req.params.id));
    const userId = me(req)!;
    if (party && party.status === "active") {
      const guest = await store.findGuestByUser(party.id, userId);
      const isHost = party.ownerUserId === userId;
      if (isHost || guest) return { party, guest, isHost };
    }
    res.status(404).json({ error: NOT_FOUND });
    return null;
  }

  async function hostParty(req: any, res: Response) {
    const found = await memberParty(req, res);
    if (!found) return null;
    if (!found.isHost) {
      res.status(403).json({ error: "Only the host can change this." });
      return null;
    }
    return found;
  }

  router.get("/parties", ...signedIn, async (req, res) => {
    try {
      const list = (await store.listPartiesFor(me(req)!)).map(toSummary);
      res.setHeader("Cache-Control", "no-store");
      res.json(sortSummaries(list, now()));
    } catch (err) { fail(res, err, "loading your parties"); }
  });

  router.post("/parties/invite-preview", ...signedIn, limit(limits.preview, me, "Wait a minute before trying another link."), async (req, res) => {
    const url = typeof req.body?.url === "string" ? req.body.url.trim().slice(0, 2000) : "";
    try {
      res.json(await deps.preview(url));
    } catch {
      res.json({ site: "other", title: null, image: null } satisfies InvitePreview);
    }
  });

  router.post("/parties", ...signedIn, async (req, res) => {
    try {
      const body = createSchema.parse(req.body);
      const userId = me(req)!;
      const [user] = await store.getUsers([userId]);
      const slots: SlotInput[] = (body.slots ?? defaultSlots(body.style, body.headcount)).map((s) => ({ course: s.course, label: s.label ?? null }));
      const party = await store.createParty({
        ownerUserId: userId,
        title: body.title,
        style: body.style,
        startsAt: body.startsAt ?? null,
        location: body.location ?? null,
        theme: body.theme ?? null,
        hostNote: body.hostNote ?? null,
        headcount: body.headcount,
        externalInviteUrl: body.externalInviteUrl ?? null,
        coverImage: null,
        inviteToken: crypto.randomBytes(24).toString("base64url"),
      }, slots, { name: user?.firstName?.trim() || "Host" }, { name: body.title, description: `Recipes from ${body.title}` });
      fillCoverFrom(party);
      const host = await store.findGuestByUser(party.id, userId);
      res.status(201).json(await detailFor(party, "host", host));
    } catch (err) { fail(res, err, "making the party"); }
  });

  router.get("/parties/:id", ...signedIn, async (req, res) => {
    try {
      const found = await memberParty(req, res);
      if (!found) return;
      res.setHeader("Cache-Control", "no-store");
      res.json(await detailFor(found.party, found.isHost ? "host" : "guest", found.guest));
    } catch (err) { fail(res, err, "loading the party"); }
  });

  router.patch("/parties/:id", ...signedIn, async (req, res) => {
    try {
      const found = await hostParty(req, res);
      if (!found) return;
      const body = updateSchema.parse(req.body);
      const update: Partial<PartyRow> = {};
      for (const key of ["title", "style", "startsAt", "location", "theme", "hostNote", "headcount", "externalInviteUrl"] as const) {
        if (body[key] !== undefined) (update as any)[key] = body[key];
      }
      const party = (await store.updateParty(found.party.id, update))!;
      if (body.externalInviteUrl && body.externalInviteUrl !== found.party.externalInviteUrl) fillCoverFrom(party);
      res.json(await detailFor(party, "host", found.guest));
    } catch (err) { fail(res, err, "saving the party"); }
  });

  router.delete("/parties/:id", ...signedIn, async (req, res) => {
    try {
      const found = await hostParty(req, res);
      if (!found) return;
      await store.updateParty(found.party.id, { status: "cancelled" });
      res.status(204).end();
    } catch (err) { fail(res, err, "cancelling the party"); }
  });

  router.put("/parties/:id/slots", ...signedIn, async (req, res) => {
    try {
      const found = await hostParty(req, res);
      if (!found) return;
      const body = z.object({ slots: slotList }).parse(req.body);
      await store.replaceSlots(found.party.id, body.slots.map((s) => ({ id: s.id, course: s.course, label: s.label ?? null })));
      res.json(await detailFor(found.party, "host", found.guest));
    } catch (err) { fail(res, err, "saving the courses"); }
  });

  router.post("/parties/:id/invite/rotate", ...signedIn, async (req, res) => {
    try {
      const found = await hostParty(req, res);
      if (!found) return;
      const party = (await store.updateParty(found.party.id, { inviteToken: crypto.randomBytes(24).toString("base64url") }))!;
      res.json({ inviteUrl: inviteUrl(party) });
    } catch (err) { fail(res, err, "making a new link"); }
  });

  router.delete("/parties/:id/guests/:guestId", ...signedIn, async (req, res) => {
    try {
      const found = await hostParty(req, res);
      if (!found) return;
      const guest = (await store.listGuests(found.party.id)).find((g) => g.id === req.params.guestId);
      if (!guest) return res.status(404).json({ error: "We couldn't find that guest." });
      if (guest.isHost) return res.status(400).json({ error: "You can't remove yourself from your own party." });
      const theirs = (await store.listDishes(found.party.id)).filter((d) => d.guestId === guest.id);
      await store.deleteGuest(guest.id);
      await recipesRemoved(found.party, theirs.map((d) => d.recipeId));
      res.status(204).end();
    } catch (err) { fail(res, err, "removing the guest"); }
  });

  router.delete("/parties/:id/dishes/:dishId", ...signedIn, async (req, res) => {
    try {
      const found = await hostParty(req, res);
      if (!found) return;
      const dish = await store.getDish(String(req.params.dishId));
      if (!dish || dish.partyId !== found.party.id) return res.status(404).json({ error: "We couldn't find that dish." });
      await store.deleteDish(dish.id);
      await recipesRemoved(found.party, [dish.recipeId]);
      res.status(204).end();
    } catch (err) { fail(res, err, "removing the dish"); }
  });

  // ------------------------------------------------------------ invite link (/party/:token)

  interface Viewer {
    party: PartyRow;
    /** signed-in account, if any */
    accountId: string | null;
    /** the viewer's place in the party (their account's, else the guest header's) */
    guest: PartyGuestRow | null;
    /** the anonymous guest place named by the X-Party-Guest header */
    headerGuest: PartyGuestRow | null;
    /** a guest token from another party: the same person, so joining reuses their guest user */
    otherPartyGuest: PartyGuestRow | null;
    role: PartyDetail["role"];
  }

  router.use("/party/:token", (req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Referrer-Policy", "no-referrer");
    next();
  }, limit(limits.linkIp, ip, "Too many requests. Wait a minute and try again."), deps.optionalAuth);

  async function viewerOf(req: any, res: Response): Promise<Viewer | null> {
    const token = String(req.params.token ?? "");
    const party = /^[A-Za-z0-9_-]{22,64}$/.test(token) ? await store.getPartyByToken(token) : null;
    if (!party) {
      res.status(404).json({ error: LINK_BROKEN });
      return null;
    }
    if (party.status !== "active") {
      res.status(410).json({ error: "This party was cancelled." });
      return null;
    }
    const accountId = me(req);
    const raw = req.header(GUEST_HEADER);
    let headerGuest: PartyGuestRow | null = null;
    let otherPartyGuest: PartyGuestRow | null = null;
    if (typeof raw === "string" && looksLikeShareToken(raw)) {
      const found = await store.findGuestByTokenHash(hashShareToken(raw));
      if (found && found.partyId === party.id) headerGuest = found;
      else if (found) otherPartyGuest = found;
    }
    const accountGuest = accountId ? await store.findGuestByUser(party.id, accountId) : null;
    const guest = accountGuest ?? headerGuest;
    const role = guest?.isHost || (accountId && accountId === party.ownerUserId) ? "host" : guest ? "guest" : "visitor";
    return { party, accountId, guest, headerGuest, otherPartyGuest, role };
  }

  /** The viewer, who must have joined; else a 403 sent */
  async function joinedViewer(req: any, res: Response): Promise<(Viewer & { guest: PartyGuestRow }) | null> {
    const v = await viewerOf(req, res);
    if (!v) return null;
    if (!v.guest) {
      res.status(403).json({ error: "Join the party first." });
      return null;
    }
    return v as Viewer & { guest: PartyGuestRow };
  }

  /** Own dish, or any dish for the host; else an error sent */
  async function editableDish(v: Viewer & { guest: PartyGuestRow }, dishId: string, res: Response) {
    const dish = await store.getDish(dishId);
    if (!dish || dish.partyId !== v.party.id) {
      res.status(404).json({ error: "We couldn't find that dish." });
      return null;
    }
    if (dish.guestId !== v.guest.id && v.role !== "host") {
      res.status(403).json({ error: "Only the person bringing it (or the host) can change this dish." });
      return null;
    }
    return dish;
  }

  router.get("/party/:token", async (req, res) => {
    try {
      const v = await viewerOf(req, res);
      if (!v) return;
      res.json(await detailFor(v.party, v.role, v.guest));
    } catch (err) { fail(res, err, "loading the party"); }
  });

  router.post("/party/:token/join", async (req, res) => {
    try {
      const v = await viewerOf(req, res);
      if (!v) return;
      const body = joinSchema.parse(req.body);
      const facts = {
        name: body.name,
        rsvp: body.rsvp,
        partySize: body.partySize ?? 1,
        allergies: body.allergies ?? [],
        diets: body.diets ?? [],
        dietNote: body.dietNote ?? null,
      };
      // Already in: joining again just updates the answers
      if (v.guest) {
        await store.updateGuest(v.guest.id, v.guest.isHost ? { ...facts, rsvp: "yes" } : facts);
        return res.json({ guestId: v.guest.id });
      }
      if ((await store.listGuests(v.party.id)).length >= MAX_GUESTS) {
        return res.status(409).json({ error: "This party is full. Ask the host to make room." });
      }
      if (v.accountId) {
        let guest: PartyGuestRow;
        try {
          guest = await store.addGuest({ partyId: v.party.id, userId: v.accountId, ...facts, isHost: false, guestTokenHash: null });
        } catch (err) {
          if ((err as { code?: string })?.code !== "23505") throw err;
          guest = (await store.findGuestByUser(v.party.id, v.accountId))!;
        }
        await syncShares(v.party.id);
        return res.status(201).json({ guestId: guest.id });
      }
      if (!limits.joinIp.hit(ip(req))) {
        return res.status(429).json({ error: "Lots of people joined from here just now. Wait a few minutes and try again." });
      }
      // Someone who is already a guest at another party (the app sends that
      // party's guest token) keeps one guest user: one set of credits, and
      // one claim moves all their places
      const [known] = v.otherPartyGuest ? await store.getUsers([v.otherPartyGuest.userId]) : [];
      const userId = known?.isGuest ? known.id : await store.createGuestUser(body.name);
      const { token, tokenHash } = newShareToken();
      const guest = await store.addGuest({ partyId: v.party.id, userId, ...facts, isHost: false, guestTokenHash: tokenHash });
      res.status(201).json({ guestId: guest.id, guestToken: token });
    } catch (err) { fail(res, err, "joining the party"); }
  });

  router.patch("/party/:token/me", async (req, res) => {
    try {
      const v = await joinedViewer(req, res);
      if (!v) return;
      const body = joinSchema.partial().parse(req.body);
      const update: Parameters<PartyStore["updateGuest"]>[1] = {};
      for (const key of ["name", "rsvp", "partySize", "allergies", "diets", "dietNote"] as const) {
        if (body[key] !== undefined) (update as any)[key] = body[key];
      }
      if (v.guest.isHost) delete update.rsvp;
      await store.updateGuest(v.guest.id, update);
      res.json(await detailFor(v.party, v.role, await store.findGuestByUser(v.party.id, v.guest.userId)));
    } catch (err) { fail(res, err, "saving your answers"); }
  });

  router.post("/party/:token/dishes", async (req, res) => {
    try {
      const v = await joinedViewer(req, res);
      if (!v) return;
      const body = addDishSchema.parse(req.body);
      if (!body.recipeId && !body.title) return res.status(400).json({ error: "Pick a recipe or type what you're bringing." });
      await checkDishLimit(v.guest);
      const place = await placement(v.party, body);
      if (body.recipeId) {
        // Your own recipe, or a public one: never someone else's private recipe
        const [recipe] = await store.recipeFacts([body.recipeId]);
        if (!recipe || (recipe.ownerUserId !== v.guest.userId && !recipe.isPublic)) {
          return res.status(404).json({ error: "We couldn't find that recipe in your recipes." });
        }
      }
      const dish = await store.addDish({
        partyId: v.party.id, guestId: v.guest.id, ...place,
        recipeId: body.recipeId ?? null,
        // Blank = show the recipe's title (it can change while an import finishes)
        title: body.title ?? "",
        note: body.note ?? null,
      });
      if (dish.recipeId) await recipeAdded(v.party, dish.recipeId);
      await dishResponse(res, v.party, v.guest, dish.id, 201);
    } catch (err) { fail(res, err, "adding your dish"); }
  });

  /** The import routes: checks, credits, the import as the guest's user, then the dish */
  async function importDish(req: any, res: Response, run: (userId: string, opts: ImportOptions) => Promise<ImportResult>, body: { slotId?: string | null; course: PartyCourse }) {
    const v = await joinedViewer(req, res);
    if (!v) return;
    await checkDishLimit(v.guest);
    const place = await placement(v.party, body);
    if (!limits.importIp.hit(ip(req))) {
      return res.status(429).json({ error: "That's a lot of recipes at once. Wait a minute and try again." });
    }
    const userId = v.guest.userId;
    if (!(await deps.credits.gate(res, userId))) return;
    const [user] = await store.getUsers([userId]);
    // Guest users' recipes are private; account holders' follow their own setting
    const isPublic = !!user && !user.isGuest && user.defaultRecipeVisibility !== "private";
    let result: ImportResult;
    try {
      result = await run(userId, { isPublic });
    } catch (err) {
      let message = err instanceof Error ? err.message : "We couldn't import that recipe.";
      if (message.includes("Only HTTP and HTTPS")) message = "That link isn't a web page. Paste a link that starts with https://";
      else if (/private|local addresses/i.test(message)) message = "That link points to a private address.";
      return res.status(400).json({ error: message });
    }
    if (result.status !== 201 || !result.body?.recipeId) return res.status(result.status).json(result.body);
    const recipeId = String(result.body.recipeId);
    const dish = await store.addDish({ partyId: v.party.id, guestId: v.guest.id, ...place, recipeId, title: "", note: null });
    await recipeAdded(v.party, recipeId);
    await dishResponse(res, v.party, v.guest, dish.id, 201);
  }

  router.post("/party/:token/dishes/import-link", async (req, res) => {
    try {
      const body = placeSchema.extend({ url: httpUrl }).parse(req.body);
      await importDish(req, res, (userId, opts) => deps.importer.link(body.url, userId, opts), body);
    } catch (err) { fail(res, err, "importing that link"); }
  });

  router.post("/party/:token/dishes/import-text", async (req, res) => {
    try {
      const body = placeSchema.extend({
        text: z.string().trim().min(20, "Paste the whole recipe: the title, the ingredients and the steps.").max(50_000, "That's too much text for one recipe."),
      }).parse(req.body);
      await importDish(req, res, (userId, opts) => deps.importer.text(body.text, userId, opts), body);
    } catch (err) { fail(res, err, "reading that recipe"); }
  });

  router.post("/party/:token/dishes/import-photo", (req, res, next) => {
    upload.single("image")(req, res, (err: unknown) => {
      if (err) return res.status(400).json({ error: "That photo is too big or couldn't be read. Try a smaller one." });
      next();
    });
  }, async (req: any, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: "Add a photo of the recipe." });
      const isImage = /^image\//.test(req.file.mimetype) || /\.(heic|heif)$/i.test(req.file.originalname ?? "");
      if (!isImage) return res.status(400).json({ error: "That file isn't a photo." });
      const body = placeSchema.parse({ slotId: req.body.slotId || null, course: req.body.course });
      await importDish(req, res, (userId, opts) => deps.importer.photo(req.file, userId, opts), body);
    } catch (err) { fail(res, err, "reading that photo"); }
  });

  router.patch("/party/:token/dishes/:dishId", async (req, res) => {
    try {
      const v = await joinedViewer(req, res);
      if (!v) return;
      const dish = await editableDish(v, String(req.params.dishId), res);
      if (!dish) return;
      const body = patchDishSchema.parse(req.body);
      const update: Parameters<PartyStore["updateDish"]>[1] = {};
      if (body.slotId !== undefined || body.course !== undefined) {
        Object.assign(update, await placement(v.party, { slotId: body.slotId === undefined ? dish.slotId : body.slotId, course: body.course ?? dish.course }, dish.id));
      }
      if (body.title !== undefined) update.title = body.title;
      if (body.note !== undefined) update.note = body.note;
      await store.updateDish(dish.id, update);
      await dishResponse(res, v.party, v.guest, dish.id);
    } catch (err) { fail(res, err, "saving your dish"); }
  });

  router.delete("/party/:token/dishes/:dishId", async (req, res) => {
    try {
      const v = await joinedViewer(req, res);
      if (!v) return;
      const dish = await editableDish(v, String(req.params.dishId), res);
      if (!dish) return;
      await store.deleteDish(dish.id);
      await recipesRemoved(v.party, [dish.recipeId]);
      res.status(204).end();
    } catch (err) { fail(res, err, "removing your dish"); }
  });

  // Anyone with the invite link (take-home recipe cards are QR codes to here)
  router.get("/party/:token/dishes/:dishId/recipe", async (req, res) => {
    try {
      const v = await viewerOf(req, res);
      if (!v) return;
      const dish = await store.getDish(String(req.params.dishId));
      if (!dish || dish.partyId !== v.party.id) return res.status(404).json({ error: "We couldn't find that dish." });
      const recipe = dish.recipeId ? await store.recipeForGuests(dish.recipeId) : null;
      if (!recipe) return res.status(404).json({ error: "This dish doesn't have a recipe." });
      res.json(recipe);
    } catch (err) { fail(res, err, "loading the recipe"); }
  });

  router.post("/party/:token/claim", async (req, res) => {
    try {
      const v = await viewerOf(req, res);
      if (!v) return;
      if (!v.accountId) return res.status(401).json({ error: "Sign in first, then we'll move your dish to your account." });
      if (!v.headerGuest) return res.status(400).json({ error: "There's no guest place on this device to move." });
      const [user] = await store.getUsers([v.headerGuest.userId]);
      if (!user?.isGuest) return res.status(400).json({ error: "That place already belongs to an account." });
      if (user.id !== v.accountId) {
        const touched = await store.claimGuest(user.id, v.accountId);
        for (const partyId of touched) await syncShares(partyId);
      }
      const mine = await store.findGuestByUser(v.party.id, v.accountId);
      res.json({ guestId: mine?.id ?? null });
    } catch (err) { fail(res, err, "moving your dish to your account"); }
  });

  router.post("/party/:token/save-cookbook", async (req, res) => {
    try {
      const v = await viewerOf(req, res);
      if (!v) return;
      if (!v.accountId) return res.status(401).json({ error: "Sign in to keep the party cookbook." });
      const mine = await store.findGuestByUser(v.party.id, v.accountId);
      if (!mine) return res.status(403).json({ error: "Join the party first." });
      if (!v.party.cookbookId) return res.status(409).json({ error: "This party doesn't have a cookbook any more." });
      await store.addCookbookMember(v.party.cookbookId, v.accountId, v.party.ownerUserId);
      await syncShares(v.party.id);
      res.json({ cookbookId: v.party.cookbookId });
    } catch (err) { fail(res, err, "saving the cookbook"); }
  });

  return router;
}
