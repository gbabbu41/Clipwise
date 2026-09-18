# Direct-message email authorization

## Finding and bounded fix

The generic email endpoint previously allowed direct_message for any qualifying staff role (or internal secret), with arbitrary recipient and shop branding supplied by the caller. A role alone did not establish membership of the named shop or a relationship with the recipient.

Direct messages now use the existing shop authorization helper: shop owner or active staff membership is required, even when an internal-secret header is supplied. The recipient must match an email in that shop's clients, appointments or transactions, preserving synthetic booking/POS directory entries without creating rows. Lookup errors stop before sending. Matching escapes wildcard characters and checks exact normalized email equality.

Recipient name/email and shop name/reply-to/slug come from stored records, not caller branding. Nonempty message text remains caller-authored and unchanged. Both legitimate Messages-page callers now include shopId. Birthday sends retain their existing owner-only rule; other email types and server direct senders are unchanged. No plan entitlements, staff permission definitions, dependencies, schema, calendar or payment behavior changed.

## Verification

Actual route and authorization-helper mocks cover owner/active staff, foreign/inactive/customer callers, missing/expired tokens, shared-secret non-bypass, saved/booking/POS recipients, spoofed branding, arbitrary/mismatched recipients, failed reads, malformed requests and unchanged message text. Source assertions cover both Messages-page payloads. Existing birthday/server-only tests remain enabled. Full flow suite, targeted lint, whitespace check and production build passed (202 pages, dummy credentials; expected dummy-backend plans warning). The build also included the other task's concurrent onboarding edits, which are not staged here. No live messages or production data mutations were used.

## Limits and coordination

This verifies shop-recipient association, not proof of a saved in-app message or provider delivery. The Messages UI still fires notifications without awaiting outcomes; its "sent" wording and request-state handling need a separate batch. Public booking notification authorization and payment redirect Origin usage remain separate audits. The software developer task owns onboarding and standalone self-add work; those files are excluded from this commit.

The secure-engineer and Supabase skills informed resource authorization, failed-read handling and canonical stored identity. Current ilike semantics were checked through connected documentation; the changelog markdown endpoint was unsupported by the web reader.
