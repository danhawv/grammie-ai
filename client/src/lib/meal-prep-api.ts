import type { MealSlot, PrepSetup } from "@shared/meal-prep/contract";
import type {
  CheckinOutcome,
  CookView,
  PrepCheckin,
  PrepPlanSummary,
  PrepPlanView,
  PrepProfile,
  PrepProfileDefaults,
  PrepShareCreated,
  PrepSubstitution,
  SwapOptionView,
  TaskProgress,
} from "@shared/meal-prep/api";
import { apiFetch } from "./platform";

// Every call the meal-prep screens make to /api/meal-prep lives here, typed
// against shared/meal-prep/api.ts, so endpoint details change in one place.
//
// Fixture mode (development only): set localStorage "grammie-meal-prep-fixtures"
// to "1" and every call is answered from client/src/lib/meal-prep-fixtures.ts
// without touching the server. The fixtures load as a separate chunk.

export type { CookView, PrepPlanSummary, PrepPlanView, PrepProfile, SwapOptionView };

const BASE = "/api/meal-prep";

/** Client routes for the cook page and its packet (the API's share path is /prep/cook/:token) */
export const cookPath = (token: string) => `/prep/cook/${token}`;

// ---------- Errors ----------

/** The API answers errors as {error} in plain words; keep them for the screen */
export class MealPrepApiError extends Error {
  constructor(public status: number, message: string, public code?: string) {
    super(message);
  }
}

const FALLBACK: Record<number, string> = {
  503: "Meal prep isn't switched on yet.",
  429: "That's a lot of requests. Wait a minute and try again.",
};

/** Words for an error, safe to show: the server's own sentence, else a calm default */
export function errorText(err: unknown, fallback = "Check your connection and try again."): string {
  if (err instanceof MealPrepApiError && err.message) return err.message;
  return fallback;
}

async function call<T>(method: string, path: string, body?: unknown): Promise<{ status: number; data: T }> {
  if (fixturesOn()) return (await import("./meal-prep-fixtures")).fixtureCall<T>(method, path, body);
  const res = await apiFetch(`${BASE}${path}`, {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json" } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: "include",
  });
  const text = await res.text().catch(() => "");
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
  if (!res.ok) {
    throw new MealPrepApiError(res.status, json?.error || FALLBACK[res.status] || "", json?.code);
  }
  return { status: res.status, data: json as T };
}

const get = async <T,>(method: string, path: string, body?: unknown) => (await call<T>(method, path, body)).data;

export function fixturesOn(): boolean {
  if (!import.meta.env.DEV) return false;
  try { return localStorage.getItem("grammie-meal-prep-fixtures") === "1"; } catch { return false; }
}

// ---------- Building plans ----------

type BuildReply = PrepPlanView | { id: string; buildStatus: "building"; poll: string };

const POLL_MS = 2000;
const POLL_LIMIT_MS = 4 * 60_000;

/**
 * Creating or re-planning can take longer than one request: the API answers
 * 202 and we poll GET /plans/:id until the build is ready or failed.
 */
async function untilBuilt(reply: { status: number; data: BuildReply }): Promise<PrepPlanView> {
  if (reply.status !== 202 && (reply.data as PrepPlanView).buildStatus !== "building") return reply.data as PrepPlanView;
  const id = reply.data.id;
  const started = Date.now();
  while (Date.now() - started < POLL_LIMIT_MS) {
    await new Promise((r) => setTimeout(r, POLL_MS));
    const view = await mealPrepApi.getPlan(id);
    if (view.buildStatus !== "building") return view;
  }
  throw new MealPrepApiError(504, "Planning is taking longer than usual. Your plan will be under Kitchen → Meal plans when it's ready.");
}

/** PATCH /plans/:id body: pins and exclusions, setup changes, wishes; the server re-plans */
export interface PlanPatch {
  pin?: string[];
  unpin?: string[];
  exclude?: string[];
  unexclude?: string[];
  setup?: Partial<PrepSetup>;
  wishes?: string;
  clearWishes?: boolean;
}

export interface ApproveOptions {
  addToCalendar: boolean;
  addToGroceryList: boolean;
  groceryMode: "add_to_existing" | "create_new";
}

export interface CheckInBody {
  personId: string;
  day: number;
  slot: MealSlot;
  outcome: CheckinOutcome;
  note?: string;
}

// ---------- Calls ----------

export const mealPrepKeys = {
  profile: ["meal-prep", "profile"] as const,
  plans: ["meal-prep", "plans"] as const,
  plan: (id: string) => ["meal-prep", "plan", id] as const,
  cook: (token: string) => ["meal-prep", "cook", token] as const,
};

