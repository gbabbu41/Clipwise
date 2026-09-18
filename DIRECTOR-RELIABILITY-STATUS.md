# Notification/payment-result reliability — September 18, 2026

## Lane and coordination

This task owns bounded server notification/payment-result reliability. Software developer owns onboarding/setup UI. Shared test-runner changes and build/commit windows are coordinated; no concurrent edits are overwritten. Existing booking/Stripe/auth/schema architecture and monetary rules are preserved. No production-data mutations or real messages/transactions are used for tests.

## Implemented and verified

- `d8f9ed8`: `src/app/api/stripe/refund/route.ts` and `refund-payment/route.ts` await internal refund email attempts. Focused actual-handler tests, full flows, lint and production build passed. Pushed and GitHub main SHA verified.
- `aaae222`: `src/app/api/webhooks/stripe/route.ts` migrates its refund notice to internal delivery; `src/lib/emailer.ts` makes refund_issued server-only at generic HTTP. `scripts/tests/webhook-refund-email-check.cjs` covers actual handler signatures, refund success/failure/contact/account gates, Connect/idempotency, delivery awaiting/failure isolation. Generic endpoint regression extended. Full flows/lint/build passed; pushed and remote verified.
- `0a69b80`: `src/lib/payment-notify.ts` no longer sends customer receipt data through its supplied baseUrl; `src/lib/emailer.ts` closes generic HTTP payment_receipt. `scripts/tests/payment-receipt-boundary-check.cjs` verifies preserved content/itemization and internal delivery. Full flows, targeted lint and production build passed; pushed and GitHub main SHA verified. See PAYMENT-RECEIPT-BOUNDARY-2026-09-18.md.

## Deployment versus live verification

Pushed means code is on GitHub main; the repository normally auto-deploys. Deployment completion/health has NOT been verified. Builds use dummy credentials. Browser smoke tests, customer transactions and live delivery are NOT verified. Awaited email attempts are not guaranteed delivery or persistent retries.

`a8e9d35`: all three owner_payment_received callers now use awaited internal delivery and the generic HTTP gate rejects fabricated owner notices. Actual-handler/helper regressions, full combined flows, lint and production build passed; pushed and GitHub main SHA verified. See OWNER-PAYMENT-EMAIL-2026-09-18.md. No query/filter/payment-decision changes.

## Remaining launch-critical gaps in this lane

1. Owner payment notices: resolved by a8e9d35 above; not an outstanding redesign item. Email persistence/retry remains outside these transport fixes.
2. Booking confirmation: public booking-client, staff Appointments and shared calendar approval callers still use generic email HTTP. Migrate canonical saved-appointment context together; do not blanket-block and break public booking. See CLIPWISE-AUDIT-LOOP.md for the deduplicated caller map.
3. Receipt lifetime fixed in `52baf78`: capture-appointment and markAppointmentPaid await one receipt attempt with local email-only failure catches. Actual-handler/helper tests verify success/ledger/claim behavior, one attempt and preserved completion effects; full combined flows/lint/build passed, pushed and remote verified. No exactly-once or inbox-delivery guarantee. See RECEIPT-AWAITING-2026-09-18.md.
   Capture notification links fixed in `1ad3d6e`: existing configured app URL/fallback replaces Origin-first baseUrl for no-show rebooking and tip SMS links. Preview/local/fallback tests, full flows, lint and build passed; pushed and remote verified. Completion review-request Origin/HTTP path subsequently fixed in `fba7850` below.
4. Refund/payment persistence errors after money moves need an approved reconciliation design. Merely returning an error can encourage another financial operation. Keep separate from email delivery fixes.
5. Completion review-request fixed in `fba7850`: regression reproduced rejected HTTP403 still stamping sent. Direct internal send, explicit timestamp selection, configured URL and success-only stamp passed focused tests/lint, full combined flows and real production build. GitHub main verified at this SHA after a concurrent push-ref race; owned commit contains only helper/test/runner/report. Success preserves the sender's existing acceptance OR already-reviewed suppression semantics, never inbox-delivery proof. No replay/backfill/schema changes. Shared calendar/cron outcome follow-ups are now resolved below; inline Appointments still has no prior-stamp guard or sent stamp. Cross-request races and accepted-send/failed-stamp need an approved atomic design rather than an exactly-once claim.

Sibling outcomes resolved: `a6039fe` makes cron review stamps/counts depend on handled success while preserving the 300-attempt cap; `a598779` makes shared calendar completion stamp only after confirmed successful HTTP JSON. Both reproduced before fix, passed focused/full/lint/build, pushed and remote verified. Correction to the earlier broad finding above: inline Appointments has NO sent timestamp/prior guard, not an unconditional stamp, and remains unchanged. No UI/calendar scheduling changes.

