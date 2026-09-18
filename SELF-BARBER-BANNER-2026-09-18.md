# Starter owner self-add banner reliability

An actual-effect regression reproduced a failed barber lookup being displayed as proof the owner had no barber record. A single lifetime checked flag also prevented a recheck after effect cleanup or a location change. The banner now distinguishes a failed lookup from a confirmed absent row, offers a read-only Retry setup check, reruns for the current owner/location, and hides stale scope content. Failed and late reads cannot offer incorrect creation prompts.

Self-add now guards overlapping submissions, validates the confirmed owner-self success and saved ID, and keeps uncertain network/server/malformed outcomes locked with refresh/check-original-shop guidance. Explicit non-server rejections allow a deliberate retry. Successful responses and delayed dashboard reloads are scoped to the current owner/location and cancelled on cleanup. The success guard resets for another location; uncertain writes are not automatically retried.

The Starter eligibility, owner commission payload of 0, server authorization, endpoint and intended post-success refresh/reload remain unchanged. No API or schema changes, no real staff writes or messages. Automated regressions execute the effect and handler with mocked reads/HTTP/timers, covering read failures, cleanup/recheck, changed locations, saved rows, duplicate submissions, uncertainty, rejection retry, scope guards and payload preservation.

This is not server idempotency and does not make staff count-and-insert atomic. Validation and push results are recorded in the parent audit log.
