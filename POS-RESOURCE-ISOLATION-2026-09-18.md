# POS resource isolation

Small security batch under the user's authorization to continue incremental fixes and pushes. No schema, pricing, commission, tax, refund, plan, UI or calendar changes.

## Changes

- Cash sales validate supplied inventory, gift card and barber IDs against the authorized shop before any sale write, point deduction, receipt or stock change.
- Card Checkout validates stock/barber IDs before opening a payment session.
- Inventory and gift-card reads/updates retain shop filters. Card-finalize inventory changes are also shop-scoped, including older Checkout sessions.
- Invalid product quantities and malformed gift-card inputs are refused rather than causing unexpected stock or balance arithmetic.
- Existing cash/custom pricing, commission calculation, active-staff access, paid-plan requirements and Stripe Connect requirements remain unchanged.

## Checks

- Added actual-route mocked regression coverage for cross-shop/missing resources, failed reads, malformed quantities, owner/staff access, plan gates, cash/gift/card success, unchanged totals and shop-scoped mutations.
- Full regression suite and targeted lint passed. The initial build caught a Set-iteration compatibility issue; corrected to Array.from without changing project/compiler configuration. Final production build passed with dummy CI credentials, including TypeScript and 202 static pages. A plans-fetch warning against the dummy backend does not establish live plan-loading health. Pushed commit is recorded in the audit log.
- No live transaction, provider message, database migration or manual smoke test performed.

## Limits

This isolates resources by shop; it does not make the entire sale, stock decrement and gift redemption one transaction. Concurrent gift/stock updates, recovery after partial failures and historical malformed payment metadata remain separate reliability work. Existing POS-finalize session/payment verification was not replaced.

The security/Supabase review drove pre-write validation and shop filters, including the sibling card path. Current [Supabase update documentation](https://supabase.com/docs/reference/javascript/update) was consulted; the Markdown changelog endpoint was unavailable. No package updates were made.
