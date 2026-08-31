-- phase55 — shops.trial_ended_at (preserve WHEN a trial ended)
-- APPLIED to prod 2026-08-31 via MCP. Recorded here for the repo / other machine.
--
-- trial_ends_at is nulled on trial-end because a SET value means "currently
-- trialing" across the billing UI (billing/trial-banner/settings). That erases the
-- record of when the trial ran, so past paid-feature usage looks like a free-plan
-- leak in a retrospective audit. trial_used already records THAT a shop trialed;
-- this records WHEN it ended. Nullable, additive, never read for entitlement.
-- Set at the two trial-end points: process-trials (natural expiry) and
-- cancel-subscription (early cancel of a running trial).

ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS trial_ended_at timestamptz;
COMMENT ON COLUMN public.shops.trial_ended_at IS
  'When the shop''s free trial ended (expired or cancelled early). Permanent history — unlike trial_ends_at, which is nulled on trial-end. Not used for entitlement.';
