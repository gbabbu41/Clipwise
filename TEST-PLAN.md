# ClipWise â Pre-launch Test Plan (critical paths)

Shared test plan for cross-session testing (this file is the coordination bridge â
run the cases, then write results back per the protocol at the bottom).

## Ground rules
- **Run everything in Stripe TEST mode** (keys are still `sk_test_`/`pk_test_`). No real money.
- Card: `4242 4242 4242 4242`, any future expiry, any CVC, any postal code.
- Decline test: `4000 0000 0000 0002`. 3DS/auth-required: `4000 0027 6000 3184`.
- You need a shop whose Stripe **Connect** is set up in test mode (so charges run on the
  connected account, 0% platform fee â the real model).
- Focus is **correctness of money, bookings, access, and comms** â not UI polish.

---

## P0 â Money is never wrong, a booking is never lost
- [ ] **Online pay-now**: charged = service + tax; **tip is added but never taxed**;
      booking shows **Paid**; exactly **one** appointment row is created.
- [ ] **Require card â¤7 days (HOLD)**: card authorized, **not** charged at booking â
      mark **complete** = full amount captured â separate booking marked **no-show** =
      **only the fee** is charged.
- [ ] **Require card >7 days (SAVE)**: card saved, **not** charged at booking â
      complete / no-show charges the saved card off-session.
- [ ] **No double-charge**: call the capture/complete path **twice** on the same
      appointment â second call is a no-op, customer charged once.
- [ ] **Refund**: a no-show-fee refund returns **only the fee** (not the full total);
      the refund email shows the **real** amount; a **second** refund attempt is blocked.
- [ ] **Multi-service**: booking 2+ services = **one** appointment, combined duration,
      combined price charged.

## P0 â The price can't be cheated (server is authoritative)
- [ ] POST a booking with a **fake lower total**, a **fake discount**, or **another
      shop's cheaper service id** â server **ignores it and charges the real price**.
- [ ] Apply a **promo / gift card / loyalty redemption** â server recomputes the
      discount; a one-time promo **can't be reused**; discounts **can't stack past the cap**.
- [ ] Confirm money lands in the **shop's connected account**, not the platform (0% fee).

## P0 â Double-booking / races
- [ ] Two bookings for the **same barber + slot at the same time** â only **one** wins;
      the loser gets a friendly "just booked" message **and their payment is reversed**.
- [ ] Overlap with a **longer existing** appointment is caught (duration-aware).
- [ ] Booking a **past slot**, **beyond the advance window**, or a **time-off/break**
      slot â **refused server-side** (not just hidden in the UI).

## P0 â Can't touch another shop's data (IDOR / auth)
- [ ] Logged in as **shop A**, call `capture-appointment`, `appointments/update`,
      `refund-payment`, POS, and `stripe/terminal/*` with **shop B's ids** â **rejected**.
- [ ] A barber with **`manage_appointments` OFF** hitting those routes â **403**.
- [ ] **Logged-out** request to any write/money route â **401**.
- [ ] A public/anon read never returns secrets (`stripe_account_id`, owner email, etc.).

## P1 â Communications
- [ ] Email **and** SMS fire for: new booking, confirmation/approval, cancellation,
      reschedule (edit screen), day-before reminder, waitlist spot-opened.
- [ ] Emailed links open correctly (confirmation, manage-booking, review, reset password).
- [ ] **No duplicate** sends; **review link is NOT sent** if the customer already reviewed.

## P1 â Plan gating (server-enforced, not just UI)
- [ ] A **free / starter** shop **cannot** take online payments, and **cannot** reach
      POS / Inventory / Gift Cards data paths â blocked on the **server**, not only hidden.

## P2 â Edge cases
- [ ] Customer **closes the tab** before returning from Stripe â booking still finalizes
      (via the connected-account webhook).
- [ ] **Timezone**: slot availability, past-booking block, and reminders are all judged
      in the **shop's** timezone, not UTC.

---

## How to report findings (write results back here)
For each failure, append to a `## Results` section below (or a separate
`TEST-RESULTS.md`) with:
- **Case** (which checkbox) Â· **Severity** (P0/P1/P2) Â· **What happened** vs **expected**
- **Where** (`file:line` or the route/endpoint) Â· **Repro steps** (inputs â result)

Commit + push so the other session can read it. Keep passing cases as a one-line
"â all P0 money cases pass" â detail only the failures.

## Results
### Test Run: 2026-08-07 — Stripe TEST mode, shop "FADE MECHANIC"

---

#### ✅ Test 1 — POS Pay-Now (Online Terminal)
**Result: PARTIAL PASS / BUG**

The POS flow charged successfully and created a `transactions` row. However, **no `appointments` row was created**. The POS terminal is intended for walk-in payments only, so this may be by design — but the test plan expected an appointment row to be created. Flagged as a discrepancy for owner review.

