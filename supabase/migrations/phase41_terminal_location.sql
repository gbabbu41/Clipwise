-- phase41_terminal_location.sql
-- Card-present / Tap to Pay groundwork (WisePad 3 + Tap to Pay on iPhone).
--
-- Caches each shop's Stripe Terminal *Location* id (created on that shop's
-- connected account) so a reader / Tap to Pay reuses one Location instead of
-- creating a new one on every connect. Nullable + additive → safe to run any
-- time; nothing breaks before it runs (the code just skips the cache and
-- re-resolves the Location by name each time).
--
-- No RLS change: `shops` already has its policies, and the Terminal routes
-- read/write this column with the service role (bypassing RLS) after their own
-- owner/barber auth check.

alter table shops add column if not exists stripe_terminal_location_id text;
