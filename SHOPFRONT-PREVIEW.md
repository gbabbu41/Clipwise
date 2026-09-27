# Shopfront rollout

The approved storefront now serves every existing `/book/<shop-slug>` link. `/shop-preview/<slug>` remains compatible for old links and pending checkout returns. This is a connected booking interface, not a sandbox: real submissions use existing production endpoints when deployed. Review without submitting real bookings/payments.

The booking route injects a new landing component into the existing BookingClient. All service selection, optional/locked barber, availability, contact validation, consent, promo/gift/loyalty, tax, tips, card-on-file, online payment, waitlist, confirmation and recovery logic stays shared. Its ivory CSS is scoped to `.shop-luxury`; canonical booking routes use the same wrapper. Stripe Checkout remains externally hosted. New Stripe success/cancel returns always use the encoded canonical `/book/<slug>` path, independent of presentation markers. Preview metadata is noindex/nofollow.

The storefront uses actual public shop description/address/phone, active services, staff photos/bios and existing testimonials. The original approved template is ported with its studio/craft photos explicitly labeled editorial photography. No existing shop portfolio/cover-photo or shop-wide opening-hours source was found; sample hours are removed; actual appointment times remain in the booking calendar. Real staff photos are used when present; otherwise a matching initials placeholder says Photo coming soon. No logo is shown. Gift-card purchase and booking management remain their existing separate routes.

## Verification
- `node scripts/tests/shopfront-return-check.cjs`: actual server return expression, canonical/luxury/unknown marker, slug query injection, charge and save-card return definitions.
- `node scripts/tests/fixtures/shopfront/build.cjs` then `node scripts/tests/shopfront-ui-check.cjs`: actual shared BookingClient and landing in Chrome, local Supabase/API mocks. Service, time, contact, payment selection, checkout error, slot conflict retry, confirmation, paid return, failed return, legacy component isolation and canonical return URLs. 320/390/1440 rendering and timeline end-clearance. Screenshots in `.playwright-mcp/shopfront/` (local ignored artifacts).
- Existing full `node scripts/tests/run-flows.cjs` passed.
- Production build: passed (real Next.js production build with dummy environment).

Tests do not perform live bookings, customer notifications, charges, real Stripe handoff, authenticated customer interaction, physical iPhone testing, or real-shop database verification. Actual Stripe/card behavior remains the existing shared implementation. The owner explicitly authorized the canonical rollout on 2026-09-27. Anyone now uses a readable monochrome SVG in selected and unselected states. No customer records, loyalty rules or schema changed.
