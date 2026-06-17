import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Capacitor wraps the EXISTING Next.js web app in a native iOS/Android shell.
 *
 * We intentionally load the live hosted site via `server.url` instead of a
 * static export, so every API route / SSR feature keeps running on Vercel
 * exactly as it does on the web. The native layer only ADDS capabilities the
 * browser can't reach (e.g. Stripe Terminal / Tap to Pay).
 *
 * ⚠️ DO NOT set `output: "export"` in next.config.mjs — it would break all the
 *    /api routes and SSR this app depends on.
 *
 * Local device testing against `npm run dev`: temporarily point `server.url` at
 * your machine's LAN IP (e.g. http://192.168.1.50:3000) and set
 * `cleartext: true`. Revert before building a release.
 *
 * `appendUserAgent` lets the web code detect the native shell, e.g.
 *   const inApp = navigator.userAgent.includes("ClipWiseApp");
 * so a Tap to Pay button can show only inside the app.
 */
const config: CapacitorConfig = {
  appId: "ca.clipwise.app",
  appName: "ClipWise",
  webDir: "capacitor-www",
  appendUserAgent: "ClipWiseApp",
  server: {
    url: "https://clipwise.ca",
    cleartext: false,
  },
};

export default config;
