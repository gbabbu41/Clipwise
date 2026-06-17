# SESSION 17 NOTES (2026-06-17)

Cross-machine log of everything shipped this session. All commits are on
`main` (deployed via Vercel) **except the Capacitor groundwork**, which is on
branch `claude/gallant-euler-7fkw5h` ONLY (see §Capacitor).

Earlier in the session two fixes were also appended to `SESSION-16-NOTES.md`
(the app-wide modal overflow + iOS focus-zoom fix, and the drawer-clipping
follow-up) — they're summarized again here for completeness.

---

## Mobile modal / card overflow + iOS focus-zoom (35121ec, c329936, 8987e87)
Reported: cards opened off-screen, couldn't scroll, and tapping a field zoomed
the page and broke it.
- **iOS focus-zoom** (`globals.css`): inputs/select/textarea forced to `16px` on
  touch viewports (`@media (max-width:1023px)`) — iOS auto-zooms anything < 16px.
- **Centered modals** (~42 overlays, ~20 files): final pattern is
  `flex items-center justify-center p-4 overflow-y-auto overscroll-contain [&>*]:my-auto`.
  The `[&>*]:my-auto` is the key — the panel centers when it fits and
  top-aligns + scrolls (no top clipping) when taller than the viewport / with
  the keyboard up. (First attempt used `items-start sm:items-center`, which
  wrongly top-aligned short modals like "Send payment link" — superseded.)
- **Side drawers** (Client Profile, Appointment Details, Calendar day peek —
  `fixed right-0 top-0 h-full overflow-y-auto`): the fixed bottom nav (`.cw-bnav`,
  z-50, ~68px) covered their lower edge so the last content was unreachable.
  Fixed with `pt-[calc(env(safe-area-inset-top)+1.5rem)]` (clears notch) and
  `pb-[calc(env(safe-area-inset-bottom)+6rem)] lg:pb-6` (clears nav). Calendar
  drawer is `flex-col`, so insets went on its header `pt` and footer `pb`.

## Payments page — major pass
- **De-cluttered header** (9908af1, 924871a): removed the big "Open Stripe
  Dashboard" button and the subtitle; a small "Stripe Dashboard" link now lives
  inside the 💡 note box. Summary cards: **Collected** is the wide headline box
  (`grid-cols-4`, `col-span-2`, larger number); Outstanding + On file are equal
  single-col boxes; card height `py-3`.
- **Payment-aware completion feedback** (d77570f, in `appointments/page.tsx`):
  completing now toasts the money outcome — `Completed · paid $X ✓` /
  `Completed · $X still unpaid — take payment` / `Completed · no price …,
  nothing to charge` — instead of a bare "Marked as Completed". A held/saved
  card capture still shows its own "Charged $X" toast.
- **Show $0 / completed appts** (d77570f): the feed query was `.gt("total_amount",0)`
  which hid no-price appointments entirely. Now `.or("total_amount.gt.0,
  status.eq.completed")`; a no-price row is labeled **"No charge"** (muted), and
  the Outstanding filter ignores $0 so the figure stays honest.
- **No-show fee shows the REAL amount + label** (581c866, f27175c): a no-show
  charges only the configured fee (e.g. $20), but the feed was dropping the
  "No-show fee" transaction and showing the appointment's captured row at the
  full service price ($30) labeled "Paid · Card" (also over-counting Collected).
  Fix: **keep** the no-show transaction (real amount + label), **drop** the
  duplicate full-price appointment row for no-show captures
  (`status === "no-show" && isPaid`), and render no-show txs with a green
  **"No-show · Paid"** badge. Completion charges unchanged (tx == total, so the
  appointment row still represents them). ⚠️ The actual Stripe charge was always
  correct — `capture-appointment` uses the fee via `amount_to_capture` /
  off-session amount; this was display + summary only. Added `status` to the
  payments `ApptRow` + select to detect no-show captures.
- **Filters → one dropdown** (bc67cfd): the chip row became a single styled
  `<select>` (with `ChevronDown`); default option renamed **"Recent transactions"**
  (the old "All").
