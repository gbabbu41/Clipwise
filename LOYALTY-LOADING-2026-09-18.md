# Loyalty-page read reliability

Client/promo read errors now produce a retryable error instead of false empty lists or stale rows. Only the latest request for the active shop can publish data or clear loading. Old callbacks cannot restart previous-shop requests; unmount invalidates pending loads. Old location content is hidden before effects run, and switching shops resets point/promo editors and hydrates settings using that shop's values or the existing defaults.

Optional appointment/transaction history failures no longer feed empty arrays into client aggregation. Confirmed point balances and promos remain available, but visits and last-visit values show unavailable with a retry action. Successful reads keep the existing identity aggregation.

No changes to earning/redemption math, plan gates, database schema, settings-write semantics or the calendar. The separate accounting/concurrency findings remain open. Tests exercise the actual loader using mocked Supabase responses, including reversed request completion and optional-read failures. No live data writes or hands-on smoke tests.
