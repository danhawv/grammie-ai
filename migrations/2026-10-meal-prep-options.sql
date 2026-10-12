-- Meal prep, round 2: the plans offered side by side ("Most protein",
-- "Most variety", "Least cooking") are kept on the plan row, with the
-- shopping list and session of any option already picked, so switching
-- back is instant (shared/meal-prep/api.ts StoredPlanOptions).
-- Additive only: one nullable column. Safe on a live database, safe to run
-- twice. Apply BEFORE deploying the code that reads it: the plan queries
-- select every column of prep_plans.

ALTER TABLE prep_plans ADD COLUMN IF NOT EXISTS options jsonb;
