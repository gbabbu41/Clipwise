# Payment-link email boundary

## High-severity source finding and narrow fix

Both payment-link and balance-link routes built an HTTP email destination from caller Origin, forwarding the staff bearer token, configured CRON_SECRET, customer details and checkout URL. An authorized caller could supply an external Origin. This is a source-confirmed unsafe path, not evidence of historical exploitation or credential exposure.

Both now await the existing in-process email sender. No email HTTP hop or credential forwarding remains. Checkout success/cancel destinations use configured NEXT_PUBLIC_APP_URL with the existing clipwise.ca fallback and trailing-slash normalization. Deployment configuration must contain the intended public URL.

The generic HTTP email endpoint now rejects payment_link templates, including requests with staff credentials or an internal-secret header. Repository caller review found only the two dedicated routes; both now send directly after their existing appointment permission checks.

Existing Stripe line items, amounts, taxes, metadata, Connect account, completion flag, plan gates, database writes, authorized contact overrides and SMS behavior are unchanged. Email failure still returns the checkout URL with emailed:false. No schema/dependencies/payment-rule changes; no live Stripe sessions, emails or production mutations used for testing.

## Verification

Actual-handler mocks cover malicious Origin, configured/fallback return URLs, awaited sends, provider rejection/throw, checkout preservation, permission/plan/Connect/amount gates, full-versus-balance tax breakdown, metadata and contact overrides. Generic HTTP regressions read the actual server-only set. Full flow suite, targeted lint and real production build with dummy credentials passed (202 pages). Initial build caught nullable/numeric email-payload typing; normalized only email text fields and added nullable-field regression before rebuilding successfully. Stripe numeric calculations were untouched. Expected plans-server warning reflects the dummy backend.

## Limits

No historical exposure investigation or secret rotation was performed. Existing unchecked persistence writes and SMS texted:true semantics remain separate reliability findings; this transport patch does not claim to fix them. Booking confirmation still has public browser callers (public booking and two staff approval paths), so blanket-blocking that template is unsafe until callers are migrated together. Onboarding/banner work belongs to the software developer task and is excluded from this batch. The secure-engineer skill informed credential-boundary review and preservation of existing payment behavior.
