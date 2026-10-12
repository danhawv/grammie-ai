-- Meal prep: cached ingredient swaps per recipe (RecipeFacts.swaps, from
-- server/meal-prep/food/swaps.ts). Additive only: one new table, nothing
-- existing changes. Safe to run on a live database, safe to run twice. Until
-- it's applied, recipes simply have no swaps.
--
-- After applying, fill it (one cheap Gemini call per recipe, ~$0.0004 each):
--   npx tsx scripts/meal-prep/backfill-swaps.ts            # dry run: counts and cost estimate
--   npx tsx scripts/meal-prep/backfill-swaps.ts --write    # fills missing / stale rows

CREATE TABLE IF NOT EXISTS meal_prep_recipe_swaps (
  recipe_id          varchar PRIMARY KEY REFERENCES recipes(id) ON DELETE CASCADE,
  -- the recipe version the proposals were made for; a newer recipe is asked again
  recipe_updated_at  timestamp NOT NULL,
  -- FOOD_DATA_VERSION the swaps were computed with; on a newer version the
  -- swaps are recomputed from the stored proposals in code (no AI call)
  version            varchar(40) NOT NULL,
  swaps              jsonb NOT NULL DEFAULT '[]'::jsonb,   -- IngredientSwap[]
  proposals          jsonb NOT NULL DEFAULT '[]'::jsonb,   -- the model's SwapProposal[] (no numbers)
  model              varchar(60),
  cost_micros        integer,
  created_at         timestamp NOT NULL DEFAULT now()
);
