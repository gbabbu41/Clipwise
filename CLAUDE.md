# ClipWise — Claude Code project guide

Read this first. It carries cross-machine context so any Claude Code instance
(Windows desktop or MacBook) stays consistent. The owner works from **two
machines** and syncs only through this GitHub repo (`gbabbu41/Clipwise`, branch
`main`). Local Claude memory does NOT transfer between machines — this file +
`SESSION-13-NOTES.md` are the shared source of truth.

## What this is
Full-stack barbershop SaaS. **Next.js 14 (App Router) + TypeScript + Tailwind**,
**Supabase** (real Postgres, RLS), **Stripe** (Connect + Checkout), **Resend**
(email), **Twilio** (SMS). Live at **clipwise.ca** (Vercel, **Hobby** plan).
Owner/barber/customer portals under `src/app/{dashboard,barber-dashboard,book}`.

## Workflow (IMPORTANT)
- The owner pushes to `main`; **Vercel auto-deploys** to clipwise.ca (~1 min).
- Always run `npx tsc --noEmit` before pushing. Lint errors do NOT block the
  build (`next.config.mjs` has `eslint.ignoreDuringBuilds: true`), but there are
  pre-existing lint errors (unused vars, unescaped entities, `<img>`); don't add new ones.
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
- `TODO.md` — go-live checklist (§0), pending SQL (§2), roadmap.
- `SESSION-13-NOTES.md` — detailed log of the most recent work.
- `src/lib/` — `stripe.ts`, `supabase{,-admin}.ts`, `twilio.ts`, `payment-notify.ts`,
  `validation.ts` (plan gating: `planHasFeature`, `effectivePlan`), `booking-conflict.ts`.

## Current status (2026-06-08)
Recently shipped: smart waitlist, recurring appointments, double-booking DB guard,
Restricted-Stripe banner, live staff notifications + chime + mute, universal
"pay link without email", no-show + completion charge notifications + receipts +
transaction recording. Stripe in **sandbox/test**; Twilio on **trial** (SMS only to
verified numbers). Before live: see TODO §0 + the ⚖️ merchant-of-record legal item.
