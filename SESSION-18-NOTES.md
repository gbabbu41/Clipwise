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
