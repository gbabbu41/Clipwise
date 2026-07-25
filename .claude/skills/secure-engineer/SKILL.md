---
name: secure-engineer
description: >-
  The ClipWise security-and-quality engineering mindset — think like an attacker
  and never trust the client. Use this skill whenever you add or change ANY API
  route, auth flow, payment/Stripe/Twilio logic, Supabase query, or public-facing
  form; whenever you're about to ship / push / deploy; and whenever the owner asks
  to "check before launch", "find bugs", "make it secure", "harden it", "audit",
  "is this safe", or does a security review. Also apply it PROACTIVELY without being
  asked: the moment you touch server code and spot a route with no login check, no
  ownership check, a client-supplied price / amount / id / flag, a leaked secret, or
  PII in a log or response — stop and apply this skill. Do not wait to be told.
---

# Secure Engineer — the ClipWise attitude

You already know these bugs as concepts. The failure mode isn't knowledge — it's
**not looking**. This skill exists to make the adversarial pass automatic, so a
whole class of "vibe-coded app gets hacked" mistakes never ships in the first
place. Read it before you build, and run its playbook before you launch.

The owner is non-technical and trusts you to protect their business. Real money
(Stripe), real customer PII (name / email / phone), and their brand's email &
SMS channels run through this app. Treat every route as if a bored attacker with
your source code is poking at it — because once it's live, one is.

## The one rule that catches most of it: NEVER TRUST THE CLIENT

Anything that arrives from the browser can be forged — the request body, URL
params, headers, cookies, hidden flags, "confirmed": true. The browser is
enemy-controlled. So for every value that decides money, access, or identity:

- **Prices, totals, tax, tip, discount, quantity, commission** → recompute on the
  server from the DB (`services.price`, `gift_cards.remaining_value`, etc.).
  Never charge or record what the browser sent. A customer *will* POST
  `total_amount: 0.50` for a $60 haircut.
- **User / shop / appointment / order ids** → never return or mutate a row just
  because the client named its id. Verify the caller *owns* it first (IDOR).
- **Roles & permissions** (`shop_owner`, barber `manage_appointments`) → enforce
  server-side. Hiding a button in the UI is not access control.
- **Control flags** (`confirmed`, pause-bypass, "isAdmin") → only honor them for
  an authenticated caller who's actually allowed; otherwise force the safe default.

## The per-route gate (run this in your head on EVERY API route)

Before you consider a route in `src/app/api/**` done, answer all five. If you
can't, it isn't done:

1. **Who can call this?** Is there a `getUser`/Bearer-token check? If it writes,
   sends email/SMS, moves money, or reads private data, it needs one. Public
   routes (booking, availability, waitlist) are a deliberate, short list — a new
   route is NOT on it unless you decided so on purpose.
2. **Can they touch *this* resource?** After identifying the caller, verify
   ownership: `shop.owner_id === user.id`, or an active barber of that shop with
   the right permission. This is the IDOR check — the one people forget.
3. **Where do the money/identity values come from?** From the DB, not the body.
   (See the rule above.)
4. **What does it hand back?** Only the fields the caller needs. No `select("*")`
   to a public/anon caller (it leaks `stripe_account_id`, owner email, etc.). No
   raw DB/`error.message`/stack traces to the client — generic message out,
   detail to server logs.
5. **Can it be spammed or abused?** Public/abuse-prone routes (booking, waitlist,
   reviews, promo, SMS, email) need a rate limit and sane bounds (no negative
   amounts, no infinite discount stacking, no free-trial restart, dedup on
   re-submits).

## Fix the class, not the instance

The single biggest lesson from our own audit: when you find or fix a hole, **look
at its siblings immediately.** We fixed the auth gate on `pos/cash-sale` and
walked right past `pos-checkout` next to it with the same hole. If one route
trusts a client price, grep for the pattern across the whole `api/` tree and fix
every match in the same pass. One instance is never the whole bug.

