# Capture notification links

The authorized capture-appointment route previously preferred the caller's Origin header when forming no-show receipt rebooking and completion tip-SMS links. Owner/authorized-barber permission checks do not make an arbitrary request header a trusted website address.

The route now uses NEXT_PUBLIC_APP_URL or the existing https://clipwise.ca fallback, trimming trailing slashes. This matches the existing full/balance payment-link route configuration pattern. Existing /book/{shop.slug} and /tip/{appointment_id} paths and send eligibility remain unchanged. Configured preview/development hosts continue to work. Source searches found no custom-domain/white-label host routing; live hosting configuration was not inspected. No new origin allowlist, domain policy or infrastructure was introduced.

Actual capture-handler tests use a forged Origin and verify configured preview URL, configured localhost, missing/empty configuration fallback, trailing slash normalization, no-show rebooking links and completion tip links. Payment/receipt/ledger decisions are unchanged. This is a source-confirmed link-integrity fix, not a claim of historical exploitation. Repository secure-engineer guidance supplied the trust-boundary check.

Verification: focused tests, clean targeted lint, whitespace checks, full combined flow suite and real production build passed (202 pages, dummy credentials; expected dummy-backend plans warning). No live charge, message, database mutation or browser test.

Separate follow-up: payment-link-finalize still passes an Origin-derived baseUrl into completion-server, which sends review-request HTTP. Its review authorization/delivery and client-stat/loyalty persistence need their own scoped audit; this patch does not claim to fix them.
