# Admin approval/rejection notification authorization

## Evidence and scope

Actual generic-handler regression reproduced an anonymous `shop_approved` email with HTTP200 and caller-supplied recipient/content. This notification path did not mutate approval status: both existing admin PATCH routes requireSuperAdmin, and the regression verifies unauthenticated PATCH requests fail before reads/writes. No live abuse or messages are claimed.

The generic email route now uses the same requireSuperAdmin authority. A valid shop reference is required; saved shop/owner recipient, branding, slug and rejection reason replace all submitted template values. The saved status must match the requested notification, so a stale approval screen cannot send an approval message for a currently rejected shop. Unknown shops, failed reads and missing recipients send nothing. Existing template links derive from configured base URL and the stored slug; request Origin and forged slug are unused.

All five notification calls across the three admin screens now send bearer credentials and shopId only. Approval/rejection PATCH decisions, payloads and mutation handlers are unchanged. Email HTTP/JSON/network failures show “status saved; email not confirmed” with explicit instructions not to repeat the status action. No automatic retries/backfills, rollback of successful approval, schema or admin policy changes. This is not delivery deduplication or inbox confirmation.

## Tests and verification

`scripts/tests/admin-email-auth-check.cjs` executes the actual route and requireSuperAdmin helper: anonymous/expired/staff/forged-role/shared-secret denial; valid admin canonical payload; stored recipient fallback; status mismatch; missing/failed shop reads and recipient; provider failure without status mutation. Executes actual browser handlers for all five calls, asserting bearer/shopId, one approval mutation, retained successful UI status, and safe feedback for HTTP/network/JSON/malformed email responses. Existing review and birthday boundary tests also pass.

Baseline targeted lint before edits: one unused `Users` import in `src/app/admin/page.tsx`. After edits the same single diagnostic remains; no new lint diagnostics. Focused tests, full flow suite, whitespace checks and real production build passed (202 pages, dummy credentials; expected plans fetch warning). The first full-suite run exposed a missing test-harness mock for the new admin-auth import; the billing regression now explicitly forbids invoking that helper for billing types, and the rerun passed. No live notifications or browser smoke testing.
