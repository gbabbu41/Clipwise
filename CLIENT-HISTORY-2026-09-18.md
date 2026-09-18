# Client profile history reliability

Opening a profile now clears the previous client's history and shows loading. Only the latest profile-history request for the current shop can display results. Shop changes hide/reset the profile; effect cleanup invalidates pending history loads.

Failed reads show a retryable error, not a false empty or partial history. Retrying history does not reset unsaved notes, hair-profile fields or the selected tab. Existing identity matching, sorting, deduplication, query scope and result limits remain unchanged.

Mocked tests execute the actual handler to cover reversed responses, read failures, retries, offline errors and shop/unmount guards. No appointments, client records or live messages were changed for testing.
