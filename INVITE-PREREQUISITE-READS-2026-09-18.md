# Staff invitation prerequisite reads

## Confirmed source issues and fix

The staff-creation route ignored errors when looking up an existing account and duplicate team member. Its plan-limit count also ignored errors and treated a missing count as zero. Consequently, unavailable prerequisite data could allow creation to continue without establishing the existing account restrictions, duplicate state or remaining plan capacity.

Those three reads now stop with a generic, retryable HTTP 503 before any staff insert/update, Auth invitation generation or email. Missing, negative and non-integer counts also stop. Confirmed zero still permits creation subject to the unchanged plan limit. No raw database error is returned by these new branches.

Existing owner/super-admin gates, foreign-owner restriction, duplicate rejection, self-add/relink shortcuts, manual additions, commissions, plan limits and invitation behavior are preserved. This does not make concurrent count-then-insert atomic. No schema, dependencies or production data changed.

## Verification

Actual-handler mocks test all three read failures, missing/invalid counts, manual and owner new-chair failures, no writes/messages after failure, confirmed duplicate/foreign-owner rejection and existing owner-row relinking at the plan limit. The existing invitation transport/permissions/email-failure checks remain in place. Full flow suite, targeted lint, diff whitespace checks and a real production build with dummy credentials passed (202 pages). The plans-server fetch warning is expected against the dummy backend. Hands-on smoke tests remain deferred; no live invitations or customer transactions were performed.

## Separate invitation-provider follow-up

Both invitation handlers still interpret every generateLink error as an existing account. Supabase's current error reference distinguishes email_exists/user_already_exists from other failures. Fixing the classification alone is insufficient: the creation route has already saved a barber, and the staff screen unconditionally marks a successful creation response as invite-sent. A follow-up must represent "staff saved, invitation unavailable" honestly and keep the existing row recoverable through resend, without deleting uncertain Auth/staff state or encouraging duplicate creation. This coordinated response/UI work is not included here.

The review followed the repository secure-engineer skill and the Supabase skill's error-checking/documentation guidance. The changelog markdown endpoint was unavailable through the web reader; the connected documentation tool supplied current Auth error-code definitions. No live Auth configuration was inspected.
