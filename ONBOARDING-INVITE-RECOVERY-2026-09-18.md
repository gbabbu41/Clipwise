# Onboarding staff request recovery

The actual invite handler reproduced two HTTP requests from overlapping submissions. Network failures previously encouraged an immediate retry even though the server might already have saved staff. Malformed success with an empty barber object was also accepted.

Onboarding self-add and teammate invitations now share a synchronous request guard. Confirmed success requires the API success flag and a nonempty barber ID. Explicit non-server rejections retain the draft and allow retry; network, JSON, server and malformed-success outcomes lock further staff creation for this mounted page and instruct the owner to refresh and inspect the saved team first. Pending forms cannot be edited/dismissed and wizard navigation waits for completion; uncertain staff outcomes must be checked before advancing to hours. Late responses for another account/shop or an unmounted page do not replace current drafts or team rows.

Existing payloads, plan limits, commissions, validation, saved-but-unsent invitation guidance and setup steps are preserved. No schema, server membership or scheduling changes. This is not server idempotency: refresh alone cannot prove an outstanding request has finished. Onboarding resume/read reliability and non-atomic hours replacement remain separate findings.

Tests use mocked HTTP only and cover duplicates, uncertain outcomes, explicit rejection retry, retained forms, context changes, navigation blocking and existing payloads. No real staff, invitations or customer records are changed. Validation and push results are recorded in the parent audit log.
