# ClipWise — Test Plan 2 (full day-to-day + database integrity)

Deeper pass than `TEST-PLAN.md` (which is the P0 money/booking/auth critical paths).
This one exercises the **everyday portal features** and checks that the **database**
stays correct after each action.

## Setup
- **Test-shop owner login:** shared privately (from the session link / ask the owner) —
  intentionally **not** stored in the repo.
- Everything in **Stripe TEST mode**. Cards: `4242 4242 4242 4242` (ok),
  `4000 0000 0000 0002` (decline), `4000 0027 6000 3184` (auth-required).
- Use a **throwaway test shop**, not a real one.
- After key actions, confirm the **DB row** matches the UI (Supabase → Table editor
  or a `select`). The point is: UI says X → DB actually stored X.

---

## A. Daily booking operations
- [ ] Create booking (owner side) → appears on calendar + appointments list.
- [ ] **Edit / reschedule** (change time and barber) → moves on calendar; customer gets
      an "updated" email **and** SMS; no double-booking created.
- [ ] **Approve** a pending booking → status `confirmed`; customer notified.
- [ ] **Reject** a booking → status `cancelled`; slot frees; customer notified.
- [ ] **Complete** a booking → status `completed`; client visit/spend totals bump.
- [ ] **No-show** a booking → status `no-show`; stays visible as a faded marker.
- [ ] Calendar: multi-barber columns line up; day/week views correct; blue = completed only.
- [ ] Cancelled/no-show markers show as dismissible "book again" (dismiss = this device).

## B. POS & money (each writes a `transactions` row)
- [ ] **Cash sale** → recorded; `payment_method=cash`, `source=pos`.
- [ ] **Card sale** (test card) → `payment_method=card`; shows in Payments feed.
- [ ] **Product sale** → inventory quantity **decrements**; low-stock alert fires at threshold.
- [ ] **Gift card**: sell one, then redeem it on a sale → balance draws down; can't overspend.
- [ ] **Tip** on a sale → tip stored separately; **tip is never taxed**.
- [ ] **Tax**: only applied when a GST/HST number is set; rate matches settings.
- [ ] Re-submit the **same** POS sale (double-click / retry) → **no duplicate** transaction.

## C. Staff & permissions
- [ ] Add a barber; **commission clamps 0–100%** (can't set 150 or -10).
- [ ] Toggle a barber's `manage_appointments` OFF → they **can't** approve/complete/refund
      (server returns 403, not just a hidden button).
- [ ] Barber logs into the **barber portal** → sees only their own shop + their bookings/earnings.
- [ ] Earnings / payroll math: commission + tips correct; Stripe fee split 50/50.

## D. Clients, loyalty, marketing
- [ ] Booking auto-creates/links a **client** row (by email/phone); no duplicate clients.
- [ ] Client tags update (New / Returning / VIP / At-Risk) per visit count + recency.
- [ ] **Loyalty earn** on completion (needs `loyalty_awarded`) → points added once, not twice.
- [ ] **Loyalty redeem** at booking → discount recomputed server-side; balance deducted.
- [ ] **Promo code**: works, respects cap + once-per-customer; expired/invalid rejected.
- [ ] Marketing segments list the right clients.

## E. Settings & schedule
- [ ] **Require card** toggle on/off changes the booking flow (card vs no card).
- [ ] **Auto-confirm** on → in-person bookings skip "pending" and confirm straight away.
- [ ] Set hours / **time-off** / **breaks** → those slots disappear from the booking page.
- [ ] **Slot interval** 15 vs 30 min → booking grid + schedule dropdowns follow it.
- [ ] **Advance window** (e.g. 15 days) → customer can't pick a date past it.
- [ ] **Pause bookings** kill switch → booking page refuses new bookings.
- [ ] **Timezone**: "today", past-slot block, and reminders all use the shop's timezone.

## F. Reviews, notifications
- [ ] Leave a review → shows on the shop; **one review per client** (dupes blocked).
- [ ] Completing an already-reviewed client does **not** send another review link.
- [ ] Realtime **notification pop-up + chime** fires on new booking / payment / cancel
      (both owner and barber portals).

## G. Admin (super-admin portal)
- [ ] `/admin` loads only for a `super_admin`; a normal owner is bounced to login.
- [ ] Shops list, approve/suspend a shop, users list, activity log all load + act.
- [ ] Admin actions are written to the **activity/audit log**.

## H. Database integrity & security (the "db as well" part)
- [ ] After each money action, the `transactions` / `appointments` row has the right
      `amount`, `tip`, `tax`, `stripe_fee`, `payment_status`, `paid_at`, `source`.
- [ ] **Idempotency**: replaying a Stripe webhook / re-finalizing a session does **not**
      create a duplicate transaction.
- [ ] **RLS**: as an anonymous/logged-out user, you **can't** read another shop's
      appointments, clients, or transactions; a public shop read never returns secret
      columns (`stripe_account_id`, owner email).
- [ ] **Cross-shop (IDOR)**: shop A's login can't act on shop B's ids on any API route.
- [ ] Totals reconcile: a client's `total_spent` ≈ sum of their non-refunded sales; a
      refunded row stops counting as revenue.
- [ ] No orphans: a completed booking with a card links to its transaction + client.

---

## How to report findings
Append to `## Results` below (or a `TEST-RESULTS.md`) — for each failure:
**Section/case · Severity (P0/P1/P2) · What happened vs expected · where (route or file:line) · repro**.
One-line "✅ Section X all pass" for the good ones; detail only the failures. Commit + push.

## Results
_(none yet)_
