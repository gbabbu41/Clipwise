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

## 🟠 2. DECISIONS ONLY YOU CAN MAKE (business model — then Claude codes it)

### C1 + H6 — How plan changes should bill  *(Critical + High)*
Today every upgrade/downgrade creates a **brand-new** Stripe subscription and cancels the old
one. Two problems fall out of this:
- **C1:** starting two checkouts (two tabs / back button) can leave a **ghost second
  subscription billing forever**.
- **H6:** switching mid-month **charges a fresh full month with no credit** for unused days —
  reads like a double charge.

**Your call — pick one:**
- **(A · recommended)** Switch plans by *editing the existing subscription* with proration
  (`stripe.subscriptions.update` + `proration_behavior: "create_prorations"`). Credits unused
  time and **fixes C1 for free**. This is the industry-standard approach.
- **(B)** Keep new-subscription-per-change, but on activation cancel *all other* active
  subscriptions on that customer (careful: must not cancel the location/AI-phone add-on subs).

➡️ **Tell Claude A or B and it will implement it.** (This is pricing behaviour, so it's your
decision to make first.)

### H4 + H7 + M2 — Multi-location billing model  *(High + Medium)*
All of an owner's locations **share one** Stripe subscription, but the Billing page says
"Location: X." So:
- **H4:** "Switch to free now" on one location stops billing for **all** of them, but only
  marks the one you're viewing as free — the others keep premium for free.
- **H7:** "Change plan" doesn't send the location id — it acts on the newest shop and applies
  to all.
- **M2:** cancel-at-period-end / resume also hit every location while the UI implies one.

**Your call — pick one:**
- **(A · recommended for a shared sub)** Make the Billing *subscription* card **owner-level**
  (one subscription for the whole account), and downgrade/upgrade **all** the owner's shops
  together. Simpler and matches reality.
- **(B)** Give each location its **own** Stripe subscription (true per-location billing).
  Bigger change; only if you want locations billed independently.

➡️ **Tell Claude A or B and it will implement it.**

---

## 🟠 3. CODE CLAUDE CAN DO ON YOUR "GO" (bigger/riskier — needs your ok first)

### H2 — Daily reconciliation safety-net for paid subs  *(High)*
Trials already have a daily cron that downgrades expired ones; **paid subscriptions don't.**
Add a daily job (extend the existing trial cron — no new Vercel cron slot needed, stays within
the Hobby "daily only" limit) that re-checks each shop's live Stripe status and downgrades any
that are genuinely canceled/unpaid. This is the belt-and-suspenders for any missed webhook.

➡️ Safe to build once you confirm item 1; say "go" and Claude will add it conservatively
(only acts on definitive Stripe statuses; skips on API errors so it can't wrongly downgrade).

---

## 🟡 4. MINOR / POLISH (low priority — you or Claude)

- [ ] **M5** — Adding a card in the **last 2 days** of a trial bills immediately (Stripe can't
      defer < 48h), which contradicts the "keep your free days" copy. Fix = tweak the banner
      copy in that window, or push `trial_end` to 49h out. *(Decide preferred wording.)*
- [ ] **L1** — Immediate cancel sets status `inactive`; the follow-up webhook sets `cancelled`
      and sends the "cancelled" email → possible mixed badge + an extra email. Tidy to one.
- [ ] **L2** — Subscription webhook handlers don't check `event.account` (platform vs
      connected). Safe today; revisit if a shop ever runs its own Stripe Billing.
- [ ] **L3** — No processed-event-id de-dup table; `subscription.updated` isn't status-gated.
      Cosmetic (features re-derive from plan). Optional hardening.
- [ ] **L4** — Trial-credit on upgrade reads the *newest* shop, not the one you're viewing
      (edge case for multi-location). Fold into the item-2 multi-location fix.
- [ ] **L5** — A barber who works at 2 shops is pinned to one arbitrarily (no switcher).
      Data stays isolated — usability gap only. Decide if multi-shop barbers are supported.
- [ ] **L6** — Public booking page exposes the shop's Stripe `acct_…` id. Not a secret
      (Stripe.js may need it client-side) — verify, and drop from the public read if unused.

---

## Suggested order

1. Item 1 (Stripe webhook check) — today.
2. Decide **C1/H6** model → Claude implements (kills the Critical).
3. Decide **multi-location** model → Claude implements (H4/H7/M2/L4).
4. "Go" on **H2** reconciliation cron.
5. Mop up section 4.

*Audit was read-only. The ✅ section is live on `main`. Everything else is waiting on you.*
