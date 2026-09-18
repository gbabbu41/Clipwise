# Staff email request recovery

## Fix

The Staff page's password-reset and resend-invitation handlers had no exception cleanup or synchronous duplicate guard. Failed fetch/JSON could leave a button spinning, and overlapping requests could issue multiple emails and overwrite pending feedback.

Both now use a shared in-flight guard, disable the two email actions while pending, and clear pending state in finally. Successful responses are checked before opening their result dialog. Network/malformed outcomes do not claim delivery or auto-retry: feedback asks the owner to check the barber's inbox before requesting another email. A later deliberate request remains possible. Context generations suppress late dialogs/toasts after location change or unmount.

Endpoints, bearer forwarding, barber IDs, server authorization, email generation, delivery semantics and all business/calendar rules are unchanged. No schema or dependencies were added. This is a browser request-state fix, not an Auth implementation change.

## Verification

Extracted actual-handler regression tests cover duplicate and cross-action overlap, failed fetch/JSON/malformed responses, API rejection, sent/unsent results, cleanup, explicit later retry, missing session, payload/token preservation and stale-context suppression. Full flow suite, targeted lint, whitespace check and production build with dummy credentials passed (202 pages). The plans-server fetch warning is expected with the dummy backend. No live emails, account changes, production mutations or browser smoke tests.

## Remaining work

Staff creation/self-add and onboarding uncertain-network recovery remain separate; this batch does not change those handlers. An indefinitely unresolved network request has no new timeout, because aborting the browser request cannot establish whether the server sent the email. No automatic retries were added. The repository secure-engineer guidance informed honest outcome reporting and preservation of existing server access controls.
