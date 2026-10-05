-- Review step and kept source for AI recipe imports (docs/DESIGN_PRINCIPLES.md §6).
-- Matches shared/schema.ts `recipeImports`. Additive only: no existing table or
-- column changes, safe to run on a live database, safe to run twice.
--
-- Until this runs, the app keeps working: imports save as before, the review
-- screen still works, and "Needs a look" is tracked only in the browser session.

CREATE TABLE IF NOT EXISTS recipe_imports (
  recipe_id            varchar PRIMARY KEY REFERENCES recipes(id) ON DELETE CASCADE,
  owner_user_id        varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_type          text NOT NULL,                          -- 'photo' | 'link' | 'social' | 'text' | 'creator'
  extra_page_images    jsonb,                                  -- pages 2..n of a multi-page photo (page 1 = recipes.handwritten_image)
  source_url           text,
  source_text          text,
  review_status        text NOT NULL DEFAULT 'needs_review',   -- 'needs_review' | 'reviewed' | 'dismissed'
  amounts_confirmed_at timestamp,
  reviewed_at          timestamp,
  created_at           timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS recipe_imports_owner_status_idx
  ON recipe_imports (owner_user_id, review_status);
