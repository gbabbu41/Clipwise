# Calendar scrolling — 2026-09-17

Reported: iPhone PWA, today's calendar only, intermittent two-direction scrolling freeze, especially near 10pm. Physical-device reproduction is not confirmed; this patch removes the fragile automatic-positioning path identified in the code, not a claim that WebKit's exact failure mechanism was reproduced.

## Changes

- Replaced two delayed scroll writes (50/400ms) with one bounded positioning attempt after data, entry animation and geometry settle.
- No 200ms grace window that can ignore genuine scrolling. Touch, pointer, wheel, keyboard or timeline scroll cancels positioning immediately. The unrelated date-rail auto-scroll does not cancel it.
- Stops on backgrounding, detachment, cleanup, or a five-second readiness deadline. A slow load may skip focus rather than unexpectedly move a user's view later.
- Clamps the scroll target to the actual scrollable range. After the displayed day's closing hour, today's focus remains at the end instead of jumping to morning because the red line is absent.
- Date/view identity guards prevent measuring the outgoing animated view. Responsive changes and data refreshes do not re-arm positioning.
- The red line, bookings, permissions, schedules, and calendar navigation remain unchanged. Day and multi-day timelines share the replacement.

## Verification

Targeted tests cover late-evening bounds, one-write maximum, input cancellation, loading/geometry readiness, backgrounding/detachment, date-rail isolation and day/multi-day wiring. The complete regression suite and production build are the shipping gates.

Device acceptance still needed: on an iPhone home-screen PWA, open today's Day and 3-Day calendar around 9:50pm, 10pm and after 10pm; immediately drag in both directions, repeat after background/resume, compare another date, and repeat with slow loading. A full two-way freeze surviving this change requires inspection of the affected device's touch target, scroll dimensions and overlay state, not more speculative scroll writes.

## Follow-up: fixed 24-hour timeline

The owner reports that freezing still occurs. The initial autofocus mitigation must therefore NOT be treated as a confirmed resolution.

At the owner's request, Day and multi-day timelines now always show 00:00 through the next midnight (24 hour rows). They no longer resize their time range from schedules/bookings or end at the default 10pm boundary. Working-hours and booking-conflict rules are unchanged. Both timeline flex wrappers explicitly allow shrinking within the scroll viewport.

Regression coverage now includes the full-day range, midnight/noon/10pm/11:59pm positioning bounds and user scrolling after late-night autofocus. Autofocus remains a single interruptible positioning attempt; there is no continuous time tracking. This is a range/layout change, not proof that the physical iPhone freeze is resolved. Re-test both scrolling directions after deployment with the full 24-hour grid visible.

## Follow-up: contained viewport and explicit landing policy

- Owner and barber calendar shells are fixed to the dynamic viewport, with mobile top/bottom navigation clearance. Calendar content uses the remaining flex space after banners rather than adding a full-height calendar below them. Other portal pages retain their prior layout.
- Controls and day/barber headings live outside the timeline scroll area. The timeline retains native scrolling and a full 24-hour range; no hard 7am boundary.
- Today opens centred near the shop's current time. Other dates open near 7am, or an earlier active appointment/working-hours start among the displayed staff/dates. The existing scoped hours read now includes weekdays, preserving the current-day schedule map while supplying morning positioning across three days.
- Three-day view is consistently selected day plus the next two days on phone and desktop. If any column is today, the initial position is current time.
- A separate Now button explicitly recentres the timeline. Minute clock updates move the red line, not the scroll position. Initial positioning still stops immediately on user input and does not rearm on refreshed data or clock ticks.
- All 19 flow suites passed, including mocked weekday-hours reads and landing-policy cases. Production build passed (202 pages, CI placeholder environment). The synthetic headless Chromium layout check passed owner/barber, Day/3-Day, phone/desktop, banner/no-banner, two-way scrolling and viewport resizing. Run it after a production build with `node scripts/tests/calendar-layout-check.cjs`.

Physical iPhone PWA acceptance remains outstanding. The browser fixture validates shell geometry, not the full authenticated application or iOS touch/momentum behavior.
