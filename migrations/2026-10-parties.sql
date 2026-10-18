-- Dinner parties and potlucks (server/parties/store.ts, shared/party.ts):
-- parties, their course slots, guests and the dishes guests bring, plus a
-- flag for "guest users" (anonymous party guests the server makes a users
-- row for, so imports and credits work as for anyone else).
-- Additive only: one new column with a default, new tables. Safe to run on a
-- live database, safe to run twice. Until it's applied the party routes
-- answer with an error and nothing else in the app changes.
--
-- parties.status:      active | cancelled
-- party_guests.rsvp:   yes | maybe | no

ALTER TABLE users ADD COLUMN IF NOT EXISTS is_guest boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS parties (
  id                   varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id        varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title                text NOT NULL,
  -- 'dinner' (recipes scale to the headcount) or 'potluck' (as written)
  style                varchar(20) NOT NULL DEFAULT 'dinner',
  starts_at            timestamptz,
  location             text,
  theme                text,
  host_note            text,
  headcount            integer NOT NULL DEFAULT 8,
  -- the host's Partiful / Evite / Luma page for the same party
  external_invite_url  text,
  cover_image          text,
  -- the party cookbook (owned by the host); kept if the cookbook is deleted
  cookbook_id          integer REFERENCES cookbooks(id) ON DELETE SET NULL,
  -- the invite link's token, stored as is so the host can always see the
  -- link (like cookbook_invitations.token); rotating it ends the old link
  invite_token         varchar(64) NOT NULL,
  status               varchar(20) NOT NULL DEFAULT 'active',
  created_at           timestamp NOT NULL DEFAULT now(),
  updated_at           timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS parties_invite_token_idx ON parties (invite_token);
CREATE INDEX IF NOT EXISTS parties_owner_idx ON parties (owner_user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS party_slots (
  id         varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  party_id   varchar NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
  course     varchar(20) NOT NULL,
  label      text,
  position   integer NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS party_slots_party_idx ON party_slots (party_id, position);

CREATE TABLE IF NOT EXISTS party_guests (
  id                varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  party_id          varchar NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
  -- a real account or a guest user (users.is_guest)
  user_id           varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name              text NOT NULL,
  rsvp              varchar(10) NOT NULL DEFAULT 'yes',
  party_size        integer NOT NULL DEFAULT 1,
  allergies         jsonb NOT NULL DEFAULT '[]'::jsonb,
  diets             jsonb NOT NULL DEFAULT '[]'::jsonb,
  diet_note         text,
  is_host           boolean NOT NULL DEFAULT false,
  -- SHA-256 of an anonymous guest's token (X-Party-Guest); the token itself
  -- is shown once, when they join
  guest_token_hash  varchar(64),
  created_at        timestamp NOT NULL DEFAULT now(),
  updated_at        timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS party_guests_party_user_idx ON party_guests (party_id, user_id);
CREATE UNIQUE INDEX IF NOT EXISTS party_guests_token_idx ON party_guests (guest_token_hash);
CREATE INDEX IF NOT EXISTS party_guests_user_idx ON party_guests (user_id);

CREATE TABLE IF NOT EXISTS party_dishes (
  id          varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  party_id    varchar NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
  guest_id    varchar NOT NULL REFERENCES party_guests(id) ON DELETE CASCADE,
  slot_id     varchar REFERENCES party_slots(id) ON DELETE SET NULL,
  course      varchar(20) NOT NULL,
  recipe_id   varchar REFERENCES recipes(id) ON DELETE SET NULL,
  title       text NOT NULL,
  note        text,
  created_at  timestamp NOT NULL DEFAULT now(),
  updated_at  timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS party_dishes_party_idx ON party_dishes (party_id, created_at);
CREATE INDEX IF NOT EXISTS party_dishes_guest_idx ON party_dishes (guest_id);
CREATE INDEX IF NOT EXISTS party_dishes_recipe_idx ON party_dishes (recipe_id);
