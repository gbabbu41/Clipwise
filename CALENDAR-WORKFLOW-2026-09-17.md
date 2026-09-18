# Calendar workflow — first reliability batch

## Scope

- Rescheduling waits for a confirmed result before closing the editor. Failed saves and declined time-off overrides retain the draft with an inline explanation. Pending saves disable editing/dismissal and reject duplicate submissions.
- Unchanged service selections use the appointment's booked duration and amount, including multi-service combinations. Explicit service changes still use catalogue totals; the existing server route remains authoritative. The summary distinguishes booked totals from new pre-tax service totals.
- Appointment, barber, blocked-hours and full-day-off reads commit together. A failed read shows a retry state and hides the stale grid instead of suggesting it is available. Older responses cannot replace a newer result/error.
- Global quick-add requests date/barber context from the currently mounted, non-embedded calendar in the same shop. Client-profile rebooking and locked barber assignments keep their existing behavior. The context stays in memory, not browser storage.

No database migrations, pricing, payment, permission, notification or autofocus changes.

## Verification

`scripts/tests/calendar-workflow-check.cjs` uses synthetic fixtures and mocked requests to exercise booked totals, context handoff, missing sessions, network failures, conflicts, declined overrides, successful updates, draft retention, pending/duplicate submission guards, partial-load failures and stale responses. Included in `npm run test:flows`.

Production build uses the same non-secret placeholder environment as `.github/workflows/ci.yml`; it does not prove live service connectivity.

Results: all 19 regression suites passed; TypeScript check passed; final production build completed all 202 pages. The placeholder environment produced the expected unavailable plans-fetch warning. No live customer records were modified during verification.

## Device acceptance

On iPhone PWA, navigate to a future date and different barber, tap the bottom +, and check both fields. Try a multi-service reschedule into a short gap; confirm the full booked duration is shown. With networking disabled, verify a failed save keeps the draft and a failed calendar refresh offers Retry. Restore networking and retry. Actual iPhone acceptance is still required.

## Separate follow-up work

Pagination/large-calendar reads, shop-time live clock, realtime detail synchronization, notification delivery status, full client search and mobile agenda improvements remain outside this first batch. Schedule/break auxiliary reads are not part of the four-read snapshot above.
