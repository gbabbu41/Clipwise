# Customer booking save reliability — approved batch 1

Scope: audit findings 1 and 5 only. No calendar, schema, pricing, refund entitlement, availability algorithm, or architecture changes.

## Changes

- Cancellation and rescheduling now check both database errors and the returned saved row before refunds, emails, SMS, waitlist alerts, or success responses.
- Updates match the previously read status/date/time. If these changed concurrently, the customer is asked to refresh instead of overwriting that state.
- Rescheduling uses the existing double-booking error classifier to return a recoverable conflict message when the database rejects an occupied slot.
- Successful rescheduling returns persisted date/time/status. The customer screen uses that status instead of always showing Pending Confirmation.

## Verification

- New `scripts/tests/manage-booking-check.cjs` executes the actual API route and extracted actual customer action handlers with simulated database/payment/messaging services.
- Covers rejected updates, no returned row, overlap rejection, successful confirmed/pending moves, refunds, held-card release, no-card cancellation, unchanged-date/time no-op, cancellation notice, terminal states, past times, conflict/time-off checks, rate limiting, and UI failure-state preservation.
- Added to `npm run test:flows`; full suite passed. Expanded cancellation UI checks also passed independently.
- Targeted lint passed without warnings or errors.
- Real production build passed, including TypeScript and all 202 static pages. It used dummy CI credentials; the plans fetch logged a failure against that dummy backend, so this does not verify live plan loading.
- No live customer actions, payments, messages or database writes performed. Simulated tests are not a replacement for the later sandbox smoke test.

The repository security skill and Supabase skill guided the explicit save-result checks and restricted response fields. The [Supabase update reference](https://supabase.com/docs/reference/javascript/update) documents requesting returned updated rows with `select()`. The changelog Markdown endpoint was unavailable to the browsing tool; no SDK version or schema changes were made.

Remaining audit findings are not fixed by this batch. In particular, waitlist caller permissions, picker availability accuracy, notification retry/delivery tracking, and onboarding resume/atomic saves remain separate approval batches.
