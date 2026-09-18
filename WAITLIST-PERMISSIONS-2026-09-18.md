# Waitlist permission batch

Approved scope: first audit finding 2 only. No schema, dependency, booking policy, reward, pricing or calendar behavior change.

## Changes

- Browser notification requests require a verified shop owner or active barber with `manage_appointments`, using the existing shop authorization helper.
- Appointment identifiers resolve their actual shop; caller-supplied shop/date fields cannot override that context. Invalid dates/IDs and a barber from another shop are rejected. Manual staff Notify Day remains supported without requiring a cancelled appointment.
- Existing waitlist sender moved to a `server-only` helper. Customer cancellation/rescheduling and the two existing refund routes call it directly after their own workflow checks, without an unauthenticated HTTP hop or a new shared secret.
- All browser callers pass the existing access token. Calendar changes are only the two notification-helper arguments, not layout, scrolling or booking logic.
- Booking links use the configured application URL or clipwise.ca, never the request Origin.

## Verification

- `npm run test:flows` passed, including previous booking-save and calendar regression checks.
- Added `waitlist-auth-check.cjs`: anonymous/invalid-token/foreign-shop/inactive/unpermitted staff rejection, manual staff sends, appointment-derived shop context, malformed inputs, query failures, fixed link origin, shared browser token forwarding and server caller wiring.
- The real customer-booking route remains exercised with mocked providers: alerts follow successful saves and retain the vacated date.
- Targeted lint and whitespace checks passed. Real production build passed, including type-checking and 202 static pages, using dummy CI credentials. The plans fetch warning against the dummy backend does not establish live plan-loading health.
- All notification providers were mocked. No customer messages, real payments, live database writes or manual smoke tests performed.

## Deliberately deferred

Notification delivery-result tracking, retries and concurrency deduplication remain separate approval items. This batch preserves their existing behavior; it does not claim exactly-once delivery. Existing refund-route save-result handling also warrants its own payment-reliability review and was not redesigned here.

The secure-engineer and Supabase skills guided the shop permission gate, server-only boundary and full caller tracing. Current [Supabase getUser guidance](https://supabase.com/docs/reference/javascript/auth-getuser) was consulted. The Markdown changelog endpoint was unavailable; no Supabase SDK or schema changes were introduced.
