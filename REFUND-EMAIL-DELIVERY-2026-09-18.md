# Refund notification delivery

## Bounded fix

The appointment branches in stripe/refund and stripe/refund-payment started an HTTP email request without awaiting it. Serverless completion could end the notification attempt before it finished. Both now await the existing in-process email sender, with thrown email failures caught so a completed refund is not reported as failed or retried because email failed.

The same saved recipient, shop branding, service, date and actual refunded amount are passed to the same template. No changes to Stripe calls/idempotency keys, refund eligibility, amounts, tax/tip allocation, database writes, ledger, served appointment status, waitlist rules or response shape. Hold releases still omit monetary-refund emails. Standalone transaction refund behavior is untouched. No schema or dependency changes.

## Verification

Actual-handler mocks cover both routes: authorized versus denied calls, already-refunded and provider-error gates, actual refund amount, upcoming/completed/no-show status rules, ledger and waitlist behavior, held email promise preventing premature return, email rejection/throw preserving success, missing contact and released-hold email suppression. Full flow suite, targeted lint, whitespace checks and production build with dummy credentials passed (202 pages; expected dummy-backend plans warning). No live refunds, payment sessions, emails, production data mutations or browser smoke tests.

## Limits

This is an awaited attempt, not guaranteed delivery, retry persistence or deduplication. Email acceptance is not added to the public refund response. Existing refund persistence failure handling remains separate; changing money/database reconciliation requires coordinated review. The refund_issued HTTP template remains available because its Stripe webhook caller has not yet been migrated. These routes used configured URLs, not caller Origin, so this report does not claim the earlier payment-link credential leak existed here.

Applied the repository secure-engineer skill to preserve monetary behavior and verify both sibling notification paths. Other task retains onboarding work.
