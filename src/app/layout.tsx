import type { Metadata } from "next";
import { Sora, DM_Mono } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/lib/auth-context";
import { PWARegister } from "@/components/pwa-register";
import { OfflineBanner } from "@/components/offline-banner";

// Sora — primary UI face for the v2 design system. Geometric, extra-bold at
// display sizes, clean at body sizes. Used everywhere except numerics.
const sora = Sora({
  weight: ["300", "400", "500", "600", "700", "800"],
  subsets: ["latin"],
  variable: "--font-body",
  display: "swap",
});

// DM Mono — applied via `font-mono` / `.font-numeric` for prices, stats,
// times. Slightly heavier than the default `font-mono` stack so dollar
// amounts read as deliberate UI elements, not afterthoughts.
const dmMono = DM_Mono({
  weight: ["400", "500"],
  subsets: ["latin"],
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
  themeColor: "#000000",
  icons: {
    apple: "/apple-touch-icon.png",
    icon: [
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  },
};

// viewport-fit=cover is required for env(safe-area-inset-*) to report real
// values on notch / Dynamic Island / home-indicator devices. It's a no-op in
// a normal browser tab (insets resolve to 0), so it changes nothing there.
export const viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover" as const,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`dark ${sora.variable} ${dmMono.variable}`}>
      <body className="antialiased bg-background text-white">
        <OfflineBanner />
        <AuthProvider>
          {children}
        </AuthProvider>
        <PWARegister />
      </body>
    </html>
  );
}
