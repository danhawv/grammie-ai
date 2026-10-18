// Production wiring for the AI connector (server/routes/mcp.ts): Clerk OAuth
// token checks, the Postgres storage, credits and the enrichment jobs.

import { createClerkClient } from "@clerk/backend";
import { storage } from "../storage";
import { upsertUserFromClerk } from "../clerkAuth";
import { credits, charge, jobRefs, needCreditsBody } from "../lib/credits";
import { jobQueue } from "../job-queue";
import { mealPlanWsManager } from "../websocket";
import { createMcpRouter, mcpCors, tokenKey, type VerifiedToken } from "../routes/mcp";
import type { McpData, McpEnrichment, RecipeCard } from "./data";
import { clerkIssuer, mcpEnabled, scopesFromEnv } from "./config";

// ---------------------------------------------------------------- tokens

const TOKEN_CACHE_MS = 60_000;
const tokenCache = new Map<string, { value: VerifiedToken | null; until: number }>();

/** Checks a Clerk OAuth access token with Clerk (cached for a minute) */
async function verifyClerkOAuthToken(token: string): Promise<VerifiedToken | null> {
  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey) return null;
  const key = tokenKey(token);
  const now = Date.now();
  const hit = tokenCache.get(key);
  if (hit && hit.until > now) return hit.value;
  if (tokenCache.size > 2000) {
    for (const [k, v] of Array.from(tokenCache.entries())) if (v.until <= now) tokenCache.delete(k);
    if (tokenCache.size > 2000) tokenCache.clear();
  }

  let value: VerifiedToken | null = null;
  try {
    const clerk = createClerkClient({ secretKey });
    const t = await clerk.idPOAuthAccessToken.verify(token);
    if (t && !t.revoked && !t.expired && t.subject) {
      value = {
        subject: t.subject,
        clientId: t.clientId,
        scopes: t.scopes ?? [],
        expiresAt: t.expiration ? Math.floor(t.expiration > 1e12 ? t.expiration / 1000 : t.expiration) : undefined,
      };
    }
  } catch {
    value = null;
  }
  // Don't cache failures for long: a fresh token may just be propagating
  tokenCache.set(key, { value, until: now + (value ? TOKEN_CACHE_MS : 5_000) });
  return value;
}

let asMetadata: { value: unknown; until: number } | null = null;
async function fetchClerkAuthServerMetadata(): Promise<unknown> {
  if (asMetadata && asMetadata.until > Date.now()) return asMetadata.value;
  const issuer = clerkIssuer();
  if (!issuer) throw new Error("No Clerk issuer configured");
  const res = await fetch(`${issuer}/.well-known/oauth-authorization-server`, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`Clerk metadata answered ${res.status}`);
  const value = await res.json();
  asMetadata = { value, until: Date.now() + 60 * 60_000 };
  return value;
}

// ---------------------------------------------------------------- data

