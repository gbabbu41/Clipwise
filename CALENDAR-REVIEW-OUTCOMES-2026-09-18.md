# Shared calendar completion review outcome

Reproduced in an actual-helper test: runCompletionEffects wrote review_request_sent_at after rejected HTTP, independently of send success. It now awaits the review HTTP result and requires both response.ok and JSON success:true before stamping. Rejected/network/JSON/malformed responses leave the timestamp unchanged. Stamp persistence failure warns generically without replay.

Preserved existing prior-timestamp/missing-contact gates, auth token, payload, timing, eligibility, template, loyalty call and client-stat logic. No layout, scrolling, scheduling or calendar behavior changes. Software developer explicitly granted ownership of this review-only block; setup files remain theirs. Inline Appointments has no sent stamp/prior guard and was not changed or falsely reported fixed.

Success remains API handled/provider acceptance or existing already-reviewed suppression, never inbox-delivery proof. Cross-request send/mark races and accepted-send/failed-stamp remain separate atomicity limits. No retries, backfill, consent/schema or business-policy changes.

Focused test verifies rejected/thrown/bad-JSON/malformed responses, confirmed success, pending promise, missing email, prior timestamp, auth payload and unchanged loyalty call. No real email, production mutation or browser smoke test. Repository security/Supabase error-handling guidance kept the stamp conditional and its failures observable.

Verification: focused test, clean targeted lint, whitespace checks, full combined flow suite and production build passed (202 pages, dummy credentials; expected dummy-backend plans warning).
