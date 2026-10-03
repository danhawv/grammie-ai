CREATE TABLE "auth_credentials" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"provider" text NOT NULL,
	"provider_user_id" varchar NOT NULL,
	"password_hash" varchar,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "auth_credentials_provider_provider_user_id_unique" UNIQUE("provider","provider_user_id")
);
--> statement-breakpoint
CREATE TABLE "bookmarks" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar NOT NULL,
	"recipe_id" varchar NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "bookmarks_user_id_recipe_id_unique" UNIQUE("user_id","recipe_id")
);
--> statement-breakpoint
CREATE TABLE "cookbook_collaborators" (
	"id" serial PRIMARY KEY NOT NULL,
	"cookbook_id" integer NOT NULL,
	"user_id" varchar NOT NULL,
	"role" text DEFAULT 'editor' NOT NULL,
	"added_by_user_id" varchar NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "cookbook_collaborators_cookbook_id_user_id_unique" UNIQUE("cookbook_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "cookbook_follows" (
	"id" serial PRIMARY KEY NOT NULL,
	"cookbook_id" integer NOT NULL,
	"user_id" varchar NOT NULL,
	"followed_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "cookbook_follows_cookbook_id_user_id_unique" UNIQUE("cookbook_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "cookbook_invitations" (
	"id" serial PRIMARY KEY NOT NULL,
	"cookbook_id" integer NOT NULL,
	"inviter_user_id" varchar NOT NULL,
	"invitee_email" varchar,
	"invitee_user_id" varchar,
	"status" text DEFAULT 'pending' NOT NULL,
	"token" varchar NOT NULL,
	"message" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp NOT NULL,
	"responded_at" timestamp,
	CONSTRAINT "cookbook_invitations_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "cookbook_print_projects" (
	"id" serial PRIMARY KEY NOT NULL,
	"cookbook_id" integer NOT NULL,
	"owner_user_id" varchar NOT NULL,
	"layout_data" jsonb NOT NULL,
	"template_style" varchar(50) DEFAULT 'classic' NOT NULL,
	"custom_template_id" integer,
	"trim_size" varchar(20) DEFAULT '0600X0900' NOT NULL,
	"binding_type" varchar(5) DEFAULT 'PB' NOT NULL,
	"color_type" varchar(5) DEFAULT 'FC' NOT NULL,
	"paper_type" varchar(20) DEFAULT '080CW444' NOT NULL,
	"cover_finish" varchar(5) DEFAULT 'M' NOT NULL,
	"preflight_status" varchar(20) DEFAULT 'pending',
	"preflight_warnings" jsonb,
	"pdf_url" text,
	"pdf_generated_at" timestamp,
	"lulu_order_id" varchar(100),
	"lulu_order_status" varchar(50),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cookbook_recipes" (
	"id" serial PRIMARY KEY NOT NULL,
	"cookbook_id" integer NOT NULL,
	"recipe_id" varchar NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"added_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "cookbook_recipes_cookbook_id_recipe_id_unique" UNIQUE("cookbook_id","recipe_id")
);
--> statement-breakpoint
CREATE TABLE "cookbooks" (
	"id" serial PRIMARY KEY NOT NULL,
	"owner_user_id" varchar NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"cover_image" text,
	"is_public" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "custom_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"owner_user_id" varchar NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"thumbnail" text,
	"is_public" boolean DEFAULT false,
	"template_data" jsonb NOT NULL,
	"custom_fonts" jsonb,
	"background_image" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "grocery_list_collaborators" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"share_id" varchar NOT NULL,
	"user_id" varchar,
	"display_name" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_seen_at" timestamp DEFAULT now() NOT NULL,
	"joined_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "grocery_list_items" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"list_id" varchar NOT NULL,
	"recipe_id" varchar,
	"item" text NOT NULL,
	"quantity" real NOT NULL,
	"unit" text NOT NULL,
	"display_name" text NOT NULL,
	"aisle" text,
	"category" text,
	"emoji" text,
	"checked" boolean DEFAULT false NOT NULL,
	"original_entries" jsonb DEFAULT '[]'::jsonb,
	"added_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "grocery_list_shares" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"list_id" varchar NOT NULL,
	"token" varchar(64) NOT NULL,
	"created_by_user_id" varchar NOT NULL,
	"can_edit" boolean DEFAULT true NOT NULL,
	"expires_at" timestamp,
	"last_accessed_at" timestamp,
	"access_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "grocery_list_shares_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "grocery_lists" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"name" text DEFAULT 'My Grocery List' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "grocery_lists_user_id_status_unique" UNIQUE("user_id","status")
);
--> statement-breakpoint
CREATE TABLE "meal_plan_collaborators" (
	"id" serial PRIMARY KEY NOT NULL,
	"meal_plan_id" varchar NOT NULL,
	"user_id" varchar NOT NULL,
	"role" text DEFAULT 'editor' NOT NULL,
	"added_by_user_id" varchar NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "meal_plan_collaborators_meal_plan_id_user_id_unique" UNIQUE("meal_plan_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "meal_plan_entries" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"meal_plan_id" varchar NOT NULL,
	"date" timestamp NOT NULL,
	"meal_slot" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"recipe_id" varchar,
	"scaled_servings" integer,
	"assigned_user_id" varchar,
	"is_leftover" boolean DEFAULT false NOT NULL,
	"leftover_from_entry_id" varchar,
	"custom_meal_name" text,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meal_plan_invitations" (
	"id" serial PRIMARY KEY NOT NULL,
	"meal_plan_id" varchar NOT NULL,
	"inviter_user_id" varchar NOT NULL,
	"invitee_email" varchar,
	"invitee_user_id" varchar,
	"status" text DEFAULT 'pending' NOT NULL,
	"token" varchar NOT NULL,
	"message" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp NOT NULL,
	"responded_at" timestamp,
	CONSTRAINT "meal_plan_invitations_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "meal_plans" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"owner_user_id" varchar NOT NULL,
	"start_date" timestamp NOT NULL,
	"end_date" timestamp NOT NULL,
	"is_template" boolean DEFAULT false NOT NULL,
	"template_name" text,
	"created_from_template_id" varchar,
	"grocery_list_id" varchar,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pantry_items" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"name" text NOT NULL,
	"quantity" real,
	"unit" text,
	"source" text DEFAULT 'manual' NOT NULL,
	"category" text,
	"emoji" text,
	"expires_at" timestamp,
	"notes" text,
	"normalized_name" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pantry_scan_sessions" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"image_url" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"extracted_items" jsonb,
	"error_message" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "pantry_staples" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"name" text NOT NULL,
	"normalized_name" text NOT NULL,
	"category" text,
	"emoji" text,
	"min_quantity" real,
	"preferred_unit" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recipe_shares" (
	"id" serial PRIMARY KEY NOT NULL,
	"recipe_id" varchar NOT NULL,
	"user_id" varchar NOT NULL,
	"role" text DEFAULT 'viewer' NOT NULL,
	"shared_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "recipe_shares_recipe_id_user_id_unique" UNIQUE("recipe_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "recipes" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"prep_time" text NOT NULL,
	"cook_time" text,
	"total_time" text NOT NULL,
	"cooling_time" text,
	"prep_time_minutes" integer,
	"cook_time_minutes" integer,
	"total_time_minutes" integer,
	"servings" integer NOT NULL,
	"serving_unit" text,
	"serving_size" text,
	"yield" text,
	"ingredients" text[] NOT NULL,
	"normalized_ingredients" jsonb,
	"instructions" text[] NOT NULL,
	"normalized_instructions" jsonb,
	"equipment" text[],
	"standard_equipment" text[],
	"specialized_equipment" text[],
	"grocery_aisle_tags" text[],
	"diet_type" text[],
	"cuisine" text,
	"cuisines" text[],
	"meal_type" text[],
	"time_convenience_tags" text[],
	"skill_level" text,
	"skill_level_explanation" text,
	"is_vegetarian" boolean,
	"is_vegan" boolean,
	"is_pescatarian" boolean,
	"is_gluten_free" boolean,
	"is_dairy_free" boolean,
	"is_keto" boolean,
	"is_paleo" boolean,
	"is_low_carb" boolean,
	"is_high_protein" boolean,
	"is_low_calorie" boolean,
	"is_high_fiber" boolean,
	"is_lacto_vegetarian" boolean,
	"is_mediterranean" boolean,
	"is_ovo_vegetarian" boolean,
	"is_ovo_lacto_vegetarian" boolean,
	"is_flexitarian" boolean,
	"is_carnivore" boolean,
	"is_kosher" boolean,
	"is_halal" boolean,
	"is_hindu" boolean,
	"is_low_fat" boolean,
	"is_low_sodium" boolean,
	"is_low_sugar" boolean,
	"allergens" text[],
	"allergen_free_tags" text[],
	"cooking_methods" text[],
	"season_tags" text[],
	"occasion_tags" text[],
	"price_range_min" real,
	"price_range_max" real,
	"price_category" text,
	"total_cost" real,
	"cost_excluding_staples" real,
	"health_score" integer,
	"dish_image" text,
	"dish_image_thumbnail" text,
	"dish_images" jsonb,
	"image_prompt" text,
	"handwritten_image" text,
	"calories" integer,
	"protein" real,
	"carbohydrates" real,
	"fat" real,
	"fiber" real,
	"sugar" real,
	"sodium" integer,
	"cholesterol" integer,
	"tips" jsonb,
	"variations" jsonb,
	"serving_suggestions" text[],
	"beverage_pairings" jsonb,
	"recipe_variations" jsonb,
	"cultural_significance" text,
	"celebrity_chef_reviews" jsonb,
	"validation_warnings" jsonb,
	"ai_enriched" boolean,
	"ai_enrichment_fields" text[],
	"instructions_generated" boolean DEFAULT false,
	"original_instructions" text[],
	"enrichment_status" text DEFAULT 'extracting',
	"content_enrichment_status" varchar DEFAULT 'pending',
	"enrichment_error" text,
	"enrichment_retry_count" integer DEFAULT 0,
	"enrichment_started_at" timestamp,
	"image_generation_status" text DEFAULT 'pending',
	"image_generation_error" text,
	"image_generation_started_at" timestamp,
	"owner_user_id" varchar,
	"is_public" boolean DEFAULT true NOT NULL,
	"published_at" timestamp,
	"forked_from_id" varchar,
	"fork_count" integer DEFAULT 0 NOT NULL,
	"derived_from_recipe_id" varchar,
	"variation_notes" text,
	"variation_modifications" text[],
	"upload_session_id" varchar,
	"source_image_index" integer,
	"social_source_platform" text,
	"social_source_url" text,
	"social_source_creator_username" text,
	"social_source_creator_avatar" text,
	"social_source_post_date" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"sid" varchar PRIMARY KEY NOT NULL,
	"sess" jsonb NOT NULL,
	"expire" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "upload_sessions" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"total_files" integer NOT NULL,
	"completed_count" integer DEFAULT 0 NOT NULL,
	"failed_count" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'processing' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar,
	"clerk_id" varchar,
	"first_name" varchar,
	"last_name" varchar,
	"profile_image_url" varchar,
	"username" varchar,
	"bio" text,
	"default_recipe_visibility" text DEFAULT 'public',
	"default_cookbook_visibility" text DEFAULT 'public',
	"is_admin" boolean DEFAULT false,
	"auto_enrich_recipes" boolean DEFAULT true,
	"notify_on_enrichment_complete" boolean DEFAULT true,
	"notify_on_cookbook_follows" boolean DEFAULT true,
	"preferences" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_clerk_id_unique" UNIQUE("clerk_id"),
	CONSTRAINT "users_username_unique" UNIQUE("username")
);
--> statement-breakpoint
CREATE TABLE "voice_sessions" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"token" varchar NOT NULL,
	"mode" text DEFAULT 'general' NOT NULL,
	"recipe_id" varchar,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "voice_sessions_token_unique" UNIQUE("token")
);
--> statement-breakpoint
ALTER TABLE "auth_credentials" ADD CONSTRAINT "auth_credentials_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookmarks" ADD CONSTRAINT "bookmarks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookmarks" ADD CONSTRAINT "bookmarks_recipe_id_recipes_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cookbook_collaborators" ADD CONSTRAINT "cookbook_collaborators_cookbook_id_cookbooks_id_fk" FOREIGN KEY ("cookbook_id") REFERENCES "public"."cookbooks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cookbook_collaborators" ADD CONSTRAINT "cookbook_collaborators_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cookbook_collaborators" ADD CONSTRAINT "cookbook_collaborators_added_by_user_id_users_id_fk" FOREIGN KEY ("added_by_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cookbook_follows" ADD CONSTRAINT "cookbook_follows_cookbook_id_cookbooks_id_fk" FOREIGN KEY ("cookbook_id") REFERENCES "public"."cookbooks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cookbook_follows" ADD CONSTRAINT "cookbook_follows_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cookbook_invitations" ADD CONSTRAINT "cookbook_invitations_cookbook_id_cookbooks_id_fk" FOREIGN KEY ("cookbook_id") REFERENCES "public"."cookbooks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cookbook_invitations" ADD CONSTRAINT "cookbook_invitations_inviter_user_id_users_id_fk" FOREIGN KEY ("inviter_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cookbook_invitations" ADD CONSTRAINT "cookbook_invitations_invitee_user_id_users_id_fk" FOREIGN KEY ("invitee_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cookbook_print_projects" ADD CONSTRAINT "cookbook_print_projects_cookbook_id_cookbooks_id_fk" FOREIGN KEY ("cookbook_id") REFERENCES "public"."cookbooks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cookbook_print_projects" ADD CONSTRAINT "cookbook_print_projects_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cookbook_print_projects" ADD CONSTRAINT "cookbook_print_projects_custom_template_id_custom_templates_id_fk" FOREIGN KEY ("custom_template_id") REFERENCES "public"."custom_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cookbook_recipes" ADD CONSTRAINT "cookbook_recipes_cookbook_id_cookbooks_id_fk" FOREIGN KEY ("cookbook_id") REFERENCES "public"."cookbooks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cookbook_recipes" ADD CONSTRAINT "cookbook_recipes_recipe_id_recipes_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cookbooks" ADD CONSTRAINT "cookbooks_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_templates" ADD CONSTRAINT "custom_templates_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grocery_list_collaborators" ADD CONSTRAINT "grocery_list_collaborators_share_id_grocery_list_shares_id_fk" FOREIGN KEY ("share_id") REFERENCES "public"."grocery_list_shares"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grocery_list_collaborators" ADD CONSTRAINT "grocery_list_collaborators_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grocery_list_items" ADD CONSTRAINT "grocery_list_items_list_id_grocery_lists_id_fk" FOREIGN KEY ("list_id") REFERENCES "public"."grocery_lists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grocery_list_items" ADD CONSTRAINT "grocery_list_items_recipe_id_recipes_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grocery_list_shares" ADD CONSTRAINT "grocery_list_shares_list_id_grocery_lists_id_fk" FOREIGN KEY ("list_id") REFERENCES "public"."grocery_lists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grocery_list_shares" ADD CONSTRAINT "grocery_list_shares_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grocery_lists" ADD CONSTRAINT "grocery_lists_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_plan_collaborators" ADD CONSTRAINT "meal_plan_collaborators_meal_plan_id_meal_plans_id_fk" FOREIGN KEY ("meal_plan_id") REFERENCES "public"."meal_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_plan_collaborators" ADD CONSTRAINT "meal_plan_collaborators_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_plan_collaborators" ADD CONSTRAINT "meal_plan_collaborators_added_by_user_id_users_id_fk" FOREIGN KEY ("added_by_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_plan_entries" ADD CONSTRAINT "meal_plan_entries_meal_plan_id_meal_plans_id_fk" FOREIGN KEY ("meal_plan_id") REFERENCES "public"."meal_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_plan_entries" ADD CONSTRAINT "meal_plan_entries_recipe_id_recipes_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_plan_entries" ADD CONSTRAINT "meal_plan_entries_assigned_user_id_users_id_fk" FOREIGN KEY ("assigned_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_plan_invitations" ADD CONSTRAINT "meal_plan_invitations_meal_plan_id_meal_plans_id_fk" FOREIGN KEY ("meal_plan_id") REFERENCES "public"."meal_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_plan_invitations" ADD CONSTRAINT "meal_plan_invitations_inviter_user_id_users_id_fk" FOREIGN KEY ("inviter_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_plan_invitations" ADD CONSTRAINT "meal_plan_invitations_invitee_user_id_users_id_fk" FOREIGN KEY ("invitee_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_plans" ADD CONSTRAINT "meal_plans_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pantry_items" ADD CONSTRAINT "pantry_items_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pantry_scan_sessions" ADD CONSTRAINT "pantry_scan_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pantry_staples" ADD CONSTRAINT "pantry_staples_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_shares" ADD CONSTRAINT "recipe_shares_recipe_id_recipes_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_shares" ADD CONSTRAINT "recipe_shares_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipes" ADD CONSTRAINT "recipes_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipes" ADD CONSTRAINT "recipes_forked_from_id_recipes_id_fk" FOREIGN KEY ("forked_from_id") REFERENCES "public"."recipes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipes" ADD CONSTRAINT "recipes_derived_from_recipe_id_recipes_id_fk" FOREIGN KEY ("derived_from_recipe_id") REFERENCES "public"."recipes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipes" ADD CONSTRAINT "recipes_upload_session_id_upload_sessions_id_fk" FOREIGN KEY ("upload_session_id") REFERENCES "public"."upload_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upload_sessions" ADD CONSTRAINT "upload_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voice_sessions" ADD CONSTRAINT "voice_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voice_sessions" ADD CONSTRAINT "voice_sessions_recipe_id_recipes_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bookmarks_user_id_idx" ON "bookmarks" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "bookmarks_recipe_id_idx" ON "bookmarks" USING btree ("recipe_id");--> statement-breakpoint
CREATE INDEX "cookbook_collaborators_cookbook_id_idx" ON "cookbook_collaborators" USING btree ("cookbook_id");--> statement-breakpoint
CREATE INDEX "cookbook_collaborators_user_id_idx" ON "cookbook_collaborators" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "cookbook_invitations_cookbook_id_idx" ON "cookbook_invitations" USING btree ("cookbook_id");--> statement-breakpoint
CREATE INDEX "cookbook_invitations_invitee_user_id_idx" ON "cookbook_invitations" USING btree ("invitee_user_id");--> statement-breakpoint
CREATE INDEX "cookbook_invitations_invitee_email_idx" ON "cookbook_invitations" USING btree ("invitee_email");--> statement-breakpoint
CREATE INDEX "cookbook_invitations_token_idx" ON "cookbook_invitations" USING btree ("token");--> statement-breakpoint
CREATE INDEX "cookbook_invitations_status_idx" ON "cookbook_invitations" USING btree ("status");--> statement-breakpoint
CREATE INDEX "print_projects_cookbook_id_idx" ON "cookbook_print_projects" USING btree ("cookbook_id");--> statement-breakpoint
CREATE INDEX "print_projects_owner_user_id_idx" ON "cookbook_print_projects" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "cookbook_recipes_recipe_id_idx" ON "cookbook_recipes" USING btree ("recipe_id");--> statement-breakpoint
CREATE INDEX "cookbook_recipes_cookbook_id_idx" ON "cookbook_recipes" USING btree ("cookbook_id");--> statement-breakpoint
CREATE INDEX "cookbooks_owner_user_id_idx" ON "cookbooks" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "cookbooks_is_public_idx" ON "cookbooks" USING btree ("is_public");--> statement-breakpoint
CREATE INDEX "custom_templates_owner_user_id_idx" ON "custom_templates" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "custom_templates_is_public_idx" ON "custom_templates" USING btree ("is_public");--> statement-breakpoint
CREATE INDEX "grocery_list_collaborators_share_id_idx" ON "grocery_list_collaborators" USING btree ("share_id");--> statement-breakpoint
CREATE INDEX "grocery_list_collaborators_user_id_idx" ON "grocery_list_collaborators" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "grocery_list_items_list_id_idx" ON "grocery_list_items" USING btree ("list_id");--> statement-breakpoint
CREATE INDEX "grocery_list_items_recipe_id_idx" ON "grocery_list_items" USING btree ("recipe_id");--> statement-breakpoint
CREATE INDEX "grocery_list_items_list_id_item_idx" ON "grocery_list_items" USING btree ("list_id","item");--> statement-breakpoint
CREATE INDEX "grocery_list_shares_token_idx" ON "grocery_list_shares" USING btree ("token");--> statement-breakpoint
CREATE INDEX "grocery_list_shares_list_id_idx" ON "grocery_list_shares" USING btree ("list_id");--> statement-breakpoint
CREATE INDEX "grocery_lists_user_id_idx" ON "grocery_lists" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "meal_plan_collaborators_meal_plan_id_idx" ON "meal_plan_collaborators" USING btree ("meal_plan_id");--> statement-breakpoint
CREATE INDEX "meal_plan_collaborators_user_id_idx" ON "meal_plan_collaborators" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "meal_plan_entries_meal_plan_id_idx" ON "meal_plan_entries" USING btree ("meal_plan_id");--> statement-breakpoint
CREATE INDEX "meal_plan_entries_date_idx" ON "meal_plan_entries" USING btree ("date");--> statement-breakpoint
CREATE INDEX "meal_plan_entries_recipe_id_idx" ON "meal_plan_entries" USING btree ("recipe_id");--> statement-breakpoint
CREATE INDEX "meal_plan_entries_plan_date_slot_idx" ON "meal_plan_entries" USING btree ("meal_plan_id","date","meal_slot");--> statement-breakpoint
CREATE INDEX "meal_plan_invitations_meal_plan_id_idx" ON "meal_plan_invitations" USING btree ("meal_plan_id");--> statement-breakpoint
CREATE INDEX "meal_plan_invitations_invitee_user_id_idx" ON "meal_plan_invitations" USING btree ("invitee_user_id");--> statement-breakpoint
CREATE INDEX "meal_plan_invitations_token_idx" ON "meal_plan_invitations" USING btree ("token");--> statement-breakpoint
CREATE INDEX "meal_plans_owner_user_id_idx" ON "meal_plans" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "meal_plans_status_idx" ON "meal_plans" USING btree ("status");--> statement-breakpoint
CREATE INDEX "meal_plans_date_range_idx" ON "meal_plans" USING btree ("start_date","end_date");--> statement-breakpoint
CREATE INDEX "pantry_items_user_id_idx" ON "pantry_items" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "pantry_items_normalized_name_idx" ON "pantry_items" USING btree ("normalized_name");--> statement-breakpoint
CREATE INDEX "pantry_items_category_idx" ON "pantry_items" USING btree ("category");--> statement-breakpoint
CREATE INDEX "pantry_staples_user_id_idx" ON "pantry_staples" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pantry_staples_user_item_idx" ON "pantry_staples" USING btree ("user_id","normalized_name");--> statement-breakpoint
CREATE INDEX "recipe_shares_recipe_id_idx" ON "recipe_shares" USING btree ("recipe_id");--> statement-breakpoint
CREATE INDEX "recipe_shares_user_id_idx" ON "recipe_shares" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "recipe_shares_user_id_recipe_id_idx" ON "recipe_shares" USING btree ("user_id","recipe_id");--> statement-breakpoint
CREATE INDEX "recipes_owner_user_id_idx" ON "recipes" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "recipes_is_public_idx" ON "recipes" USING btree ("is_public");--> statement-breakpoint
CREATE INDEX "recipes_enrichment_status_idx" ON "recipes" USING btree ("enrichment_status");--> statement-breakpoint
CREATE INDEX "recipes_is_public_created_at_idx" ON "recipes" USING btree ("is_public","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "recipes_owner_user_id_created_at_idx" ON "recipes" USING btree ("owner_user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "upload_sessions_user_id_idx" ON "upload_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "upload_sessions_status_idx" ON "upload_sessions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "voice_sessions_token_idx" ON "voice_sessions" USING btree ("token");--> statement-breakpoint
CREATE INDEX "voice_sessions_user_id_idx" ON "voice_sessions" USING btree ("user_id");