# Generic marketing email boundary — September 18, 2026

## Scope

Generic `marketing_campaign` accepted caller-supplied recipient, subject and HTML based on a broad paid-owner check or shared secret, bypassing dedicated campaign recipient/eligibility processing. The actual generic handler regression reproduced HTTP200 with forged recipient/HTML and shared secret before the fix, then HTTP403 afterward. No live messages or abuse claimed.

Added this type to the existing server-only set. HTTP sends now reject before auth/database/delivery work, including staff and internal-secret callers. No legitimate HTTP caller was found. The now-unreachable legacy generic paid-plan block is left untouched to keep this security batch minimal; it is not the authoritative marketing workflow.

## Preserved callers

- Marketing page uses `/api/marketing/send`, which calls the internal engine. Its existing shop-owner/paid-plan checks, consent processing, campaign records, counters, content and recipient rules are unchanged by this batch.
- `src/lib/gift-card-server.ts`, `api/gift-card/send-link` and `api/gift-card/resend` call the internal engine. Operational gift-card delivery and deliberate recipient overrides remain unchanged; promotional consent must not be indiscriminately applied to these transactional messages.
- Test checks the rejection matrix plus all four direct caller wiring paths and marketing page endpoint. This is not a new full behavioral audit of gift-card delivery.

## Separate high-priority findings (not fixed here)

The dedicated campaign route resolves a saved client for consent by clientId/email/phone, but still passes the browser's original email to the sender (`src/app/api/marketing/send/route.ts`, recipient loop). A supplied consenting clientId can therefore be paired with a different recipient. This is source-supported, not yet reproduced in an actual-handler test. Next bounded investigation: bind consent to the actual saved recipient without changing the consent policy or gift-card override semantics. The generic closure alone does NOT resolve this issue.

Admin shop_approved/shop_rejected generic email remains anonymously callable with supplied content. Source tracing found that actual status mutations are separate PATCH handlers guarded by requireSuperAdmin; no unauthenticated approval mutation was found in this path. Three admin pages already carry tokens for PATCH, but omit them for the subsequent email request. Next migration can preserve the existing verified-super-admin authority while resolving saved shop/owner/status/reason; approval decisions must remain unchanged. Reproduce negative tests before code changes.

## Verification

Focused endpoint regressions, targeted lint, whitespace checks, combined full flow suite and real production build passed (202 pages, dummy credentials, expected dummy-backend plans fetch warning). No schema changes, new dependencies, automatic retry, live delivery or deployment-health claim.
