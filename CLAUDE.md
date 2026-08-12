# ClipWise — Claude Code project guide

Read this first. It carries cross-machine context so any Claude Code instance
(Windows desktop or MacBook) stays consistent. The owner works from **two
machines** and syncs only through this GitHub repo (`gbabbu41/Clipwise`, branch
`main`). Local Claude memory does NOT transfer between machines — this file +
`SESSION-18-NOTES.md` (latest) + `SESSION-17-NOTES.md` are the shared source of truth.

## What this is
Full-stack barbershop SaaS. **Next.js 14 (App Router) + TypeScript + Tailwind**,
**Supabase** (real Postgres, RLS), **Stripe** (Connect + Checkout), **Resend**
(email), **Twilio** (SMS). Live at **clipwise.ca** (Vercel, **Hobby** plan).
Owner/barber/customer portals under `src/app/{dashboard,barber-dashboard,book}`.

## 🧭 Operating mode (DEFAULT — read before doing anything)
The app is **production-quality and about to bill real customers.** The owner trusts Claude
(who knows the whole codebase) to **act with senior-engineer authority**: when you're
confident a change is correct and safe, **implement it, verify it (real `next build`), and
ship it — you don't need to ask first.** Bias toward action on clear improvements/fixes.

### 🏠 House rules (the owner's standing expectations — act like a co-founder, not a ticket-taker)
The owner is a solo founder building his first SaaS to bill real customers. His time is the
scarcest resource. Do NOT make him remind you of the same lesson twice. Internalize these:
1. **Own the whole job, including collateral damage.** If a change you make breaks or
   dirties something adjacent ("you painted the roof and dropped paint on the floor"),
   **fix the floor too, before you leave — without being asked.** Shipping a fix that
   leaves a new rough edge is not done.
