-- ============================================================
-- Phase 13: record WHEN an appointment was paid
-- ============================================================
-- The Payments page, Appointments side card and Calendar detail card show
-- "Paid · 10 min ago / yesterday". That needs a timestamp of when the money
-- actually landed (created_at is booking time, not payment time). We set
-- `paid_at` wherever payment_status flips to paid/captured (online checkout,
-- payment links, held/saved card capture, cash, no-show fee, webhook). Idempotent.
-- ============================================================
alter table public.appointments
  add column if not exists paid_at timestamptz;

-- Backfill: best-effort stamp already-paid rows with their booking time so the
-- relative label isn't blank for historical payments. (created_at is the
-- closest signal we have for legacy rows.)
update public.appointments
  set paid_at = created_at
  where paid_at is null
    and payment_status in ('paid', 'captured');
