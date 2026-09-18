# Calendar quick-setup hours prerequisites

The actual saveHours handler treated failed/null team reads as an empty team and called the owner-chair creation endpoint. It also ignored returned time-slot deletion errors before inserting replacement hours and closing the form.

The handler now requires a successful team read, a confirmed nonempty barber ID after owner-chair creation, and a successful hours deletion before insertion. Failed or thrown prerequisites leave the form open with existing failure feedback and release loading. Confirmed empty teams still create the owner chair with commission 0. Existing staff/hour payloads and successful close/refresh behavior are unchanged.

Regression checks cover failed/null/offline team reads, malformed chair confirmation, returned/thrown deletion failure, all-closed schedules, valid owner creation and successful slot payloads. This does not make hours replacement atomic or add retry/idempotency semantics. Duplicate submissions, pending dismissal, stale-shop form drafts and location-save confirmation remain separate follow-up candidates. No live data/messages were used. Full check and commit evidence are recorded in the engineering handoff and parent audit log.
