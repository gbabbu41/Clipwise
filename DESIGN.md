# ClipWise Design System

The source of truth for how ClipWise looks. **Read this before changing any UI.**

Precedence, highest first:

1. An explicit instruction from the owner in the current conversation
2. **This file**
3. Any installed skill (`design-taste-frontend`, `web-design-guidelines`, the Vercel React skills)
4. General taste

The design skills in `.claude/skills/` give good general advice. Where they disagree with
this file — a different palette, a different font, a new component library, a purple
gradient — **this file wins**. Don't restyle what's here to match a skill's defaults.

Every value below is read from the code (`src/app/globals.css`, `src/app/layout.tsx`,
`src/lib/marketing-theme.ts`, `tailwind.config.ts`). If you change a token, change it
there and update this file in the same commit.

---

## 1. Three surfaces — never cross-apply

| Surface | Scope | Where its tokens live |
|---|---|---|
| **Customer-facing** — booking, `/book/<slug>`, auth, receipts | `:root` | `globals.css` top |
| **Portals** — shop owner + barber dashboards | `.portal` (+ light theme) | `globals.css`, "Portal calm theme" |
| **Marketing** — `clipwise.ca` homepage | `.mkt` | `src/lib/marketing-theme.ts` |

Each is deliberately different. The marketing page is cinematic; the portals are calm and
dense because they're used forty times a day. **Do not bring marketing chrome (film grain,
letterbox bars, 100svh sections, display-size type) into the portals**, and don't pull
portal density into marketing.

---

## 2. Typography

| Role | Face | Weights | Loaded from |
|---|---|---|---|
| UI, body, headings | **Manrope** | 200–800 (variable) | `src/app/fonts/manrope-latin-variable.woff2` via `next/font/local` → `--font-body` |
| Numbers — prices, times, stats, counts | **DM Mono** | 400, 500 | `src/app/fonts/dm-mono-latin-*.woff2` → `--font-mono` |
| Marketing page | Manrope | 400–800 | `public/marketing/fonts/*.woff2` (self-hosted) |

Rules:

- **No other typeface.** Not Inter, not Geist, not Sora, not a Google Font.
- **Never add a Google Fonts `<link>`.** The CSP in `next.config.mjs` is
  `style-src 'self'` / `font-src 'self' data:`. External fonts are silently blocked and
  the page falls back to a system font. Self-host anything new under `src/app/fonts/`.
- **Money and time are always DM Mono** (`font-mono` / `.font-numeric`), with
  `font-variant-numeric: tabular-nums` so columns line up.

> **Known issue:** `tailwind.config.ts` still lists `"Sora"` *first* in `sans` and
> `heading`. Sora is no longer loaded, so it only renders Manrope by falling through —
> any machine with Sora installed locally gets Sora. Remove `"Sora"` from both stacks.

---

## 3. Colour tokens

### Customer-facing (`:root`)

| Token | Value | Use |
|---|---|---|
| `--background` | `#000000` | page |
| `--foreground` | `#FFFFFF` | primary text |
| `--card` | `#0c0c0c` | surface tier 1 |
| `--card-raised` | `#141414` | tier 2 — chips inside cards |
| `--surface-overlay` | `#1c1c1c` | tier 3 — hover, menus |
| `--surface-sunken` | `#0a0a0a` | recessed — disabled fields |
| `--border` | `#2a2a2a` | hairline |
| `--border-strong` | `#3a3a3a` | divider that must show |
| `--grey` | `#8f8f8f` | secondary text |
| `--grey-2` | `#555555` | **disabled / decorative only** — see §4 |

### Portal calm theme (`.portal`)

| Token | Value |
|---|---|
| `--background` | `#101113` |
| `--foreground` | `#ededee` — never pure white |
| `--card` | `#1a1b1e` |
| `--card-raised` | `#212226` |
| `--surface-overlay` | `#282a2e` |
| `--surface-sunken` | `#0b0c0e` |
| `--border` | `#1f2023` |
| `--border-strong` | `#2a2b2e` |
| `--grey` | `#8b9096` |
| `--grey-2` | `#696c71` — **large text only** |
| `--nav-glass` | `rgba(16,17,20,0.72)` |
| `--focus-ring` | `rgba(237,237,238,0.30)` |

### Portal light theme (`html[data-theme="light"] .portal`)

| Token | Value |
|---|---|
| `--background` | `#f6f7f9` |
| `--foreground` | `#1a1a1a` — never pure black |
| `--card` | `#ffffff` |
| `--card-raised` | `#f1f2f4` |
| `--border` | `#e6e8ec` |
| `--grey` | `#6b6b6b` |
| `--grey-2` | `#9a9a9a` — **disabled / decorative only** |
| `--nav-glass` | `rgba(255,255,255,0.72)` |

### Marketing (`.mkt`)

| Token | Value |
|---|---|
| `--bg` | `#000` |
| `--s1` / `--s2` | `#08080A` / `#0E0E11` |
| `--line` / `--line2` | `#17171B` / `#24242A` |
| `--t1` | `#F5F4F7` primary |
| `--t2` | `#9B9BA5` body |
| `--t3` | `#82828C` labels |
| `--t4` | `#5A5A63` — **large text only** |
| `--warn` | `#E0B341` |
| `--max` | `1120px` content column |

### Status colours — portals and customer pages

| Token | Value | Means |
|---|---|---|
| `--green` | `#22c55e` | paid, confirmed, success |
| `--red` | `#ef4444` | cancelled, danger |
| `--amber` | `#f59e0b` | pending, no-show |

**Status colours encode state and nothing else.** Never use them for decoration, accents,
buttons, or brand. The brand accent is white. (`--gold` still exists as a legacy name; it
is `#FFFFFF` so old `bg-gold` / `text-gold` callsites render white. Don't reintroduce a
gold colour.)

