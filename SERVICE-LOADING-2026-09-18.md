# Services list read reliability

The prior loader treated failed reads as an empty menu on first load, left old shop rows on screen after a location change, and allowed an older request to replace newer results. A thrown read also left loading stuck.

The loader now reports persistent generic errors with Retry, accepts empty lists only after a successful read, and checks request order plus current shop before applying responses. Stale callbacks cannot start a previous shop reload; cleanup invalidates outstanding reads. Location changes hide previous content immediately and clear old editors, template selections and deletion confirmations. List-dependent actions wait for a successful current-shop read. Same-shop retries preserve existing editor drafts.

Actual-handler regressions cover rejected/missing/offline reads, retry, valid empty results, reversed shop and same-shop responses, old callbacks, cleanup and missing shop. No production records are read or modified by these tests. Service prices, scheduling, deletion rules and business logic are unchanged. Validation and push status are recorded in the parent audit log.
