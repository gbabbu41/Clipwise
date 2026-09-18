# Refund email boundary

The remaining Stripe webhook refund notice now uses the existing internal sender. Generic HTTP refund_issued requests are rejected, including staff/shared-secret callers, so submitted text cannot fabricate a refund notice. Repository secure-engineer guidance required checking every legitimate caller before closing this boundary: both refund routes and customer booking cancellation already use the internal sender.

No refund decisions, Stripe amounts, Connect account/idempotency keys, database queries, notification eligibility or ledger behavior change. Email failures still preserve the webhook acknowledgement. This does not guarantee delivery or deduplicate webhook notifications; monetary reconciliation remains separately scoped. No historical abuse is claimed.

Actual-handler mock tests cover signed webhook processing, failed/missing signatures, successful/failed duplicate-card refunds, cash review, missing account/contact, canonical payload, awaited delivery and email failures. Generic HTTP tests reject refund notices. No live transactions, emails or production mutations; browser smoke testing remains deferred.

Verification: full flow suite, targeted lint, whitespace checks and final production build passed (202 pages, dummy credentials; expected dummy-backend plans warning). One existing unused destructured field in the touched webhook was marked intentionally unused without changing behavior.
