# Session 16 — notes (2026-06-12)

Continuation of the ClipWise work. Latest detailed log (this file) supersedes
SESSION-14 as the most recent. Cross-machine memory lives in the repo only.

## What shipped this session (all DEPLOYED to `main` → clipwise.ca)

### LATEST (2026-06-15) — Calendar redesign: light "Fresha-style" canvas
- The **calendar page only** (`dashboard/calendar/page.tsx`) is now a LIGHT canvas
  inside the app's dark chrome (Option A). Sidebar/top-bar stay dark; the grid,
  toolbar, legend, month/week/day views are white with Fresha-style soft pastel
  appointment blocks (pale fill + colored left edge + dark text).
- Kept ALL existing functionality (month/week/day, per-barber day columns,
  duration-as-height blocks, current-time line, detail modal + Approve/Complete/
  Reject actions, agenda side-sheet, barber filter). Pure theming + a Fresha touch:
  initials **avatars** in the day-view column headers.
- Modals (`ApptDetail`, `AgendaSheet`) and the toast stay DARK **on purpose** as
  overlays — avoids re-skinning the dark-tuned Button/Badge/inputs. Three light
  palettes: `statusBlock` (day/week grid), `statusChip` (month), `statusFill`
  (kept, used only by the dark agenda chip).
- Rest of the app is untouched and still dark. If we later want the modals light
  too, that's a follow-up (would need light Button/Badge variants).

### (2026-06-15) — No-show auto-charge + weekday notification context- **Notifications now carry day-context** (`prettyDateWithContext` in `utils.ts`):
  "Today · June 15" / "Tomorrow · June 16" / "Wednesday · June 17" (weekday for
  dates within a week) / bare "June 27" beyond. "Today" anchored to Eastern time,
  not the UTC server clock, so the boundary matches a Canadian shop's real day.
  Used by `api/appointments/notify-staff`.
- **Marking a no-show now AUTO-CHARGES the no-show fee** when a card is on file.
  Root cause of "marked no-show but card wasn't charged / no transaction / no
  receipt": the "Mark as No-Show" button only called `updateStatus(...,"no-show")`
  — the charge required a *separate* manual "Charge No-Show" click. Fix mirrors
  the Complete auto-charge: `handleStatusChange` routes no-show with held/saved
  card → new `captureNoShowAndMark` → `capture-appointment` (which already records
  a transaction + emails the customer a `payment_receipt`). The no-show is always
  flagged even if the card declines (server sets `payment_status="failed"`, manual
  **Retry No-Show Charge** button then shows).
  - `noShowFeeFor()` shows the real configured fee (capped at total) in the button
    labels/confirm instead of always the full price.
  - `capture-appointment` `isSaved` now also covers retry-after-failure for saved
    cards (status flipped to "failed" but `stripe_payment_method_id` still on file).
  - **Caution modal before charging**: marking a no-show on a card-on-file now opens
    a styled confirm dialog (mirrors the refund modal) showing the exact fee that
    will hit the customer's card before anything is charged — no silent auto-charge.
    One `noShowModal` with mode "mark" (charge + flag) vs "charge" (manual/retry,
    charge only); both the "Mark as No-Show" and "Charge/Retry No-Show" buttons route
    through it. Replaced the old `window.confirm` in `chargeNoShow`.


All commits authored `Claude <noreply@anthropic.com>` and show **verified** on
GitHub via the Claude app (the local stop-hook "unverified" warning is a
false positive — it only checks for a local GPG signature, which we don't add;
do NOT amend already-pushed commits to satisfy it).

### 1. Admin-editable pricing plans — commit `7027060`
Single source of truth for pricing + feature gating. Replaced 4 inconsistent
hardcoded price lists. Details already in CLAUDE.md "Current status (Session 15)".
- Migration `phase9_pricing_plans.sql` — **RUN by owner.** `plans` table, RLS
  (public reads active, super_admin writes), seeds starter/pro/premium (+business
  inactive), drops the `shops.subscription_plan` CHECK.