---

## 4. Contrast — measured, not guessed

WCAG AA needs **4.5:1** for normal text, **3:1** for large text (≥18.66px bold or ≥24px).

| Surface | Token | On | Ratio | Allowed for |
|---|---|---|---|---|
| customer | `--grey` `#8f8f8f` | `#000` | 6.49:1 | any text |
| customer | `--grey-2` `#555555` | `#000` | **2.82:1** | **disabled / decorative only** |
| portal | `--grey` `#8b9096` | `#101113` | 5.87:1 | any text |
| portal | `--grey` `#8b9096` | card `#1a1b1e` | 5.35:1 | any text |
| portal | `--grey-2` `#696c71` | `#101113` | 3.58:1 | large text only |
| portal | `--grey-2` `#696c71` | card `#1a1b1e` | 3.27:1 | large text only |
| light | `--grey` `#6b6b6b` | `#fff` | 5.33:1 | any text |
| light | `--grey-2` `#9a9a9a` | `#fff` | **2.81:1** | **disabled / decorative only** |
| marketing | `--t2` | `#000` | 7.63:1 | any text |
| marketing | `--t3` | `#000` | 5.52:1 | any text |
| marketing | `--t4` | `#000` | 3.08:1 | large text only |

The rule that matters: **`--grey-2` and `--t4` never carry text a person has to read** —
no prices, no disclaimers, no phone numbers, no form hints. Barbers read this app at arm's
length under shop lighting.

---

## 5. Components and patterns

**Glass bars.** The canonical implementation is `.cw-bnav` in `globals.css` — copy it,
don't reinvent it:

- opaque `var(--surface)` base, with the translucent `var(--nav-glass)` + blur swapped in
  only inside `@supports ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px)))`
- **always include `-webkit-backdrop-filter`** — without it, iOS Safari (the installed
  PWA, i.e. most users) gets a flat grey bar
- bottom bars pad for `env(safe-area-inset-bottom)`
- content must scroll *under* the bar, with matching bottom padding, or there's nothing to blur

`.glass-card` is missing the `-webkit-` prefix — fix it when touching it.

**Tap targets.** Minimum **44×44px** for anything tappable. The visible shape can be
smaller if transparent padding makes up the difference.

**Focus.** Use `var(--focus-ring)`. Never `outline: none` without a replacement.

**Surfaces.** Separate with tone and hairline borders, not heavy shadows. Tier order:
sunken → background → card → card-raised → overlay. Don't skip tiers to force contrast.

**Numbers.** DM Mono, tabular. A price is never set in Manrope.

---

## 6. Brand

### Name

Two forms, used deliberately:

- **CLIPWISE** — the wordmark only (logo, nav brand, footer brand)
- **ClipWise** — in sentences, page titles, emails, App Store copy

*(Owner to confirm. Before this file, both forms appeared within 200px of each other on
the homepage.)* Never "Clipwise", "Clip Wise", or "CLIP WISE".

### Wordmark

- Manrope, **CLIP at weight 800, WISE at weight 400**, same size
- Base tracking **−0.02em**, plus pair kerns: L→I **+0.018em**, P→W **−0.022em**,
  W→I **−0.016em**
- Colour `#F5F4F7` on dark, `#0A0A0C` on light
- Clear space: one cap-height on all sides. Minimum height 16px.
- Do not re-space, stretch, recolour or restyle it per placement. The kerning *is* the mark.

### Mark

A clipper head: one body bar, four cutting teeth, on a rounded tile.

48-unit grid — tile `rx 12`; body `x 9.5 y 15 w 29 h 11 rx 2.6`;
teeth `w 4.4 h 7.5 rx 1.1` at `x 11.5 / 18.5 / 25.5 / 32.5`, `y 26`.
Two values only — tile and teeth. No gradients, no green, no photo fills.
Light tile for app icons; **dark tile for circular crops** (a light tile in a circle loses
its corners and reads as a pale disc). Apple's two icons (180 and 1024) are **square and
fully opaque** — rounded or transparent is an App Store rejection.

Brand asset files (SVG + PNG) exist but are **not yet in the repo** — when added they go
under `public/brand/`. Until then, don't recreate the mark by hand.

---

## 7. Marketing page specifics

- The hero film (`public/marketing/hero-film.mp4`, 1920×1080) has **headline text and a
  flag mark burnt into the video**. Changing `object-fit`, stage size or crop moves that
  baked text against the DOM buttons below it. Read the hero component's comments before
  touching layout. The long-term plan is a text-free film with the headline in HTML.
- Everything is scoped under `.mkt`. Keep it that way.
- Content column is `--max` (1120px). Controls align to it, not to the viewport edge.

---

## 8. Don't

- Don't add a typeface, icon library, or component library (no new shadcn theme, no
  Material, no Fluent) without the owner asking.
- Don't use placeholder image hosts in shipped code — no `picsum.photos`, no Unsplash hot
  links, no `cdn.simpleicons.org`. The design skill suggests these for mockups; they don't
  belong in production.
- Don't use emoji as UI or section markers.
- Don't use purple/blue gradients, neon accents, or a coloured brand accent. The accent is white.
- Don't restyle working screens to match a skill's taste. Fix what's broken; leave what's settled.

---

## 9. Verify visually

Playwright MCP is configured in `.mcp.json`. After any visual change, screenshot the
affected page at:

- **390×844** — phone
- **1440×900** — laptop
- **2048×695** — short, wide desktop window (the one that exposes letterboxing)

and check: no horizontal scroll, no text below its allowed contrast, tap targets ≥44px,
glass bars actually blurring on iOS.
