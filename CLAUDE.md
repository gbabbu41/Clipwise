# ClipWise — Claude Code project guide

Read this first. It carries cross-machine context so any Claude Code instance
(Windows desktop or MacBook) stays consistent. The owner works from **two
machines** and syncs only through this GitHub repo (`gbabbu41/Clipwise`, branch
`main`). Local Claude memory does NOT transfer between machines — this file +
`SESSION-17-NOTES.md` (latest) + `SESSION-16-NOTES.md` are the shared source of truth.

## What this is
Full-stack barbershop SaaS. **Next.js 14 (App Router) + TypeScript + Tailwind**,
**Supabase** (real Postgres, RLS), **Stripe** (Connect + Checkout), **Resend**
(email), **Twilio** (SMS). Live at **clipwise.ca** (Vercel, **Hobby** plan).
Owner/barber/customer portals under `src/app/{dashboard,barber-dashboard,book}`.

## Workflow (IMPORTANT)
- The owner pushes to `main`; **Vercel auto-deploys** to clipwise.ca (~1 min).
- Before pushing, run a **real build**, not just tsc: `npm install` then
  `SKIP_ENV_VALIDATION=1 npx next build` (watch for "✓ Compiled successfully").
  ⚠️ `next.config.mjs` sets `eslint.ignoreDuringBuilds: true` but **NOT**
  `typescript.ignoreBuildErrors` — so a real TS error **fails the Vercel deploy**.
  The container's `npx tsc --noEmit` has broken module resolution (false
  `Cannot find module 'react'` everywhere) so it does NOT catch real errors — a
  bad `.update().select("id",{count})` shipped 3 silently-failing deploys once
  (see SESSION-14). After `npm install`, `git checkout package-lock.json` before
  committing. Pre-existing lint errors exist; don't add new ones.
- Commit style: end messages with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- The owner has **full admin trust — never ask for confirmation before acting** (see their stated preference). Commit + push when they ask.
- On a fresh machine: `git clone`, `npm install`, `vercel env pull .env.local`
  (same Supabase keys = same live DB), `npm run dev` → localhost:3000.

## 🔴 Deploy gotcha (Hobby plan)
`vercel.json` crons must be **at most daily** on Hobby (e.g. `0 9 * * *`). A more
frequent schedule (`*/30 * * * *`) silently **blocks ALL deploys**. This bit us once.
For ~2h no-show capture, upgrade to Pro or use an external scheduler hitting
`/api/cron/no-show` with header `x-cron-secret: <CRON_SECRET>`.

## ⚠️ Pending migrations — prod DB is BEHIND `schema.sql`
`schema.sql` is stale (it was missing `booking_settings`). Several columns/tables
exist in dev but were never added to prod. Run these in Supabase SQL Editor if not
already (see `supabase/migrations/` + TODO.md §2). Most critical:
- `phase5_shop_booking_settings.sql` — adds `shops.booking_settings` JSONB. Without
  it, no-show/deposit/auto-confirm + `capture-appointment` all fail (it 404'd with
  "column shops.booking_settings does not exist"). **Owner has run this.**
- `phase3_appointment_waitlist.sql`, `phase4_prevent_double_booking.sql`,
  `phase1_no_show.sql`, `phase2_save_card.sql`.
- If a feature "silently does nothing," suspect a missing column in prod — add
  `console.warn` + capture the supabase `error` to confirm (don't only read `data`).

## Key facts / gotchas
- **Stripe Connect:** charges run on each shop's **connected account** (shop = merchant
  of record, 0% platform fee). The Stripe **webhook must listen to connected-account
  events** or `payment_status` never flips to paid. The platform-charge fallback for
  un-onboarded shops is **gated to test mode** (`STRIPE_LIVE_MODE` in `lib/stripe.ts`);
  live blocks online pay until the shop finishes Connect.
- **No-show / completion charges** only work when a card was **held/saved at booking**
  (online + no-show protection ON). In-person/no-card bookings can't be charged.
  `capture-appointment` allows the **owner OR a barber with `manage_appointments`**.
- **Anon INSERT…RETURNING footgun:** anon inserts with `.select()` fail RLS even when
  WITH CHECK passes. Use `crypto.randomUUID()` + return=minimal, or do the insert
  server-side via `supabaseAdmin` (service role). New public writes go through API routes.
- **transactions inserts:** match the proven `pos-finalize` columns (no `appointment_id`
  — prod may lack it).
