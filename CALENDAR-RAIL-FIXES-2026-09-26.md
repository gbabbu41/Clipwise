# Calendar rail fixes — September 26, 2026

User-approved scoped fixes; no architecture, schema, dependency, pricing or portal redesign.

## Completed

- Preserve the 7 AM top cap and midnight bottom. Earlier visible appointments, shifts, timed blocks, breaks and undismissed/unrebooked cancelled/no-show reminders extend the top to their containing hour. Empty pre-dawn time and full-day-off shading alone do not extend it.
- Initial positioning and the Now button share the actual rail's start/end geometry. Today still lands at current shop-local time; other dates land at 7 AM or the earliest earlier item. One-shot autofocus and user takeover remain unchanged.
- Quick-add disables service choices that finish after midnight, including while availability is loading. The in-person API independently rejects a next-day tail using authoritative service duration before conflict resolution/writes; ending exactly at midnight remains allowed. Known rejection feedback remains retryable rather than an uncertain-save warning. This prevents this newly exposed path, not a claim that all legacy overnight data/other write endpoints have been repaired.

## Verification

- Expanded the existing flow regression with actual grid-selector, slot-selector and API-boundary code: 7 AM default, early items, hidden reminders, unrelated barber, full-day shading, exact-midnight fit and overnight rejection.
- Full automated flow suite passes after incorporating eleven concurrent main commits, including cached calendar rendering, font self-hosting, transparent tap targets and keyboard-aware add-sheet changes.
- Final production build passed (202 pages) using dummy credentials, not live customer data; the dummy plans fetch warning is expected. The library/API lint passed. Existing lint debt remains in the calendar/add-form components; unrelated unused symbols and hook warnings were not redesigned as part of this fix.
- No live bookings, payments, messages, database mutations or browser smoke tests performed. iPhone PWA behavior still needs hands-on confirmation in the final smoke phase.
