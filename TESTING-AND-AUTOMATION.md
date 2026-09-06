# ClipWise — Test, Debug & Automation Reference

> **What this is.** A *reference* (not code) for verifying ClipWise's money-critical
> flows, debugging data drift, and knowing what's already automated vs. genuinely
> missing. Built for a human — or a fast/cheap model (Fable) + copilot loop — to
> run the checks and **report findings**. It is deliberately **read-only in spirit**:
> smoke tests run in **sandbox**, and the debug queries are **SELECTs only**.
> **Never auto-rewrite money data** — a bug in the "fixer" is worse than the drift.
>
> Ship discipline (when a fix *is* made, in a separate session): `npm install` if
> needed → `SKIP_ENV_VALIDATION=1 npx next build` → confirm `✓ Compiled successfully`
> / `===EXIT 0` in the log → `git checkout package-lock.json` → commit + push `main`.
>
> Live keys are never used for testing. Supabase project: `avetaceptfpdovkuihcf`.
> Reference shop (Fade Mechanic): `76f7e261-5040-4df4-bd2c-706236ed9057`.

---

## A. Money-path smoke tests (run in Stripe **TEST** mode)

**Stripe test cards:** success `4242 4242 4242 4242`; dispute/chargeback
`4000 0000 0000 0259`; generic decline `4000 0000 0000 0002`; insufficient funds
`4000 0000 0000 9995`; charge fails *after* card is attached (good for failed-renewal
/ dunning) `4000 0000 0000 0341`.

**Sandbox webhook must have all 11 events enabled** (Developers → Webhooks →
endpoint), Connected-accounts listener ON:
`checkout.session.completed`, `payment_intent.succeeded`, `payment_intent.payment_failed`,
`charge.refunded`, `charge.dispute.created`, `charge.dispute.closed`, `account.updated`,
`customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed`,
`invoice.upcoming`. Subscription/invoice events are **platform** events → need the
"Your account" endpoint too (see §C gap).

For each test: **precondition → steps → expected → how to verify** (UI + DB/Stripe).

### A1. Booking → pay online (immediate) → Paid
- Pre: shop Connect-enabled; a service with a price.
- Steps: public booking page → pick service/time → pay with `4242…`.
- Expect: appointment `payment_status` flips to **paid**; money in the shop's Stripe
  balance (direct charge, 0% platform fee); confirmation shown.
- Verify: Payments feed shows it "Paid"; DB `appointments.payment_status='paid'`,
  `payment_intent_id` set; `transactions` row exists.
- Code: `api/stripe/booking-checkout`, `lib/finalize-booking-session.ts`, webhook
  `checkout.session.completed`.

### A2. Booking with card **hold** (no-show protection) → Complete → capture
- Pre: shop has no-show protection ON; book with `4242…` (authorize, not charge).
- Steps: mark the appointment **Complete** at/after the slot.
- Expect: the hold is **captured** (full or up to the hold); `payment_status='captured'`.
- Verify: `transactions` has a `completion` row w/ `payment_intent_id`; Stripe shows a
  captured PaymentIntent.
- Code: `api/stripe/capture-appointment` (`reason:"completed"`), gated by
  `isCheckoutAllowed` (`lib/utils.ts` — **gate currently OFF for testing**, see TODO §0).

### A3. No-show fee capture
- Steps: at/after the slot, mark **No-show**, choose a fee %.
- Expect: fee captured (≤ hold), `status='no-show'`, `payment_status='captured'`.
- Verify: `transactions` `source='no_show'` row; owner+barber in-app "No-show fee charged".
- Note: **no server-side time gate on `no_show`** yet (TODO §0 item d) — can currently
  fire before the slot.

### A4. Raised price → partial capture → collect the balance
- Pre: a held/paid appointment; raise its price above the hold.
- Steps: capture (captures only up to the hold) → a `balance_due` remains → collect it
  via **Charge card on file / Cash / Send link**.
- Expect: `balance_due` → 0; a `source='balance'` `transactions` row; Payments shows a
  "Balance · Card/Cash" line; revenue counts the appt's own charge + the balance once,
  no double-count.
