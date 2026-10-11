// Meal prep API, mounted at /api/meal-prep. Owner routes need a signed-in
// user and only ever touch that user's plans (someone else's plan is a 404).
// Cook routes (/cook/:token) need no account: the unguessable link is the
// key, and they see only what toCookView allows. Full request and response
// shapes are in shared/meal-prep/api.ts.

import crypto from "node:crypto";
import { Router, type RequestHandler, type Response } from "express";
import { z } from "zod";
import type { PrepSetup } from "@shared/meal-prep/contract";
import type { PrepSubstitution, SwapOptionView } from "@shared/meal-prep/api";
import type { PrepPlanRow, PrepPlanShareRow, PrepRecipes, PrepStore } from "../meal-prep/store";
import type { PrepIntegrations } from "../meal-prep/calendar";
import { calendarEntries, eatingDate, groceryLines, prepPlanName } from "../meal-prep/calendar";
import type { MealPrepAI } from "../meal-prep/ai";
import type { MealPrepEngines } from "../meal-prep/engines";
import type { InstacartClient } from "../meal-prep/instacart";
import { instacartLineItems } from "../meal-prep/instacart";
import { limit, mealPrepLimiters } from "../meal-prep/limits";
import {
  approveSchema, checkinSchema, chooseSwapSchema, firstIssue, patchPlanSchema, prepSetupSchema,
  progressSchema, putProfileSchema, shareSchema, substitutionSchema, swapSchema,
} from "../meal-prep/validation";
import {
  buildPlan, effectiveSetup, factsForPlan, finishPlan, PrepProblem, requireEngines, type MealPrepDeps,
} from "../meal-prep/service";
import { emptyWishes, withoutWishFor } from "../meal-prep/wishes";
import { hashShareToken, looksLikeShareToken, newShareToken, shareExpiry, shareState } from "../meal-prep/share";
import { applySubstitution } from "../meal-prep/substitution";
import { toCookView, toPlanSummary, toPlanView, toShareView } from "../meal-prep/views";

export interface MealPrepRouterDeps {
  store: PrepStore;
  recipes: PrepRecipes;
  integrations: PrepIntegrations;
  engines: () => MealPrepEngines | null;
  ai: MealPrepAI | null;
  /** null = Instacart not configured (501) */
  instacart: () => InstacartClient | null;
  /** tell the owner about a cook's swap (best effort) */
  notifyOwner?: (row: PrepPlanRow, substitution: PrepSubstitution) => void;
  /** isAuthenticated in production (passed in so tests don't load the auth stack) */
  auth: RequestHandler;
  /** getUserId in production */
  userIdOf: (req: any) => string | undefined;
  now?: () => Date;
  /** how long POST/PATCH wait for the solver before answering 202 */
  waitMs?: number;
}

/** A build that hasn't finished after this long was cut off (e.g. a redeploy) */
const STALE_BUILD_MS = 5 * 60_000;
const DEFAULT_WAIT_MS = 2500;

const COOK_LINK_BROKEN = "This cook link doesn't work. Ask the family for a new one.";

