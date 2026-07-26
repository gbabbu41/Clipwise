# ClipWise Brand System (for marketing content)

Everything here is sampled from the live product (`tailwind.config.ts`,
`globals.css`, landing page). Match it so marketing feels like the same company as
the app. When a marketing piece needs more life than the ultra-minimal app UI, you
may add energy (a hero photo, a bolder blue glow) — but never break the core rules.

## Colors

| Role | Hex | Use in marketing |
|------|-----|------------------|
| **Canvas / base** | `#000000` | Default background. Premium, high-contrast. |
| **Off-black (softer)** | `#0e0f12` | Alt background when pure black feels harsh. |
| **Primary text** | `#FFFFFF` | Headlines, body on dark. |
| **Signature accent (blue)** | `#6ea8fe` | THE brand color. CTAs, highlights, key words, the wordmark gradient. White text reads on it. |
| **Accent soft** | `#a9c6ff` | Light-blue marks/icons/underlines on dark. |
| **Accent wash** | `rgba(110,168,254,0.12)` | Faint tinted panels/glows behind hero art. |
| **Hairline border** | `#2a2a2a` | Thin dividers, card edges. Keep them subtle. |
| **Secondary text (grey)** | `#8f8f8f` | Subheads, captions, fine print on dark. |
| **Success green** | `#22c55e` | "Paid," "confirmed," positive stats. |
| **Danger red** | `#ef4444` | "No-show," "lost revenue" (the problem). |
| **Amber** | `#f59e0b` | Stars/reviews, "pending," warnings. Sparingly. |

**Cream note:** the app hints at a warm "ClipWise cream" for light mode. For
marketing you can use an off-white `#f1f1f1` background variant for the occasional
light-themed piece (e.g. a testimonial card), but **dark is the default identity.**

**Palette discipline:** one accent (the blue) per piece. Green/red/amber are
*semantic* — use them only to mean success/problem/rating, never as decoration. No
rainbow gradients. A blue→transparent glow behind the subject is the signature move.

## Typography

- **Sora** — headings AND body. Weights: 700/600 for headlines, 400/500 for body.
  Tight leading on big type, generous letter-spacing on small caps labels.
- **DM Mono** — numbers, stats, prices, metrics ("$29.99", "0 no-shows", "+38%").
  Using mono for figures is a signature ClipWise tell — lean into it for stat cards.
- Hierarchy: huge headline → one-line subhead in grey → small mono stat or CTA.
- If Sora/DM Mono aren't available in a tool, substitute: **Inter/Manrope** for Sora,
  **Space Mono/JetBrains Mono** for DM Mono. Never Times/Comic/Papyrus/default serif.

## Logo & wordmark

- The wordmark is "ClipWise" — set in Sora, often with the blue gradient on "Wise"
  or the whole word. Icons live in `public/` (`icon-512.png`, `icon-192.png`,
  `apple-touch-icon.png`) — reuse these for profile pics / watermarks; don't redraw
  the mark from scratch unless asked. If you need a transparent version, run the icon
  through `image_remove_background`.
- Clear space: keep at least the height of the "C" clear around the wordmark.
- On busy photos, place the wordmark on a solid black chip or add a subtle scrim so
  it stays legible.

## Voice & tone

Confident, clean, benefit-led — owner-to-owner. We're the smart operator's tool, not
a hype machine. Tagline anchor: **"The smartest way to run your barbershop."**

- **Lead with the outcome, not the feature.** "Stop losing money to no-shows" beats
  "We have deposit collection."
- **Short, punchy, concrete.** Sentence fragments are fine. Numbers > adjectives.
- **Respect the reader.** They run a business. No baby talk, no fake urgency, no
  "CLICK NOW!!!" Real value, plainly stated.
- **A little swagger, never arrogance.** "Run your shop like a pro" — yes.
  "Everyone else is trash" — no.
- **Canadian & inclusive.** clipwise.ca. Barbers of every kind; avoid clichés.

**Words we like:** smart, clean, effortless, pro, full chairs, get paid, in seconds,
one dashboard, no more, finally.
**Words we avoid:** revolutionary, game-changing, synergy, disrupt, unleash, ninja.

### Voice examples

- Hook: **"Your chair sat empty. Your bank account noticed."** → no-show protection.
- Hook: **"Payday math shouldn't take all night."** → payroll/commission.
- Hook: **"Free forever. Yes, actually."** → free plan.
- CTA options: "Start free at clipwise.ca" · "Book a demo" · "Try it free — no card."
- Subhead formula: *[Feature] so you can [owner outcome].* → "Online deposits, so a
  no-show never costs you again."

## Visual style cues

- **Lots of black space.** Let one element breathe. Crowding kills the premium feel.
- **Hairline everything.** Thin borders, thin dividers, thin icon strokes.
- **Mono stat cards.** A big DM Mono number on black with a grey label = instant
  ClipWise. Great for "$0 lost to no-shows," "+27% rebookings."
- **Product-forward.** Show real (or realistic mock) ClipWise screens — the calendar,
  booking page, payments dashboard — floating on black with a soft blue glow.
- **Photography:** real barbershop moments (fades, clippers, the chair, a card tap)
  graded cool/neutral, never orange-teal Instagram filter. Add a black gradient at
  the bottom for text.
- **Avoid:** clip-art scissors, cartoon barbers, drop-shadow bevels, stocky
  handshakes, more than one accent color, tiny unreadable text.

## Quick brand checklist (run before shipping any visual)

- [ ] Black (or off-black) background?
- [ ] Exactly one accent — the ClipWise blue `#6ea8fe`?
- [ ] Sora headline + (if numbers) DM Mono figures?
- [ ] One idea, hook in the first 3 words, one CTA?
- [ ] Wordmark legible with clear space?
- [ ] Correct dimensions for the target platform?
- [ ] Enough contrast to read on a phone at arm's length?