Browser authorization fixed in `cf1577f`, pushed and GitHub main verified: concrete actual-handler mock reproduced foreign-barber role sending arbitrary recipient/link with 200. Director-approved rule mirrors protected completion endpoints (owner or active same-shop manage_appointments barber) and preserves existing verified super_admin exception. Canonical recipient/branding/link are read from appointment/shop; failed/malformed/foreign requests send nothing. Focused tests, sibling regressions, full combined flows, lint/whitespace and production build passed. See REVIEW-EMAIL-AUTHORIZATION-2026-09-18.md. No live messages or policy ambiguity left for this specific mapped permission; no status/timing/stamp behavior change.

## Decisions requiring owner direction, not automatic architecture changes

- Atomic/recoverable loyalty claim + balance + reward updates (L1/L2), promo final-use reservation (PR1), cash gift-card issuance + ledger (P2), and atomic waitlist conversion remain logged in the parent audit. No schema/financial redesign is included here.
- Proposed financial reconciliation review: document current idempotency keys and failure stages first; propose recoverable states/replay rules and any required SQL for approval, without changing refund/commission/tax policies.

Exact scoped reports and the parent CLIPWISE-AUDIT-LOOP.md are authoritative for earlier batches. Do not treat previous source-only findings as live incidents or unverified changes as deployed.

## Remaining generic email coverage inventory

Source inventory, not a full production security certification. Internal callers bypass the HTTP gate by design; their existing authority must stay at their dedicated entry point. Provider success is not inbox proof. The following covers every current template by group.

Lifecycle six-type closure: endpoint failure reproduced before fix, focused/full regressions, targeted lint, whitespace and real production build passed (202 pages with dummy credentials). See LIFECYCLE-EMAIL-BOUNDARY-2026-09-18.md; no live sends or database changes.

| Types | Intended callers and current boundary | Eligibility/outcome evidence or remaining gap |
| --- | --- | --- |
| subscription_started, subscription_cancelled, subscription_payment_failed, subscription_renewal_reminder, subscription_card_updated | Dedicated billing/webhook/maintenance routes; generic HTTP blocked | Existing billing guards unchanged; subscription and server-email regressions |
| signup_code, password_reset, barber_password_reset, barber_invite | Dedicated auth/invite routes; generic HTTP blocked; authoritative login/invite recipient and configured links | Existing captcha/cooldown/owner checks; reset/invite regression reports |
| payment_link, refund_issued, payment_receipt, owner_payment_received | Authorized financial routes/helpers; generic HTTP blocked; configured links/internal delivery | Awaited attempts, financial outcomes isolated from email failures; payment/refund/receipt tests; no persistent delivery retry |
| owner_weekly_digest, connect_reminder | Cron internal only; generic HTTP blocked | Existing cron eligibility; non-review outcome counters/stamps need follow-up |
| new_shop_application, shop_submitted_confirmation, shop_welcome, weekly_schedule, trial_reminder, trial_ended | Shops/create, reminder cron and process-trials internal only; six-type closure in current batch | Creation approval selection, schedule eligibility and trial thresholds unchanged; endpoint and trial regressions; see lifecycle report |
| birthday_wish, direct_message | Browser owner-only birthday / owner or active same-shop staff direct message; known tenant recipient and stored branding; cron birthday internal | Authorization tests pass. Cron birthday uses canReceivePromos; manual birthday consent parity needs separate review. Direct-message UI still risks claiming delivery without observing the result |
| review_request | Owner or active same-shop manage_appointments barber, preserved verified platform admin exception; canonical appointment recipient/shop/link. Completion/cron internal | Outcome/auth tests pass. Existing already-reviewed suppression preserved. Inline Appointments has no prior-stamp guard or sent stamp; manual resend policy remains separate |
| booking_confirmation, booking_request_received | Public booking-client and staff approval HTTP plus authoritative booking/finalize/waitlist internal callers | HTTP still trusts supplied recipient/content; cannot blanket-block before migrating public and approval callers together. Pending versus confirmed must stay distinct |
| shop_approved, shop_rejected | Three admin pages/five calls migrated to bearer+shopId; generic handler uses existing requireSuperAdmin | Anonymous exposure reproduced then blocked; canonical saved owner/shop/slug/reason and matching saved status. Browser failures preserve successful status mutation and explicitly discourage repeating it; see ADMIN-EMAIL-AUTHORIZATION-2026-09-18.md |
| new_barber_request | join-shop browser caller through generic HTTP | No generic resource gate; trace join request identity and canonical owner before tightening |
| rebooking_reminder, no_show_followup | Clients manual nudge, appointment completion/no-show helpers and cron | Generic staff role only, arbitrary supplied recipient/link. Cron promotional nudges use canReceivePromos; preserve distinct operational/manual intent pending exact caller authorization mapping |
| appointment_rejected | Appointments page/shared helper HTTP | No generic resource gate; canonical authorized appointment migration needed; do not change rejection/refund workflow |
| appointment_reminder, appointment_updated, appointment_cancelled, barber_appointment_change | Cron, my-booking, appointments/update and cancellation internal paths found | Generic HTTP remains exposed despite direct server callers; candidate for existing server-only closure after complete caller/alias verification |
| new_booking_owner, new_booking_barber | notify-booking-emails, finalize-booking-session and reassignment internal paths found | Saved recipients/account fallback; generic HTTP remains exposed; candidate server-only closure. Preserve owner-as-barber duplicate suppression |
| schedule_updated, time_off_request, time_off_decision | Dedicated schedule/block/time-off internal routes found | Generic staff role only despite internal callers; candidate server-only closure after all route variants verified |
| waitlist_slot_open | waitlist-notify-server internal caller found | Generic role-only access; dedicated waitlist tests exist. Candidate server-only closure after caller verification |
| marketing_campaign | Dedicated marketing/send plus gift-card helpers/routes use internal engine; generic HTTP closure in follow-on batch | Generic bypass reproduced and blocked; legitimate direct callers unchanged. Dedicated campaign consent-to-recipient mismatch remains separately source-supported: saved client eligibility is checked but original browser email is sent. Gift-card operational recipient overrides remain intentional and separate |

