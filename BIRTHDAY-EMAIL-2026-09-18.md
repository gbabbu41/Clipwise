# Birthday email boundary

The generic email endpoint accepted anonymous birthday-template sends with arbitrary recipient and shop branding. This is a source-confirmed authorization gap, not an observed customer incident.

Manual birthday sends now require a verified bearer token and ownership of the requested shop through the existing authorization helper. The recipient must match a shop-scoped saved client, appointment customer or POS customer. The latter two preserve the Clients directory's synthetic profiles. Template recipient/name and shop branding are rebuilt from stored records; failed recipient reads stop sending. The reminder cron still calls the shared email engine directly, unchanged.

The Clients button forwards the token/shop, prevents overlapping requests and clears loading after failures. Uncertain delivery is not automatically retried. This is not provider-level idempotency.

Verification: actual route and authorization-helper tests with mocked database/email boundaries cover anonymous/invalid tokens, foreign owners/customer/barber actors, each recipient source, missing clients, failed reads, canonical branding, wildcard exact checks and server-only billing denial. Extracted browser-handler tests cover token/payload, duplicate clicks and network/auth failure recovery. Full flow suite, targeted lint and production build are required before push. No live messages, production writes, schema changes or browser smoke tests.

Remaining audit: other email types have role-only or public HTTP gates. Review their callers individually; this fix does not claim to secure the entire email boundary.
