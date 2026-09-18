# Public booking essential-load recovery

Actual-effect regression reproduced failed/null service or barber queries rendering as an empty shop menu. Shop read failures already had a retry screen, but the dependent required reads did not use it.

Required service/barber failures now set the existing load-error state and reuse its reload retry. Confirmed empty results, unknown shops and pending shops keep their existing screens. Reviews remain optional even if their request throws. Cleanup and current-slug checks reject stale reads; the server page keys the client by slug to reset the prior shop's booking draft. Booking and waitlist submission handlers require successfully loaded prerequisites. No selectors broaden data access.

The shop still publishes after its successful read so the existing payment-return finalizer can run. Its requests and payment policy are unchanged. A server-confirmed booking/payment result is allowed to render despite a menu-load error; Book Again then returns to the error gate until reload succeeds.

Targeted tests cover required errors/null data, optional review errors/throws, empty/missing/pending shops, failed/offline shop reads, retry, late shop/options responses and blocked direct submission handlers. No live bookings, messages or payment tests were run.

Targeted lint is not clean: this file has 18 existing unused-declaration errors and 4 existing img warnings. ESLint compared unchanged HEAD text via lintText with the actual modified file; normalized ruleId/severity/message arrays are identical (line numbers excluded). The patch introduces no new diagnostics. Full suite/build and commit evidence are recorded in the engineering handoff/audit log. Unrelated unused code was preserved.
