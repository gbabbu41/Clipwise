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
