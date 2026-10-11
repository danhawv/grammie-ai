// Pay-as-you-go credits: what each AI action costs, the free allowance and
// the packs people can buy. The ONE place to change any of these numbers;
// the server (server/lib/credits.ts), the web page (/credits) and the
// iPhone/iPad app all read them from here.

/** Actions that cost credits. Voice/chat and small helpers are free for now. */
export type CreditAction = "recipe_import" | "dish_photo" | "meal_prep_plan";

export const CREDIT_COSTS: Record<CreditAction, number> = {
  /** Any import: photo/card (multi-page still 1), link, text, social, each bulk-import recipe.
   *  The dish photo that comes with an import is included. */
  recipe_import: 1,
  /** Making or remaking a dish photo on its own */
  dish_photo: 1,
  /** Building a NEW meal-prep plan; re-plans and swaps of that plan are free */
  meal_prep_plan: 2,
};

/** What each action is called on the Credits page */
export const CREDIT_ACTION_LABELS: Record<CreditAction, string> = {
  recipe_import: "Add a recipe (photo, card, link or text)",
  dish_photo: "Make a new dish photo",
  meal_prep_plan: "Build a meal-prep plan",
};

/** Given once per account (existing accounts get it on their first balance check) */
export const WELCOME_CREDITS = 50;
/** Given each calendar month (UTC) the account is used; missed months aren't made up */
export const MONTHLY_FREE_CREDITS = 3;
/** "Running low" shows at or below this */
export const LOW_BALANCE = 3;

export type CreditPackId = "starter" | "family" | "cookbook" | "heirloom";

export interface CreditPack {
  id: CreditPackId;
  name: string;
  credits: number;
  /** US dollars, in cents (web price; the App Store price tier should match) */
  priceCents: number;
  /** App Store consumable product id */
  appleProductId: string;
}

export const APPLE_PRODUCT_PREFIX = "ai.grammie.app.credits.";

export const CREDIT_PACKS: CreditPack[] = [
  { id: "starter", name: "Starter", credits: 40, priceCents: 499, appleProductId: `${APPLE_PRODUCT_PREFIX}starter` },
  { id: "family", name: "Family", credits: 90, priceCents: 999, appleProductId: `${APPLE_PRODUCT_PREFIX}family` },
  { id: "cookbook", name: "Cookbook", credits: 200, priceCents: 1999, appleProductId: `${APPLE_PRODUCT_PREFIX}cookbook` },
  { id: "heirloom", name: "Heirloom", credits: 550, priceCents: 4999, appleProductId: `${APPLE_PRODUCT_PREFIX}heirloom` },
];

export function packById(id: unknown): CreditPack | undefined {
  return CREDIT_PACKS.find((p) => p.id === id);
}

export function packByAppleProduct(productId: unknown): CreditPack | undefined {
  return CREDIT_PACKS.find((p) => p.appleProductId === productId);
}

/** "2026-10" for the month the date falls in (UTC) */
export function monthKey(date: Date): string {
  return date.toISOString().slice(0, 7);
}

export function formatCredits(n: number): string {
  return `${n} ${Math.abs(n) === 1 ? "credit" : "credits"}`;
}

export function formatPrice(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

// ---- API shapes (GET /api/credits and friends) ------------------------------

export type CreditKind = "purchase" | "welcome" | "monthly_free" | "spend" | "refund" | "adjust";
export type CreditSource = "stripe" | "apple" | "google" | "system";

export interface CreditHistoryItem {
  id: string;
  delta: number;
  kind: CreditKind;
  source: CreditSource;
  /** Plain words: "Added a recipe", "Family pack" */
  label: string;
  createdAt: string;
}

export interface CreditsSummary {
  balance: number;
  /** When false, nothing is ever refused for lack of credits */
  enforced: boolean;
  /** Admin accounts are never charged */
  unlimited: boolean;
  packs: CreditPack[];
  costs: Record<CreditAction, number>;
  welcomeCredits: number;
  monthlyFreeCredits: number;
  /** Which ways to buy work right now */
  purchase: { web: boolean; apple: boolean };
  history: CreditHistoryItem[];
}

/** Body of the 402 answer when an action needs more credits than the account has */
export interface NeedCreditsError {
  error: string;
  code: "needs_credits";
  balance: number;
  cost: number;
  addCreditsUrl: string;
}

export function needCreditsMessage(action: CreditAction, balance: number): string {
  const cost = CREDIT_COSTS[action];
  const what = action === "recipe_import" ? "Adding a recipe" : action === "dish_photo" ? "A new dish photo" : "A new meal-prep plan";
  return `${what} uses ${formatCredits(cost)}, and you have ${formatCredits(Math.max(0, balance))} left. Add credits to keep going.`;
}

/** Plain-words line for a ledger row */
export function historyLabel(kind: CreditKind, meta: Record<string, unknown> | null | undefined): string {
  const m = meta ?? {};
  switch (kind) {
    case "welcome": return "Welcome gift";
    case "monthly_free": return "Free credits this month";
    case "purchase": {
      const pack = packById(m.pack);
      return pack ? `${pack.name} pack` : "Credits bought";
    }
    case "spend":
      return m.action === "dish_photo" ? "New dish photo"
        : m.action === "meal_prep_plan" ? "Meal-prep plan"
        : m.action === "recipe_import" ? "Added a recipe"
        : "Used";
    case "refund":
      return m.reason === "purchase_refunded" ? "Purchase refunded" : "Given back (it didn't work)";
    case "adjust": return typeof m.note === "string" && m.note ? m.note : "Adjustment";
  }
}
