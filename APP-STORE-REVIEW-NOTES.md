# App Store / TestFlight review notes — ClipWise

Copy the **Review notes** block into App Store Connect (App Review Information →
Notes) and fill in the demo login. This file also records, for us, exactly why
the app has no in-app purchase and how that's enforced — plus the appeal playbook,
because a first-pass rejection on this category is likely and is cleared in the
Resolution Center, not by crippling the product.

> ⚠️ Never commit real demo credentials to this repo. Put them into App Store
> Connect (or a private note). Placeholders below are a template only.

---

## Review notes (paste into App Store Connect)

ClipWise is a **barbershop-management tool sold directly by us to barbershop
businesses** — not to individual consumers. A shop signs up and manages its
subscription on our website, clipwise.ca. The iOS app is the tool the shop's
staff **log in to** to run the business.

**Demo account (permanently active — not on a trial clock):**
- Email: `<DEMO_OWNER_EMAIL>`
- Password: `<DEMO_OWNER_PASSWORD>`

Sign in to see the full working system: calendar, appointments, clients,
in-person checkout/POS, and revenue.

**There is no account creation and no purchasing mechanism of any kind in the
app** — no sign-up, no pricing, no plan names, no subscribe/upgrade, no links to
our website. A shop that isn't on a paid plan simply runs on our free tier.

**What the app is actually for:** operating **Stripe Terminal (WisePad 3)** and
**Tap to Pay on iPhone** to take in-person card payment for **haircuts** —
physical services delivered in person. Under Guideline **3.1.3(e)** those
real-world services must not use in-app purchase.

Our business subscription (what a shop pays ClipWise) is a **separate**
transaction handled entirely outside the app under Guideline **3.1.3(c)** — it is
sold by us to the business, never to individual consumers.

Questions: `<SUPPORT_EMAIL>` · `<SUPPORT_PHONE>`.

---

## The two money flows — never let these get conflated

A reviewer who blurs these rejects. Keep them explicitly separate everywhere
(app, website, these notes):

| Flow | What it is | Guideline | Where it happens |
|---|---|---|---|
| **Haircut payment** | customer pays the shop for an in-person service | 3.1.3(e) — must NOT use IAP | in the app, via Stripe Terminal / Tap to Pay |
| **ClipWise subscription** | the shop pays us to use the software | 3.1.3(c) — sold to the business, outside the app | clipwise.ca only |

The 3.1.3(c) trap: *"Consumer, single user, or family sales must use in-app
purchase."* So ClipWise must read as sold **to barbershop businesses**, never to
"individuals / solo barbers." Our site and plan copy use **shop / chair**
language for exactly this reason.

## How the app stays clean (enforced in code)

The app is a Capacitor WebView loading clipwise.ca, tagged with the `ClipWiseApp`
user-agent. `src/lib/native-app.ts` is the single source of truth; every gate
keys off it, so **the website is unchanged** — only the app hides these:

1. **Login-only.** No sign-up link, `/signup` → `/login`, `/` → `/dashboard`,
   `/dashboard/billing` + `/onboarding/plan` → `/dashboard` (middleware).
2. **No purchase surface rendered:** no trial "add a card" banner, no "Plan &
   Billing" in sidebar/menu, no "Subscription" tab in Settings, no prices/plan
   names/upgrade links; `FeatureLock` shows a neutral line only.
3. **Server refusal:** checkout, billing-portal, start-trial, change-plan,
   cancel-subscription, confirm-subscription all 403 a request from the app.
4. **Trial end = drop to the free tier** (app stays usable); a genuinely
   suspended shop sees only "This shop isn't active — contact ClipWise" + a phone
   number as plain text (no URL, no form, no price).

Account deletion is available in-app (Settings) and states the timeframe +
confirms on completion (5.1.1(v)).

## Appeal playbook (expect a first-pass rejection — this is normal)

- Reply in the **Resolution Center**, not the App Review Board. The confirmed
  wins came through Resolution Center in ~3 days; Board appeals dragged for weeks.
- **Request a phone call with the reviewer** — the one reliable way to find out
  what they misread (usually the *website*, not the app).
- Restate: no account creation and no purchase mechanism in the app; haircuts are
  3.1.3(e); the subscription is 3.1.3(c), sold to businesses.
- **Fallback if appeals fail:** enroll IAP on the Small Business Program (15% →
  ~$3.45/mo per shop) and pass it through at no markup (as Booksy does). This is
  the parachute, not the opening move.

## Before you submit — website checklist (the reviewer reads clipwise.ca)

- No "individual / solo / per-barber / for barbers" wording anywhere public —
  say **barbershops / shops / businesses / chairs**.
- Demo account flagged **never-expiring**, loaded with real bookings.
- Privacy policy + support URL live and linked in App Store Connect.
- Because the app loads production, all of the above must be **deployed to `main`**
  before you submit.
