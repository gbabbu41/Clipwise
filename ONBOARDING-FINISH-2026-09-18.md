# Onboarding final Continue recovery

Actual-handler regressions reproduced two quick final Continue calls navigating first to Stripe setup and then to the dashboard: the first call removed the plan before awaiting refresh, so the second chose a different destination. A stored JSON null also threw before navigation.

A synchronous ref now permits one final handoff, retaining the existing loading state through navigation. The chosen plan is read once. Null/corrupt/unavailable storage falls back safely; if removal fails after successful parsing, the chosen plan still determines the existing destination. Shop refresh remains awaited and its existing dashboard-retry fallback is preserved. This does not alter auth, subscriptions, trial policy or Stripe setup eligibility.

Actual-handler checks cover repeated calls before and after refresh, Pro/Premium destinations, Starter/default destination, null/corrupt data, throwing storage reads/removals and a rejected shop refresh. No production data/messages or live navigation were used. Full validation/commit evidence is recorded in the engineering handoff and parent audit log.
