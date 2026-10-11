-- Bulk intake: bringing in a whole box of recipe cards at once
-- (shared/schema.ts `bulkIntakes`, `bulkIntakePhotos`; docs/BULK_IMPORT.md).
-- Additive only: two new tables, no changes to existing ones. Safe to run on
-- a live database, safe to run twice.
--
-- Until this runs, the "Bring in a whole box" page says it isn't available
-- yet and every other import works exactly as before.

CREATE TABLE IF NOT EXISTS bulk_intakes (
  id                   varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id        varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status               varchar(20) NOT NULL DEFAULT 'uploading',  -- 'uploading' | 'pairing' | 'review' | 'importing' | 'done' | 'cancelled'
  source               varchar(20) NOT NULL DEFAULT 'device',     -- 'device' | 'drive_picker' | 'drive_link'
  expected_photos      integer,
  uploads_done_at      timestamp,
  cookbook_id          integer REFERENCES cookbooks(id) ON DELETE SET NULL,
  spent_micros         bigint NOT NULL DEFAULT 0,
  import_requested_at  timestamp,
  import_finished_at   timestamp,
  problem              text,
  created_at           timestamp NOT NULL DEFAULT now(),
  updated_at           timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS bulk_intakes_owner_idx ON bulk_intakes (owner_user_id, created_at);
CREATE INDEX IF NOT EXISTS bulk_intakes_status_idx ON bulk_intakes (status);

CREATE TABLE IF NOT EXISTS bulk_intake_photos (
  id                   varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  intake_id            varchar NOT NULL REFERENCES bulk_intakes(id) ON DELETE CASCADE,
  owner_user_id        varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_key           varchar(80) NOT NULL,
  source_hash          varchar(80) NOT NULL,
  file_name            text,
  seq                  integer NOT NULL DEFAULT 0,
  taken_at             timestamp,
  image                bytea,                                     -- cleared once imported
  thumb                bytea,
  status               varchar(20) NOT NULL DEFAULT 'uploaded',   -- 'uploaded' | 'checking' | 'checked' | 'failed'
  attempts             integer NOT NULL DEFAULT 0,
  claimed_at           timestamp,
  catalog              jsonb,
  cost_micros          integer NOT NULL DEFAULT 0,
  problem              text,
  paired_to            varchar,                                   -- this photo is the back of that photo
  pair_source          varchar(20),                               -- 'ai' | 'sequence' | 'person'
  pair_locked          boolean NOT NULL DEFAULT false,
  include_override     boolean,
  recipe_id            varchar REFERENCES recipes(id) ON DELETE SET NULL,
  imported_at          timestamp,
  created_at           timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS bulk_intake_photos_client_key_idx ON bulk_intake_photos (intake_id, client_key);
CREATE INDEX IF NOT EXISTS bulk_intake_photos_intake_idx ON bulk_intake_photos (intake_id, seq);
CREATE INDEX IF NOT EXISTS bulk_intake_photos_status_idx ON bulk_intake_photos (status);
CREATE INDEX IF NOT EXISTS bulk_intake_photos_hash_idx ON bulk_intake_photos (owner_user_id, source_hash);
CREATE INDEX IF NOT EXISTS bulk_intake_photos_recipe_idx ON bulk_intake_photos (recipe_id);
