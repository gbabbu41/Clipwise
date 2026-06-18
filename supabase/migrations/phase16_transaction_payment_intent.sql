-- phase16: store Stripe's PaymentIntent id on each card transaction so the
-- Payments page can cross-check the EXACT net (after Stripe's fee) and the
-- payout balance live from Stripe. Cash rows leave this null.
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS payment_intent_id text;

-- Optional: speed up the pi -> row lookup when reconciling against Stripe.
CREATE INDEX IF NOT EXISTS idx_transactions_payment_intent_id
  ON transactions (payment_intent_id);
