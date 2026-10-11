-- Gemini Batch API lane for bulk imports (server/batch-queue.ts): one row per
-- dish photo or content request waiting on, or answered by, a Gemini batch.
-- Survives restarts and redeploys; the poller picks up where it left off.
-- Additive only: a new table, no changes to existing ones. Safe to run on a
-- live database, safe to run twice. Until it's applied the bulk lane stays
-- off and everything runs in real time as before.
--
-- status: queued -> submitting -> submitted -> applying -> done
--         (or 'fallback': redone in real time after a failed/expired batch)

CREATE TABLE IF NOT EXISTS gemini_batch_requests (
  id            varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  recipe_id     varchar NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  job           varchar(30) NOT NULL,
  model         varchar(100) NOT NULL,
  request       jsonb NOT NULL,
  extra         jsonb,
  status        varchar(20) NOT NULL DEFAULT 'queued',
  batch_name    varchar(200),
  attempts      integer NOT NULL DEFAULT 0,
  error         text,
  created_at    timestamp NOT NULL DEFAULT now(),
  submitted_at  timestamp,
  finished_at   timestamp,
  updated_at    timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS gemini_batch_requests_status_idx ON gemini_batch_requests (status, job, created_at);
CREATE INDEX IF NOT EXISTS gemini_batch_requests_batch_idx ON gemini_batch_requests (batch_name);
CREATE INDEX IF NOT EXISTS gemini_batch_requests_recipe_idx ON gemini_batch_requests (recipe_id);
-- At most one open request per recipe and job
CREATE UNIQUE INDEX IF NOT EXISTS gemini_batch_requests_open_idx ON gemini_batch_requests (recipe_id, job)
  WHERE status IN ('queued', 'submitting', 'submitted', 'applying');
