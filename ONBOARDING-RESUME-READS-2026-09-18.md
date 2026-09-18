# Onboarding saved-setup read reliability

An actual-effect regression reproduced silent shop-read failure and partial publication of a saved shop before its team lookup succeeded. Setup could proceed while restoration was still pending. The loader also had no cleanup guard for late responses.

Setup now waits for both shop and team reads before exposing restored IDs or enabling writes. Failed/missing query results and thrown reads show a generic retryable state. Confirmed empty results still allow a new setup or an empty team. Shop selection remains ordered by oldest creation date with limit one. Primitive account dependencies avoid reloading when the shop ID is published or an auth object refreshes; cleanup and current-account checks reject late results. Switching accounts while this wizard is mounted requires Reload setup so existing account drafts cannot carry over.

The new read gate covers direct Continue, Enter-to-continue and staff invitation handlers. All existing creation payloads, trial/plan rules, commissions and scheduling writes remain unchanged. This does not restore additional shop/hour/service form fields or repair non-atomic hours replacement. No live data or messages were used in testing.

Actual-effect/handler regressions cover failed/null/offline queries, retry, team-read failure without partial state, success and empty results, cleanup/account changes, preserved oldest-shop selection and blocked writes. Validation/push status is recorded in the parent audit log.
