# Separate shopfront review

Route: `/shop-preview/<existing-shop-slug>`. Canonical `/book/<slug>` stays unchanged. This is a connected booking interface, not a sandbox: real submissions use existing production endpoints when deployed. Review without submitting real bookings/payments.

The preview injects a new landing component into the existing BookingClient. All service selection, optional/locked barber, availability, contact validation, consent, promo/gift/loyalty, tax, tips, card-on-file, online payment, waitlist, confirmation and recovery logic stays shared. Its ivory CSS is scoped to `.shop-luxury`; canonical routes have no wrapper. Stripe Checkout remains externally hosted. A strictly enumerated `luxury` presentation marker chooses the preview success/cancel path; arbitrary redirect URLs are not accepted by that marker. Preview metadata is noindex/nofollow.

The storefront uses actual public shop description/address/phone, active services, staff photos/bios and existing testimonials. There is no existing shop portfolio/cover-photo or shop-wide opening-hours source in the inspected data model. These are not invented; available appointment times remain in the calendar. No logo is shown. Gift-card purchase and booking management remain their existing separate routes.

## Verification
- `node scripts/tests/shopfront-return-check.cjs`: actual server return expression, canonical/luxury/unknown marker, slug query injection, charge and save-card return definitions.
- `node scripts/tests/fixtures/shopfront/build.cjs` then `node scripts/tests/shopfront-ui-check.cjs`: actual shared BookingClient and landing in Chrome, local Supabase/API mocks. Service, time, contact, payment selection, checkout error, slot conflict retry, confirmation, paid return, failed return, canonical isolation. 320/390/1440 rendering and timeline end-clearance. Screenshots in `.playwright-mcp/shopfront/` (local ignored artifacts).
- Existing full `node scripts/tests/run-flows.cjs` passed.
- Production build: passed (real Next.js production build with dummy environment).

Tests do not perform live bookings, customer notifications, charges, real Stripe handoff, authenticated customer interaction, physical iPhone testing, or real-shop database verification. Actual Stripe/card behavior remains the existing shared implementation. Owner review of preview required before replacing the canonical route.
