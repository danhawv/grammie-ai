import { db } from "./db";
import { eq, and, or, asc, desc, inArray, sql, getTableColumns } from "drizzle-orm";
import {
  type Recipe,
  type RecipeListItem,
  type RecipeCardData,
  type PaginatedRecipes,
  type InsertRecipe,
  type User,
  type UpsertUser,
  type Cookbook,
  type CookbookWithCount,
  type InsertCookbook,
  type InsertCookbookRecipe,
  type InsertRecipeShare,
  type InsertCookbookFollow,
  type CookbookRecipe,
  type RecipeShare,
  type CookbookFollow,
  type AuthCredential,
  type InsertAuthCredential,
  type UploadSession,
  type InsertUploadSession,
  type UploadSessionWithRecipes,
  type GroceryList,
  type GroceryListWithItems,
  type GroceryListItem,
  type GroceryListItemsByAisle,
  type InsertGroceryList,
  type InsertGroceryListItem,
  type PantryItem,
  type InsertPantryItem,
  type PantryScanSession,
  type InsertPantryScanSession,
  type GroceryListShare,
  type InsertGroceryListShare,
  type GroceryListCollaborator,
  type InsertGroceryListCollaborator,
  type CookbookPrintProject,
  type InsertCookbookPrintProject,
  type PrintLayoutData,
  type PreflightWarning,
  type CookbookCollaborator,
  type CookbookCollaboratorWithUser,
  type InsertCookbookCollaborator,
  type CookbookInvitation,
  type CookbookInvitationWithDetails,
  type InsertCookbookInvitation,
  recipes,
  users,
  cookbooks,
  cookbookRecipes,
  cookbookPrintProjects,
  recipeShares,
  cookbookFollows,
  cookbookCollaborators,
  cookbookInvitations,
  bookmarks,
  authCredentials,
  uploadSessions,
  groceryLists,
  groceryListItems,
  pantryItems,
  pantryScanSessions,
  groceryListShares,
  groceryListCollaborators,
} from "@shared/schema";

export interface RecipeFilterParams {
  mealTypes?: string[];
  cuisines?: string[];
  cookingMethods?: string[];
  skillLevels?: string[];
  seasons?: string[];
  excludeAllergens?: string[];
  timeConvenience?: string[];
  dietary?: {
    vegetarian?: boolean;
    vegan?: boolean;
    pescatarian?: boolean;
    glutenFree?: boolean;
    dairyFree?: boolean;
    keto?: boolean;
    paleo?: boolean;
    lowCarb?: boolean;
    highProtein?: boolean;
    lowCalorie?: boolean;
    highFiber?: boolean;
    mediterranean?: boolean;
  };
  search?: string;
  sortBy?: string;
  budgetFriendly?: boolean;
  fewIngredients?: boolean;
  onePot?: boolean;
  airFryer?: boolean;
}

export interface IStorage {
  // User operations
  getUser(id: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  getUserByClerkId(clerkId: string): Promise<User | undefined>;
  upsertUser(user: UpsertUser): Promise<User>;
  updateUser(id: string, updates: Partial<User>): Promise<User | undefined>;
  
  // Auth credential operations
  createAuthCredential(credential: InsertAuthCredential): Promise<AuthCredential>;
  getAuthCredentialByProvider(provider: string, providerUserId: string): Promise<AuthCredential | undefined>;
  getAuthCredentialsByUserId(userId: string): Promise<AuthCredential[]>;
  
  // Recipe operations
  getRecipe(id: string, userId?: string): Promise<Recipe | undefined>;
  getAllRecipes(userId?: string): Promise<RecipeListItem[]>;
  getMyRecipes(userId: string): Promise<RecipeListItem[]>;
  getPublicRecipes(): Promise<RecipeListItem[]>;
  getSharedWithMe(userId: string): Promise<RecipeListItem[]>;
  getRecipesByCreator(creatorId: string): Promise<RecipeListItem[]>;
  
  // Paginated recipe operations (lean queries for performance)
  getAllRecipesPaginated(userId?: string, page?: number, limit?: number, filters?: RecipeFilterParams): Promise<PaginatedRecipes>;
  getMyRecipesPaginated(userId: string, page?: number, limit?: number, filters?: RecipeFilterParams): Promise<PaginatedRecipes>;
  getPublicRecipesPaginated(page?: number, limit?: number, filters?: RecipeFilterParams): Promise<PaginatedRecipes>;
  getSharedWithMePaginated(userId: string, page?: number, limit?: number, filters?: RecipeFilterParams): Promise<PaginatedRecipes>;
  getRecipesByCreatorPaginated(creatorId: string, page?: number, limit?: number, filters?: RecipeFilterParams): Promise<PaginatedRecipes>;
  getRecipesByCookbooksPaginated(userId: string, cookbookIds: number[], page?: number, limit?: number, filters?: RecipeFilterParams): Promise<PaginatedRecipes>;
  
  createRecipe(recipe: InsertRecipe): Promise<Recipe>;
  updateRecipe(id: string, recipe: Partial<InsertRecipe>, userId?: string): Promise<Recipe | undefined>;
  deleteRecipe(id: string, userId?: string): Promise<boolean>;
  forkRecipe(recipeId: string, userId: string): Promise<Recipe>;
  
  // Cookbook operations
  getCookbook(id: number, userId?: string): Promise<Cookbook | undefined>;
  getUserCookbooks(userId: string): Promise<CookbookWithCount[]>;
  getPublicCookbooks(): Promise<CookbookWithCount[]>;
  getFollowedCookbooks(userId: string): Promise<CookbookWithCount[]>;
  createCookbook(cookbook: InsertCookbook): Promise<Cookbook>;
  updateCookbook(id: number, cookbook: Partial<InsertCookbook>, userId: string): Promise<Cookbook | undefined>;
  deleteCookbook(id: number, userId: string): Promise<boolean>;
  
  // Cookbook recipe operations
  addRecipeToCookbook(cookbookId: number, recipeId: string, position?: number): Promise<void>;
  removeRecipeFromCookbook(cookbookId: number, recipeId: string): Promise<boolean>;
  getCookbookRecipes(cookbookId: number): Promise<RecipeListItem[]>;
  getCookbookRecipesPaginated(cookbookId: number, page?: number, limit?: number): Promise<{ recipes: RecipeListItem[]; total: number; hasMore: boolean }>;
  reorderCookbookRecipes(cookbookId: number, recipePositions: { recipeId: string; position: number }[]): Promise<void>;
  
  // Bulk operations
  bulkAddRecipesToCookbook(cookbookId: number, recipeIds: string[], userId: string): Promise<{ success: boolean; added: number; errors: string[] }>;
  bulkDeleteRecipes(recipeIds: string[], userId: string, isAdmin?: boolean): Promise<{ success: boolean; deleted: number; errors: string[] }>;
  
  // Recipe sharing operations
  shareRecipe(recipeId: string, userId: string, role: 'viewer' | 'editor'): Promise<void>;
  unshareRecipe(recipeId: string, userId: string): Promise<boolean>;
  getRecipeShares(recipeId: string): Promise<RecipeShare[]>;
  
  // Cookbook following operations
  followCookbook(cookbookId: number, userId: string): Promise<void>;
  unfollowCookbook(cookbookId: number, userId: string): Promise<boolean>;
  getCookbookFollowers(cookbookId: number): Promise<User[]>;
  isFollowingCookbook(cookbookId: number, userId: string): Promise<boolean>;
  
  // Cookbook collaboration operations
  getCookbookCollaborators(cookbookId: number): Promise<import("@shared/schema").CookbookCollaboratorWithUser[]>;
  addCookbookCollaborator(collaborator: import("@shared/schema").InsertCookbookCollaborator): Promise<import("@shared/schema").CookbookCollaborator>;
  removeCookbookCollaborator(cookbookId: number, userId: string, requesterId: string): Promise<boolean>;
  isCookbookCollaborator(cookbookId: number, userId: string): Promise<boolean>;
  canEditCookbook(cookbookId: number, userId: string): Promise<boolean>;
  
  // Cookbook invitation operations
  createCookbookInvitation(invitation: import("@shared/schema").InsertCookbookInvitation): Promise<import("@shared/schema").CookbookInvitation>;
  getCookbookInvitations(cookbookId: number): Promise<import("@shared/schema").CookbookInvitation[]>;
  getUserPendingInvitations(userId: string): Promise<import("@shared/schema").CookbookInvitationWithDetails[]>;
  getCookbookInvitationByToken(token: string): Promise<import("@shared/schema").CookbookInvitationWithDetails | undefined>;
  respondToInvitation(invitationId: number, userId: string, accept: boolean): Promise<boolean>;
  cancelCookbookInvitation(invitationId: number, requesterId: string): Promise<boolean>;
  findUserByEmailOrUsername(query: string): Promise<User | undefined>;
  
  // Upload session operations (for multi-image uploads)
  createUploadSession(session: InsertUploadSession): Promise<UploadSession>;
  getUploadSession(id: string, userId?: string): Promise<UploadSession | undefined>;
  getUploadSessionWithRecipes(id: string, userId?: string): Promise<UploadSessionWithRecipes | undefined>;
  updateUploadSessionProgress(id: string, completed: number, failed: number): Promise<void>;
  completeUploadSession(id: string): Promise<void>;
  
  // Grocery list operations
  getActiveGroceryList(userId: string): Promise<GroceryListWithItems | undefined>;
  createGroceryList(list: InsertGroceryList): Promise<GroceryList>;
  addRecipeToGroceryList(userId: string, recipeId: string): Promise<void>;
  addManualItemToGroceryList(userId: string, item: Partial<InsertGroceryListItem>): Promise<void>;
  toggleGroceryListItem(itemId: string, userId: string, checked: boolean): Promise<void>;
  removeItemFromGroceryList(itemId: string, userId: string): Promise<boolean>;
  clearGroceryList(userId: string): Promise<void>;
  getGroceryListItemsByAisle(userId: string): Promise<GroceryListItemsByAisle[]>;
  
  // Bookmark operations
  getBookmarkedRecipes(userId: string): Promise<RecipeCardData[]>;
  getBookmarkedRecipeIds(userId: string): Promise<string[]>;
  isRecipeBookmarked(userId: string, recipeId: string): Promise<boolean>;
  addBookmark(userId: string, recipeId: string): Promise<void>;
  removeBookmark(userId: string, recipeId: string): Promise<void>;
  
  // Pantry operations
  getPantryItems(userId: string): Promise<PantryItem[]>;
  getPantryItemsByCategory(userId: string): Promise<{ category: string; items: PantryItem[] }[]>;
  addPantryItem(item: InsertPantryItem): Promise<PantryItem>;
  updatePantryItem(id: string, item: Partial<InsertPantryItem>, userId: string): Promise<PantryItem | undefined>;
  deletePantryItem(id: string, userId: string): Promise<boolean>;
  bulkAddPantryItems(items: InsertPantryItem[]): Promise<PantryItem[]>;
  clearPantry(userId: string): Promise<void>;
  
  // Pantry scan session operations
  createPantryScanSession(session: InsertPantryScanSession): Promise<PantryScanSession>;
  getPantryScanSession(id: string, userId: string): Promise<PantryScanSession | undefined>;
  updatePantryScanSession(id: string, updates: Partial<PantryScanSession>): Promise<PantryScanSession | undefined>;
  
  // Grocery list sharing operations
  createGroceryListShare(share: InsertGroceryListShare): Promise<GroceryListShare>;
  getGroceryListShareByToken(token: string): Promise<GroceryListShare | undefined>;
  getGroceryListShareById(shareId: string, userId: string): Promise<GroceryListShare | undefined>;
  getGroceryListShares(listId: string, userId: string): Promise<GroceryListShare[]>;
  revokeGroceryListShare(shareId: string, userId: string): Promise<boolean>;
  updateShareAccessCount(shareId: string): Promise<void>;
  
  // Grocery list collaborator operations
  addCollaborator(collaborator: InsertGroceryListCollaborator): Promise<GroceryListCollaborator>;
  getActiveCollaborators(shareId: string): Promise<GroceryListCollaborator[]>;
  updateCollaboratorLastSeen(collaboratorId: string): Promise<void>;
  removeCollaborator(collaboratorId: string): Promise<boolean>;
  
  // Shared grocery list operations (for public access)
  getSharedGroceryList(token: string): Promise<GroceryListWithItems | undefined>;
  toggleSharedGroceryListItem(token: string, itemId: string, checked: boolean): Promise<void>;
  verifyItemBelongsToList(itemId: string, listId: string): Promise<boolean>;
  
  // Cookbook print project operations
  createPrintProject(project: InsertCookbookPrintProject): Promise<CookbookPrintProject>;
  getPrintProject(id: number, userId: string): Promise<CookbookPrintProject | undefined>;
  getPrintProjectsByCookbook(cookbookId: number, userId: string): Promise<CookbookPrintProject[]>;
  getPrintProjectsByUser(userId: string): Promise<CookbookPrintProject[]>;
  updatePrintProject(id: number, updates: Partial<InsertCookbookPrintProject>, userId: string): Promise<CookbookPrintProject | undefined>;
  deletePrintProject(id: number, userId: string): Promise<boolean>;
  updatePrintProjectPreflight(id: number, status: 'pending' | 'passed' | 'warnings' | 'failed', warnings?: PreflightWarning[]): Promise<void>;
  updatePrintProjectPdf(id: number, pdfUrl: string): Promise<void>;
  updatePrintProjectLuluOrder(id: number, orderId: string, status: string): Promise<void>;
}

export class PostgresStorage implements IStorage {
  // ========== HELPER METHODS ==========
  
