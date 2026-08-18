import type { Config } from "tailwindcss";

// Our theme colors live in CSS variables as hex (e.g. --foreground:#1a1a1a) so
// hand-written rules in globals.css can use `var(--foreground)` as a full color.
// But Tailwind can't inject an alpha channel into a bare `var(...)`, so an opacity
// modifier like `text-foreground/70` or `bg-card-raised/50` used to emit NO rule
// at all — the element lost its color/fill and inherited (white text on light
// surfaces, transparent cards). Wrapping each var token as a color FUNCTION routes
// the opacity through `color-mix`, so every `/NN` modifier works app-wide while a
// plain `text-foreground` still resolves to the solid colour (100% = unchanged).
// Keeps the hex vars intact, so raw `var(--x)` usage in globals.css is unaffected.
// Returns a Tailwind color FUNCTION at runtime (Tailwind calls it with the
// resolved opacity), but typed as `string` because @tailwindcss/Config's color
// type doesn't include the function form — a known typing gap. The cast keeps the
// config type-checking while Tailwind still receives the function.
const varColor = (name: string): string =>
  ((({ opacityValue }: { opacityValue?: string }) =>
    opacityValue === undefined
      ? `var(${name})`
      : `color-mix(in srgb, var(${name}) calc(${opacityValue} * 100%), transparent)`) as unknown as string);

const config: Config = {
  darkMode: ["class"],
  // Only apply `hover:` styles on devices that actually support hover. On touch
  // (the installed PWA), a tap used to leave a "stuck" hover background on the row
  // under a finger — e.g. changing shops in the switcher left Calendar highlighted
  // because the dropdown overlays it and the tap bled through. This scopes every
  // hover utility to `@media (hover: hover)`, killing that class of sticky-hover.
  future: { hoverOnlyWhenSupported: true },
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
    // `src/lib/utils.ts` returns Tailwind class strings (getStatusColor,
    // getTagColor). Without scanning lib/, the JIT skips those classes and
    // the rendered markup falls through to body color (#FFFFFF = white).
    "./src/lib/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        background: varColor("--background"),
        foreground: varColor("--foreground"),
        // `gold` slot kept as white — every `bg-gold` etc. across the
        // codebase silently becomes the design system's white accent.
        gold: {
          DEFAULT: "#FFFFFF",
          light: "#FFFFFF",
          dark: "#D4D4D4",
        },
        // Brand accent — the periwinkle-blue signature (matches the homepage
        // wordmark gradient + interactive blue). This retires the old gold/amber
        // brand accent. Use `accent` for solid fills (white text reads on it),
        // `accent-soft` for light-blue text / icons / marks on dark surfaces,
        // and `accent-muted` for faint tinted washes (e.g. today's column).
        // SEMANTIC amber (pending, warnings, no-show, stars) stays amber.
        accent: {
          DEFAULT: "#6ea8fe",
          soft:    "#a9c6ff",
          muted:   "rgba(110,168,254,0.12)",
        },
        // v2 surfaces — now CSS-var backed so a single token override (e.g. the
        // calm `.portal` scope, or the upcoming light theme) re-skins every
        // `bg-surface` / `bg-card` / `border-border` / `text-grey` callsite with
        // zero code changes. Public pages keep the :root defaults untouched.
        surface: {
          DEFAULT: varColor("--surface"),
          raised:  varColor("--surface-raised"),
          overlay: varColor("--surface-overlay"),
          sunken:  varColor("--surface-sunken"),
        },
        card: {
          DEFAULT: varColor("--card"),
          raised:  varColor("--card-raised"),
        },
        border: {
          DEFAULT: varColor("--border"),
          strong:  varColor("--border-strong"),
          gold:    "rgba(255,255,255,0.25)",
        },
        // Secondary / muted text tiers — collapses the old fragmented greys
        // (#8f8f8f/#999/#888/#aaa vs #666/#6e6e6e/#555) into two switchable tiers.
        grey: {
          DEFAULT: varColor("--grey"),
          muted:   varColor("--grey-2"),
        },
      },
      fontFamily: {
        // `font-sans` (Tailwind default) → Sora. `font-mono` → DM Mono for
        // any numeric display. Both wired via CSS variables from layout.tsx.
        sans:    ["Sora", "var(--font-body)", "system-ui", "sans-serif"],
        mono:    ["DM Mono", "var(--font-mono)", "ui-monospace", "monospace"],
        heading: ["Sora", "var(--font-body)", "system-ui", "sans-serif"],
        numeric: ["DM Mono", "var(--font-mono)", "ui-monospace", "monospace"],
      },
      animation: {
        "fade-in": "fadeIn 0.3s ease-in-out",
        "slide-up": "slideUp 0.3s ease-out",
        "shimmer": "shimmer 2s infinite",
        "pulse-gold": "pulseGold 2s infinite",
      },
      keyframes: {
        fadeIn: {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        slideUp: {
          "0%": { transform: "translateY(10px)", opacity: "0" },
          "100%": { transform: "translateY(0)", opacity: "1" },
        },
        shimmer: {
          "0%": { backgroundPosition: "-1000px 0" },
          "100%": { backgroundPosition: "1000px 0" },
        },
        pulseGold: {
          "0%, 100%": { boxShadow: "0 0 0 0 rgba(255, 255, 255, 0.4)" },
          "50%": { boxShadow: "0 0 0 8px rgba(255, 255, 255, 0)" },
        },
      },
    },
  },
  plugins: [],
};
export default config;
