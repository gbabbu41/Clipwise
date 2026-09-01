# ClipWise — Market-Ready TODO

Status snapshot (2026-06-07): core app is real (real Supabase, Stripe test mode,
Twilio, Resend). Demo-mode leftovers removed. Below is what's left to ship and grow.

---

## ⏳ DO LATER — Email deliverability (Resend) + turn on email verification
These are **dashboard/config actions** (Claude can't do them — they need your
Supabase & Resend logins). Do them together, in order, THEN re-enable email
verification. Until then keep Supabase "Confirm email" **OFF** so nobody is
locked out.

1. **Resend — verify the `clipwise.ca` domain.** Resend → Domains → Add Domain →
   `clipwise.ca` → add the DNS records to your registrar → wait for "Verified".
   (Right now the app falls back to Resend's test sender `onboarding@resend.dev`,
   which only delivers to your own inbox — so customer receipts/reminders may not
   be arriving.)
2. **Vercel env — set `FROM_EMAIL=noreply@clipwise.ca`** (after step 1 verifies).
   Ping Claude to confirm the code already reads it (it does: `src/lib/emailer.ts`).
3. **Supabase — custom SMTP** (Project Settings → Authentication → SMTP):
   Host `smtp.resend.com` · Port `465` · User `resend` · Password = Resend API key
   (`re_…`) · Sender `noreply@clipwise.ca` · Name `ClipWise`.
4. **Only then** re-enable Supabase "Confirm email". (Existing accounts were
   already backfilled as confirmed via SQL, so they stay logged-in-able.)