export const mealPrepApi = {
  getProfile: () => get<PrepProfile>("GET", "/profile"),
  saveProfile: (defaults: PrepProfileDefaults, walkthroughDone: boolean) =>
    get<PrepProfile>("PUT", "/profile", { defaults, walkthroughDone }),

  listPlans: () => get<PrepPlanSummary[]>("GET", "/plans"),
  createPlan: async (setup: PrepSetup) => untilBuilt(await call<BuildReply>("POST", "/plans", setup)),
  getPlan: (id: string) => get<PrepPlanView>("GET", `/plans/${id}`),
  updatePlan: async (id: string, patch: PlanPatch) => untilBuilt(await call<BuildReply>("PATCH", `/plans/${id}`, patch)),
  setStatus: (id: string, status: "done" | "cancelled") => get<PrepPlanView>("PATCH", `/plans/${id}`, { status }),
  swapOptions: (id: string, recipeId: string) =>
    get<{ forRecipeId: string; options: SwapOptionView[] }>("POST", `/plans/${id}/swap`, { recipeId }),
  /** recipeId = the replacement chosen from swapOptions */
  chooseSwap: (id: string, recipeId: string) => get<PrepPlanView>("POST", `/plans/${id}/choose-swap`, { recipeId }),
  approve: (id: string, options: ApproveOptions) => get<PrepPlanView>("POST", `/plans/${id}/approve`, options),
  share: (id: string, label?: string) => get<PrepShareCreated>("POST", `/plans/${id}/share`, label ? { label } : {}),
  setOwnerProgress: (id: string, taskId: string, done: boolean) => get<PrepPlanView>("POST", `/plans/${id}/progress`, { taskId, done }),
  substitutionsSeen: (id: string) => get<PrepPlanView>("POST", `/plans/${id}/substitutions/seen`),
  listCheckIns: (id: string) => get<PrepCheckin[]>("GET", `/plans/${id}/checkins`),
  checkIn: (id: string, body: CheckInBody) => get<PrepCheckin>("POST", `/plans/${id}/checkins`, body),
  /** null when Instacart isn't set up on the server (501 instacart_not_configured) */
  instacart: async (id: string) => {
    try {
      return await get<{ url: string; items: number }>("POST", `/plans/${id}/instacart`);
    } catch (e) {
      if (e instanceof MealPrepApiError && e.status === 501) return null;
      throw e;
    }
  },

  getCook: (token: string) => get<CookView>("GET", `/cook/${token}`),
  setCookProgress: (token: string, taskId: string, done: boolean) =>
    get<{ progress: Record<string, TaskProgress> }>("POST", `/cook/${token}/progress`, { taskId, done }),
  substitute: (token: string, ingredient: string, replacement: string) =>
    get<{ substitution: Pick<PrepSubstitution, "id" | "ingredient" | "replacement" | "at" | "note">; view: CookView }>(
      "POST", `/cook/${token}/substitution`, { ingredient, replacement },
    ),
};

// ---------- Profile defaults <-> setup ----------

/** What gets saved as next time's defaults: the setup minus the date and this week's choices */
export function defaultsFromSetup(setup: PrepSetup): PrepProfileDefaults {
  const { date: _date, ...session } = setup.session;
  return {
    people: setup.people,
    days: setup.days,
    startSameDay: setup.startSameDay,
    kitchen: setup.kitchen,
    session,
    maxDishes: setup.maxDishes,
    maxRepeats: setup.maxRepeats,
    budget: setup.budget,
  };
}

/** Saved defaults laid over a fresh setup (which brings the upcoming date) */
export function setupFromDefaults(defaults: PrepProfileDefaults | undefined, base: PrepSetup): PrepSetup {
  if (!defaults) return base;
  return {
    ...base,
    people: defaults.people?.length ? defaults.people : base.people,
    days: defaults.days ?? base.days,
    startSameDay: defaults.startSameDay ?? base.startSameDay,
    kitchen: defaults.kitchen ?? base.kitchen,
    session: { ...base.session, ...(defaults.session ?? {}), date: base.session.date },
    maxDishes: defaults.maxDishes ?? base.maxDishes,
    maxRepeats: defaults.maxRepeats ?? base.maxRepeats,
    budget: defaults.budget ?? base.budget,
  };
}

export const SLOT_LABELS: Record<MealSlot, string> = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  dinner: "Dinner",
  snack: "Snack",
};
