# Internal notification email transport

## Source-confirmed issue

Waitlist acceptance sent customer details via a fire-and-forget HTTP request to `/api/send-email`, falling back to the request Origin if the app URL was missing. Cancellation notifications posted customer/barber details to the request Origin ahead of even the configured app URL. A caller-controlled destination must not receive this payload. No live exploit or message was attempted.

## Scoped fix

Both handlers now call the existing `sendAppEmail` engine directly and await the delivery attempt, matching the existing walk-in seating pattern. This removes the Origin-dependent outbound hop and prevents the waitlist handler returning before its delivery attempt finishes. Recipient/template values are unchanged. Email failures remain best-effort and do not turn an already-created booking into a failed booking response.

No booking inserts, conversion logic, conflict rules, prices, permissions, plan/SMS rules, schema or UI were changed. This is not email idempotency or a new notification architecture.

## Verification

Actual-handler mocked regressions cover malicious Origin, no outbound HTTP hop, exact saved recipient/template payloads, delayed delivery awaiting, thrown/reported email failures, missing email, authorized owner/barber waitlist success, failed booking/auth/conflict paths and unchanged cancellation SMS eligibility. The waitlist test failed against the old implementation before the fix. Full flow suite, targeted lint and real production build with dummy credentials required before push. No browser smoke tests or production-data writes.

## Remaining source findings

- The public cancellation fan-out still accepts an appointment ID and a caller-provided status label without caller ownership; notifications can be repeated. Its existing cancelled-state SMS guard is preserved, not represented as full authorization.
- The smart-waitlist acceptance route queries service by ID and accepts a supplied barber ID without independently checking both belong to the waitlist shop. Existing insert constraints may provide additional protection, but were not inspected live. Review resource validation as a separate batch without changing pricing/override rules.
- Other Origin-first URLs exist in recovery/invitation/payment paths. In particular, forgot-password supplies Origin in its recovery redirect request; Supabase allowlist behavior/live configuration was not inspected. Audit separately; do not claim a demonstrated token leak.
- Generic booking email HTTP authorization remains unfinished; trusted server callers must be preserved when tightening it.