- Key files: `lib/plans.ts`, `lib/plans-server.ts` (60s cache + `ensurePlansHydrated`),
  `api/plans` (public), `api/admin/plans` (super_admin CRUD), editor at
  **Admin → Settings → Subscription Plans**. `lib/validation.ts` gating is now
  DB-hydrated with safe hardcoded defaults.

### 2. Onboarding race fix — commit `7180068`
Bug: every new shop signup landed on "No shop found → Set Up My Shop" and needed
a manual refresh (reported via a re-signup, but it affected ALL new signups).
Root cause: onboarding inserts the shop directly via the browser Supabase client
but never told `AuthProvider`, so `/dashboard` saw `shop=null`.
Fix: onboarding `await refreshShop()` before navigating; dashboard layout does a
defensive one-shot `refreshShop()` (spinner, not the no-shop page) when a
shop_owner has a null shop.

### 3. Code-review fixes #1–#3 — commit `2cc263f`
From the `/code-review` of the AI-generated code (see backlog below). Pure code,
no migration needed:
- **#1 "Any Available" overbooking** — `lib/booking-conflict.findAvailableBarber()`;
  `booking-checkout` resolves "Any" to a concrete free barber server-side so the
  DB unique index protects it (a null barber_id previously bypassed every guard).
- **#2 duration-aware double-booking** — `barberHasConflict()` compares
  `[start, start+serviceDuration)` against existing appts' intervals (joined service
  duration). Wired into booking-checkout (pre-pay), booking-finalize (re-check +
  reverse the charge on conflict), the in-person client pre-check, and the customer
  slot grid (`utils.occupiedSlots` marks every occupied slot booked, not just start).
- **#3 webhook capture guard** — `payment_intent.succeeded` only promotes
  `unpaid/held/failed` → `paid`, so a captured no-show fee (`captured`) isn't clobbered.

## Deploy / infra notes
- Pushes go to `main` → Vercel auto-deploys clipwise.ca (~1–2 min). The managed
  git proxy (`local_proxy@127.0.0.1`) **403s** in web sessions; pushing required a
  user-provided GitHub PAT pushed directly to `github.com`. ⚠️ That token was
  pasted in chat — owner should revoke/rotate it.
- Build locally with dummy env (container has no `.env.local`):
  `SKIP_ENV_VALIDATION=1 NEXT_PUBLIC_SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=…
   STRIPE_SECRET_KEY=… RESEND_API_KEY=… TWILIO_* … npx next build`. Without env, the
  build dies at page-data collection on `supabase-admin`/Resend module load (not a
  code error). `[plans-server] fetch failed` during static gen is expected + handled.

