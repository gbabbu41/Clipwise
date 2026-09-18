# Waitlist assignment form recovery

The shared assignment sheet awaited its request/custom callback without catch/finally, leaving Booking stuck on a network exception. React state alone also allowed overlapping same-render clicks, and a successful HTTP response without confirmed booking data could close the sheet as success.

The sheet now uses a synchronous in-flight guard, always clears busy state, retains rejected selections, and blocks dismissal/picker edits while a submission is pending. Successful submission remains guarded through the closing animation. Network exceptions, server failures and malformed success responses show an uncertain-outcome message and disable another submission in that sheet, instructing staff to close it and refresh/check the calendar and queue first. Explicit rejected requests remain retryable.

Both owner and barber walk-in callbacks now validate the existing `ok`/`appointment_id` response and propagate uncertain results to the same sheet. No API contracts, booking inserts, scheduling, permission, pricing, queue-conversion or calendar behavior changed. Two existing JSX apostrophes were escaped and an unused import removed so lint passes on the touched pages.

Actual extracted-handler regressions exercise deferred double-clicks, closing-animation repeats, offline/server/malformed responses, explicit rejection retry, callback success/failure, payload/token forwarding and both walk-in callbacks. Full flow suite, targeted lint and production build with dummy credentials required before push. No live messages/transactions, database writes or manual smoke tests.

Limits: this is a local form safeguard, not server-side idempotency or atomic queue conversion. Closing/reopening intentionally does not claim to reconcile the booking; staff must follow the calendar/queue check instruction. Availability loading still has separate error/empty-state and duration-fit follow-ups.
