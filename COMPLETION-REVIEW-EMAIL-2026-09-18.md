# Completion review-request reliability

Reproduced before fixing: the actual completion helper marked review_request_sent_at after a mocked HTTP 403. Its HTTP caller omitted the authorization required by the generic review_request gate, ignored response status, and its appointment selection omitted the timestamp checked by the existing prior-send guard.

The server helper now calls the existing internal sender, awaits it, reads review_request_sent_at, and stamps only the sender's success result. Returned errors and thrown send failures do not stamp. Failed timestamp persistence emits a generic warning, without automatic resend or changing payment/completion outcomes. The review link uses configured NEXT_PUBLIC_APP_URL/fallback, not the caller-derived baseUrl; the callable signature remains compatible.

Success semantics: the shared sender returns success for provider acceptance OR its existing already-reviewed suppression. The timestamp therefore records that existing handled outcome, not proof of inbox delivery. The no-nag suppression, review template/content/recipient, timing, consent/eligibility and existing timestamp policy remain unchanged. No backfill or automatic replay. Generic review_request HTTP remains available to other existing authorized browser callers; this patch does not blanket-close it.

No loyalty/client-stat accounting logic, payment policy, schema, infrastructure or dependencies changed. Cross-request send/mark races and accepted-send/failed-stamp uncertainty remain; exactly-once delivery requires a separately approved atomic design. Browser/calendar/cron sibling sent-state handling remains a separate follow-up.

Actual-helper tests cover rejected/thrown sends, successful payload/link and stamp, prior timestamp, missing contact, read failure, held sender promise, failed stamp and production fallback. No live database mutations/messages, payment tests or browser smoke tests.

Verification: focused regression, clean targeted lint, full combined flow suite, whitespace checks and production build passed (202 pages, dummy credentials; expected dummy-backend plans warning). Repository secure-engineer and Supabase guidance informed failure handling and explicit timestamp selection. Supabase changelog breaking changes were checked; no relevant API change for existing column selection. Documentation: https://supabase.com/docs/reference/javascript/select . Database behavior here was tested with mocks, not a live schema verification.
