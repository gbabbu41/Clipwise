# Browser review email authorization

Reproduced against the actual generic email handler with mocks: a foreign barber role could send review_request to an arbitrary email with an attacker URL; response 200, only users role queried. No real message or historical incident is claimed.

The review branch now requires a valid appointment UUID and verified account, reads canonical appointment/shop data, and enforces owner OR active same-shop barber with manage_appointments. This mirrors protected appointments/update, appointments/collect-balance, capture-appointment and loyalty/award endpoints. The existing generic-email super_admin exception remains, based only on the saved verified user role, with canonical data required. The director explicitly approved this documented policy mapping; no new admin privilege or status/timing policy was introduced.

Recipient/name/service/barber/shop branding and review URL are server-derived; the URL uses existing NEXT_PUBLIC_APP_URL/fallback. Submitted role, recipient, shop and URL cannot override them. Missing/malformed/foreign references and failed prerequisite reads send nothing. A shared secret alone cannot bypass this browser-resource gate. Cron and completion-server already call the internal sender directly and remain unchanged. Both existing browser callers already provide appointmentId; no payload migration or UI edits were needed.

Preserved existing review eligibility, timing, prior-stamp policy, templates and already-reviewed suppression. No appointment state writes, backfill/replay, send retries, schema/dependency changes or exactly-once claim. Inline Appointments still lacks its own sent timestamp/guard; generic review send does not add one as an incidental authorization change.

Actual-route tests load the real authorizeShop helper and cover allowed owner/permitted barber/verified admin, foreign owner/barber, inactive/missing-permission barber, forged role/payload, missing/expired token, no shared-secret bypass, missing/unknown/malformed appointments, absent recipient, failed profile/appointment/shop/barber/auth reads and canonical configured/fallback links. No live messages/database writes.

Verification: focused tests, sibling birthday/direct-message regression, clean targeted lint, whitespace checks, full combined flow suite and real production build passed (202 pages, dummy credentials; expected dummy-backend plans warning). Repository security and Supabase guidance informed server-side ownership, selected canonical fields and fail-closed read handling.
