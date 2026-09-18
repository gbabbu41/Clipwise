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
- Next bounded source-review candidate: final success-screen Continue reads/removes plan session state before awaiting refresh, without a synchronous duplicate guard. Reproduce whether repeated calls choose conflicting destinations, and check null/unavailable session storage. This is a candidate, not a completed fix or verified failure.
- Structural/schema/accounting changes still need coordinated approval; preserve scheduling, plan/trial and commission rules.

Coordinate shared source/build/index with Check GitHub repository. That task owns server/email/notification changes and DIRECTOR-RELIABILITY-STATUS.md. Latest preserved server commit at this handoff: `1ad3d6e` (trusted capture links), following `52baf78` (await receipt attempts). Its next completion-server review-request batch remains owned by that task.