  /**
   * Enrich recipes with cookbook information
   */
  private async enrichRecipesWithCookbooks(recipesWithOwner: RecipeListItem[]): Promise<RecipeListItem[]> {
    if (recipesWithOwner.length === 0) return [];
    
    try {
      const recipeIds = recipesWithOwner.map(r => r.id);
      const cookbookRels = await db
        .select({
          recipeId: cookbookRecipes.recipeId,
          cookbook: {
            id: cookbooks.id,
            name: cookbooks.name,
          },
        })
        .from(cookbookRecipes)
        .innerJoin(cookbooks, eq(cookbookRecipes.cookbookId, cookbooks.id))
        .where(inArray(cookbookRecipes.recipeId, recipeIds));
      
      const cookbooksByRecipe = new Map<string, { id: number; name: string }[]>();
      for (const rel of cookbookRels) {
        if (!cookbooksByRecipe.has(rel.recipeId)) {
          cookbooksByRecipe.set(rel.recipeId, []);
        }
        cookbooksByRecipe.get(rel.recipeId)!.push(rel.cookbook);
      }
      
      return recipesWithOwner.map(recipe => ({
        ...recipe,
        cookbooks: cookbooksByRecipe.get(recipe.id) || [],
      }));
    } catch (err) {
      console.warn("Failed to enrich recipes with cookbooks, returning without cookbook data:", err);
      return recipesWithOwner;
    }
  }
  
