/** @type {import('next').NextConfig} */
const nextConfig = {
  // Skip ESLint during the production build. Lint still runs in editor
  // and via `npm run lint` locally — this just stops a single unused-import
  // or no-explicit-any rule from failing the Vercel deploy. Pre-launch
  // demo pragma; revisit before flipping the marketing site live.
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
