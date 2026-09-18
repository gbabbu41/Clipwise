# Owner payment email boundary

All three owner_payment_received server callers now await the existing internal sender: markAppointmentPaid in src/lib/finalize-appointment-payment.ts and balance/post-booking-payment branches of src/app/api/webhooks/stripe/route.ts. The generic HTTP email boundary rejects this template, including anonymous, staff and shared-secret requests.

The finalizer previously sent customer/payment details through its baseUrl argument, supplied from caller Origin by payment-link-finalize. The webhook used a configured URL. No bearer/secret forwarding or historical exploitation is claimed. Both used unawaited HTTP sends.

Payment decisions, claim/dedup filters, ledger amounts/taxes, receipt eligibility, owner recipients, notification content and completion effects are unchanged. Internal delivery attempts are awaited; errors remain best-effort and do not report an already-completed payment as failed. This does not guarantee delivery, persist retries or solve financial-write reconciliation. Repository secure-engineer guidance drove review of all three callers before closing HTTP access.

Actual-helper/handler regressions cover all three paths, saved payloads, tax/service ledger totals, duplicate/no-transition gates, missing owner email, awaited promises, thrown/returned email errors and finalizer completion after delivery failure. No live payments/messages/data writes or browser testing.

Verification: focused tests, full combined flow suite, targeted lint, whitespace checks and real production build passed (202 pages, dummy credentials; expected dummy-backend plans warning).
