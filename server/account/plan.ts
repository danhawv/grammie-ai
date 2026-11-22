// "Delete my account" (Apple guideline 5.1.1(v)): every table column that
// points at a user, and what happens to its rows when that user goes.
//
// Nearly every one of these foreign keys is ON DELETE CASCADE already
// (migrations/*.sql, shared/schema.ts), so deleting the users row alone would
// clear most of it. The deletion still walks this list explicitly, inside one
// transaction, so it doesn't depend on the live database's constraints
// matching the files, and so the audit line can say how much went.
//
// account/plan.test.ts fails when a table gains a column that references
// users (in shared/schema.ts or a migrations/*.sql file) and isn't listed
// here. Children of these tables (cookbook_recipes, grocery_list_items,
// party_slots, party_dishes, prep_checkins, meal_prep_recipe_facts, ...) go
// with their parent rows through their own ON DELETE CASCADE.

export type DeletionAction =
  /** Delete the rows */
  | "delete"
  /** Keep the rows (they belong to someone else) and clear the reference */
  | "nullify";

export interface DeletionStep {
  table: string;
  column: string;
  action: DeletionAction;
  /** What this is, in plain words (for the audit and the docs) */
  what: string;
}

/**
 * In order: things inside other things first, the users row last. Table and
 * column names are fixed here and never come from a request.
 */
export const DELETION_STEPS: readonly DeletionStep[] = [
  // Parties: places at other people's parties (and the dishes they brought), then parties they host
  { table: "party_guests", column: "user_id", action: "delete", what: "places at parties" },
  { table: "parties", column: "owner_user_id", action: "delete", what: "parties they host" },
  { table: "guest_sessions", column: "user_id", action: "delete", what: "guest device tokens" },

  // Meal prep
  { table: "prep_plans", column: "owner_user_id", action: "delete", what: "meal-prep plans (and their shares, progress, check-ins)" },
  { table: "prep_profiles", column: "owner_user_id", action: "delete", what: "meal-prep answers" },

  // Meal plans
  { table: "meal_plan_invitations", column: "inviter_user_id", action: "delete", what: "meal-plan invitations they sent" },
  { table: "meal_plan_invitations", column: "invitee_user_id", action: "delete", what: "meal-plan invitations to them" },
  { table: "meal_plan_collaborators", column: "user_id", action: "delete", what: "places on shared meal plans" },
  { table: "meal_plan_collaborators", column: "added_by_user_id", action: "delete", what: "people they added to meal plans" },
  { table: "meal_plan_entries", column: "assigned_user_id", action: "nullify", what: "\"who's cooking\" on other people's meal plans" },
  { table: "meal_plans", column: "owner_user_id", action: "delete", what: "meal plans" },

  // Grocery list and pantry
  { table: "grocery_list_collaborators", column: "user_id", action: "delete", what: "places on shared grocery lists" },
  { table: "grocery_list_shares", column: "created_by_user_id", action: "delete", what: "grocery list share links" },
  { table: "grocery_lists", column: "user_id", action: "delete", what: "grocery lists (and items)" },
  { table: "pantry_scan_sessions", column: "user_id", action: "delete", what: "pantry photo scans" },
  { table: "pantry_staples", column: "user_id", action: "delete", what: "pantry staples" },
  { table: "pantry_items", column: "user_id", action: "delete", what: "pantry items" },

  // Cookbooks and recipes: sharing first
  { table: "cookbook_invitations", column: "inviter_user_id", action: "delete", what: "cookbook invitations they sent" },
  { table: "cookbook_invitations", column: "invitee_user_id", action: "delete", what: "cookbook invitations to them" },
  { table: "cookbook_collaborators", column: "user_id", action: "delete", what: "places on shared cookbooks" },
  { table: "cookbook_collaborators", column: "added_by_user_id", action: "delete", what: "people they added to cookbooks" },
  { table: "cookbook_follows", column: "user_id", action: "delete", what: "cookbooks they follow" },
  { table: "bookmarks", column: "user_id", action: "delete", what: "saved recipes" },
  { table: "recipe_shares", column: "user_id", action: "delete", what: "recipe shares" },

  // Printing (in-progress orders block deletion before this runs)
  { table: "print_orders", column: "owner_user_id", action: "delete", what: "finished print orders" },
  { table: "cookbook_print_projects", column: "owner_user_id", action: "delete", what: "print designs" },
  { table: "custom_templates", column: "owner_user_id", action: "delete", what: "custom print templates (and their uploaded fonts and backgrounds)" },
  { table: "cookbook_photos", column: "owner_user_id", action: "delete", what: "cookbook photos" },

  // Importing
  { table: "bulk_intake_photos", column: "owner_user_id", action: "delete", what: "bulk-import photos" },
  { table: "bulk_intakes", column: "owner_user_id", action: "delete", what: "bulk imports" },
  { table: "recipe_imports", column: "owner_user_id", action: "delete", what: "import originals" },
  { table: "upload_sessions", column: "user_id", action: "delete", what: "upload batches" },
  { table: "voice_sessions", column: "user_id", action: "delete", what: "voice sessions" },

  // Their recipes (removed from any cookbook they were in, theirs or anyone's) and cookbooks
  { table: "recipes", column: "owner_user_id", action: "delete", what: "recipes (and their photos)" },
  { table: "cookbooks", column: "owner_user_id", action: "delete", what: "cookbooks" },

  // Credits
  { table: "credit_ledger", column: "user_id", action: "delete", what: "credit history" },
  { table: "apple_transactions", column: "user_id", action: "delete", what: "App Store credit purchases" },
  { table: "credit_balances", column: "user_id", action: "delete", what: "credits balance" },

  // Sign-in
  { table: "auth_credentials", column: "user_id", action: "delete", what: "sign-in links" },
];

