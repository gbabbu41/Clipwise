# Service-template save reliability

An actual-handler regression reproduced two insert calls from overlapping submissions. Template saves now use a synchronous in-flight guard, retain selections on rejected or thrown saves, release busy state in finally, and suppress completion feedback/reloads after switching shops. Selection and dismissal controls are locked during the request. Database error details are no longer shown to users.

Existing template prices, durations, categories, name filtering, active flags and retired-deposit payloads are unchanged. This is a client submission safeguard, not server idempotency or cross-session duplicate prevention. Ambiguous saves ask the owner to refresh the list before retrying. Service-list read races are a separate follow-up.

Regression checks use mocked inserts only; no live services or messages are created. Validation and push status are recorded in the parent CLIPWISE-AUDIT-LOOP.md.
