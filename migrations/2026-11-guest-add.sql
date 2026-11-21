-- Add recipes without an account (shared/guest.ts, server/guests/): a
-- device's guest token, tied to a guest user (users.is_guest, the same kind
-- of user anonymous party guests get, from migrations/2026-10-parties.sql).
-- Only the token's SHA-256 is stored.
-- Additive only: one new table. Safe to run on a live database, safe to run
-- twice. Until it's applied, adding without an account answers "sign in to
-- add recipes" and nothing else in the app changes.

CREATE TABLE IF NOT EXISTS guest_sessions (
  token_hash  varchar(64) PRIMARY KEY,
  user_id     varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- salted SHA-256 of the address it was started from (daily cap per address)
  ip_hash     varchar(64),
  created_at  timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS guest_sessions_user_idx ON guest_sessions (user_id);
CREATE INDEX IF NOT EXISTS guest_sessions_ip_idx ON guest_sessions (ip_hash, created_at);
