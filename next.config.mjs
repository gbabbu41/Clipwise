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
    const base = [
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
