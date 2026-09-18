# Lifecycle email HTTP boundary — September 18, 2026

## Reproduced gap and bounded change

The actual generic handler accepted anonymous `new_shop_application` requests with caller-supplied content (HTTP 200). `shop_welcome`, `shop_submitted_confirmation` and `weekly_schedule` likewise had no generic authentication gate; trial notices only required a broad staff role/shared secret, not the referenced shop. This is mocked/source evidence, not a claim of live exploitation.

All six now use the existing SERVER_ONLY_EMAIL_TYPES rejection. Anonymous, staff and shared-secret HTTP attempts return 403 before recipient reads or delivery. No new endpoint, dependency, schema, trial policy, scheduling or template change.

## Legitimate callers preserved

- `src/app/api/shops/create/route.ts`: authenticated authoritative shop creation calls the internal engine for `shop_welcome` or `shop_submitted_confirmation`, plus `new_shop_application`. Existing saved creation/approval/plan decisions and best-effort delivery remain unchanged.
- `src/lib/process-trials.ts`: internal `trial_reminder` and `trial_ended`, selected trial shops and guarded expiry transition. Existing 7/3/1-day thresholds, recipients and transition counters unchanged; counters are not delivery receipts.
- `src/app/api/cron/reminders/route.ts`: internal `weekly_schedule`, existing cron authorization and schedule eligibility unchanged. This batch does not correct unrelated cron success counters.

Repo-wide type search found no other callers for these six. Admin shop approval/rejection, public booking confirmations and staff/manual nudges are intentionally NOT blocked by this batch.

## Evidence

- Extended `scripts/tests/birthday-email-check.cjs` first failed on HTTP 200 versus expected 403, then passed across all six types, anonymous/staff and with/without shared secret; asserts zero sends and zero database reads for rejected requests.
- Caller-wiring assertions ensure legitimate lifecycle paths still call the internal engine. Existing actual trial lifecycle regression passes; no claim of new end-to-end signup/cron delivery testing.
- Full `npm run test:flows`, targeted emailer lint, whitespace checks and real production build passed (202 pages, dummy credentials; expected dummy-backend plans fetch warning). Initial sandbox worker-spawn restriction was resolved by the approved build execution outside the sandbox.
- No live email, production-data writes or browser smoke testing. Provider acceptance, mailbox delivery and concurrent-send deduplication are separate concerns.
