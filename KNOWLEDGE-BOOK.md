# ClipWise — Platform Knowledge Book

> The "behind the app" reference: how the whole platform and its engine actually
> work, mapped from the real code with `file:line` anchors so it stays trustworthy.
> Written for any Claude Code instance or developer picking up ClipWise on either
> machine. Pair this with `CLAUDE.md` (operating rules), `TODO.md` (backlog +
> pending SQL), and the `SESSION-*.md` notes (recent work log).
>
> **Scope:** production barbershop SaaS at **clipwise.ca**. Next.js 14 (App Router)
> + TypeScript (strict) + Tailwind, Supabase (Postgres/Auth/Realtime/Storage),
> Stripe (Connect + Checkout + Billing), Resend (email), Twilio (SMS), Capacitor
> (native shell). Last mapped: **2026-08-12**.
>
> ⚠️ `file:line` anchors are accurate as of the mapping date; treat them as
> signposts, not guarantees — code moves. When in doubt, grep the symbol.

## Table of contents

1. [Architecture & app structure](#1-architecture--app-structure)
2. [The booking engine](#2-the-booking-engine)
3. [Payments & Stripe](#3-payments--stripe)
4. [Auth, roles, RLS & security](#4-auth-roles-rls--security)
5. [Data model & schema](#5-data-model--schema)
6. [Plans, feature gating, billing & subscriptions](#6-plans-feature-gating-billing--subscriptions)
7. [Notifications, email, SMS, realtime & cron](#7-notifications-email-sms-realtime--cron)
8. [Ancillary features](#8-ancillary-features)
9. [The money model, in one place](#9-the-money-model-in-one-place)

---

## 1. Architecture & app structure

Next.js **14.2.35** App Router + TypeScript (`strict`) + Tailwind + Supabase
(Postgres/Auth/Realtime/Storage) + Stripe. Wrapped for iOS/Android via Capacitor.
Path alias `@/*` → `./src/*` (`tsconfig.json:20-22`).

### 1.1 Tech stack & wiring

**`next.config.mjs`**
- `eslint.ignoreDuringBuilds: true` (`next.config.mjs:7`) — lint won't fail the Vercel
  build. **TypeScript errors DO fail it** (`typescript.ignoreBuildErrors` is *not* set),
  so a real TS error breaks the deploy.
- `headers()` (`:14-52`) sets baseline security headers on every response: a hand-tuned
  Content-Security-Policy (`:25-37`; self scripts with `unsafe-inline`/`unsafe-eval`,
  Supabase REST+wss, `api.stripe.com`, `frame-src https://*.stripe.com`), plus
  `X-Content-Type-Options`, `Referrer-Policy`, HSTS, `Permissions-Policy` (`:38-44`).
  `X-Frame-Options: DENY` is scoped **only** to `/dashboard/*`, `/barber-dashboard/*`,
  `/admin/*` (`:45-51`) so public `/book` pages stay embeddable.

**`middleware.ts`** — edge auth gate.
- Public allowlist `["/", "/login", "/signup", "/forgot-password", "/admin/login"]`
  plus prefix passes for `/book/`, `/_next/`, `/favicon` (`middleware.ts:9-16`).
- Builds a Supabase SSR client from cookies (`:22-35`), calls `auth.getUser()` (`:37`);
  unauthenticated users are redirected to `/login?redirect=<path>` preserving the
  destination (`:42-46`). `config.matcher` gates `/dashboard/*`, `/onboarding/*`,
  `/barber-dashboard/*`, `/admin/*` (`:54`).

**Env validation** — there is **no central env module** (no `env.ts`/zod). Env vars are
read inline with non-null assertions at point of use: `supabase.ts:4-7`,
`supabase-admin.ts:9-12`, `stripe.ts:5`, `middleware.ts:23-24`. Derived/lazy guards
instead: `STRIPE_LIVE_MODE` from key prefix (`stripe.ts:15`), Twilio returns `null` when
creds absent (`twilio.ts:10-20`), Turnstile skips when unset. `supabase-admin.ts:5`
imports `"server-only"` as a build-time tripwire against leaking the service-role client
into a browser bundle.

**Other config**: `vercel.json` registers a single **daily** cron `/api/cron/reminders`
at `0 13 * * *` (Hobby-plan limit: crons must be at most daily or they silently block ALL
deploys). Key deps: `@supabase/ssr` + `@supabase/supabase-js`, `stripe`, `twilio`,
`resend`, `next-themes`, `recharts`, `framer-motion`/`gsap`/`three`/`lenis` (landing
animation), Radix UI, `sonner` (toasts).

### 1.2 The portals & route trees

Four `layout.tsx` files: root + one per authenticated portal (`dashboard`,
`barber-dashboard`, `admin`).

- **Owner portal — `src/app/dashboard/**`** (role `shop_owner`). Layout redirects
  barbers→`/barber-dashboard`, customers→`/`, unapproved shops→`/dashboard/pending`
  (`dashboard/layout.tsx:42-56`). Pages: home (`page.tsx`), `analytics`, `appointments`,
  `billing`, `calendar`, `check-in`, `clients`, `gift-cards`, `inventory`, `kiosk`,
  `loyalty`, `marketing`, `messages`, `my-stats`, `notifications`, `payments`
  (+`payments/tax`), `payroll`, `pending`, `phone`, `pos`, `reviews`, `schedule`,
  `services`, `settings`, `share`, `staff`, `stripe-setup`, `time-off`, `waitlist`,
  `waitlist-requests`.
- **Barber portal — `src/app/barber-dashboard/**`**. Wraps children in `BarberProvider`
  + `BarberGuard` (`barber-dashboard/layout.tsx:131-133`); the guard bounces owners on
  free/Starter plans and unlinked/inactive accounts (`:39-101`). Pages: home, `calendar`,
  `clients`, `earnings`, `hours`, `notifications`, `profile`, `schedule`, `time-off`,
  `waitlist`.
- **Customer booking — `src/app/book/[shopslug]/`**. `page.tsx` is a server component
  that 404s an unknown slug via `supabaseAdmin` then renders client `BookingClient`
  (`book/[shopslug]/page.tsx:12-24`, `dynamic = "force-dynamic"`); also `.../review`.
  Related public flows: `shops/` + `shops/[slug]`, `gift/[shopslug]`, `tip/[id]`,
  `receipt/[id]`, `my-booking/[id]`, `my-bookings`.
- **Public / marketing**: `src/app/page.tsx` (animated landing — Lenis + GSAP + Three.js),
  `why-clipwise`, `support`, `privacy`, `terms`, `cookies`, `offline`.
- **Admin — `src/app/admin/**`** (role `super_admin`; non-admins → `/admin/login`,
  `admin/layout.tsx:27-32`). Pages: overview (`page.tsx`), `shops` + `shops/[id]`,
  `users`, `coupons`, `activity`, `errors`, `settings`, `login`.
- **Auth & onboarding**: `login`, `signup` + `signup/barber`, `forgot-password`,
  `reset-password`, `auth/callback`, `accept-invite`, `join-shop`, `onboarding` +
  `onboarding/plan` + `onboarding/stripe-connect`.

### 1.3 Root layout / providers — `src/app/layout.tsx`

- `<html>` is hard-pinned to **dark** with two font CSS variables — Sora `--font-body`,
  DM Mono `--font-mono` (`layout.tsx:11-26`, `:62`).
- Body tree: `<OfflineBanner />`, `<ErrorLogger />`, `<AuthProvider>{children}</AuthProvider>`,
  `<PWARegister />` (`:63-70`).
- `metadata` declares the PWA manifest, apple-web-app config, theme color, icons (`:28-45`);
  `viewport` sets `viewportFit: "cover"` for safe-area insets (`:50-54`).
- **PWA/service worker** — `src/components/pwa-register.tsx` registers `/sw.js` **only in
  production** and actively unregisters any dev SW to avoid stale bundles (`:11-21`).
- **Notification listener** is **not** in root layout; it's mounted per authenticated
  portal (`dashboard/layout.tsx:139`, `barber-dashboard/layout.tsx:136`). It subscribes to
  Realtime INSERTs on `notifications` filtered by `user_id`, shows a toast + Web-Audio
  chime, and routes taps to the right portal page (`notification-listener.tsx:98-118`).

**`AuthProvider` — `src/lib/auth-context.tsx`** is the central client-side state. Exposes
`{ user, profile, shop, shops, plans, loading, accessToken, signOut, refreshShop,
setActiveShop }` (`:9-20`). On `auth.onAuthStateChange` it fetches `/api/profile` with the
bearer token (`:103-131`), restores the last-selected shop from `localStorage`
(`cw_active_shop`, `:38`, `:116-121`), loads admin-editable plans from `/api/plans`
(`:68-79`), and subscribes to Realtime UPDATEs on the active `shops` row to auto-refresh
on webhook/subscription changes (`:140-152`).

### 1.4 Shared library layer — `src/lib/`

**Core wiring**
- `supabase.ts` — singleton browser client (anon key).
- `supabase-admin.ts` — server-only **service-role** client; `"server-only"` tripwire.
- `stripe.ts` — Stripe SDK singleton; `STRIPE_LIVE_MODE`; `stripeFeeCents()` reads the real
  processing fee; `PLAN_PRICING`.
- `api-auth.ts` — the shared API authorization gate: `getBearer`/`getUserFromReq`,
  `authorizeShop(req, shopId, {ownerOnly, permission})`, `authorizeAppointment` (IDOR
  guard). Verify token → confirm owner or active barber (`:47-101`).
- `admin-auth.ts` — `requireSuperAdmin()`. `admin-audit.ts` — append to `admin_audit_log`.

**Money math / domain**
- `validation.ts` — validators, `FIELD_CAPS`+`clampLen`, plan-gating engine
  (`effectivePlan`, `isPaidPlan`, `planHasFeature`, `getLocationLimit`, `hydratePlanConfig`).
- `plans.ts` (client-safe types) / `plans-server.ts` (`ensurePlansHydrated`, server-only).
- `pricing.ts` — pure tip/tax math; `CANADA_TAX_PRESETS`.
- `service-pricing.ts` — server-authoritative price+duration from DB (never trust client).
- `revenue.ts` — shared "collected revenue" math (settled appts + POS txns, de-duped,
  net-of-fee). See §9.
- `barber-earnings.ts` — single definition of barber take-home + `shopBarberCommission`. §9.
- `availability.ts` — pure occupancy (`occupiedSlots`, `OCCUPYING_STATUSES`, `holdsSlot`).
- `booking-conflict.ts` — server double-booking detection (`23505` unique violation).
- `schedule-block.ts` — server check for approved time-off / recurring breaks.
- `timezone.ts` — shop-tz helpers (`safeTz`, `todayInTz`, `hoursUntilBooking`, `DEFAULT_TZ`).
- `promo.ts` / `loyalty-redeem.ts` / `gift-redeem.ts` — server-authoritative redemption.
- `ensure-client.ts` / `client-identity.ts` — client de-dup + create.

**Stripe/payment finalizers (server)**
- `finalize-booking-session.ts` — build & finalize a booking from a Checkout session.
- `finalize-appointment-payment.ts` — idempotent mark-paid + receipt/alerts; writes the
  `transactions` completion row.
- `finalize-gift-session.ts` / `gift-card-server.ts` — gift-card sale finalize + helpers.
- `finalize-tip.ts` — record post-visit tip. `stripe-addons.ts` — location + AI-phone
  add-ons. `terminal.ts` — Tap to Pay. `appointment-actions.ts` — shared approve/complete/
  reject side effects (email/SMS/loyalty/waitlist).

**Comms**
- `emailer.ts` — Resend engine + all templates; `PRIVILEGED_EMAIL_TYPES` gate.
- `notify-booking-emails.ts` / `payment-notify.ts` — server-resolved emails.
- `notify.ts` (client-safe reads) / `notify-server.ts` (`insertNotifications`).
- `twilio.ts` — lazy Twilio (`getTwilio`, `sendSmsBestEffort`). `turnstile.ts` — CAPTCHA.

**Platform/misc**
- `platform-settings.ts`, `process-trials.ts`, `grant-free-days.ts`, `rate-limit.ts`
  (in-memory fixed-window + `clientIp`), `upload-validate.ts` (magic-number image check),
  `shop-public.ts` (`stripShopSecrets`), `utils.ts` (`cn`, `prettyDate`, `timeToMinutes`,
  …), `database.types.ts` (hand-written row/enum types).

### 1.5 API layer — `src/app/api/**`

~115 route handlers. Groups: **auth/account**, **stripe** (~40 routes — biggest),
**webhooks/stripe**, **booking/availability**, **barber/staff**, **commerce features**
(pos, gift-card, loyalty, coupons, promo, reviews, waitlist, tax), **comms** (send-email,
sms, voice, ai-phone), **admin**, **shops/onboarding**, **uploads**, **infra**
(`cron/reminders`, `client-error`).

### 1.6 Global patterns (invariants)

- **How clients get the shop/user**: owner → `useAuth()` (`auth-context.tsx:174`); barber →
  `useBarber()` (`barber-context.tsx:75`, fed by `/api/barber/me`). `/api/profile`
  (`route.ts:5-48`) is the resolver — for barbers it calls `stripShopSecrets()` so staff
  never receive Stripe identifiers.
- **How server routes authenticate** (three tiers): (1) shop-scoped via
  `authorizeShop`/`authorizeAppointment`; (2) admin via `requireSuperAdmin`; (3) the Stripe
  webhook by **signature** (`stripe.webhooks.constructEvent`), cron by `x-cron-secret`.
- **Server is the source of truth for all money** — prices/durations re-resolved
  (`service-pricing.ts`), discounts/gift/loyalty recomputed server-side; client amounts are
  never trusted.
- **Client/server split is physical**: `supabase-admin`, `notify-server`, `plans-server`,
  `platform-settings`, `service-pricing` are server-only (service-role key) with
  `"server-only"` guards; `notify.ts`/`availability.ts`/`plans.ts` are the client-safe halves.
- **Idempotency everywhere**: payment/tip/gift finalizers dedup on PaymentIntent so the
  webhook and the customer-return route can both fire safely.

---

## 2. The booking engine

### 2.1 The one occupancy model — `src/lib/availability.ts`

The pure, client-safe module every path imports so UI, API conflict checks, and the
DB trigger all agree on "is this chair taken":
- `FREEING_STATUSES = ["cancelled","no-show"]` (`availability.ts:26`);
  `OCCUPYING_STATUSES = ["pending","confirmed","completed"]` (`:32`, used as the SQL
  pre-filter).
- `holdsSlot(a)` (`:41-43`): occupies unless cancelled/no-show **or**
  `payment_status === "refunded"`. The refund test is `!== "refunded"` (not a `.neq`
  query) so a NULL `payment_status` (unpaid/in-person) is never wrongly freed.
- `apptDuration(a)` (`:54-58`): block length = own `duration_minutes` (multi-service)
  → linked service duration → fallback **30**.

### 2.2 Availability read — `src/app/api/availability/route.ts`

The **anon-SELECT RLS footgun** (`route.ts:5-17`) is why this exists: the booking page is
anonymous, but `appointments`/`time_off_requests` RLS is stakeholder-only, so a direct anon
query returns **zero rows → every slot looks free → double-booking**. This route reads with
`supabaseAdmin` and returns only non-PII fields (working hours, busy ranges, time-off) — no
names/emails/phones. Flow: load the day's occupying appointments (with `duration_minutes`
fallback `:31-36`) → drop paused barbers (`bookings_paused`) → `holdsSlot` filter → read
`time_slots` (widest window if split shift `:85-98`), approved `time_off_requests`, recurring
`barber_breaks` → return per-barber `{start_time, end_time, fullDayOff, busy[], blocked[]}`. A
`barber_id === null` time-off row is a **shop-wide closure** applied to every barber (`:115-117`).

### 2.3 Server write-path guard — `src/lib/booking-conflict.ts`

- `isDoubleBookError()` (`:10-13`) treats `23505` (unique index), `P0001`, or `/OVERLAP/`
  (the phase18 trigger) as a double-book.
- `barberHasConflict()` (`:71-89`) — half-open overlap `startMin < e && s < endMin` (`:88`),
  which catches a booking landing *inside* a longer existing appointment (the exact-slot index
  can't). **Fails closed**: a read error returns `true` ("pick another time").
- `findAvailableBarber()` (`:98-147`) resolves "Any Available" to a concrete free barber
  server-side (so the DB unique index can protect it); returns `null` (fail closed) on error.

### 2.4 Schedule enforcement — `src/lib/schedule-block.ts`

`scheduleBlockReason(shopId, barberId, date, startMin, endMin, {includeBreaks})` (`:25-62`)
covers the **schedule side** the conflict helpers/DB trigger never see. Approved
`time_off_requests` (day_off/vacation/sick block the whole day; blocked_hours block their
window; null-barber = shop-wide). `includeBreaks` (customer paths) also blocks recurring
`barber_breaks` — deliberately **off** for owner walk-ins so staff can book over a lunch break.

### 2.5 Slot granularity — `booking_settings.slot_interval_minutes` (15 or 30)

Default 30 (`settings/page.tsx:47`). Staff set it in Set Schedule (`staff/page.tsx:29-32`,
merged shop-wide `:275-279`); it drives **both** the schedule pickers and the customer grid.
Slot math in `utils.ts`: `occupiedSlots(startSlot, durationMin, intervalMin)` (`:139-147`,
half-open `[start, start+dur)`); `getSlotsInRange` only offers a slot if its whole window fits
before the barber's end (`m + SLOT_MINUTES <= endMins`, `:417`).

### 2.6 In-person / staff booking — `src/app/api/book/in-person/route.ts`

Server-role write (anon can INSERT but not SELECT). Flow: rate-limit (12/60s) → length-cap
free text → shop must be `approved` → **past-booking guard** (shop-tz) → **`confirmed` is
staff-only** (honored only if `authorizeShop` passes; an anon customer can't self-confirm or
bypass pause) → **server-authoritative pricing** via `resolveServiceCharge` → promo/loyalty
(server) → pay-model + advance-window (staff exempt) → barber resolve + `barberHasConflict` →
**schedule enforcement + `override_block`** (staff-only; returns 409 with `blocked:true` for an
*overridable* schedule conflict) → status `confirmed`/`autoConfirm` else `pending` → tax
(paid-plan gated; stores gross in `total_amount`, `tax_amount` best-effort) → insert (with
`duration_minutes` fallback) → post-insert best-effort: consume promo, deduct loyalty,
`ensureClientRow`, gift redemption → notifications (customer self-bookings ping staff; customer
email always; **customer SMS now fires for staff bookings too** — see this session's work).

**Server-authoritative pricing** — `resolveServiceCharge(shopId, serviceIds)`
(`service-pricing.ts:21-48`): `serviceIds` is a multiset; sums real `price`/`duration_minutes`
scoped to the shop; `allResolved` false if any id isn't this shop's → caller rejects rather
than undercharge. **Never trusts the client's `total_amount`.**

### 2.7 Online booking — `booking-checkout` + `finalize-booking-session`

Key invariant: **the appointment is NOT created at checkout** — only a Stripe Checkout session
with all details in metadata; the row is created on success in finalize. Checkout does all
guards (past/advance/pause/conflict/schedule) **before taking money**, then three modes:
- **Immediate** — charge service+tax+tip now → `paid`, `deposit_paid: true`.
- **Hold** — `capture_method: "manual"` (authorize only) → `held`; captured later.
- **Save card** — `mode: "setup"` + explicit Customer (bookings >7 days out, since holds
  expire ~7 days) → `saved`; charged off-session at completion/no-show.

`finalizeBookingFromSession` (`finalize-booking-session.ts:52-372`) is the single source of
truth, called by **both** the customer return and the `checkout.session.completed` webhook
fallback, **fully idempotent**: confirm money settled → dedup (`findMine`) → reverse money if
the slot/schedule was lost meanwhile (but return-mine, not refund, if the conflict is my own
concurrent row) → build+insert the row (dropping lagging columns so a paid booking is never
lost) → post-insert promo/client/loyalty/gift → notifications + SMS + revenue ledger + emails.

### 2.8 Reschedule / cancel — `src/app/api/my-booking/[id]/route.ts`

Keyed by the unguessable appointment UUID (from the confirmation email/SMS); service-role,
returns display-only fields; `force-dynamic` + `no-store`. `PATCH` enforces the
**cancellation-notice window** server-side (`booking_settings.cancellation_hours`, default 2;
`0` = off) for both cancel and reschedule. Cancel releases an uncaptured **hold** → `voided`.
Reschedule **preserves status** (a confirmed booking doesn't re-enter the approval queue) and
pings the waitlist for the vacated slot.

### 2.9 Appointment lifecycle — statuses & DB backstops

Domain: `pending | confirmed | completed | no-show | cancelled`. Transitions run through
`src/lib/appointment-actions.ts`: approve (`sendApprovalNotifications`), complete
(`runCompletionEffects` — client stats, loyalty award [plan-gated, idempotent], review email),
no-show (`sendNoShowFollowup`), reject (`sendRejectionEmail` + `notifyFreedSlot` → waitlist).
⚠️ **Gotcha:** the check-out time barrier `isCheckoutAllowed` is currently **disabled**
(`utils.ts:179`, `BARRIER_ENABLED = false`), so completion is allowed anytime. **Decision
(2026-08-12): stays off during testing** so future test bookings can be completed early; flip
`BARRIER_ENABLED = true` at go-live to enforce the 3-hour rule (see `TODO.md` §0).

**DB-level backstops** (so the UI can never disagree with the database):
- Exact-slot unique index `(barber_id, date, time_slot)` for active rows
  (`phase4_prevent_double_booking.sql:27-29`).
- Duration-aware overlap trigger `clipwise_prevent_overlap()` raising `P0001 OVERLAP`
  (`phase18_no_overlap.sql`), refined to ignore refunded rows and hold a `pg_advisory_xact_lock`
  serializing concurrent same-barber inserts (`phase29`, `phase31`).

**Engine-wide invariants:** the anon-SELECT footgun forces server-role for all reads; every
conflict path fails closed on a DB error; client amounts are never trusted; two-layer overlap
protection (index for same-start, `barberHasConflict`+trigger for duration overlap); online
payment materializes the row only on success (idempotent across return + webhook).

---

## 3. Payments & Stripe

### 3.1 The core model in one sentence

Every customer-facing charge (booking, POS, tip, gift card, no-show fee, payment link, terminal
tap) is a **Stripe direct charge on the shop's own Connect Express account** via
`{ stripeAccount }`, with **no `application_fee_amount` anywhere** → the shop is merchant of
record and the platform takes **0%**. Only **subscriptions** (ClipWise's own SaaS revenue) run
on the platform account.

`src/lib/stripe.ts`: `STRIPE_LIVE_MODE = key.startsWith("sk_live_")` (`:15`) gates the
platform-charge fallback; `stripeFeeCents(pi, connectedAccountId)` (`:25-46`) reads the real
processing fee from the charge's `balance_transaction` (best-effort → 0 on error). The repeated
pattern: `useConnect = !!(shop.stripe_account_id && shop.stripe_connected)` →
`acctOpts = useConnect ? { stripeAccount } : undefined`.

**Live-mode fallback gate:** booking-checkout / tip-checkout / capture-appointment keep a
test-mode platform fallback for un-onboarded shops; **payment-link / pos / gift / terminal
require Connect unconditionally** (even in test).

### 3.2 The Stripe routes (`src/app/api/stripe/**`)

- **Booking**: `booking-checkout` (session for a new booking, 3 modes), `booking-finalize`
  (customer return → `finalizeBookingFromSession`).
- **Post-booking payment**: `payment-link` (owner/barber sends a Checkout link for an existing
  unpaid appointment; `flow: post_booking_payment`; separate tax line item; optional
  `complete_on_paid`), `payment-link-finalize` (verifies + **binds session metadata to the exact
  appointment+shop**, anti-replay).
- **Completion/holds**: `capture-appointment` (owner OR barber w/ `manage_appointments`; capture
  a hold or charge a saved card; completion vs no-show fee %), `release-hold` (void an uncaptured
  hold), `refresh-payment` (re-check a PI), `reconcile-payments` (catch-up scan of unpaid appts
  with a session id).
- **Tips**: `tip-checkout` / `tip-finalize` (`flow: tip`, min $1).
- **Gift**: `gift-checkout` / `gift-finalize` (`flow: gift_card_purchase`; card minted only on
  finalize).
- **POS**: `pos-checkout` / `pos-finalize` (`flow: pos_sale`), `terminal/*` (Tap to Pay —
  connection-token, create-intent [card_present, manual capture, no app fee], capture).
- **Refunds**: `refund` (appointment refund WITH 30-day window, cancels upcoming booking),
  `refund-payment` (from Payments page WITHOUT cancelling — service rendered; handles a
  standalone POS `transaction_id` too).
- **Connect/onboarding**: `connect` (create/resume Express account), `connect/status`
  (`active = charges_enabled && payouts_enabled`, self-heals `stripe_connected`),
  `dashboard-link` (Express login link).
- **Subscription/billing**: `checkout`, `confirm-subscription`, `cancel-subscription`,
  `resume-subscription`, `billing` (panel), `billing-portal` (card update via
  `payment_method_update`, `?card_updated=1`), `verify-session`, `notify-card-updated`.
- **Read**: `payments-summary` (`byPi` map PI→{gross,fee,net} from balance transactions; owner
  also gets payout balance/next-payout; a barber gets **only** `byPi`), `cancel-payment-link`.

### 3.3 The webhook — `src/app/api/webhooks/stripe/route.ts`

Signature-verified (`stripe.webhooks.constructEvent`, secret `.trim()`ed); one endpoint receives
both platform and connected-account events. Dispatch:
- `checkout.session.completed` → by `metadata.flow`: `tip` → record tip; `gift_card_purchase` →
  finalize gift; `post_booking_payment` → **double-payment guard** (`dupCard` → auto-refund the
  new charge; `onlineOverCash` → alert only) then flip to `paid`, auto-confirm, ledger row,
  receipt/emails; `mode: "subscription"` → set `subscription_status: active`, re-attach add-ons;
  else booking metadata → `finalizeBookingFromSession` fallback.
- `customer.subscription.updated/deleted` → status map / downgrade to `starter`.
- `account.updated` → sync Connect status.
- `payment_intent.succeeded` → `paid` **only** from `["unpaid","held","saved","failed"]` (guard
  so a captured no-show fee isn't overwritten).
- `payment_intent.payment_failed` → `failed` (from unpaid/held/saved).
- `charge.refunded` → **full refunds only** → appointment/tx `refunded`.

### 3.4 Payment lifecycle & `payment_status` values

`unpaid`/`null` (pay-in-person / not settled) · `held` (manual-capture auth) · `saved` (setup
mode, no charge) · `paid` (immediate/link) · `captured` (held/saved card charged at
completion/no-show — "Paid · Card") · `failed` · `refunded` · `voided` (hold released without
charge — ⚠️ no `statusInfo` label, renders default tone).

Capture (`capture-appointment`): owner OR barber w/ `manage_appointments`; no-show fee =
`no_show_fee_percent` capped at 100%; saved-card path uses a Stripe `idempotencyKey`; held-card
path **never captures more than authorized**; "already captured" race treated as success.

### 3.5 The transactions ledger — when rows are written

Writers: `finalize-appointment-payment.ts` (`recordOnlinePaymentTx`, `source: "completion"`,
reads real fee, dedup on PI), `capture-appointment` (completion or `source: "no_show"`),
`pos-finalize` + `terminal/capture` (`source: "pos"`, keyed on `stripe_session_id` /
`payment_intent_id`), `finalize-gift-session` (`source: "gift_card_sale"`, `type: "product"`,
`barber_id: null`). Columns: `amount, tip, tax, stripe_fee, commission_amount, payment_method,
type, appointment_id, payment_intent_id, stripe_session_id, source, refunded, barber_id`.

### 3.6 Payouts — `payments-summary`

Owner-only: `available + pending` from `balance.retrieve`; `payouts.list` → `inTransit`,
`nextPayoutDate/Amount` (soonest arriving), `lastPayout`; falls back to `estimateNextPayout`
from the account's payout schedule. Cash never appears here (it never touches Stripe).

### 3.7 Payments gotchas

0% platform fee is by **omission** (no route sets `application_fee_amount`). Idempotency is
layered (conditional DB updates, PI/session dedup, Stripe idempotency keys, unique indexes).
**Dual finalize paths** (customer return + webhook fallback) share the same lib so whichever
fires second no-ops — critical because Connect webhooks can be missed. Every Stripe read/write
on customer money passes the connected-account context (wrong account → silent 404). Fee data
can be 0 (unsynced) → that line nets to gross. Anti-replay: payment-link-finalize + tip-finalize
require session metadata to name the exact appointment/shop.

---

## 4. Auth, roles, RLS & security

### 4.1 Two Supabase clients (trust boundary)

`src/lib/supabase.ts` — browser client, **anon key**, cookie-backed (so middleware reads the
session). `src/lib/supabase-admin.ts` — server-only `supabaseAdmin`, **service-role key**, with
`import "server-only"` (`:5`) as a build-time tripwire against leaking into a client bundle.

### 4.2 Authentication flow

- **Client**: `auth-context.tsx` — `onAuthStateChange` sets `user` + `accessToken`; profile/shop
  from `/api/profile` with `Authorization: Bearer <token>`; a 401 forces `signOut()`, a network
  error does not.
- **Server**: Bearer token → `supabaseAdmin.auth.getUser(token)` (canonical helper
  `api-auth.ts:11-23`).
- **Middleware** (`middleware.ts`): public allow-list + `/book/`,`/_next/`,`/favicon`; gates
  `/dashboard`,`/onboarding`,`/barber-dashboard`,`/admin`. **Auth-only, not role-aware** — role
  gating is done in layouts + API routes (defense split).

### 4.3 Roles

`public.users.role` ∈ `customer | barber | shop_owner | super_admin`. `handle_new_user` trigger
whitelists self-selectable roles (`super_admin` never grantable via signup). Role-based routing
in `login/page.tsx` with an **open-redirect guard** (the `redirect` param honored only for the
user's own portal). `/api/profile` resolves the shop by role and calls `stripShopSecrets()` for
barbers. **DB-level:** `prevent_role_escalation()` blocks self-assign to super_admin.

### 4.4 Barber permissions (JSON on `barbers.permissions`)

Keys: `edit_schedule, request_time_off, view_earnings, view_clients, block_hours,
manage_appointments`. Default all true **except `manage_appointments:false`** (granting
payment-collection authority is a deliberate per-barber act). Self-grant blocked at the DB
(`phase39_block_barber_self_grant_permissions.sql`). Enforced server-side in `barber/earnings`
(`view_earnings`), `capture-appointment` / `appointments/update` / `calendar/block` /
`loyalty/award` / payment-link / reconcile (`manage_appointments` or `block_hours`).

### 4.5 API auth helpers — `src/lib/api-auth.ts`

`authorizeShop(req, shopId, opts)` (`:47-76`) → `{error}` or `{user, shop, isOwner}`: 401 no
user → 400 no shop → 404 not found → owner passes → `ownerOnly` rejects barbers → else must be
an **active** barber of that shop → optional `permission` flag. `authorizeAppointment(req,
appointmentId, opts)` (`:88-101`) is the **IDOR guard** — loads the appointment, resolves its
shop, delegates to `authorizeShop`. ⚠️ Some money routes still hand-roll this check inline
(`capture-appointment`, `loyalty/award`, `reconcile-payments`) — same logic, not yet centralized.

### 4.6 RLS model

**RLS is ON for every table** — that's the only reason the anon key is safe. Key footguns
(from the secure-engineer skill, applied throughout):
- **Anon INSERT…RETURNING footgun**: an anon insert with `.select()` fails RLS even when
  `WITH CHECK` passes → new public writes go through **service-role API routes** (e.g.
  `waitlist/join`), or use `crypto.randomUUID()` + `return=minimal`.
- **RLS is row-level, not column-level**: a public `select("*")` on an approved shop still
  returns `stripe_account_id`, owner email/phone. Mitigated by `stripShopSecrets()` (deny-list
  deletion so a new secret column never silently leaks) and by keeping private admin data in
  **separate tables** (`shop_admin_meta`, `admin_audit_log`, `platform_settings`).
- **DB-level IDOR/privilege guards** (defense beyond RLS): `prevent_shop_field_escalation`
  (can't change status/plan/owner), `clamp_shop_self_insert` (end-user shops clamped to pending),
  `guard_multi_location` (2nd shop needs active Premium/Business), `restrict_barber_self_update`,
  `appointments_insert_public` (`customer_id` must be null or `auth.uid()`).

### 4.7 Rate limiting — `src/lib/rate-limit.ts`

In-memory fixed-window (`enforceRateLimit(req, bucket, limit, windowMs)` → ready 429).
**Honest limitation**: per-instance on serverless — blunts floods, not determined attackers;
swap-in Redis without changing call sites. Applied to booking-checkout, tip/gift-checkout,
book/in-person, waitlist/join, twilio/send-sms, coupons/redeem, reviews/submit, promo/validate,
lookups, forgot-password, client-error.

### 4.8 Secure-engineer patterns actually in the code

Server-authoritative pricing (`resolveServiceCharge` + server-recomputed promo/loyalty/tax/tip/
gift); IDOR checks via `authorizeAppointment`; service-role-only writes for public surfaces;
never-capture-more-than-authorized; layered idempotency; live-mode payout safety; filter-injection
avoidance (scoped `.eq()` dedup, not interpolated `.or()`); generic client errors + detail to
`error_logs`; input length backstops (`phase45`/`phase46` + `clampLen`).

### 4.9 Admin area

Pages under `/admin/**` guarded client-side (`admin/layout.tsx` → `/admin/login` if not
super_admin; login page signs the user back out if role ≠ super_admin). API under `/api/admin/**`
gated by `requireSuperAdmin` (`admin-auth.ts`). Every mutating admin action is logged via
`logAdminAction` (best-effort). ⚠️ `super_admin` is only settable manually in the Supabase
dashboard — no code path grants it.

---

## 5. Data model & schema

**Source-of-truth ranking:** `src/lib/database.types.ts` (most current row shapes) →
`supabase/migrations/**` (60 phase files, the real prod evolution) → `supabase/schema.sql`
(**stale** — predates almost all phase work; missing the entire payment/Stripe/subscription
surface). `phase32_document_drift_columns.sql` exists because code wrote to columns that were
hand-added to prod out-of-band. **Treat schema.sql as a floor, not the truth.**

### 5.1 Table inventory

**Core** (schema.sql, extended by migrations): `users` (role CHECK), `shops` (tenant),
`barbers`, `time_slots` (weekly hours), `services`, `appointments`, `clients` (CRM),
`transactions` (money ledger), `inventory`, `staff_hours` (timesheet), `loyalty_rewards`,
`waitlist` (walk-in queue), `promo_codes`, `notifications`, `reviews`, `plans` (admin-editable
tiers), `messages`.

**Added only by migrations**: `appointment_waitlist` ("notify me when a spot opens" — distinct
from walk-in `waitlist`), `time_off_requests`, `barber_breaks`, `gift_cards`, `campaigns`,
`promo_redemptions`, `platform_settings`, `admin_audit_log`, `shop_admin_meta`, `error_logs`,
`call_logs` (AI phone), `signup_codes`, `plan_coupons` + `plan_coupon_redemptions`. Storage
buckets: `shop-logos`, `barber-photos`.

### 5.2 `shops.booking_settings` (JSONB) — the booking-policy blob

Known keys (`settings/page.tsx:26-50`): `no_show_protection`, `no_show_fee_percent`,
`auto_confirm`, `advance_days` (default 15), `cancellation_hours` (default **2** since phase48),
`slot_interval_minutes` (15/30), `tips_enabled`, tax config (`tax_enabled/tax_rate/tax_label/
tax_number` + provincial `pst_*`), `deposit`/`deposit_amount`, `loyalty:{enabled,
points_per_visit, points_per_dollar}`. ⚠️ **`bookings_paused` is a column on `barbers`, NOT a
`booking_settings` key.**

### 5.3 Notable columns

- **shops**: `stripe_account_id` (Connect), `stripe_customer_id`/`stripe_subscription_id` (own
  ClipWise sub — NULL = trial), `subscription_status` (active/cancelled/past_due/inactive),
  `subscription_plan` (starter/pro/premium/business — CHECK dropped so admin can add tiers),
  `stripe_connected`/`stripe_connect_status`, `trial_ends_at`, `trial_used` (permanent
  anti-restart flag), `timezone` (default America/Toronto), AI-phone cols.
- **appointments**: `payment_status` (**no DB CHECK** — 8-value union enforced in app code),
  `payment_intent_id`, `stripe_checkout_session_id`, `no_show_fee_amount` (cents),
  `stripe_customer_id`/`stripe_payment_method_id` (save-card), `tip_amount`/`tax_amount`
  (`total_amount` **includes** tax), `loyalty_awarded`, `paid_at`, `duration_minutes`,
  `client_id`, `source` (phone_ai/online/in_person), `gift_applied`.
- **transactions**: `amount` (pre-tax), `tip`, `tax`, `commission_amount`, `stripe_fee` (real
  fee, split 50/50 barber/shop), `payment_method` (card/cash/online), `type` (service/product/
  tip), `source` (pos/completion/no_show/gift_card_sale), `refunded`, `payment_intent_id`,
  `stripe_session_id` (unique — POS dedup), `barber_id`.
- **barbers**: `commission_percent` (default 50), `permissions` (JSON), `bookings_paused`.

### 5.4 Notable CHECK constraints

`notifications.type` ∈ `booking|cancellation|no-show|review|inventory|system` (other values
throw). `users.role`, `appointments.status` (pending/confirmed/completed/cancelled/no-show),
`clients.tag` (New/Returning/VIP/At Risk), `reviews.rating` 1–5, `transactions.type`/
`payment_method`, plus length CHECKs (phase45/46). `appointments.payment_status` has **no** CHECK.

### 5.5 Relationships

Everything is tenant-scoped by `shop_id`. `shops.owner_id→users`; `barbers.{shop_id,user_id}`;
`appointments.{shop_id,barber_id,service_id,customer_id,client_id}`;
`transactions.{shop_id,appointment_id,barber_id}`; `notifications.{user_id,shop_id}`;
plus the feature tables (gift_cards, promo_redemptions, call_logs, time_off_requests, etc.) all
`shop_id`-scoped. Integrity guards (triggers): `clipwise_prevent_overlap`, the double-booking
unique index, and the role/shop/barber escalation guards.

### 5.6 ⚠️ Pending prod migrations (code degrades gracefully; feature silently no-ops until run)

`phase8` (`loyalty_awarded`), `phase13` (`paid_at`), `phase14` (`duration_minutes`),
`phase49` (`trial_used`), `phase50` (`gift_applied`). Run these in the Supabase SQL Editor. See
`TODO.md` §2 for the authoritative list.

---

## 6. Plans, feature gating, billing & subscriptions

### 6.1 Plan tiers

Primary tiers: **Starter / Pro / Premium** (a 4th, **Business**, exists but is seeded
inactive). The `plans` table (`phase9_pricing_plans.sql:19-32`) is the source of truth —
admin-editable columns: `price_cents`, `barber_limit` (NULL = unlimited), `features text[]`,
`highlights`, `badge`, `is_active`, `sort_order`. Public may read only active rows; only
`is_super_admin()` may write.

Seeded: `starter` $0 / 1 barber / no features · `pro` **$23** / 4 barbers /
`{payments,loyalty}` · `premium` **$49** / 9 barbers /
`{payments,loyalty,pos,inventory,staff_portal,commission}` · `business` $199 / unlimited
(inactive). Code-default fallback `DEFAULT_PLAN_CONFIG` (`validation.ts:136-142`) is used only
when the DB isn't hydrated; `MAX_LOCATIONS = 5` is a hard ceiling.

> ✅ **Resolved (2026-08-12):**
> 1. **Premium price** — confirmed **$79/mo**. The code already said $79 (`stripe.ts:51`,
>    `DEFAULT_PLAN_CONFIG`); only the phase9 seed said $49. `phase51_fix_premium_plan.sql`
>    (bundled in `RUN-ON-PROD-2026-08-12.sql`) sets the live `plans` row to `price_cents = 7900`.
>    Run it on prod.
> 2. **`multi_location` on Premium** — the app now gates multi-location on
>    `planAllowsMultiLocation()` = `getLocationLimit(plan) > 1` OR the feature flag
>    (`validation.ts`), so Premium keeps its 2 locations even if the admin `plans` row's
>    `features` array drops the flag. phase51 also adds the flag to the DB row for a clean admin
>    view. (Both `add-location/route.ts` and `settings/page.tsx` use the new helper.)

### 6.2 Hydration (the sync gating config)

Gating helpers in `validation.ts` are synchronous and read an in-memory `planConfig` that must
be hydrated first. **Server**: `ensurePlansHydrated()` (`plans-server.ts:38-42`, 60s-cached DB
read) at the top of every gating route. **Client**: `AuthProvider` fetches `/api/plans` on mount
(`auth-context.tsx:68-79`). `hydratePlanConfig` merges DB rows OVER defaults and ignores empty
input so a bad fetch never opens gating.

### 6.3 Feature gating

- `PlanFeature` = `payments | loyalty | pos | inventory | staff_portal | commission |
  multi_location`.
- `effectivePlan(plan, subscriptionStatus)` (`validation.ts:189-193`) — the linchpin: returns
  `starter` unless `subscriptionStatus === "active"`, so any expired/cancelled/past_due paid
  plan **downgrades to starter**. Nearly every gate wraps this.
- `planHasFeature(plan, feature)` and `isPaidPlan(plan)` (`plan !== "starter"`, gates SMS,
  reviews, marketing, analytics, waitlist, the barber portal).

**Enforcement is defense-in-depth, 3 layers:** (1) sidebar hides nav by `effectivePlan`; (2)
page-level `FeatureLock` (a hidden nav link alone doesn't stop a direct URL visit); (3) **server
routes** call `ensurePlansHydrated()` then re-check and 403 — the true security boundary.

Feature → capability: **payments** gates all card/online charge routes + Connect card;
**loyalty** gates loyalty + gift cards; **pos**/**inventory**/**commission** gate their pages;
**multi_location** gates add-location; **isPaidPlan** gates analytics/marketing/waitlist/reviews/
customer-SMS/barber-portal.

### 6.4 The trial (21-day, no-card)

Model: `subscription_status='active'` + `trial_ends_at = now+21d` + `stripe_subscription_id =
NULL` (the NULL sub id marks it a trial). Because status is "active", `effectivePlan` grants all
the plan's features during the trial. `TRIAL_DAYS = 21`. Granted at onboarding
(`shops/create`) or in-dashboard (`shops/start-trial`). **Anti-restart:** `trial_used` (permanent
boolean, `phase49`) — `start-trial` blocks a second trial if `trial_used` OR `trial_ends_at` is
set OR a sub already exists. Expiry/reminders run on the daily cron (`process-trials.ts`):
reminders at 7/3/1 days, expiry downgrades to `inactive` (status-guarded against racing a
just-subscribed shop).

### 6.5 Subscription lifecycle

- **Subscribe/upgrade** — `stripe/checkout` (`mode: "subscription"`, dynamic `price_data` in CAD,
  price from the DB plan). Labels the Stripe customer with the shop's business name so invoices
  read the shop. Honors a remaining no-card trial via `trial_end`.
- **Activation** — `confirm-subscription` (called on `?upgraded=1`) verifies the session belongs
  to the caller, applies `active` + new sub/customer id + `trial_ends_at=null` + plan to **ALL**
  the owner's shops (they share ONE subscription), cancels the old sub, and **re-attaches the
  $30 location + $15 AI-phone add-ons**. Idempotent — works even if the webhook isn't wired.
- **Billing page** — `billing/route.ts` maps Stripe status, picks the **plan** line item (not
  `[0]`, which could be an add-on), reads the card via a 3-tier fallback, and self-heals Connect
  status. Scoped to the **active** shop (`?shop_id`), which fixed a multi-location bug where a
  connected shop wrongly read "Not connected".
- **Card update** — `billing-portal` opens the Stripe Customer Portal directly on the card-update
  screen (`flow_data.type='payment_method_update'`), returns `?card_updated=1`, then
  `notify-card-updated` emails a confirmation.
- **Cancel/resume** — `cancel-subscription` (`cancel_at_period_end` by default; keeps access
  until period end), `resume-subscription`. ⚠️ **Inconsistency:** billing GET targets the
  **active** shop, but cancel/resume/checkout target the **newest** shop and billing-portal
  targets "any shop with a customer id" — safe because all locations share one subscription, but
  worth knowing.
- **Webhook** (platform account) handles `checkout.session.completed` (subscription),
  `customer.subscription.updated/deleted`, `account.updated`.

### 6.6 Multi-location & the AI-phone add-on

**Multi-location** (`shops/add-location`): requires an active sub with `multi_location`; extra
locations beyond the included limit are a **$30/mo add-on** reconciled on the existing sub
(bill-first-then-create with rollback; needs `agree_addon`). Each new location **shares the one
subscription** but gets its **own Connect account** — booking money stays separate per location.

**AI phone** (ClipWise Business Number, `phase39`): a **$15/mo add-on** (`AI_PHONE_ADDON_CENTS`,
`stripe-addons.ts`) riding the owner's existing CAD sub. `ai-phone/provision` (owner-only,
requires active paid sub + `agree_addon`, bill-first-then-buy-the-Twilio-number with rollback)
sets `ai_phone_enabled` + `ai_phone_plan_active`. `ai-phone/release` fully tears it down. Because
a plan switch creates a fresh sub (dropping add-on items), **both** activation paths re-attach the
$15 item if any of the owner's shops still has `ai_phone_plan_active` — otherwise the owner keeps
the feature but stops paying (silent revenue leak).

### 6.7 Revenue separation (platform vs shops)

Two entirely separate Stripe flows: **subscription revenue → ClipWise's platform account** (no
`stripeAccount` context); **booking/POS/tip/gift money → each shop's own Connect account**
(`{ stripeAccount }` direct charges, each location its own account, balances never mix).
`STRIPE_LIVE_MODE` blocks the platform-charge fallback with real money so customer funds can never
land in the platform account.

---

## 7. Notifications, email, SMS, realtime & cron

### 7.1 In-app notifications

Table `public.notifications` with **type CHECK** ∈ `booking|cancellation|no-show|review|
inventory|system` (other values throw). Evolved by `phase12` (added to the realtime publication),
`phase16` (`entity_type`/`entity_id` → inline Approve/Decline links), `phase32` (`shop_id` +
backfill). **Reads** are client-safe (`notify.ts` — `fetchShopNotifications` scopes via
`.or('shop_id.eq.<id>,shop_id.is.null')` so legacy NULL rows stay visible); **writes** are
server-only (`notify-server.ts` `insertNotifications`, imports `supabaseAdmin`, column-drop retry).
The split exists so `supabaseAdmin` never enters a browser bundle. 20+ callers write notifications
(booking, cancellation, payment, review, time-off, waitlist, POS, trial…).

**Live pop-ups + chime** — `notification-listener.tsx` (mounted per portal, not root) subscribes
to INSERTs on `notifications` filtered by `user_id`, gates per-shop client-side via
`notifBelongsToShop`, toasts (last 4), and plays a **WebAudio chime** (no asset — two sine
oscillators 880→1180 Hz, lazily resumed on first user gesture). Mute preference in localStorage
`cw_notif_sound`. Tap routing (`popupHref`) sends barbers to `/barber-dashboard/*`, owners to the
actionable owner page.

### 7.2 Email — Resend

`sendAppEmail(type, data)` (`emailer.ts:902-1218`) is the single build+send entry point, callable
two ways: over HTTP via `/api/send-email` (which adds the privileged-type auth gate) or in-process
from trusted server code (cron, webhooks, finalize — no HTTP hop, so it can't silently fail when
`CRON_SECRET` is unset). ~45 template types (booking_confirmation, appointment_reminder,
review_request, payment_link, payment_receipt, subscription_card_updated, new_booking_owner/barber,
refund_issued, waitlist_slot_open, trial_reminder/ended, signup_code…).

Security notes: `PRIVILEGED_EMAIL_TYPES` (marketing, direct_message, invites, password resets,
payment_link, waitlist, review/no-show/rebooking, trial) are gated **only at the HTTP boundary**;
untrusted free-text is `escapeHtml`'d; `review_request` dedups; owner-customizable templates
(booking_confirmation, appointment_reminder, appointment_rejected) read from
`shops.notification_templates`. Reply-To routes customer/barber mail to the shop, admin mail to
ADMIN. **Email is NOT plan-gated — Starter is email-only.** Helpers: `notify-booking-emails.ts`
(`sendCustomerBookingEmail`, `sendNewBookingStaffEmails`).

### 7.3 SMS — Twilio (paid-plan feature)

`twilio.ts`: `getTwilio()` (lazy, returns null when unconfigured), `sendSmsBestEffort(to, body,
shopName?)` (fire-and-forget, never throws, prepends `"<shopName>: "`, logs the *reason* on skip
but never the number). **GSM-7 concern:** reminder bodies stay ASCII to fit one segment; a curly
quote/emoji forces UCS-2 and halves capacity. The authenticated relay `/api/twilio/send-sms` is
rate-limited, **staff-only + shop-scoped** (`authorizeShop` — closes a former open-relay/toll-fraud
hole), and paid-plan-gated (free shops get a quiet `skipped`). Inbound `/api/sms/incoming` verifies
the Twilio signature and replies with the shop's booking link. Flows that text the customer:
booking confirmation (now including **staff-created** bookings — this session), payment links,
24h/2h reminders, waitlist seat/slot-opened, cancellations, AI-phone confirmations.

### 7.4 Realtime — Supabase `postgres_changes`

~18 channels across the app (Payments `payments:${shop.id}` with an 800ms debounce; dashboard
`booking-notifs`; sidebars `notifications:${user.id}`; calendar; messages; clients; staff; both
waitlists; time-off; barber earnings; public booking `book_slots`; subscription `shop-sub-`).
**Gotcha:** `postgres_changes` supports only simple equality filters (no OR/null), so shop-scoping
for the shared-`user_id` notification tables is done **client-side** (`notifBelongsToShop` /
recompute). The `notifications` table only receives realtime because `phase12` added it to the
`supabase_realtime` publication.

### 7.5 Cron

`vercel.json` registers exactly **one** cron: `/api/cron/reminders` **daily** at `0 13 * * *`
(Hobby-plan limit — sub-daily crons silently block ALL deploys). Auth via `x-cron-secret ===
CRON_SECRET`. It runs `processTrials` (trial reminders + downgrades) then per-shop auto-tagging +
gated reminders (`MAX_SENDS = 300` cap, all date math in the shop's timezone): 24h reminders
(active), a **2h reminder block that stays dormant** on a daily cron (a frequency gate auto-activates
it under a `*/15` schedule or external scheduler with no code change; idempotent via a per-shop
checkpoint), plus rebooking/win-back/birthday nudges. A separate legacy `/api/reminders` exists
(HTTP-hop email, UTC date math) — prefer `cron/reminders`.

### 7.6 AI phone / voice

`/api/voice/incoming` (Twilio webhook, signature-verified) resolves the shop by the called number;
if `ai_phone_enabled` + a ConversationRelay URL is set it hands the call to the always-on voice
server (STT/LLM/TTS + live booking), else logs a `missed` `call_log` and texts a booking link. The
`/api/ai-phone/**` routes (secret-gated by `x-ai-phone-secret`) provide `availability` (reads the
public `/api/availability`, returns human-readable text the AI reads out), `book` (creates a
`source:'phone_ai'` confirmed pay-in-person appointment, honoring the DB double-booking trigger),
`provision`, and `release`.

---

## 8. Ancillary features

> Structural note that recurs: money-writing routes run with the **service role** because
> `transactions`/`waitlist`/`appointment_waitlist`/`reviews` have **no owner/anon INSERT RLS** on
> purpose — so each route re-authorizes the caller itself and most use **progressive column-drop
> retry** so a sale is never lost against a prod DB that lags a migration.

- **POS / walk-in sales** (`dashboard/pos`, Premium-gated) — 2-step checkout (tender → tip →
  charge). Card → `pos-checkout`/`pos-finalize` (Connect required, idempotent on
  `stripe_session_id`); cash/gift → `pos/cash-sale` (service role). **Commission is services-only,
  after discount, barber-assigned** (`pos/page.tsx:363-380`) — a tally, not a payout. **POS
  promos are now enforced server-side** (2026-08-12): the code is validated before charging
  (`pos-checkout` / `cash-sale` via `fetchValidPromo` + `promoBlockReason`) and consumed once the
  sale settles (`pos-finalize` / `cash-sale` via `consumePromo`, `appointment_id` null), so
  caps/expiry/once-per-customer are real and usage draws down — matching the booking flow.
  ⚠️ Remaining gotchas: cash amount is still computed client-side; split gift+card isn't
  supported; `finalizedRef` guards double-finalize (cash has no idempotency key).
- **Gift cards** (loyalty-gated) — minted **on payment confirmation**, never at checkout start.
  Four sale paths (public online, owner charge/send-link, owner cash) converge on one code
  generator + email. **Not taxed at purchase**; redemption is **cash-like tender** reducing amount
  due (`redeemGift` uses a compare-and-swap draw-down so a card can't discount two concurrent
  bookings). Booking redemption is stored on `appointments.gift_applied` (phase50) and subtracted
  from counted revenue to avoid double-count.
- **Loyalty** (loyalty-gated) — config in `booking_settings.loyalty`. Auto-earn on completion is
  **idempotent** via `appointments.loyalty_awarded` (atomic claim in `completion-server.ts`).
  Manual add/redeem + customer self-redeem at booking, all **server-authoritative**
  (`loyalty-redeem.ts` — `MIN_REDEEM_DOLLARS = 5`, caps discount at pre-tax total). Two award
  callers (route + webhook) share `awardLoyaltyForAppointment`.
- **Waitlist — two distinct tables:** `waitlist` (today's in-person **walk-in queue**) vs
  `appointment_waitlist` (**smart/online** "notify me when a full future day frees up"). Owner-only
  RLS → service-role routes: `join` (public opt-in), `accept` (convert smart row → appointment),
  `seat` (walk-in → today's schedule; a barber may only seat to themselves), `slot-opened`
  (fire-and-forget notify when a slot frees, marks `notified` so a 2nd cancel doesn't re-spam). The
  shared `waitlist-assign-sheet` component serves both.
- **Reviews** — post-visit 1–5★ from an emailed link keyed by the appointment UUID. `submit`
  (public, rate-limited) dedups one review per client (link-replay guard) and **recomputes the
  barber's `rating` + `total_reviews`** on each submit (no trigger). Review requests are sent as a
  completion side-effect (`completion-server.ts`), not from this module.
- **Clients** — the single client book (source of truth for POS, loyalty, marketing, messages).
  Identity dedup is always **email(`ilike`) → phone**; a name-only walk-in is intentionally never
  persisted. `appointments.client_id` (phase36) is the permanent link; `ensure-client.ts` /
  `clients/upsert` create/resolve.
- **Promo / coupons — two unrelated systems:** **promo codes** (customer discounts,
  `promo_codes`/`promo_redemptions`, server-authoritative in `promo.ts` — cap +
  once-per-customer + optimistic `uses_left` draw-down) vs **plan coupons** (owner comp codes
  granting free Pro/Premium days, `coupons/redeem` → `grantFreeDays`).
- **The rest, briefly:** **Marketing** (segment the client book → email blast → `campaigns`);
  **Messages** (two-way SMS inbox over `messages` + Twilio); **Inventory** (retail products POS
  draws down + low-stock alerts); **Kiosk** (tablet self-service walk-in → `waitlist` queue);
  **Check-in** (clock-in/out → `staff_hours`, Face ID/fingerprint on native via `biometric.ts`);
  **Tax** (configured in Settings; all math in `pricing.ts` — a shop charges tax only when
  `tax_enabled` **and** a valid GST/HST number is on file; tax after discount, tips never taxed);
  **Payroll** (per-barber revenue + commission + hours, CSV export); **Staff** (barbers, invites,
  permissions, seat limits); **Schedule** (weekly hours, 15/30-min granularity); **Time-off**
  (day_off/vacation/blocked_hours/sick → removes availability).

---

## 9. The money model, in one place

The single most important mental model — and the one most likely to be asked about. Consolidated
from `src/lib/revenue.ts`, `src/lib/barber-earnings.ts`, and the customer-facing `/support` page.

### 9.1 Three revenue definitions

- **Gross** — everything collected, **including tax + tips, before Stripe fees**. This is the
  shop's revenue for tax purposes.
- **Collected** — Gross **minus Stripe fees** = what actually lands in the shop's Stripe balance.
  Matches Stripe. This is the headline on the Dashboard revenue card and Payments.
- **Net revenue** — what the shop **keeps** = `Collected − sales tax − tips − barber commission`.
  The full waterfall (Dashboard card + Analytics "Where the money goes").

The Stripe fee is a **deductible expense**, not a reduction of revenue. Sales tax is computed on
what the customer was charged (after discount), never after fees.

### 9.2 The shared calculators

- `collectedTotals(appts, txs, byPi)` (`revenue.ts`) — the ONE definition of collected revenue,
  mirrored by the Payments page so they agree to the penny. `byPi` (paymentIntent →
  `{gross, fee, net}`) comes from `/api/stripe/payments-summary`. `countablePosTxs` de-dups POS
  txs against appointments and drops `source:"completion"` rows. `lineNetFee` is the one place
  Stripe fees apply (exact from `byPi`, else net=gross for cash/unsynced).
- **Gift** is subtracted (counted once at gift sale, not again at redemption). **Tips** are added
  into Gross so `gross ≥ net` always.

### 9.3 Barber commission & earnings — ONE source (the transactions ledger)

The rule established this session: **barber pay comes from one source** — that barber's
`transactions` rows — read by every screen through `barber-earnings.ts`:
- `computeBarberEarnings(txs, pct)` — the barber's take-home = commission + tips − their half of
  the card fee. Used by the barber's **own portal** (`/api/barber/earnings`) AND the owner's
  **Payments page when filtered to one barber** (an exact mirror).
- `shopBarberCommission(txs, pctByBarber)` — the shop-wide commission tally used by the
  **Dashboard** revenue card and **Analytics** waterfall. Only rows with a `barber_id` count
  (gift/product/no-barber sales carry no barber → shop revenue, no commission). commission =
  stored `commission_amount` (POS) else `amount × pct` (appointment-completion rows store no
  `commission_amount`, so they fall back to the barber's rate × service).

**Model rules:** commission applies to **services only**, at the barber's rate, after discount —
it's a **reporting tally, not an automatic payout** (ClipWise never moves it; the owner pays the
barber separately). **Tips are 100% the barber's**, always, on top. The **shop eats the Stripe
fee** on the owner's Net-revenue side (Gross − fee = Collected, then commission is on the service
price); the barber portal separately applies a 50/50 fee split to the barber's *take-home* display
(intentionally left unchanged). Owner-barber commission defaults to **0%** (his services stay as
shop revenue until he sets a rate). The barber side is **Pro/Premium only** (Starter has no barber
portal).

### 9.4 Where each number surfaces

- **Dashboard revenue card** (`stats-carousel.tsx`) — Gross → − Stripe fees → Collected → − tax →
  − tips → − barber commission → **Net revenue** (zero lines hidden so a solo/cash shop stays clean).
- **Payments** (`dashboard/payments`) — "Shop (all barbers)" shows Collected + payouts; filtered to
  a barber, it flips to that barber's take-home, mirroring their portal.
- **Analytics** (`dashboard/analytics`) — the "Where the money goes" waterfall card + KPI tiles
  (Gross sales = before Stripe fees).
- **Customer-facing** — `/support` ("How Payments Work") explains all of the above in plain
  language.

---

*End of knowledge book. Keep it current: when a subsystem changes materially, update its section
and bump the "Last mapped" date at the top.*
