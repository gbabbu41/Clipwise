# ClipWise — Market-Ready TODO

Status snapshot (2026-06-07): core app is real (real Supabase, Stripe test mode,
Twilio, Resend). Demo-mode leftovers removed. Below is what's left to ship and grow.

---

## 🟢 0. GO-LIVE CHECKLIST — switch from sandbox to real money
Do these **in order** the day you flip ClipWise live. Mostly key swaps, no code rewrite.

### A. Switch Stripe from test/sandbox → live (in Vercel env)
- [ ] `STRIPE_SECRET_KEY` → change `sk_test_...` to `sk_live_...`
- [ ] `STRIPE_PUBLISHABLE_KEY` / `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` → `pk_test_` to `pk_live_`
- [ ] **Recreate the webhook in Stripe LIVE mode** (sandbox webhooks do NOT carry over):
      - Stripe (live) → Developers → Webhooks → Add destination
      - URL: `https://clipwise.ca/api/webhooks/stripe`
      - **Choose "Connected accounts"** (same as sandbox — this is what makes payment
        tracking work; see section 1 🔴)
      - Events: `checkout.session.completed`, `payment_intent.succeeded`,
        `payment_intent.payment_failed`
      - Copy the new `whsec_...` → update `STRIPE_WEBHOOK_SECRET` in Vercel
- [ ] **Redeploy** in Vercel so the new keys take effect.

### B. Every shop owner must reconnect Stripe (LIVE)
- [ ] ⚠️ Sandbox Connect accounts do NOT transfer to live. After switching keys, every
      shop will show **"Restricted"** until they reconnect.
- [ ] Each owner: app → Billing → **Connect Stripe** → complete onboarding with **real**
      business info + bank account (real ID, not test data this time).
- [ ] Confirm each shop shows **"Charges enabled"** in Stripe → Connected accounts before
      relying on their payment links.

### C. Final smoke test (with a REAL card, small amount)
- [ ] Make one real booking + pay → confirm money lands in the **shop's** Stripe balance
      (0% platform fee — direct charge), and the in-app status flips to **Paid**.
- [ ] Refund that test charge from the Payments page so you're not out of pocket.

> Note: money goes **directly customer → shop owner** (connected accounts, 0% platform fee).
> You (platform) can view/suspend/pause-payout on any shop but never hold their funds.

---

## 🚨 1. Action required — config only you can do (not code)
These are the difference between "works on localhost" and "works for real customers."

- [ ] **Vercel env: `NEXT_PUBLIC_APP_URL`** → set to the real domain (e.g. `https://clipwise.ca`).
      Without it, every emailed link breaks in production: booking confirmations,
      **barber invites**, **password resets**, review links, reminders.
- [ ] **Vercel env: `STRIPE_WEBHOOK_SECRET`** → confirm it's the *live* signing secret
      with **no leading/trailing space** (code now trims it, but double-check).
- [ ] **Stripe dashboard → Webhooks** → endpoint = `https://<domain>/api/webhooks/stripe`;
      signing secret matches the env above.
- [ ] 🔴 **Webhook MUST listen to *connected-account* events** — payment links + bookings
      charge on each shop's connected account, so a normal account-level webhook never
      receives `checkout.session.completed` for them and `payment_status` never flips to
      Paid in-app. In the Stripe webhook config, enable "Listen to events on connected
      accounts" (or add a Connect webhook). This is the likely reason sent links look
      "untracked." (Workaround in-app: the Payments page "Refresh" button re-checks Stripe.)
- [ ] **Go live on Stripe** when ready: swap `sk_test_/pk_test_` for live keys in Vercel,
      and have each shop owner complete **Stripe Connect** onboarding (Billing page).
- [ ] **Run pending SQL** in Supabase → SQL editor (see section 4).
- [ ] **Email domain**: `FROM_EMAIL=Hello@clipwise.ca` — verify the domain in Resend and
      set up inbox/forwarding so replies don't bounce (MX / Cloudflare Email Routing).
- [ ] ⚖️ **Merchant-of-record / liability (pre-launch, get legal review):** ClipWise must stay
      the *platform*, with each **shop as the seller / merchant of record** — not ClipWise.
      · This is already true on Stripe **direct charges** (connected account = MoR; shop owns
        the tax, refunds, chargebacks). Keep using direct charges; the platform-charge
        fallback is now LIVE-blocked (test-only) — never let it run with real money.
      · Receipt re-skinned to lead with the SHOP as seller + "merchant of record" line;
        ClipWise only in small print as the software provider.
      · TODO before live: have a lawyer review the customer Terms + the Stripe Connect
        platform agreement so the platform-vs-seller roles are documented; confirm sales-tax
        responsibility sits with the shops; make sure no ClipWise tax IDs / "we sold this"
        language appears on customer-facing payment docs.
