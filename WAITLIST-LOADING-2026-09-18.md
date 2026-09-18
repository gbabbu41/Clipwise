# Waitlist loading reliability

The waitlist page previously discarded errors from all three reads, presenting failed reads as an empty queue. Overlapping refreshes or location switches could also let an older response replace current data.

The page now shows a retryable, generic error for failed reads, keeps counts unknown while loading or failed, and only accepts the latest request for the active shop. Old callbacks cannot restart a previous shop's load. Leaving the page invalidates pending reads; switching shops hides old rows and assignment sheets immediately.

No schema, access rules, notification delivery, booking logic or calendar changes. Existing query filters are preserved. Regression checks exercise the actual loader with mocked Supabase results, including reversed response order and failed reads. Hands-on smoke testing remains deferred.
