# Calendar quick-setup hours request isolation

Held-request regression reproduced two simultaneous hours-save workflows. Another regression changes shop or unmounts the form during each awaited phase to check for unintended follow-on writes and callbacks.

The hours handler now shares the synchronous save guard and scope/cleanup checks used by location saves. One pending workflow may run per sheet. After a team read, owner-chair response or deletion, an obsolete scope stops before subsequent writes. A late insert cannot trigger refresh/close on a newer sheet. Loading is released on active-scope failure; pending dismissal/editing remain blocked by the prior sheet controls.

Tests cover overlapping workflows, successful payload sequencing, shop change/unmount during reads, invitation, deletion and insertion. The existing prerequisite regression remains in the flow suite with the new guard fixture. This cannot cancel a write already sent and does not roll back earlier changes. No automatic retry, idempotency redesign, schema or schedule-rule change. Non-atomic replacement remains unresolved. No live data/messages were used; full check evidence and commits recorded in the engineering handoff/audit log.
