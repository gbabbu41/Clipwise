# Engineering reliability handoff — September 18, 2026

## Verified and pushed

All four batches passed targeted actual-handler/effect regressions, full `npm run test:flows`, targeted onboarding lint (only the existing img warning), and a real isolated production build using dummy credentials (202 pages). GitHub main SHA was verified after each push. Concurrent server/email work was preserved.

| Commit | Verified behavior | Batch-specific files |
| --- | --- | --- |
| `3dea4b8` | Failed shop/team resume reads block setup and offer retry; late/account-switched results cannot populate another setup | `scripts/tests/onboarding-resume-check.cjs`, `scripts/tests/onboarding-invite-controls-check.cjs`, `scripts/tests/invite-feedback-check.cjs`, `ONBOARDING-RESUME-READS-2026-09-18.md` |
| `8338079` | Synchronous guard prevents overlapping step writes; failed/null fallback team reads stop hours advancement | `scripts/tests/onboarding-step-save-check.cjs`, `ONBOARDING-STEP-SAVES-2026-09-18.md` |
| `5992888` | Failed hours deletion stops replacement insertion, later barber writes and advancement; thrown/all-closed failures covered | `scripts/tests/onboarding-hours-delete-check.cjs`, `ONBOARDING-HOURS-DELETE-2026-09-18.md` |
| `4717445` | Back waits for saves; repeated Continue calls from the same staff-step render cannot skip Hours | `scripts/tests/onboarding-navigation-check.cjs`, `ONBOARDING-NAVIGATION-2026-09-18.md` |

All four also changed `src/app/onboarding/page.tsx` and `scripts/tests/run-flows.cjs`. The final three update this handoff. Shared combined builds/flows were additionally reported passing by Check GitHub repository, including its capture URL follow-up with the final navigation source (202 pages).

## Verification limits

No deployment-health or live/browser workflow verification; no customer messages, transactions or production test writes. Push triggers deployment but successful deployment is not inferred from a passing build. Browser smoke testing remains reserved for final phase.

## Unresolved risks and next concrete review

- Hours replacement is still delete-then-insert and non-atomic. Earlier barber writes can succeed before a later failure; a lost response can be uncertain. No claim that failed saves leave hours unchanged.
- Cross-session idempotency and ambiguous service-insert retries remain unresolved. Saved shop/hour/service form fields are not additionally restored by the resume-read fix.
- Final Continue duplicate destinations and null-plan failure reproduced and fixed. Targeted tests, full combined flows, targeted lint (existing img warning) and isolated and shared production builds passed; pushed `1ebea74` and confirmed in remote history. Files: `src/app/onboarding/page.tsx`, `scripts/tests/onboarding-finish-check.cjs`, `scripts/tests/run-flows.cjs`, `ONBOARDING-FINISH-2026-09-18.md`. Next actual-handler regression reproduced failed team reads creating owner chairs in calendar SetupSheet hours; bounded prerequisites/error checks next.
- Structural/schema/accounting changes still need coordinated approval; preserve scheduling, plan/trial and commission rules.

Coordinate shared source/build/index with Check GitHub repository. That task owns server/email/notification changes and DIRECTOR-RELIABILITY-STATUS.md. Latest preserved server commit at this handoff: `1ad3d6e` (trusted capture links), following `52baf78` (await receipt attempts). Its next completion-server review-request batch remains owned by that task.

## Calendar quick-setup follow-up

Failed team reads creating an owner chair reproduced; successful team-read, confirmed barber-ID and hours-delete error gates implemented. Focused regressions and clean targeted lint passed; full flow suite and isolated production build passed with dummy credentials. Pushed `7b7542b`; remote main SHA verified. Files: `src/components/dashboard/setup-sheet.tsx`, `scripts/tests/setup-hours-prerequisites-check.cjs`, `scripts/tests/run-flows.cjs`, `SETUP-HOURS-PREREQUISITES-2026-09-18.md`. Next inspect location-save confirmation, pending dismissal/duplicates and stale shop form data. No atomicity/retry redesign.

Location-save zero-row false success reproduced and fixed; actual-handler tests and clean targeted lint pass. Full flow suite and isolated production build passed with dummy credentials; pushed `a31dd28` and remote verified. Files: `src/components/dashboard/setup-sheet.tsx`, `src/components/dashboard/calendar-setup-nudge.tsx`, `scripts/tests/setup-location-save-check.cjs`, `SETUP-LOCATION-SAVE-2026-09-18.md`, runner. Next extend hours pending-request/scope isolation based on reproduced races; non-atomic replacement remains separate.

Hours workflow overlap reproduced; shared synchronous guard and scope/cleanup checks implemented. Focused isolation/prerequisite/location tests, clean lint, full flow suite and isolated production build passed with dummy credentials; pushed `e8b337f` and remote verified. Files: `src/components/dashboard/setup-sheet.tsx`, `scripts/tests/setup-hours-isolation-check.cjs`, `scripts/tests/setup-hours-prerequisites-check.cjs`, runner, `SETUP-HOURS-ISOLATION-2026-09-18.md`. Writes already sent cannot be cancelled or rolled back.

## Public booking prerequisites

Essential service/barber read failure reproduced as an empty menu; bounded loader/cleanup/readiness fix and optional-review isolation implemented. Focused actual-effect/handler tests pass. Targeted lint remains 18 pre-existing unused errors and 4 img warnings; ESLint HEAD lintText versus modified lintFiles normalized rule/severity/message arrays match exactly. No new diagnostics; do not claim lint passed. Full flow suite and real isolated production build passed with dummy credentials; commit pending. Director accepted documented pre-existing lint baseline for this bounded change. Files: `src/app/book/[shopslug]/booking-client.tsx`, `src/app/book/[shopslug]/page.tsx`, `scripts/tests/public-booking-load-check.cjs`, runner, `PUBLIC-BOOKING-LOAD-2026-09-18.md`. Next assigned batch: quick-add required reads, separate from uncertain-submit semantics.