🐛 **Bug POS-APPT** *(P2)* — POS cash/card sale creates a `transactions` row but **no `appointments` row**. If the intent is that POS sales are walk-in only and do not produce bookable records, this should be documented. If appointment tracking is expected, the handler is missing an `appointments` insert.

---

#### ✅ Test 2a — HOLD → Complete (charge in full)
**Result: PASS**

Appointment booked <7 days out, `payment_status: "held"`. Barber clicked Complete → `/api/stripe/capture-appointment` returned `{"ok":true,"amount":35}`. DB updated to `status: "completed"`, `payment_status: "captured"`. Stripe dashboard showed charge captured. ✔

---

#### 🔴 Test 2b — HOLD → No-Show (fee charged)
**Result: FAIL — P0 Bug**

🐛 **Bug T2-NS** *(P0)* — Barber clicked **Reject** on a HOLD appointment (simulating a no-show). Expected: 50% no-show fee ($17.50) charged and `payment_status` updated. Actual: `status: "cancelled"`, `payment_status: "voided"`, **$0 charged**.

Root cause (confirmed via code review, `src/app/dashboard/appointments/page.tsx`): The Reject handler only calls `supabase.update({ status: "cancelled" })` and voids the payment intent. There is **no call to any charge/capture endpoint** in the rejection path. No-show fee logic is entirely absent from Reject.

---

#### ✅ Test 3a — SAVE booking (card stored, $0 charged)
**Result: PASS**

*(Required temporarily bumping `advance_days` from 7→14 in DB — see Config Finding below.)*

Appointment booked >7 days out. Stripe Checkout hosted page collected card details. DB: `payment_status: "saved"`, `stripe_payment_method_id` and `stripe_customer_id` populated, `total_amount: 0`. Card stored off-session as expected. ✔

---

#### ✅ Test 3b — SAVE → Complete (off-session charge)
**Result: PASS**

Barber clicked Complete on SAVE appointment → `/api/stripe/capture-appointment` → `{"ok":true,"amount":35}`. DB: `status: "completed"`, `payment_status: "captured"`. Stripe dashboard showed $35 off-session charge. ✔

---

#### 🔴 Test 3c — SAVE → No-Show (off-session fee)
**Result: FAIL — P0 Bug**

🐛 **Bug T3-NS** *(P0)* — Same root cause as T2-NS. Barber clicked Reject on SAVE appointment. Expected: off-session no-show fee charged. Actual: `status: "cancelled"`, `payment_status: "saved"` (unchanged — the saved payment method was never charged), **$0 collected**.

---

#### ✅ Test 4 — Refund from Payments tab
**Result: PASS**

Navigated to Payments → found the $35 captured transaction → clicked "↩ Refund payment". Full $35 refunded. DB: `payment_status: "refunded"`. Second refund attempt returned an error (blocked). Stripe dashboard confirmed refund. ✔

---

#### ✅ Test 5 — Cancel + Smart Waitlist Notification
**Result: PASS**

Inserted a waitlist entry for the same barber/date. Cancelled the appointment → `/api/waitlist/slot-opened` returned `{"notified":1}`. Waitlist entry updated to `status: "notified"`, `notified_at` timestamp set. ✔

---

### ⚠️ Config Finding — SAVE Mode Unreachable with Default Settings

`advance_days: 7` in `booking_settings` serves double duty: it is both the **booking window** (max days ahead customers can book) and the **HOLD/SAVE threshold** (appointments >7 days out use SAVE mode). Because the max bookable date is exactly 7 days out, the condition `daysOut > 7` is never true. **SAVE mode cannot be reached with default shop settings.**

Temporary fix applied for testing: `advance_days` bumped to 14 in DB, reset to 7 after tests. Recommend either raising the default `advance_days`, or decoupling the booking window from the HOLD/SAVE threshold.

---

### Summary

| ID | Severity | Description | Status |
|----|----------|-------------|--------|
| T2-NS | P0 | HOLD Reject → no-show fee never charged; payment voided | 🔴 Fail |
| T3-NS | P0 | SAVE Reject → no-show fee never charged; saved card unused | 🔴 Fail |
| CONFIG | P1 | `advance_days: 7` makes SAVE mode unreachable | ⚠️ Config |
| POS-APPT | P2 | POS sale creates `transactions` row but no `appointments` row | 🐛 Bug |
| T2a | — | HOLD → Complete | ✅ Pass |
| T3a | — | SAVE booking (card stored) | ✅ Pass |
| T3b | — | SAVE → Complete (off-session charge) | ✅ Pass |
| T4 | — | Refund + double-refund block | ✅ Pass |
| T5 | — | Cancel + waitlist notification | ✅ Pass |

**Root cause for T2-NS and T3-NS:** `src/app/dashboard/appointments/page.tsx` — the Reject handler updates status to `"cancelled"` and voids/ignores payment, but contains **no call to any charge or capture endpoint**. Fix: add no-show fee charge logic before voiding the payment intent.
