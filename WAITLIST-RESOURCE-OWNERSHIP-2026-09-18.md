# Waitlist assignment resource ownership

The smart-waitlist acceptance and walk-in seating routes authenticated the caller against the queue's shop, but did not independently bind the selected barber and service to that shop. Service-role inserts could therefore reference foreign-shop resources at the application layer. A mocked actual-handler regression reproduced acceptance of a foreign barber before the fix (HTTP 200 instead of rejection). Live database constraints were not inspected; no production exploit was attempted.

Both routes now verify the selected barber with an ID + shop filter before conflict checks or writes. Supplied or queue-default service IDs receive the same shop-scoped check. Missing/foreign records return a generic 400; database read errors return a generic 503 rather than proceeding with fallback pricing. Walk-in confirmation uses the already-verified barber name.

Preserved: existing owner/active-staff authorization, walk-in staff self-assignment restriction, the distinct smart-waitlist assignment policy, manual smart-waitlist duration/amount overrides, service defaults and service-less appointments, appointment inserts/conflict checks, status transitions and notifications. No active-resource policy was added; this batch is ownership isolation, not a change to which same-shop records staff may use.

Verification: actual handlers with filtered database fixtures cover both routes, owner/staff success, foreign and missing barbers/services, bad stored service references, failed reads before effects, unauthenticated/foreign callers, default values, manual overrides and existing assignment rules. The prior confirmation-email regression is retained. Full flow suite, targeted lint and production build with dummy credentials required before push. No schema changes, dependencies, real messages, customer transactions or browser smoke tests.

Remaining: booking creation and queue conversion are separate writes; this batch does not make them atomic or prevent simultaneous conversions into different slots. Input normalization, read failures outside the resource checks, and public notification authorization remain separately scoped audit work.
