# 🚀 Launch Readiness — Billing & Multi-Shop To-Do

From the pre-launch audit of subscription (upgrade / downgrade / cancel) and multi-shop
functionality. **Foundations are solid** (access control, data isolation, price integrity,
webhook signature). This is the punch list to clear before charging real customers.

Full audit report: https://claude.ai/code/artifact/28bca8aa-3644-4f98-a04b-9c0931ea4cc7

---

## ✅ Already fixed & shipped (Claude)

The "fire-and-hope" safety-net cluster — the safe code fixes that don't touch pricing or
architecture:

- **H1** — "Switch to free now" now only downgrades if Stripe actually confirms the cancel
  (was: downgraded even when the Stripe call failed → card kept getting charged).
- **H3** — Cancel + webhook downgrades now check the database write; the webhook throws on a
  failed write so **Stripe retries** instead of silently leaving a shop on premium.
- **M3** — Immediate cancel now clears the dead `stripe_subscription_id` (keeps the customer
  id) so re-subscribe / start-trial isn't blocked by a stale id.
- **M4** — Cancel/resume now return a generic error to the user and log the real detail on the
  server (was: raw Stripe error leaked to the browser, nothing logged).
- **M1** — Added an `invoice.payment_failed` → **dunning email** ("update your card") to save
  failing renewals. *(Only fires once the webhook event is enabled — see item 1 below.)*

---

## 🔴 1. DO IN STRIPE TODAY (2 minutes — you)

This single check decides whether several High findings are real or already handled.

Stripe Dashboard → **Developers → Webhooks** → your `/api/webhooks/stripe` endpoint → confirm
it is subscribed to these **platform** events:

- [ ] `customer.subscription.updated`
- [ ] `customer.subscription.deleted`
- [ ] `checkout.session.completed`
- [ ] `invoice.payment_failed`  ← enables the new dunning email (M1)
- [ ] `invoice.upcoming`  ← enables the renewal-reminder email (already coded)

Also confirm the **same `STRIPE_WEBHOOK_SECRET`** covers BOTH platform (subscription) and
connected-account (booking/refund) events, or that both destinations point at this endpoint.

> Why it matters: if these aren't delivering, then a scheduled cancel never downgrades the
> shop (free premium forever) and a paid-but-tab-closed checkout never activates. **H2, H5,
> and M1 all hinge on this.**

---

## ✅ 2. DECISIONS (owner chose A + A — now implemented & shipped)

### C1 + H6 — How plan changes bill → **A (proration) ✅ DONE**
Plan changes now **edit the existing subscription with proration** instead of starting a new
one: the owner is credited for unused days and only charged the difference, with no card
re-entry. This also **fixes the Critical ghost-subscription bug** (C1) — and as a belt, the
activation path now cancels *every* other active subscription on the customer, not just the
captured one. New code: `api/stripe/change-plan/route.ts` + `changePlanPrice()` in
`lib/stripe-addons.ts`. The billing page tries this first and only falls back to Checkout
(to collect a card) when there's no live subscription.

### H4 + H7 + M2 — Multi-location billing model → **A (account-level) ✅ DONE**
Plan changes are now applied **account-level** — to every shop the owner owns (they share one
subscription) — via `change-plan` (and `confirm-subscription` already did this). H7 is fixed:
"Change plan" no longer targets just the newest shop.
- ⚠️ **Still to polish (small, optional):** the Cancel/Resume *labels* and the "switch to free
  now" copy still say "Location: X" while the action is account-wide. The behaviour is now
  consistent (H1/H3 fixes make cancel safe), but the wording should be updated to say it
  affects the whole account. Low priority — tell Claude to reword when you want.

### ⚠️ TEST THIS IN STRIPE **TEST MODE** BEFORE GOING LIVE
This is real-money logic and I could not run a live Stripe flow from here. Please run through it
once in test mode:
- [ ] Upgrade a paid shop to a higher plan → confirm the invoice shows a **prorated charge**
      (not a full month) and NO second subscription is created.
- [ ] Downgrade a paid shop → confirm a **credit/proration** appears and features update.
- [ ] Confirm the **location + AI-phone add-ons survive** the switch (still on the sub).
- [ ] A brand-new subscribe (Starter → paid) still goes through **Checkout** and collects a card.
- [ ] Multi-location: a plan change on one location updates **all** the owner's locations.

---

## ✅ 3. Daily reconciliation safety-net (H2) — DONE & shipped

The daily cron (`/api/cron/reminders`) now also runs `reconcileSubscriptions()`
(`lib/reconcile-subscriptions.ts`) — no new Vercel cron slot needed. Once a day it re-checks
each paid subscription's LIVE status in Stripe and:
- downgrades to Starter if Stripe says the sub is genuinely cancelled/expired **or** returns a
  real "no such subscription" (404),
- flags `past_due` / self-heals a recovered `past_due → active`,
- **skips on any other error** (network/rate-limit) so a Stripe hiccup can never wrongly strip
  a paying shop of its plan.

This is the belt-and-suspenders so a single missed webhook can no longer = "free premium
forever." (It still needs the webhook from item 1 as the primary path; this is the backup.)

---

## 🟡 4. MINOR / POLISH (low priority — you or Claude)

- [x] **M5** — ✅ DONE. Adding a card in the last 48h of a trial now defers the first charge to
      `now + 49h` instead of billing on the spot, honoring "keep all your remaining free days."
- [x] **M2 wording** — ✅ DONE. The cancel modal now warns multi-location owners that cancelling
      applies to all their locations (shared subscription).
- [ ] **L1** — Immediate cancel sets status `inactive`; the follow-up webhook sets `cancelled`
      and sends the "cancelled" email → possible mixed badge + an extra email. Tidy to one.
- [ ] **L2** — Subscription webhook handlers don't check `event.account` (platform vs
      connected). Safe today; revisit if a shop ever runs its own Stripe Billing.
- [ ] **L3** — No processed-event-id de-dup table; `subscription.updated` isn't status-gated.
      Cosmetic (features re-derive from plan). Optional hardening.
- [ ] **L4** — Trial-credit on upgrade reads the *newest* shop, not the one you're viewing
      (edge case for multi-location). Fold into the item-2 multi-location fix.
- [~] **L5** — DEFERRED (not a blocker). A barber who works at 2 shops is pinned to one
      (no switcher); data stays isolated. Only matters if you actually have a barber working at
      2+ locations — revisit then and Claude adds a switcher.
- [~] **L6** — DEFERRED (leave as-is). The `acct_…` id on the public booking page is NOT a
      secret — Stripe's payment form needs it to take card payments on the shop's behalf.
      Removing it could break online booking payments. No action.

---

## Suggested order

1. Item 1 (Stripe webhook check) — today.
2. Decide **C1/H6** model → Claude implements (kills the Critical).
3. Decide **multi-location** model → Claude implements (H4/H7/M2/L4).
4. "Go" on **H2** reconciliation cron.
5. Mop up section 4.

*Audit was read-only. The ✅ section is live on `main`. Everything else is waiting on you.*