- Verify: `collectedTotals` (Dashboard/Analytics) and the Payments page agree.
- Code: `api/appointments/collect-balance`, `api/stripe/balance-link`, webhook
  `flow==="balance"`, `lib/revenue.ts`.

### A5. Refund (in-app **and** from the Stripe dashboard)
- Steps: refund a paid appointment from Payments; separately, refund a charge directly
  in the Stripe dashboard.
- Expect (both): row greys to **Refunded**; revenue drops; a dated `source='refund'`
  ledger row is written (audit + tax); no double-subtract.
- Verify: `transactions` refund row (negative, `refunded=true`); the original flagged
  `refunded`; `charge.refunded` webhook fired for the dashboard case.
- Code: `api/stripe/refund`, `api/stripe/refund-payment`, `lib/refund-ledger.ts`,
  webhook `charge.refunded`.

### A6. Chargeback / dispute
- Steps: pay with the dispute card `4000 0000 0000 0259`.
- Expect: owner gets in-app "⚠️ Chargeback opened" (with the response deadline).
- Verify: notification row; webhook `charge.dispute.created` handled.
- Code: webhook `charge.dispute.*`, `notifyDispute` in `lib/payment-notify.ts`.

### A7. POS sale + gift card
- Steps: POS card sale (`4242…`), a cash sale, and a gift-card purchase.
- Expect: `transactions` rows (`pos` / `gift_card_sale`); revenue counts them; gift card
  minted with a code.
- Verify: Payments feed; `gift_cards` row (code matches the checkout metadata `code`).

### A8. Trial → warning emails → expiry → downgrade
- Pre: a shop on a **no-card** trial (`subscription_status='active'`, `trial_ends_at` set,
  no `stripe_subscription_id`, `trial_used=true`).
- Expect: owner emailed at **7 / 3 / 1 days** before ("add a card"); on expiry →
  downgrade to Starter (`status='inactive'`, `trial_ends_at` cleared, `trial_ended_at`
  stamped) + "trial ended" email + in-app note.
- Verify: run the daily cron; check `trial_ended_at` set and the email sent.
- Code: `lib/process-trials.ts`, cron `api/cron/reminders` (`0 13 * * *`), emails
  `trial_reminder` / `trial_ended` in `lib/emailer.ts`.
- **Proof trick:** set a demo shop to `trial_ends_at = tomorrow`, `status='active'`, no sub
  → next cron sends the real 1-day email to a real inbox.

### A9. Trial → add card → charges at trial end
- Steps: on an active no-card trial, add a card via Billing (upgrade).
- Expect: a Stripe **subscription** is created with `trial_end` = the original trial end
  (keeps remaining free days); Stripe **auto-charges at trial end**; `processTrials` then
  skips the shop (it has a subscription).
- Verify: `stripe_subscription_id` set; Stripe sub shows `trial_end`.
- Code: `api/stripe/checkout` (deferred `trial_end`), webhook `checkout.session.completed`
  (subscription mode), `confirm-subscription`.

### A10. Subscription cancel (now / at period end)
- Steps: Billing → Cancel. Test both "switch to free now" and "cancel at period end".
- Expect: **now** → immediately Starter/inactive; **period end** → Stripe schedules
  cancel; when it ends, `customer.subscription.deleted` flips the shop to Starter + emails.
- Verify: DB state; the `reconcileSubscriptions` daily cron is the backstop if the webhook
  is missed.
- Code: `api/stripe/cancel-subscription`, webhook `customer.subscription.deleted`.

### A11. Failed renewal (dunning) — **needs the platform webhook (see §C)**
- Steps: subscribe with `4000 0000 0000 0341` (charge fails at renewal).
- Expect: owner gets the `subscription_payment_failed` dunning email.
- Verify: **only fires if the "Your account" (platform) webhook delivers
  `invoice.payment_failed`** — the connected-accounts endpoint won't. This is the known gap.
- Code: webhook `invoice.payment_failed`.

---

## B. Debug playbook (read-only SQL — `SELECT` only, never `UPDATE` here)

Run against project `avetaceptfpdovkuihcf`. **Verify, don't assume** — read the row,
don't guess. Healthy result noted for each. (These are the exact checks used to audit
the app this session.)

