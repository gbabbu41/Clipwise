# Manual loyalty form reliability

The Loyalty & Promos add/redeem forms now retain drafts after rejected saves, prevent overlapping submissions, require positive whole-number inputs, and update displayed balances only from a valid success response. Requests and successful feedback retain the current shop, client, point amounts and redemption-value calculation.

Network failures, server failures and malformed success responses have uncertain outcomes: submission is disabled with instructions to reload and inspect the balance before trying again. No automatic retry is added. A response from a different active shop cannot update the current client list.

This is UI protection, not server-side idempotency or an atomic ledger fix. The separately logged concurrent balance/award problems remain open. The Clients page has another manual-points path, with separate behavior; it is not silently migrated or claimed fixed here.

Verification: actual-handler mocked tests cover add/redeem success, rejected drafts, malformed/offline/server failures, input/auth/shop guards, duplicate clicks and location switches. No live points were changed; manual smoke testing remains deferred.
