# Waitlist removal save feedback

Small reliability fix: the existing removal action now requires a returned saved row before showing Removed or changing the entry locally. Database errors, zero affected rows and connection failures retain the visible entry and show a retry message. The update is explicitly scoped to the active shop. A synchronous guard and disabled in-flight button prevent duplicate submissions; failure releases the guard for retry.

No schema, notification policy, pricing, calendar or architecture change. The existing Supabase/RLS path remains in use.

Actual-handler regression tests cover failed, zero-row, offline and successful saves, shop scoping, duplicate clicks and retry. Targeted lint passed. Full regression/build and push results are recorded in CLIPWISE-AUDIT-LOOP.md outside the repository. No live waitlist entries were changed and no manual smoke test was performed.

Security/Supabase guidance informed checking the saved row rather than assuming a successful request means a successful update.