### B1. Corrupt commission rows (already neutralized on-screen by `safeCommission`)
```sql
SELECT count(*) AS corrupt, max(commission_amount) AS max_stored
FROM transactions WHERE commission_amount > amount;
```
Healthy: `0`. Non-zero = data hygiene only (screens clamp it); optional backfill +
a `commission_amount <= amount` check constraint.

### B2. Refunded appointments whose tx row wasn't flagged
```sql
SELECT t.id, t.created_at::date, t.client_name, t.amount, t.refunded
FROM transactions t
JOIN appointments a ON a.payment_intent_id = t.payment_intent_id
WHERE a.payment_status='refunded' AND t.source='completion' AND t.refunded IS NOT TRUE;
```
Healthy: `0` (was 7 — root cause: `charge.refunded` webhook wasn't enabled; now fixed).

### B3. Stuck expired trials (should auto-downgrade)
```sql
SELECT name FROM shops
WHERE trial_ends_at IS NOT NULL AND trial_ends_at < now()
  AND subscription_status='active' AND stripe_subscription_id IS NULL;
```
Healthy: `[]` (empty). Non-empty = the trial cron isn't running.

### B4. Approved shops missing the reminders config
```sql
SELECT count(*) FILTER (WHERE status='approved'
  AND (booking_settings->'reminders'->>'appointment_24h') IS NULL) AS missing_24h
FROM shops;
```
Healthy: `0` (backfilled; new shops default it on).

### B5. Approved shops that can't take a booking
```sql
SELECT sh.name,
  (SELECT count(*) FROM barbers b WHERE b.shop_id=sh.id AND b.is_active) AS active_barbers,
  (SELECT count(*) FROM services s WHERE s.shop_id=sh.id) AS services
FROM shops sh WHERE sh.status='approved'
  AND ((SELECT count(*) FROM barbers b WHERE b.shop_id=sh.id AND b.is_active)=0
    OR (SELECT count(*) FROM services s WHERE s.shop_id=sh.id)=0);
```
Healthy: `[]`. Non-empty = dead booking pages (complete them or set to pending).

### B6. Trial lifecycle audit
```sql
SELECT name, subscription_plan, subscription_status, trial_used, trial_ends_at, trial_ended_at
FROM shops WHERE trial_used ORDER BY created_at DESC;
```
Reads the fingerprint: auto-expiry leaves `trial_ended_at` set + the paid plan flagged
inactive; a manual downgrade lands on `plan='starter'` with no end date.

### B7. Card transactions missing their Stripe fee (barber vs owner net drift)
```sql
SELECT count(*) FILTER (WHERE payment_method='card' AND (stripe_fee IS NULL OR stripe_fee=0)) AS card_no_fee
FROM transactions;
```
Non-zero historical rows are now netted live from Stripe (`fetchStripeByPi`); a full
backfill of the column is optional.

### B8. Unrecorded Stripe payments
Already automated — the owner-only detector at `api/stripe/unrecorded-payments`
(Payments page). It matches Stripe checkout sessions to local records (PI / session-id /
gift code), 20-min lag buffer, go-live floor, re-verified against Stripe. It only
**flags**, never writes.

### B9. RLS / PII exposure (pre-live)
```sql
SELECT tablename, policyname, roles FROM pg_policies
WHERE schemaname='public' AND tablename IN ('shops','barbers') AND cmd='SELECT';
```
`{public}` roles = the anon PII read leak (TODO §0). Fix before real owners onboard.

---

## C. Automation reality check (honest: what's already automated vs the gaps)

**Already automated (verified in code):**
- **Reminders** — daily cron `api/cron/reminders` (`0 13 * * *`): 24h appointment reminder
  (email all plans, SMS paid) + a dormant **4h** same-day reminder that auto-activates once
  the cron runs frequently (Pro / external scheduler). Default ON for new shops.
- **Trial lifecycle** — `processTrials`: 7/3/1-day warnings, expiry downgrade, "trial ended"
  email; add-card converts to a deferred-charge subscription.
- **No-show / completion charges** — `capture-appointment` (manual trigger; percentage fee).
- **Payments plumbing** — webhook handles payments, refunds (+ dated ledger), disputes,
  Connect status, subscriptions; `reconcile-payments` and `reconcileSubscriptions` crons
  are the missed-webhook backstops.
- **Housekeeping** — Stripe connected account deleted when a shop/account is deleted;
  orphaned barber logins + uploaded files cleaned up.

**Genuine gaps (not "self-healing", just real to-dos):**
1. **Platform webhook** ("Your account" endpoint) for `customer.subscription.*` +
   `invoice.*` — makes cancel-at-period-end sync + the dunning email actually fire.
   Config, not code (also in TODO §0).
2. **No automated test suite** — everything is `next build` + manual checks. §A is the spec
   for the first smoke suite (start with A1–A5, A8–A10).
3. **Partial refunds** — deliberately deferred (needs a revenue-model + commission-policy
   decision).
4. **PII read leak + money-safety gates** — pre-live security (TODO §0).

> **Deliberately NOT recommended:** a "fully automated business" / self-healing layer that
> auto-rewrites financial data unattended. At this stage a human (or a copilot loop) running
> §B and reviewing is safer and cheaper. Automate operations *after* there are operations.

---

## D. How to run it (Fable + copilot loop)

- **Smoke tests (§A):** run in **sandbox** before shipping any payments change. Manual now;
  §A is the checklist to later encode as an automated suite.
- **Health checks (§B):** a fast/cheap model (**Fable**) can run these read-only queries on a
  light schedule (e.g. weekly) and **report** anything non-healthy — never auto-fix money.
  Good candidates to watch: B2 (refund drift), B3 (stuck trials), B5 (dead booking pages),
  B8 (unrecorded payments), B9 (RLS).
- **Guardrails for any agent:** SELECT-only in §B; test-mode only in §A; abort on a live key;
  surface findings for a human to action. Anything that moves money or changes RLS/DB is
  propose-first, human-approved.
- **Cross-refs:** go-live + security items live in `TODO.md §0`; subsystem how-it-works in
  `KNOWLEDGE-BOOK.md`.

---

## Results — 2026-09-06 (Section B, read-only)

Run against `avetaceptfpdovkuihcf`. No data changed.

| Check | Result | Healthy | Verdict |
|---|---|---|---|
| B1 corrupt commission rows | 3 (max stored $16,329.60) | 0 | ⚠️ data only — clamped on-screen by `safeCommission`, no wrong number shown. Optional backfill + check-constraint. |
| B2 refunded appt, tx not flagged | 0 | 0 | ✅ clean (was 7; backfilled + `charge.refunded` webhook now enabled). |
| B3 stuck expired trials | 1 (Dope Cuts) | 0 | ✅ not a bug — expired 0.5h ago; the downgrade cron runs 13:00 UTC, so it clears at the next run. Transient. |
| B4 approved shops missing 24h reminder | 0 | 0 | ✅ clean (backfilled + new-shop default). |
| B5 approved shops that can't book | 3 | 0 | ⚠️ dead booking pages — **Zip cuts** (0 barbers/0 services), **Riverview** (1 barber, 0 services), **Cut and nut** (0/0). Almost certainly test shops; complete or set to `pending` before live. |
| B6 trial audit | 5 trialed: 1 auto-expiry, 1 manual downgrade (New lane), 1 converted, +Dope Cuts now expiring | — | ℹ️ informational. |
| B7 card tx with no stored fee | 46 | informational | ℹ️ historical rows; now netted live from Stripe (`fetchStripeByPi`). Full column backfill optional. |
| B8 unrecorded Stripe payments | (detector) | — | ℹ️ automated + read-only at `api/stripe/unrecorded-payments`; nothing to run here. |
| B9 public PII SELECT policies | 2 (`shops`, `barbers`) | 0 pre-live | ⚠️ anon PII read leak still open — fix before real owners onboard (TODO §0). |

**Net:** only two things a human should act on — **B5** (tidy/complete the 3 dead test shops) and **B9** (close the PII read leak before live). B1/B7 are harmless data hygiene; B3 is transient; B2/B4 are clean.

---

## Results — 2026-09-06 (Section A preflight — Section A itself NOT run)

Section A's card flows **cannot** be run read-only or from the cloud (needs a card typed
into Stripe + egress to the site, which the container lacks). Below is the **preflight**
(gates + "has each path ever executed in prod?") produced by a copilot session, with my
**verification verdicts** against the live DB. Card flows still to be run **by a human in
sandbox** against a throwaway shop (never FADE MECHANIC).