- **"Recent transactions" = money-moved only + grey refunds** (8c814ea):
  the `all` filter now shows only rows where money moved — POS sales, or
  appointments that were paid / failed / refunded — hiding unpaid, held/saved,
  and $0 "no charge". Refunded rows are dimmed (`opacity-60`) with a
  struck-through amount to read as debited.
- **Live updates** (ebf2ad0): Supabase realtime subscription on `appointments`
  + `transactions` (filter `shop_id`) → reloads the feed the moment money moves,
  no manual refresh. Every card charge flips `appointments.payment_status`
  (realtime confirmed enabled on that table) and POS inserts a `transactions`
  row.
  - **Data-source note**: the feed reads the Supabase mirror, not a live Stripe
    query. It's kept in sync by Stripe **webhooks** + `reconcile-payments`
    (on open) + per-row `refresh-payment`. Charges are real/Stripe-verified;
    cash is the only non-Stripe row. POS "Card" = Stripe Checkout (Apple/Google
    Pay available on that hosted page); no physical tap-to-pay hardware yet.

## Calendar — crammed barber columns on phones (49ca39b)
Mobile reserved only 78px per barber column, so a phone packed 4 columns at
~83px each; overlapping appointments split that in half → illegible "m…" boxes.
Widened the mobile per-column minimum to **128px** (`renderColumns` perPage math)
so phones show ~2 readable columns and page/swipe through the rest (pagination
already existed).

## Bottom nav — Clients → Payments (55585bd)
`components/dashboard/sidebar.tsx`: replaced the Clients tab with **Payments**
(💰). Bar is now Home · Appointments · Calendar · POS · Payments + More. Clients
is still in the More drawer.

## Booking pay modal readability (61e0a9c)
`book/[shopslug]/page.tsx` pay-choice modal is `bg-white` but was styled for a
dark bg: the "How would you like to pay?" heading was white-on-white (invisible)
and the no-show consent box used pale `amber-200` on a near-white tint
(unreadable). Heading → `gray-900`; consent box → `amber-50` bg / `amber-300`
border / `amber-900` text / `amber-600` checkbox.

## Tap to Pay roadmap + Capacitor groundwork
- **TODO §4b** (30f1d88, on main): decision to do **native Tap to Pay** once the
  app is wrapped with **Capacitor**. True phone tap-to-pay needs the native
  Stripe Terminal SDK + NFC — impossible in the web/PWA. Canada is supported.
- **Capacitor groundwork** (e12625c, **branch `claude/gallant-euler-7fkw5h`
  ONLY — NOT on main / not deployed**). Additive, web app untouched, `next build`
  verified. See `CAPACITOR.md` for the full runbook. Summary:
  - Installed `@capacitor/{core,cli,ios,android}` (^6).
  - `capacitor.config.ts`: `appId ca.clipwise.app`, **loads live clipwise.ca via
    `server.url`** (so all /api + SSR keep running on Vercel — do NOT use
    `output:"export"`), `appendUserAgent:"ClipWiseApp"`.
  - `capacitor-www/index.html` placeholder webDir; `cap:sync|ios|android` scripts;
    `.gitignore` native build artifacts.
  - **Native ios/ android/ projects must be generated on a Mac** (`npx cap add
    ios|android`) — can't be done in the Linux container.
  - When ready for Tap to Pay, build the platform-agnostic backend:
    `/api/stripe/terminal/connection-token` + a `card_present` PaymentIntent
    create/capture that writes the SAME `transactions` row POS uses.

---

## Workflow reminders (unchanged)
- Build check: `SKIP_ENV_VALIDATION=1 npx next build` → "✓ Compiled successfully"
  (the container's only failure is the pre-existing env `supabaseUrl is required`
  page-data error — not a real TS/compile error).
- The stop-hook **"Unverified commits"** warning is a known FALSE POSITIVE
  (committer email is already `noreply@anthropic.com`; only the GPG signature is
  absent). **Do NOT amend already-pushed commits.**
