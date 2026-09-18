# Dedicated-workflow email protection

Source review found four additional templates callable without authentication through `/api/send-email`: signup codes, subscription-card updates, owner weekly digests and Connect reminders. Supplied recipients/content could bypass the dedicated sender workflow. A forged signup email does not create a valid database verification code, but can confuse recipients and bypass the signup sender's captcha/cooldown controls.

All four now use the existing server-only email set, so the generic HTTP endpoint rejects them even with a staff token or internal-secret header. No sender, recipient, schedule, billing, signup verification or plan logic changed. Source call-site review confirms actual sends occur directly through the shared engine in request-code, notify-card-updated and reminder cron handlers.

Regression: the new HTTP assertion failed before the fix (signup_code returned 200); afterward, the real HTTP handler rejects every listed template without invoking database/email mocks. Tests consume the actual source set and check direct caller wiring. Full suite, targeted lint and production build are required before push. No live emails, customer transactions, database changes or manual smoke tests.

Remaining: public booking notifications and staff-role-only templates still need per-caller ownership review; this is not a claim that all email entry points are hardened.
