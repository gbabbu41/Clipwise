-- Track when a review request was sent for an appointment.
--
-- The daily cron now sends a "how was your visit?" review request the MORNING
-- AFTER an appointment that happened — the safety-net that finally covers cash /
-- in-person visits the barber never taps "Complete" on. This column lets the
-- cron (and the immediate Complete-button / online-paid sends) dedup so a
-- customer is never asked for a review twice.
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS review_request_sent_at timestamptz;