## Code-review backlog (open items)
The remaining verified findings (#4–#13) + the two booking follow-ups are tracked
in `TODO.md` §2b with file:line and proposed fixes. Recommended next batch:
1. Race-proof double-booking via a Postgres exclusion constraint (DB-level guarantee).
2. Multi-service ONLINE booking (charges full total, books only the primary service).
Then the payments cluster (refund correctness, POS discount, sub double-bill,
checkout price fallback) and auth cluster (barber link, multi-shop active-shop
reset, OAuth routing, rejected dead-end).

### 4. Plan-gating hardening — commits `706639d`, `9c81844` (DEPLOYED)
Owner reported a starter/free shop could reach premium features. Two real holes,
both pre-existing but surfaced once the onboarding fix let new signups actually
reach the dashboard:

- **Page-level gates** (`706639d`) — POS, Inventory, Gift Cards, Payments only
  relied on the sidebar HIDING their nav link; a direct URL still worked (and
  Inventory has no server route — writes go straight to Supabase under the
  owner's own RLS). Added a shared `components/dashboard/feature-lock.tsx`
  `<FeatureLock>` screen + a page-level `planHasFeature(effectivePlan(...))`
  check on each, mirroring the existing loyalty/payroll gates.
- **Booking UI = pay-in-person-only for non-charging plans** (`9c81844`) — the
  customer booking page (`book/[shopslug]`) computed `canPayOnline` from
  `total>0` alone, so a Starter shop's page offered "Pay online (Stripe)",
  deposits, and card-hold no-show even though `booking-checkout` 403s them. Now
  gated on `shopCanCharge = planHasFeature(effectivePlan(shop plan/status),
  "payments")` (same check the server uses; shop row is fetched `select("*")` so
  it includes subscription_plan/status). Starter → only "Pay in person" (forced
  available so paid services stay bookable); deposits + card-hold also gated off.

⚠️ **Data caveat (the master switch):** all gating honors the `plans` table. If
the **Starter** plan row has the `payments` feature (or any premium feature)
ticked in Admin → Settings, those features are INTENTIONALLY unlocked — even with
the gates. Verify Starter has no feature toggles ticked (instant fix, no deploy).

Note: Analytics/Marketing/Clients/Staff/Services are NOT feature-gated by design
(available on every plan). Inventory/POS page gates are client-side; truly
server-enforcing them (beyond payment/loyalty routes which already are) is a
follow-up — see TODO §2b.

### 5. Calendar + Staff/Onboarding UX (2026-06-13, all DEPLOYED)
Owner-requested polish, each its own commit:

- **Calendar status colors** (`48d07a0`) — appointment blocks are now colored by
  STATUS (Booked/Pending/Completed/Cancelled/No-show) across month/week/day,
  with a status legend; month view shows ALL statuses (was hiding cancelled),
  bigger day cells (up to 4 blocks), and the tapped detail card + agenda rows
  now show the client **email**. Removed the now-unused barber-colour palette
  (barber identity still in day-view column headers + detail card).
- **Calendar "filter by barber"** (`4368d4e`) — dropdown on the right of the
  toolbar, shown only for owners with >1 barber; scopes the load query + the
  day-view columns to the chosen barber.
- **Onboarding "Add barbers" step** (`3399cae`) — "Add yourself as a barber"
  (instant self-link) vs "Add someone else" (email invite); multi-add with
  You/Invited tags; owner email blocked in the invite path; "Skip for now";
  honors the plan barber limit; hours step now applies to every added barber.
  Reuses `/api/admin/barber/invite` (owner-self path links user_id). No RLS change.
- **Staff "+ Add myself as a barber"** (`3399cae`) — header button shown only
  when the owner isn't already on the team (by linked user_id or email).
- **Owner's own barber card** (`3e26040`) — shows an "Owner" tag; hides
  Permissions + Reset Password/Resend (owner manages their own access). Set
  Schedule + Remove stay. `isOwnerBarber` = linked user_id OR account-email match.
- **Reset-password email** (`c7c60bc`) — Reset Password (non-owner barbers) now
  also emails the recovery link to the barber's login email (new
  `barber_password_reset` template) in addition to the copy/paste modal link.
  Best-effort; Resend is still on sandbox so the copy/paste link is the reliable
  fallback until a verified domain is set up.

Tip for the next session: the dummy-env build command + git-proxy-403→PAT
workflow from the top of this file still apply. The "unverified" stop-hook
warning remains a false positive (GitHub shows the commits verified via the
Claude app).

## Appointments / Payments / Calendar batch (2026-06-14, DEPLOYED)

A numbered fix list for the Appointments, Payments and Calendar pages —
constraint was "don't break the UI, keep buttons small, no layout changes".
Commits `a6ce40e`, `c616849`, `53f68e2`, `328fa40`, `1ab991f`, `7c825cc`.

- **#1 Auto-confirm in-person** — booking page re-reads `shops.booking_settings`
  fresh at submit (in-memory copy could be stale); Settings save now surfaces
  real errors instead of silently falling back to localStorage.
- **#2 Pay-in-person → link paid → auto-confirm** — `markAppointmentPaid`
  (customer-return path) sets `status: confirmed` when pending; the webhook
  `post_booking_payment` branch now does the same, status-scoped `.eq("status",
  "pending")` so completed/cancelled rows are never regressed.
- **#4 Send-link email from Appointments side card** — was doing an RLS-bound
  client `client_email` update then NOT passing `email` to the route; now passes
  `email` straight through (route persists via service role + sends), matching
  the Payments tab that always worked. Same fix in the Calendar send-link.
- **#5 Calendar payment sync** — Calendar reconciles on load via
  `/api/stripe/reconcile-payments` (same as Appointments + Payments).
- **#6 "Paid · 10 min ago"** — new `appointments.paid_at` (⚠️ phase13 SQL) set
  wherever we flip to paid/captured (online, link, capture, cash, no-show,
  webhook, refresh). New `timeAgo()` util; shown on Payments rows, Appointments
  side card payment row, Calendar detail card.
- **#7 Multi-service = ONE appointment** — was one row per service at back-to-back
  slots; now a single combined booking. New `appointments.duration_minutes`
  (⚠️ phase14 SQL) holds the summed length (primary service stays `service_id`,
  full list in notes). Online path forwards `duration_minutes`/`service_names`
  via checkout metadata → booking-finalize. Duration-aware everywhere:
  `booking-conflict.ts`, the booking slot grid, Calendar block heights + detail,
  Appointments badges — all via a `duration_minutes ?? services.duration_minutes`
  helper.
- **#8 Duration badges** — Appointments mobile card / desktop table / side panel
  show "· 50 min".
- **#9 Calendar Approve/Complete/Reject** — the Calendar detail card now has the
  same small action buttons as the Appointments page (held/saved auto-charge on
  Complete; unpaid → Cash/Send-link/Skip; reject-with-refund). Shared logic in
  new `src/lib/appointment-actions.ts` so both surfaces stay in sync.
- **#11 Payment notification + chime** — root cause was `notifications` never
  being in the `supabase_realtime` publication (phase12, owner ran). All payment
  paths already insert a notification; they now deliver live + auto-dismiss.
- **#12 Calendar in mobile/tablet bottom nav** — added next to Appointments.

⚠️ **Owner still needs to run** `phase13_appointment_paid_at.sql` and
`phase14_appointment_duration.sql` in Supabase (phase12 already run). Until
then: paid-time labels are blank and multi-service duration falls back to the
primary service only (booking still works).

## Booking availability + slot-granularity fixes (2026-06-14 continued, DEPLOYED)

Commits `8d1f70f`, `b0fe851`, `5b3942c`, `f05a7bc`.

### Critical RLS gap — customer booking page was double-booking
**Root cause:** The `appointments` (and `time_off_requests`) tables have
stakeholder-only SELECT policies (shop owner + assigned barber). The anonymous
customer booking page had NO matching policy, so every Supabase query returned
zero rows — every slot looked free regardless of what was booked.

**Fix — server-side availability route** (`src/app/api/availability/route.ts`):
- Uses `supabaseAdmin` (service role, bypasses RLS)
- Returns per-barber scheduling data only: `{ id, name, start_time, end_time,
  fullDayOff, busy: [{time_slot, duration}], blocked: [{start_time, end_time}] }`
- No customer PII in the response
- Resilient to `duration_minutes` column not existing (retries without it)

**Fix — server-side in-person booking** (`src/app/api/book/in-person/route.ts`):
- Conflict check via service role (not RLS-blind anon client)
- "Any Available" resolved server-side via `findAvailableBarber()`
- DB unique index backstops exact-slot races
- Returns `{ id, status, barber_id }` — no RLS-blocked `.select()` footgun

Both the load paths (`loadTimeFirstSlots`, `loadBarberFirstSlots`) and the confirm
path in `src/app/book/[shopslug]/page.tsx` now call these routes instead of
querying Supabase directly. Dead anon owner-notification insert also removed (was
silently failing RLS; `notify-staff` handles both via service role now).

### Slot occupancy rewrite — overlap-based, not index-based
`utils.ts` → `occupiedSlots(startSlot, durationMin, intervalMin = 30)` was
previously stepping by 30-min indices. Rewrote to half-open interval overlap:
blocks every slot `m` where `m >= startMin && m < endMin`. This correctly handles
45-min bookings (9am+45 = 9:45 end → blocks 9:00, 9:15, 9:30 for 15-min grids;
blocks 9:00, 9:30 for 30-min grids). Also parameterized `generate24hSlots()` and
`getSlotsInRange()` to accept `intervalMin` so 15-min grids are consistent end-to-end.

### Appointments list sort fix — `8d1f70f`
Appointments page was sorting by `time_slot` as text ("12:00 PM" < "9:00 AM"
lexicographically). Fixed: sort by `timeToMinutes(a.time_slot)`, then by date.

### Quarter-hour scheduling — `f05a7bc`
`booking_settings.slot_interval_minutes` (30 or 15) is now the single source of
truth for slot granularity across the entire stack:
- **Staff → Set Schedule modal**: "Time increments" toggle (30 min / 15 min)
  appears at the top of the modal; choosing 15-min immediately persists to
  `booking_settings` and regenerates the start/end time dropdowns to include
  :00, :15, :30, :45 options (so a barber can start at e.g. 9:45 AM).
  `changeInterval()` calls `refreshShop()` after saving so the owner UI updates.
- **Customer booking grid**: reads `slot_interval_minutes` from the shop row via
  `slotIntervalOf(shop)` → passes to `generate24hSlots(interval)` and
  `occupiedSlots(..., interval)`. 15-min shops show 9:00, 9:15, 9:30, 9:45...
- **`booking-conflict.ts`** resilience: if `duration_minutes` column doesn't exist
  yet (phase14 not run), `barberIntervals` retries the query without the column
  rather than failing — conflict detection is never silently disabled.
- **Settings page**: removed the duplicate "Booking time slots" control (moved
  authoritatively to Set Schedule under Staff).

### booking-conflict.ts resilience note
`barberIntervals()` was rewritten to try the `duration_minutes`-inclusive query
first; on error (column missing), retries without it. This means phase14 migration
is safe to run any time — the server never silently loses conflict detection while
the column is absent.

### Pending SQL (unchanged from above)
Phase13 (`paid_at` column) and Phase14 (`duration_minutes` column) still need to
be run in Supabase SQL Editor. Phase12 was already run.

---

## Code-review fixes — commit `3ab8ea4` (2026-06-15, DEPLOYED)

All 10 findings from the `/code-review` audit fixed in one commit. Files touched:
`api/cron/no-show`, `api/availability`, `api/stripe/booking-checkout`,
`api/stripe/booking-finalize`, `api/stripe/payment-link-finalize`,
`api/webhooks/stripe`, `book/[shopslug]/page.tsx`, `lib/booking-conflict.ts`.

**Finding 1 — no-show cron: stuck 'capturing' rows never retried**
`src/app/api/cron/no-show/route.ts` catch block was setting `payment_status: "failed"`
permanently. Changed to reset to `a.payment_status` (original 'held' or 'saved') so
the next cron run picks it up and retries. The existing `notifyChargeFailed` call
already alerts the owner — no separate change needed for Finding 10.

**Finding 2 — availability: broad error swallow hid real DB errors**
`src/app/api/availability/route.ts` fallback query ran for ANY error, making all
slots look free on network/RLS failures. Narrowed to only fall back when
`error.message.includes("duration_minutes")`; all other errors now return 500.

**Finding 3 — payment-link-finalize: 'captured' not guarded**
Early-return guard only checked `=== "paid"`. A captured no-show appointment could
be overwritten. Added `|| appt.payment_status === "captured"` to the guard.

**Finding 4 — booking-checkout: platform-charge fallback removed in test mode**
`STRIPE_LIVE_MODE` guard was dropped, making all non-Connect shops return 409 even
in sandbox. Restored: `if (!useConnect && STRIPE_LIVE_MODE)` — test shops can still
book online without completing KYC.

**Finding 5 — availability: null barber_id time-off silently discarded**
Shop-wide closures stored with `barber_id = null` were silently dropped (null key
never matched any barber). Fixed: when `barber_id === null`, apply the time-off to
every active barber via a helper `applyOff()` extracted from the loop.

**Finding 6 — booking-finalize: "payment reversed" message on saved-card path**
Conflict-return error message said "Your payment was reversed" even for setup-mode
(saved-card) bookings where nothing was charged. Now conditional on `isSave`:
saved-card path says "Please pick another slot." without the reversal claim.

**Finding 7 — booking page: slotsNeeded=1 when all services have null duration**
`totalDuration` accumulated `s.duration_minutes ?? 0`, so all-null-duration services
summed to 0, and `slotsNeeded` fell back to 1 slot for any multi-service booking.
Changed default to `?? 30` (30 min per service, matching the server-side fallback in
`durationOf()`). Display also improved: shows "30 min" instead of "0 min".

**Finding 8 — booking-conflict: O(n) sequential queries in findAvailableBarber**
`findAvailableBarber` called `barberHasConflict` (→ DB query) per barber in a
sequential loop. Rewritten to fetch all barbers' appointments in one `IN` query,
then group intervals in memory. Same resilience logic for pre-phase14 fallback.

**Finding 9 — webhook: 'saved' missing from payment_intent.succeeded allowlist**
`payment_intent.succeeded` allowlist was `["unpaid", "held", "failed"]`. A
saved-card booking charged off-session fires this event but wouldn't be promoted to
'paid'. Added `"saved"` to the list.

**Finding 10 — no-show cron: owner not alerted on stuck charge**
Already covered by Finding 1: the existing `notifyChargeFailed` call fires on every
catch regardless of the status reset. No separate change needed.

---

## Human-readable dates everywhere (2026-06-15, DEPLOYED)

Owner ask: dates were showing as raw "2026-07-14" in emails, SMS, in-app
notifications, pop-ups, and dashboard lists — wanted "easy to read" month-name
format ("July 14").

**New helper — `prettyDate()` in `src/lib/utils.ts`:**
"2026-07-14" → "July 14" (adds the year only when it isn't the current year).
- **Timezone-safe for SERVER use** (the key reason it's a new helper, not
  `friendlyDate`): parses the date-only string at local midnight and NEVER uses
  Today/Tomorrow relativity, so a UTC server (Vercel) can't mislabel a date near
  the day boundary — same concern `booking-finalize` documented inline.
- **Idempotent**: any input that isn't a plain "YYYY-MM-DD" (already-formatted
  strings, ranges, empty/null) is returned unchanged — safe to apply at both the
  producer AND the email-route chokepoint without double-formatting.

**Single chokepoint for ALL emails:** `src/app/api/send-email/route.ts` now does
`if (data?.date) data.date = prettyDate(data.date)` once, right after parsing the
body — every template + subject reads `data.date`, so this covers all of them.

**Formatted at the source (notifications / SMS / pop-ups):** `prettyDate` applied
in `payment-notify` (notifyNoShowCharged msg), `notify-staff`, `booking-finalize`
(owner notif), `cron/no-show` (SMS), `capture-appointment` (SMS), `reminders`
(SMS), `appointment-actions` (SMS), `dashboard/appointments` + `barber-dashboard/
schedule` (confirm SMS), `my-booking` + `my-bookings` (cancellation notif), and
the time-off routes `submit`/`decide`/`cancel`/`exclude-date` (dateRange — note:
`dateRange` is NOT covered by the email chokepoint since it's a composite string,
so each route formats its own start/end via prettyDate). Pop-ups need no separate
work — `NotificationListener` renders the stored notification `message`, which is
now formatted at insert time.

**Dashboard/customer list displays → `prettyDate`** (absolute, audit-friendly):
`payments`, `payroll`, `staff` (timesheet), `clients` history, `my-bookings`,
`my-booking`, booking `review` page, and the appointments clash toast.

**`/code-review` follow-ups applied** (after the first pass used `friendlyDate`):
- **Incomplete-fix bug**: the customer's OWN booking-confirmation SMS in
  `book/[shopslug]/page.tsx` still sent the raw `dateStr` — the highest-visibility
  text in the app. Now `prettyDate(formatDateForDb(selectedDate))`.
- **Records/historical views**: switched from `friendlyDate` (relative
  "Yesterday"/"Last Monday", and viewer-timezone drift) to absolute `prettyDate`
  so payroll/payments/timesheet/visit-history/review read as fixed calendar dates
  and match the owner's "14 july" request exactly.
- **Consistency**: `exclude-date` time-off route had its own bespoke
  "Tuesday, July 14, 2026" formatter — unified to `prettyDate` like its siblings.

Build: `next build` compiles + type-checks clean (only the pre-existing
container `supabaseUrl is required` page-data error, which needs env vars).
