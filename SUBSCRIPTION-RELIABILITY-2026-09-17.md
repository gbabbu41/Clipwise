# Subscription and automation reliability — 2026-09-17

This batch strengthens existing workflows; it does not change pricing, included locations, the 21-day no-card trial, commissions, or native-app subscription restrictions.

## Fixes

- Immediate paid cancellation updates every owner location still attached to that subscription. Shared trial cancellation follows the inherited trial clock. Concurrent paid replacements are protected by conditional writes.
- Cancellation/resume reject malformed inputs and distinguish database outages from missing subscriptions.
- Subscription webhooks read current Stripe state instead of trusting delayed checkout/status snapshots. They check owner/customer identity and conflicting subscriptions before activation/cleanup. Connected-account subscription events cannot alter platform billing.
- Deletion downgrades all matching locations rather than failing a single-row query. It clears obsolete subscription/trial fields and sends one cancellation notice per returned email address.
- Failed webhook writes/add-on reconciliation return failure for Stripe retry. Subscription emails use direct server delivery; the HTTP email endpoint rejects fabricated subscription notices even from signed-in staff.
- The daily subscription repair job guards writes against a concurrent replacement and counts confirmed affected rows, not attempted updates.
- Added locations inherit the original trial deadline and permanent trial history. An already-expired trial cannot create another location. Add-on consent remains explicit; no new automatic purchases were introduced.
- Settings handles failed/slow add-location requests, locks duplicate clicks, and warns to check the location list before retrying an uncertain result.
- Trial expiry sends its ended notification only after a confirmed update; failed reads/writes are surfaced. Daily cron reports subscription-maintenance failures instead of silently returning success, while independent reminder work can still run.

## Verification and limits

All 17 regression suites passed, including five new mocked-service suites covering cancellation, webhooks, daily reconciliation, added-location/client recovery, and trial/cron lifecycle. The full production build passed with all 202 pages generated, using placeholder service credentials. No real Stripe charges, cancellations, emails, or test business records were created by these tests. No database migration is required for this batch.

Current Stripe webhook guidance was checked: https://docs.stripe.com/webhooks . Supabase update documentation: https://supabase.com/docs/reference/javascript/update . The changelog markdown fetch remained unsupported by the browsing tool.

Browser-control initialization was unavailable in the previous pass; this batch does not claim logged-in live visual or payment end-to-end verification. Background maintenance remains on the existing daily schedule, not real-time.

## Confirmed follow-ups (not fixed here)

1. First-shop creation uses read-then-insert; concurrent calls can create duplicate shops. Needs an owner-locked database transaction, not owner uniqueness (multiple locations are legitimate).
2. Onboarding resumption does not hydrate all saved fields/services/hours, and its delete-then-insert hours path still needs atomic replacement preserving breaks. This is a separate setup-recovery pass.
3. Simultaneous checkout operations are not serialized across Stripe and the database. Current guards protect delayed sequential events, not every distributed race. Duplicate-subscription cleanup remains best-effort.
4. Existing added locations with missing trial history cannot safely be distinguished from intentional admin-granted plans automatically. No blanket production downgrade was performed.
5. Daily maintenance queries still need pagination/scaling review. Reminder delivery is best-effort and does not have a durable exactly-once outbox; rerunning a reminder day can repeat reminders.
6. Advanced financial reconciliation and pre-existing security-advisor warnings remain as recorded in PORTAL-RELIABILITY-2026-09-17.md.