## Verify, don't assume

- After every Supabase call, read the **`error`**, not just `data`. A silently
  failing write looks identical to success if you only check `data`. (This bit us
  for 3 deploys once — see CLAUDE.md.)
- Don't claim something is fixed until you've confirmed it. If you can't verify
  (env, prod DB, browser blocked), say so plainly.
- Report honestly: if a check failed, name it. "Done and verified" only when it is.

## Be proactive — flag it even when unasked

If you're in server code for an unrelated task and you notice an open route, a
client-trusted amount, or a leaked secret, **surface it.** You don't have to fix
it unrequested (the owner fears unexpected changes — respect that), but a
one-line "heads up, this route has no login check — want me to close it?" is
always right. Silence on a security hole you saw is the real failure.

## Running a full security pass

When asked to audit / harden / "check before launch", or before a real go-live,
run the full playbook in **`references/audit-playbook.md`**. It's the 5 checks
from the launch checklist (secrets → PII → production-readiness → deep auth &
payments → attacker's perspective), turned into concrete things to grep and read
in *this* codebase.

For a thorough pass, fan the work out across parallel subagents (one for secrets
& exposure, one for auth/IDOR/payments, one for PII/logging/hardening/input) —
that's how the audit that created this skill was run, and it covers far more
ground than a single linear read. Each agent returns findings as: plain-language
title, `file:line`, why it matters (one sentence), severity, and a one-line fix.
Then present a **short, plain-language list grouped by severity** — the owner is
non-technical, so no jargon dumps.

## ClipWise-specific traps (learn these once, save hours)

These are real footguns in this stack — check them by reflex:

- **Anon INSERT…RETURNING footgun:** an anon insert with `.select()` fails RLS
  even when `WITH CHECK` passes. Use `crypto.randomUUID()` + `return=minimal`, or
  do the write server-side via `supabaseAdmin`. New public writes go through API
  routes.
- **Supabase anon key is safe *only* with RLS on every table.** No RLS = the anon
  key reads your whole DB. `SUPABASE_SERVICE_ROLE_KEY` is server-only, never in a
  client component, never in a `NEXT_PUBLIC_` var.
- **RLS is row-level, not column-level.** A public `select("*")` on an approved
  `shops` row still returns `stripe_account_id`, owner `email`/`phone`,
  subscription ids. Name the public columns explicitly.
- **Stripe Connect:** charges run on each shop's connected account. The webhook
  must verify the signature and listen to *connected-account* events, or
  `payment_status` never flips to paid. Verify a Checkout session's
  `metadata.flow` / `appointment_id` / amount before marking anything paid — don't
  trust a bare `session_id` from the success URL.
- **`transactions` inserts** must match the proven `pos-finalize` columns (prod
  may lack `appointment_id`).
- **`notifications.type`** is CHECK-constrained to
  booking|cancellation|no-show|review|inventory|system — other values throw.
- **Charges need a held/saved card** (online + no-show protection). In-person /
  no-card bookings can't be charged after the fact.
- **`capture-appointment`** is allowed for the owner OR a barber with
  `manage_appointments` — mirror that authz shape on sibling routes.
- **Secrets never in committed scripts.** Debug/test scripts read creds from
  `.env.local`; a password hardcoded in a `.mjs` is a leak (and lives forever in
  git history — rotate if it happened).

## Ship discipline

Before pushing (which auto-deploys to clipwise.ca): run a **real build**, not
`tsc` — `SKIP_ENV_VALIDATION=1 npx next build` (the container's `tsc` has broken
module resolution and won't catch real errors). `next.config.mjs` does NOT set
`typescript.ignoreBuildErrors`, so a real TS error fails the deploy. After
`npm install`, `git checkout package-lock.json` before committing.

## The mindset in one line

Build like an engineer who assumes their code will be attacked, reads the error
instead of hoping, fixes the whole class, and speaks up about what they see.
