-- One-time "finish your payment setup" nudge tracking. Most shops that can take
-- online payments (paid/trial plans) sign up but never finish Stripe Connect, so
-- they silently can't collect online payments, deposits, or no-show fees. The
-- daily cron sends a single reminder a couple days after signup if Connect isn't
-- finished; this column dedupes it so it's never sent twice.
ALTER TABLE shops ADD COLUMN IF NOT EXISTS connect_nudge_sent_at timestamptz;
