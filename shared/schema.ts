import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, real, jsonb, boolean, timestamp, serial, unique, primaryKey, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { relations } from "drizzle-orm";

// Constant maps for comprehensive recipe enrichment
export const DIETARY_FLAGS = {
  isVegetarian: "Vegetarian",
  isVegan: "Vegan",
  isPescatarian: "Pescatarian",
  isGlutenFree: "Gluten-Free",
  isDairyFree: "Dairy-Free",
  isKeto: "Keto",
  isPaleo: "Paleo",
  isLowCarb: "Low-Carb",
  isHighProtein: "High-Protein",
  isLowCalorie: "Low-Calorie",
  isHighFiber: "High-Fiber",
  isLactoVegetarian: "Lacto-Vegetarian",
  isMediterranean: "Mediterranean",
  isOvoVegetarian: "Ovo-Vegetarian",
  isOvoLactoVegetarian: "Ovo-Lacto-Vegetarian",
  isFlexitarian: "Flexitarian",
  isCarnivore: "Carnivore",
  isKosher: "Kosher",
  isHalal: "Halal",
  isHindu: "Hindu",
} as const;

export const NUTRITION_FLAGS = {
  isLowFat: "Low-Fat",
  isLowSodium: "Low-Sodium",
  isLowSugar: "Low-Sugar",
} as const;

export const CANONICAL_ALLERGENS = [
  "Shellfish",
  "Fish",
  "Gluten",
  "Dairy",
  "Peanuts",
  "Tree Nuts",
  "Soy",
  "Eggs",
  "Sesame",
  "Mustard",
  "Sulfites",
  "Nightshades",
] as const;

export const CUISINE_OPTIONS = [
  "African",
  "American",
  "Asian",
  "Australian",
  "British",
  "Cajun",
  "Canadian",
  "Caribbean",
  "Chinese",
  "Cuban",
  "Eastern European",
  "European",
  "French",
  "German",
  "Greek",
  "Indian",
  "Israeli",
  "Italian",
  "Japanese",
  "Korean",
  "Latin American",
  "Mediterranean",
  "Mexican",
  "Middle Eastern",
  "Moroccan",
  "Portuguese",
  "Southern",
  "Spanish",
  "TexMex",
  "Thai",
  "Vietnamese",
  "World Cuisine",
] as const;

// Normalized ingredient with full nutrition and grocery mappings
export const normalizedIngredientSchema = z.object({
  raw: z.string(),
  quantity: z.number().optional(),
  unit: z.string().optional(),
  item: z.string(),
  preparation: z.string().optional(),
  isOptional: z.boolean().default(false),
  isToolOrConsumable: z.boolean().default(false),
  emoji: z.string().optional(),
  // Nutrition mapping
  nutrition: z.object({
    calories: z.number().optional(),
    protein: z.number().optional(),
    carbohydrates: z.number().optional(),
    fat: z.number().optional(),
    fiber: z.number().optional(),
  }).optional(),
  // Grocery mapping
  groceryMapping: z.object({
    name: z.string().optional(),
    aisle: z.string().optional(),
    packageSize: z.string().optional(),
    category: z.string().optional(),
  }).optional(),
});

// Instruction step with metadata
export const instructionStepSchema = z.object({
  stepNumber: z.number(),
  text: z.string(),
  ingredients: z.array(z.string()).default([]),
  tools: z.array(z.string()).default([]),
  timeMinutes: z.number().optional(),
  timeRange: z.object({
    min: z.number().optional(),
    max: z.number().optional(),
    approximate: z.boolean().default(false),
  }).optional(),
  temperature: z.object({
    value: z.number().nullable().optional(),
    scale: z.enum(['F', 'C']).nullable().optional(),
    range: z.string().nullable().optional(),
  }).optional(),
  stepType: z.enum(['preheat', 'prep', 'cook', 'rest', 'chill', 'marinate', 'assemble', 'serve']).optional(),
  donenessCue: z.string().optional(),
});

// Tips and variations
export const tipSchema = z.object({
  type: z.enum(['technique', 'storage', 'makeAhead', 'reheating', 'serving']),
  text: z.string(),
});

export const variationSchema = z.object({
  type: z.enum(['ingredient', 'flavor', 'protein', 'dietary']),
  title: z.string(),
  description: z.string(),
});

// Validation warnings
export const validationWarningSchema = z.object({
  severity: z.enum(['error', 'warning', 'info']),
  category: z.enum(['missingIngredient', 'unusedIngredient', 'timeInconsistency', 'missingTemp', 'other']),
  message: z.string(),
});

// Beverage pairings
export const beveragePairingSchema = z.object({
  name: z.string(),
  styleOrVarietal: z.string().optional(),
  tastingNotes: z.string().optional(),
  rationale: z.string(),
});

export const beveragePairingsSchema = z.object({
  wines: z.array(beveragePairingSchema).default([]),
  beers: z.array(beveragePairingSchema).default([]),
  cocktails: z.array(beveragePairingSchema).default([]),
  nonAlcoholic: z.array(beveragePairingSchema).default([]),
}).optional();

// Recipe variations
export const ingredientSwapSchema = z.object({
  targetIngredient: z.string(),
  replacement: z.string(),
  reason: z.string(),
  impactSummary: z.string(),
});

export const enhancementSchema = z.object({
  focus: z.enum(['presentation', 'technique', 'ingredient']),
  recommendation: z.string(),
  rationale: z.string(),
});

export const recipeVariationsSchema = z.object({
  lowerCalorie: z.array(ingredientSwapSchema).default([]),
  higherProtein: z.array(ingredientSwapSchema).default([]),
  michelinUpgrade: z.array(enhancementSchema).default([]),
  budgetFriendly: z.array(ingredientSwapSchema).default([]),
}).optional();

// Celebrity chef reviews
export const celebrityChefReviewSchema = z.object({
  chefName: z.enum(['Gordon Ramsay', 'Ina Garten', 'Matty Matheson']),
  philosophy: z.string(), // e.g., "Technique", "Quality/Ease", "Flavor/Fat"
  score: z.number().min(1).max(10),
  review: z.string(), // 2-3 sentence critique in chef's signature style
});

export const celebrityChefReviewsSchema = z.array(celebrityChefReviewSchema).optional();

// ============================================================================
// SESSIONS TABLE (required for Replit Auth)
// ============================================================================
export const sessions = pgTable(
  "sessions",
  {
    sid: varchar("sid").primaryKey(),
    sess: jsonb("sess").notNull(),
    expire: timestamp("expire").notNull(),
  },
  (table) => ({
    expireIdx: sql`CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON ${table} (${table.expire})`,
  })
);

