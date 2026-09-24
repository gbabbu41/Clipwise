# Internal-only booking/schedule notification types

Push resumed at the owner's explicit request after the usage-conservation pause. Preserved and fast-forwarded all 55 newer main commits through `93e284c` before reapplying this batch; caller inventory and regression checks were repeated against that updated source, including its unsubscribe changes. Only this batch's four files are included in the push.

## Bounded boundary fix

Added ten existing types to SERVER_ONLY_EMAIL_TYPES: appointment_reminder, appointment_updated, appointment_cancelled, barber_appointment_change, new_booking_owner, new_booking_barber, schedule_updated, time_off_request, time_off_decision and waitlist_slot_open.

Generic HTTP previously allowed anonymous booking/reminder notices and broad staff/shared-secret schedule/waitlist notices with arbitrary payloads. The actual handler test reproduced appointment_reminder HTTP200 instead of required403 before the fix. The expanded matrix now requires403 and zero sends/reads for all ten types with anonymous/staff callers and with/without shared secret. No live exploitation claimed.

## Caller inventory preserved

| Types | Direct server callers |
| --- | --- |
| appointment_reminder | reminder cron |
| appointment_updated | appointments/update; my-booking/[id] |
| appointment_cancelled | my-booking/[id] |
| barber_appointment_change | appointments/update; my-booking/[id]; appointments/notify-cancellation |
| new_booking_owner, new_booking_barber | notify-booking-emails; finalize-booking-session; reassignment in appointments/update for barber |
| schedule_updated | schedule route |
| time_off_request | calendar/block; schedule/time-off; time-off/submit |
| time_off_decision | time-off/decide; time-off/cancel; time-off/exclude-date |
| waitlist_slot_open | waitlist-notify-server |

Repository-wide type searches found no browser sends for these types. Existing server wrappers resolve into sendAppEmail directly. Added caller-wiring assertions for all fourteen files; comments referencing the former HTTP transport are not treated as executable calls. No caller business logic, eligibility, recipient selection, cancellation/schedule decision, template or delivery outcome changed.

Public booking_confirmation/booking_request_received, manual rebooking/no-show/rejection, birthday/direct/review and join-shop request paths remain distinct; none is blanket-blocked here. This patch does not certify all dedicated caller permissions or fix delivery atomicity. Earlier permission/outcome regressions remain in the full suite.

Verification: focused endpoint matrix, targeted emailer lint, full combined flow suite, whitespace checks and real production build passed (202 pages, dummy credentials; expected plans fetch warning). Existing finalizer comment mentioning the former HTTP endpoint was excluded from the executable-caller wiring assertion. No live messages, schema, dependencies, retries or browser smoke tests.
