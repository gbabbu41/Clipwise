# Staff creation request recovery

## Bounded fix

Invite, manual add and owner self-add share a synchronous pending guard. This prevents overlapping requests across all three entry points, not just repeat clicks on one button. Fetch/JSON failures clear loading in finally, and malformed success cannot claim a confirmed creation.

Explicit non-server rejections retain drafts and permit a deliberate retry. Network, malformed and server-error outcomes are treated conservatively: the staff record might already exist, so further creation is locked for the mounted page and persistent feedback asks the owner to refresh and inspect the team at the original location before adding again. Existing records can use Resend invite. No automatic retry or new staff deletion is introduced.

Pending form fields, tabs and dismissal controls are disabled; the backdrop has an immediate pending guard. Late confirmed responses after a location change cannot clear another location's form or open its success dialog. Existing name/email/commission validation, payloads (including owner self-add's 0% commission), plan checks, owner/manual paths and invitation-recovery feedback remain unchanged. No API, schema, dependency, calendar or business-rule changes.

## Verification

Extracted actual-handler tests cover all three entry points, cross-entry duplicates, failed fetch/JSON/server/malformed results, uncertain repeat prevention, explicit rejection retry, retained drafts, pending cleanup, stale context and unchanged payloads/tokens. Existing invitation feedback and reset/resend tests remain enabled. Full flow suite, targeted lint, whitespace checks and a real production build with dummy credentials passed (202 pages; expected plans-server warning from the dummy backend). No real staff creation, messages, customer transactions or browser smoke tests.

## Remaining work

Onboarding and standalone self-add banners are separate callers and still need their own network/duplicate audit. A page refresh does not guarantee a previously outstanding request has completed; the instructions require checking the team before a new request. This client safeguard does not replace database idempotency or make count-and-insert atomic. The repository secure-engineer skill informed conservative outcome reporting and verification without changing existing server authorization.
