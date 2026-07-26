import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
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
        background: "var(--background)",
        foreground: "var(--foreground)",
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
          DEFAULT: "var(--surface)",
          raised:  "var(--surface-raised)",
          overlay: "var(--surface-overlay)",
          sunken:  "var(--surface-sunken)",
        },
        card: {
          DEFAULT: "var(--card)",
          raised:  "var(--card-raised)",
        },
        border: {
          DEFAULT: "var(--border)",
          strong:  "var(--border-strong)",
          gold:    "rgba(255,255,255,0.25)",
        },
        // Secondary / muted text tiers — collapses the old fragmented greys
        // (#8f8f8f/#999/#888/#aaa vs #666/#6e6e6e/#555) into two switchable tiers.
        grey: {
          DEFAULT: "var(--grey)",
          muted:   "var(--grey-2)",
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