// ============================================================================
// USERS TABLE
// ============================================================================
export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`), // From Replit Auth or generated
  email: varchar("email").unique(),
  
  // Clerk Auth integration
  clerkId: varchar("clerk_id").unique(), // Clerk user ID for Clerk-based auth
  
  // Auth fields
  firstName: varchar("first_name"),
  lastName: varchar("last_name"),
  profileImageUrl: varchar("profile_image_url"),
  
  // Custom user fields
  username: varchar("username").unique(), // Optional unique handle like @chef123
  bio: text("bio"),
  
  // Privacy settings
  defaultRecipeVisibility: text("default_recipe_visibility").$type<'public' | 'private'>().default('public'),
  defaultCookbookVisibility: text("default_cookbook_visibility").$type<'public' | 'private'>().default('public'),
  
  // Admin flag - allows deleting any public recipe
  isAdmin: boolean("is_admin").default(false),
  
  // Preferences
  autoEnrichRecipes: boolean("auto_enrich_recipes").default(true),
  notifyOnEnrichmentComplete: boolean("notify_on_enrichment_complete").default(true),
  notifyOnCookbookFollows: boolean("notify_on_cookbook_follows").default(true),
  
  // UI Preferences (JSONB for flexibility)
  preferences: jsonb("preferences").$type<{
    quickFilters?: {
      enabled?: string[]; // e.g., ['all', 'yours', 'public', 'shared', 'vegetarian']
      order?: string[]; // Display order
    };
    unitSystem?: 'metric' | 'us'; // Grocery list unit display preference
    // Dietary restrictions for "What Can I Make?" feature
    dietaryRestrictions?: string[]; // e.g., ['dairy-free', 'gluten-free', 'vegetarian', 'vegan', 'keto']
    // Ingredients the user dislikes or wants to avoid
    dislikedIngredients?: string[]; // e.g., ['zucchini', 'cilantro', 'mushrooms']
    // Voice assistant / Grammie preferences
    allergies?: string[]; // Safety-critical: 'peanuts', 'shellfish', 'dairy', etc.
    cookingSkillLevel?: 'beginner' | 'intermediate' | 'advanced' | 'professional';
    cuisinePreferences?: string[]; // Preferred cuisines: 'Italian', 'Mexican', 'Asian', etc.
    householdSize?: number; // For portion recommendations
    cookingGoals?: string[]; // 'meal-prep', 'quick-weeknight', 'healthy-eating', 'budget-friendly'
    grammieNotes?: string; // Custom notes for Grammie to remember (e.g., "my husband doesn't like spicy food")
  }>(),
  
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Authentication credentials table - supports multiple auth providers per user
export const authCredentials = pgTable("auth_credentials", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  provider: text("provider").$type<'replit' | 'local' | 'phone' | 'clerk'>().notNull(),
  providerUserId: varchar("provider_user_id").notNull(), // sub for OIDC, username/email for local, phone number for phone
  passwordHash: varchar("password_hash"), // Only for local auth
  
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  // Ensure one credential per provider per user
  uniqueProviderUser: unique().on(table.provider, table.providerUserId),
}));

// ============================================================================
// UPLOAD_SESSIONS TABLE (track batch recipe uploads)
// ============================================================================
export const uploadSessions = pgTable("upload_sessions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: 'cascade' }),
  
  totalFiles: integer("total_files").notNull(),
  completedCount: integer("completed_count").default(0).notNull(),
  failedCount: integer("failed_count").default(0).notNull(),
  status: text("status").$type<'processing' | 'completed'>().default('processing').notNull(),
  
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  // Performance indexes
  userIdIdx: index("upload_sessions_user_id_idx").on(table.userId),
  statusIdx: index("upload_sessions_status_idx").on(table.status),
}));

// ============================================================================
// RECIPES TABLE (with user ownership)
// ============================================================================
export const recipes = pgTable("recipes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  title: text("title").notNull(),
  description: text("description"),
  
  // Time fields (in minutes, normalized)
  prepTime: text("prep_time").notNull(),
  cookTime: text("cook_time"),
  totalTime: text("total_time").notNull(),
  coolingTime: text("cooling_time"),
  prepTimeMinutes: integer("prep_time_minutes"),
  cookTimeMinutes: integer("cook_time_minutes"),
  totalTimeMinutes: integer("total_time_minutes"),
  
  // Serving information
  servings: integer("servings").notNull(),
  servingUnit: text("serving_unit"),
  servingSize: text("serving_size"),
  yield: text("yield"),
  
  // Normalized ingredients with metadata
  ingredients: text("ingredients").array().notNull(),
  normalizedIngredients: jsonb("normalized_ingredients").$type<z.infer<typeof normalizedIngredientSchema>[]>(),
  
  // Normalized instructions with metadata
  instructions: text("instructions").array().notNull(),
  normalizedInstructions: jsonb("normalized_instructions").$type<z.infer<typeof instructionStepSchema>[]>(),
  
  // Equipment and tools
  equipment: text("equipment").array(),
  standardEquipment: text("standard_equipment").array(),
  specializedEquipment: text("specialized_equipment").array(),
  groceryAisleTags: text("grocery_aisle_tags").array(),
  
  // Classification
  dietType: text("diet_type").array(),
  cuisine: text("cuisine"), // Legacy field - kept for backward compatibility
  cuisines: text("cuisines").array(), // NEW: Supports multiple cuisines
  mealType: text("meal_type").array(),
  
  // Time convenience tags
  timeConvenienceTags: text("time_convenience_tags").array(),
  
  // Skill level and difficulty
  skillLevel: text("skill_level"),
  skillLevelExplanation: text("skill_level_explanation"),
  
  // Advanced dietary attributes (using booleans for clarity)
  isVegetarian: boolean("is_vegetarian"),
  isVegan: boolean("is_vegan"),
  isPescatarian: boolean("is_pescatarian"),
  isGlutenFree: boolean("is_gluten_free"),
  isDairyFree: boolean("is_dairy_free"),
  isKeto: boolean("is_keto"),
  isPaleo: boolean("is_paleo"),
  isLowCarb: boolean("is_low_carb"),
  isHighProtein: boolean("is_high_protein"),
  isLowCalorie: boolean("is_low_calorie"),
  isHighFiber: boolean("is_high_fiber"),
  isLactoVegetarian: boolean("is_lacto_vegetarian"),
  isMediterranean: boolean("is_mediterranean"),
  isOvoVegetarian: boolean("is_ovo_vegetarian"),
  isOvoLactoVegetarian: boolean("is_ovo_lacto_vegetarian"),
  isFlexitarian: boolean("is_flexitarian"),
  isCarnivore: boolean("is_carnivore"),
  isKosher: boolean("is_kosher"),
  isHalal: boolean("is_halal"),
  isHindu: boolean("is_hindu"),
  
  // Nutrition qualitative tags
  isLowFat: boolean("is_low_fat"),
  isLowSodium: boolean("is_low_sodium"),
  isLowSugar: boolean("is_low_sugar"),
  
  // Allergens
  allergens: text("allergens").array(),
  allergenFreeTags: text("allergen_free_tags").array(),
  
  // Cooking methods
  cookingMethods: text("cooking_methods").array(),
  
  // Season tags
  seasonTags: text("season_tags").array(),
  
  // Occasion tags
  occasionTags: text("occasion_tags").array(),
  
  // Pricing information
  priceRangeMin: real("price_range_min"),
  priceRangeMax: real("price_range_max"),
  priceCategory: text("price_category"),
  totalCost: real("total_cost"),
  costExcludingStaples: real("cost_excluding_staples"),
  
  // Health score (0-100 based on latest nutritional research)
  healthScore: integer("health_score"),
  
  // Images
  dishImage: text("dish_image"),
  dishImageThumbnail: text("dish_image_thumbnail"), // 256x256 thumbnail (~150KB) for list views
  dishImages: jsonb("dish_images").$type<Array<{
    id: string;
    url: string;
    thumbnailUrl?: string;
    isAiGenerated: boolean;
    order: number;
    createdAt: string;
  }>>(), // Array of dish images (up to 3, ordered)
  imagePrompt: text("image_prompt"), // The AI prompt used for image generation (shown/editable)
  handwrittenImage: text("handwritten_image"),
  
  // Nutrition (per serving)
  calories: integer("calories"),
  protein: real("protein"),
  carbohydrates: real("carbohydrates"),
  fat: real("fat"),
  fiber: real("fiber"),
  sugar: real("sugar"),
  sodium: integer("sodium"),
  cholesterol: integer("cholesterol"),
  
  // Tips and variations
  tips: jsonb("tips").$type<z.infer<typeof tipSchema>[]>(),
  variations: jsonb("variations").$type<z.infer<typeof variationSchema>[]>(),
  servingSuggestions: text("serving_suggestions").array(),
  
  // Beverage pairings
  beveragePairings: jsonb("beverage_pairings").$type<z.infer<typeof beveragePairingsSchema>>(),
  
  // Recipe variations
  recipeVariations: jsonb("recipe_variations").$type<z.infer<typeof recipeVariationsSchema>>(),
  
  // Cultural significance and history
  culturalSignificance: text("cultural_significance"),
  
  // Celebrity chef reviews
  celebrityChefReviews: jsonb("celebrity_chef_reviews").$type<z.infer<typeof celebrityChefReviewsSchema>>(),
  
  // Validation and quality
  validationWarnings: jsonb("validation_warnings").$type<z.infer<typeof validationWarningSchema>[]>(),
  
  // AI enrichment metadata
  aiEnriched: boolean("ai_enriched"),
  aiEnrichmentFields: text("ai_enrichment_fields").array(),
  instructionsGenerated: boolean("instructions_generated").default(false),
  originalInstructions: text("original_instructions").array(), // Stores original extracted instructions before AI enhancement
  enrichmentStatus: text("enrichment_status").$type<'extracting' | 'enriching' | 'ready' | 'failed'>().default('extracting'),
  enrichmentError: text("enrichment_error"),
  enrichmentRetryCount: integer("enrichment_retry_count").default(0),
  enrichmentStartedAt: timestamp("enrichment_started_at"),
  
  // Image generation job tracking
  imageGenerationStatus: text("image_generation_status").$type<'pending' | 'generating' | 'ready' | 'failed'>().default('pending'),
  imageGenerationError: text("image_generation_error"),
  imageGenerationStartedAt: timestamp("image_generation_started_at"),
  
  // User ownership and visibility
  ownerUserId: varchar("owner_user_id").references(() => users.id, { onDelete: 'cascade' }),
  isPublic: boolean("is_public").default(true).notNull(),
  publishedAt: timestamp("published_at"),
  forkedFromId: varchar("forked_from_id").references((): any => recipes.id, { onDelete: 'set null' }),
  forkCount: integer("fork_count").default(0).notNull(),
  
  // "Make Your Own" variation tracking
  derivedFromRecipeId: varchar("derived_from_recipe_id").references((): any => recipes.id, { onDelete: 'set null' }),
  variationNotes: text("variation_notes"), // 1-2 sentence explanation of modifications made
  variationModifications: text("variation_modifications").array(), // Tags for modifications applied (e.g., "low-calorie", "keto")
  
  // Upload session tracking (for multi-image uploads)
  uploadSessionId: varchar("upload_session_id").references((): any => uploadSessions.id, { onDelete: 'set null' }),
  sourceImageIndex: integer("source_image_index"), // Order in batch upload
  
  // Social media source attribution (for imported recipes)
  socialSourcePlatform: text("social_source_platform").$type<'instagram' | 'tiktok'>(),
  socialSourceUrl: text("social_source_url"),
  socialSourceCreatorUsername: text("social_source_creator_username"),
  socialSourceCreatorAvatar: text("social_source_creator_avatar"),
  socialSourcePostDate: timestamp("social_source_post_date"),
  
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  // Performance indexes for frequently queried columns
  ownerUserIdIdx: index("recipes_owner_user_id_idx").on(table.ownerUserId),
  isPublicIdx: index("recipes_is_public_idx").on(table.isPublic),
  enrichmentStatusIdx: index("recipes_enrichment_status_idx").on(table.enrichmentStatus),
  
  // Composite indexes for optimized sorting queries
  isPublicCreatedAtIdx: index("recipes_is_public_created_at_idx").on(table.isPublic, table.createdAt.desc()),
  ownerUserIdCreatedAtIdx: index("recipes_owner_user_id_created_at_idx").on(table.ownerUserId, table.createdAt.desc()),
}));

// ============================================================================
// COOKBOOKS TABLE
// ============================================================================
export const cookbooks = pgTable("cookbooks", {
  id: serial("id").primaryKey(),
  ownerUserId: varchar("owner_user_id").notNull().references(() => users.id, { onDelete: 'cascade' }),
  
  name: text("name").notNull(),
  description: text("description"),
  coverImage: text("cover_image"),
  
  isPublic: boolean("is_public").default(true).notNull(),
  sortOrder: integer("sort_order").default(0).notNull(),
  
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  // Performance indexes
  ownerUserIdIdx: index("cookbooks_owner_user_id_idx").on(table.ownerUserId),
  isPublicIdx: index("cookbooks_is_public_idx").on(table.isPublic),
}));

// ============================================================================
// COOKBOOK PRINT PROJECTS (for print-on-demand cookbook publishing)
// ============================================================================

// Layout data structure for print projects
export const printLayoutDataSchema = z.object({
  coverImage: z.string().optional(),
  backCoverImage: z.string().optional(),
  title: z.string().optional(),
  subtitle: z.string().optional(),
  authorName: z.string().optional(),
  dedication: z.string().optional(),
  sections: z.array(z.object({
    id: z.string(),
    title: z.string(),
    recipeIds: z.array(z.string()),
  })).default([]),
  customizations: z.object({
    fontFamily: z.string().optional(),
    accentColor: z.string().optional(),
    showNutrition: z.boolean().default(true),
    showPageNumbers: z.boolean().default(true),
    pageSize: z.enum(['6x9', '8.5x11', 'a4']).default('6x9'),
  }).optional(),
  // Per-recipe print settings
  recipePrintSettings: z.record(z.string(), z.object({
    layoutOverride: z.enum(['full-page', 'text-only', 'two-page-spread']).optional(),
    includePhoto: z.boolean().optional(),
  })).optional(),
  // Cover customization
  coverData: z.object({
    backgroundColor: z.string().optional(),
    spineText: z.string().optional(),
    backText: z.string().optional(),
    frontImageUrl: z.string().optional(),
  }).optional(),
});

export type PrintLayoutData = z.infer<typeof printLayoutDataSchema>;

// Preflight warning structure
export const preflightWarningSchema = z.object({
  type: z.enum(['error', 'warning', 'info']),
  category: z.enum(['image_dpi', 'color_space', 'bleed', 'page_count', 'font', 'other']),
  message: z.string(),
  recipeId: z.string().optional(),
  field: z.string().optional(),
});

export type PreflightWarning = z.infer<typeof preflightWarningSchema>;

export const cookbookPrintProjects = pgTable("cookbook_print_projects", {
  id: serial("id").primaryKey(),
  cookbookId: integer("cookbook_id").notNull().references(() => cookbooks.id, { onDelete: 'cascade' }),
  ownerUserId: varchar("owner_user_id").notNull().references(() => users.id, { onDelete: 'cascade' }),
  
  // Layout JSON structure
  layoutData: jsonb("layout_data").$type<PrintLayoutData>().notNull(),
  
  // Template style: 'classic' | 'modern' | 'rustic' | 'elegant'
  templateStyle: varchar("template_style", { length: 50 }).$type<'classic' | 'modern' | 'rustic' | 'elegant'>().notNull().default('classic'),

  // Print specifications (from Lulu POD config)
  trimSize: varchar("trim_size", { length: 20 }).notNull().default('0600X0900'),
  bindingType: varchar("binding_type", { length: 5 }).notNull().default('PB'),
  colorType: varchar("color_type", { length: 5 }).notNull().default('FC'),
  paperType: varchar("paper_type", { length: 20 }).notNull().default('080CW444'),
  coverFinish: varchar("cover_finish", { length: 5 }).notNull().default('M'),
  
  // Preflight status: 'pending' | 'passed' | 'warnings' | 'failed'
  preflightStatus: varchar("preflight_status", { length: 20 }).$type<'pending' | 'passed' | 'warnings' | 'failed'>().default('pending'),
  preflightWarnings: jsonb("preflight_warnings").$type<PreflightWarning[]>(),
  
  // PDF generation
  pdfUrl: text("pdf_url"),
  pdfGeneratedAt: timestamp("pdf_generated_at"),
  
  // Lulu order
  luluOrderId: varchar("lulu_order_id", { length: 100 }),
  luluOrderStatus: varchar("lulu_order_status", { length: 50 }),
  
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  cookbookIdIdx: index("print_projects_cookbook_id_idx").on(table.cookbookId),
  ownerUserIdIdx: index("print_projects_owner_user_id_idx").on(table.ownerUserId),
}));

// Insert schema
export const insertCookbookPrintProjectSchema = createInsertSchema(cookbookPrintProjects).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertCookbookPrintProject = z.infer<typeof insertCookbookPrintProjectSchema>;
export type CookbookPrintProject = typeof cookbookPrintProjects.$inferSelect;

// ============================================================================
// COOKBOOK_RECIPES JOIN TABLE (many-to-many)
// ============================================================================
export const cookbookRecipes = pgTable("cookbook_recipes", {
  id: serial("id").primaryKey(),
  cookbookId: integer("cookbook_id").notNull().references(() => cookbooks.id, { onDelete: 'cascade' }),
  recipeId: varchar("recipe_id").notNull().references(() => recipes.id, { onDelete: 'cascade' }),
  position: integer("position").default(0).notNull(),
  addedAt: timestamp("added_at").defaultNow().notNull(),
}, (table) => ({
  // Prevent duplicate recipe in same cookbook
  uniqueCookbookRecipe: unique().on(table.cookbookId, table.recipeId),
  // Performance indexes for joins
  recipeIdIdx: index("cookbook_recipes_recipe_id_idx").on(table.recipeId),
  cookbookIdIdx: index("cookbook_recipes_cookbook_id_idx").on(table.cookbookId),
}));

// ============================================================================
// RECIPE_SHARES TABLE (share private recipes with specific users)
// ============================================================================
export const recipeShares = pgTable("recipe_shares", {
  id: serial("id").primaryKey(),
  recipeId: varchar("recipe_id").notNull().references(() => recipes.id, { onDelete: 'cascade' }),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: 'cascade' }),
  role: text("role").$type<'viewer' | 'editor'>().default('viewer').notNull(),
  sharedAt: timestamp("shared_at").defaultNow().notNull(),
}, (table) => ({
  // Prevent duplicate shares
  uniqueRecipeShare: unique().on(table.recipeId, table.userId),
  // Performance indexes
  recipeIdIdx: index("recipe_shares_recipe_id_idx").on(table.recipeId),
  userIdIdx: index("recipe_shares_user_id_idx").on(table.userId),
  // Composite index for efficient shared recipe lookups
  userIdRecipeIdIdx: index("recipe_shares_user_id_recipe_id_idx").on(table.userId, table.recipeId),
}));

// ============================================================================
// BOOKMARKS TABLE (save favorite recipes)
// ============================================================================
export const bookmarks = pgTable("bookmarks", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: 'cascade' }),
  recipeId: varchar("recipe_id").notNull().references(() => recipes.id, { onDelete: 'cascade' }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  // Prevent duplicate bookmarks
  uniqueUserRecipeBookmark: unique().on(table.userId, table.recipeId),
  // Performance indexes
  userIdIdx: index("bookmarks_user_id_idx").on(table.userId),
  recipeIdIdx: index("bookmarks_recipe_id_idx").on(table.recipeId),
}));

// ============================================================================
// COOKBOOK_FOLLOWS TABLE (follow other users' public cookbooks)
// ============================================================================
export const cookbookFollows = pgTable("cookbook_follows", {
  id: serial("id").primaryKey(),
  cookbookId: integer("cookbook_id").notNull().references(() => cookbooks.id, { onDelete: 'cascade' }),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: 'cascade' }),
  followedAt: timestamp("followed_at").defaultNow().notNull(),
}, (table) => ({
  // Prevent duplicate follows
  uniqueCookbookFollow: unique().on(table.cookbookId, table.userId),
}));

// ============================================================================
// COOKBOOK_COLLABORATORS TABLE (users who can edit a cookbook)
// ============================================================================
export const cookbookCollaborators = pgTable("cookbook_collaborators", {
  id: serial("id").primaryKey(),
  cookbookId: integer("cookbook_id").notNull().references(() => cookbooks.id, { onDelete: 'cascade' }),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: 'cascade' }),
  role: text("role").$type<'editor'>().default('editor').notNull(),
  addedByUserId: varchar("added_by_user_id").notNull().references(() => users.id, { onDelete: 'cascade' }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  // Prevent duplicate collaborators
  uniqueCookbookCollaborator: unique().on(table.cookbookId, table.userId),
  // Performance indexes
  cookbookIdIdx: index("cookbook_collaborators_cookbook_id_idx").on(table.cookbookId),
  userIdIdx: index("cookbook_collaborators_user_id_idx").on(table.userId),
}));

// ============================================================================
// COOKBOOK_INVITATIONS TABLE (pending invitations to collaborate)
// ============================================================================
export const cookbookInvitations = pgTable("cookbook_invitations", {
  id: serial("id").primaryKey(),
  cookbookId: integer("cookbook_id").notNull().references(() => cookbooks.id, { onDelete: 'cascade' }),
  inviterUserId: varchar("inviter_user_id").notNull().references(() => users.id, { onDelete: 'cascade' }),
  
  // Invitee can be identified by email or userId (if already registered)
  inviteeEmail: varchar("invitee_email"),
  inviteeUserId: varchar("invitee_user_id").references(() => users.id, { onDelete: 'cascade' }),
  
  status: text("status").$type<'pending' | 'accepted' | 'rejected' | 'expired'>().default('pending').notNull(),
  token: varchar("token").notNull().unique(), // Secure token for accepting via link
  message: text("message"), // Optional personal message from inviter
  
  createdAt: timestamp("created_at").defaultNow().notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  respondedAt: timestamp("responded_at"),
}, (table) => ({
  // Performance indexes
  cookbookIdIdx: index("cookbook_invitations_cookbook_id_idx").on(table.cookbookId),
  inviteeUserIdIdx: index("cookbook_invitations_invitee_user_id_idx").on(table.inviteeUserId),
  inviteeEmailIdx: index("cookbook_invitations_invitee_email_idx").on(table.inviteeEmail),
  tokenIdx: index("cookbook_invitations_token_idx").on(table.token),
  statusIdx: index("cookbook_invitations_status_idx").on(table.status),
}));

// ============================================================================
// GROCERY_LISTS TABLE (user grocery lists with recipes)
// ============================================================================
export const groceryLists = pgTable("grocery_lists", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: text("name").notNull().default('My Grocery List'),
  status: text("status").$type<'active' | 'archived'>().default('active').notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  // Only one active list per user
  uniqueActiveList: unique().on(table.userId, table.status),
  // Performance index
  userIdIdx: index("grocery_lists_user_id_idx").on(table.userId),
}));

// ============================================================================
// GROCERY_LIST_ITEMS TABLE (consolidated ingredients from recipes)
// ============================================================================
export const groceryListItems = pgTable("grocery_list_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  listId: varchar("list_id").notNull().references(() => groceryLists.id, { onDelete: 'cascade' }),
  
  // Recipe tracking (nullable for manual items)
  recipeId: varchar("recipe_id").references(() => recipes.id, { onDelete: 'cascade' }),
  
  // Normalized ingredient data
  item: text("item").notNull(), // e.g., "flour"
  quantity: real("quantity").notNull(), // Base quantity (normalized)
  unit: text("unit").notNull(), // Base unit (grams, ml, count)
  displayName: text("display_name").notNull(), // User-friendly name
  
  // Grocery organization
  aisle: text("aisle"), // e.g., "Baking", "Produce"
  category: text("category"), // e.g., "Dry Goods", "Fresh"
  emoji: text("emoji"), // Visual indicator
  
  // Shopping state
  checked: boolean("checked").default(false).notNull(),
  
  // Provenance tracking (JSON array of original recipe ingredients)
  originalEntries: jsonb("original_entries").$type<{
    recipeId: string;
    recipeTitle: string;
    quantity: number;
    unit: string;
    raw: string;
  }[]>().default(sql`'[]'::jsonb`),
  
  addedAt: timestamp("added_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  // Performance indexes
  listIdIdx: index("grocery_list_items_list_id_idx").on(table.listId),
  recipeIdIdx: index("grocery_list_items_recipe_id_idx").on(table.recipeId),
  // Group by item for aggregation queries
  listIdItemIdx: index("grocery_list_items_list_id_item_idx").on(table.listId, table.item),
}));

// ============================================================================
// PANTRY_ITEMS TABLE (user's pantry/fridge inventory)
// ============================================================================
export const pantryItems = pgTable("pantry_items", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: 'cascade' }),
  
  // Item info
  name: text("name").notNull(), // e.g., "milk", "eggs", "flour"
  quantity: real("quantity"), // Optional quantity
  unit: text("unit"), // Optional unit (e.g., "cups", "count", "lbs")
  
  // Source tracking
  source: text("source").$type<'manual' | 'ai_vision'>().default('manual').notNull(),
  
  // Organization
  category: text("category"), // e.g., "Dairy", "Produce", "Pantry"
  emoji: text("emoji"), // Visual indicator
  
  // Optional expiration tracking
  expiresAt: timestamp("expires_at"),
  notes: text("notes"),
  
  // Normalized item name for matching with grocery list
  normalizedName: text("normalized_name"), // Lowercase, trimmed for matching
  
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  // Performance indexes
  userIdIdx: index("pantry_items_user_id_idx").on(table.userId),
  normalizedNameIdx: index("pantry_items_normalized_name_idx").on(table.normalizedName),
  categoryIdx: index("pantry_items_category_idx").on(table.category),
}));

// ============================================================================
// PANTRY_SCAN_SESSIONS TABLE (AI photo scanning sessions)
// ============================================================================
export const pantryScanSessions = pgTable("pantry_scan_sessions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: 'cascade' }),
  
  // Image data
  imageUrl: text("image_url").notNull(), // Base64 or URL
  
  // Processing status
  status: text("status").$type<'pending' | 'processing' | 'ready' | 'failed'>().default('pending').notNull(),
  
  // Extracted items (before user confirmation)
  extractedItems: jsonb("extracted_items").$type<{
    name: string;
    quantity?: number;
    unit?: string;
    category?: string;
    emoji?: string;
  }[]>(),
  
  errorMessage: text("error_message"),
  
  createdAt: timestamp("created_at").defaultNow().notNull(),
  completedAt: timestamp("completed_at"),
});

// ============================================================================
// GROCERY_LIST_SHARES TABLE (shareable links for grocery lists)
// ============================================================================
export const groceryListShares = pgTable("grocery_list_shares", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  listId: varchar("list_id").notNull().references(() => groceryLists.id, { onDelete: 'cascade' }),
  
  // Share token (cryptographically secure random string)
  token: varchar("token", { length: 64 }).notNull().unique(),
  
  // Share settings
  createdByUserId: varchar("created_by_user_id").notNull().references(() => users.id, { onDelete: 'cascade' }),
  canEdit: boolean("can_edit").default(true).notNull(), // Can collaborators check/uncheck items?
  
  // Optional expiration
  expiresAt: timestamp("expires_at"),
  
  // Activity tracking
  lastAccessedAt: timestamp("last_accessed_at"),
  accessCount: integer("access_count").default(0).notNull(),
  
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  // Performance indexes
  tokenIdx: index("grocery_list_shares_token_idx").on(table.token),
  listIdIdx: index("grocery_list_shares_list_id_idx").on(table.listId),
}));

// ============================================================================
// GROCERY_LIST_COLLABORATORS TABLE (active collaborators on shared lists)
// ============================================================================
export const groceryListCollaborators = pgTable("grocery_list_collaborators", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  shareId: varchar("share_id").notNull().references(() => groceryListShares.id, { onDelete: 'cascade' }),
  
  // Collaborator info (can be authenticated user or guest)
  userId: varchar("user_id").references(() => users.id, { onDelete: 'cascade' }),
  displayName: text("display_name").notNull(), // For guests without accounts
  
  // Status
  isActive: boolean("is_active").default(true).notNull(),
  lastSeenAt: timestamp("last_seen_at").defaultNow().notNull(),
  
  joinedAt: timestamp("joined_at").defaultNow().notNull(),
}, (table) => ({
  // Performance indexes
  shareIdIdx: index("grocery_list_collaborators_share_id_idx").on(table.shareId),
  userIdIdx: index("grocery_list_collaborators_user_id_idx").on(table.userId),
}));

// ============================================================================
// RELATIONS
// ============================================================================
export const usersRelations = relations(users, ({ many }) => ({
  recipes: many(recipes),
  cookbooks: many(cookbooks),
  recipeShares: many(recipeShares),
  cookbookFollows: many(cookbookFollows),
  authCredentials: many(authCredentials),
  uploadSessions: many(uploadSessions),
  groceryLists: many(groceryLists),
  pantryItems: many(pantryItems),
  pantryScanSessions: many(pantryScanSessions),
}));

export const authCredentialsRelations = relations(authCredentials, ({ one }) => ({
  user: one(users, {
    fields: [authCredentials.userId],
    references: [users.id],
  }),
}));

export const uploadSessionsRelations = relations(uploadSessions, ({ one, many }) => ({
  user: one(users, {
    fields: [uploadSessions.userId],
    references: [users.id],
  }),
  recipes: many(recipes),
}));

export const recipesRelations = relations(recipes, ({ one, many }) => ({
  owner: one(users, {
    fields: [recipes.ownerUserId],
    references: [users.id],
  }),
  forkedFrom: one(recipes, {
    fields: [recipes.forkedFromId],
    references: [recipes.id],
    relationName: "forkedRecipes",
  }),
  derivedFrom: one(recipes, {
    fields: [recipes.derivedFromRecipeId],
    references: [recipes.id],
    relationName: "derivedRecipes",
  }),
  uploadSession: one(uploadSessions, {
    fields: [recipes.uploadSessionId],
    references: [uploadSessions.id],
  }),
  shares: many(recipeShares),
  cookbookRecipes: many(cookbookRecipes),
}));

export const cookbooksRelations = relations(cookbooks, ({ one, many }) => ({
  owner: one(users, {
    fields: [cookbooks.ownerUserId],
    references: [users.id],
  }),
  recipes: many(cookbookRecipes),
  followers: many(cookbookFollows),
  collaborators: many(cookbookCollaborators),
  invitations: many(cookbookInvitations),
}));

export const cookbookCollaboratorsRelations = relations(cookbookCollaborators, ({ one }) => ({
  cookbook: one(cookbooks, {
    fields: [cookbookCollaborators.cookbookId],
    references: [cookbooks.id],
  }),
  user: one(users, {
    fields: [cookbookCollaborators.userId],
    references: [users.id],
  }),
  addedBy: one(users, {
    fields: [cookbookCollaborators.addedByUserId],
    references: [users.id],
  }),
}));

export const cookbookInvitationsRelations = relations(cookbookInvitations, ({ one }) => ({
  cookbook: one(cookbooks, {
    fields: [cookbookInvitations.cookbookId],
    references: [cookbooks.id],
  }),
  inviter: one(users, {
    fields: [cookbookInvitations.inviterUserId],
    references: [users.id],
  }),
  invitee: one(users, {
    fields: [cookbookInvitations.inviteeUserId],
    references: [users.id],
  }),
}));

export const cookbookRecipesRelations = relations(cookbookRecipes, ({ one }) => ({
  cookbook: one(cookbooks, {
    fields: [cookbookRecipes.cookbookId],
    references: [cookbooks.id],
  }),
  recipe: one(recipes, {
    fields: [cookbookRecipes.recipeId],
    references: [recipes.id],
  }),
}));

export const recipeSharesRelations = relations(recipeShares, ({ one }) => ({
  recipe: one(recipes, {
    fields: [recipeShares.recipeId],
    references: [recipes.id],
  }),
  user: one(users, {
    fields: [recipeShares.userId],
    references: [users.id],
  }),
}));

export const cookbookFollowsRelations = relations(cookbookFollows, ({ one }) => ({
  cookbook: one(cookbooks, {
    fields: [cookbookFollows.cookbookId],
    references: [cookbooks.id],
  }),
  user: one(users, {
    fields: [cookbookFollows.userId],
    references: [users.id],
  }),
}));

export const groceryListsRelations = relations(groceryLists, ({ one, many }) => ({
  user: one(users, {
    fields: [groceryLists.userId],
    references: [users.id],
  }),
  items: many(groceryListItems),
  shares: many(groceryListShares),
}));

export const groceryListItemsRelations = relations(groceryListItems, ({ one }) => ({
  list: one(groceryLists, {
    fields: [groceryListItems.listId],
    references: [groceryLists.id],
  }),
  recipe: one(recipes, {
    fields: [groceryListItems.recipeId],
    references: [recipes.id],
  }),
}));

export const pantryItemsRelations = relations(pantryItems, ({ one }) => ({
  user: one(users, {
    fields: [pantryItems.userId],
    references: [users.id],
  }),
}));

export const pantryScanSessionsRelations = relations(pantryScanSessions, ({ one }) => ({
  user: one(users, {
    fields: [pantryScanSessions.userId],
    references: [users.id],
  }),
}));

export const groceryListSharesRelations = relations(groceryListShares, ({ one, many }) => ({
  list: one(groceryLists, {
    fields: [groceryListShares.listId],
    references: [groceryLists.id],
  }),
  createdBy: one(users, {
    fields: [groceryListShares.createdByUserId],
    references: [users.id],
  }),
  collaborators: many(groceryListCollaborators),
}));

export const groceryListCollaboratorsRelations = relations(groceryListCollaborators, ({ one }) => ({
  share: one(groceryListShares, {
    fields: [groceryListCollaborators.shareId],
    references: [groceryListShares.id],
  }),
  user: one(users, {
    fields: [groceryListCollaborators.userId],
    references: [users.id],
  }),
}));

// ============================================================================
// ZOD SCHEMAS & TYPES
// ============================================================================

// Users
export const insertUserSchema = createInsertSchema(users).omit({
  createdAt: true,
  updatedAt: true,
});
export const upsertUserSchema = insertUserSchema.partial().required({ id: true, email: true });
export type InsertUser = z.infer<typeof insertUserSchema>;
export type UpsertUser = z.infer<typeof upsertUserSchema>;
export type User = typeof users.$inferSelect;

// Auth Credentials
export const insertAuthCredentialSchema = createInsertSchema(authCredentials).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertAuthCredential = z.infer<typeof insertAuthCredentialSchema>;
export type AuthCredential = typeof authCredentials.$inferSelect;

// Upload Sessions
export const insertUploadSessionSchema = createInsertSchema(uploadSessions).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  status: z.enum(['processing', 'completed']).optional(),
});
export type InsertUploadSession = z.infer<typeof insertUploadSessionSchema>;
export type UploadSession = typeof uploadSessions.$inferSelect;

// Extended type with recipe details
export type UploadSessionWithRecipes = UploadSession & {
  recipes: Array<{
    id: string;
    title: string;
    enrichmentStatus: 'extracting' | 'enriching' | 'ready' | 'failed';
    imageGenerationStatus: 'pending' | 'generating' | 'ready' | 'failed';
    sourceImageIndex: number | null;
  }>;
};

// Recipes
export const insertRecipeSchema = createInsertSchema(recipes).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  forkCount: true, // Auto-managed
}).extend({
  // Make ownership optional for validation (will be set in routes)
  ownerUserId: z.string().optional(),
  isPublic: z.boolean().default(true),
  // Multi-upload session tracking
  uploadSessionId: z.string().optional(),
  sourceImageIndex: z.number().optional(),
});
export type InsertRecipe = z.infer<typeof insertRecipeSchema>;
export type Recipe = typeof recipes.$inferSelect;

// Update recipe schema (for editing - derived from insert schema with all fields optional)
export const updateRecipeSchema = insertRecipeSchema.partial();
export type UpdateRecipe = z.infer<typeof updateRecipeSchema>;

// Extended type for recipe list items with owner and cookbook information
export type RecipeListItem = Recipe & {
  owner?: {
    id: string;
    username: string | null;
    firstName: string | null;
    lastName: string | null;
  };
  cookbooks?: {
    id: number;
    name: string;
  }[];
};

// Lean type for recipe cards (minimal data for performance + filters)
export type RecipeCardData = {
  id: string;
  title: string;
  description: string | null;
  totalTime: string;
  prepTime: string;
  servings: number;
  dishImageThumbnail: string | null;
  enrichmentStatus: string;
  imageGenerationStatus: string;
  ownerUserId: string;
  isPublic: boolean;
  createdAt: Date;
  
  // Numeric time fields
  prepTimeMinutes: number | null;
  cookTimeMinutes: number | null;
  totalTimeMinutes: number | null;
  
  // Fields for quick filters
  timeConvenienceTags: string[];
  isHighProtein: boolean;
  isVegetarian: boolean;
  isVegan: boolean;
  isGlutenFree: boolean;
  isDairyFree: boolean;
  
  // Fields for advanced filters
  mealType: string[] | null;
  cuisines: string[] | null;
  cookingMethods: string[] | null;
  skillLevel: string | null;
  isKeto: boolean | null;
  isPaleo: boolean | null;
  isLowCarb: boolean | null;
  isLowCalorie: boolean | null;
  isHighFiber: boolean | null;
  isMediterranean: boolean | null;
  isPescatarian: boolean | null;
  allergens: string[] | null;
  seasonTags: string[] | null;
  occasionTags: string[] | null;
  
  owner?: {
    id: string;
    username: string | null;
    firstName: string | null;
    lastName: string | null;
  };
  cookbooks?: {
    id: number;
    name: string;
  }[];
};

// Paginated response wrapper
export type PaginatedRecipes = {
  recipes: RecipeCardData[];
  hasMore: boolean;
  total: number;
};

// Cookbooks
export const insertCookbookSchema = createInsertSchema(cookbooks).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertCookbook = z.infer<typeof insertCookbookSchema>;
export type Cookbook = typeof cookbooks.$inferSelect;

// Extended Cookbook type with aggregated fields (for list views)
export type CookbookWithCount = Cookbook & {
  recipeCount?: number;
};

// Cookbook Recipes
export const insertCookbookRecipeSchema = createInsertSchema(cookbookRecipes).omit({
  id: true,
  addedAt: true,
});
export type InsertCookbookRecipe = z.infer<typeof insertCookbookRecipeSchema>;
export type CookbookRecipe = typeof cookbookRecipes.$inferSelect;

// Recipe Shares
export const insertRecipeShareSchema = createInsertSchema(recipeShares).omit({
  id: true,
  sharedAt: true,
});
export type InsertRecipeShare = z.infer<typeof insertRecipeShareSchema>;
export type RecipeShare = typeof recipeShares.$inferSelect;

// Cookbook Follows
export const insertCookbookFollowSchema = createInsertSchema(cookbookFollows).omit({
  id: true,
  followedAt: true,
});
export type InsertCookbookFollow = z.infer<typeof insertCookbookFollowSchema>;
export type CookbookFollow = typeof cookbookFollows.$inferSelect;

// Cookbook Collaborators
export const insertCookbookCollaboratorSchema = createInsertSchema(cookbookCollaborators).omit({
  id: true,
  createdAt: true,
});
export type InsertCookbookCollaborator = z.infer<typeof insertCookbookCollaboratorSchema>;
export type CookbookCollaborator = typeof cookbookCollaborators.$inferSelect;

// Extended collaborator type with user details
export type CookbookCollaboratorWithUser = CookbookCollaborator & {
  user: {
    id: string;
    email: string | null;
    firstName: string | null;
    lastName: string | null;
    profileImageUrl: string | null;
  };
};

// Cookbook Invitations
export const insertCookbookInvitationSchema = createInsertSchema(cookbookInvitations).omit({
  id: true,
  createdAt: true,
  respondedAt: true,
});
export type InsertCookbookInvitation = z.infer<typeof insertCookbookInvitationSchema>;
export type CookbookInvitation = typeof cookbookInvitations.$inferSelect;

// Extended invitation type with cookbook and inviter details
export type CookbookInvitationWithDetails = CookbookInvitation & {
  cookbook: {
    id: number;
    name: string;
    description: string | null;
  };
  inviter: {
    id: string;
    firstName: string | null;
    lastName: string | null;
    profileImageUrl: string | null;
  };
};

// Grocery Lists
export const insertGroceryListSchema = createInsertSchema(groceryLists).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertGroceryList = z.infer<typeof insertGroceryListSchema>;
export type GroceryList = typeof groceryLists.$inferSelect;

// Grocery List Items
export const insertGroceryListItemSchema = createInsertSchema(groceryListItems).omit({
  id: true,
  addedAt: true,
  updatedAt: true,
});
export type InsertGroceryListItem = z.infer<typeof insertGroceryListItemSchema>;
export type GroceryListItem = typeof groceryListItems.$inferSelect;

// Extended grocery list item with display fields for unit conversion
export type GroceryListItemWithDisplay = GroceryListItem & {
  displayQuantity: number;
  displayUnit: string;
  displayText: string;
};

// Extended types for grocery list views (with recipe info)
export type GroceryListWithItems = GroceryList & {
  items: GroceryListItem[];
};

export type GroceryListItemsByAisle = {
  aisle: string;
  items: GroceryListItemWithDisplay[];
};

// Pantry Items
export const insertPantryItemSchema = createInsertSchema(pantryItems).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertPantryItem = z.infer<typeof insertPantryItemSchema>;
export type PantryItem = typeof pantryItems.$inferSelect;

// Pantry Scan Sessions
export const insertPantryScanSessionSchema = createInsertSchema(pantryScanSessions).omit({
  id: true,
  createdAt: true,
  completedAt: true,
});
export type InsertPantryScanSession = z.infer<typeof insertPantryScanSessionSchema>;
export type PantryScanSession = typeof pantryScanSessions.$inferSelect;

// Grocery List Shares
export const insertGroceryListShareSchema = createInsertSchema(groceryListShares).omit({
  id: true,
  createdAt: true,
  lastAccessedAt: true,
  accessCount: true,
});
export type InsertGroceryListShare = z.infer<typeof insertGroceryListShareSchema>;
export type GroceryListShare = typeof groceryListShares.$inferSelect;

// Grocery List Collaborators
export const insertGroceryListCollaboratorSchema = createInsertSchema(groceryListCollaborators).omit({
  id: true,
  joinedAt: true,
  lastSeenAt: true,
});
export type InsertGroceryListCollaborator = z.infer<typeof insertGroceryListCollaboratorSchema>;
export type GroceryListCollaborator = typeof groceryListCollaborators.$inferSelect;

// Extended types for pantry/grocery matching
export type GroceryListItemWithPantryMatch = GroceryListItemWithDisplay & {
  inPantry: boolean;
  pantryItemId?: string;
  pantryQuantity?: number;
  pantryUnit?: string;
};

// Extended types for shared grocery lists
export type GroceryListShareWithDetails = GroceryListShare & {
  list?: GroceryList;
  collaborators?: GroceryListCollaborator[];
};

// WebSocket message types for real-time grocery list updates
export type GroceryListUpdateMessage = 
  | { type: 'item_checked'; itemId: string; checked: boolean; actorName: string }
  | { type: 'item_added'; item: GroceryListItem; actorName: string }
  | { type: 'item_removed'; itemId: string; actorName: string }
  | { type: 'collaborator_joined'; collaborator: GroceryListCollaborator }
  | { type: 'collaborator_left'; collaboratorId: string }
  | { type: 'presence_update'; collaborators: GroceryListCollaborator[] };

// Nested types (for backward compatibility)
export type NormalizedIngredient = z.infer<typeof normalizedIngredientSchema>;
export type InstructionStep = z.infer<typeof instructionStepSchema>;
export type Tip = z.infer<typeof tipSchema>;
export type Variation = z.infer<typeof variationSchema>;
export type ValidationWarning = z.infer<typeof validationWarningSchema>;
export type BeveragePairing = z.infer<typeof beveragePairingSchema>;
export type BeveragePairings = z.infer<typeof beveragePairingsSchema>;
export type IngredientSwap = z.infer<typeof ingredientSwapSchema>;
export type Enhancement = z.infer<typeof enhancementSchema>;
export type RecipeVariations = z.infer<typeof recipeVariationsSchema>;
export type CelebrityChefReview = z.infer<typeof celebrityChefReviewSchema>;
export type CelebrityChefReviews = z.infer<typeof celebrityChefReviewsSchema>;

// ============================================================================
// VOICE SESSIONS TABLE (for secure ElevenLabs webhook authentication)
// ============================================================================
export const voiceSessions = pgTable("voice_sessions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: 'cascade' }),
  token: varchar("token").notNull().unique(), // Short-lived token for webhook auth
  mode: text("mode").$type<'general' | 'cooking'>().default('general').notNull(),
  recipeId: varchar("recipe_id").references(() => recipes.id, { onDelete: 'set null' }), // For cooking mode
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  tokenIdx: index("voice_sessions_token_idx").on(table.token),
  userIdIdx: index("voice_sessions_user_id_idx").on(table.userId),
}));

export type VoiceSession = typeof voiceSessions.$inferSelect;
export type InsertVoiceSession = typeof voiceSessions.$inferInsert;
export const insertVoiceSessionSchema = createInsertSchema(voiceSessions).omit({
  id: true,
  createdAt: true,
});

// Voice webhook request/response schemas
export const voiceAddPantryItemSchema = z.object({
  items: z.array(z.object({
    name: z.string(),
    quantity: z.number().optional(),
    unit: z.string().optional(),
    category: z.string().optional(),
  })),
});

export const voiceGetPantrySchema = z.object({
  category: z.string().optional(), // Filter by category
  limit: z.number().optional().default(20),
});

export const voiceUpdatePreferencesSchema = z.object({
  allergies: z.array(z.string()).optional(),
  dietaryRestrictions: z.array(z.string()).optional(),
  dislikedIngredients: z.array(z.string()).optional(),
  cookingSkillLevel: z.enum(['beginner', 'intermediate', 'advanced', 'professional']).optional(),
  cuisinePreferences: z.array(z.string()).optional(),
  householdSize: z.number().optional(),
  cookingGoals: z.array(z.string()).optional(),
  grammieNotes: z.string().optional(),
  unitSystem: z.enum(['metric', 'us']).optional(),
});

export const voiceCreateRecipeSchema = z.object({
  title: z.string(),
  description: z.string().optional(),
  ingredients: z.array(z.string()), // Raw ingredient strings
  instructions: z.array(z.string()), // Raw instruction strings
  prepTime: z.string().optional(),
  cookTime: z.string().optional(),
  servings: z.number().optional(),
  cuisine: z.string().optional(),
  notes: z.string().optional(),
});

export type VoiceAddPantryItem = z.infer<typeof voiceAddPantryItemSchema>;
export type VoiceGetPantry = z.infer<typeof voiceGetPantrySchema>;
export type VoiceUpdatePreferences = z.infer<typeof voiceUpdatePreferencesSchema>;
export type VoiceCreateRecipe = z.infer<typeof voiceCreateRecipeSchema>;

// Deterministic helper functions for derived fields
export function deriveAllergenFreeTags(allergensPresent: string[] | null | undefined): string[] {
  // CRITICAL: Only declare allergen-free when we have positive evidence
  // null/undefined = unknown allergen status → return empty array
  // empty array = no allergens present → return all allergen-free tags
  if (allergensPresent === null || allergensPresent === undefined) {
    return []; // Unknown allergen status - don't make false claims
  }
  
  if (allergensPresent.length === 0) {
    // No allergens present - safe to mark all as allergen-free
    return [...CANONICAL_ALLERGENS].map(a => `${a}-Free`);
  }
  
  // Some allergens present - only mark as free for allergens NOT in the list
  const presentSet = new Set(allergensPresent.map(a => a.toLowerCase()));
  return CANONICAL_ALLERGENS
    .filter(allergen => !presentSet.has(allergen.toLowerCase()))
    .map(allergen => `${allergen}-Free`);
}

export function deriveTimeConvenienceTags(totalTimeMinutes: number | null | undefined): string[] {
  if (!totalTimeMinutes) return [];
  
  const tags: string[] = [];
  if (totalTimeMinutes <= 15) tags.push("Under 15 mins");
  if (totalTimeMinutes <= 30) tags.push("Under 30 mins");
  if (totalTimeMinutes <= 60) tags.push("Under 1 hour");
  if (totalTimeMinutes >= 120) {
    // Check cooking method to determine if it's slow cooker or BBQ
    tags.push("2+ hours");
  }
  return tags;
}

export function deriveGroceryAisleTags(normalizedIngredients: NormalizedIngredient[] | null | undefined): string[] {
  if (!normalizedIngredients) return [];
  
  const aisles = new Set<string>();
  for (const ingredient of normalizedIngredients) {
    if (ingredient.groceryMapping?.aisle) {
      aisles.add(ingredient.groceryMapping.aisle);
    }
  }
  return Array.from(aisles).sort();
}

export function deriveLegacyCuisine(cuisines: string[] | null | undefined): string | null {
  if (!cuisines || cuisines.length === 0) return null;
  return cuisines[0];
}

export function deriveLegacyEquipment(
  standardEquipment: string[] | null | undefined,
  specializedEquipment: string[] | null | undefined
): string[] {
  const combined = [
    ...(standardEquipment || []),
    ...(specializedEquipment || []),
  ];
  return Array.from(new Set(combined));
}

// Nutrition flag thresholds based on FDA standards and nutritional guidelines
export function deriveNutritionFlags(nutrition: {
  fat?: number | null;
  sodium?: number | null;
  sugar?: number | null;
}): {
  isLowFat: boolean;
  isLowSodium: boolean;
  isLowSugar: boolean;
} {
  return {
    isLowFat: nutrition.fat != null && nutrition.fat < 3, // < 3g per serving (FDA standard)
    isLowSodium: nutrition.sodium != null && nutrition.sodium < 140, // < 140mg per serving (FDA standard)
    isLowSugar: nutrition.sugar != null && nutrition.sugar < 5, // < 5g per serving (approximate guideline)
  };
}
