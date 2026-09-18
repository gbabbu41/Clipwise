# Notification/payment-result reliability — September 18, 2026

## Lane and coordination

This task owns bounded server notification/payment-result reliability. Software developer owns onboarding/setup UI. Shared test-runner changes and build/commit windows are coordinated; no concurrent edits are overwritten. Existing booking/Stripe/auth/schema architecture and monetary rules are preserved. No production-data mutations or real messages/transactions are used for tests.

## Implemented and verified

- `d8f9ed8`: `src/app/api/stripe/refund/route.ts` and `refund-payment/route.ts` await internal refund email attempts. Focused actual-handler tests, full flows, lint and production build passed. Pushed and GitHub main SHA verified.
- `aaae222`: `src/app/api/webhooks/stripe/route.ts` migrates its refund notice to internal delivery; `src/lib/emailer.ts` makes refund_issued server-only at generic HTTP. `scripts/tests/webhook-refund-email-check.cjs` covers actual handler signatures, refund success/failure/contact/account gates, Connect/idempotency, delivery awaiting/failure isolation. Generic endpoint regression extended. Full flows/lint/build passed; pushed and remote verified.
- `0a69b80`: `src/lib/payment-notify.ts` no longer sends customer receipt data through its supplied baseUrl; `src/lib/emailer.ts` closes generic HTTP payment_receipt. `scripts/tests/payment-receipt-boundary-check.cjs` verifies preserved content/itemization and internal delivery. Full flows, targeted lint and production build passed; pushed and GitHub main SHA verified. See PAYMENT-RECEIPT-BOUNDARY-2026-09-18.md.

## Deployment versus live verification

Pushed means code is on GitHub main; the repository normally auto-deploys. Deployment completion/health has NOT been verified. Builds use dummy credentials. Browser smoke tests, customer transactions and live delivery are NOT verified. Awaited email attempts are not guaranteed delivery or persistent retries.

`a8e9d35`: all three owner_payment_received callers now use awaited internal delivery and the generic HTTP gate rejects fabricated owner notices. Actual-handler/helper regressions, full combined flows, lint and production build passed; pushed and GitHub main SHA verified. See OWNER-PAYMENT-EMAIL-2026-09-18.md. No query/filter/payment-decision changes.

## Remaining launch-critical gaps in this lane

1. Owner payment notices: resolved by a8e9d35 above; not an outstanding redesign item. Email persistence/retry remains outside these transport fixes.
2. Booking confirmation: public booking-client, staff Appointments and shared calendar approval callers still use generic email HTTP. Migrate canonical saved-appointment context together; do not blanket-block and break public booking. See CLIPWISE-AUDIT-LOOP.md for the deduplicated caller map.
3. Some receipt callers do not await the shared helper; internal transport does not fix their request-lifetime behavior. Separate small caller-lifetime batch with successful-charge response preservation and no payment retries.
   The capture-appointment caller also derives no-show rebooking and tip SMS links from its Origin-first baseUrl. Internal receipt transport prevents the external receipt-data POST, but does not fix those message links. Next source-scoped link fix should use configured app URL/fallback and preserve existing paths; no claim that all Origin uses were removed.
4. Refund/payment persistence errors after money moves need an approved reconciliation design. Merely returning an error can encourage another financial operation. Keep separate from email delivery fixes.

## Decisions requiring owner direction, not automatic architecture changes

- Atomic/recoverable loyalty claim + balance + reward updates (L1/L2), promo final-use reservation (PR1), cash gift-card issuance + ledger (P2), and atomic waitlist conversion remain logged in the parent audit. No schema/financial redesign is included here.
- Proposed financial reconciliation review: document current idempotency keys and failure stages first; propose recoverable states/replay rules and any required SQL for approval, without changing refund/commission/tax policies.

Exact scoped reports and the parent CLIPWISE-AUDIT-LOOP.md are authoritative for earlier batches. Do not treat previous source-only findings as live incidents or unverified changes as deployed.
