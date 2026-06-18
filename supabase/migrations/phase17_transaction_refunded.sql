-- phase17: let a refund (done in-app OR straight in the Stripe dashboard) sync
-- back to the transactions ledger. The charge.refunded webhook flips this so the
-- Payments row greys out + drops from Collected, staying in step with Stripe.
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS refunded boolean NOT NULL DEFAULT false;
