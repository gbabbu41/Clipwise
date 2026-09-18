# Payment receipt delivery boundary

The shared sendPaymentReceipt helper previously sent customer/contact/payment receipt data to its baseUrl argument over HTTP. capture-appointment chooses request Origin before configured app URL, allowing a caller-supplied destination. The helper did not forward bearer tokens or secrets; this is a receipt-data destination issue, not a demonstrated credential leak or historical incident.

The helper now awaits the existing internal sender. Its signature is preserved so all six existing caller sites continue unchanged. The payment_receipt template is server-only at generic HTTP, preventing fabricated customer receipts. All source callers were checked before closing the endpoint. Repository secure-engineer guidance drove the sibling caller review and source-preserving change.

Amounts, tax/tip itemization, GST text, POS item escaping, timestamps, no-show copy/link, eligibility and payment processing are unchanged. Email rejection/throw remains best-effort and does not turn a charge into a failure. This does not fix callers that do not await the helper, guarantee delivery or add retry/deduplication.

Focused actual-helper tests cover caller-origin isolation, original receipt fields, tax/tip totals, escaped item rows, no-show content, invalid breakdown suppression, missing-contact/zero/negative gates, awaiting and failure isolation. Generic endpoint tests reject HTTP receipt sends. No live payments/messages, database changes or browser testing.

Verification: focused tests, full combined flow suite, targeted lint and real production build passed (202 pages, dummy credentials; expected dummy-backend plans warning). Expanded generic-boundary tests also cover anonymous/staff callers both with and without a shared-secret header.