const pgData: McpData = {
  async searchRecipes(userId, { scope, filters, limit }) {
    const f = Object.keys(filters).length ? filters : undefined;
    const page = scope === "mine"
      ? await storage.getMyRecipesPaginated(userId, 1, limit, f)
      : scope === "shared"
        ? await storage.getSharedWithMePaginated(userId, 1, limit, f)
        : await storage.getAllRecipesPaginated(userId, 1, limit, f);
    return { recipes: page.recipes as unknown as RecipeCard[], total: page.total ?? page.recipes.length };
  },

  async getRecipe(recipeId, userId) {
    // Not storage.getRecipe: that lets admins see everything
    const recipe = await storage.getRecipeForJob(recipeId);
    if (!recipe) return undefined;
    if (recipe.isPublic || recipe.ownerUserId === userId) return recipe;
    const shares = await storage.getRecipeShares(recipeId);
    return shares.some((s) => s.userId === userId) ? recipe : undefined;
  },

  async listCookbooks(userId) {
    const [owned, shared] = await Promise.all([storage.getUserCookbooks(userId), storage.getCollaboratingCookbooks(userId)]);
    return { owned, shared };
  },

  async getCookbook(cookbookId, userId) {
    const cookbook = await storage.getCookbook(cookbookId, userId);
    if (!cookbook) return undefined;
    const access = cookbook.ownerUserId === userId
      ? "owner"
      : (await storage.isCookbookCollaborator(cookbookId, userId)) ? "collaborator" : "public";
    return { cookbook, access };
  },

  async getCookbookRecipes(cookbookId, limit) {
    const page = await storage.getCookbookRecipesPaginated(cookbookId, 1, limit);
    return { recipes: page.recipes as unknown as RecipeCard[], total: page.total };
  },

  getPantryItems: (userId) => storage.getPantryItems(userId),
  getRecipesForPantryMatching: (userId) => storage.getRecipesForPantryMatching(userId),
  async getPreferences(userId) {
    return (await storage.getUser(userId))?.preferences ?? null;
  },

  async getGroceryItems(userId) {
    return (await storage.getActiveGroceryList(userId))?.items ?? [];
  },
  addRecipeToGroceryList: (userId, recipeId, scale) => storage.addRecipeToGroceryList(userId, recipeId, scale),
  addGroceryItem: (userId, item) => storage.addManualItemToGroceryList(userId, item),

  async listMealPlans(userId) {
    return storage.getUserMealPlans(userId, "active", false);
  },
  async getMealPlanEntries(mealPlanId, userId) {
    const plan = await storage.getMealPlan(mealPlanId, userId);
    if (!plan) return undefined;
    return plan.entries.map((e) => ({
      id: e.id,
      date: e.date,
      mealSlot: e.mealSlot,
      position: e.position,
      recipeId: e.recipeId ?? null,
      recipeTitle: e.recipe?.title ?? null,
      customMealName: e.customMealName ?? null,
      scaledServings: e.scaledServings ?? null,
      notes: e.notes ?? null,
    }));
  },
  canEditMealPlan: (mealPlanId, userId) => storage.canEditMealPlan(mealPlanId, userId),
  async createMealPlan(plan) {
    return storage.createMealPlan({ ...plan, status: "active", isTemplate: false });
  },
  async addMealPlanEntry(entry) {
    const created = await storage.addMealPlanEntry({ ...entry, position: 0, isLeftover: false });
    try {
      mealPlanWsManager.broadcastEntryChange(entry.mealPlanId, "entry_added", created);
    } catch { /* live updates are best effort */ }
    return created;
  },

  async createRecipe(recipe) {
    const saved = await storage.createRecipe(recipe);
    return { id: saved.id, title: saved.title };
  },
};

const enrichment: McpEnrichment = {
  async canAfford(userId) {
    const c = credits();
    if (!c) return { ok: true };
    const check = await c.canAfford(userId, "recipe_import");
    if (!check.enforced || check.unlimited || check.balance === null || check.balance >= check.cost) return { ok: true };
    return { ok: false, message: needCreditsBody("recipe_import", check.balance).error };
  },
  charge: (userId, recipeId) => charge(userId, "recipe_import", jobRefs.recipeImport(recipeId)),
  queue({ id, title, ingredients }) {
    void jobQueue.addEnrichmentJob(id);
    void jobQueue.addImageGenerationJob(id, title, ingredients);
  },
};

export function mcpRouter() {
  return createMcpRouter({
    enabled: () => mcpEnabled(),
    verifyToken: verifyClerkOAuthToken,
    resolveUserId: async (clerkUserId) => (await upsertUserFromClerk(clerkUserId))?.id ?? null,
    authorizationServer: () => clerkIssuer(),
    fetchAuthServerMetadata: fetchClerkAuthServerMetadata,
    publicOrigin: () => process.env.PUBLIC_URL || undefined,
    scopes: scopesFromEnv(),
    data: pgData,
    enrichment,
    writesEnabled: () => process.env.MCP_READ_ONLY !== "true",
  });
}

export function mcpCorsMiddleware() {
  return mcpCors(() => mcpEnabled());
}
