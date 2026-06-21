-- 048_order_aggregates.sql
-- Dimensional aggregates from the real orders export (Desktop/ALL DATA/orders ...).
-- Raw orders are NOT stored — only per-dimension bucket counts for a labelled
-- period. Serves order-mix, returns/refunds and country/tier analytics, and is
-- the orders side of a future CPO (contacts-per-order) ratio.
-- NOTE: the source OrderDate column is corrupted (DD/MM parsed as MM/DD), so a
-- reliable daily series is NOT derivable from this export — only window totals.

CREATE TABLE IF NOT EXISTS order_aggregates (
  tenant_id     UUID NOT NULL,
  period_label  TEXT NOT NULL,             -- e.g. '2026-06 (1-14)'
  dimension     TEXT NOT NULL,             -- '_total' | 'status' | 'type' | 'category' | 'return' | 'country' | 'customer_type' | 'payment'
  bucket        TEXT NOT NULL,             -- the value, '_all' for _total
  count         INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, period_label, dimension, bucket)
);
CREATE INDEX IF NOT EXISTS idx_order_agg_dim ON order_aggregates (tenant_id, dimension);