  // ========== USER OPERATIONS ==========
  
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.email, email));
    return user;
  }

  async getUserByClerkId(clerkId: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.clerkId, clerkId));
    return user;
  }

  async updateUser(id: string, updates: Partial<User>): Promise<User | undefined> {
    const now = new Date();
    const [user] = await db
      .update(users)
      .set({ ...updates, updatedAt: now } as any)
      .where(eq(users.id, id))
      .returning();
    return user;
  }

  async upsertUser(userData: UpsertUser): Promise<User> {
    const now = new Date();
    
    // Check if email should have admin privileges
    const adminEmails = process.env.ADMIN_EMAILS?.split(',').map(e => e.trim().toLowerCase()) || [];
    const isAdminEmail = userData.email ? adminEmails.includes(userData.email.toLowerCase()) : false;
    
    const [user] = await db
      .insert(users)
      .values([{ ...userData, isAdmin: isAdminEmail } as any])
      .onConflictDoUpdate({
        target: users.id,
        set: {
          email: userData.email,
          firstName: userData.firstName,
          lastName: userData.lastName,
          profileImageUrl: userData.profileImageUrl,
          isAdmin: isAdminEmail,
          updatedAt: now,
        },
      })
      .returning();
    return user;
  }

  // ========== AUTH CREDENTIAL OPERATIONS ==========
  
  async createAuthCredential(credential: InsertAuthCredential): Promise<AuthCredential> {
    const [authCred] = await db
      .insert(authCredentials)
      .values([credential as any])
      .returning();
    return authCred;
  }

  async getAuthCredentialByProvider(provider: string, providerUserId: string): Promise<AuthCredential | undefined> {
    const [authCred] = await db
      .select()
      .from(authCredentials)
      .where(and(
        eq(authCredentials.provider, provider as any),
        eq(authCredentials.providerUserId, providerUserId)
      ));
    return authCred;
  }

  async getAuthCredentialsByUserId(userId: string): Promise<AuthCredential[]> {
    return await db
      .select()
      .from(authCredentials)
      .where(eq(authCredentials.userId, userId));
  }

  // ========== RECIPE OPERATIONS ==========
  
  async getRecipe(id: string, userId?: string): Promise<Recipe | undefined> {
    const [recipe] = await db.select().from(recipes).where(eq(recipes.id, id));
    
    if (!recipe) return undefined;
    
    // Check access permissions
    if (!recipe.isPublic) {
      // Private recipe - must be owner, have share access, or be admin
      if (!userId) return undefined;
      if (recipe.ownerUserId !== userId) {
        // Check if user is admin
        const [user] = await db.select().from(users).where(eq(users.id, userId));
        if (user?.isAdmin) {
          // Admins can view any recipe
          return recipe;
        }
        
        // Not admin, check for share access
        const shares = await db.select().from(recipeShares)
          .where(and(eq(recipeShares.recipeId, id), eq(recipeShares.userId, userId)));
        if (shares.length === 0) return undefined;
      }
    }
    
    return recipe;
  }

  // Minimal fields for recipe cards (ultra-lean for pagination + quick filters)
  private getCardFields() {
    return {
      id: recipes.id,
      title: recipes.title,
      description: recipes.description,
      totalTime: recipes.totalTime,
      prepTime: recipes.prepTime,
      servings: recipes.servings,
      dishImageThumbnail: recipes.dishImageThumbnail,
      enrichmentStatus: recipes.enrichmentStatus,
      imageGenerationStatus: recipes.imageGenerationStatus,
      ownerUserId: recipes.ownerUserId,
      isPublic: recipes.isPublic,
      createdAt: recipes.createdAt,
      
      // Numeric time fields for display
      prepTimeMinutes: recipes.prepTimeMinutes,
      cookTimeMinutes: recipes.cookTimeMinutes,
      totalTimeMinutes: recipes.totalTimeMinutes,
      
      // Fields for quick filters
      timeConvenienceTags: recipes.timeConvenienceTags,
      isHighProtein: recipes.isHighProtein,
      isVegetarian: recipes.isVegetarian,
      isVegan: recipes.isVegan,
      isGlutenFree: recipes.isGlutenFree,
      isDairyFree: recipes.isDairyFree,
      
      // Fields for advanced filters
      mealType: recipes.mealType,
      cuisines: recipes.cuisines,
      cookingMethods: recipes.cookingMethods,
      skillLevel: recipes.skillLevel,
      isKeto: recipes.isKeto,
      isPaleo: recipes.isPaleo,
      isLowCarb: recipes.isLowCarb,
      isLowCalorie: recipes.isLowCalorie,
      isHighFiber: recipes.isHighFiber,
      isMediterranean: recipes.isMediterranean,
      isPescatarian: recipes.isPescatarian,
      allergens: recipes.allergens,
      seasonTags: recipes.seasonTags,
      occasionTags: recipes.occasionTags,
    };
  }

  /**
   * Build case variants for array overlap matching.
   * Returns an array containing the lowercase, Title Case, and UPPERCASE
   * versions of each value to handle case-insensitive matching with GIN indexes.
   */
  private buildCaseVariants(values: string[]): string[] {
    const variants = new Set<string>();
    for (const v of values) {
      variants.add(v.toLowerCase());
      variants.add(v.charAt(0).toUpperCase() + v.slice(1).toLowerCase());
      variants.add(v); // original case
    }
    return Array.from(variants);
  }

  private buildFilterConditions(filters?: RecipeFilterParams): ReturnType<typeof and>[] {
    if (!filters) return [];
    const conditions: any[] = [];

    if (filters.search) {
      const searchLower = `%${filters.search.toLowerCase()}%`;
      conditions.push(
        or(
          sql`lower(${recipes.title}) LIKE ${searchLower}`,
          sql`lower(${recipes.description}) LIKE ${searchLower}`
        )
      );
    }

    if (filters.mealTypes && filters.mealTypes.length > 0) {
      // Use array overlap (&&) for GIN index compatibility
      // Include both original case and lowercase variants for case-insensitive matching
      const variants = this.buildCaseVariants(filters.mealTypes);
      conditions.push(
        sql`${recipes.mealType} ${sql.raw('&&')} ARRAY[${sql.join(variants.map(v => sql`${v}`), sql`, `)}]::text[]`
      );
    }

    if (filters.cuisines && filters.cuisines.length > 0) {
      const variants = this.buildCaseVariants(filters.cuisines);
      conditions.push(
        sql`${recipes.cuisines} ${sql.raw('&&')} ARRAY[${sql.join(variants.map(v => sql`${v}`), sql`, `)}]::text[]`
      );
    }

    if (filters.cookingMethods && filters.cookingMethods.length > 0) {
      const variants = this.buildCaseVariants(filters.cookingMethods);
      conditions.push(
        sql`${recipes.cookingMethods} ${sql.raw('&&')} ARRAY[${sql.join(variants.map(v => sql`${v}`), sql`, `)}]::text[]`
      );
    }

    if (filters.skillLevels && filters.skillLevels.length > 0) {
      const skillConditions = filters.skillLevels.map(s =>
        sql`lower(${recipes.skillLevel}) = ${s.toLowerCase()}`
      );
      conditions.push(or(...skillConditions));
    }

    if (filters.seasons && filters.seasons.length > 0) {
      const variants = this.buildCaseVariants(filters.seasons);
      conditions.push(
        sql`${recipes.seasonTags} ${sql.raw('&&')} ARRAY[${sql.join(variants.map(v => sql`${v}`), sql`, `)}]::text[]`
      );
    }

    if (filters.timeConvenience && filters.timeConvenience.length > 0) {
      const variants = this.buildCaseVariants(filters.timeConvenience);
      conditions.push(
        sql`${recipes.timeConvenienceTags} ${sql.raw('&&')} ARRAY[${sql.join(variants.map(v => sql`${v}`), sql`, `)}]::text[]`
      );
    }

    if (filters.excludeAllergens && filters.excludeAllergens.length > 0) {
      // NOT overlap: exclude recipes that contain ANY of the specified allergens
      const variants = this.buildCaseVariants(filters.excludeAllergens);
      conditions.push(
        sql`NOT (${recipes.allergens} ${sql.raw('&&')} ARRAY[${sql.join(variants.map(v => sql`${v}`), sql`, `)}]::text[])`
      );
    }

    if (filters.dietary) {
      if (filters.dietary.vegetarian) conditions.push(eq(recipes.isVegetarian, true));
      if (filters.dietary.vegan) conditions.push(eq(recipes.isVegan, true));
      if (filters.dietary.pescatarian) conditions.push(eq(recipes.isPescatarian, true));
      if (filters.dietary.glutenFree) conditions.push(eq(recipes.isGlutenFree, true));
      if (filters.dietary.dairyFree) conditions.push(eq(recipes.isDairyFree, true));
      if (filters.dietary.keto) conditions.push(eq(recipes.isKeto, true));
      if (filters.dietary.paleo) conditions.push(eq(recipes.isPaleo, true));
      if (filters.dietary.lowCarb) conditions.push(eq(recipes.isLowCarb, true));
      if (filters.dietary.highProtein) conditions.push(eq(recipes.isHighProtein, true));
      if (filters.dietary.lowCalorie) conditions.push(eq(recipes.isLowCalorie, true));
      if (filters.dietary.highFiber) conditions.push(eq(recipes.isHighFiber, true));
      if (filters.dietary.mediterranean) conditions.push(eq(recipes.isMediterranean, true));
    }

    if (filters.budgetFriendly) {
      conditions.push(
        or(
          sql`lower(${recipes.priceCategory}) IN ('budget', '$')`,
          sql`${recipes.totalCost} IS NOT NULL AND ${recipes.totalCost} <= 15`
        )
      );
    }

    if (filters.fewIngredients) {
      conditions.push(
        sql`array_length(${recipes.ingredients}, 1) <= 5`
      );
    }

    if (filters.onePot) {
      // Use array overlap (&&) for GIN index compatibility
      const onePotVariants = [
        'One-Pot', 'one-pot', 'One-Pan', 'one-pan', 'Sheet Pan', 'sheet pan',
        'Slow-Cooking', 'slow-cooking', 'Slow Cooking', 'slow cooking',
        'One Pot', 'one pot', 'One Pan', 'one pan',
      ];
      conditions.push(
        sql`${recipes.cookingMethods} ${sql.raw('&&')} ARRAY[${sql.join(onePotVariants.map(v => sql`${v}`), sql`, `)}]::text[]`
      );
    }

    if (filters.airFryer) {
      // Use array overlap (&&) for GIN index compatibility
      const airFryerVariants = [
        'Air Frying', 'air frying', 'Air Fryer', 'air fryer',
        'Air-Frying', 'air-frying', 'Air-Fryer', 'air-fryer',
      ];
      conditions.push(
        sql`${recipes.cookingMethods} ${sql.raw('&&')} ARRAY[${sql.join(airFryerVariants.map(v => sql`${v}`), sql`, `)}]::text[]`
      );
    }

    return conditions;
  }

  private getSortOrder(sortBy?: string) {
    switch (sortBy) {
      case 'oldest': return asc(recipes.createdAt);
      case 'a-z': return asc(recipes.title);
      case 'z-a': return desc(recipes.title);
      case 'quickest': return sql`COALESCE(${recipes.totalTimeMinutes}, 9999) ASC`;
      case 'longest': return sql`COALESCE(${recipes.totalTimeMinutes}, 0) DESC`;
      case 'newest':
      default: return desc(recipes.createdAt);
    }
  }

  async getFilterCounts(baseCondition: ReturnType<typeof and>, filters?: RecipeFilterParams): Promise<Record<string, Record<string, number>>> {
    const filterConditions = this.buildFilterConditions(filters);
    const whereClause = filterConditions.length > 0
      ? and(baseCondition, ...filterConditions)
      : baseCondition;

    const wc = whereClause ?? sql`true`;

    const countByArray = async (arrayCol: string) => {
      const result = await db.execute(sql`
        SELECT val AS value, COUNT(*)::int AS count
        FROM (
          SELECT unnest(${sql.raw(arrayCol)}) AS val
          FROM ${recipes}
          WHERE ${wc}
        ) sub
        WHERE val IS NOT NULL
        GROUP BY val ORDER BY count DESC
      `);
      return result.rows;
    };

    const [mealTypeRows, cuisineRows, methodRows, seasonRows, timeRows] = await Promise.all([
      countByArray('meal_type'),
      countByArray('cuisines'),
      countByArray('cooking_methods'),
      countByArray('season_tags'),
      countByArray('time_convenience_tags'),
    ]);

    const [skillRows] = await Promise.all([
      db.select({
        value: recipes.skillLevel,
        count: sql<number>`count(*)::int`,
      })
        .from(recipes)
        .where(and(wc, sql`${recipes.skillLevel} IS NOT NULL`))
        .groupBy(recipes.skillLevel),
    ]);

    const [dietaryResult] = await db.select({
      vegetarian: sql<number>`SUM(CASE WHEN ${recipes.isVegetarian} = true THEN 1 ELSE 0 END)::int`,
      vegan: sql<number>`SUM(CASE WHEN ${recipes.isVegan} = true THEN 1 ELSE 0 END)::int`,
      pescatarian: sql<number>`SUM(CASE WHEN ${recipes.isPescatarian} = true THEN 1 ELSE 0 END)::int`,
      glutenFree: sql<number>`SUM(CASE WHEN ${recipes.isGlutenFree} = true THEN 1 ELSE 0 END)::int`,
      dairyFree: sql<number>`SUM(CASE WHEN ${recipes.isDairyFree} = true THEN 1 ELSE 0 END)::int`,
      keto: sql<number>`SUM(CASE WHEN ${recipes.isKeto} = true THEN 1 ELSE 0 END)::int`,
      paleo: sql<number>`SUM(CASE WHEN ${recipes.isPaleo} = true THEN 1 ELSE 0 END)::int`,
      lowCarb: sql<number>`SUM(CASE WHEN ${recipes.isLowCarb} = true THEN 1 ELSE 0 END)::int`,
      highProtein: sql<number>`SUM(CASE WHEN ${recipes.isHighProtein} = true THEN 1 ELSE 0 END)::int`,
      lowCalorie: sql<number>`SUM(CASE WHEN ${recipes.isLowCalorie} = true THEN 1 ELSE 0 END)::int`,
      highFiber: sql<number>`SUM(CASE WHEN ${recipes.isHighFiber} = true THEN 1 ELSE 0 END)::int`,
      mediterranean: sql<number>`SUM(CASE WHEN ${recipes.isMediterranean} = true THEN 1 ELSE 0 END)::int`,
    }).from(recipes).where(wc);

    const toMap = (rows: any[]) => {
      const m: Record<string, number> = {};
      for (const row of rows) {
        if (row.value) m[row.value] = row.count;
      }
      return m;
    };

    return {
      mealTypes: toMap(mealTypeRows as any[]),
      cuisines: toMap(cuisineRows as any[]),
      cookingMethods: toMap(methodRows as any[]),
      skillLevels: toMap(skillRows as any[]),
      seasons: toMap(seasonRows as any[]),
      timeConvenience: toMap(timeRows as any[]),
      dietary: dietaryResult || {},
    };
  }

  // Reusable field selection for list queries - includes all fields needed for filtering
  private getListFields() {
    return {
      id: recipes.id,
      title: recipes.title,
      description: recipes.description,
      totalTime: recipes.totalTime,
      prepTime: recipes.prepTime,
      servings: recipes.servings,
      dishImageThumbnail: recipes.dishImageThumbnail,
      enrichmentStatus: recipes.enrichmentStatus,
      ownerUserId: recipes.ownerUserId,
      isPublic: recipes.isPublic,
      createdAt: recipes.createdAt,
      
      // Numeric time fields for display
      prepTimeMinutes: recipes.prepTimeMinutes,
      cookTimeMinutes: recipes.cookTimeMinutes,
      totalTimeMinutes: recipes.totalTimeMinutes,
      
      // Dietary flags (needed for filtering)
      isVegetarian: recipes.isVegetarian,
      isVegan: recipes.isVegan,
      isPescatarian: recipes.isPescatarian,
      isGlutenFree: recipes.isGlutenFree,
      isDairyFree: recipes.isDairyFree,
      isKeto: recipes.isKeto,
      isPaleo: recipes.isPaleo,
      isLowCarb: recipes.isLowCarb,
      isHighProtein: recipes.isHighProtein,
      isLowCalorie: recipes.isLowCalorie,
      isHighFiber: recipes.isHighFiber,
      isLactoVegetarian: recipes.isLactoVegetarian,
      isMediterranean: recipes.isMediterranean,
      isOvoVegetarian: recipes.isOvoVegetarian,
      isOvoLactoVegetarian: recipes.isOvoLactoVegetarian,
      isFlexitarian: recipes.isFlexitarian,
      isCarnivore: recipes.isCarnivore,
      isKosher: recipes.isKosher,
      isHalal: recipes.isHalal,
      isHindu: recipes.isHindu,
      
      // Nutritional quality flags (needed for filtering)
      isLowFat: recipes.isLowFat,
      isLowSodium: recipes.isLowSodium,
      isLowSugar: recipes.isLowSugar,
      
      // Nutrition values (needed for filtering)
      calories: recipes.calories,
      protein: recipes.protein,
      carbohydrates: recipes.carbohydrates,
      fat: recipes.fat,
      sodium: recipes.sodium,
      fiber: recipes.fiber,
      sugar: recipes.sugar,
      cholesterol: recipes.cholesterol,
      healthScore: recipes.healthScore,
      
      // Pricing (needed for filtering)
      priceRangeMin: recipes.priceRangeMin,
      priceRangeMax: recipes.priceRangeMax,
      priceCategory: recipes.priceCategory,
      
      // Array fields (needed for filtering)
      cuisines: recipes.cuisines,
      timeConvenienceTags: recipes.timeConvenienceTags,
      mealType: recipes.mealType,
      cookingMethods: recipes.cookingMethods,
      skillLevel: recipes.skillLevel,
      specializedEquipment: recipes.specializedEquipment,
      seasonTags: recipes.seasonTags,
      occasionTags: recipes.occasionTags,
      allergens: recipes.allergens,
    };
  }

  async getAllRecipes(userId?: string): Promise<RecipeListItem[]> {
    const listFields = this.getListFields();
    
    if (!userId) {
      // Not logged in - only show public recipes with owner info
      const results = await db
        .select({
          recipe: listFields,
          owner: {
            id: users.id,
            username: users.username,
            firstName: users.firstName,
            lastName: users.lastName,
          },
        })
        .from(recipes)
        .leftJoin(users, eq(recipes.ownerUserId, users.id))
        .where(eq(recipes.isPublic, true))
        .orderBy(desc(recipes.createdAt));
      
      return await this.enrichRecipesWithCookbooks(results.map(r => ({ ...r.recipe, owner: r.owner } as any)));
    }
    
    // Logged in - show own recipes + public recipes + shared recipes
    const sharedRecipeIds = await db.select({ recipeId: recipeShares.recipeId })
      .from(recipeShares)
      .where(eq(recipeShares.userId, userId));
    
    const sharedIds = sharedRecipeIds.map(s => s.recipeId);
    
    // Build query conditions
    const conditions = [
      eq(recipes.ownerUserId, userId),
      eq(recipes.isPublic, true),
    ];
    if (sharedIds.length > 0) {
      conditions.push(inArray(recipes.id, sharedIds));
    }
    
    const results = await db
      .select({
        recipe: listFields,
        owner: {
          id: users.id,
          username: users.username,
          firstName: users.firstName,
          lastName: users.lastName,
        },
      })
      .from(recipes)
      .leftJoin(users, eq(recipes.ownerUserId, users.id))
      .where(or(...conditions))
      .orderBy(desc(recipes.createdAt));
    
    return await this.enrichRecipesWithCookbooks(results.map(r => ({ ...r.recipe, owner: r.owner } as any)));
  }

  async getMyRecipes(userId: string): Promise<RecipeListItem[]> {
    const listFields = this.getListFields();
    
    const results = await db
      .select({
        recipe: listFields,
        owner: {
          id: users.id,
          username: users.username,
          firstName: users.firstName,
          lastName: users.lastName,
        },
      })
      .from(recipes)
      .leftJoin(users, eq(recipes.ownerUserId, users.id))
      .where(eq(recipes.ownerUserId, userId))
      .orderBy(desc(recipes.createdAt));
    
    return await this.enrichRecipesWithCookbooks(results.map(r => ({ ...r.recipe, owner: r.owner } as any)));
  }

  async getPublicRecipes(): Promise<RecipeListItem[]> {
    const listFields = this.getListFields();
    
    const results = await db
      .select({
        recipe: listFields,
        owner: {
          id: users.id,
          username: users.username,
          firstName: users.firstName,
          lastName: users.lastName,
        },
      })
      .from(recipes)
      .leftJoin(users, eq(recipes.ownerUserId, users.id))
      .where(eq(recipes.isPublic, true))
      .orderBy(desc(recipes.createdAt));
    
    return await this.enrichRecipesWithCookbooks(results.map(r => ({ ...r.recipe, owner: r.owner } as any)));
  }

  async getSharedWithMe(userId: string): Promise<RecipeListItem[]> {
    const sharedRecipeIds = await db.select({ recipeId: recipeShares.recipeId })
      .from(recipeShares)
      .where(eq(recipeShares.userId, userId));
    
    if (sharedRecipeIds.length === 0) return [];
    
    const listFields = this.getListFields();
    
    const ids = sharedRecipeIds.map(s => s.recipeId);
    const results = await db
      .select({
        recipe: listFields,
        owner: {
          id: users.id,
          username: users.username,
          firstName: users.firstName,
          lastName: users.lastName,
        },
      })
      .from(recipes)
      .leftJoin(users, eq(recipes.ownerUserId, users.id))
      .where(inArray(recipes.id, ids))
      .orderBy(desc(recipes.createdAt));
    
    return await this.enrichRecipesWithCookbooks(results.map(r => ({ ...r.recipe, owner: r.owner } as any)));
  }

  async getRecipesByCreator(creatorId: string): Promise<RecipeListItem[]> {
    // Only show public recipes by the creator
    const listFields = this.getListFields();
    
    const results = await db
      .select({
        recipe: listFields,
        owner: {
          id: users.id,
          username: users.username,
          firstName: users.firstName,
          lastName: users.lastName,
        },
      })
      .from(recipes)
      .leftJoin(users, eq(recipes.ownerUserId, users.id))
      .where(and(
        eq(recipes.ownerUserId, creatorId),
        eq(recipes.isPublic, true)
      ))
      .orderBy(desc(recipes.createdAt));
    
    return await this.enrichRecipesWithCookbooks(results.map(r => ({ ...r.recipe, owner: r.owner } as any)));
  }

  // ========== PAGINATED RECIPE OPERATIONS (OPTIMIZED FOR PERFORMANCE) ==========
  
  private async enrichCardsWithCookbooks(cards: RecipeCardData[]): Promise<RecipeCardData[]> {
    if (cards.length === 0) return [];
    
    try {
      const recipeIds = cards.map(r => r.id);
      const cookbookData = await db
        .select({
          recipeId: cookbookRecipes.recipeId,
          cookbookId: cookbooks.id,
          cookbookName: cookbooks.name,
        })
        .from(cookbookRecipes)
        .innerJoin(cookbooks, eq(cookbookRecipes.cookbookId, cookbooks.id))
        .where(inArray(cookbookRecipes.recipeId, recipeIds));
      
      return cards.map(recipe => {
        const recipeCookbooks = cookbookData
          .filter(c => c.recipeId === recipe.id)
          .map(c => ({ id: c.cookbookId, name: c.cookbookName }));
        
        return {
          ...recipe,
          cookbooks: recipeCookbooks.length > 0 ? recipeCookbooks : undefined,
        };
      });
    } catch (err) {
      console.warn("Failed to enrich cards with cookbooks, returning cards without cookbook data:", err);
      return cards;
    }
  }

  async getAllRecipesPaginated(userId?: string, page: number = 1, limit: number = 24, filters?: RecipeFilterParams): Promise<PaginatedRecipes> {
    const offset = (page - 1) * limit;
    const cardFields = this.getCardFields();
    const filterConditions = this.buildFilterConditions(filters);
    const sortOrder = this.getSortOrder(filters?.sortBy);
    
    if (!userId) {
      const baseCondition = eq(recipes.isPublic, true);
      const whereClause = filterConditions.length > 0
        ? and(baseCondition, ...filterConditions)
        : baseCondition;

      const [results, [countResult]] = await Promise.all([
        db
          .select({
            recipe: cardFields,
            owner: {
              id: users.id,
              username: users.username,
              firstName: users.firstName,
              lastName: users.lastName,
            },
          })
          .from(recipes)
          .leftJoin(users, eq(recipes.ownerUserId, users.id))
          .where(whereClause)
          .orderBy(sortOrder)
          .limit(limit)
          .offset(offset),
        db
          .select({ count: sql<number>`count(*)::int` })
          .from(recipes)
          .where(whereClause)
      ]);
      
      const cards = results.map(r => ({ ...r.recipe, owner: r.owner } as RecipeCardData));
      const enriched = await this.enrichCardsWithCookbooks(cards);
      
      return {
        recipes: enriched,
        hasMore: offset + results.length < countResult.count,
        total: countResult.count,
      };
    }
    
    const sharedRecipeIds = await db.select({ recipeId: recipeShares.recipeId })
      .from(recipeShares)
      .where(eq(recipeShares.userId, userId));
    
    const sharedIds = sharedRecipeIds.map(s => s.recipeId);
    
    const accessConditions = [
      eq(recipes.ownerUserId, userId),
      eq(recipes.isPublic, true),
    ];
    if (sharedIds.length > 0) {
      accessConditions.push(inArray(recipes.id, sharedIds));
    }

    const whereClause = filterConditions.length > 0
      ? and(or(...accessConditions), ...filterConditions)
      : or(...accessConditions);
    
    const [results, [countResult]] = await Promise.all([
      db
        .select({
          recipe: cardFields,
          owner: {
            id: users.id,
            username: users.username,
            firstName: users.firstName,
            lastName: users.lastName,
          },
        })
        .from(recipes)
        .leftJoin(users, eq(recipes.ownerUserId, users.id))
        .where(whereClause)
        .orderBy(sortOrder)
        .limit(limit)
        .offset(offset),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(recipes)
        .where(whereClause)
    ]);
    
    const cards = results.map(r => ({ ...r.recipe, owner: r.owner } as RecipeCardData));
    const enriched = await this.enrichCardsWithCookbooks(cards);
    
    return {
      recipes: enriched,
      hasMore: offset + results.length < countResult.count,
      total: countResult.count,
    };
  }

  async getMyRecipesPaginated(userId: string, page: number = 1, limit: number = 24, filters?: RecipeFilterParams): Promise<PaginatedRecipes> {
    const offset = (page - 1) * limit;
    const cardFields = this.getCardFields();
    const filterConditions = this.buildFilterConditions(filters);
    const sortOrder = this.getSortOrder(filters?.sortBy);
    const baseCondition = eq(recipes.ownerUserId, userId);
    const whereClause = filterConditions.length > 0
      ? and(baseCondition, ...filterConditions)
      : baseCondition;
    
    const [results, [countResult]] = await Promise.all([
      db
        .select({
          recipe: cardFields,
          owner: {
            id: users.id,
            username: users.username,
            firstName: users.firstName,
            lastName: users.lastName,
          },
        })
        .from(recipes)
        .leftJoin(users, eq(recipes.ownerUserId, users.id))
        .where(whereClause)
        .orderBy(sortOrder)
        .limit(limit)
        .offset(offset),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(recipes)
        .where(whereClause)
    ]);
    
    const cards = results.map(r => ({ ...r.recipe, owner: r.owner } as RecipeCardData));
    const enriched = await this.enrichCardsWithCookbooks(cards);
    
    return {
      recipes: enriched,
      hasMore: offset + results.length < countResult.count,
      total: countResult.count,
    };
  }

  async getPublicRecipesPaginated(page: number = 1, limit: number = 24, filters?: RecipeFilterParams): Promise<PaginatedRecipes> {
    const offset = (page - 1) * limit;
    const cardFields = this.getCardFields();
    const filterConditions = this.buildFilterConditions(filters);
    const sortOrder = this.getSortOrder(filters?.sortBy);
    const baseCondition = eq(recipes.isPublic, true);
    const whereClause = filterConditions.length > 0
      ? and(baseCondition, ...filterConditions)
      : baseCondition;
    
    const [results, [countResult]] = await Promise.all([
      db
        .select({
          recipe: cardFields,
          owner: {
            id: users.id,
            username: users.username,
            firstName: users.firstName,
            lastName: users.lastName,
          },
        })
        .from(recipes)
        .leftJoin(users, eq(recipes.ownerUserId, users.id))
        .where(whereClause)
        .orderBy(sortOrder)
        .limit(limit)
        .offset(offset),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(recipes)
        .where(whereClause)
    ]);
    
    const cards = results.map(r => ({ ...r.recipe, owner: r.owner } as RecipeCardData));
    const enriched = await this.enrichCardsWithCookbooks(cards);
    
    return {
      recipes: enriched,
      hasMore: offset + results.length < countResult.count,
      total: countResult.count,
    };
  }

  async getSharedWithMePaginated(userId: string, page: number = 1, limit: number = 24, filters?: RecipeFilterParams): Promise<PaginatedRecipes> {
    const sharedRecipeIds = await db.select({ recipeId: recipeShares.recipeId })
      .from(recipeShares)
      .where(eq(recipeShares.userId, userId));
    
    if (sharedRecipeIds.length === 0) {
      return { recipes: [], hasMore: false, total: 0 };
    }
    
    const offset = (page - 1) * limit;
    const cardFields = this.getCardFields();
    const ids = sharedRecipeIds.map(s => s.recipeId);
    const filterConditions = this.buildFilterConditions(filters);
    const sortOrder = this.getSortOrder(filters?.sortBy);
    const baseCondition = inArray(recipes.id, ids);
    const whereClause = filterConditions.length > 0
      ? and(baseCondition, ...filterConditions)
      : baseCondition;
    
    const [results, [countResult]] = await Promise.all([
      db
        .select({
          recipe: cardFields,
          owner: {
            id: users.id,
            username: users.username,
            firstName: users.firstName,
            lastName: users.lastName,
          },
        })
        .from(recipes)
        .leftJoin(users, eq(recipes.ownerUserId, users.id))
        .where(whereClause)
        .orderBy(sortOrder)
        .limit(limit)
        .offset(offset),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(recipes)
        .where(whereClause)
    ]);
    
    const cards = results.map(r => ({ ...r.recipe, owner: r.owner } as RecipeCardData));
    const enriched = await this.enrichCardsWithCookbooks(cards);
    
    return {
      recipes: enriched,
      hasMore: offset + results.length < countResult.count,
      total: countResult.count,
    };
  }

  async getRecipesByCreatorPaginated(creatorId: string, page: number = 1, limit: number = 24, filters?: RecipeFilterParams): Promise<PaginatedRecipes> {
    const offset = (page - 1) * limit;
    const cardFields = this.getCardFields();
    const filterConditions = this.buildFilterConditions(filters);
    const sortOrder = this.getSortOrder(filters?.sortBy);
    const baseConditions = [
      eq(recipes.ownerUserId, creatorId),
      eq(recipes.isPublic, true),
    ];
    const whereClause = and(...baseConditions, ...filterConditions);
    
    const [results, [countResult]] = await Promise.all([
      db
        .select({
          recipe: cardFields,
          owner: {
            id: users.id,
            username: users.username,
            firstName: users.firstName,
            lastName: users.lastName,
          },
        })
        .from(recipes)
        .leftJoin(users, eq(recipes.ownerUserId, users.id))
        .where(whereClause)
        .orderBy(sortOrder)
        .limit(limit)
        .offset(offset),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(recipes)
        .where(whereClause)
    ]);
    
    const cards = results.map(r => ({ ...r.recipe, owner: r.owner } as RecipeCardData));
    const enriched = await this.enrichCardsWithCookbooks(cards);
    
    return {
      recipes: enriched,
      hasMore: offset + results.length < countResult.count,
      total: countResult.count,
    };
  }

  async getRecipesByCookbooksPaginated(userId: string, cookbookIds: number[], page: number = 1, limit: number = 24, filters?: RecipeFilterParams): Promise<PaginatedRecipes> {
    const offset = (page - 1) * limit;
    const cardFields = this.getCardFields();
    const filterConditions = this.buildFilterConditions(filters);
    const sortOrder = this.getSortOrder(filters?.sortBy);
    
    const baseConditions = [
      inArray(cookbookRecipes.cookbookId, cookbookIds),
      or(
        eq(recipes.isPublic, true),
        eq(recipes.ownerUserId, userId)
      ),
    ];
    const whereClause = and(...baseConditions, ...filterConditions);

    const [results, [countResult]] = await Promise.all([
      db
        .selectDistinct({
          recipe: cardFields,
          owner: {
            id: users.id,
            username: users.username,
            firstName: users.firstName,
            lastName: users.lastName,
          },
        })
        .from(recipes)
        .leftJoin(users, eq(recipes.ownerUserId, users.id))
        .innerJoin(cookbookRecipes, eq(recipes.id, cookbookRecipes.recipeId))
        .where(whereClause)
        .orderBy(sortOrder)
        .limit(limit)
        .offset(offset),
      db
        .select({ count: sql<number>`count(DISTINCT ${recipes.id})::int` })
        .from(recipes)
        .innerJoin(cookbookRecipes, eq(recipes.id, cookbookRecipes.recipeId))
        .where(whereClause)
    ]);
    
    const cards = results.map(r => ({ ...r.recipe, owner: r.owner } as RecipeCardData));
    const enriched = await this.enrichCardsWithCookbooks(cards);
    
    return {
      recipes: enriched,
      hasMore: offset + results.length < countResult.count,
      total: countResult.count,
    };
  }

  async createRecipe(insertRecipe: InsertRecipe): Promise<Recipe> {
    const [recipe] = await db.insert(recipes).values([insertRecipe as any]).returning();
    return recipe;
  }

  async updateRecipe(id: string, updates: Partial<InsertRecipe>, userId?: string): Promise<Recipe | undefined> {
    // Check if recipe exists
    const [recipe] = await db.select().from(recipes).where(eq(recipes.id, id));
    if (!recipe) return undefined;
    
    // If userId provided, check ownership or editor permission
    if (userId) {
      // Must be owner OR have editor permission
      if (recipe.ownerUserId !== userId) {
        // Check if user has editor permission
        const [share] = await db.select().from(recipeShares)
          .where(and(
            eq(recipeShares.recipeId, id),
            eq(recipeShares.userId, userId),
            eq(recipeShares.role, 'editor')
          ));
        if (!share) return undefined;
      }
    }
    // If no userId provided, allow update (for system/background jobs)
    
    const [updated] = await db.update(recipes)
      .set({ ...updates as any, updatedAt: new Date() })
      .where(eq(recipes.id, id))
      .returning();
    return updated;
  }

  async deleteRecipe(id: string, userId: string): Promise<boolean> {
    // Defense-in-depth: Authorization policy (must match route-level checks in routes.ts)
    // POLICY: Owner OR Admin can delete any recipe
    // Note: Route-level authorization MUST stay aligned with this storage-level check
    
    const [recipe] = await db.select().from(recipes).where(eq(recipes.id, id));
    if (!recipe) return false;
    
    // Owner can always delete their own recipes
    if (recipe.ownerUserId === userId) {
      await db.delete(recipes).where(eq(recipes.id, id));
      return true;
    }
    
    // Check if user is admin - admins can delete ANY recipe (public or private)
    const [user] = await db.select().from(users).where(eq(users.id, userId));
    if (user?.isAdmin) {
      await db.delete(recipes).where(eq(recipes.id, id));
      return true;
    }
    
    // Otherwise, deny deletion
    return false;
  }

  async forkRecipe(recipeId: string, userId: string): Promise<Recipe> {
    const [originalRecipe] = await db.select().from(recipes).where(eq(recipes.id, recipeId));
    if (!originalRecipe) {
      throw new Error("Recipe not found");
    }
    
    // Recipe must be public to fork
    if (!originalRecipe.isPublic) {
      throw new Error("Cannot fork private recipe");
    }
    
    // Create a copy with new owner
    const { id, createdAt, updatedAt, ownerUserId, forkedFromId, forkCount, ...recipeToCopy } = originalRecipe;
    const [forked] = await db.insert(recipes).values({
      ...recipeToCopy,
      ownerUserId: userId,
      forkedFromId: recipeId,
      title: `${originalRecipe.title} (Copy)`,
    }).returning();
    
    // Increment fork count on original
    await db.update(recipes)
      .set({ forkCount: sql`${recipes.forkCount} + 1` })
      .where(eq(recipes.id, recipeId));
    
    return forked;
  }

  // ========== COOKBOOK OPERATIONS ==========
  
  async getCookbook(id: number, userId?: string): Promise<Cookbook | undefined> {
    const [cookbook] = await db.select().from(cookbooks).where(eq(cookbooks.id, id));
    
    if (!cookbook) return undefined;
    
    // Check access permissions
    if (!cookbook.isPublic && cookbook.ownerUserId !== userId) {
      return undefined;
    }
    
    return cookbook;
  }

  async getUserCookbooks(userId: string): Promise<CookbookWithCount[]> {
    // Count only recipes that actually exist (join with recipes table to exclude orphaned entries)
    const result = await db
      .select({
        ...getTableColumns(cookbooks),
        recipeCount: sql<number>`CAST(COUNT(DISTINCT ${recipes.id}) AS INTEGER)`,
      })
      .from(cookbooks)
      .leftJoin(cookbookRecipes, eq(cookbooks.id, cookbookRecipes.cookbookId))
      .leftJoin(recipes, eq(cookbookRecipes.recipeId, recipes.id))
      .where(eq(cookbooks.ownerUserId, userId))
      .groupBy(cookbooks.id)
      .orderBy(cookbooks.sortOrder);
    
    return result as CookbookWithCount[];
  }

  async getPublicCookbooks(): Promise<CookbookWithCount[]> {
    // Count only recipes that actually exist (join with recipes table to exclude orphaned entries)
    const result = await db
      .select({
        ...getTableColumns(cookbooks),
        recipeCount: sql<number>`CAST(COUNT(DISTINCT ${recipes.id}) AS INTEGER)`,
      })
      .from(cookbooks)
      .leftJoin(cookbookRecipes, eq(cookbooks.id, cookbookRecipes.cookbookId))
      .leftJoin(recipes, eq(cookbookRecipes.recipeId, recipes.id))
      .where(eq(cookbooks.isPublic, true))
      .groupBy(cookbooks.id)
      .orderBy(desc(cookbooks.createdAt));
    
    return result as CookbookWithCount[];
  }

  async getFollowedCookbooks(userId: string): Promise<CookbookWithCount[]> {
    // Count only recipes that actually exist (join with recipes table to exclude orphaned entries)
    const followed = await db
      .select({
        ...getTableColumns(cookbooks),
        recipeCount: sql<number>`CAST(COUNT(DISTINCT ${recipes.id}) AS INTEGER)`,
      })
      .from(cookbookFollows)
      .innerJoin(cookbooks, eq(cookbookFollows.cookbookId, cookbooks.id))
      .leftJoin(cookbookRecipes, eq(cookbooks.id, cookbookRecipes.cookbookId))
      .leftJoin(recipes, eq(cookbookRecipes.recipeId, recipes.id))
      .where(eq(cookbookFollows.userId, userId))
      .groupBy(cookbooks.id, cookbookFollows.followedAt)
      .orderBy(desc(cookbookFollows.followedAt));
    
    return followed as CookbookWithCount[];
  }

  async createCookbook(insertCookbook: InsertCookbook): Promise<Cookbook> {
    const [cookbook] = await db.insert(cookbooks).values(insertCookbook).returning();
    return cookbook;
  }

  async updateCookbook(id: number, updates: Partial<InsertCookbook>, userId: string): Promise<Cookbook | undefined> {
    const [cookbook] = await db.select().from(cookbooks).where(eq(cookbooks.id, id));
    if (!cookbook || cookbook.ownerUserId !== userId) {
      return undefined;
    }
    
    const [updated] = await db.update(cookbooks)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(cookbooks.id, id))
      .returning();
    return updated;
  }

  async deleteCookbook(id: number, userId: string): Promise<boolean> {
    const [cookbook] = await db.select().from(cookbooks).where(eq(cookbooks.id, id));
    if (!cookbook || cookbook.ownerUserId !== userId) {
      return false;
    }
    
    await db.delete(cookbooks).where(eq(cookbooks.id, id));
    return true;
  }

  // ========== COOKBOOK RECIPE OPERATIONS ==========
  
  async addRecipeToCookbook(cookbookId: number, recipeId: string, position?: number): Promise<void> {
    // Get max position if not provided
    if (position === undefined) {
      const [maxPos] = await db
        .select({ max: sql<number>`MAX(${cookbookRecipes.position})` })
        .from(cookbookRecipes)
        .where(eq(cookbookRecipes.cookbookId, cookbookId));
      position = (maxPos?.max ?? -1) + 1;
    }
    
    await db.insert(cookbookRecipes).values({
      cookbookId,
      recipeId,
      position,
    }).onConflictDoNothing(); // Ignore if already exists
  }

  async removeRecipeFromCookbook(cookbookId: number, recipeId: string): Promise<boolean> {
    const result = await db.delete(cookbookRecipes)
      .where(and(
        eq(cookbookRecipes.cookbookId, cookbookId),
        eq(cookbookRecipes.recipeId, recipeId)
      ));
    return result.rowCount !== null && result.rowCount > 0;
  }

  async getCookbookRecipes(cookbookId: number): Promise<RecipeListItem[]> {
    const listFields = this.getListFields();
    
    const results = await db
      .select({
        recipe: listFields,
        position: cookbookRecipes.position,
        owner: {
          id: users.id,
          username: users.username,
          firstName: users.firstName,
          lastName: users.lastName,
        },
      })
      .from(cookbookRecipes)
      .innerJoin(recipes, eq(cookbookRecipes.recipeId, recipes.id))
      .leftJoin(users, eq(recipes.ownerUserId, users.id))
      .where(eq(cookbookRecipes.cookbookId, cookbookId))
      .orderBy(cookbookRecipes.position);
    
    return await this.enrichRecipesWithCookbooks(results.map(r => ({ ...r.recipe, owner: r.owner } as any)));
  }

  async getCookbookRecipesPaginated(cookbookId: number, page: number = 1, limit: number = 24): Promise<{ recipes: RecipeListItem[]; total: number; hasMore: boolean }> {
    const offset = (page - 1) * limit;
    const cardFields = this.getCardFields();
    
    const [results, [countResult]] = await Promise.all([
      db
        .select({
          recipe: cardFields,
          position: cookbookRecipes.position,
          owner: {
            id: users.id,
            username: users.username,
            firstName: users.firstName,
            lastName: users.lastName,
          },
        })
        .from(cookbookRecipes)
        .innerJoin(recipes, eq(cookbookRecipes.recipeId, recipes.id))
        .leftJoin(users, eq(recipes.ownerUserId, users.id))
        .where(eq(cookbookRecipes.cookbookId, cookbookId))
        .orderBy(cookbookRecipes.position)
        .limit(limit)
        .offset(offset),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(cookbookRecipes)
        .where(eq(cookbookRecipes.cookbookId, cookbookId))
    ]);
    
    const total = countResult?.count || 0;
    const enrichedRecipes = await this.enrichRecipesWithCookbooks(
      results.map(r => ({ ...r.recipe, owner: r.owner } as any))
    );
    
    return {
      recipes: enrichedRecipes,
      total,
      hasMore: offset + results.length < total,
    };
  }

  async getCookbookRecipesForPrint(cookbookId: number): Promise<Recipe[]> {
    const results = await db
      .select({
        recipe: recipes,
        position: cookbookRecipes.position,
      })
      .from(cookbookRecipes)
      .innerJoin(recipes, eq(cookbookRecipes.recipeId, recipes.id))
      .where(eq(cookbookRecipes.cookbookId, cookbookId))
      .orderBy(cookbookRecipes.position);
    
    return results.map(r => r.recipe);
  }

  async reorderCookbookRecipes(cookbookId: number, recipePositions: { recipeId: string; position: number }[]): Promise<void> {
    // Update positions in a transaction
    await db.transaction(async (tx) => {
      for (const { recipeId, position } of recipePositions) {
        await tx.update(cookbookRecipes)
          .set({ position })
          .where(and(
            eq(cookbookRecipes.cookbookId, cookbookId),
            eq(cookbookRecipes.recipeId, recipeId)
          ));
      }
    });
  }

  // ========== BULK OPERATIONS ==========
  
  async bulkAddRecipesToCookbook(cookbookId: number, recipeIds: string[], userId: string): Promise<{ success: boolean; added: number; errors: string[] }> {
    const errors: string[] = [];
    let added = 0;
    
    // Verify cookbook ownership
    const cookbook = await this.getCookbook(cookbookId, userId);
    if (!cookbook || cookbook.ownerUserId !== userId) {
      return { success: false, added: 0, errors: ['Cookbook not found or access denied'] };
    }
    
    // Get max position
    const [maxPos] = await db
      .select({ max: sql<number>`MAX(${cookbookRecipes.position})` })
      .from(cookbookRecipes)
      .where(eq(cookbookRecipes.cookbookId, cookbookId));
    let position = (maxPos?.max ?? -1) + 1;
    
    // Add recipes one by one
    for (const recipeId of recipeIds) {
      try {
        // Verify recipe exists and user has access (owner or shared)
        const recipe = await this.getRecipe(recipeId, userId);
        if (!recipe) {
          errors.push(`Recipe ${recipeId} not found or access denied`);
          continue;
        }
        
        await db.insert(cookbookRecipes).values({
          cookbookId,
          recipeId,
          position: position++,
        }).onConflictDoNothing();
        added++;
      } catch (error: any) {
        errors.push(`Failed to add recipe ${recipeId}: ${error.message}`);
      }
    }
    
    return { success: errors.length === 0, added, errors };
  }
  
  async bulkDeleteRecipes(recipeIds: string[], userId: string, isAdmin: boolean = false): Promise<{ success: boolean; deleted: number; errors: string[] }> {
    const errors: string[] = [];
    let deleted = 0;
    
    // For admins, delete directly without ownership checks
    // For regular users, check ownership via deleteRecipe
    for (const recipeId of recipeIds) {
      try {
        if (isAdmin) {
          // Admin can delete any recipe directly
          const [recipe] = await db.select().from(recipes).where(eq(recipes.id, recipeId));
          if (recipe) {
            await db.delete(recipes).where(eq(recipes.id, recipeId));
            deleted++;
          } else {
            errors.push(`Recipe ${recipeId} not found`);
          }
        } else {
          // Regular user - check ownership via deleteRecipe
          const success = await this.deleteRecipe(recipeId, userId);
          if (success) {
            deleted++;
          } else {
            errors.push(`Recipe ${recipeId} not found or access denied`);
          }
        }
      } catch (error: any) {
        errors.push(`Failed to delete recipe ${recipeId}: ${error.message}`);
      }
    }
    
    return { success: errors.length === 0, deleted, errors };
  }

  // ========== RECIPE SHARING OPERATIONS ==========
  
  async shareRecipe(recipeId: string, userId: string, role: 'viewer' | 'editor' = 'viewer'): Promise<void> {
    await db.insert(recipeShares).values({
      recipeId,
      userId,
      role,
    }).onConflictDoUpdate({
      target: [recipeShares.recipeId, recipeShares.userId],
      set: { role },
    });
  }

  async unshareRecipe(recipeId: string, userId: string): Promise<boolean> {
    const result = await db.delete(recipeShares)
      .where(and(
        eq(recipeShares.recipeId, recipeId),
        eq(recipeShares.userId, userId)
      ));
    return result.rowCount !== null && result.rowCount > 0;
  }

  async getRecipeShares(recipeId: string): Promise<RecipeShare[]> {
    return await db.select().from(recipeShares)
      .where(eq(recipeShares.recipeId, recipeId));
  }

  // ========== COOKBOOK FOLLOWING OPERATIONS ==========
  
  async followCookbook(cookbookId: number, userId: string): Promise<void> {
    await db.insert(cookbookFollows).values({
      cookbookId,
      userId,
    }).onConflictDoNothing(); // Ignore if already following
  }

  async unfollowCookbook(cookbookId: number, userId: string): Promise<boolean> {
    const result = await db.delete(cookbookFollows)
      .where(and(
        eq(cookbookFollows.cookbookId, cookbookId),
        eq(cookbookFollows.userId, userId)
      ));
    return result.rowCount !== null && result.rowCount > 0;
  }

  async getCookbookFollowers(cookbookId: number): Promise<User[]> {
    const results = await db
      .select({ user: users })
      .from(cookbookFollows)
      .innerJoin(users, eq(cookbookFollows.userId, users.id))
      .where(eq(cookbookFollows.cookbookId, cookbookId));
    
    return results.map(r => r.user);
  }

  async isFollowingCookbook(cookbookId: number, userId: string): Promise<boolean> {
    const [follow] = await db.select().from(cookbookFollows)
      .where(and(
        eq(cookbookFollows.cookbookId, cookbookId),
        eq(cookbookFollows.userId, userId)
      ));
    return !!follow;
  }

  // ========== COOKBOOK COLLABORATION OPERATIONS ==========
  
  async getCookbookCollaborators(cookbookId: number): Promise<CookbookCollaboratorWithUser[]> {
    const result = await db
      .select({
        id: cookbookCollaborators.id,
        cookbookId: cookbookCollaborators.cookbookId,
        userId: cookbookCollaborators.userId,
        role: cookbookCollaborators.role,
        addedByUserId: cookbookCollaborators.addedByUserId,
        createdAt: cookbookCollaborators.createdAt,
        user: {
          id: users.id,
          email: users.email,
          firstName: users.firstName,
          lastName: users.lastName,
          profileImageUrl: users.profileImageUrl,
        },
      })
      .from(cookbookCollaborators)
      .innerJoin(users, eq(cookbookCollaborators.userId, users.id))
      .where(eq(cookbookCollaborators.cookbookId, cookbookId));
    
    return result;
  }
  
  async addCookbookCollaborator(collaborator: InsertCookbookCollaborator): Promise<CookbookCollaborator> {
    const [result] = await db.insert(cookbookCollaborators).values([collaborator] as any).returning();
    return result;
  }
  
  async removeCookbookCollaborator(cookbookId: number, userId: string, requesterId: string): Promise<boolean> {
    // Check if requester is the owner or the collaborator themselves
    const [cookbook] = await db.select().from(cookbooks).where(eq(cookbooks.id, cookbookId));
    if (!cookbook) return false;
    
    // Prevent removing the cookbook owner from collaborators (owner can't be a collaborator anyway)
    if (userId === cookbook.ownerUserId) return false;
    
    const isOwner = cookbook.ownerUserId === requesterId;
    const isSelf = userId === requesterId;
    
    // Only owner can remove other collaborators, or a collaborator can remove themselves
    if (!isOwner && !isSelf) return false;
    
    const result = await db.delete(cookbookCollaborators)
      .where(and(
        eq(cookbookCollaborators.cookbookId, cookbookId),
        eq(cookbookCollaborators.userId, userId)
      ));
    
    return (result.rowCount ?? 0) > 0;
  }
  
  async isCookbookCollaborator(cookbookId: number, userId: string): Promise<boolean> {
    const [collab] = await db.select().from(cookbookCollaborators)
      .where(and(
        eq(cookbookCollaborators.cookbookId, cookbookId),
        eq(cookbookCollaborators.userId, userId)
      ));
    return !!collab;
  }
  
  async canEditCookbook(cookbookId: number, userId: string): Promise<boolean> {
    // Check if user is owner
    const [cookbook] = await db.select().from(cookbooks).where(eq(cookbooks.id, cookbookId));
    if (!cookbook) return false;
    if (cookbook.ownerUserId === userId) return true;
    
    // Check if user is collaborator
    return this.isCookbookCollaborator(cookbookId, userId);
  }
  
  // ========== COOKBOOK INVITATION OPERATIONS ==========
  
  async createCookbookInvitation(invitation: InsertCookbookInvitation): Promise<CookbookInvitation> {
    const [result] = await db.insert(cookbookInvitations).values([invitation] as any).returning();
    return result;
  }
  
  async getCookbookInvitations(cookbookId: number): Promise<CookbookInvitation[]> {
    return db.select().from(cookbookInvitations)
      .where(eq(cookbookInvitations.cookbookId, cookbookId))
      .orderBy(desc(cookbookInvitations.createdAt));
  }
  
  async getUserPendingInvitations(userId: string): Promise<CookbookInvitationWithDetails[]> {
    // First get user's email
    const [user] = await db.select().from(users).where(eq(users.id, userId));
    if (!user) return [];
    
    const result = await db
      .select({
        id: cookbookInvitations.id,
        cookbookId: cookbookInvitations.cookbookId,
        inviterUserId: cookbookInvitations.inviterUserId,
        inviteeEmail: cookbookInvitations.inviteeEmail,
        inviteeUserId: cookbookInvitations.inviteeUserId,
        status: cookbookInvitations.status,
        token: cookbookInvitations.token,
        message: cookbookInvitations.message,
        createdAt: cookbookInvitations.createdAt,
        expiresAt: cookbookInvitations.expiresAt,
        respondedAt: cookbookInvitations.respondedAt,
        cookbook: {
          id: cookbooks.id,
          name: cookbooks.name,
          description: cookbooks.description,
        },
        inviter: {
          id: users.id,
          firstName: users.firstName,
          lastName: users.lastName,
          profileImageUrl: users.profileImageUrl,
        },
      })
      .from(cookbookInvitations)
      .innerJoin(cookbooks, eq(cookbookInvitations.cookbookId, cookbooks.id))
      .innerJoin(users, eq(cookbookInvitations.inviterUserId, users.id))
      .where(and(
        eq(cookbookInvitations.status, 'pending'),
        or(
          eq(cookbookInvitations.inviteeUserId, userId),
          user.email ? eq(cookbookInvitations.inviteeEmail, user.email) : sql`false`
        )
      ))
      .orderBy(desc(cookbookInvitations.createdAt));
    
    return result;
  }
  
  async getCookbookInvitationByToken(token: string): Promise<CookbookInvitationWithDetails | undefined> {
    const [result] = await db
      .select({
        id: cookbookInvitations.id,
        cookbookId: cookbookInvitations.cookbookId,
        inviterUserId: cookbookInvitations.inviterUserId,
        inviteeEmail: cookbookInvitations.inviteeEmail,
        inviteeUserId: cookbookInvitations.inviteeUserId,
        status: cookbookInvitations.status,
        token: cookbookInvitations.token,
        message: cookbookInvitations.message,
        createdAt: cookbookInvitations.createdAt,
        expiresAt: cookbookInvitations.expiresAt,
        respondedAt: cookbookInvitations.respondedAt,
        cookbook: {
          id: cookbooks.id,
          name: cookbooks.name,
          description: cookbooks.description,
        },
        inviter: {
          id: users.id,
          firstName: users.firstName,
          lastName: users.lastName,
          profileImageUrl: users.profileImageUrl,
        },
      })
      .from(cookbookInvitations)
      .innerJoin(cookbooks, eq(cookbookInvitations.cookbookId, cookbooks.id))
      .innerJoin(users, eq(cookbookInvitations.inviterUserId, users.id))
      .where(eq(cookbookInvitations.token, token));
    
    return result;
  }
  
  async respondToInvitation(invitationId: number, userId: string, accept: boolean): Promise<boolean> {
    const [invitation] = await db.select().from(cookbookInvitations)
      .where(eq(cookbookInvitations.id, invitationId));
    
    if (!invitation) return false;
    if (invitation.status !== 'pending') return false;
    
    // Check if expired
    if (new Date() > invitation.expiresAt) {
      await db.update(cookbookInvitations)
        .set({ status: 'expired', respondedAt: new Date() })
        .where(eq(cookbookInvitations.id, invitationId));
      return false;
    }
    
    // Get user to verify they're the invitee
    const [user] = await db.select().from(users).where(eq(users.id, userId));
    if (!user) return false;
    
    const isInvitee = invitation.inviteeUserId === userId ||
      (invitation.inviteeEmail && user.email === invitation.inviteeEmail);
    
    if (!isInvitee) return false;
    
    // Update invitation status
    await db.update(cookbookInvitations)
      .set({ 
        status: accept ? 'accepted' : 'rejected',
        respondedAt: new Date(),
        inviteeUserId: userId, // Link the invitation to this user
      })
      .where(eq(cookbookInvitations.id, invitationId));
    
    // If accepted, add as collaborator
    if (accept) {
      await this.addCookbookCollaborator({
        cookbookId: invitation.cookbookId,
        userId: userId,
        role: 'editor',
        addedByUserId: invitation.inviterUserId,
      });
    }
    
    return true;
  }
  
  async cancelCookbookInvitation(invitationId: number, requesterId: string): Promise<boolean> {
    const [invitation] = await db.select().from(cookbookInvitations)
      .where(eq(cookbookInvitations.id, invitationId));
    
    if (!invitation) return false;
    
    // Check if requester is the inviter or cookbook owner
    const [cookbook] = await db.select().from(cookbooks)
      .where(eq(cookbooks.id, invitation.cookbookId));
    
    if (!cookbook) return false;
    
    const canCancel = invitation.inviterUserId === requesterId || 
      cookbook.ownerUserId === requesterId;
    
    if (!canCancel) return false;
    
    const result = await db.delete(cookbookInvitations)
      .where(eq(cookbookInvitations.id, invitationId));
    
    return (result.rowCount ?? 0) > 0;
  }
  
  async findUserByEmailOrUsername(query: string): Promise<User | undefined> {
    const normalizedQuery = query.toLowerCase().trim();
    
    // Try to find by email first
    const [byEmail] = await db.select().from(users)
      .where(sql`LOWER(${users.email}) = ${normalizedQuery}`);
    
    if (byEmail) return byEmail;
    
    // Try to find by username (first name + last name or just first name)
    const [byName] = await db.select().from(users)
      .where(or(
        sql`LOWER(${users.firstName}) = ${normalizedQuery}`,
        sql`LOWER(CONCAT(${users.firstName}, ' ', ${users.lastName})) = ${normalizedQuery}`
      ));
    
    return byName;
  }

  // ========== UPLOAD SESSION OPERATIONS ==========
  
  async createUploadSession(insertSession: InsertUploadSession): Promise<UploadSession> {
    const [session] = await db.insert(uploadSessions).values([insertSession]).returning();
    return session;
  }

  async getUploadSession(id: string, userId?: string): Promise<UploadSession | undefined> {
    const conditions = [eq(uploadSessions.id, id)];
    if (userId) {
      conditions.push(eq(uploadSessions.userId, userId));
    }
    
    const [session] = await db.select().from(uploadSessions)
      .where(and(...conditions));
    return session;
  }

  async getUploadSessionWithRecipes(id: string, userId?: string): Promise<UploadSessionWithRecipes | undefined> {
    // Get the session
    const session = await this.getUploadSession(id, userId);
    if (!session) return undefined;
    
    // Get all recipes for this session
    const sessionRecipes = await db
      .select({
        id: recipes.id,
        title: recipes.title,
        enrichmentStatus: recipes.enrichmentStatus,
        imageGenerationStatus: recipes.imageGenerationStatus,
        sourceImageIndex: recipes.sourceImageIndex,
      })
      .from(recipes)
      .where(eq(recipes.uploadSessionId, id))
      .orderBy(recipes.sourceImageIndex);
    
    // Map recipes with proper defaults for null statuses
    const mappedRecipes = sessionRecipes.map(r => ({
      id: r.id,
      title: r.title,
      enrichmentStatus: r.enrichmentStatus || 'extracting' as const,
      imageGenerationStatus: r.imageGenerationStatus || 'pending' as const,
      sourceImageIndex: r.sourceImageIndex,
    }));
    
    return {
      ...session,
      recipes: mappedRecipes,
    };
  }

  async updateUploadSessionProgress(id: string, completed: number, failed: number): Promise<void> {
    await db.update(uploadSessions)
      .set({
        completedCount: completed,
        failedCount: failed,
        updatedAt: new Date(),
      })
      .where(eq(uploadSessions.id, id));
  }

  async completeUploadSession(id: string): Promise<void> {
    await db.update(uploadSessions)
      .set({
        status: 'completed',
        updatedAt: new Date(),
      })
      .where(eq(uploadSessions.id, id));
  }

  // ========== GROCERY LIST OPERATIONS ==========
  
  async getActiveGroceryList(userId: string): Promise<GroceryListWithItems | undefined> {
    // Get or create the active grocery list
    const [list] = await db.select().from(groceryLists)
      .where(and(
        eq(groceryLists.userId, userId),
        eq(groceryLists.status, 'active')
      ));
    
    if (!list) {
      return undefined;
    }
    
    // Get all items for this list
    const items = await db.select().from(groceryListItems)
      .where(eq(groceryListItems.listId, list.id))
      .orderBy(groceryListItems.aisle, groceryListItems.item);
    
    return {
      ...list,
      items,
    };
  }
  
  async createGroceryList(insertList: InsertGroceryList): Promise<GroceryList> {
    const [list] = await db.insert(groceryLists).values([{
      userId: insertList.userId,
      name: insertList.name || 'My Grocery List',
      status: (insertList.status as 'active' | 'archived') || 'active',
    }]).returning();
    return list;
  }
  
  async addRecipeToGroceryList(userId: string, recipeId: string): Promise<void> {
    // Import unit conversion utilities
    const { convertToBaseUnit, aggregateQuantities } = await import('./unit-conversion');
    
    // Get or create active grocery list
    let list = (await db.select().from(groceryLists)
      .where(and(
        eq(groceryLists.userId, userId),
        eq(groceryLists.status, 'active')
      )))[0];
    
    if (!list) {
      // Create new active list
      [list] = await db.insert(groceryLists).values([{
        userId,
        name: 'My Grocery List',
        status: 'active' as const,
      }]).returning();
    }
    
    // Get recipe with normalized ingredients
    const [recipe] = await db.select().from(recipes)
      .where(eq(recipes.id, recipeId));
    
    if (!recipe) {
      throw new Error('Recipe not found');
    }
    
    if (!recipe.normalizedIngredients || recipe.normalizedIngredients.length === 0) {
      throw new Error('Recipe has no ingredients to add');
    }
    
    // Get existing items in the list
    const existingItems = await db.select().from(groceryListItems)
      .where(eq(groceryListItems.listId, list.id));
    
    // Group existing items by compound key: item name + unit (case-insensitive)
    // This prevents aggregating incompatible units
    // Use '_none_' sentinel for items without units
    const existingItemMap = new Map<string, GroceryListItem>();
    for (const item of existingItems) {
      const unitKey = item.unit || '_none_';
      const key = `${item.item.toLowerCase()}|${unitKey}`;
      existingItemMap.set(key, item);
    }
    
    // Process each ingredient from the recipe
    for (const ingredient of recipe.normalizedIngredients) {
      // Skip tools and consumables
      if (ingredient.isToolOrConsumable || ingredient.isOptional) {
        continue;
      }
      
      // Convert to base unit
      const conversion = convertToBaseUnit(ingredient.quantity, ingredient.unit);
      
      // Create compound key: item name + unit to prevent incompatible unit aggregation
      // Use '_none_' sentinel for items without units
      const unitKey = conversion.unit || '_none_';
      const itemKey = `${ingredient.item.toLowerCase()}|${unitKey}`;
      
      const existingItem = existingItemMap.get(itemKey);
      
      // Aggregate if item with same base unit exists and conversion succeeded
      if (existingItem && conversion.canConvert) {
        // Aggregate with existing item
        const newQuantity = existingItem.quantity + conversion.quantity;
        const newOriginalEntries = [
          ...(existingItem.originalEntries || []),
          {
            recipeId: recipe.id,
            recipeTitle: recipe.title,
            quantity: ingredient.quantity || 1,
            unit: ingredient.unit || 'count',
            raw: ingredient.raw,
          },
        ];
        
        await db.update(groceryListItems)
          .set({
            quantity: newQuantity,
            originalEntries: newOriginalEntries as any,
            updatedAt: new Date(),
          })
          .where(eq(groceryListItems.id, existingItem.id));
      } else {
        // Add new item (either no existing item, incompatible units, or cannot convert)
        await db.insert(groceryListItems).values([{
          listId: list.id,
          recipeId: recipe.id,
          item: ingredient.item,
          quantity: conversion.quantity,
          unit: conversion.unit,
          displayName: ingredient.item,
          aisle: ingredient.groceryMapping?.aisle || 'Other',
          category: ingredient.groceryMapping?.category,
          emoji: ingredient.emoji,
          checked: false,
          originalEntries: [{
            recipeId: recipe.id,
            recipeTitle: recipe.title,
            quantity: ingredient.quantity || 1,
            unit: ingredient.unit || 'count',
            raw: ingredient.raw,
          }] as any,
        }]);
      }
    }
    
    // Update list timestamp
    await db.update(groceryLists)
      .set({ updatedAt: new Date() })
      .where(eq(groceryLists.id, list.id));
  }
  
  async addManualItemToGroceryList(userId: string, item: Partial<InsertGroceryListItem>): Promise<void> {
    // Get or create active grocery list
    let list = (await db.select().from(groceryLists)
      .where(and(
        eq(groceryLists.userId, userId),
        eq(groceryLists.status, 'active')
      )))[0];
    
    if (!list) {
      [list] = await db.insert(groceryLists).values([{
        userId,
        name: 'My Grocery List',
        status: 'active' as const,
      }]).returning();
    }
    
    // Ensure all required fields are provided with defaults
    const newItem = {
      listId: list.id,
      item: item.item || 'Item',
      quantity: item.quantity !== undefined ? item.quantity : 1,
      unit: item.unit || 'count',
      displayName: item.displayName || item.item || 'Item',
      aisle: item.aisle || 'Other',
      category: item.category || null,
      emoji: item.emoji || null,
      checked: false,
      originalEntries: [],
    };
    
    await db.insert(groceryListItems).values([newItem]);
  }
  
  async toggleGroceryListItem(itemId: string, userId: string, checked: boolean): Promise<void> {
    // Verify item belongs to user's active list
    const [item] = await db.select().from(groceryListItems)
      .innerJoin(groceryLists, eq(groceryListItems.listId, groceryLists.id))
      .where(and(
        eq(groceryListItems.id, itemId),
        eq(groceryLists.userId, userId),
        eq(groceryLists.status, 'active')
      ));
    
    if (!item) {
      throw new Error('Item not found or does not belong to your grocery list');
    }
    
    await db.update(groceryListItems)
      .set({
        checked,
        updatedAt: new Date(),
      })
      .where(eq(groceryListItems.id, itemId));
  }
  
  async removeItemFromGroceryList(itemId: string, userId: string): Promise<boolean> {
    // Verify item belongs to user's active list
    const [item] = await db.select().from(groceryListItems)
      .innerJoin(groceryLists, eq(groceryListItems.listId, groceryLists.id))
      .where(and(
        eq(groceryListItems.id, itemId),
        eq(groceryLists.userId, userId),
        eq(groceryLists.status, 'active')
      ));
    
    if (!item) {
      return false;
    }
    
    const result = await db.delete(groceryListItems)
      .where(eq(groceryListItems.id, itemId));
    
    return result.rowCount !== null && result.rowCount > 0;
  }
  
  async clearGroceryList(userId: string): Promise<void> {
    // Get active list
    const [list] = await db.select().from(groceryLists)
      .where(and(
        eq(groceryLists.userId, userId),
        eq(groceryLists.status, 'active')
      ));
    
    if (!list) {
      return;
    }
    
    // Delete all items
    await db.delete(groceryListItems)
      .where(eq(groceryListItems.listId, list.id));
  }
  
  async getGroceryListItemsByAisle(userId: string): Promise<GroceryListItemsByAisle[]> {
    // Get user's unit system preference
    const [user] = await db.select().from(users)
      .where(eq(users.id, userId));
    
    const preferMetric = user?.preferences?.unitSystem === 'metric';
    
    // Get active list
    const [list] = await db.select().from(groceryLists)
      .where(and(
        eq(groceryLists.userId, userId),
        eq(groceryLists.status, 'active')
      ));
    
    if (!list) {
      return [];
    }
    
    // Get all items grouped by aisle
    const items = await db.select().from(groceryListItems)
      .where(eq(groceryListItems.listId, list.id))
      .orderBy(groceryListItems.aisle, groceryListItems.item);
    
    // Helper function to format quantity nicely (fractions, rounding)
    const formatQty = (qty: number): string => {
      if (qty === 0.25) return '1/4';
      if (qty === 0.5) return '1/2';
      if (qty === 0.75) return '3/4';
      if (qty === 0.33 || qty === 0.333) return '1/3';
      if (qty === 0.67 || qty === 0.666) return '2/3';
      if (Number.isInteger(qty)) return qty.toString();
      // Round to 1 decimal place
      return qty.toFixed(1).replace(/\.0$/, '');
    };
    
    // Process items - use original recipe units by default (US mode)
    // Only convert to metric if user explicitly set metric preference
    const itemsWithDisplay = items.map(item => {
      const entries = item.originalEntries as { quantity: number; unit: string; raw: string; recipeId: string; recipeTitle: string }[] | null;
      
      // Default: use original recipe units if available and single entry
      if (!preferMetric && entries && entries.length === 1) {
        // Single recipe entry - show original recipe units
        const entry = entries[0];
        return {
          ...item,
          // Override with original recipe quantity/unit
          quantity: entry.quantity,
          unit: entry.unit,
          displayQuantity: entry.quantity,
          displayUnit: entry.unit,
          displayText: `${formatQty(entry.quantity)} ${entry.unit}`.trim(),
        };
      } else if (!preferMetric && entries && entries.length > 1) {
        // Multiple recipes aggregated - sum up original quantities if same unit
        const firstUnit = entries[0].unit.toLowerCase();
        const allSameUnit = entries.every(e => e.unit.toLowerCase() === firstUnit);
        if (allSameUnit) {
          const totalQty = entries.reduce((sum, e) => sum + e.quantity, 0);
          return {
            ...item,
            quantity: totalQty,
            unit: entries[0].unit,
            displayQuantity: totalQty,
            displayUnit: entries[0].unit,
            displayText: `${formatQty(totalQty)} ${entries[0].unit}`.trim(),
          };
        }
      }
      
      // Fallback: use normalized base units with conversion for metric
      // Import unit conversion utilities dynamically
      const baseUnit = item.unit as 'g' | 'ml' | 'count';
      return {
        ...item,
        displayQuantity: item.quantity,
        displayUnit: item.unit,
        displayText: `${formatQty(item.quantity)} ${item.unit}`.trim(),
      };
    });
    
    // Group by aisle
    const grouped = new Map<string, any[]>();
    for (const item of itemsWithDisplay) {
      const aisle = item.aisle || 'Other';
      if (!grouped.has(aisle)) {
        grouped.set(aisle, []);
      }
      grouped.get(aisle)!.push(item);
    }
    
    // Convert to array format
    return Array.from(grouped.entries()).map(([aisle, items]) => ({
      aisle,
      items,
    }));
  }

  async updateUserUnitSystemPreference(userId: string, unitSystem: 'metric' | 'us'): Promise<void> {
    // Get current preferences
    const [user] = await db.select().from(users)
      .where(eq(users.id, userId));
    
    if (!user) {
      throw new Error('User not found');
    }
    
    // Update preferences
    const updatedPreferences = {
      ...user.preferences,
      unitSystem,
    };
    
    await db.update(users)
      .set({
        preferences: updatedPreferences as any,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId));
  }
  
  // ========== BOOKMARK OPERATIONS ==========
  
  async getBookmarkedRecipes(userId: string): Promise<RecipeCardData[]> {
    const bookmarkedRecipeIds = await this.getBookmarkedRecipeIds(userId);
    if (bookmarkedRecipeIds.length === 0) {
      return [];
    }
    
    // Use the same pattern as paginated methods to avoid query structure issues
    const cardFields = this.getCardFields();
    
    const results = await db
      .select({
        recipe: cardFields,
        owner: {
          id: users.id,
          username: users.username,
          firstName: users.firstName,
          lastName: users.lastName,
        },
      })
      .from(recipes)
      .leftJoin(users, eq(recipes.ownerUserId, users.id))
      .where(inArray(recipes.id, bookmarkedRecipeIds))
      .orderBy(desc(recipes.createdAt));
    
    const cards = results.map(r => ({ ...r.recipe, owner: r.owner } as RecipeCardData));
    return await this.enrichCardsWithCookbooks(cards);
  }
  
  async getBookmarkedRecipeIds(userId: string): Promise<string[]> {
    const result = await db
      .select({ recipeId: bookmarks.recipeId })
      .from(bookmarks)
      .where(eq(bookmarks.userId, userId));
    
    return result.map(row => row.recipeId);
  }
  
  async isRecipeBookmarked(userId: string, recipeId: string): Promise<boolean> {
    const [bookmark] = await db
      .select()
      .from(bookmarks)
      .where(and(
        eq(bookmarks.userId, userId),
        eq(bookmarks.recipeId, recipeId)
      ));
    
    return !!bookmark;
  }
  
  async addBookmark(userId: string, recipeId: string): Promise<void> {
    try {
      await db.insert(bookmarks).values({
        userId,
        recipeId,
      }).onConflictDoNothing();
    } catch (error) {
      console.error('Error adding bookmark:', error);
      throw error;
    }
  }
  
  async removeBookmark(userId: string, recipeId: string): Promise<void> {
    await db.delete(bookmarks)
      .where(and(
        eq(bookmarks.userId, userId),
        eq(bookmarks.recipeId, recipeId)
      ));
  }
  
  // ========== PANTRY OPERATIONS ==========
  
  async getPantryItems(userId: string): Promise<PantryItem[]> {
    return await db
      .select()
      .from(pantryItems)
      .where(eq(pantryItems.userId, userId))
      .orderBy(pantryItems.name);
  }
  
  async getPantryItemsByCategory(userId: string): Promise<{ category: string; items: PantryItem[] }[]> {
    const items = await this.getPantryItems(userId);
    
    const grouped = new Map<string, PantryItem[]>();
    for (const item of items) {
      const category = item.category || 'Other';
      if (!grouped.has(category)) {
        grouped.set(category, []);
      }
      grouped.get(category)!.push(item);
    }
    
    return Array.from(grouped.entries())
      .map(([category, items]) => ({ category, items }))
      .sort((a, b) => a.category.localeCompare(b.category));
  }
  
  async addPantryItem(item: InsertPantryItem): Promise<PantryItem> {
    const normalizedName = item.name.toLowerCase().trim();
    const [created] = await db.insert(pantryItems).values({
      ...item,
      normalizedName,
      source: (item.source || 'manual') as 'manual' | 'ai_vision',
    }).returning();
    return created;
  }
  
  async updatePantryItem(id: string, item: Partial<InsertPantryItem>, userId: string): Promise<PantryItem | undefined> {
    const updates: any = { ...item, updatedAt: new Date() };
    if (item.name) {
      updates.normalizedName = item.name.toLowerCase().trim();
    }
    
    const [updated] = await db.update(pantryItems)
      .set(updates)
      .where(and(eq(pantryItems.id, id), eq(pantryItems.userId, userId)))
      .returning();
    return updated;
  }
  
  async deletePantryItem(id: string, userId: string): Promise<boolean> {
    const result = await db.delete(pantryItems)
      .where(and(eq(pantryItems.id, id), eq(pantryItems.userId, userId)));
    return true;
  }
  
  async bulkAddPantryItems(items: InsertPantryItem[]): Promise<PantryItem[]> {
    if (items.length === 0) return [];
    
    const itemsWithNormalized = items.map(item => ({
      ...item,
      normalizedName: item.name.toLowerCase().trim(),
      source: (item.source || 'manual') as 'manual' | 'ai_vision',
    }));
    
    return await db.insert(pantryItems).values(itemsWithNormalized).returning();
  }
  
  async clearPantry(userId: string): Promise<void> {
    await db.delete(pantryItems).where(eq(pantryItems.userId, userId));
  }
  
  // ========== PANTRY SCAN SESSION OPERATIONS ==========
  
  async createPantryScanSession(session: InsertPantryScanSession): Promise<PantryScanSession> {
    const sessionData = {
      userId: session.userId,
      imageUrl: session.imageUrl,
      status: (session.status || 'pending') as 'pending' | 'processing' | 'ready' | 'failed',
      extractedItems: session.extractedItems as { name: string; quantity?: number; unit?: string; category?: string; emoji?: string; }[] | undefined,
      errorMessage: session.errorMessage,
    };
    const [created] = await db.insert(pantryScanSessions).values([sessionData]).returning();
    return created;
  }
  
  async getPantryScanSession(id: string, userId: string): Promise<PantryScanSession | undefined> {
    const [session] = await db.select()
      .from(pantryScanSessions)
      .where(and(eq(pantryScanSessions.id, id), eq(pantryScanSessions.userId, userId)));
    return session;
  }
  
  async updatePantryScanSession(id: string, updates: Partial<PantryScanSession>): Promise<PantryScanSession | undefined> {
    const [updated] = await db.update(pantryScanSessions)
      .set(updates)
      .where(eq(pantryScanSessions.id, id))
      .returning();
    return updated;
  }
  
  // ========== GROCERY LIST SHARING OPERATIONS ==========
  
  async createGroceryListShare(share: InsertGroceryListShare): Promise<GroceryListShare> {
    const [created] = await db.insert(groceryListShares).values(share).returning();
    return created;
  }
  
  async getGroceryListShareByToken(token: string): Promise<GroceryListShare | undefined> {
    const [share] = await db.select()
      .from(groceryListShares)
      .where(eq(groceryListShares.token, token));
    return share;
  }
  
  async getGroceryListShares(listId: string, userId: string): Promise<GroceryListShare[]> {
    return await db.select()
      .from(groceryListShares)
      .where(and(
        eq(groceryListShares.listId, listId),
        eq(groceryListShares.createdByUserId, userId)
      ))
      .orderBy(desc(groceryListShares.createdAt));
  }
  
  async getGroceryListShareById(shareId: string, userId: string): Promise<GroceryListShare | undefined> {
    const [share] = await db.select()
      .from(groceryListShares)
      .where(and(
        eq(groceryListShares.id, shareId),
        eq(groceryListShares.createdByUserId, userId)
      ));
    return share;
  }
  
  async revokeGroceryListShare(shareId: string, userId: string): Promise<boolean> {
    const result = await db.delete(groceryListShares)
      .where(and(
        eq(groceryListShares.id, shareId),
        eq(groceryListShares.createdByUserId, userId)
      ));
    return true;
  }
  
  async updateShareAccessCount(shareId: string): Promise<void> {
    await db.update(groceryListShares)
      .set({
        accessCount: sql`${groceryListShares.accessCount} + 1`,
        lastAccessedAt: new Date(),
      })
      .where(eq(groceryListShares.id, shareId));
  }
  
  // ========== GROCERY LIST COLLABORATOR OPERATIONS ==========
  
  async addCollaborator(collaborator: InsertGroceryListCollaborator): Promise<GroceryListCollaborator> {
    const [created] = await db.insert(groceryListCollaborators).values(collaborator).returning();
    return created;
  }
  
  async getActiveCollaborators(shareId: string): Promise<GroceryListCollaborator[]> {
    return await db.select()
      .from(groceryListCollaborators)
      .where(and(
        eq(groceryListCollaborators.shareId, shareId),
        eq(groceryListCollaborators.isActive, true)
      ))
      .orderBy(desc(groceryListCollaborators.lastSeenAt));
  }
  
  async updateCollaboratorLastSeen(collaboratorId: string): Promise<void> {
    await db.update(groceryListCollaborators)
      .set({ lastSeenAt: new Date() })
      .where(eq(groceryListCollaborators.id, collaboratorId));
  }
  
  async removeCollaborator(collaboratorId: string): Promise<boolean> {
    await db.update(groceryListCollaborators)
      .set({ isActive: false })
      .where(eq(groceryListCollaborators.id, collaboratorId));
    return true;
  }
  
  // ========== SHARED GROCERY LIST OPERATIONS ==========
  
  async getSharedGroceryList(token: string): Promise<GroceryListWithItems | undefined> {
    const share = await this.getGroceryListShareByToken(token);
    if (!share) return undefined;
    
    // Check if expired
    if (share.expiresAt && new Date(share.expiresAt) < new Date()) {
      return undefined;
    }
    
    // Update access count
    await this.updateShareAccessCount(share.id);
    
    // Get the list with items
    const [list] = await db.select().from(groceryLists).where(eq(groceryLists.id, share.listId));
    if (!list) return undefined;
    
    const items = await db.select()
      .from(groceryListItems)
      .where(eq(groceryListItems.listId, list.id))
      .orderBy(groceryListItems.aisle, groceryListItems.item);
    
    return { ...list, items };
  }
  
  async toggleSharedGroceryListItem(token: string, itemId: string, checked: boolean): Promise<void> {
    const share = await this.getGroceryListShareByToken(token);
    if (!share || !share.canEdit) {
      throw new Error('Cannot edit this shared list');
    }
    
    // Check if expired
    if (share.expiresAt && new Date(share.expiresAt) < new Date()) {
      throw new Error('Share link has expired');
    }
    
    // Verify the item belongs to this list
    const [item] = await db.select()
      .from(groceryListItems)
      .where(and(
        eq(groceryListItems.id, itemId),
        eq(groceryListItems.listId, share.listId)
      ));
    
    if (!item) {
      throw new Error('Item not found');
    }
    
    await db.update(groceryListItems)
      .set({ checked, updatedAt: new Date() })
      .where(eq(groceryListItems.id, itemId));
  }
  
  async verifyItemBelongsToList(itemId: string, listId: string): Promise<boolean> {
    const [item] = await db.select()
      .from(groceryListItems)
      .where(and(
        eq(groceryListItems.id, itemId),
        eq(groceryListItems.listId, listId)
      ));
    
    return !!item;
  }
  
  // ========== COOKBOOK PRINT PROJECT OPERATIONS ==========
  
  async createPrintProject(project: InsertCookbookPrintProject): Promise<CookbookPrintProject> {
    const [created] = await db.insert(cookbookPrintProjects)
      .values(project as any)
      .returning();
    return created;
  }
  
  async getPrintProject(id: number, userId: string): Promise<CookbookPrintProject | undefined> {
    const [project] = await db.select()
      .from(cookbookPrintProjects)
      .where(and(
        eq(cookbookPrintProjects.id, id),
        eq(cookbookPrintProjects.ownerUserId, userId)
      ));
    return project;
  }
  
  async getPrintProjectsByCookbook(cookbookId: number, userId: string): Promise<CookbookPrintProject[]> {
    return await db.select()
      .from(cookbookPrintProjects)
      .where(and(
        eq(cookbookPrintProjects.cookbookId, cookbookId),
        eq(cookbookPrintProjects.ownerUserId, userId)
      ))
      .orderBy(desc(cookbookPrintProjects.updatedAt));
  }
  
  async getPrintProjectsByUser(userId: string): Promise<CookbookPrintProject[]> {
    return await db.select()
      .from(cookbookPrintProjects)
      .where(eq(cookbookPrintProjects.ownerUserId, userId))
      .orderBy(desc(cookbookPrintProjects.updatedAt));
  }
  
  async updatePrintProject(id: number, updates: Partial<InsertCookbookPrintProject>, userId: string): Promise<CookbookPrintProject | undefined> {
    const [updated] = await db.update(cookbookPrintProjects)
      .set({ ...updates, updatedAt: new Date() } as any)
      .where(and(
        eq(cookbookPrintProjects.id, id),
        eq(cookbookPrintProjects.ownerUserId, userId)
      ))
      .returning();
    return updated;
  }
  
  async deletePrintProject(id: number, userId: string): Promise<boolean> {
    const result = await db.delete(cookbookPrintProjects)
      .where(and(
        eq(cookbookPrintProjects.id, id),
        eq(cookbookPrintProjects.ownerUserId, userId)
      ));
    return true;
  }
  
  async updatePrintProjectPreflight(id: number, status: 'pending' | 'passed' | 'warnings' | 'failed', warnings?: PreflightWarning[]): Promise<void> {
    await db.update(cookbookPrintProjects)
      .set({ 
        preflightStatus: status, 
        preflightWarnings: warnings || [],
        updatedAt: new Date() 
      })
      .where(eq(cookbookPrintProjects.id, id));
  }
  
  async updatePrintProjectPdf(id: number, pdfUrl: string): Promise<void> {
    await db.update(cookbookPrintProjects)
      .set({ 
        pdfUrl, 
        pdfGeneratedAt: new Date(),
        updatedAt: new Date() 
      })
      .where(eq(cookbookPrintProjects.id, id));
  }
  
  async updatePrintProjectLuluOrder(id: number, orderId: string, status: string): Promise<void> {
    await db.update(cookbookPrintProjects)
      .set({ 
        luluOrderId: orderId, 
        luluOrderStatus: status,
        updatedAt: new Date() 
      })
      .where(eq(cookbookPrintProjects.id, id));
  }
}
