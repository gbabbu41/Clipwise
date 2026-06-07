# ClipWise — Session 13 Notes (2026-06-07)

Picked up after a PC restart. Two parts: (A) Stripe Connect config finished in the
dashboard, (B) three new features shipped.

---

## A. Stripe payment tracking — root cause fixed (config)

**Problem:** sent payment links / bookings looked "untracked" in-app.

**Why:** payment links + bookings charge on each shop's **connected account**. A normal
account-level webhook never receives their `checkout.session.completed`, so
`payment_status` never flips to **Paid**.

**Done this session:**
- Created a **sandbox webhook that listens to CONNECTED-ACCOUNT events** at
  `https://clipwise.ca/api/webhooks/stripe`
  (events: `checkout.session.completed`, `payment_intent.succeeded`,
  `payment_intent.payment_failed`).
- Updated **`STRIPE_WEBHOOK_SECRET`** in Vercel with the new `whsec_…`.
- Webhook handler code was already correct — no change needed.

**Key facts (for future me):**
- Connected accounts pay **directly customer → shop owner, 0% platform fee**. Platform can
  view / suspend / pause-payout but never holds the funds.
- A shop showing **"Restricted"** in Stripe = onboarding incomplete = its payments fail
  (charge has nowhere valid to land; the platform-charge fallback only kicks in when
  `stripe_connected` is false). Fix: owner completes Connect onboarding from **Billing**.

See `TODO.md` **section 0 — GO-LIVE CHECKLIST** for switching sandbox → live.

---

## B. Features shipped (TypeScript + ESLint clean)

### 1. Recurring appointments
- `dashboard/appointments` → Add Appointment modal has a **Repeat** dropdown
  (none / weekly×4 / every-2-weeks×4 / every-2-weeks×6 / every-4-weeks×3).
- Creates one booking per occurrence in a single bulk insert.

### 2. Smart waitlist (notify when a spot frees)
Separate from the in-shop walk-in queue.
- **Migration:** `supabase/migrations/phase3_appointment_waitlist.sql` → table
  `appointment_waitlist`. **Run this in Supabase before using the feature.**
- **Customer:** booking page shows **"🔔 Notify me if a spot opens"** on fully-booked days →
  modal collects name + email/phone → `POST /api/waitlist/join`.
- **Auto-notify:** when an appointment is cancelled / rejected / no-showed / refunded, the app
  fires `POST /api/waitlist/slot-opened`, which **emails + texts** matching waiters
  (barber = any, or the freed barber) and marks them `notified`.
- **Owner view:** `/dashboard/waitlist-requests` (sidebar **Operations → Spot Waitlist**) —
  per-day queue, manual **Notify all**, mark **Booked** / **Remove**, realtime.

### 3. Restricted-Stripe owner warning
- `components/dashboard/stripe-warning-banner.tsx` (in dashboard layout). For owners on a
  payments-capable plan, does a **live** `/api/stripe/connect/status` check and shows a
  dismissible orange banner → Billing when charges aren't enabled. Prevents customers ever
  hitting a failed payment because a shop's Stripe isn't finished.

---

## Pending / heads-up
- ⚠️ **Run `phase3_appointment_waitlist.sql`** in Supabase (waitlist won't work without it).
- Twilio is on **trial** — SMS only reaches verified numbers.
- Stripe is still on **sandbox/test** keys — see go-live checklist when ready.
