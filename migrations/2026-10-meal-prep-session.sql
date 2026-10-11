-- Meal prep session builder (server/meal-prep/session/step-store.ts): each
-- recipe's steps broken into kitchen tasks (hands-on vs waiting time, oven
-- and burner use, what depends on what), worked out once by AI and checked
-- in code. A sidecar to recipes: the recipe row is never changed.
-- Keyed by the recipe's updated_at, so editing a recipe means it's redone;
-- version bumps when the task shape changes (STEPS_VERSION).
-- Additive only: a new table, no changes to existing ones. Safe to run on a
-- live database, safe to run twice. Until it's applied the builder keeps
-- structured steps in memory only.

CREATE TABLE IF NOT EXISTS recipe_prep_steps (
  recipe_id          varchar NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  recipe_updated_at  varchar(40) NOT NULL,   -- recipes.updated_at as an ISO string (an exact cache key)
  version            integer NOT NULL,
  source             varchar(20) NOT NULL,   -- 'ai' (heuristic results aren't stored)
  model              varchar(100),
  data               jsonb NOT NULL,         -- RecipeSteps (types.ts)
  cost_micros        integer NOT NULL DEFAULT 0,
  created_at         timestamp NOT NULL DEFAULT now(),
  PRIMARY KEY (recipe_id, recipe_updated_at, version)
);
