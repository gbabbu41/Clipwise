# Dashboard reporting-period correction — 2026-09-26

Root cause: the actual dashboard query loads the complete selected date interval,
using getDateRange and paginated date gte/lte bounds. StatsCarousel received those
same records/bounds, but bookingChartDays discarded all except the last14calendar
days. Hence This Month Sep1–26 showed30bookings/14completed while the chart started
Sep13. Headline/status totals were full-period; chart coverage was truncated.

Fixed:
- Full zero-filled daily series for the selected interval. Periods over45days use
  calendar-month chart bins with exact partial-month tooltip ranges. Summed chart
  counts equal daily data; accessible table retains every day of the interval.
- One shared exact range beneath filters/above carousel, replacing the extra date
  line below the Bookings number. Current week/month/year retain their existing
  to-date semantics; no future month/year days are implied.
- Tooltip first/last bins stay within the chart/card, preserving complete range/count.
- Confirmed shared getDateRange month overflow: May31,2026 last3months previously
  beganMar3; nowFeb28. Aug31,2024 last6months previously beganMar2; nowFeb29.
  Target day is clamped to the destination month's last day. Consumers are dashboard
  and payroll; inclusive ends and other preset semantics remain unchanged.

Integration traced: presets -> getDateRange -> actual dashboard loadAppointments
callback -> appointment query/pagination -> published records -> full series/status
counts. Collected/top-barber money retains paid-date filtering and reconciliation;
bookings/completed/status retain appointment-date scope. No accounting formulas or
Supabase queries changed. Existing dates are browser-local; this does not convert
reporting to shop timezone. Custom picker currently picks one day, while the helper
continues accepting custom start/end intervals.

Validation:
- New dashboard-period-check executes actual parent loader/query builder against
  mock DB records using real period helper/readAllRows. All9period options across
  Halifax/Vancouver/UTC: exact bounds, complete counts, month/year starts, leap-day,
  DST day enumeration, and month-end clamps.30record fixture includes15onSep1,
  15onSep26 and14completed. Registered in full flow suite.
- Actual Recharts component driven by real getDateRange: Today/month/year in both
  themes at320/390; monthly bin totals and partial-month tooltip, daily table with
  26month days/269year-to-date days. First/last tooltip bounds checked.
- Existing full mocked flow suite and real production build verified before push.

Visual evidence retained locally in ignored `.playwright-mcp/carousel`:
`period-{dark,light}-{320,390}-This-month.png`, `...-This-year.png`,
`...-year-tooltip.png`, `...-first-tooltip.png`. Parent reviewed screenshots.

Limits: real authenticated database contents/OS touch behavior not tested; mocked
parent loader verifies actual integration logic without live reads/writes. No claim
of a full financial audit or whole-app launch readiness.
