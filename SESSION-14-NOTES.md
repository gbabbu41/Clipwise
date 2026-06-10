# ClipWise — Session 14 Notes (2026-06-10)

Worked from a **Claude Code on the web** session (cloud container, not a local machine).
Pushes go to GitHub `main` via a user-supplied token; Vercel auto-deploys to clipwise.ca.
Focus: a full **payment / plan / feature-flow audit** and fixes shipped in 4 phases,
plus a **critical build fix** (3 deploys had been silently failing).

---

## 0. ⚠️ READ FIRST — pending action

- **Run `supabase/migrations/phase8_loyalty_earning.sql`** in the Supabase SQL editor:
  ```sql
  alter table public.appointments add column if not exists loyalty_awarded boolean default false;
  ```
  Until this runs, completing an appointment can't award loyalty points (it no-ops
  gracefully — no error). `phase6` (barber client read) and `phase7` (POS idempotency)
  were already run this session.

---

## 1. 🔴 The build trap that bit us (don't repeat)

Three production deploys (Phases 2, 3, 4) **silently failed** — the site stayed frozen on
the Phase-1 commit. Root cause:

```ts
// INVALID — { count, head } is only valid on a standalone SELECT, not after .update()
.update({ ... }).select("id", { count: "exact", head: true })   // ❌ Type error: Expected 0-1 arguments, but got 2
```
Next.js **type-checks during build** (`next.config.mjs` only sets `eslint.ignoreDuringBuilds`,
**not** `typescript.ignoreBuildErrors`), so a real TS error aborts the deploy.

**Fix pattern** (atomic claim still works — the WHERE clause guarantees one match):
```ts
const { data: claimed } = await supabaseAdmin.from("appointments")
  .update({ ... }).eq(...).in(...).select("id");
if (!claimed || claimed.length === 0) { /* another run won the race */ }
```

**Why it wasn't caught locally:** the container's `npx tsc --noEmit` has broken module
resolution (everything shows `Cannot find module 'react'`), masking the real error.

**RULE for future sessions:** run a **real build** before pushing, not just tsc:
```bash
npm install            # node_modules is gitignored / not in the fresh container
SKIP_ENV_VALIDATION=1 npx next build   # watch for "✓ Compiled successfully" + type-check pass
```
(The page-data step will fail locally on missing env vars like RESEND_API_KEY — that's
expected and NOT a code error; Vercel has those env vars.)
**Also:** `npm install` may rewrite `package-lock.json` — `git checkout package-lock.json`
before committing so prod builds from the committed deps.

---

## 2. Audit findings → what we fixed (4 phases)

A subagent audited loyalty, payroll, waitlist, appointments, user uniqueness, plan gating.
Several "no RLS" findings were **false** — `schema.sql` already has full RLS + the
`security_patches.sql` triggers. Real gaps were fixed:

### Phase 1 — plan gating + secure loyalty API (`f6676d7`)
- New **`/api/loyalty/points`** route: server-side plan check (Pro/Premium) + shop-ownership
  verification. Loyalty page's "+ Points" now calls it instead of a direct browser Supabase
  write (which any user could have forged from devtools).
- **Loyalty page** shows a locked/upgrade state for Starter plans.
- **Payroll page** shows a locked/upgrade state for non-Premium plans (gated on `commission`).
- Migration `phase6_barber_client_read.sql` — barbers SELECT clients + own transactions.

### Phase 2 — money/trust (`b6da098`, build-fixed in `e8c2acf`)
- **Auto-refund on rejection:** rejecting a *paid* appointment now auto-calls
  `/api/stripe/refund` (was: owner had to click refund separately).
- **No-show cron double-charge lock:** pre-flight sets `payment_status='capturing'`
  (atomic claim) before the Stripe call — a second cron run finds 0 rows and skips.
- **POS idempotency:** `pos-finalize` checks for an existing transaction by
  `stripe_session_id` before inserting; returns the existing row on double-submit.
- Migration `phase7_pos_idempotency.sql` — `transactions.stripe_session_id` + unique index.

### Phase 3 — loyalty earning + redemption (`2a76097`, build-fixed in `e8c2acf`)
- **Auto-earn:** new **`/api/loyalty/award`** awards points when an appointment hits
  `completed`. Plan-gated, owner-or-permitted-barber auth, idempotent via the
  `loyalty_awarded` flag (atomic claim). Points = `points_per_visit + points_per_dollar × total`.
  `updateStatus` fires it fire-and-forget on the completed transition.
- **Redemption:** `/api/loyalty/points` now accepts **negative** points to redeem, rejects
  insufficient balance, and logs every change to the existing `loyalty_rewards` table
  (`earned` / `added` / `redeemed`).
- **Loyalty page:** settings now **persist** to `shops.booking_settings.loyalty`
  (load on mount, Save Settings writes through — previously just a toast). Per-client
  **Redeem** button + modal with a $-value preview from the redemption rate.
- Migration `phase8_loyalty_earning.sql` — `appointments.loyalty_awarded`. **← still to run.**
- **NOT done:** POS-sale loyalty earning — POS walk-ins only carry a name (no email/phone),
  so reliable client matching needs a client picker on the POS flow first. Deferred.

### Phase 4 — access control (`7f4cb3f`, build-fixed in `e8c2acf`)
- **Dashboard layout race window closed:** `/dashboard` now renders a "Redirecting…" spinner
  (instead of the live owner dashboard) while a `barber`/`customer` is being redirected away —
  they previously got a brief flash of owner financials/payroll.
- **Middleware:** added `/barber-dashboard/:path*` to the matcher (auth-only; role logic stays
  in the layout so an owner who also cuts hair isn't locked out).

### Also (start of session) — billing/cancellation (`d5eae13`)
- Cancelling a subscription now **locks premium features immediately**: `refreshShop()` after
  cancel + on upgrade return (`?upgraded=1`), a Supabase realtime listener on the `shops` row
  so webhook-driven status changes auto-refresh the UI, and the dashboard "expired" banner no
  longer hidden after the webhook downgrades the plan to starter.

---

## 3. Owner / admin note
Owner = **gbabbu41@gmail.com** (role `shop_owner` / `super_admin`) has full rights. All the
new guards only block `barber`/`customer` roles, and the plan gates pass for the owner's plan —
nothing in this session can lock the owner out.

---

## 4. Environment / workflow facts for this kind of session
- **Claude Code on the web** runs in an ephemeral cloud container — commit + push or it's lost.
- This session's git proxy and the GitHub App both **lacked push/write access**; pushes only
  worked after the user generated a **GitHub PAT** and we set it on the remote URL. If a future
  web session can't push, that's the fix (or grant the Claude GitHub App write access).
- **Vercel MCP** is connected — can read deployments + (sometimes) build logs. Build-logs
  endpoint returned 401/empty here; reproducing the build locally was the reliable path.
  Team `gbabbu41s-projects` (`team_qFewJKyRoNGpdjB1JjzrgCMf`), project `clipwise`
  (`prj_piHc0ohBHWRAqnFdb6J2OEjvh1tC`).

---

## 5. New files this session
- `src/app/api/loyalty/points/route.ts` — manual add + redeem (plan-gated, audited)
- `src/app/api/loyalty/award/route.ts` — auto-earn on completion
- `supabase/migrations/phase6_barber_client_read.sql` (run)
- `supabase/migrations/phase7_pos_idempotency.sql` (run)
- `supabase/migrations/phase8_loyalty_earning.sql` (**TO RUN**)
