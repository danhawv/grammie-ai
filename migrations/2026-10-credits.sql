-- Pay-as-you-go credits (server/lib/credits.ts, shared/credits.ts).
--   credit_ledger       every change to a balance: purchases, the welcome and
--                       monthly free credits, spends, refunds, adjustments
--   credit_balances     the running balance, written in the same transaction
--                       as the ledger row; also the account's App Store token
--   apple_transactions  App Store purchases whose signed (JWS) transaction we
--                       verified
-- Additive only: new tables, no changes to existing ones. Safe to run on a
-- live database, safe to run twice. Until it's applied credits stay off:
-- nothing is recorded or charged and every AI action works as before.

CREATE TABLE IF NOT EXISTS credit_balances (
  user_id                   varchar PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  balance                   integer NOT NULL DEFAULT 0,
  -- 'YYYY-MM' of the last monthly free grant
  monthly_free_granted_for  varchar(7),
  -- appAccountToken for App Store purchases (StoreKit 2), made on first ask
  apple_account_token       uuid UNIQUE,
  created_at                timestamp NOT NULL DEFAULT now(),
  updated_at                timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS credit_ledger (
  id           varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  delta        integer NOT NULL,
  kind         varchar(20) NOT NULL,   -- purchase | welcome | monthly_free | spend | refund | adjust
  source       varchar(20) NOT NULL,   -- stripe | apple | google | system
  external_id  text,                   -- payment intent, App Store transaction, 'welcome:<user>', ...
  job_ref      text,                   -- what a spend paid for ('recipe:<id>:import')
  meta         jsonb,
  created_at   timestamp NOT NULL DEFAULT now()
);

-- A payment (or a free grant) is credited at most once
CREATE UNIQUE INDEX IF NOT EXISTS credit_ledger_external_idx ON credit_ledger (source, external_id)
  WHERE external_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS credit_ledger_user_idx ON credit_ledger (user_id, created_at);
CREATE INDEX IF NOT EXISTS credit_ledger_job_idx ON credit_ledger (job_ref) WHERE job_ref IS NOT NULL;

CREATE TABLE IF NOT EXISTS apple_transactions (
  transaction_id           varchar(64) PRIMARY KEY,
  original_transaction_id  varchar(64),
  user_id                  varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_id               varchar(200) NOT NULL,
  environment              varchar(20) NOT NULL,
  app_account_token        uuid,
  quantity                 integer NOT NULL DEFAULT 1,
  credits                  integer NOT NULL,
  purchase_date            timestamp,
  revocation_date          timestamp,
  -- the verified, decoded transaction
  payload                  jsonb NOT NULL,
  created_at               timestamp NOT NULL DEFAULT now(),
  updated_at               timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS apple_transactions_user_idx ON apple_transactions (user_id, created_at);
