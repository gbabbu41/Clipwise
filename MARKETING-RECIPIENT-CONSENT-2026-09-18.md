# Campaign recipient / consent binding — September 18, 2026

## Reproduced issue

The actual `api/marketing/send` handler accepted a saved consenting client ID paired with a different browser-supplied email. Consent was evaluated on the saved row but delivery targeted the submitted address. A mocked handler regression first failed with one send instead of zero; no live message was sent.

## Bounded fix

- Keep the existing authenticated shop-owner and paid-plan gates.
- An explicit saved client ID must resolve within that shop; missing/foreign IDs and returned read errors skip the recipient without falling back to another identity or creating a client.
- Existing synthetic IDs still use email/phone resolution. Email lookup escapes wildcard characters; the resolved row must have the same shop and exact case-insensitive email. A phone match cannot transfer consent to a new address.
- Send to the stored email and personalize from the stored name; the existing unsubscribe ID and consent decision refer to that same row.
- Preserve existing unknown-contact creation after successful empty lookups, but no consent is granted and ineligible new rows receive nothing. Existing express/implied consent and withdrawal rules remain untouched.
- No gift-card delivery or intentional gift-card recipient override changes. No campaign pricing, coupon policy, schema, dependencies, retry/backfill or calendar changes.

## Regression coverage

`scripts/tests/marketing-recipient-check.cjs` executes the actual TypeScript handler with mocked database/provider and the real consent predicate. Covers forged ID/email, canonical saved casing/name/unsubscribe identity, email-only and synthetic resolution, foreign/missing IDs, same-shop filters, returned ID/email/phone read errors, phone/email mismatch, no-consent and withdrawn clients, existing implied-consent eligibility, unknown-contact preservation, wildcard escaping, provider rejection counts, unauthenticated/foreign-owner/free-plan rejection.

Tests are local only; they do not claim live schema/RLS/provider verification. No provider acceptance or inbox delivery is implied. Concurrent consent changes during a send and delivery atomicity remain separate concerns. Unexpected thrown failures and broader campaign input/coupon persistence handling are not redesigned in this batch.

Supabase guidance was applied to returned query errors and pattern matching; recent changelog review showed no relevant API change. Focused regression, full flow suite, targeted lint, whitespace checks and final real production build passed (202 pages, dummy credentials; expected dummy-backend plans fetch warning). Two preliminary builds caught inferred query/insert result typing; explicit result annotations fixed them before the successful build. No deployment-health or browser verification claimed.