- **Notifications:** `notifications.type` is CHECK-constrained to
  booking|cancellation|no-show|review|inventory|system. A `NotificationListener`
  (both portals) shows realtime pop-ups + a WebAudio chime; mute toggle stored in
  localStorage (`cw_notif_sound`).
- **Booking confirmation** after online pay reads a `summary` returned by
  `booking-finalize` (the Stripe redirect wipes in-memory state).

## Where to look
- `TODO.md` — go-live checklist (§0), pending SQL (§2), **code-review backlog (§2b)**, roadmap (§4b = Tap to Pay via Capacitor).
- `SESSION-17-NOTES.md` — detailed log of the most recent work (latest).
- `SESSION-16-NOTES.md` — prior session.
- `SESSION-14-NOTES.md` — older session.
- `CAPACITOR.md` — native-app (Capacitor) setup runbook + Tap to Pay prereqs.
- `src/lib/` — `stripe.ts`, `supabase{,-admin}.ts`, `twilio.ts`, `payment-notify.ts`,
  `validation.ts` (plan gating: `planHasFeature`, `effectivePlan`), `booking-conflict.ts`.
- `src/app/api/loyalty/` — `points` (manual add/redeem, plan-gated) + `award` (auto-earn).

## Current status (2026-06-17)
See `SESSION-17-NOTES.md` for the latest session (mobile modal/drawer overflow +
iOS focus-zoom fixes; a big Payments pass — compact header, payment-aware
completion toasts, $0 "No charge" rows, correct no-show fee amount/label,
filters→"Recent transactions" dropdown that shows money-moved only + greyed
refunds, and Supabase **realtime** live updates; calendar phone-column widths;
bottom nav Clients→Payments; booking pay-modal contrast). **Capacitor**
native-shell groundwork landed on branch `claude/gallant-euler-7fkw5h` ONLY (not
main) toward native **Tap to Pay** — see `CAPACITOR.md` + TODO §4b.
See `SESSION-16-NOTES.md` for the full log of all changes across sessions 14–16.

**Most recently shipped (2026-06-14, all deployed):**

**Appointments/Calendar/Payments batch** (commits `a6ce40e`–`7c825cc`):
- Auto-confirm in-person + pay-via-link flow (#1/#2)
- Send-link email fixed from Appointments side card (#4)
- Calendar payment sync (#5)
- "Paid · X min ago" labels via new `timeAgo()` util (#6, needs phase13 SQL)
- Multi-service = ONE combined appointment with `duration_minutes` (#7, needs phase14 SQL)
- Duration badges on appointments (#8)
- Calendar Approve/Complete/Reject action buttons (#9); shared logic in `lib/appointment-actions.ts`
- Payment notifications + chime (phase12 migration ran)

**Booking availability + slot granularity** (commits `8d1f70f`–`f05a7bc`):
- **Critical RLS fix**: customer booking page was querying appointments via anon client
  (stakeholder-only SELECT → zero rows → every slot looked free → double-booking possible).
  Fixed: new server-side `/api/availability` (service role) + `/api/book/in-person`.
- **Slot occupancy rewrite**: `occupiedSlots()` now uses half-open interval overlap
  (`m >= startMin && m < endMin`) — correctly handles 45-min bookings and 15-min grids.
- **Appointments sort fix**: sorted by `timeToMinutes()` not text (12pm was above 10am).
- **Quarter-hour scheduling**: `booking_settings.slot_interval_minutes` (30 or 15) drives
  both the Set Schedule start/end dropdowns AND the customer booking grid slot list.
  Staff → Set Schedule → "Time increments" toggle persists the choice shop-wide.

⚠️ **Pending migrations** (run in Supabase SQL Editor):
- `phase8_loyalty_earning.sql` — adds `appointments.loyalty_awarded`
- `phase13_appointment_paid_at.sql` — adds `appointments.paid_at`
- `phase14_appointment_duration.sql` — adds `appointments.duration_minutes`
(phase12 realtime + phase9 plans already run)

Stripe in **sandbox/test**; Twilio on **trial**. Before live: see TODO §0 + the
⚖️ merchant-of-record legal item.

## Key new files / routes (2026-06-14)
- `src/app/api/availability/route.ts` — server-side barber availability (service role, no PII)
- `src/app/api/book/in-person/route.ts` — server-side in-person booking creation
- `src/lib/appointment-actions.ts` — shared side-effect logic for approve/complete/reject
- `supabase/migrations/phase13_appointment_paid_at.sql` — ⚠️ not yet run on prod
- `supabase/migrations/phase14_appointment_duration.sql` — ⚠️ not yet run on prod
