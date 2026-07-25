# Audit Playbook — the 5 checks, concrete for ClipWise

Run these when doing a full security pass (audit / harden / pre-launch). They map
to the launch-checklist prompts but are turned into things to actually grep and
read in this Next.js 14 + Supabase + Stripe + Resend + Twilio codebase. Report
findings as: plain title, `file:line`, one-sentence why-it-matters, severity
(High/Med/Low), one-line fix. Note what PASSED too, so the owner knows it was
checked, not skipped.

Fan out across parallel subagents (secrets & exposure / auth & payments / PII &
hardening & input) for speed and coverage.

---

## Check 1 — Secret leak & exposure

- Grep `src/` and repo root for literal keys: `sk_live`, `sk_test`, `rk_`, `re_`
  (Resend), `whsec_`, service-role JWT (`eyJ…`), Twilio `AC…`/auth token, DB
  connection strings. Every one must be `process.env.*`, never a string literal —
  not in config, utils, comments, or committed `.mjs` scripts.
- `SUPABASE_SERVICE_ROLE_KEY` used ONLY server-side (`src/lib/supabase-admin.ts`
  and API routes). Confirm no `"use client"` file imports it and it's not in any
  `NEXT_PUBLIC_` var.
- `NEXT_PUBLIC_*` must hold only public-safe values (Supabase URL + anon key with
  RLS, Stripe publishable key, app URL). No secret behind that prefix.
- `.gitignore` should ignore `.env*` (not just `.env*.local`) so a bare `.env`
  can't be committed; keep `!.env*.example`. Confirm no real env file is tracked.
- No secret printed in `console.*` or returned in a `NextResponse.json`.
- If a secret was ever hardcoded, it's in git history — rotate it and note it.

## Check 2 — Personal data (PII) flow

- Grep every `console.log/warn/error` for user email, phone, name, address, DOB,
  token, password → none should be logged.
- Public/anon-facing reads (booking, availability, public shop/gift page) must
  NOT `select("*")` on `shops` / `clients` / `barbers` / `appointments`. Return an
  explicit column list; never Stripe/owner ids or other people's PII.
- `localStorage`/`sessionStorage`: UI prefs and ids only. No tokens, emails, or
  card data.
- Passwords: entirely via Supabase Auth (hashed by Supabase). No custom hashing,
  no plaintext stored/logged/returned.
- API responses: field-limited. No password hashes, internal ids, or other users'
  rows.
- Data deletion: is there a way for a user/customer to have their data removed?
  Note if absent (privacy/PIPEDA/GDPR).

## Check 3 — Pre-deploy production readiness

- Env vars: critical ones (Supabase, Stripe, auth) referenced with clear failure
  if missing; app shouldn't silently run half-configured.
- Debug code: remove stray debug `console.log`, commented-out blocks,
  TODO/FIXME on security, hardcoded test creds, and any `/test`/`/debug`/`/seed`/
  backdoor route. Debug defaults OFF.
- Error handling: client responses carry a generic message, not stack traces / DB
  errors / file paths. Detail → server logs only.
- Security headers (`next.config.mjs` `headers()` or middleware):
  `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
  `Strict-Transport-Security`, a starter `Content-Security-Policy`.
- Rate limiting on auth-adjacent and abuse-prone routes (login is Supabase-hosted;
  check custom ones: `book/*`, `waitlist/*`, `clients/upsert`, `reviews/submit`,
  `promo/validate`, `twilio/send-sms`, open `send-email` types).
- CORS: not `*` unless genuinely public.
- DB: TLS in prod, no default creds, no open port.

## Check 4 — Deep audit: auth, payments, input

**Auth & authorization**
- Every protected route has an auth check AND an ownership check (no IDOR — never
  return/mutate a client-named id without verifying the caller owns it).
- Password reset: delegated to Supabase (random, single-use, time-limited,
  emailed to the user's own address — never returned to another user).
- Session/JWT: handled by Supabase; don't roll your own.

**Payment logic**
- Server independently computes totals/tax/tip/discount from DB prices — client
  `total_amount`/`subtotal` is display-only, never the charge basis.
- Stripe webhook verifies signature (`constructEvent`) and handles
  connected-account events.
- Before marking anything paid from a Checkout redirect, verify the session's
  `metadata` binds to *this* resource (`flow`, `shop_id`, `appointment_id`) and the
  amount matches — don't trust a bare `session_id`.
- Gift-card / balance math re-reads the card from the DB and clamps; never trusts a
  client-sent remaining balance.

**Input handling**
- SQL injection: everything goes through the parameterized Supabase client — no
  raw/template SQL, no `.rpc()` built from user input. Watch `.or("…${userInput}…")`
  filter strings; sanitize or split into `.eq()` queries.
- XSS: audit every `dangerouslySetInnerHTML` and any user text rendered as HTML;
  HTML-escape untrusted free text (e.g. in emails).
- File uploads (logo, barber photo): allow-list MIME (`image/png|jpeg|webp`), cap
  size, force a safe extension, set a fixed `Content-Type`. Don't trust
  `file.name`/`file.type`.

## Check 5 — Attacker's perspective (re-run after any big feature)

Walk the app as a hacker:

1. **ID manipulation:** change a user/shop/order/appointment id in the URL or body
   — does any endpoint return or mutate it without an ownership check?
2. **Login bypass:** does any endpoint that should require auth work without a
   token? Are expired/malformed tokens rejected? Any default admin creds?
3. **Privilege escalation:** can a barber hit owner/admin routes by guessing URLs
   or flipping a role client-side? Role checks server-side only.
4. **Feature abuse:** rate limits on signup (mass accounts), messaging/SMS/email
   (spam & toll fraud), uploads (storage fill), promo/referral (infinite use)?
5. **Content injection:** JS in every text field (name, bio, review, search, file
   name); injection through search/filter/login.
6. **Internal exposure:** `.env` via URL, `.git` dir, admin panels, health/debug
   endpoints leaking system info, error messages leaking internals.
7. **Business-logic abuse:** negative amounts, stacked discounts, restarted free
   trials, self-referral, marking unpaid things paid via an unrelated receipt.

For each hit: what the attacker does, how much damage, and the exact fix.
Prioritize data theft & unauthorized access first, then abuse & logic flaws.

---

## Known recurring patterns we've actually hit (generalize, don't just spot-fix)

- Unauthenticated routes that send email/SMS or move money → gate with
  Bearer-token + ownership, mirroring `pos/cash-sale`.
- Client-supplied price/amount/flag trusted for a charge or a state change →
  recompute/verify server-side.
- `select("*")` to anon callers leaking Stripe/owner fields → explicit column
  lists on public reads.
- No rate limiting anywhere → add it on the public/abuse-prone set.
- Raw `error.message`/`String(err)` returned to the client → generic message out.
- A fix applied to one route while its identical sibling stays open → sweep the
  whole folder for the pattern every time.
