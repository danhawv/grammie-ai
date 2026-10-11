-- Meal prep planner: saved setup defaults, plans, cook share links, task
-- progress and after-the-week check-ins (server/meal-prep/store.ts).
-- Additive only: new tables, no changes to existing ones. Safe to run on a
-- live database, safe to run twice. Until it's applied the meal-prep
-- routes answer with an error and nothing else in the app changes.
--
-- prep_plans.status:       draft -> approved -> done   (or cancelled)
-- prep_plans.build_status: building -> ready           (or failed)

-- One row per owner: the walkthrough's answers, reused as next week's defaults
CREATE TABLE IF NOT EXISTS prep_profiles (
  owner_user_id      varchar PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  defaults           jsonb NOT NULL DEFAULT '{}'::jsonb,
  walkthrough_done   boolean NOT NULL DEFAULT false,
  created_at         timestamp NOT NULL DEFAULT now(),
  updated_at         timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS prep_plans (
  id                    varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id         varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status                varchar(20) NOT NULL DEFAULT 'draft',
  build_status          varchar(20) NOT NULL DEFAULT 'building',
  build_error           text,
  setup                 jsonb NOT NULL,
  plan                  jsonb,
  shopping              jsonb,
  session               jsonb,
  explanation           text,
  -- true when the explanation was written by the model ("Suggested by Grammie")
  explanation_ai        boolean NOT NULL DEFAULT false,
  -- what the wishes became (recipe bonuses/exclusions), so a re-plan reuses them
  wishes_result         jsonb,
  -- recipe id -> title for every recipe the plan or its swap options mention
  recipe_titles         jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- last swap options offered, so choosing one doesn't re-solve
  swap_options          jsonb,
  -- swaps the cook made during the session
  substitutions         jsonb NOT NULL DEFAULT '[]'::jsonb,
  session_date          date,
  calendar_meal_plan_id varchar REFERENCES meal_plans(id) ON DELETE SET NULL,
  grocery_list_id       varchar REFERENCES grocery_lists(id) ON DELETE SET NULL,
  created_at            timestamp NOT NULL DEFAULT now(),
  updated_at            timestamp NOT NULL DEFAULT now(),
  approved_at           timestamp
);

CREATE INDEX IF NOT EXISTS prep_plans_owner_idx ON prep_plans (owner_user_id, created_at DESC);

-- Cook links. Only a SHA-256 of the token is stored; the link itself is
-- shown once, when it's made.
CREATE TABLE IF NOT EXISTS prep_plan_shares (
  id            varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id       varchar NOT NULL REFERENCES prep_plans(id) ON DELETE CASCADE,
  token_hash    varchar(64) NOT NULL,
  role          varchar(20) NOT NULL DEFAULT 'cook',
  label         varchar(100),
  expires_at    timestamp NOT NULL,
  revoked_at    timestamp,
  created_at    timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS prep_plan_shares_token_idx ON prep_plan_shares (token_hash);
CREATE INDEX IF NOT EXISTS prep_plan_shares_plan_idx ON prep_plan_shares (plan_id);

CREATE TABLE IF NOT EXISTS prep_task_progress (
  plan_id   varchar NOT NULL REFERENCES prep_plans(id) ON DELETE CASCADE,
  task_id   varchar(100) NOT NULL,
  done_at   timestamp NOT NULL DEFAULT now(),
  -- 'owner' or 'cook'
  done_by   varchar(20) NOT NULL,
  PRIMARY KEY (plan_id, task_id)
);

CREATE TABLE IF NOT EXISTS prep_checkins (
  id          varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id     varchar NOT NULL REFERENCES prep_plans(id) ON DELETE CASCADE,
  person_id   varchar(100) NOT NULL,
  day         integer NOT NULL,
  slot        varchar(20) NOT NULL,
  -- ate | too_much | too_little | skipped | threw_out
  outcome     varchar(20) NOT NULL,
  note        text,
  created_at  timestamp NOT NULL DEFAULT now(),
  updated_at  timestamp NOT NULL DEFAULT now()
);

-- One answer per plate; answering again replaces it
CREATE UNIQUE INDEX IF NOT EXISTS prep_checkins_plate_idx ON prep_checkins (plan_id, person_id, day, slot);
