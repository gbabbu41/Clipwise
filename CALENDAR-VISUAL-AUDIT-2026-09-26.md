# Calendar visual interaction audit — 2026-09-26

Scope: actual CalendarView and SetupSheet rendered with real React, framer-motion,
production CSS and local Manrope; isolated mocked auth/data/network. Surrounding
header/footer are a test shell. No production requests or data writes.

## Findings fixed
- The reported gap was the remaining 37px of the 7AM row after scrolling25px,
  not extra padding. Hour labels now stay within their own hour until pushed out
  by the next row; time geometry, availability hatching and events are unchanged.
- Multi-day weekday headings now use readable secondary text (dark #8b9096,
  light #6b6b6b), replacing dark muted #696c71.
- Working-hours fields overflowed at phone widths. Below480px, each day has a
  separate complete time row; 320px AM/PM values and clock icons fit.
- Hours and add-appointment native controls now use the active theme's color scheme.
- Details/add close buttons have accessible names; Escape dismisses those sheets
  and the calendar/barber menus while preserving existing busy-save guards.
- Year view is announced correctly; desktop range title matches the actual three
  displayed columns (stale title calculation previously counted five).

## Exercised UI
| Area | Result / boundary |
|---|---|
| Day and 3-Day, both directions after scrolling | Passed in both themes; no artificial header gap |
| Previous/next, Now, staff picker | Passed; actual three-day view exists at all widths |
| Box, Month, Year, month selection/back | Rendered and navigated in both themes |
| Populated event / empty days / closed staff / break shading | Rendered with mocked records |
| Details, edit/cancel, add/block tabs/cancel | Opened, visually inspected; no submission |
| Escape on details/add/view menu | Passed; named close controls present |
| Hours | Both themes at320/390/1280; controls fit; no save |
| Partial hour |25/55/63px scroll and reverse: label remains in its row, no overlap |
| Representative layout |320/390/1280 both themes, no page overflow |

Not verified: real account/auth navigation, app-wide bottom-nav add integration,
real date picker OS popup on iOS/Android, keyboard focus trapping, touch drag on
physical devices, real booking/block/hours saves, payment/rejection/no-show actions,
network failure states and owner/barber permission permutations. These are not
claimed complete. Block submit stayed disabled for the fixture's invalid range.
This audit does not declare the entire calendar/app launch-ready.

## Reproduction
After `next build`, run:
```
node scripts/tests/fixtures/full-calendar/build.cjs
node scripts/tests/calendar-full-ui-check.cjs
```
Set WIDTH=320 or1280 for representative narrow/desktop checks; otherwise the full
interaction path runs at390. Screenshots/report are saved locally under
`.playwright-mcp/full-calendar` (ignored), including `after-partial-*.png`,
`after-hours-*.png`, `after320-hours-*.png` and `after1280-*.png` reviewed by director.
Mock fixtures are not application code and prohibit database writes.

Validation: focused calendar autofocus/workflow regressions, full component browser
checks, existing layout/contrast checks and real production build are required before
push. Release CI/deployment status is checked separately after push.

## Follow-up: actual view-entry alignment

The earlier sticky-label change did not resolve the reported short first-row strip.
A subsequent full-component transition reproduction (no injected scroll position)
found Day→3-Day near7:58PM opened at scrollTop468 with62px rows:34px of the first
visible hour was above the viewport, leaving a28px fragment under the headings.
Initial autofocus now rounds down to a complete hour boundary: scrollTop434,
first visible row62px. Day return also aligns434; past-date entry remains0.
Only initial positioning changes. Manual scrolling at37px remains37px, Now keeps
its original exact-time/bottom-clamped centering, and the4PM appointment retains
its558px time offset plus existing2px visual inset.

Reproduction/verification: `node scripts/tests/calendar-entry-alignment-check.cjs`
after building the existing full-calendar mock bundle. Actual transitions run at
392×853 in light/dark, with before/after screenshots saved in the same ignored
folder as `transition-before-*` and `transition-after-*`.

Important limitation: the exact original past-date Sep23–25 iPhone state did not
reproduce; those transitions landed at0 in Chromium. This fixes the observed
initial partial-row positioning without claiming verified Safari root cause.
Parent reviewed the after screenshot before authorizing push.
