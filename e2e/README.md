# ClipWise E2E tests

Live end-to-end smoke + flow tests for the owner portal, barber portal,
appointments, and calendar. Uses the already-installed `playwright` library and a
real Chromium — no extra dependencies.

## What it covers
- Public pages load with no JS errors (home, /login, /admin/login)
- **Owner:** login → dashboard → appointments → calendar → schedule render
- **Admin:** overview reachable (if the account is super_admin)
- **Barber:** login → barber dashboard → calendar/schedule render
- **Booking loop** (optional): public booking page → (driven live) owner sees it
- Console/page JS errors are captured per page and fail the run

## Configure (env vars — never commit credentials)
```
E2E_BASE_URL=https://clipwise.ca         # or a preview URL
E2E_OWNER_EMAIL=...   E2E_OWNER_PASSWORD=...     # throwaway shop-owner test account
E2E_BARBER_EMAIL=...  E2E_BARBER_PASSWORD=...    # throwaway barber test account (optional)
E2E_SHOP_SLUG=your-shop-slug             # optional: enables the booking loop
E2E_HEADLESS=0                           # optional: watch it run in a headed browser
```
Any block whose env vars are missing is **skipped**, not failed.

## Run
```
node e2e/clipwise-e2e.mjs
```
Exit code is non-zero if any check fails. Screenshots are written to
`e2e/screenshots/` (git-ignored).

## Notes
- Runs against whatever DB the deployment points at. Safe pre-launch; don't run
  against a production DB with real customers.
- The full booking→approve→cancel loop is driven interactively in the test
  session (selectors depend on the live DOM) and cleans up the row it creates.