These remaining gaps are source findings, not all reproduced or fixed. Existing endpoint inventory does not imply every dedicated sender's full authorization has been audited. Public booking ownership coordinated with software developer; their loader changes do not alter notification senders.

Follow-on priority: reproduce and bind the dedicated campaign's actual recipient to the consent-checked saved client. Admin email source tracing confirms the generic notification path does not mutate approval: both actual status PATCH routes requireSuperAdmin. All three admin browser callers already have bearer tokens but omit them on email requests. Implement canonical admin-email migration only with matched caller changes and negative/positive regressions; do not modify approval business rules. See MARKETING-EMAIL-BOUNDARY-2026-09-18.md.

Campaign recipient binding follow-on implemented and verified: actual-handler regression reproduced one forged-recipient send, then verifies zero. Recipient must match the same shop-scoped saved client used for consent/unsubscribe; stored casing/name used, missing/foreign IDs and returned lookup errors skip without fallback, wildcard matching escaped. Existing express/implied/withdrawn policy and gift-card overrides untouched. Focused/full flows, targeted lint/whitespace and final production build passed (202 pages/dummy credentials), after correcting TypeScript result inference caught by preliminary builds. See MARKETING-RECIPIENT-CONSENT-2026-09-18.md. This resolves the dedicated campaign mismatch above; admin canonical notification migration is next. Broader coupon persistence/input recovery and concurrent consent/send atomicity remain separate.

## Review-delivery launch-risk proposal — approval required before implementation

Failure: completion and cron can both read an empty sent timestamp and both send before either stamps. Provider acceptance followed by a process crash or failed timestamp write also leaves a future caller able to resend. A timeout can leave acceptance uncertain. Current success-only stamps avoid false success but cannot solve these races.

Impact: duplicate or missing review nudges and damaged customer trust, not duplicate financial charges. No live incident has been observed. The inline Appointments sender additionally lacks the stamp/prior guard; deciding whether deliberate resend is allowed is separate from automatic deduplication.

Smallest reliable design to evaluate: one durable per-appointment automatic-review delivery record, an atomic worker claim with recoverable state, and a stable provider deduplication key if the provider's documented behavior supports the required retry window. This is a proposal, not a verified provider guarantee. A claim-before-send boolean alone is insufficient: crashing after claiming can permanently lose the notification. Keep existing eligibility, consent, timing, recipients and reviewed-customer suppression unchanged; explicitly distinguish suppression from provider acceptance.

Schema/business implications: new persistent delivery state and an atomic claim operation would require approved migration/design. Decide the allowed recovery window, handling of uncertain provider outcomes and deliberate manual resend before implementing retries. No backfill or automatic resend of historic appointments without separate approval. No SQL or migrations applied.

Acceptance checks (mocked): competing completion/cron workers; crashes before send and after acceptance; provider rejection/timeout; failed final persistence; expired claims; already-reviewed suppression; ineligible appointments; explicit manual resend decision; preservation of existing booking/loyalty effects. Assert bounded attempts and no false delivery status, not impossible exactly-once inbox delivery.

Rollback: disable the proposed worker via an approved rollout switch, keep durable records and existing sent timestamps intact, and do not automatically replay uncertain records or silently fall back to unrestricted sends. Review unresolved records deliberately. Keep this separate from the already-shipped outcome/auth fixes.