/**
 * Invitations sent to the person's email address before they had an account
 * (no user id yet): they hold the email, so they go too.
 */
export const EMAIL_STEPS: readonly { table: string; column: string }[] = [
  { table: "cookbook_invitations", column: "invitee_email" },
  { table: "meal_plan_invitations", column: "invitee_email" },
];

/** Image columns that can hold /media/<key> files (MEDIA_STORAGE=disk; scripts/migrate-media.ts) */
export const MEDIA_COLUMNS: readonly { table: string; column: string; json?: boolean }[] = [
  { table: "recipes", column: "dish_image" },
  { table: "recipes", column: "dish_image_thumbnail" },
  { table: "recipes", column: "dish_image_print" },
  { table: "recipes", column: "handwritten_image" },
  { table: "custom_templates", column: "background_image" },
  { table: "custom_templates", column: "custom_fonts", json: true },
];

/** The owner column for each MEDIA_COLUMNS table */
export const MEDIA_OWNER: Record<string, string> = {
  recipes: "owner_user_id",
  custom_templates: "owner_user_id",
};

/** /media/<key> keys mentioned in some stored values (a URL or a JSON blob) */
export function mediaKeysIn(values: unknown[]): string[] {
  const keys = new Set<string>();
  for (const v of values) {
    if (v == null) continue;
    const text = typeof v === "string" ? v : JSON.stringify(v);
    for (const m of Array.from(text.matchAll(/\/media\/([A-Za-z0-9_.-]+)/g))) {
      const key = m[1];
      if (!key.includes("..")) keys.add(key);
    }
  }
  return Array.from(keys);
}

/**
 * Print orders that are still being paid for, printed or shipped. While one
 * is, the account can't be deleted: the order needs the account to finish (or
 * to be refunded). Orders that shipped, failed, were refunded or canceled
 * don't block. An unpaid checkout lasts an hour (lib/print-orders.ts), so
 * one that's older than two hours no longer counts.
 */
export function printOrderInProgress(
  order: { status: string; luluStatus: string | null; updatedAt: Date },
  now: Date = new Date(),
): boolean {
  const STALE_MS = 2 * 60 * 60 * 1000;
  switch (order.status) {
    case "preparing":
    case "awaiting_payment":
      return now.getTime() - order.updatedAt.getTime() < STALE_MS;
    case "paid":
      return true;
    case "submitted":
      return !["SHIPPED", "REJECTED", "CANCELED"].includes((order.luluStatus || "").toUpperCase());
    default:
      return false;
  }
}

export interface DeletionResult {
  /** Rows deleted or cleared, per "table.column" */
  counts: Record<string, number>;
  /** Steps skipped because the table or column isn't in this database */
  skipped: string[];
  /** The Clerk user id (users.clerk_id), when the account signed in with Clerk */
  clerkId: string | null;
  /** /media/ files the deleted rows used (only some may be safe to remove) */
  mediaKeys: string[];
}