2. **Fix the class, not the instance — everywhere.** When you fix one logic bug, sweep the
   whole app for the same pattern and fix all of them in the same pass (e.g. a settings
   toggle that isn't enforced → check calendar, appointments, emails, booking, POS). One
   coherent improvement applied app-wide beats ten one-off patches.
3. **Verify against reality, never speculate.** You have Supabase MCP (real prod DB) and the
   code. Before saying "it's probably X," **look.** Don't hand the owner a guess when you
   could hand him a confirmed fact. "Likely still 0" when you could have queried the row is
   exactly the failure to avoid.
4. **Don't touch the pillars; build on them.** Booking engine, Stripe/Connect/webhooks,
   auth/RLS, DB schema — preserve the architecture and workflows. Improve the logic layered
   on top; no style-only refactors of working code.
5. **Reduce his workload; run on autopilot within your authority.** Use common sense. Chain
   the obvious follow-ups yourself. Escalate ONLY the three categories below — otherwise act.
6. **Talk like a human, one thing at a time.** Plain language, no wall-of-text dumps. Bring
   decisions to him one by one with a recommendation, not a menu to sort through.

**Escalate to the owner FIRST (propose, don't act) ONLY when:**
1. **You're genuinely unsure** — ambiguous intent, or a judgment call that's the owner's to make.
2. **It touches the business model** — pricing, plans, the trial (21-day / no-card), commission
   model, fees, what's free vs paid, monetization, or legal/tax posture. These are the owner's calls.
3. **It could break the existing app / production** — large refactors, or risky changes to the
   appointment/booking engine, Stripe/payments/webhooks, auth/RLS, or DB migrations with real
   blast radius. When in doubt about blast radius, treat it as this case.

Always, regardless of mode:
- **Verify against the code** (`file:line`) — never guess. Apply the **secure-engineer** reflex.
  **Preserve** the existing architecture, UI, booking engine, Stripe, auth, and workflows unless
  the change intends otherwise; no style-only refactors of working code.
- Prefer parallel specialized **sub-agents** when it improves quality/speed (Code Reviewer, Bug
  Hunter, Security Auditor, Performance Analyzer, UX/UI Reviewer, Architecture Reviewer, Feature
  Researcher, Test Generator), combined into ONE concise report. When you DO escalate, bring:
  severity · affected files · reason · proposed solution · benefits · risks · estimated effort.
- **Migrations are manual SQL the owner runs** — always hand over the SQL and say it's required.
- Slash commands: **`/audit`** = read-only fan-out review → report; **`/ship`** = build + commit + push.

## 🛡️ Build & audit mindset (USE THE SKILL)
Before writing/changing any API route, auth, payment, or DB code — and for any
"is this safe / find bugs / harden / check before launch" request — invoke the
**`secure-engineer`** skill (`.claude/skills/secure-engineer/`). It carries the
attacker mindset (never trust the client, IDOR checks, fix the class not the
instance, verify don't assume, flag proactively) + a concrete audit playbook.
Apply it by reflex, not only when asked.

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

## ✅ Migrations — prod is FULLY MIGRATED (verified 2026-08-12)
`schema.sql` is stale (a floor, not the truth — see `database.types.ts` + the phase
migrations for the real shape). But a full `information_schema` audit on **2026-08-12**
confirmed **every** `phaseN` migration's columns/tables are present on prod. **Do NOT tell
the owner a feature is broken because "a migration is pending" — the whole backlog is
applied.** Verify against the live DB (Supabase MCP or an `information_schema` query),
never against a stale checkbox in TODO.md or a migration file header.
- New migrations added AFTER 2026-08-12 are the only ones to track as "to run."
- If a feature "silently does nothing," still capture the supabase `error` (don't only
  read `data`) — but the cause is far more likely code/config than a missing column now.

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
- **`KNOWLEDGE-BOOK.md` — the full "behind the app" platform reference.** Architecture, the
  booking engine, payments/Stripe, auth/RLS/security, the data model + every migration phase,
  plans/billing, notifications/email/SMS/realtime/cron, all ancillary features, and the money
  model — mapped from the real code with `file:line` anchors. **Start here** for how any
  subsystem actually works. Keep it current when a subsystem changes materially.
- `TODO.md` — go-live checklist (§0), pending SQL (§2), **code-review backlog (§2b)**, roadmap (§4b = Tap to Pay via Capacitor).
- `SESSION-18-NOTES.md` — detailed log of the most recent work (latest): universal top header + consistent top padding across all owner pages. NEXT: barber portal.
- `SESSION-17-NOTES.md` — prior session.
- `SESSION-16-NOTES.md` — older session.
- `SESSION-14-NOTES.md` — older session.
- `CAPACITOR.md` — native-app (Capacitor) setup runbook + Tap to Pay prereqs.
- `src/lib/` — `stripe.ts`, `supabase{,-admin}.ts`, `twilio.ts`, `payment-notify.ts`,
  `validation.ts` (plan gating: `planHasFeature`, `effectivePlan`), `booking-conflict.ts`.
- `src/app/api/loyalty/` — `points` (manual add/redeem, plan-gated) + `award` (auto-earn).

## Current status (2026-06-17)
**Not yet live to customers** (pre-launch) — safe to iterate on `main`; no real
customer money/data at risk yet. Stripe still sandbox/test, Twilio trial.
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

✅ **Migrations: all run on prod** (verified 2026-08-12). The phase8 (`loyalty_awarded`),
phase13 (`paid_at`), phase14 (`duration_minutes`) columns that were long flagged pending
are confirmed present — as is the entire backlog. Nothing to run.

Stripe in **sandbox/test**; Twilio on **trial**. Before live: see TODO §0 + the
⚖️ merchant-of-record legal item.

## Key new files / routes (2026-06-14)
- `src/app/api/availability/route.ts` — server-side barber availability (service role, no PII)
- `src/app/api/book/in-person/route.ts` — server-side in-person booking creation
- `src/lib/appointment-actions.ts` — shared side-effect logic for approve/complete/reject
- `supabase/migrations/phase13_appointment_paid_at.sql` — ✅ run on prod
- `supabase/migrations/phase14_appointment_duration.sql` — ✅ run on prod
