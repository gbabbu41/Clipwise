# Session 16 — notes (2026-06-12)

Continuation of the ClipWise work. Latest detailed log (this file) supersedes
SESSION-14 as the most recent. Cross-machine memory lives in the repo only.

## What shipped this session (all DEPLOYED to `main` → clipwise.ca)

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
