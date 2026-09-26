import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { AuthProvider } from "@/lib/auth-context";
import { PWARegister } from "@/components/pwa-register";
import { OfflineBanner } from "@/components/offline-banner";
import { ErrorLogger } from "@/components/error-logger";

// Manrope — primary UI face, matching the marketing site so the portals and the
// front page read as one premium brand. Geometric, tight at display sizes, clean
// at body sizes. Used everywhere except numerics (DM Mono). (Was Sora.)
// SELF-HOSTED (next/font/local) — the woff2 lives in the repo, so a build never
// depends on Google Fonts being reachable (a Google Fonts hiccup used to fail CI
// and could fail a real deploy). One variable file covers weights 200–800.
const manrope = localFont({
  src: [{ path: "./fonts/manrope-latin-variable.woff2", weight: "200 800", style: "normal" }],
  variable: "--font-body",
  display: "swap",
});

// DM Mono — applied via `font-mono` / `.font-numeric` for prices, stats,
// times. Slightly heavier than the default `font-mono` stack so dollar
// amounts read as deliberate UI elements, not afterthoughts. Self-hosted too.
const dmMono = localFont({
  src: [
    { path: "./fonts/dm-mono-latin-400.woff2", weight: "400", style: "normal" },
    { path: "./fonts/dm-mono-latin-500.woff2", weight: "500", style: "normal" },
  ],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "ClipWise — Barbershop Management Platform",
  description: "The smartest way to run your barbershop. Online booking, POS, analytics, loyalty programs and more.",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "ClipWise",
  },
  // ?v=3 busts the browser's (very sticky) favicon/icon cache after the mark was
  // updated — without a new URL, browsers keep showing the old icon indefinitely.
  // Bump this whenever the icon art changes.
  icons: {
    apple: "/apple-touch-icon.png?v=3",
    icon: [
      { url: "/favicon.ico?v=3", sizes: "any" },
      { url: "/icon-192.png?v=3", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png?v=3", sizes: "512x512", type: "image/png" },
    ],
    shortcut: "/favicon.ico?v=3",
  },
};

// viewport-fit=cover is required for env(safe-area-inset-*) to report real
// values on notch / Dynamic Island / home-indicator devices. It's a no-op in
// a normal browser tab (insets resolve to 0), so it changes nothing there.
export const viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover" as const,
  // Dark status/toolbar tint so it blends with the near-black app (was gold in the
  // manifest → a jarring strip at the top in standalone). Lives in `viewport`, not
  // `metadata`, per the Next 14 API (silences the build-time themeColor warning).
  themeColor: "#0A0A0A",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`dark ${manrope.variable} ${dmMono.variable}`}>
      <body className="antialiased bg-background text-white">
        <OfflineBanner />
        <ErrorLogger />
        <AuthProvider>
          {children}
        </AuthProvider>
        <PWARegister />
      </body>
    </html>
  );
}
