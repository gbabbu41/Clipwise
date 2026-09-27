# Dashboard carousel UI audit — 2026-09-26

Scope: StatsCarousel only. Current dashboard metric formulas, date filters, fee
reconciliation, payment records, calendar, navigation and global palettes are unchanged.

Changes:
- Compact equal-height cards (232px minimum, down from290), growing when the
  receipt breakdown needs more room; consistent padding and readable secondary labels.
- Removed green from this carousel's money/count text and completed-status chart.
  Existing blue chart accent is shared; statuses still have explicit labels/counts.
- Capped horizontal barber bars at28px and retained bookings max26px; removed the
  full-category grey hover band. Real tooltips remain available.
- Shorter headings, no repeated same-day range, one divider for a simple receipt.
  Definitions remain available under Chart data; tables retain full values/names.
- Explicit empty state rather than a zero-height bookings bar.

Accounting observations (not a financial audit): Collected counts paid-date sales
including POS; Net subtracts tax, applicable tips and commission. Average Ticket
uses paid COMPLETED appointments on the appointment-date basis. Consequently the
supplied40.25Collected/35Net/0Average Ticket/2confirmed screenshots are not alone
proof of an arithmetic error. No formulas or amounts were changed to force agreement.

Verification:
- Actual component and Recharts rendered with production CSS, local Manrope/DM Mono,
  fake props only: every slide in light/dark at320/390/1280, empty/single/multiple
  records, all5status labels, tooltips, receipt expand/collapse, data disclosure,
  and Today/month range prop changes. No overflow; heading contrast≥4.5:1; sparse
  barber bars bounded. Screenshot evidence retained locally in ignored
  `.playwright-mcp/carousel` (dark/light-390-single-0..3,320-multiple-3,breakdown).
- Existing dashboard-report and portal-revenue regressions passed, covering
  unavailable/loading/recovered fees and accounting aggregation behavior.
- Real production build passed (202pages). Parent screenshot review before push.

Reproduce browser fixture after production build:
```
node scripts/tests/fixtures/stats-carousel/build.cjs
node scripts/tests/dashboard-carousel-ui-check.cjs
```

Limitations: fixture period selects drive props; real dashboard filtering/fetch/auth,
physical-device swipe/OS behavior and live accounting records were not exercised.
No production data writes. This is not an assertion that the entire app is launch-ready.