export function createMealPrepRouter(deps: MealPrepRouterDeps): Router {
  const router = Router();
  const { auth, userIdOf } = deps;
  const now = deps.now ?? (() => new Date());
  const waitMs = deps.waitMs ?? DEFAULT_WAIT_MS;
  const service: MealPrepDeps = { store: deps.store, recipes: deps.recipes, engines: deps.engines, ai: deps.ai };
  const limits = mealPrepLimiters();
  /** plan ids with a build running in this process */
  const building = new Map<string, Promise<unknown>>();

  const owner = (req: any) => userIdOf(req) ?? null;
  const signedIn: RequestHandler[] = [
    auth,
    (req, res, next) => (owner(req) ? next() : res.status(401).json({ error: "Please sign in again." })),
    limit(limits.general, owner, "That's a lot of requests at once. Wait a minute and try again."),
  ];
  /** Planning runs the solver and the model: a tighter limit, checked only when we will plan */
  const overPlanLimit = (req: any, res: Response): boolean => {
    const key = owner(req)!;
    if (!limits.planMinute.hit(key)) {
      res.status(429).json({ error: "Planning takes a moment. Wait a minute before trying again." });
      return true;
    }
    if (!limits.planDay.hit(key)) {
      res.status(429).json({ error: "You've made a lot of plans today. Try again tomorrow." });
      return true;
    }
    return false;
  };

  const fail = (res: Response, err: unknown, what: string) => {
    if (err instanceof PrepProblem) return res.status(err.status).json({ error: err.message });
    if (err instanceof z.ZodError) return res.status(400).json({ error: firstIssue(err) });
    console.error(`[MealPrep] ${what}:`, err);
    return res.status(500).json({ error: `Something went wrong ${what}. Please try again.` });
  };

  /** The signed-in owner's plan, or a 404 sent (also for other people's plans) */
  async function ownedPlan(req: any, res: Response): Promise<PrepPlanRow | null> {
    const row = await deps.store.getPlan(String(req.params.id));
    if (!row || row.ownerUserId !== owner(req)) {
      res.status(404).json({ error: "We couldn't find that plan." });
      return null;
    }
    return markIfStale(row);
  }

  async function markIfStale(row: PrepPlanRow): Promise<PrepPlanRow> {
    if (row.buildStatus === "building" && !building.has(row.id) && now().getTime() - row.updatedAt.getTime() > STALE_BUILD_MS) {
      return (await deps.store.updatePlan(row.id, {
        buildStatus: "failed",
        buildError: "Planning was interrupted. Please try again.",
      })) ?? row;
    }
    return row;
  }

  async function planResponse(res: Response, row: PrepPlanRow, status = 200) {
    const progress = await deps.store.listProgress(row.id);
    res.setHeader("Cache-Control", "no-store");
    return res.status(status).json(toPlanView(row, progress));
  }

  /** Starts a build and waits a moment: 201/200 with the plan if it finished, else 202 to poll */
  async function startBuild(res: Response, row: PrepPlanRow, reuse: PrepPlanRow["wishesResult"], doneStatus: number) {
    const job = buildPlan(service, row, reuse).finally(() => building.delete(row.id));
    building.set(row.id, job);
    let timer: NodeJS.Timeout | undefined;
    const finished = await Promise.race([
      job.then(r => r),
      new Promise<"pending">(resolve => { timer = setTimeout(() => resolve("pending"), waitMs); }),
    ]);
    clearTimeout(timer);
    if (finished === "pending") {
      res.setHeader("Cache-Control", "no-store");
      return res.status(202).json({ id: row.id, buildStatus: "building", poll: `/api/meal-prep/plans/${row.id}` });
    }
    return planResponse(res, finished ?? row, doneStatus);
  }

  /** Drops recipe ids the owner can't use; complains about pinned ones */
  async function checkRecipes(ownerId: string, setup: PrepSetup): Promise<PrepSetup> {
    const ids = Array.from(new Set([...(setup.recipePool ?? []), ...(setup.pinnedRecipeIds ?? [])]));
    if (ids.length === 0) return setup;
    const usable = new Set(await deps.recipes.usableRecipeIds(ownerId, ids));
    if ((setup.pinnedRecipeIds ?? []).some(id => !usable.has(id))) {
      throw new PrepProblem("One of the must-have recipes isn't in your recipes any more. Take it off and try again.", 400);
    }
    return { ...setup, recipePool: setup.recipePool?.filter(id => usable.has(id)) };
  }

  const notReady = (res: Response, row: PrepPlanRow) => {
    if (row.buildStatus === "building") return res.status(409).json({ error: "Still working on this plan. Try again in a moment." });
    return res.status(409).json({ error: "This plan didn't finish. Change something or try again." });
  };

  // ---------------------------------------------------------------- profile

  router.get("/profile", ...signedIn, async (req, res) => {
    try {
      const profile = await deps.store.getProfile(owner(req)!);
      res.json(profile
        ? { defaults: profile.defaults, walkthroughDone: profile.walkthroughDone, updatedAt: profile.updatedAt.toISOString() }
        : { defaults: {}, walkthroughDone: false, updatedAt: null });
    } catch (err) { fail(res, err, "loading your meal prep settings"); }
  });

  router.put("/profile", ...signedIn, async (req, res) => {
    try {
      const body = putProfileSchema.parse(req.body);
      const saved = await deps.store.putProfile(owner(req)!, body.defaults, body.walkthroughDone);
      res.json({ defaults: saved.defaults, walkthroughDone: saved.walkthroughDone, updatedAt: saved.updatedAt.toISOString() });
    } catch (err) { fail(res, err, "saving your meal prep settings"); }
  });

  // ---------------------------------------------------------------- plans

  router.get("/plans", ...signedIn, async (req, res) => {
    try {
      const rows = await deps.store.listPlans(owner(req)!, 30);
      res.setHeader("Cache-Control", "no-store");
      res.json(rows.map(toPlanSummary));
    } catch (err) { fail(res, err, "loading your plans"); }
  });

  router.post("/plans", ...signedIn, async (req, res) => {
    try {
      requireEngines(service);
      if (overPlanLimit(req, res)) return;
      const ownerId = owner(req)!;
      const setup = await checkRecipes(ownerId, prepSetupSchema.parse(req.body) as PrepSetup);
      const row = await deps.store.createPlan(ownerId, setup);
      await startBuild(res, row, null, 201);
    } catch (err) { fail(res, err, "making the plan"); }
  });

  router.get("/plans/:id", ...signedIn, async (req, res) => {
    try {
      const row = await ownedPlan(req, res);
      if (row) await planResponse(res, row);
    } catch (err) { fail(res, err, "loading the plan"); }
  });

  router.patch("/plans/:id", ...signedIn, async (req, res) => {
    try {
      const input = patchPlanSchema.parse(req.body ?? {});
      const row = await ownedPlan(req, res);
      if (!row) return;
      const { status, ...changes } = input;
      const replans = Object.values(changes).some(v => v !== undefined);

      if (status && !replans) {
        if (row.status === "cancelled" || row.status === "done") {
          return res.status(409).json({ error: "This plan is already finished." });
        }
        const updated = await deps.store.updatePlan(row.id, { status });
        return planResponse(res, updated ?? row);
      }
      if (status) return res.status(400).json({ error: "Change the plan or finish it, not both at once." });
      if (row.status !== "draft") {
        return res.status(409).json({ error: "This plan is already approved. Start a new plan to change it." });
      }
      if (building.has(row.id)) return res.status(409).json({ error: "Still working on the last change. Try again in a moment." });
      requireEngines(service);
      if (overPlanLimit(req, res)) return;

      const merged: PrepSetup = { ...row.setup, ...(changes.setup ?? {}) } as PrepSetup;
      const pinned = new Set(merged.pinnedRecipeIds ?? []);
      const excluded = new Set(merged.excludedRecipeIds ?? []);
      for (const id of changes.pin ?? []) { pinned.add(id); excluded.delete(id); }
      for (const id of changes.unpin ?? []) pinned.delete(id);
      for (const id of changes.exclude ?? []) { excluded.add(id); pinned.delete(id); }
      for (const id of changes.unexclude ?? []) excluded.delete(id);
      merged.pinnedRecipeIds = Array.from(pinned);
      merged.excludedRecipeIds = Array.from(excluded);
      if (changes.wishes !== undefined) merged.wishes = changes.wishes || undefined;

      const setup = await checkRecipes(row.ownerUserId, prepSetupSchema.parse(merged) as PrepSetup);

      // Reuse what the wishes became unless the text changed; the owner's
      // pins and put-backs override the wishes for those dishes
      let reuse = row.wishesResult;
      if (changes.clearWishes) reuse = emptyWishes((setup.wishes ?? "").trim());
      if (reuse) reuse = withoutWishFor(reuse, [...(changes.pin ?? []), ...(changes.unexclude ?? [])]);

      const updated = await deps.store.updatePlan(row.id, {
        setup,
        sessionDate: setup.session.date,
        buildStatus: "building",
        buildError: null,
        wishesResult: reuse,
      });
      await startBuild(res, updated ?? row, reuse, 200);
    } catch (err) { fail(res, err, "changing the plan"); }
  });

  // ---------------------------------------------------------------- swaps

  router.post("/plans/:id/swap", ...signedIn, async (req, res) => {
    try {
      const { recipeId } = swapSchema.parse(req.body);
      const row = await ownedPlan(req, res);
      if (!row) return;
      if (row.status !== "draft") return res.status(409).json({ error: "This plan is already approved. Start a new plan to change it." });
      if (row.buildStatus !== "ready" || !row.plan) return notReady(res, row);
      if (!row.plan.batches.some(b => b.recipeId === recipeId)) {
        return res.status(400).json({ error: "That dish isn't in this plan." });
      }
      if (overPlanLimit(req, res)) return;
      const { engines, facts, adjusters } = await factsForPlan(service, row.ownerUserId, row.setup);
      const setup = effectiveSetup(row.setup, row.wishesResult);
      const options = (await engines.planner.swapOptions(setup, row.plan, recipeId, facts, adjusters)).slice(0, 5);
      const titles = { ...row.recipeTitles };
      for (const f of facts) if (options.some(o => o.recipeId === f.recipeId)) titles[f.recipeId] = f.title;
      await deps.store.updatePlan(row.id, { swapOptions: { forRecipeId: recipeId, options }, recipeTitles: titles });
      const current = row.plan.fitScore;
      const views: SwapOptionView[] = options.map(o => ({
        recipeId: o.recipeId,
        title: titles[o.recipeId] ?? "A dish",
        fitScore: Math.round(o.plan.fitScore),
        fitScoreChange: Math.round(o.plan.fitScore - current),
        notes: o.plan.notes.slice(0, 3),
      }));
      res.json({ forRecipeId: recipeId, options: views });
    } catch (err) { fail(res, err, "finding other dishes"); }
  });

  router.post("/plans/:id/choose-swap", ...signedIn, async (req, res) => {
    try {
      const { recipeId } = chooseSwapSchema.parse(req.body);
      const row = await ownedPlan(req, res);
      if (!row) return;
      if (row.status !== "draft") return res.status(409).json({ error: "This plan is already approved. Start a new plan to change it." });
      const option = row.swapOptions?.options.find(o => o.recipeId === recipeId);
      if (!row.swapOptions || !option) return res.status(409).json({ error: "Those choices have expired. Ask for other dishes again." });

      // The swapped-out dish stays out if the family re-plans later
      const out = row.swapOptions.forRecipeId;
      const setup: PrepSetup = {
        ...row.setup,
        pinnedRecipeIds: (row.setup.pinnedRecipeIds ?? []).filter(id => id !== out),
        excludedRecipeIds: Array.from(new Set([...(row.setup.excludedRecipeIds ?? []), out])).filter(id => id !== recipeId),
      };
      const { facts, adjusters } = await factsForPlan(service, row.ownerUserId, setup);
      const done = await finishPlan(service, row.ownerUserId, effectiveSetup(setup, row.wishesResult), option.plan, facts, adjusters);
      const updated = await deps.store.updatePlan(row.id, {
        setup,
        plan: option.plan,
        shopping: done.shopping,
        session: done.session,
        explanation: done.explanation.text,
        explanationAi: done.explanation.byAI,
        recipeTitles: { ...row.recipeTitles, ...done.titles },
        swapOptions: null,
      });
      await planResponse(res, updated ?? row);
    } catch (err) { fail(res, err, "swapping the dish"); }
  });

  // ---------------------------------------------------------------- approve

  router.post("/plans/:id/approve", ...signedIn, async (req, res) => {
    try {
      const options = approveSchema.parse(req.body ?? {});
      let row = await ownedPlan(req, res);
      if (!row) return;
      // Safe to retry: an approved plan just comes back as it is
      if (row.status === "approved") return planResponse(res, row);
      if (row.status !== "draft") return res.status(409).json({ error: "This plan is already finished." });
      if (row.buildStatus !== "ready" || !row.plan) return notReady(res, row);

      if (options.addToCalendar && !row.calendarMealPlanId) {
        const entries = calendarEntries(row.setup, row.plan);
        const calendarId = await deps.integrations.pushToCalendar(row.ownerUserId, {
          name: prepPlanName(row.setup),
          startDate: eatingDate(row.setup, 0),
          endDate: eatingDate(row.setup, row.setup.days - 1),
          entries,
        });
        // Saved straight away so a retry doesn't make a second calendar plan
        row = (await deps.store.updatePlan(row.id, { calendarMealPlanId: calendarId })) ?? { ...row, calendarMealPlanId: calendarId };
      }
      if (options.addToGroceryList && row.shopping && !row.groceryListId) {
        const listId = await deps.integrations.addToGroceryList(row.ownerUserId, {
          name: prepPlanName(row.setup),
          lines: groceryLines(row.shopping, row.recipeTitles ?? {}),
          mode: options.groceryMode,
          mealPlanId: row.calendarMealPlanId,
        });
        row = (await deps.store.updatePlan(row.id, { groceryListId: listId })) ?? { ...row, groceryListId: listId };
      }
      const approved = await deps.store.updatePlan(row.id, { status: "approved", approvedAt: now(), swapOptions: null });
      await planResponse(res, approved ?? row);
    } catch (err) { fail(res, err, "approving the plan"); }
  });

  // ---------------------------------------------------------------- progress, check-ins, swaps seen

  router.post("/plans/:id/progress", ...signedIn, async (req, res) => {
    try {
      const { taskId, done } = progressSchema.parse(req.body);
      const row = await ownedPlan(req, res);
      if (!row) return;
      if (!row.session?.tasks.some(t => t.id === taskId)) return res.status(400).json({ error: "That step isn't in this session." });
      await deps.store.setTaskDone(row.id, taskId, done, "owner");
      await planResponse(res, row);
    } catch (err) { fail(res, err, "saving the step"); }
  });

  router.post("/plans/:id/substitutions/seen", ...signedIn, async (req, res) => {
    try {
      const row = await ownedPlan(req, res);
      if (!row) return;
      const at = now().toISOString();
      const substitutions = (row.substitutions ?? []).map(s => (s.seenAt ? s : { ...s, seenAt: at }));
      const updated = await deps.store.updatePlan(row.id, { substitutions });
      await planResponse(res, updated ?? row);
    } catch (err) { fail(res, err, "saving that"); }
  });

  router.get("/plans/:id/checkins", ...signedIn, async (req, res) => {
    try {
      const row = await ownedPlan(req, res);
      if (!row) return;
      const rows = await deps.store.listCheckins(row.id);
      res.json(rows.map(c => ({ ...c, updatedAt: c.updatedAt.toISOString() })));
    } catch (err) { fail(res, err, "loading check-ins"); }
  });

  router.post("/plans/:id/checkins", ...signedIn, async (req, res) => {
    try {
      const body = checkinSchema.parse(req.body);
      const row = await ownedPlan(req, res);
      if (!row) return;
      if (!row.setup.people.some(p => p.id === body.personId)) return res.status(400).json({ error: "That person isn't in this plan." });
      if (body.day >= row.setup.days) return res.status(400).json({ error: "That day isn't in this plan." });
      const saved = await deps.store.upsertCheckin(row.id, {
        personId: body.personId,
        day: body.day,
        slot: body.slot,
        outcome: body.outcome as any,
        note: body.note || null,
      });
      res.status(201).json({ ...saved, updatedAt: saved.updatedAt.toISOString() });
    } catch (err) { fail(res, err, "saving the check-in"); }
  });

  // ---------------------------------------------------------------- cook links (owner side)

  router.post("/plans/:id/share", ...signedIn,
    limit(limits.share, owner, "You've made a lot of cook links. Try again in an hour."),
    async (req, res) => {
      try {
        const body = shareSchema.parse(req.body ?? {});
        const row = await ownedPlan(req, res);
        if (!row) return;
        if (row.status === "cancelled") return res.status(409).json({ error: "This plan was cancelled." });
        if (row.buildStatus !== "ready" || !row.session) return notReady(res, row);
        const { token, tokenHash } = newShareToken();
        const share = await deps.store.createShare({
          planId: row.id,
          tokenHash,
          label: body.label || null,
          expiresAt: shareExpiry(now(), row.sessionDate, body.expiresInDays),
        });
        res.setHeader("Cache-Control", "no-store");
        res.status(201).json({ ...toShareView(share, now()), token, path: `/prep/cook/${token}` });
      } catch (err) { fail(res, err, "making the cook link"); }
    });

  router.get("/plans/:id/shares", ...signedIn, async (req, res) => {
    try {
      const row = await ownedPlan(req, res);
      if (!row) return;
      const shares = await deps.store.listShares(row.id);
      res.json(shares.map(s => toShareView(s, now())));
    } catch (err) { fail(res, err, "loading cook links"); }
  });

  router.delete("/plans/:id/shares/:shareId", ...signedIn, async (req, res) => {
    try {
      const row = await ownedPlan(req, res);
      if (!row) return;
      const ok = await deps.store.revokeShare(row.id, String(req.params.shareId), now());
      if (!ok) return res.status(404).json({ error: "We couldn't find that cook link." });
      res.json({ ok: true });
    } catch (err) { fail(res, err, "turning off the cook link"); }
  });

  // ---------------------------------------------------------------- Instacart

  router.post("/plans/:id/instacart", ...signedIn,
    limit(limits.instacart, owner, "You've made a lot of Instacart lists. Try again in an hour."),
    async (req, res) => {
      try {
        const row = await ownedPlan(req, res);
        if (!row) return;
        const client = deps.instacart();
        if (!client) {
          return res.status(501).json({
            error: "Ordering through Instacart isn't set up yet. You can still shop from the list here.",
            code: "instacart_not_configured",
          });
        }
        if (!row.shopping) return notReady(res, row);
        const items = instacartLineItems(row.shopping);
        if (items.length === 0) return res.status(400).json({ error: "You already have everything on the list." });
        const url = await client({ title: prepPlanName(row.setup), items });
        res.json({ url, items: items.length });
      } catch (err) {
        if (err instanceof PrepProblem || err instanceof z.ZodError) return fail(res, err, "");
        console.error("[MealPrep] Instacart link failed:", err);
        res.status(502).json({ error: "Instacart didn't answer just now. Please try again in a few minutes." });
      }
    });

  // ---------------------------------------------------------------- cook page (no account)

  const cookKey = (req: any) => {
    const token = String(req.params.token ?? "");
    return looksLikeShareToken(token) ? hashShareToken(token) : null;
  };
  const cookIp = limit(limits.cookIp, req => `ip:${req.ip ?? "unknown"}`, "Too many requests. Wait a minute and try again.");

  /** The share and plan behind a cook link, or an error sent */
  async function cookPlan(req: any, res: Response, forWriting: boolean): Promise<{ row: PrepPlanRow; share: PrepPlanShareRow } | null> {
    res.setHeader("Cache-Control", "no-store");
    // The token is in the URL: keep it out of Referer headers
    res.setHeader("Referrer-Policy", "no-referrer");
    const hash = cookKey(req);
    const share = hash ? await deps.store.findShareByHash(hash) : null;
    // Looked up by hash, so lookup timing says nothing about the token itself
    if (!share) {
      res.status(404).json({ error: COOK_LINK_BROKEN });
      return null;
    }
    const state = shareState(share, now());
    if (state === "revoked") { res.status(410).json({ error: "The family turned this cook link off. Ask them for a new one." }); return null; }
    if (state === "expired") { res.status(410).json({ error: "This cook link has expired. Ask the family for a new one." }); return null; }
    const row = await deps.store.getPlan(share.planId);
    if (!row || row.status === "cancelled" || !row.session) {
      res.status(410).json({ error: "This prep plan isn't available any more." });
      return null;
    }
    if (forWriting && row.status === "done") {
      res.status(409).json({ error: "This prep day is finished, so changes can't be saved." });
      return null;
    }
    return { row, share };
  }

  router.get("/cook/:token", cookIp, limit(limits.cookRead, cookKey, "Too many requests. Wait a minute and try again."), async (req, res) => {
    try {
      const found = await cookPlan(req, res, false);
      if (!found) return;
      const ids = (found.row.plan?.batches ?? []).map(b => b.recipeId);
      const [progress, recipes] = await Promise.all([deps.store.listProgress(found.row.id), deps.recipes.forCook(ids)]);
      res.json(toCookView(found.row, found.share, progress, recipes));
    } catch (err) { fail(res, err, "opening the cook page"); }
  });

  router.post("/cook/:token/progress", cookIp, limit(limits.cookWrite, cookKey, "Too many requests. Wait a minute and try again."), async (req, res) => {
    try {
      const { taskId, done } = progressSchema.parse(req.body);
      const found = await cookPlan(req, res, true);
      if (!found) return;
      if (!found.row.session?.tasks.some(t => t.id === taskId)) return res.status(400).json({ error: "That step isn't in this session." });
      await deps.store.setTaskDone(found.row.id, taskId, done, "cook");
      const progress = await deps.store.listProgress(found.row.id);
      res.json({ progress: toCookView(found.row, found.share, progress, []).progress });
    } catch (err) { fail(res, err, "saving the step"); }
  });

  router.post("/cook/:token/substitution", cookIp, limit(limits.cookWrite, cookKey, "Too many requests. Wait a minute and try again."), async (req, res) => {
    try {
      const body = substitutionSchema.parse(req.body);
      const found = await cookPlan(req, res, true);
      if (!found) return;
      const { row } = found;
      if (!row.plan) return res.status(409).json({ error: "This plan isn't ready yet." });
      if ((row.substitutions ?? []).length >= 50) return res.status(429).json({ error: "That's a lot of swaps for one prep day. Let the family know directly." });

      const engines = requireEngines(service);
      const facts = await engines.food.factsFor(row.plan.batches.map(b => b.recipeId));
      let from = null;
      let to = null;
      if (engines.food.ingredientNutrition) {
        try {
          const found = await engines.food.ingredientNutrition([body.ingredient, body.replacement]);
          from = found[body.ingredient]?.perGram ?? null;
          to = found[body.replacement]?.perGram ?? null;
        } catch (err) {
          console.warn("[MealPrep] Nutrition lookup for a swap failed:", (err as Error).message);
        }
      }
      const result = applySubstitution({
        plan: row.plan, session: row.session, facts, titles: row.recipeTitles ?? {},
        ingredient: body.ingredient, replacement: body.replacement, from, to,
      });
      const substitution: PrepSubstitution = {
        id: crypto.randomUUID(),
        ingredient: body.ingredient,
        replacement: body.replacement,
        by: "cook",
        at: now().toISOString(),
        recipeIds: result.recipeIds,
        labelKeys: result.labelKeys,
        nutritionUpdated: result.nutritionUpdated,
        note: result.note,
        seenAt: null,
      };
      const updated = await deps.store.updatePlan(row.id, {
        plan: result.plan,
        session: result.session,
        substitutions: [...(row.substitutions ?? []), substitution],
      });
      try { deps.notifyOwner?.(updated ?? row, substitution); } catch (err) { console.warn("[MealPrep] Owner notice failed:", err); }
      const progress = await deps.store.listProgress(row.id);
      const ids = row.plan.batches.map(b => b.recipeId);
      res.status(201).json({
        substitution: { id: substitution.id, ingredient: substitution.ingredient, replacement: substitution.replacement, at: substitution.at, note: substitution.note },
        view: toCookView(updated ?? row, found.share, progress, await deps.recipes.forCook(ids)),
      });
    } catch (err) { fail(res, err, "saving the swap"); }
  });

  return router;
}
