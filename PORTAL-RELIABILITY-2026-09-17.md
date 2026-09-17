# Portal reliability pass — 2026-09-17

User approved fixing the portal audit findings, continuing through related workflow inconsistencies, and directly applying the schedule SQL through connected Supabase. This is an additive reliability pass, not a business-model or visual-theme rebuild.

## Implemented

- Schedule APIs keep barber identity server-controlled; validate date/time inputs and consistently require active membership and the applicable staff permissions. Owner overrides are preserved.
- Weekly hours and breaks save atomically. Removing a day from approved time off now splits/trims atomically, with ownership/status rechecked under a database lock.
- Schedule editor handles failed loads/saves, stale responses, duplicate save clicks and timeouts; failed quick actions retain previously saved hours. Manual failed drafts remain explicitly unsaved.
- Schedule/time-off emails use the internal email engine. These privileged email types are no longer accepted through the untrusted public email endpoint.
- POS collected amounts include separately stored tax once. Shared owner reporting and Payments now use the same transaction collection helper. No prices, tax rates, customer charges, tips or commissions were changed.
- Owner Dashboard loads staff financial metadata together with the report, includes gift-card redemption amounts, retains inactive staff for historical rate lookup, and suppresses stale shop/period figures.
- Financial read failures no longer become successful zero reports. Paginated reads prevent silent row-limit truncation and reject partial results if a later page fails. The safety ceiling is explicit (100,000 rows), not a truncated total.
- Missing processing-fee details are labelled unknown. Gross receipts remain visible where available; unknown net amounts are not presented as confirmed.
- Reporting weeks start Monday across owner and barber financial screens; current periods run through today. Analytics timestamps and labels use consistent browser-local calendar boundaries, including DST tests.
- Revenue trend uses the settled, deduplicated collection calculator; zero days are present. Owner tips are included in Tips Collected while staff tip deductions remain separate. Service breakdown includes Other rather than silently excluding lower-ranked services.
- Earnings month buckets retain the year, cover the full selected period and no longer invent positive bars for zero/no data. Chart data tables, clearer labels and larger carousel controls improve usability without changing the theme.
- Inventory validates inputs, confirms affected rows, checks failed updates/deletions, and uses compare-and-set for quantity changes to reject concurrent overwrites.

## The $100 example

The regression fixture is a $100 service **plus an illustrative $15 tax**, meaning $115 cash collected. The old reporting code counted $100 collected and then deducted $15 again. Correct collection is $115 and the pre-commission service amount is $100. This is not a change to the shop's configured tax rate and not evidence of an incorrect customer charge. A $100 tax-inclusive total remains $100 collected; a no-tax $100 sale also remains $100 collected.

## Database

Applied to the connected ClipWise project after explicit user approval:

- `supabase/migrations/20260917151400_atomic_barber_schedule.sql`
- `supabase/migrations/20260917152523_atomic_time_off_exclude_date.sql`

Both functions are SECURITY INVOKER, have an empty search path, and grant EXECUTE only to service_role (not anon/authenticated). Installation does not rewrite business rows. Verified grants in the live catalog. Rollback-only checks exercised schedule replacement, unauthorized/invalid input rejection, and all four time-off exclusion cases. No test schedules/time-off rows persisted and no notifications/emails were sent by these checks.

## Verification

`npm run test:flows` passed all 12 suites, including the previous billing/signup/trial suite plus revenue, pagination, analytics, earnings/inventory, schedule API, schedule editor, dashboard chart and Payments UI regressions. TypeScript and the final full Next.js production build passed (202 pages generated). The build used placeholder service credentials, not live money operations.

Browser-control initialization remains broken on this host (kernel assets path failure). Logged-in desktop/mobile visual verification and real-account end-to-end payment tests are **not** claimed. Component/render tests use mocks and synthetic records. Production migration checks are explicitly rollback-only.

## Remaining boundaries / next audit cycle

- Existing multi-location subscription cancellation, delayed webhook ordering and first-shop creation race findings from the prior billing audit are a separate payment/onboarding batch, not fixed by this portal pass.
- Advanced reconciliation still merits dedicated fixtures for partial captures/balance collections across periods, gift-card tender, refunds across periods and historical commission-rate changes. Do not treat this pass as certification of every accounting edge case.
- Reports retain the existing browser-local time-zone convention, now labelled. A deliberate shop-time-zone reporting standard should be applied across every portal together, rather than mixed into only one screen.
- A fully atomic multi-request time-off merge/concurrent edits and global schedule-writer serialization warrant additional database design review. The new weekly replacement and exclusion functions are atomic; this does not mean every existing schedule writer is globally serialized.
- Existing Supabase advisors still include leaked-password protection disabled and older privileged-helper/search-path warnings. No new function from this pass appears in those warnings. RLS-with-no-policy notices on server-only tables are not automatically vulnerabilities.

Do not publish credentials, personal data, or private audit examples in future tests. Preserve owner-chair storage at 0%, owner earnings display at 100%, shop-paid Stripe fees, and native-app subscription restrictions.