- [ ] **Receipts — later move to Stripe-native (optional):** the app currently sends its own
      branded `payment_receipt` email via Resend (works in test mode, fired on manual capture
      AND now on payment-link webhook). Stripe does NOT auto-send receipts in test mode. When
      live, decide: keep the app's Resend receipt, OR enable Stripe's native receipts
      (Stripe Dashboard → emails: "successful payments" + set `receipt_email` on the
      PaymentIntent/session). Don't enable both or customers get two receipts.

---

## 🗄️ 2. Pending SQL migrations (Supabase SQL editor)
- [ ] 🔴 **Shop booking_settings column** (`supabase/migrations/phase5_shop_booking_settings.sql`)
      — **CRITICAL, run this first.** `shops.booking_settings` was never created in prod, so
      no-show protection/warning/hold + capture-appointment + auto-confirm + deposits all
      silently fail (capture-appointment 404s with "column shops.booking_settings does not
      exist"). Adds the JSONB column + a sane default for existing shops.
- [ ] **Phase 1 no-show fee column** (`supabase/migrations/phase1_no_show.sql`):
      ```sql
      alter table public.appointments add column if not exists no_show_fee_amount integer;
      ```
- [ ] **Phase 2 save-card columns** (`supabase/migrations/phase2_save_card.sql`) — REQUIRED
      for the >7-day save-card flow to work (without them, far-future online
      bookings can't store the card and finalize will fail):
      ```sql
      alter table public.appointments
        add column if not exists stripe_customer_id text,
        add column if not exists stripe_payment_method_id text;
      ```
- [ ] **Smart-waitlist table** (`supabase/migrations/phase3_appointment_waitlist.sql`) — REQUIRED
      for the "notify me when a spot opens" feature. Creates `appointment_waitlist`
      (customer opt-ins on full days). Without it, the booking-page "Notify me" button errors.
- [ ] **Double-booking guard** (`supabase/migrations/phase4_prevent_double_booking.sql`) —
      partial UNIQUE index on `(barber_id, date, time_slot)` for active (pending/confirmed)
      rows with a barber assigned. Stops two appointments at the same barber/time even in a
      race. ⚠️ Fails if active duplicates already exist — see the detection query in the file,
      clean them first. App also pre-checks for a friendly message (and reverses online
      payment if the slot is lost in the race).
- [ ] *(optional)* **Per-visit reviews** — reviews currently dedupe one-per-client-per-shop.
      To allow a review per appointment, add `appointment_id uuid references appointments(id)`
      to `reviews` and switch the dedupe in `/api/reviews/submit` to use it.
- [ ] *(belt-and-suspenders)* unique index on `clients (shop_id, lower(email))` to enforce
      no-duplicate clients at the DB level (app already dedupes).

---

## 💳 3. Payments — Phase 2 & 3 (no-show automation + deposits)
**Phase 1 is done**: card held at booking (≤7 days), auto-capture on Complete, manual
"Charge No-Show".
**Phase 2 (save-card) is done**: bookings >7 days out now SAVE the card (Stripe Checkout
`setup` mode, no charge) instead of holding it, and charge it off-session on Complete /
no-show. Customer must accept a no-show disclaimer before any card is taken; pay-in-person
still takes no card. Needs the `phase2_save_card.sql` migration (section 2) run.
- [ ] **Verify the live card legs** (needs a human + test card `4242…`): (a) >7-day booking
      saves the card and finalizes, (b) Complete charges the saved card, (c) no-show cron/
      manual charge hits the saved card. Off-session charges can hit `authentication_required`
      (SCA) — for CA cards this is rare; failures flag the row `payment_status=failed`.

- [x] **Per-shop no-show settings** — Settings → Booking → "No-Show Protection" toggle +
      "No-Show Fee ($)" (0 = full). Stored in `shops.booking_settings` JSON.
- [x] **Auto-capture cron** — `POST/GET /api/cron/no-show` captures the held card ~2h after
      a missed appointment, sets status `no-show`, SMSes the client (Twilio inlined).
      - [ ] **SCHEDULE IT**: `vercel.json` has a `*/30 * * * *` cron (needs Vercel **Pro**).
            On Hobby, instead point an external scheduler (cron-job.org / GitHub Actions) at
            `https://<domain>/api/cron/no-show` with header `x-cron-secret: <CRON_SECRET>`.
      - [ ] Note: slot times are parsed in server (UTC) time — fine with the 2h grace, but if
            shops span timezones, store/compare an explicit tz later.
- [ ] **SMS reminder** before the cancellation window closes ("cancel before X to avoid a fee")
      — not built yet (separate from the no-show capture).
- [ ] **Phase 3 — deposits**: per-shop `deposit_enabled`/`deposit_amount`; charge deposit at
      booking, balance at completion; refund rules on cancel (refund outside window,
      forfeit inside).

---

## ✨ 4. Squire/Booksy-style features (competitive gaps)
- [x] Recurring appointments ("every 2 weeks") — Add-Appointment modal has a Repeat
      option (weekly/biweekly/4-weekly, N visits) that creates one row per occurrence.
- [x] Smart waitlist auto-fill when a slot frees up — booking page "Notify me if a spot
      opens" on full days → `appointment_waitlist`; cancel/reject/no-show/refund fire
      `/api/waitlist/slot-opened` which emails + texts waiters. (Needs phase3 migration.)
- [ ] Rebooking nudges for at-risk clients (already have the data + SMS/email).
- [ ] Richer client "memory": hair profile surfaced in POS + appointment view.
- [ ] Marketing/SMS campaigns (broadcast offers, birthdays — birthday email exists, automate it).
- [ ] Google Business review sync (Place ID field exists).

---

## 🎨 5. Modern UX + libraries
- [ ] Adopt a component lib (shadcn/ui) for consistent dialogs/tables/forms.
- [ ] `sonner` for toasts (replace the per-page custom Toast components).
- [ ] `framer-motion` for transitions (drawer, modals, page changes).
- [ ] Proper data tables (sorting/pagination) on clients/appointments/analytics.

---

## 🧹 6. Smaller polish / known gaps
- [ ] Barbers need an **email saved** (Staff page) to receive booking notification emails
      (incl. the new cancel/no-show alerts).
- [ ] ⚠️ Twilio is on **trial** — SMS only reaches *verified* numbers until you upgrade +
      finish A2P/number registration. Verify before relying on customer texts in production.
- [ ] Audit remaining `?? "http://localhost:3001"` fallbacks in email/cron routes — fine once
      Vercel env is set, but consider a single shared `appUrl()` helper.
- [ ] Per-page custom `Toast` components are duplicated — unify (ties into sonner above).
- [ ] Status value is `confirmed` in DB but shown as "Booked" — optionally migrate the value
      app-wide for consistency (currently display-only).
- [ ] Automated birthday-email cron (currently manual trigger).
- [ ] Real SMS reminders for appointments (cron exists for email; add Twilio).

---

## ✅ Recently done (for reference)
- **Stripe "Restricted" warning** — dashboard-wide orange banner (StripeWarningBanner) shown
  to owners on a payments-capable plan whose Connect account isn't charge-enabled yet. Does a
  live `/api/stripe/connect/status` check so a stale flag can't hide it. Prevents the failed-
  payment situation hit with the Bloke Boyz shop.
- **Recurring appointments** — Repeat dropdown in the Add-Appointment modal.
- **Smart waitlist** — customer "Notify me if a spot opens" on full days + auto email/SMS to
  waiters when an appointment is cancelled/rejected/no-showed/refunded. Owner view at
  `/dashboard/waitlist-requests` (Operations → Spot Waitlist): per-day queue, manual "Notify
  all", mark booked / remove. Needs phase3 migration.
- **Payments page** (`/dashboard/payments`, owner) — unified ledger of appointment payments
  + POS sales with status filters + totals (collected / outstanding / held-saved). One-click
  "Open Stripe Dashboard" (Express login link via `/api/stripe/dashboard-link`), per-row
  "Refresh" to re-check Stripe when the webhook missed (`/api/stripe/refresh-payment`), and
  "Send link" for outstanding rows. Sidebar → Operations → Payments (owner, payments feature).
- Barber now emailed on cancel / reject / no-show (new `/api/appointments/notify-cancellation`
  + `barber_appointment_change` template). Customer now gets booking-confirmation SMS (online
  + in-person) and 24h reminder SMS (reminders route now sends email + SMS).
- Customer payment-receipt email on every card charge (held capture, saved-card charge,
  no-show fee) — wired server-side in capture-appointment + no-show cron. Owner gets an
  in-app "card charge failed" alert when an off-session charge fails.
- Save-card flow for bookings >7 days out (Checkout setup mode → off-session charge on
  Complete/no-show) + mandatory no-show consent disclaimer on the card path.
- Real Stripe POS card payments + customer picker; booking card-hold + capture flow.
- Reviews fixed (were never saving — RLS + wrong FK); barber rating recalculates.
- Auto-register booking customers as clients (deduped); single client source.
- POS mobile redesign (app-style) + desktop side panel.
- Appointments: Booked label, date dropdown + calendar filter, open-queue default sort.
- Removed demo-mode leftovers (fake upgrade button, mock-data.ts, dead stripe-setup page).
- Hardened Stripe return URLs + webhook secret trim.
