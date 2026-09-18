# Quick-add appointment prerequisite recovery

The actual loading effect reproduced service/barber/client query failures as empty lists, with no retry and no cleanup protection for late responses. The sheet could attempt submission before its prerequisites were confirmed.

The sheet now publishes required datasets together only on successful non-null reads, shows loading/error/retry states, and blocks Add in UI and handler until the current opening/scope is ready. Every open clears readiness before opening. Same-scope retries preserve the draft; a shop/locked-barber/acting-user scope change closes and resets it. Cleanup/current-scope checks ignore late reads. Missing shop shows an explicit message. Confirmed empty datasets retain existing empty states. Existing RLS scopes, field selections, 500-client limit, locked barber, own-barber default and manual selections are preserved.

Actual-effect/handler tests cover errors/null/offline recovery, scoped empty/success lists, preferred/manual/locked selections, close/scope cleanup, opening readiness, missing shop and direct-submit blocking. Booking payloads, availability/override policy, confirmation handling and write/retry semantics remain unchanged. Uncertain submit responses and duplicate-submit recovery need a separate reproduced batch. No live appointments/messages were created.

Targeted lint remains one pre-existing unused selectedClientId error and two pre-existing shop hook-dependency warnings. ESLint HEAD lintText and modified lintFiles rule/severity/message arrays match exactly. No new diagnostics; lint is not clean. Full flow suite/build and push evidence recorded in the engineering handoff and parent audit log.