**Preflight gates:** ✅ test keys only (no `sk_live_`). ✅ 11 webhook events now enabled
(was 3). ❌ platform "Your account" endpoint absent → A11 dunning still can't fire.
⚠️ the three money-safety gates still `false` (TODO §0) → A2/A3 would "pass" vacuously
until flipped. `e2e/clipwise-e2e.mjs` is route/login smoke only (no payment code).

**Findings (copilot-surfaced; verdicts mine):**
- **F1 — the refund ledger has never run in prod.** `recordRefundLedger` shipped today
  (`28ebe02`); last actual refund was 2026-08-19. So the newest money-writing code has 0
  production executions → **run A5 (refund) first** when you smoke-test. *Verdict: valid.*
- **F2 — 2 no-show-fee refunds left the appointment reading `captured`** (`$5.75` 08-03,
  `$19.25` 08-19). ✅ **Verified (2 rows).** BUT the money impact is **overstated**:
  `collectedTotals` skips no-show appointments entirely *and* skips refunded txns, so the
  app's real revenue is **not** overstated. It's a **row-state inconsistency** (the POS/tx
  refund branch doesn't flip the appointment's `payment_status` for a no-show fee) — worth
  a small fix + 2-row cleanup, low urgency. *Verdict: real but not a money bug.*
