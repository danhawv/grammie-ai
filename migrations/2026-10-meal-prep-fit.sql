-- "Good for meal prep" flag per recipe (server/meal-prep/food/prep-fit.ts):
-- whether a dish reheats well and keeps 3+ days in the fridge, how many days
-- it keeps, and a one-line note ("keeps 4 days in the fridge · freezes well",
-- "best eaten fresh · fried foods lose their crunch"). NULL = not judged yet.
-- Additive only: three nullable columns and one index. Safe to run on a live
-- database, safe to run twice. Until it's applied, the "Meal prep" filter
-- matches nothing and no badge shows.
--
-- The app fills the columns whenever a recipe finishes enrichment or its
-- ingredients, steps or tips are edited. To judge every existing recipe:
--   npx tsx scripts/meal-prep/backfill-prep-fit.ts            # dry run: counts only
--   npx tsx scripts/meal-prep/backfill-prep-fit.ts --write    # saves the judgement

ALTER TABLE recipes ADD COLUMN IF NOT EXISTS meal_prep_friendly boolean;
ALTER TABLE recipes ADD COLUMN IF NOT EXISTS meal_prep_keeps_days integer;
ALTER TABLE recipes ADD COLUMN IF NOT EXISTS meal_prep_note text;

-- The filter is "friendly = true"; a partial index keeps it small
CREATE INDEX IF NOT EXISTS recipes_meal_prep_friendly_idx ON recipes (meal_prep_friendly) WHERE meal_prep_friendly = true;