5. **🔒 Stop leaking your personal email as the Reply-To** (found 2026-08-31).
   ClipWise's platform emails to SHOP OWNERS (signup / "You're Approved" / admin
   alerts) set **Reply-To = the `ADMIN_EMAIL` env var**, which is currently your
   personal **`gbabbu41@gmail.com`** — so every shop owner sees + replies to your
   personal inbox. (Verified from a real "You're Approved" header: From
   `Hello@clipwise.ca` ✅ but Reply-To `gbabbu41@gmail.com` ✗. Code:
   `src/lib/emailer.ts:1270`, `ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? "admin@clipwise.ca"`.)
   Root cause: no ClipWise inbox, so the admin address was pointed at personal gmail
   to actually receive replies. (Customer-facing emails are FINE — they reply to the
   shop's own contact email, e.g. real shops use `desidripdrop@gmail.com`, not this.)
   Fix — pick one, then set the Vercel env:
   - **Recommended — Google Workspace (~$6/mo):** a real `support@clipwise.ca` (or
     `hello@`) mailbox. Read AND reply from it; personal gmail never involved.
   - **Free — Cloudflare Email Routing + Gmail "Send mail as":** forward
     `support@clipwise.ca` → your gmail (to READ), then Gmail → Settings → Accounts →
     "Send mail as" `support@clipwise.ca` (to REPLY as it; needs an SMTP, e.g. Resend).
   - **Then, in Vercel:** set `ADMIN_EMAIL=support@clipwise.ca` (or `hello@`) and
     redeploy. Done — professional reply-to, replies still reach you, no personal leak.
   (No code change needed; `ADMIN_EMAIL` is only ever used as the reply-to fallback.)

---

## 🟢 0. GO-LIVE CHECKLIST — switch from sandbox to real money
Do these **in order** the day you flip ClipWise live. Mostly key swaps, no code rewrite.

- [ ] **Turn ON the check-out / completion barrier.** It's deliberately OFF for testing
      (`BARRIER_ENABLED = false` in `src/lib/utils.ts:179`) so future test bookings can be
      completed early. At go-live flip it to `true` so staff can only mark an appointment
      complete / charge it from `CHECKOUT_LEAD_HOURS` (3h) before its start onward. (Owner
      decided 2026-08-12: leave off until launch.)
- ✅ **SQL migrations: nothing to run** — a full `information_schema` audit on 2026-08-12
      confirmed prod is fully migrated (see §2). Premium is already $79 with multi-location.

### 🔒 Security — 3 items DEFERRED by owner (2026-08-30) → do BEFORE real shops onboard
A security audit (2026-08-30) closed the dangerous **write-side takeover** holes already
(`phase54_rls_privilege_lockdown.sql`, APPLIED + verified on prod):
super_admin self-elevation, uninvited barber self-registration, barber self-escalating
their own pay/active/shop.
> ⚠️ **The real super_admin self-elevation guard is the RESTRICTIVE policy
> `users_no_self_elevate`** on `public.users` (FOR UPDATE, WITH CHECK
> `role IS DISTINCT FROM 'super_admin' OR is_super_admin()`). Re-verified live 2026-09-01.
> `protect_admin_role` is a PERMISSIVE policy and is NOT the guard (permissive only widens);
> do NOT drop `users_no_self_elevate` assuming `protect_admin_role` covers it — it doesn't.
> (An external audit that predates phase54 may still say "escalation is open" — that's stale.)

What's left is **read-only exposure** — safe to defer while it's
only sandbox/test shops, but the trigger to fix is **before real shop owners onboard** (that's
when real owner contact + billing becomes scrapeable via the public anon key):
- [ ] **PII read leak (the important one).** `shops` + `barbers` have public/anon SELECT
      policies, and RLS is row-level not column-level, so anyone with the anon key can read
      EVERY column — `shops.stripe_account_id`, owner `email`/`phone`, `twilio_phone_number`,
      `stripe_customer_id`/`stripe_subscription_id`, subscription state; and `barbers.user_id`
      (auth UUID), `email`, `commission_percent`. The app itself already selects only safe
      columns (`booking-client.tsx:315`), so the fix is DB-side: expose a booking-safe **view**
      (`public_shops` / `public_barbers`) with only the columns the booking page needs, grant
      anon SELECT on the view, repoint the two anon reads in `booking-client.tsx`, then tighten
      the base-table SELECT policies to owner/stakeholder-only. ⚠️ Map EVERY `shops`/`barbers`
      reader first (owner dashboard, barber portal) so tightening doesn't break them; needs a
      real `next build` + deploy + booking smoke test.
- [ ] **Leaked-password protection** — Supabase Auth setting is OFF. Turn it on in the
      Supabase dashboard (Authentication → Passwords → "Leaked password protection"). Owner
      action, 30s. (Advisor WARN; testers currently share one weak password.)
- [ ] **Two anon-callable functions** — revoke EXECUTE from `anon` on `owns_shop(uuid)` (a
      shop-ownership yes/no oracle) and on `rls_auto_enable()` (internal event-trigger fn).
      ⚠️ Check first that no anon-reachable RLS policy calls `owns_shop` before revoking.

> ℹ️ **How customer payments work (test vs live) — expected behavior, not a bug.**
> Stripe **Connect** = receiving customer payments (payouts). In **sandbox/test**
> mode the app intentionally falls back to a **platform charge** so demos work
> *without* a shop completing Connect onboarding — that's why payments go through
> even for an un-onboarded shop. In **live** mode this fallback is blocked
> (`STRIPE_LIVE_MODE` in `lib/stripe.ts`): online pay is refused until the shop
> finishes Connect, so the money lands in **their** account, not the platform's.
> (Separate from the **Customer Portal**, which only manages the owner's own
> ClipWise *subscription*.)

### A. Switch Stripe from test/sandbox → live (in Vercel env)
- [ ] `STRIPE_SECRET_KEY` → change `sk_test_...` to `sk_live_...`
- [ ] `STRIPE_PUBLISHABLE_KEY` / `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` → `pk_test_` to `pk_live_`
- [ ] **Recreate the webhook in Stripe LIVE mode** (sandbox webhooks do NOT carry over):
      - Stripe (live) → Developers → Webhooks → Add destination
      - URL: `https://clipwise.ca/api/webhooks/stripe`
      - **Choose "Connected accounts"** (same as sandbox — this is what makes payment
        tracking work; see section 1 🔴)
      - Events: `checkout.session.completed`, `payment_intent.succeeded`,
        `payment_intent.payment_failed`
      - Copy the new `whsec_...` → update `STRIPE_WEBHOOK_SECRET` in Vercel
- [ ] **Redeploy** in Vercel so the new keys take effect.

### B. Every shop owner must reconnect Stripe (LIVE)
- [ ] ⚠️ Sandbox Connect accounts do NOT transfer to live. After switching keys, every
      shop will show **"Restricted"** until they reconnect.
- [ ] Each owner: app → Billing → **Connect Stripe** → complete onboarding with **real**
      business info + bank account (real ID, not test data this time).
- [ ] Confirm each shop shows **"Charges enabled"** in Stripe → Connected accounts before
      relying on their payment links.

### C. Final smoke test (with a REAL card, small amount)
- [ ] Make one real booking + pay → confirm money lands in the **shop's** Stripe balance
      (0% platform fee — direct charge), and the in-app status flips to **Paid**.
- [ ] Refund that test charge from the Payments page so you're not out of pocket.

> Note: money goes **directly customer → shop owner** (connected accounts, 0% platform fee).
> You (platform) can view/suspend/pause-payout on any shop but never hold their funds.

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
- [ ] 🔴 **Webhook MUST listen to *connected-account* events** — payment links + bookings
      charge on each shop's connected account, so a normal account-level webhook never
      receives `checkout.session.completed` for them and `payment_status` never flips to
      Paid in-app. In the Stripe webhook config, enable "Listen to events on connected
      accounts" (or add a Connect webhook). This is the likely reason sent links look
      "untracked." (Workaround in-app: the Payments page "Refresh" button re-checks Stripe.)
- [ ] **Go live on Stripe** when ready: swap `sk_test_/pk_test_` for live keys in Vercel,
      and have each shop owner complete **Stripe Connect** onboarding (Billing page).
- [x] ✅ **SQL migrations** — all applied on prod (verified 2026-08-12; see §2). Nothing pending.
- [ ] **Email domain**: `FROM_EMAIL=Hello@clipwise.ca` — verify the domain in Resend and
      set up inbox/forwarding so replies don't bounce (MX / Cloudflare Email Routing).
- [ ] ⚖️ **Merchant-of-record / liability (pre-launch, get legal review):** ClipWise must stay
      the *platform*, with each **shop as the seller / merchant of record** — not ClipWise.
      · This is already true on Stripe **direct charges** (connected account = MoR; shop owns
        the tax, refunds, chargebacks). Keep using direct charges; the platform-charge
        fallback is now LIVE-blocked (test-only) — never let it run with real money.
      · Receipt re-skinned to lead with the SHOP as seller + "merchant of record" line;
        ClipWise only in small print as the software provider.
      · TODO before live: have a lawyer review the customer Terms + the Stripe Connect
        platform agreement so the platform-vs-seller roles are documented; confirm sales-tax
        responsibility sits with the shops; make sure no ClipWise tax IDs / "we sold this"
        language appears on customer-facing payment docs.
- [ ] **Receipts — later move to Stripe-native (optional):** the app currently sends its own
      branded `payment_receipt` email via Resend (works in test mode, fired on manual capture
      AND now on payment-link webhook). Stripe does NOT auto-send receipts in test mode. When
      live, decide: keep the app's Resend receipt, OR enable Stripe's native receipts
      (Stripe Dashboard → emails: "successful payments" + set `receipt_email` on the
      PaymentIntent/session). Don't enable both or customers get two receipts.

---

## 🛡️ 1b. Compliance / legal checklist ("vibecoded app" risk audit — 2026-08-12)
Audited against the 10 common "getting-sued" risks. Code fixes are shipped; the
open items below are config/legal that only the owner can finish.

**✅ Done in code (shipped 2026-08-12):**
- [x] **Privacy Policy exists** (`/privacy`, PIPEDA-aware) + **data-collection disclosed**.
- [x] **AI disclosed in the Privacy Policy** — automated processing + the AI phone
      assistant (call audio transcribed/processed by AI providers). `src/app/privacy/page.tsx`.
- [x] **Subprocessors listed** — Stripe, Twilio (SMS **+ voice**), Resend, Supabase
      (db/auth/**storage**), Vercel, **Cloudflare**, **Google**, **AI providers (Anthropic)**.
- [x] **User uploads are deleted on erasure** — account/shop deletion + orphaned-barber
      cleanup now remove the actual files (avatars, barber photos, shop logos) from the
      public buckets, not just DB rows. `src/lib/storage-cleanup.ts` + the 3 delete paths.
- [x] **Storage buckets** — public is by design (public-facing images, UUID paths, listing
      disabled, magic-byte validation, auth on writes). Acceptable; no action.
- [x] **Cancel is as easy as signup** — self-serve, 2 clicks, no dark pattern; now scoped to
      the ACTIVE shop (multi-location fix).
- [x] **Auto-renew reminder — code added** — `invoice.upcoming` webhook →
      `subscription_renewal_reminder` email (⚠️ needs the Stripe toggle below to fire).
- [x] **AI crisis/self-harm guardrails — code added** — voice-server system prompt now
      refuses out-of-scope + directs to 988/911 (⚠️ needs the voice-server redeploy below).
- [x] **Testimonials** — no fake *ClipWise* testimonials exist; added trademark/"not
      affiliated"/"reflects those users' experiences" disclaimer to `/why-clipwise`.

**⚠️ Owner action required (config / legal — not code):**
- [ ] **Enable `invoice.upcoming`** on the LIVE Stripe webhook (Developers → Webhooks →
      your endpoint → add event). Without it the renewal-reminder email never fires.
      Optionally set the reminder lead time in Stripe Billing settings.
- [ ] **Redeploy the voice server** (`voice-server/`, on Railway/Render/Fly — NOT Vercel) so
      the AI crisis/safety guardrails take effect. Verify with a test call.
- [ ] **Substantiate the `/why-clipwise` competitor quotes** — they name real people
      ("Joshua O.", "Chris F.") + hard stats ("1.4/5 from 89 reviews"). Hold a verifiable
      source for each, or tell Claude which to soften/remove. Unsourced attributed quotes are
      the real FTC/defamation risk.
- [ ] **Lawyer review of the Privacy Policy + Terms** before billing real customers — the
      disclosures added are factual descriptions of what the app does, not legal advice.

**Minor (optional):**
- [ ] Pin the `avatars` storage bucket in a migration (currently created at runtime in
      `upload-avatar/route.ts`, so its public flag isn't declaratively set like the others).

---

## 🗄️ 2. SQL migrations — ✅ ALL APPLIED ON PROD (verified 2026-08-12)
> A full `information_schema` audit on **2026-08-12** confirmed **every** migration's
> columns/tables are present on prod. **The entire list below is RUN**, even where an old
> `[ ]` checkbox was never flipped. Do NOT re-run these hunting for a fix — the DB is fully
> migrated. The per-phase notes below are kept only as a reference for what each one added.
> Track only migrations added *after* this date as new to-dos.
- [x] 🟠 **Phase 15 transaction provenance** (`supabase/migrations/phase15_transaction_source.sql`)
      — **RUN BEFORE deploying the phase15 code** (transactions `source` +
      `appointment_id`). The POS finalize + cash inserts now set `source`; without
      the columns those inserts fail (Stripe charged but sale not recorded).
      Additive/nullable; makes Payments de-dup provenance-based instead of the
      `client_name|amount` heuristic. Lives on branch `claude/gallant-euler-7fkw5h`
      until the column exists; then push to main.
- [ ] 🔴 **Shop booking_settings column** (`supabase/migrations/phase5_shop_booking_settings.sql`)
      — **CRITICAL, run this first.** `shops.booking_settings` was never created in prod, so
      no-show protection/warning/hold + capture-appointment + auto-confirm + deposits all
      silently fail (capture-appointment 404s with "column shops.booking_settings does not
      exist"). Adds the JSONB column + a sane default for existing shops.
- [ ] **Phase 1 no-show fee column** (`supabase/migrations/phase1_no_show.sql`):
      ```sql
      alter table public.appointments add column if not exists no_show_fee_amount integer;
      ```
- [ ] **Phase 2 save-card columns** (`supabase/migrations/phase2_save_card.sql`) — REQUIRED
      for the >7-day save-card flow to work (without them, far-future online
      bookings can't store the card and finalize will fail):
      ```sql
      alter table public.appointments
        add column if not exists stripe_customer_id text,
        add column if not exists stripe_payment_method_id text;
      ```
- [ ] **Smart-waitlist table** (`supabase/migrations/phase3_appointment_waitlist.sql`) — REQUIRED
      for the "notify me when a spot opens" feature. Creates `appointment_waitlist`
      (customer opt-ins on full days). Without it, the booking-page "Notify me" button errors.
- [ ] **Double-booking guard** (`supabase/migrations/phase4_prevent_double_booking.sql`) —
      partial UNIQUE index on `(barber_id, date, time_slot)` for active (pending/confirmed)
      rows with a barber assigned. Stops two appointments at the same barber/time even in a
      race. ⚠️ Fails if active duplicates already exist — see the detection query in the file,
      clean them first. App also pre-checks for a friendly message (and reverses online
      payment if the slot is lost in the race).
- [x] **Phase 6 barber client read** (`supabase/migrations/phase6_barber_client_read.sql`) — RUN.
      Lets barbers SELECT clients + their own transactions in their shop (POS lookup / context).
- [x] **Phase 7 POS idempotency** (`supabase/migrations/phase7_pos_idempotency.sql`) — RUN.
      Adds `transactions.stripe_session_id` + unique index so a POS double-submit can't
      double-charge (pos-finalize returns the existing row instead of inserting twice).
- [ ] **Phase 8 loyalty earning** (`supabase/migrations/phase8_loyalty_earning.sql`) — ⚠️ STILL TO RUN.
      Adds `appointments.loyalty_awarded boolean default false`. Without it, completing an
      appointment can't award loyalty points (the /api/loyalty/award claim no-ops gracefully).
      ```sql
      alter table public.appointments add column if not exists loyalty_awarded boolean default false;
      ```
- [ ] **Phase 14 appointment duration** (`supabase/migrations/phase14_appointment_duration.sql`) — ⚠️ STILL TO RUN.
      Adds `appointments.duration_minutes int`. Multi-service bookings now create ONE
      appointment spanning the combined length (stored here); without it the combined
      duration / calendar block / conflict-window fall back to the primary service only.
      ```sql
      alter table public.appointments add column if not exists duration_minutes integer;
      ```
- [ ] **Phase 13 appointment paid_at** (`supabase/migrations/phase13_appointment_paid_at.sql`) — ⚠️ STILL TO RUN.
      Adds `appointments.paid_at timestamptz` (+ backfills paid/captured rows with
      created_at). Drives the "Paid · 10 min ago / yesterday" labels on the Payments
      page, Appointments side card and Calendar detail card. Without it the relative
      time is just blank (status badge still shows).
- [x] **Phase 12 notifications realtime** (`supabase/migrations/phase12_notifications_realtime.sql`) — RUN (owner ran it).
      Adds `public.notifications` to the `supabase_realtime` publication so the live
      pop-up banner + chime (payments, bookings, no-shows) actually fires.
- [x] **Phase 11 appointment checkout session** (`supabase/migrations/phase11_appt_checkout_session.sql`) — RUN (owner ran it).
      Adds `appointments.stripe_checkout_session_id` for payment-link reconciliation.
- [x] **Phase 10 subscription backend update** (`supabase/migrations/phase10_subscription_backend_update.sql`) — RUN (owner ran it).
      Relaxes `prevent_shop_field_escalation`
      so the trusted service-role backend (Stripe webhook + `/api/stripe/confirm-subscription`)
      can set `shops.subscription_plan/status`; previously the trigger rejected the plan change
      (auth.uid() is NULL for service role → treated as non-admin) so starter→pro upgrades
      silently did nothing. Owners still can't self-escalate (guard still applies to real users).
- [x] **Phase 9 pricing plans** (`supabase/migrations/phase9_pricing_plans.sql`) — RUN (owner ran it).
      Created the admin-editable `plans` table (single source of truth for pricing +
      feature gating), RLS (public reads active, super_admin writes), seeded the 4
      current tiers, and dropped the hardcoded `shops.subscription_plan` CHECK so new
      tiers can be assigned. Edit plans at **Admin → Settings → Subscription Plans**.
- [ ] *(optional)* **Per-visit reviews** — reviews currently dedupe one-per-client-per-shop.
      To allow a review per appointment, add `appointment_id uuid references appointments(id)`
      to `reviews` and switch the dedupe in `/api/reviews/submit` to use it.
- [ ] *(belt-and-suspenders)* unique index on `clients (shop_id, lower(email))` to enforce
      no-duplicate clients at the DB level (app already dedupes).

---

## 🔎 2b. Code-review backlog (Session 16 — `/code-review` of AI-generated code)
Full verified findings are in `SESSION-16-NOTES.md`. **#1–#3 are FIXED + DEPLOYED**
(commit `2cc263f`). The rest are open, ranked, with file:line + a proposed fix:

**Follow-ups to the booking fix (recommended next):**
- [ ] **Race-proof double-booking (DB-level)** — current overlap guard is app-level
      (booking-checkout + booking-finalize + in-person pre-check + slot grid). A simultaneous
      race on two *overlapping different-start* slots for the same barber isn't 100%
      DB-guaranteed. Add a Postgres exclusion constraint (needs `btree_gist` + a generated
      time-range from date+slot+duration; duration must be denormalised onto `appointments`).
- [ ] **Multi-service ONLINE booking** (`book/[shopslug]/page.tsx` confirmBooking) — the online
      path sends only the primary `service_id` + start slot but charges the full multi-service
      total; only ONE appointment is created. Send all services (or block multi-service online).

**Payments:**
- [ ] **Refund is always full + wrong email + can't release holds** (`api/stripe/refund/route.ts:38`)
      — `refunds.create({payment_intent})` (no amount); email shows `total_amount` even for a
      partial no-show capture; a held/uncaptured PI throws (500). Refund the captured amount,
      email the real figure, `cancel()` uncaptured holds.
- [ ] **POS revenue overstated by discounts** (`api/stripe/pos-finalize/route.ts:46`) — stores
      `amount: subtotal`, ignoring `discount`. Record the actually-collected amount.
- [ ] **Subscription upgrade can double-bill** (`webhooks/stripe:82`) — old sub cancelled only
      in the webhook and the error is swallowed (`.catch(()=>null)`). Also cancel synchronously
      in the upgrade route / reconcile.
- [ ] **Stale `PLAN_PRICING` fallback in checkout** (`api/stripe/checkout/route.ts`) — if a plan
      is deactivated/repriced, checkout falls back to the hardcoded map → can charge the old
      price for a retired plan. Reject when the DB plan is missing/inactive.

**Auth / account:**
- [ ] **Self-signup barbers stranded** (`signup/barber/page.tsx`) — creates user + role `barber`
      but never links a `barbers` row → "Account not linked"; only owner-invite links them.
      Clarify to invite-only, or auto-create a pending link.
- [ ] **Multi-shop owners lose active shop hourly** (`lib/auth-context.tsx:72`) — `onAuthStateChange`
      resets `shop` to `shops[0]` on EVERY event (incl. TOKEN_REFRESHED / focus), overwriting
      `setActiveShop`. Only reset on real sign-in.
- [ ] **Onboarding `.maybeSingle()` throws for multi-shop owners** (`onboarding/page.tsx:65`) —
      restore-by-owner_id errors when an owner has 2+ shops. Use `.limit(1).maybeSingle()` /
      order by created_at.
- [ ] **Google OAuth has no callback/role routing** (`login/page.tsx:64`) — redirects straight to
      `/dashboard`; non-owners land wrong, owner-via-Google impossible. Add a role-aware callback.
- [ ] **Rejected/suspended shops dead-end on `/pending`** (`dashboard/layout.tsx`) — owner can't
      reach billing/settings to re-apply/upgrade. Allow those routes.

**Plan-gating (page + booking UI gates DONE — commits `706639d`, `9c81844`; deployed):**
- [x] Page-level `<FeatureLock>` on POS / Inventory / Gift Cards / Payments (were sidebar-hide only).
- [x] Booking page is pay-in-person-only for non-charging plans (`shopCanCharge`).
- [ ] **Server-side enforcement for Inventory/POS pages** — current gates are client-side;
      the payment/loyalty server routes are gated, but inventory writes go straight to Supabase
      under owner RLS (no plan check). Add a plan check to inventory/POS data paths for defence
      in depth (low priority — client gate covers the normal UX).
- [ ] **Reminder:** gating honors the `plans` table — keep the Starter plan's feature toggles
      OFF in Admin → Settings, else features are intentionally unlocked.

**Lower:**
- [ ] **Webhook has no event-id idempotency** (`webhooks/stripe`) — Stripe retries re-run side
      effects (duplicate "payment failed" notifications). Add a processed-events guard.
- [ ] Plans-code edges (`lib/validation.ts`): `effectivePlan` hardcodes the free slug `'starter'`;
      `hydratePlanConfig` ignores empty input so an all-plans-deleted state never propagates;
      the 60s plan cache is per-instance (edits can lag up to 60s across warm Lambdas).

---

## 💳 3. Payments — Phase 2 & 3 (no-show automation + deposits)
**Phase 1 is done**: card held at booking (≤7 days), auto-capture on Complete, manual
"Charge No-Show".
**Phase 2 (save-card) is done**: bookings >7 days out now SAVE the card (Stripe Checkout
`setup` mode, no charge) instead of holding it, and charge it off-session on Complete /
no-show. Customer must accept a no-show disclaimer before any card is taken; pay-in-person
still takes no card. Needs the `phase2_save_card.sql` migration (section 2) run.
- [ ] **Verify the live card legs** (needs a human + test card `4242…`): (a) >7-day booking
      saves the card and finalizes, (b) Complete charges the saved card, (c) no-show cron/
      manual charge hits the saved card. Off-session charges can hit `authentication_required`
      (SCA) — for CA cards this is rare; failures flag the row `payment_status=failed`.

- [x] **Per-shop no-show settings** — Settings → Booking → "No-Show Protection" toggle +
      "No-Show Fee ($)" (0 = full). Stored in `shops.booking_settings` JSON.
- [x] **Auto-capture cron** — `POST/GET /api/cron/no-show` captures the held card ~2h after
      a missed appointment, sets status `no-show`, SMSes the client (Twilio inlined).
      - [ ] **SCHEDULE IT**: `vercel.json` has a `*/30 * * * *` cron (needs Vercel **Pro**).
            On Hobby, instead point an external scheduler (cron-job.org / GitHub Actions) at
            `https://<domain>/api/cron/no-show` with header `x-cron-secret: <CRON_SECRET>`.
      - [ ] Note: slot times are parsed in server (UTC) time — fine with the 2h grace, but if
            shops span timezones, store/compare an explicit tz later.
- [ ] **SMS reminder** before the cancellation window closes ("cancel before X to avoid a fee")
      — not built yet (separate from the no-show capture).
- [ ] **Phase 3 — deposits**: per-shop `deposit_enabled`/`deposit_amount`; charge deposit at
      booking, balance at completion; refund rules on cancel (refund outside window,
      forfeit inside).

---

## ✨ 4. Squire/Booksy-style features (competitive gaps)
- [x] Recurring appointments ("every 2 weeks") — Add-Appointment modal has a Repeat
      option (weekly/biweekly/4-weekly, N visits) that creates one row per occurrence.
- [x] Smart waitlist auto-fill when a slot frees up — booking page "Notify me if a spot
      opens" on full days → `appointment_waitlist`; cancel/reject/no-show/refund fire
      `/api/waitlist/slot-opened` which emails + texts waiters. (Needs phase3 migration.)
- [ ] Rebooking nudges for at-risk clients (already have the data + SMS/email).
- [ ] Richer client "memory": hair profile surfaced in POS + appointment view.
- [ ] Marketing/SMS campaigns (broadcast offers, birthdays — birthday email exists, automate it).
- [ ] Google Business review sync (Place ID field exists).
- [ ] **Tax collected report + set-aside (CRA)** — a "Taxes" view showing GST/HST
      **collected this year + by quarter**, plus a running "set aside $X" figure so the
      owner doesn't spend the government's share. Frame it as *collected* (output tax),
      not *owed* — the amount remitted is netted against input tax credits, which we
      don't have. IMPORTANT: sales tax always stays with the shop and is remitted on
      their own filing schedule — it never goes to CRA per-sale, even with future
      integration. Future add-ons: filing-due reminders, NETFILE / pre-filled return.
      Placement leaning: **Payments** (money/compliance), reached as its own tax view —
      not Analytics. Data already exists: `transactions.tax` + `appointments.tax_amount`.

### 4b. Tap to Pay / card-present (when wrapped in Capacitor)
Decision (Session 17): take **native Tap to Pay** once ClipWise is wrapped as a
native app with **Capacitor**. True "tap a card/phone onto the staff phone" needs
the native Stripe Terminal SDK + NFC + secure element — **impossible in the web/
PWA**, so it waits for the Capacitor shell. Today's POS "Card" = Stripe Checkout
redirect (Apple/Google Pay already available on that hosted page).
- **Market OK**: Tap to Pay on iPhone/Android is supported in **Canada** (clipwise.ca).
- **Native bridge**: add a Capacitor Stripe Terminal plugin (`@capacitor-community/
  stripe` now includes Terminal/Tap to Pay) or a thin custom plugin over Stripe's
  native Terminal SDK. The web UI calls it through Capacitor.
- **Apple**: request the *Tap to Pay on iPhone* entitlement
  (`com.apple.developer.proximity-reader.payment.acceptance`); iPhone XS+ / iOS
  16.7+; paid Apple Developer account. **Android**: NFC device, Android 11+.
- **Stripe**: enable Terminal; create a **Location** object per shop; the phone
  registers as the reader. Charges run on each shop's **connected account** (same
  Connect model as the rest of the app).
- **Reusable backend I can build now in this repo** (platform-agnostic — the
  Capacitor app just calls these later; hold off wiring to UI until the app build
  starts so we don't ship untested payment code to prod):
  - `POST /api/stripe/terminal/connection-token` — Terminal connection token on
    the connected account.
  - card-present **PaymentIntent** create + capture (`payment_method_types:
    ['card_present']`), then insert the SAME `transactions` row POS writes today
    (`payment_method: "card"`, `stripe_session_id` or an intent id) so it shows
    live in Payments + receipts with zero feed changes.
- **What stays identical**: UI, transactions table, Payments realtime feed,
  receipts. A Tap to Pay sale is just another card transaction.

---

## 🎨 5. Modern UX + libraries
- [ ] Adopt a component lib (shadcn/ui) for consistent dialogs/tables/forms.
- [ ] `sonner` for toasts (replace the per-page custom Toast components).
- [ ] `framer-motion` for transitions (drawer, modals, page changes).
- [ ] Proper data tables (sorting/pagination) on clients/appointments/analytics.

---

## 🧹 6. Smaller polish / known gaps
- [ ] Barbers need an **email saved** (Staff page) to receive booking notification emails
      (incl. the new cancel/no-show alerts).
- [ ] ⚠️ Twilio is on **trial** — SMS only reaches *verified* numbers until you upgrade +
      finish A2P/number registration. Verify before relying on customer texts in production.
- [ ] Audit remaining `?? "http://localhost:3001"` fallbacks in email/cron routes — fine once
      Vercel env is set, but consider a single shared `appUrl()` helper.
- [ ] Per-page custom `Toast` components are duplicated — unify (ties into sonner above).
- [ ] Status value is `confirmed` in DB but shown as "Booked" — optionally migrate the value
      app-wide for consistency (currently display-only).
- [ ] Automated birthday-email cron (currently manual trigger).
- [ ] Real SMS reminders for appointments (cron exists for email; add Twilio).

---

## ✅ Recently done (for reference)
- **Stripe "Restricted" warning** — dashboard-wide orange banner (StripeWarningBanner) shown
  to owners on a payments-capable plan whose Connect account isn't charge-enabled yet. Does a
  live `/api/stripe/connect/status` check so a stale flag can't hide it. Prevents the failed-
  payment situation hit with the Bloke Boyz shop.
- **Recurring appointments** — Repeat dropdown in the Add-Appointment modal.
- **Smart waitlist** — customer "Notify me if a spot opens" on full days + auto email/SMS to
  waiters when an appointment is cancelled/rejected/no-showed/refunded. Owner view at
  `/dashboard/waitlist-requests` (Operations → Spot Waitlist): per-day queue, manual "Notify
  all", mark booked / remove. Needs phase3 migration.
- **Payments page** (`/dashboard/payments`, owner) — unified ledger of appointment payments
  + POS sales with status filters + totals (collected / outstanding / held-saved). One-click
  "Open Stripe Dashboard" (Express login link via `/api/stripe/dashboard-link`), per-row
  "Refresh" to re-check Stripe when the webhook missed (`/api/stripe/refresh-payment`), and
  "Send link" for outstanding rows. Sidebar → Operations → Payments (owner, payments feature).
- Barber now emailed on cancel / reject / no-show (new `/api/appointments/notify-cancellation`
  + `barber_appointment_change` template). Customer now gets booking-confirmation SMS (online
  + in-person) and 24h reminder SMS (reminders route now sends email + SMS).
- Customer payment-receipt email on every card charge (held capture, saved-card charge,
  no-show fee) — wired server-side in capture-appointment + no-show cron. Owner gets an
  in-app "card charge failed" alert when an off-session charge fails.
- Save-card flow for bookings >7 days out (Checkout setup mode → off-session charge on
  Complete/no-show) + mandatory no-show consent disclaimer on the card path.
- Real Stripe POS card payments + customer picker; booking card-hold + capture flow.
- Reviews fixed (were never saving — RLS + wrong FK); barber rating recalculates.
- Auto-register booking customers as clients (deduped); single client source.
- POS mobile redesign (app-style) + desktop side panel.
- Appointments: Booked label, date dropdown + calendar filter, open-queue default sort.
- Removed demo-mode leftovers (fake upgrade button, mock-data.ts, dead stripe-setup page).
- Hardened Stripe return URLs + webhook secret trim.
