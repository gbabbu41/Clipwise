-- Let the owner dismiss a stale UNPAID appointment from the Checkout view without
-- cancelling it. Dismissing just hides the row from the till (e.g. an old in-person
-- booking that was never collected); the appointment itself is untouched and still
-- lives on the calendar/appointments. Stored on the row (not per-device) so a
-- dismissal from one machine hides it on the owner's other machine too.
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS checkout_dismissed_at timestamptz;
