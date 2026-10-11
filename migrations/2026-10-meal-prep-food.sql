-- Meal prep, part 1 (food data): the canonical ingredient catalog, the map
-- from recipe item names to it, grocery package sizes, and a cache of
-- computed RecipeFacts (server/meal-prep/food/). Additive only: new tables,
-- nothing existing changes. Safe to run on a live database, safe to run
-- twice. Until it's applied, meal prep computes facts on every request from
-- the committed seeds and caches nothing.
--
-- After applying, load the seeds (reviewable JSON in server/meal-prep/food/data/):
--   npx tsx scripts/meal-prep/seed-food-tables.ts --yes

-- One row per canonical ingredient; macros per 100 g from USDA FoodData Central
CREATE TABLE IF NOT EXISTS meal_prep_ingredients (
  id                varchar(60) PRIMARY KEY,           -- slug, e.g. 'onion-yellow'
  name              text NOT NULL,
  aisle             varchar(40) NOT NULL,              -- one of AISLES in shared/meal-prep/contract.ts
  fdc_id            integer,                           -- USDA FoodData Central id (null = label data)
  usda_description  text,
  source            varchar(20) NOT NULL,              -- usda-sr | usda-foundation | label
  kcal              real NOT NULL,
  protein           real NOT NULL,
  carbs             real NOT NULL,
  fat               real NOT NULL,
  fiber             real NOT NULL DEFAULT 0,
  cup_grams         real,                              -- density: grams per US cup
  portions          jsonb NOT NULL DEFAULT '{}'::jsonb, -- grams per piece/small/medium/large/clove/slice/...
  pack_grams        real,                              -- usual can/jar/package a line might say
  allergens         text[] NOT NULL DEFAULT '{}',
  protein_kind      varchar(20),                       -- chicken, beef, fish, beans...
  cooked            boolean NOT NULL DEFAULT false,
  aliases           text[] NOT NULL DEFAULT '{}',
  updated_at        timestamp NOT NULL DEFAULT now()
);

-- Recipe item names ('onions', 'Fresh Cilantro', 't''loin') -> canonical ingredient.
-- Seeded from item-map.json; names first seen later can be added with reviewed=false.
CREATE TABLE IF NOT EXISTS meal_prep_item_map (
  item           text PRIMARY KEY,                     -- lowercased, trimmed
  ingredient_id  varchar(60) REFERENCES meal_prep_ingredients(id) ON DELETE SET NULL, -- null = not food / unknown
  confidence     real NOT NULL,                        -- 0..1
  method         varchar(20) NOT NULL,                 -- exact | normalized | head | trigram | ai | manual | none
  reviewed       boolean NOT NULL DEFAULT false,
  updated_at     timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS meal_prep_item_map_ingredient_idx ON meal_prep_item_map (ingredient_id);

-- Common grocery package sizes for the shopping list ("1 bag (2 lb)")
CREATE TABLE IF NOT EXISTS meal_prep_package_sizes (
  id             serial PRIMARY KEY,
  ingredient_id  varchar(60) NOT NULL REFERENCES meal_prep_ingredients(id) ON DELETE CASCADE,
  label          text NOT NULL,
  grams          real NOT NULL,
  price          real,
  UNIQUE (ingredient_id, label)
);

-- Computed RecipeFacts, valid while the recipe's updated_at and the food data
-- version (a hash of the seeds) match; anything else is recomputed on read
CREATE TABLE IF NOT EXISTS meal_prep_recipe_facts (
  recipe_id          varchar PRIMARY KEY REFERENCES recipes(id) ON DELETE CASCADE,
  recipe_updated_at  timestamp NOT NULL,
  version            varchar(40) NOT NULL,
  facts              jsonb NOT NULL,
  confidence         varchar(10) NOT NULL,             -- high | medium | low, for quick review queries
  computed_at        timestamp NOT NULL DEFAULT now()
);
