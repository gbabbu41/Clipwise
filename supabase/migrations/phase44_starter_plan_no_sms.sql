-- phase44_starter_plan_no_sms.sql
-- The free Starter plan no longer includes SMS or analytics (both moved to paid).
-- phase9 seeded Starter's marketing highlights with "SMS reminders" + "Basic
-- analytics", and the plans table drives the live pricing/plan cards + the
-- post-signup banner — so those still advertised SMS on Starter. Correct them to
-- match what Starter actually is: booking + basic customer EMAILS only.
--
-- `features` (the gated capability flags) is already empty for Starter, so only
-- the display `highlights` need fixing. Safe/idempotent to re-run.

update public.plans
set highlights = '{"1 barber","Online booking page","Appointment management","Email confirmations & reminders"}'
where id = 'starter';
