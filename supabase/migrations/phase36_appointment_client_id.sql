-- Phase 36 — permanent client link on appointments.
-- Gives every appointment a hard link to a client row (a "membership number"),
-- so a customer's visits/history are found by ID instead of matching text. New
-- bookings stamp this automatically; this backfills the existing ones by email
-- then phone. Name-only walk-ins stay unlinked (nothing unique to match on) and
-- keep working via the email/phone matching in the app.

-- 1. The column + an index for fast per-client lookups.
ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS client_id uuid REFERENCES clients(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_appointments_client_id ON appointments(client_id);

-- 2. Backfill existing appointments — match by email (case-insensitive) first.
UPDATE appointments a
SET client_id = c.id
FROM clients c
WHERE a.client_id IS NULL
  AND a.shop_id = c.shop_id
  AND a.client_email IS NOT NULL AND btrim(a.client_email) <> ''
  AND c.email IS NOT NULL AND btrim(c.email) <> ''
  AND lower(btrim(a.client_email)) = lower(btrim(c.email));

-- 3. Then by phone (digits only), for anyone not matched by email.
UPDATE appointments a
SET client_id = c.id
FROM clients c
WHERE a.client_id IS NULL
  AND a.shop_id = c.shop_id
  AND a.client_phone IS NOT NULL AND a.client_phone <> ''
  AND c.phone IS NOT NULL AND c.phone <> ''
  AND regexp_replace(a.client_phone, '\D', '', 'g') = regexp_replace(c.phone, '\D', '', 'g')
  AND length(regexp_replace(a.client_phone, '\D', '', 'g')) >= 7;
