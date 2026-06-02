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
        // Brand accent slot — value moved from cream → pure white. The token
        // name stays `gold` so every `bg-gold`, `text-gold`, `border-gold/N`,
        // `bg-gold/15`, etc. across the codebase keeps working unmodified.
        gold: {
          DEFAULT: "#FFFFFF",
          light: "#FFFFFF",
          dark: "#D4D4D4",
        },
        surface: {
          DEFAULT: "#1C1C1E",
          raised: "#2C2C2E",
          overlay: "#3A3A3C",
        },
        border: {
          DEFAULT: "rgba(255,255,255,0.08)",
          gold: "rgba(255,255,255,0.25)",
        },
      },
      fontFamily: {
        // `font-sans` (Tailwind's default) now resolves to Geist via
        // the CSS variable wired up in layout.tsx. Inputs, buttons,
        // dropdowns, and body all pick it up automatically.
        sans: ["var(--font-body)", "Inter", "system-ui", "sans-serif"],
        heading: ["var(--font-heading)", "Inter", "system-ui", "sans-serif"],
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
