# Receipt request lifetime

Both remaining unawaited sendPaymentReceipt callers now await one attempt: src/app/api/stripe/capture-appointment/route.ts and src/lib/finalize-appointment-payment.ts. Each catches receipt-only rejection locally, so a successful Stripe charge/payment claim is not turned into a failed payment response or failed status because receipt preparation/sending failed.

No charge/claim/ledger decisions, amounts, Connect settings, idempotency keys, existing duplicate guards, notification eligibility or response shapes changed. No automatic retry or additional receipt send was added. Existing cross-request notification deduplication limits remain; this is not an exactly-once delivery guarantee. A provider accepting a send is not proof of inbox delivery, and the payment response does not claim email delivery.

Actual capture-handler regression verifies held receipt promise delays response, one attempt, thrown receipt failure preserves success, no failed status/charge-failure alert, unchanged completion/no-show ledger tax totals and auth/already-captured gates. Finalizer regression verifies waiting plus completion/owner alerts still run after receipt rejection. Shared helper tests cover returned provider errors too. Repository secure-engineer guidance kept email failures separate from authoritative money outcomes.

Verification: focused tests, targeted lint, full combined flow suite, whitespace checks and production build passed (202 pages, dummy credentials; expected dummy-backend plans warning). No live charges/messages or browser testing.
