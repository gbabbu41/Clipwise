# ClipWise — Market-Ready TODO

Status snapshot (2026-06-07): core app is real (real Supabase, Stripe test mode,
Twilio, Resend). Demo-mode leftovers removed. Below is what's left to ship and grow.

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
- [ ] **Go live on Stripe** when ready: swap `sk_test_/pk_test_` for live keys in Vercel,
      and have each shop owner complete **Stripe Connect** onboarding (Billing page).
- [ ] **Run pending SQL** in Supabase → SQL editor (see section 4).
- [ ] **Email domain**: `FROM_EMAIL=Hello@clipwise.ca` — verify the domain in Resend and
      set up inbox/forwarding so replies don't bounce (MX / Cloudflare Email Routing).

---

## 🗄️ 2. Pending SQL migrations (Supabase SQL editor)
- [ ] **Phase 1 no-show fee column** (`supabase/migrations/phase1_no_show.sql`):
      ```sql
      alter table public.appointments add column if not exists no_show_fee_amount integer;
      ```
- [ ] *(optional)* **Per-visit reviews** — reviews currently dedupe one-per-client-per-shop.
      To allow a review per appointment, add `appointment_id uuid references appointments(id)`
      to `reviews` and switch the dedupe in `/api/reviews/submit` to use it.
- [ ] *(belt-and-suspenders)* unique index on `clients (shop_id, lower(email))` to enforce
      no-duplicate clients at the DB level (app already dedupes).

---

## 💳 3. Payments — Phase 2 & 3 (no-show automation + deposits)
**Phase 1 is done**: card held at booking (≤7 days), auto-capture on Complete, manual
"Charge No-Show". Limitation: card auth holds expire ~7 days, so far-future bookings
fall back to pay-in-person.

- [ ] **Per-shop no-show settings** (Settings page → `shops`):
      `no_show_fee_enabled`, `no_show_fee_amount` (cents), `cancellation_window_hours`.
- [ ] **Auto-capture cron** (every ~30 min): for shops with the fee enabled, find
      appointments past their time + grace that weren't completed/cancelled, capture the
      no-show fee, set status `no-show`, SMS the client (Twilio is wired).
- [ ] **SMS reminder** before the cancellation window closes ("cancel before X to avoid a fee").
- [ ] **Phase 3 — deposits**: per-shop `deposit_enabled`/`deposit_amount`; charge deposit at
      booking, balance at completion; refund rules on cancel (refund outside window,
      forfeit inside).

---

## ✨ 4. Squire/Booksy-style features (competitive gaps)
- [ ] Recurring appointments ("every 2 weeks").
- [ ] Smart waitlist auto-fill when a slot frees up (notify next in line).
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
- [ ] Barbers need an **email saved** (Staff page) to receive booking notification emails.
- [ ] Audit remaining `?? "http://localhost:3001"` fallbacks in email/cron routes — fine once
      Vercel env is set, but consider a single shared `appUrl()` helper.
- [ ] Per-page custom `Toast` components are duplicated — unify (ties into sonner above).
- [ ] Status value is `confirmed` in DB but shown as "Booked" — optionally migrate the value
      app-wide for consistency (currently display-only).
- [ ] Automated birthday-email cron (currently manual trigger).
- [ ] Real SMS reminders for appointments (cron exists for email; add Twilio).

---

## ✅ Recently done (for reference)
- Real Stripe POS card payments + customer picker; booking card-hold + capture flow.
- Reviews fixed (were never saving — RLS + wrong FK); barber rating recalculates.
- Auto-register booking customers as clients (deduped); single client source.
- POS mobile redesign (app-style) + desktop side panel.
- Appointments: Booked label, date dropdown + calendar filter, open-queue default sort.
- Removed demo-mode leftovers (fake upgrade button, mock-data.ts, dead stripe-setup page).
- Hardened Stripe return URLs + webhook secret trim.
