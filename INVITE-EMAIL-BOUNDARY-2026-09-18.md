# Invitation email boundary

## Finding and bounded fix

Both dedicated barber invitation routes used caller-supplied Origin for their invitation redirect and existing-account login destination. In particular, the existing-account email contained that plain login URL without passing through an Auth redirect allowlist. Source review also found the generic email API permitted staff-role callers to supply arbitrary invitation recipients and links.

Both routes now use configured NEXT_PUBLIC_APP_URL (trailing slashes removed), with the existing https://clipwise.ca fallback. Deployment configuration must contain the intended public URL. The barber_invite template is server-only at the generic HTTP boundary; the two legitimate repository callers already use the in-process email sender.

No invitation acceptance logic, team creation, commissions, plan limits, calendar behavior, dependencies, schema or production data changed. No evidence of historical exploitation is claimed, and live Auth configuration was not inspected.

## Verification

Actual-handler mocked regressions cover both routes, forged Origin, configured/fallback URLs, new/existing accounts, canonical recipients, invite metadata, delivery failures, authentication/role/ownership gates, manual additions, owner self-add and plan-limit rejection. The generic-email tests verify the real server-only set rejects invitation templates. Full flow suite, targeted lint, diff whitespace checks and production build with dummy credentials passed (202 pages). The expected plans-server fetch warning reflects the dummy backend. No live invites, messages or manual browser tests.

## Separate follow-ups

Link-generation errors are currently all treated as existing accounts; distinguishing provider failures needs a separate change. Generic booking/direct-message authorization and payment redirect Origin usage remain outstanding. These are not fixed by this batch.
