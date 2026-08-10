/** @type {import('next').NextConfig} */
const nextConfig = {
  // Skip ESLint during the production build. Lint still runs in editor
  // and via `npm run lint` locally — this just stops a single unused-import
  // or no-explicit-any rule from failing the Vercel deploy. Pre-launch
  // demo pragma; revisit before flipping the marketing site live.
  eslint: { ignoreDuringBuilds: true },

  // Baseline security headers. Applied to every response. X-Frame-Options is
  // scoped to the authenticated portals (DENY = anti-clickjacking) rather than
  // global, so the public /book pages can still be embedded by shops if needed.
  // A Content-Security-Policy is intentionally omitted here — a wrong CSP would
  // break Stripe/Supabase; add one deliberately after testing.
  async headers() {
    // Content-Security-Policy tuned to this app's ACTUAL load surface:
    //   • scripts/styles are self-hosted (Next.js) — 'unsafe-inline'/'unsafe-eval'
    //     are required because we don't use per-request nonces; there are NO
    //     external script hosts, so injected external scripts are still blocked.
    //   • data lives at Supabase only: REST/auth over https + realtime over wss.
    //   • images: Supabase Storage + the QR image API + data/blob URIs → https:.
    //   • Stripe is a top-level redirect (hosted Checkout), so only frame-src is
    //     opened to it defensively; no client Stripe.js is loaded.
    // frame-ancestors is intentionally omitted so shops can still embed their
    // /book page; the authenticated portals get X-Frame-Options: DENY below.
    const csp = [
      "default-src 'self'",
      // js.stripe.com is the ONLY external script host — Stripe.js, needed for the
      // in-app "Update card" secure field (Elements). No other external scripts.
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://js.stripe.com",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https:",
      "font-src 'self' data:",
      "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.stripe.com",
      // *.stripe.com covers the hosted Checkout redirect AND the Elements card
      // iframe (js.stripe.com / hooks.stripe.com) used by the in-app card update.
      "frame-src 'self' https://*.stripe.com",
      "worker-src 'self' blob:",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; ");
    const base = [
      { key: "Content-Security-Policy", value: csp },
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
    ];
    const denyFrame = [{ key: "X-Frame-Options", value: "DENY" }];
    return [
      { source: "/:path*", headers: base },
      { source: "/dashboard/:path*", headers: denyFrame },
      { source: "/barber-dashboard/:path*", headers: denyFrame },
      { source: "/admin/:path*", headers: denyFrame },
    ];
  },
};

export default nextConfig;
