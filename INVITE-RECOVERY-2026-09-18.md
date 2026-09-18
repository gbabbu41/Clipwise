# Invitation failure recovery

## Bounded fix

Both invitation routes previously treated every Auth link-generation error as an existing account and could email a login instruction even after service failure. Only the documented email_exists/user_already_exists codes now select that existing-account path. Other returned errors, thrown failures and missing links do not send an email.

Creation returns a saved-staff/unsent-invitation result, preserving the new staff row for the existing Resend invite action. It no longer deletes that row after an uncertain missing-link result. Resend returns a generic retryable 503 without creating/deleting staff or exposing provider details. No magic-login fallback is added for existing accounts.

Staff closes the creation form, refreshes the team and directs the owner to resend when link preparation fails. It no longer displays "Invite sent!" after a reported email delivery failure. Onboarding retains the saved barber ID for subsequent setup and explains that the invitation must be resent from Staff. Confirmed self-add, manual add, successful invites, commissions, plans and acceptance logic remain unchanged.

## Verification

Actual-handler mocks cover both duplicate codes, unknown/uncoded/rate-limit errors, thrown failures, missing links, no email on failed preparation, retained staff and subsequent resend without another staff insert. Existing authorization, plan-limit and prerequisite-read tests remain. Extracted actual UI-handler tests cover pending invitations, delivery failures, saved onboarding IDs, successful/self-add flows and rejected requests.

Full flow suite, targeted lint (no errors), whitespace check and a real production build with dummy credentials passed (202 pages). The plans-server fetch warning is expected against the dummy backend. No production data, messages, customer transactions or browser smoke tests were used. The existing onboarding img performance lint warning is unrelated and left unchanged.

## Limits and next work

This does not add atomic staff/Auth provisioning, automatically retry requests, alter invitation acceptance or solve concurrent plan-count/insert races. Staff browser fetch exceptions can still leave pending controls stuck, and onboarding's uncertain-network message currently encourages retry without checking saved staff. Audit those request-state paths next with duplicate protection and explicit uncertainty handling; do not change commissions or team membership semantics.

Applied the secure-engineer and Supabase skills: preserve authorized workflows, check provider errors and verify current codes via the connected Supabase documentation tool. The changelog markdown endpoint was unsupported by the web reader. No live Auth configuration or account data was inspected.
