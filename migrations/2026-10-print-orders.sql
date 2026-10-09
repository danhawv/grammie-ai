-- Printed-book orders (shared/schema.ts `printOrders`): checkout with Stripe,
-- the Lulu print job, refunds and tracking. Additive only: a new table, no
-- changes to existing ones. Safe to run on a live database, safe to run twice.

CREATE TABLE IF NOT EXISTS print_orders (
  id                    varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id         varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  cookbook_id           integer NOT NULL REFERENCES cookbooks(id) ON DELETE CASCADE,
  print_project_id      integer,
  status                varchar(30) NOT NULL DEFAULT 'preparing',
  snapshot              jsonb NOT NULL,
  quantity              integer NOT NULL,
  shipping_level        varchar(30) NOT NULL,
  shipping_address      jsonb NOT NULL,
  contact_email         text NOT NULL,
  page_count            integer,
  lulu_cost_cents       integer,
  price_cents           integer,
  currency              varchar(3) DEFAULT 'USD',
  stripe_session_id     text,
  stripe_payment_intent text,
  checkout_url          text,
  lulu_order_id         varchar(100),
  lulu_status           varchar(50),
  problem               text,
  tracking              jsonb,
  arrival               jsonb,
  refunded_at           timestamp,
  created_at            timestamp NOT NULL DEFAULT now(),
  updated_at            timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS print_orders_owner_idx ON print_orders (owner_user_id, created_at);
CREATE INDEX IF NOT EXISTS print_orders_cookbook_idx ON print_orders (cookbook_id);
CREATE INDEX IF NOT EXISTS print_orders_lulu_idx ON print_orders (lulu_order_id);
CREATE INDEX IF NOT EXISTS print_orders_stripe_idx ON print_orders (stripe_session_id);
