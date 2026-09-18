# Onboarding Continue save guards

A regression invoking the actual Continue handler twice while its first request was held reproduced overlapping shop creation, hours replacement and service insertion. React's saving state did not provide a synchronous guard inside the handler. A ref now guards pending saves and releases in finally on success or failure.

The hours step's fallback team lookup also ignored errors and treated null data as an empty team, falsely advancing without saving hours. Errors and null results now stop advancement with a retryable message; confirmed empty results retain existing behavior.

Tests cover held duplicate requests, exception cleanup, resume-read blocking, service payload preservation and failed/null/empty team reads. Existing shop/trial, service, commission and scheduling rules remain unchanged. This guard is local to the mounted wizard: it does not add server idempotency or make delete-and-insert hours replacement atomic. Ambiguous service-insert retries and failure after hours deletion remain unresolved. No live data or messages were used. Validation and commit evidence are in DIRECTOR-ENGINEERING-STATUS.md and the parent audit log.
