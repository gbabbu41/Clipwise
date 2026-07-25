# SESSION 18 NOTES (2026-07-21)

Cross-machine log of everything shipped this session. **All commits are on
`main`** (deployed via Vercel). Theme of the session: a **universal top header**
+ **consistent top padding** across every owner page, plus the mobile
sidebar-cutoff fix and the blue-signature colour migration from earlier turns.

> ⚠️ The dev branch `claude/gallant-euler-7fkw5h` is diverged (Capacitor
> groundwork only) — it does **not** carry these commits. Everything below was
> shipped straight to `main` via short-lived temp branches off `origin/main`.
> The stop-hook "Unverified commits" warning refers to that diverged branch's
> old history, not this work.

---

## The big one: ONE universal top header, consistent across the whole owner app

**Goal (owner's words):** "Make a template … one universal element for the top
navigation — title on one side, bell + profile on the other — consistent all
across the app. Below stays per-page." And: every page's **top padding must
match**.

### The template — `<DashboardHeader>`
File: **`src/components/dashboard/page-header.tsx`**

```tsx
<DashboardHeader title="…" subtitle="…" action={<…optional…/>} />
```

- Renders the `.cwd-hdr` markup: **title (+ optional subtitle) on the left**,
  **notification bell + profile avatar on the right** — the exact top the
  dashboard home uses.
- **The template owns its own top spacing:** its root is
  `cwd-hdr pt-6 lg:pt-8` (**24px mobile / 32px desktop**). So any page that
  drops it in sits at the same distance from the top — **no per-page padding to
  drift.** This was the fix for the recurring "tops don't line up" problem: the
  spacing lives in ONE place now.
- **Rule for consumer pages:** give the page root **horizontal padding only**
  (`px-*`, *not* `p-*`), or the top doubles up.
- **Optional `action` slot** (added this session): a `ReactNode` rendered
  **left of the bell**, so a page's primary action (e.g. an "add" button) stays
  on the header row without breaking the consistent right-hand bell+profile
  cluster.
- The bell **opens the notification popover on mobile** (dispatches the
  `cw-open-notifs` window event the sidebar listens for) and **navigates to
  `/dashboard/notifications` on desktop**.

### The switch — `INLINE_HEADER_PAGES`
File: **`src/lib/inline-header-pages.ts`**

Routes listed here get the "inline header" treatment in
`src/app/dashboard/layout.tsx`:
- the mobile **top band shrinks** to `pt-[env(safe-area-inset-top)]` (instead
  of the `pt-[calc(2.75rem+…)]` band), and
- the sidebar **hides its floating bell/profile pill** (the inline header
  provides them now).

Current set:
```
/dashboard, /dashboard/schedule, /dashboard/appointments,
/dashboard/clients, /dashboard/payments, /dashboard/calendar, /dashboard/pos
```

**To convert a new page:** add its route here **and** render `<DashboardHeader>`
(+ make the page root `px-*` only).

### Per-page rollout
| Page | How | Commit |
|---|---|---|
| **Schedule** | first page on the template; root `px-4 lg:px-8` | `2c5183f`, `c6387c7`, `3fc3450` |
| **Appointments** | "+" add button → `action` slot; root `px-6 pb-6 space-y-6` | `b89361d` |
| **Clients** | "+" add → `action` slot; "Re-engage At-Risk" dropped to a right-aligned sub-row | `b89361d` |
| **Payments** | title → template; barber + period selector stays as the row directly beneath | `b89361d` |
| **Calendar** | `CalendarView` takes optional `pageTitle`; header renders as first child of its flex-col root, grid (`flex-1`) absorbs the height; date-nav toolbar untouched. Only the **owner** page passes it — barber/embedded calendars unaffected | `29fe69f` |
| **POS** | header inside the main column (service grid `flex-1` absorbs it); workflow height calc lost the old 44px top-band term → `h-[calc(100dvh-68px-env(safe-area-inset-top))]` so it still ends exactly above the bottom nav | `29fe69f` |
| **Dashboard home** | keeps its **own inline** `.cwd-hdr` copy (so editing the component can't move it); bumped root to match — see below | `0b0659c`, `0c79bf9` |

### The dashboard top-padding saga (why it was the odd one out)
The dashboard home renders an **inline** copy of the header (not the component),
so it never got the template's `pt-6`. Two separate things made its title sit
**~24px lower** than every other page:

1. Its root was `p-4` (16px), then briefly over-corrected to `pt-6 lg:pt-8`.
2. **The real culprit:** the onboarding banner was wrapped in
   `<div className="mb-6"><OnboardingBanner/></div>`. When onboarding is
   dismissed, `OnboardingBanner` returns `null` — but the **empty `mb-6`
   wrapper still reserved ~24px** above the header. No other page has such a
   wrapper.

**Fix (`0c79bf9`):** moved the `mb-6` **onto the banner's own root** (both the
"all set up" and in-progress variants) and dropped the wrapper in
`dashboard/page.tsx`. A dismissed/`null` banner now reserves **0px**, so the
dashboard title lands at the header's 24px — **pixel-identical to every other
page**. New owners who still see the banner keep the gap (it travels with the
banner). Dashboard root is `p-4 lg:p-8 pt-6 lg:pt-8` (24/32 top).

**Net result:** all 7 owner pages share the same top — same header element, same
title size (`.cwd-hdr h1` = 23px/800/uppercase), same 24px top padding.

### Gotchas learned (read before touching page tops)
- **A wrapper with `mb-*`/`p-*` around a component that can render `null`
  reserves space even when empty.** Put the margin on the thing that renders,
  not a persistent wrapper. (This was the dashboard bug.)
- **Grid/flex `flex-1` children absorb an added sibling header** with no height
  math — that's why Calendar/POS could take the header cleanly (no fixed-height
  surgery except POS's viewport calc, which had a stale top-band term).
- **Calendar & POS are full-screen tools** with their own toolbars — they use
  the same `<DashboardHeader>` but the header goes *inside* their flex column /
  main column, not stacked above a fixed-height block.
- **POS desktop caveat (open):** on wide screens the POS title sits above the
  service grid only (the order-summary side panel keeps its own "Order Summary"
  header), so the two columns start at slightly different heights. Fine on
  phone/tablet (single full-width header). Owner was offered a full-width
  desktop header — not yet requested.

---

## Earlier this session (also on `main`)

- **Mobile sidebar bottom-cutoff:** `h-screen` → `h-[100dvh]` + safe-area
  footer padding, both owner & barber sidebars.
- **$79 Premium price** confirmed live in the DB.
- **Blue signature colour migration:** retired the old gold/amber brand accent;
  decorative gold → the periwinkle-blue **`accent`** tokens
  (`#6ea8fe` / soft `#a9c6ff` / muted `rgba(110,168,254,0.12)` in
  `tailwind.config.ts`) — calendar today/selected, notification dots/bell,
  "See all" links, StatsCarousel bars/dots, etc. **Semantic amber/yellow KEPT**
  (pending, no-show, unpaid/outstanding, cash-vs-card, warnings, star ratings).
- **Portal polish:** fixed invisible white-on-white Messages search; unified
  page titles.
- **POS fixes:** collapsed "add customer" form; removed Recent transactions;
  Services/Products **tabs** with product sub-sections + search; "Charge" →
  **"Checkout"** (opens the summary before charging); **cash sale** now goes
  through a service-role route **`/api/pos/cash-sale`** (client-side
  `transactions` insert is blocked by RLS — same footgun as `pos-finalize`);
  fixed a Rules-of-Hooks crash (`inventoryByCategory` was a `useMemo` after an
  early return → made it a plain computation).
- **Dashboard 1:1 preview port:** the `cwd-*` CSS block in `globals.css` is a
  namespaced 1:1 port of the approved preview (StatsCarousel hero, KPI cards,
  quick actions, compact week calendar, Today's Schedule, Staff Status, Recent
  Alerts). Overflow fixed with `min-width:0` on `.cwd-col`/`.cwd-cell`; staff
  online-dot un-clipped; bell double-action fixed.

---

## Commit index (this session, newest → oldest)
```
0c79bf9  Dashboard: remove empty onboarding-banner gap so top matches other pages
0b0659c  Dashboard: match the shared header top spacing (pt-6 lg:pt-8)
29fe69f  Add universal header title to Calendar and POS
b89361d  Roll universal header onto Appointments, Clients, Payments
3fc3450  Header template: own its top spacing so pages stay consistent
c6387c7  Schedule: match dashboard top padding
2c5183f  Schedule: clean top consistent with the dashboard  (DashboardHeader + INLINE_HEADER_PAGES introduced)
```

---

## Payments page — full v2 rebrand (statement-style)
A ground-up redesign of `/dashboard/payments`, ported 1:1 from an approved
preview. Same dark theme, same `<DashboardHeader>` nav (unchanged).

- **CSS:** a namespaced `cwp-*` block appended to `globals.css` (like `cwd-*`
  for the dashboard). Numbers use DM Mono (`--font-mono`); money green `#31d0a5`,
  amber `#f5b544`, blue accent used sparingly. Only `/dashboard/payments` uses it.
- **Earnings = the period selector.** The old *Default / Last 14 days / Last week
  / Custom* `<select>` is GONE. The periods are now swipeable carousel cards
  (`.cwp-rail`/`.cwp-ecard`): **This week · This month · All time · Custom range**,
  each with a big mono headline (collected = card gross + cash), `↑ N cuts · $avg`,
  and a CSS-bar sparkline (`<Spark>`, tallest bar highlighted). Custom card opens
  the existing date-range modal.
- **Statement transactions.** The floating-card feed became one `.cwp-statement`
  panel: **date groups** (Today / Yesterday / weekday · date) with a per-day total,
  **hairline-divided rows** — method glyph (card/cash/unpaid-clock), name + service,
  right-aligned mono amount + method/time or `after $x fee`. Refunds struck through;
  unpaid rows show an amber tag + inline **Send payment link**.
- **Filters** are now segmented pills (`.cwp-seg`: All/Card/Cash/Unpaid) instead of
  a dropdown. **Outstanding tile is tappable** → toggles the Unpaid filter (chase
  flow); tapping shows unpaid appts (`unpaidRows`) grouped like the statement.
- **Single barber → no dropdown.** The barber chip (`.cwp-barberbar`) renders only
  when `barbers.length > 1`.
- **Unchanged / preserved:** all money logic — Stripe sync, reconcile, realtime,
  refund, send-link + custom-range modals, `feed`/`computeScope`/`netOf`/`feeOf`.
  Removed the dead light-themed `barberCard` + its `recharts` import.

---

## ⏭️ NEXT: apply the same universal header to the BARBER portal
The owner portal (`src/app/dashboard/**`) is done. The **barber portal**
(`src/app/barber-dashboard/**`) has NOT been converted yet — do it next so both
portals share the same clean, consistent top.

Plan when we pick it up:
1. `<DashboardHeader>` is owner-portal-flavoured (its bell links to
   `/dashboard/notifications`, avatar to `/dashboard/settings`, and it reads the
   owner's notifications/photo). For the barber portal, either **parameterise
   those routes/queries** on the component (add `notifHref`/`accountHref`/role
   props) or make a thin `BarberHeader` wrapper — decide first.
2. Mirror the `INLINE_HEADER_PAGES` mechanism for the barber layout
   (`src/app/barber-dashboard/layout.tsx` + its sidebar's floating bell/profile).
3. Roll it onto the barber pages (dashboard, calendar, my-stats, etc.), each
   root `px-*` only, header owns the 24px top.
4. Barber calendar already supports a title via `CalendarView pageTitle` — just
   pass it once the barber layout is inline-header-aware.

---

## Dark-theme daylight-legibility polish (colours only — every portal)

**Goal (owner's words):** keep the premium dark look (no light theme), but fix
the one weakness dark has — faint greys / near-invisible outlines that wash out
in bright sunlight. Booking page + owner dashboard + barber portal. **Pure
colour-value lift — zero layout/logic/structure changes.** Verified with a real
`next build` (compiled ✓, types ✓, full route table).

**What moved (each value nudged brighter, nothing else):**

| Element | Before → After | How |
| --- | --- | --- |
| Secondary/muted text | `#777` → `#8f8f8f` | sed on all `[#777]` Tailwind classes (~1107 sites) **+** `--grey` CSS var (`#777777`→`#8f8f8f`) for the `.btn/.card/.form/.cw-*` layer |
| Hairlines / card + field outlines | `#1e1e1e` → `#2a2a2a` | `border-[#1e1e1e]`→`border-[#2a2a2a]` (436 sites) **+** tailwind `border.DEFAULT` token (covers 191 `border-border`) **+** `--border` CSS var |
| Faint placeholders / tertiary | `[#555]`→`[#6e6e6e]`, `--grey-2` `#333`→`#555`, `.cw-hero-label` `#555`→`#6e6e6e` | sed + globals.css |
| Booking time-slot tiles (booking page only — the #1 fix) | `bg-sky-500/10 border-sky-400/40` → `/15` + `/60`; hover `/20`→`/25`; sublabel `text-sky-300/80`→`text-sky-300` | targeted edits in `src/app/book/[shopslug]/page.tsx` |

- **Black ground and white accent are untouched** — the premium feel is identical;
  only the too-faint bits got readable. `bg-[#1e1e1e]` backgrounds (5 sites) left
  alone so nothing structural shifts.
- Three coordinated layers so it's consistent everywhere at once: Tailwind
  arbitrary classes (sed), the Tailwind `border` token (config), and the CSS
  variables `--border` / `--grey` / `--grey-2` (globals.css `:root`).
- Diff: **92 files, 1525 insertions / 1525 deletions** (balanced = pure swaps).
- Reference mockup shown to owner before shipping (before/after preview artifact).

---

## Follow-up fixes (booking window, service copy, product tables)

Small, focused fixes shipped straight to `main` after the polish:

1. **Booking window was ignored** (`book/[shopslug]/page.tsx`). The shop's
   `advance_days` (e.g. 7) fed a dead `calendarDays` array; the live week-strip
   had no ceiling, so customers could page/book months out. Wired it back:
   `maxDate = today + advanceDays` → days past it are disabled, the "Next week"
   arrow caps at the window, the auto-advance/seed (`nextScheduledDay`) stops at
   the window instead of scanning 60 days, and the confirm guard rejects
   out-of-window dates ("up to N days ahead") instead of the old 6-month check.
   Client-side only; the booking APIs don't independently re-check the date yet.
2. **Service description cap** (`dashboard/services/page.tsx`). Descriptions were
   unbounded and the booking card doesn't truncate. Added `maxLength={100}` +
   `slice(0,100)` + a live N/100 counter (amber at cap), and `line-clamp-2` on
   the booking card + services list as a safety net for older long text.
3. **Product tables overflowed on mobile.** Hid secondary columns below `md`:
   Services > Products table (Category/Cost/Margin) and the standalone Inventory
   table (Category/Cost/Value), keeping Product/Retail/Stock/(Status)/Actions.

## Removed the inventory tab from the Services page

Owner's call: **one source of truth for stock.** The Services page had a
Services|Inventory tab toggle whose Inventory side duplicated the dedicated
`/dashboard/inventory` page (same `inventory` table). Removed the whole
inventory half of `dashboard/services/page.tsx`: the tab bar, the products
table + stat cards + low-stock alert, the Add/Edit Product modal, and all
product-only state/functions (`inventory`, `newInv`, `editInv`, `saveInv`,
`deleteInv`, `margin`, `lowStock`, `BLANK_INV`) and the `Badge`/`InventoryItem`
imports. Title is now just **"Services"**. Inventory lives solely on
`/dashboard/inventory` (its own sidebar entry).

⚠️ Behaviour note: the dedicated Inventory sidebar link is **plan-gated**
(`feature: "inventory"`), but the old Services-page tab was **not** — so shops
on a plan without the inventory feature lose the tab bypass and now see stock
only if their plan includes it (the intended gating).

---

## Multi-location: fix "add second location" (auto-approve, own Stripe, one sub)

**Bug:** adding a 2nd location (Settings → Locations) went to admin approval and
asked for a new email. Root cause: the "Add Location" button did a raw client
insert (`settings/page.tsx`) — hardcoded `status:'pending'`, force-clamped to
pending by the phase24/phase31 triggers anyway, and never ran the auto-approve
logic (which only lived in the service-role `/api/shops/create`). So a paying
Premium owner's second location could never auto-approve.

**Design decided with owner (Stripe):** each location gets its **own** Stripe
Connect account (Express — our code mints it via `accounts.create`, no "log in
to existing" step), so balances/payouts stay fully separate (no cross-location
leakage). Same bank account is fine across accounts. The **$79 subscription is
shared** (one charge, all locations). In-app Payments are already per-`shop_id`
from ClipWise's own DB; only Stripe's live balance widget is account-level,
which separate accounts keep clean.

**What shipped:**
- **New service-role route `/api/shops/add-location`** — verifies the owner has
  an active `multi_location` subscription (hydrates plan config, same check as
  the client), then inserts the shop `status:'approved'`, `subscription_status:
  'active'`, reusing the owner's email, **copying the subscription link**
  (`stripe_subscription_id`/`customer_id`) but **NOT** the Connect account
  (`stripe_account_id` left null → its own account). Inherits the first shop's
  booking_settings (with `bookings_paused` reset). Service role → exempt from the
  pending-clamp triggers, so approved sticks.
- **Settings Add-Location modal** now calls that route (was a raw insert),
  **drops the email field** (reuses owner email), updates the copy, and on
  success jumps the owner into the new location (`setActiveShop`).
- **Owner active-location now persists** (`auth-context.tsx`, `cw_active_shop` in
  localStorage) — switching sticks across reloads instead of snapping to the
  newest shop (which used to bounce owners to `/dashboard/pending`). Cleared on
  sign-out.
- **Barber invite is multi-location aware** (`/api/admin/barber/invite`): takes a
  `shop_id` (owner-scoped for security) instead of `.single()` on the owner's
  shops (which threw for multi-shop owners). Staff page passes the active
  `shop.id`. Owner-as-barber (self-add) works per location.

**One-time data cleanup (needs live DB — Supabase MCP was disconnected):** the
location already created before this fix is stuck `pending` with the wrong email
and no subscription link. Run the backfill SQL (provided to owner) in the
Supabase SQL Editor to approve it + attach the shared subscription + fix the
email. New locations created from now on don't need it.

### Location limits + $30/mo add-on billing

- **Per-plan location limit** (`validation.ts`): `PlanConfigEntry.locationLimit`
  + `getLocationLimit()`. starter/pro = 1, premium = 2 (included), business = 5.
- **Absolute ceiling** `MAX_LOCATIONS = 5` — no plan/owner can exceed 5 shops.
  `getLocationLimit` clamps to it; the add-location route enforces it.
- **$30/mo add-on billing** (`lib/stripe-addons.ts`): each location beyond the
  plan's included count is a $30/mo item on the owner's SAME subscription
  (no second checkout). `reconcileLocationAddon(subId, extraQty)` find-or-creates
  a reusable recurring price (lookup_key `clipwise_location_addon_monthly_cad`,
  created lazily — works in test/live, no dashboard step) and sets the add-on
  subscription-item quantity = extra locations. Proration accrues to the next
  invoice (`create_prorations`), so it can't decline at call time.
  - **add-location route**: bills the add-on FIRST (quantity reconcile), then
    creates the shop; rolls the quantity back if the insert fails. Allows up to
    MAX (5); the 3rd–5th are self-serve paid (no more "contact us").
  - **delete-shop route**: recomputes the add-on quantity from the remaining
    shop count (best-effort) so removing a location decrements the bill.
  - Webhook safety: `customer.subscription.updated` only syncs *status*, not
    plan, so the add-on line item never confuses plan detection.
- **UI**: Settings > Locations shows "N of 5", allows adding up to 5, and the
  Add-Location modal warns "$30/mo add-on (prorated)" when beyond the included 2.
  Premium subscription banner + homepage pricing now read "2 locations — add
  more $30/mo each (up to 5)".
- **Follow-up worth doing:** a Stripe webhook path or periodic job that
  reconciles the add-on quantity from shop count would self-heal any drift if a
  reconcile call ever fails mid-flow.

### Multi-location audit + fixes

Ran a sweep for "assumes one shop per owner" regressions after enabling
multi-location. Fixed:
1. **Consent is now server-enforced** — add-location refuses to bill the $30
   add-on without `agree_addon:true` (returns `needsConfirm`); the client sends
   it only after the popup and re-shows the popup on that signal. The $30 can
   never be charged in a path where the popup didn't happen.
2. **Billing page read `items[0]`** for the plan amount/period — with the add-on
   as a 2nd item and no guaranteed order, it could show $30 as the plan price.
   Now filters to the plan item by `lookup_key !== LOCATION_ADDON_LOOKUP_KEY`.
3. **Add-on was lost on plan change** — an upgrade makes a fresh subscription, so
   the add-on item didn't carry over (owner kept extra locations, stopped being
   billed). Both `confirm-subscription` and the webhook now re-run
   `reconcileLocationAddon(newSubId, extra)` after the new sub.
4. **`confirm-subscription` updated only the newest shop** — now updates ALL the
   owner's shops (`.eq owner_id`), matching the webhook (was leaving a
   multi-location owner's other shops on the old/cancelled sub id + plan).
5. **Onboarding crash** — `shops…eq(owner_id).maybeSingle()` throws for a
   returning multi-location owner; switched to `.limit(1)+[0]`. Also passes
   `shop_id` to the onboarding barber invite.
6. **reconcile-payments** reconciled the newest shop's Stripe account only; now
   takes `shop_id` (each location has its OWN Stripe account) and the Payments
   page passes the active `shop.id`.

Reported as benign / no change: `cancel-subscription` + `billing-portal` read the
newest shop but the subscription/customer are per-owner (same result);
`loyalty/points` picks an owner shop but the plan is shared (same plan). Barber
context localStorage key (`clipwise_active_barber_shop_<uid>`) does NOT collide
with the owner key (`cw_active_shop`). Admin users list shows only an owner's
first shop (display-only). No remaining `.single()` on owner-scoped shops in API
routes (all use `.limit(1)`).

### Heavy QA pass (live API + Supabase MCP) + fixes

Logged in as the owner and hammered the live API (browser UI testing wasn't
possible — the env proxy resets Chromium's TLS to external hosts, so no automated
visual). All test data auto-cleaned (verified: 3 shops, 0 test barbers/tx).

**Passed (server held up):** barber invite multi-location targeting, duplicate
block, missing-field 400s, unowned-shop 404, no/invalid-token 401, unowned-shop
delete 403, delete-confirm 400, add-location $30 **consent enforced server-side**
(409 needsConfirm — not just the popup), add-on create→delete→decrement cycle,
booking-validation 400, availability, promo validate + **SQL-injection stored as
literal** (no injection), XSS name stored but React-escaped on render.

**Fixes shipped:**
1. **POS `cash-sale` had NO auth** — it inserts a transaction with the service
   role and only checked `shop_id`, so anyone could POST fake revenue into any
   shop. Added an auth gate (owner or active barber of the shop); the POS page
   now sends the token; low-stock notification uses the shop's real `owner_id`
   instead of the client-supplied one. (`api/pos/cash-sale`, `dashboard/pos`)
2. **Barber name had no length cap** (5000-char accepted) — added `maxLength`
   (name 60 / email 120 / commission 5) on the staff form + a server-side
   `.slice(0,60)` in the invite route.

**Reported, not changed (public-by-design or low-severity):** `reviews/submit`,
`waitlist/join`, `appointments/notify-staff`, `clients/upsert`, `my-booking/[id]`
are intentionally unauthenticated (customers have no login) and validate the
shop/appt first — candidates for rate-limiting, not auth. `stripe/payment-link`
low-severity (owner action, no getUser). Admin routes use `requireSuperAdmin`;
Stripe finalize routes verify the Stripe session — both safe.

**Supabase security advisor** (for later, needs its own careful pass): ~9
functions with mutable `search_path` (pin to `public`); several SECURITY DEFINER
funcs executable via RPC by anon/authenticated (revoke EXECUTE on the pure-trigger
ones — but NOT the RLS-helper ones without testing); `waitlist_insert_public`
RLS is `WITH CHECK (true)`; `barber_breaks` has RLS enabled but no policy; Auth
leaked-password protection is off (dashboard toggle). None applied yet — DB
security surgery on prod needs a dedicated, tested pass.

### "Unhappy path" UI-state hardening (universal)

Audited the app against 10 UI states (empty/loading/error/offline/slow/no-results/
permission/session-expired/validation/success). It was already strong on the
visible ones; the gaps were the invisible ones. Fixed the top ones **globally**:

1. **React error boundary** — `src/app/error.tsx` (route segments) + `global-error.tsx`
   (root layout). There was NONE — any render crash white-screened the whole app,
   booking page included. Now: "Something went wrong · Try again / Go home."
2. **Session expiry** — a dead/expired token used to show owners a false "No shop
   found" and barbers "you were removed from the shop." Fixed in the auth layer
   (universal): `auth-context.fetchProfileAndShop` returns `unauthorized` on a 401
   (vs a network error, which it does NOT sign out on), and the caller +
   `refreshShop` do `supabase.auth.signOut()` → layouts redirect to /login.
   `barber-context` now checks `r.status===401` → `signOut()` (was calling
   `.then(r=>r.json())` with no `.ok` check → "account not linked").
3. **Offline banner** — `src/components/offline-banner.tsx` in the root layout;
   listens to `navigator.onLine` + online/offline events, shows an amber bar on
   every page. The SW only rescued full navigations; this covers the in-app case.
4. **False-success toasts → honest** — clock-in/out (`dashboard/page.tsx`),
   walk-in add, and save-birthday (`clients/page.tsx`) all showed "saved!" even
   when the write errored. Now they check `error` and show a real failure toast.

Reported, not yet done (per-page, lower priority): request timeouts on data
loads (only login has one); Add-Client email/phone validation.

### Silent data-LOAD failures — per-page sweep DONE
The systemic issue (most `const { data } = await supabase…` discarded `error`, so
a failed load looked like an empty shop) is now covered across the app:
- `dashboard/page.tsx` (home) — `loadError` state + dismissible retry banner
  (shipped earlier this session).
- `book/[shopslug]/page.tsx` — `.maybeSingle()` split of network-error vs
  0-rows "Shop Not Found" + retry screen (shipped earlier).
- `dashboard/services`, `dashboard/inventory`, `dashboard/clients`,
  `dashboard/appointments`, `barber-dashboard` — each load fn now captures the
  discarded `error` and fires an honest toast ("Couldn't load … — please
  refresh.") instead of silently rendering an empty state.
