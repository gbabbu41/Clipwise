# App Store / TestFlight review notes — ClipWise

Copy the **Review notes** block below into App Store Connect (App Review
Information → Notes) and fill in the demo login. This file explains, for a
reviewer, why the app contains **no in-app purchase** — and it documents, for us,
exactly how the app stays inside Apple's rules.

> ⚠️ Do **not** commit real demo credentials to this repo. Fill them into App
> Store Connect directly (or a private note). The placeholders below are a
> template only.

---

## Review notes (paste into App Store Connect)

ClipWise is a **business tool for existing barbershop owners and their staff** —
a client for a service they already run on our website, clipwise.ca. It is not a
consumer storefront.

**Demo account (a seeded shop):**
- Email: `<DEMO_OWNER_EMAIL>`
- Password: `<DEMO_OWNER_PASSWORD>`

Sign in with the above to see the full owner experience (calendar, appointments,
checkout/POS, revenue).

**Accounts and any paid plan are created and managed only on clipwise.ca**, in a
web browser — never in the app. The app is a companion client for businesses that
already have an account. There is intentionally no sign-up, no pricing, no plan
selection, and no subscription management inside the app.

**Payments in the app are for real-world, in-person services, not digital
content.** When a barber checks a customer out, they collect payment for a
haircut using **Stripe Terminal** (a physical card reader) or record cash. These
are payments between the barbershop and its walk-in customers for services
performed in person, which fall outside In-App Purchase. The app never sells
digital goods or subscriptions.

If you have any questions, contact `<SUPPORT_EMAIL>`.

---

## Why there's no IAP (our internal rationale)

- ClipWise's own subscription (what a barbershop pays us) is a **multiplatform
  service**: it is sold and managed on the web, and the app is just another way
  to sign in to it. Apple's guideline 3.1.3(b) permits an app to let existing
  customers use content/features they bought elsewhere, as long as the app does
  not **offer** the purchase or **direct** users to buy outside IAP.
- So the app shows **no** ClipWise-subscription surface at all: no pricing, no
  plan cards, no upgrade/subscribe/change-plan/start-trial buttons, no Stripe
  Checkout or billing-portal links, no "add a card" trial banner, no
  subscription invoices, and no "sign up" link on the login screen. A lapsed or
  limited plan shows only a neutral "not included in your current plan" note —
  no upgrade link, no clipwise.ca link, no tappable email — and never blocks the
  rest of the app.
- The **barber's own money stays fully usable**: service prices, POS/checkout
  totals, tips and taxes, daily/weekly revenue and analytics, Stripe Terminal
  card payments, customer refunds, and Stripe Connect payout setup. None of that
  is a digital purchase, so none of it goes through IAP.

## How it's enforced in code (so it can't regress)

The app is a Capacitor WebView that loads clipwise.ca and tags every request with
the `ClipWiseApp` user-agent (`appendUserAgent` in `capacitor.config.ts`). One
helper, `src/lib/native-app.ts`, is the single source of truth for "am I in the
app?" — `isNativeApp()` on the client, `isNativeRequest()` / `isNativeUserAgent()`
on the server. Every gate keys off that, so the **website is completely
unchanged** — only the app hides the billing surface. Three layers:

1. **Router block** (`src/middleware.ts`): in the app, `/` → `/dashboard`,
   `/signup` → `/login`, and `/dashboard/billing` + `/onboarding/plan` →
   `/dashboard`. Unreachable by deep link, back-nav, or a stale URL.
2. **Not rendered** (absent from the DOM, never CSS-hidden): the trial "add a
   card" banner returns null; the sidebar and profile menu drop "Plan &
   Billing"; Settings drops the whole "Subscription" tab; `FeatureLock` shows a
   neutral line with no plan name and no upgrade link; the dashboard's
   expired-subscription banner becomes a neutral note with no "Restore Features"
   link; the pending-shop page hides "Manage billing"; the login "Sign up" line
   is resolved on the server so it never ships to the app; plan-name upsell copy
   (Staff barber limit, booking no-show note, Locations) is neutralized.
3. **Server refusal**: `checkout`, `billing-portal`, `start-trial`,
   `change-plan`, `cancel-subscription`, and `confirm-subscription` all return
   403 to a request from the app.

## When shipping a build

Because the app loads production (clipwise.ca), the gating only takes effect
once these changes are **deployed to `main`** (Vercel → clipwise.ca). A build
made before that deploy would still show the billing surface. After deploy,
launch the app and confirm: no "Sign up" on login, no "Plan & Billing" in the
menu/sidebar, no "Subscription" tab in Settings, and the trial banner is gone.
