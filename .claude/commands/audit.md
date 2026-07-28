---
description: Fan out parallel read-only sub-agents and return one severity-ranked report
---

Run a **multi-agent, READ-ONLY** review. Target: $ARGUMENTS
(If empty, review the current uncommitted diff; otherwise the named feature/area/files.)

## How to run it
Spawn specialized sub-agents **in parallel** (only the ones that fit the target):
Code Reviewer · Bug Hunter · Security Auditor · Performance Analyzer · UX/UI Reviewer ·
Architecture Reviewer · Feature Researcher · Test Generator.

Ground every agent in this repo's conventions + the **secure-engineer** footguns
(client-trusted amounts, IDOR / missing shop-scoping, RLS, the CHECK-constrained
`notifications.type`, migration-resilience, `next build` — not `tsc`). Each agent must
**verify every finding against the code** — `file:line` + a concrete failure scenario —
and label anything unconfirmed as UNVERIFIED. No guessing.

## Rules (from the project operating mode)
- **Do NOT modify any code.** This is analysis only.
- Preserve the existing architecture, UI, appointment engine, Stripe integration, auth,
  and workflows — treat them as production-quality.
- Only surface changes that improve reliability, security, maintainability, performance,
  accessibility, or UX. No style-only refactors of working code.

## Output
One concise report, **most-severe first**. For each finding include:
**severity · affected files · reason · proposed solution · benefits · risks · estimated
implementation effort.** End with a short "verified clean" list.
Then **await approval** — implement nothing until I say so.
