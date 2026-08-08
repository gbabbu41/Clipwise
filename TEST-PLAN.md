# ClipWise — Pre-launch Test Plan (critical paths)

Shared test plan for cross-session testing (this file is the coordination bridge —
run the cases, then write results back per the protocol at the bottom).

## Ground rules
- **Run everything in Stripe TEST mode** (keys are still `sk_test_`/`pk_test_`). No real money.
- Card: `4242 4242 4242 4242`, any future expiry, any CVC, any postal code.
- Decline test: `4000 0000 0000 0002`. 3DS/auth-required: `4000 0027 6000 3184`.
- You need a shop whose Stripe **Connect** is set up in test mode (so charges run on the
  connected account, 0% platform fee — the real model).
- Focus is **correctness of money, bookings, access, and comms** — not UI polish.

---

## P0 — Money is never wrong, a booking is never lost
- [ ] **Online pay-now**: charged = service + tax; **tip is added but never taxed**;
      booking shows **Paid**; exactly **one** appointment row is created.
- [ ] **Require card ≤7 days (HOLD)**: card authorized, **not** charged at booking →
      mark **complete** = full amount captured → separate booking marked **no-show** =
      **only the fee** is charged.
- [ ] **Require card >7 days (SAVE)**: card saved, **not** charged at booking →
      complete / no-show charges the saved card off-session.
- [ ] **No double-charge**: call the capture/complete path **twice** on the same
      appointment → second call is a no-op, customer charged once.
- [ ] **Refund**: a no-show-fee refund returns **only the fee** (not the full total);
      the refund email shows the **real** amount; a **second** refund attempt is blocked.
- [ ] **Multi-service**: booking 2+ services = **one** appointment, combined duration,
      combined price charged.

## P0 — The price can't be cheated (server is authoritative)
- [ ] POST a booking with a **fake lower total**, a **fake discount**, or **another
      shop's cheaper service id** → server **ignores it and charges the real price**.
- [ ] Apply a **promo / gift card / loyalty redemption** → server recomputes the
      discount; a one-time promo **can't be reused**; discounts **can't stack past the cap**.
- [ ] Confirm money lands in the **shop's connected account**, not the platform (0% fee).

## P0 — Double-booking / races
- [ ] Two bookings for the **same barber + slot at the same time** → only **one** wins;
      the loser gets a friendly "just booked" message **and their payment is reversed**.
- [ ] Overlap with a **longer existing** appointment is caught (duration-aware).
- [ ] Booking a **past slot**, **beyond the advance window**, or a **time-off/break**
      slot → **refused server-side** (not just hidden in the UI).

## P0 — Can't touch another shop's data (IDOR / auth)
- [ ] Logged in as **shop A**, call `capture-appointment`, `appointments/update`,
      `refund-payment`, POS, and `stripe/terminal/*` with **shop B's ids** → **rejected**.
- [ ] A barber with **`manage_appointments` OFF** hitting those routes → **403**.
- [ ] **Logged-out** request to any write/money route → **401**.
- [ ] A public/anon read never returns secrets (`stripe_account_id`, owner email, etc.).

## P1 — Communications
- [ ] Email **and** SMS fire for: new booking, confirmation/approval, cancellation,
      reschedule (edit screen), day-before reminder, waitlist spot-opened.
- [ ] Emailed links open correctly (confirmation, manage-booking, review, reset password).
- [ ] **No duplicate** sends; **review link is NOT sent** if the customer already reviewed.

## P1 — Plan gating (server-enforced, not just UI)
- [ ] A **free / starter** shop **cannot** take online payments, and **cannot** reach
      POS / Inventory / Gift Cards data paths — blocked on the **server**, not only hidden.

## P2 — Edge cases
- [ ] Customer **closes the tab** before returning from Stripe → booking still finalizes
      (via the connected-account webhook).
- [ ] **Timezone**: slot availability, past-booking block, and reminders are all judged
      in the **shop's** timezone, not UTC.

---

## How to report findings (write results back here)
For each failure, append to a `## Results` section below (or a separate
`TEST-RESULTS.md`) with:
- **Case** (which checkbox) · **Severity** (P0/P1/P2) · **What happened** vs **expected**
- **Where** (`file:line` or the route/endpoint) · **Repro steps** (inputs → result)

Commit + push so the other session can read it. Keep passing cases as a one-line
"✅ all P0 money cases pass" — detail only the failures.

## Results
_(none yet)_
