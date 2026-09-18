# Password-reset email boundary

## High-severity source finding

The authorized barber-reset route used request Origin as the target for an HTTP email call. That request carried the owner's bearer token, CRON_SECRET (when configured), and the barber's recovery action link. A mocked execution of the pre-fix handler from commit 1478c0d confirmed all three were forwarded to an attacker Origin. This is a reproduced code path, not evidence of actual exploitation or production credential exposure.

## Fix

- Barber recovery email is sent directly through the existing shared email engine, after the same owner/super-admin authorization and canonical Auth-user email lookup. No HTTP hop or credential forwarding remains. Delivery failure still returns emailed:false, and the action link is never returned in the response.
- Both barber and self-service recovery redirects use configured NEXT_PUBLIC_APP_URL, with the existing clipwise.ca fallback, rather than caller Origin. Existing destination paths are unchanged.
- password_reset and barber_password_reset are now server-only templates at the generic HTTP boundary. Actual repository callers use the dedicated workflows; a staff token or internal-secret header can no longer fabricate these templates with arbitrary recipients/links.

No passwords were reset during testing. No schema, Auth configuration, roles, business policies or dependencies changed. Self-service generic responses and rate-limit behavior are preserved. No claim is made about live Supabase redirect allowlists or historical exposure; secrets were not rotated.

## Verification and limits

Actual-handler mock tests cover malicious Origin, configured/fallback redirects, canonical login recipient, missing login email, owner/foreign-owner/barber/super-admin access, no returned recovery token, provider errors and privacy-preserving self-service responses. Generic email tests read the real server-only set and reject both reset types. The old-handler reproduction was run once with mocks; committed tests do not depend on Git history. Full flow suite, targeted lint and production build with dummy credentials required before push. No production messages/data writes or browser smoke tests.

Other invitation/payment Origin usage and generic email authorization remain separate audit work. Existing malformed-input handling and raw link-generation errors in the dedicated reset routes are not represented as fixed by this transport/redirect batch.