- **F3 — a chargeback adjusts nothing but the notification.** `charge.dispute.*` only calls
  `notifyDispute`; a lost dispute pulls money from the shop's balance while revenue /
  commission / tax stay unchanged. *Verdict: valid — real correctness gap (by design, for now).*
- **F4 — the Stripe-fee capture is a live race, not just legacy.** ✅ **Verified: 16 card
  charges since Aug 1 have `stripe_fee = 0` with a PI set, $419.85 gross** (copilot: 18 /
  $494.85 on looser criteria). The balance-transaction isn't ready when the row is written,
  so net revenue is overstated by the missing fees. *Verdict: valid — worth a real fix
  (fetch the fee async / backfill).* → new check **B10**.
- **F5 — 26 paid+completed appts (June 12–24) have no `transactions` row, $810.** Legacy
  window; all-time revenue differs by $810 between the two tables. *Verdict: plausible,
  legacy.* → new check **B11** (should stay flat; a new one = ledger write broke).
- **F6 — 18 card txns carry no Stripe reference;** 2 are August `gift_card_sale` ($25/$50)
  → card gift sales can't be reconciled to Stripe. *Verdict: plausible.*
- **F7 — thin notification coverage** on money paths (1 refund note for 10 refunds, 0
  balance-paid, 0 dispute). *Verdict: observational.*
- **F8 — the 3 corrupt commission rows** are $16,329.60 / $16,329.60 / $11,664 on $35/$35/$25
  sales (one shop, Aug 8) = ~$44k phantom, **clamped on-screen by `safeCommission`.** ✅
  Consistent with B1. *Verdict: real data, no wrong number shown; any raw SQL/CSV export
  bypassing the clamp would be wrong.*
- **Interac (product gap):** Terminal uses `card_present` + plain `manual` capture, no
  `interac_present` → declines Interac debit (~60% of Canadian in-person). Blocks the POS
  story in Atlantic Canada. *Verdict: valid, product decision.*

**Suggested new §B checks (adopt):**
- **B2b** — `no_show` tx `refunded=true` whose appointment isn't `payment_status='refunded'` (now **2**).
- **B10** — card tx in the last 30 days with `stripe_fee=0` AND a `payment_intent_id` (now **16**, $419.85) — the live fee-race detector.
- **B11** — paid|captured + completed appts with no `transactions` row (now **26**, legacy — must stay flat).

**Ranked "what actually matters" (money-first):** F4 (live missing fees, real $) → F1/A5
(unproven refund code — smoke it) → F3 (dispute books) → F2 (row cleanup) → F8/F5/F6 (hygiene).
