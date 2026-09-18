# Waitlist availability read recovery

The shared assignment sheet treated failed HTTP reads as an empty barber list and left network exceptions uncaught. Staff could see “No open slots” when availability was actually unavailable. Prior slots also stayed in state while another read started.

The loader now clears prior slots, distinguishes HTTP/network/malformed-response failures from a confirmed empty list, and offers a retry button. A request-context key gates booking until the current entry/shop/day/barber-mode availability read completes successfully. Existing effect cleanup continues to suppress stale or unmounted responses. Confirmed data retains the existing preferred/current/free-barber selection behavior.

No slot calculation, duration, shift, timezone, calendar, booking endpoint, pricing or permission changes. This does not fix separate duration-fit or shift-gap issues in the underlying picker algorithm, and it does not add booking retries.

Verification: extracted actual effect tests cover HTTP/network/JSON/shape errors, clear-on-load, retry recovery, genuine empty success, reversed response order, cleanup, payload scoping and preferred barber. Booking form regressions now require confirmed availability. Full flow suite, targeted lint and production build with dummy credentials required before push. No live messages, production writes or hands-on smoke tests.
