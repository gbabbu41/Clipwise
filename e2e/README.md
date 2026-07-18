# ClipWise E2E tests

Live end-to-end smoke + flow tests for the owner portal, barber portal,
appointments, and calendar. Uses the already-installed `playwright` library and a
real Chromium — no extra dependencies.

## What it covers
- Public pages load with no JS errors (home, `/login`, `/admin/login`)
- **Owner:** login → dashboard → appointments → calendar → schedule render
- **Admin:** overview reachable (if the account is super_admin)
- **Barber:** barber-dashboard + calendar render (works for a dedicated barber
  account _or_ an owner who is also a barber)
- **Public booking page** renders
- **Appointment lifecycle:** a pending appointment is **Approved → Checked out /
  Completed** from the owner UI, shown to **appear on the calendar**, and the live
  availability API is confirmed to **block double-booking** its slot
- Console/page JS errors are captured per page and fail the run (proxy/CDN
  network noise from the test egress is filtered out so it can't mask real errors)

## Configure (env vars — never commit credentials)
```
E2E_BASE_URL=https://clipwise.ca                 # or a preview URL
E2E_OWNER_EMAIL=...   E2E_OWNER_PASSWORD=...      # throwaway shop-owner account
E2E_BARBER_EMAIL=...  E2E_BARBER_PASSWORD=...     # barber account (optional; may reuse the owner if it's also a barber)
E2E_SHOP_SLUG=your-shop-slug                      # the shop's public booking slug
E2E_HEADLESS=0                                    # optional: watch it run headed
```
Any block whose env vars are missing is **skipped**, not failed.

### Appointment lifecycle inputs
The lifecycle drives a **pending** appointment through Approve → Complete. A
customer can only reach `pending` via the public wizard, but on shops that take
payment **online only** (no pay-in-person) that path goes through Stripe Checkout,
which can't be driven headless. So the pending row is supplied one of two ways:

- **Self-seed (fully self-contained):** the suite inserts the pending row with a
  service-role key and deletes it in a `finally` block.
  ```
  E2E_SUPABASE_URL=...        E2E_SUPABASE_SERVICE_KEY=...   # service role
  E2E_LC_BARBER_ID=...        E2E_LC_SERVICE_ID=...
  E2E_LC_DATE=YYYY-MM-DD      E2E_LC_SLOT="6:30 PM"          # a slot the wizard offers that day
  E2E_LC_DAYNUM=18                                           # day-of-month of E2E_LC_DATE
  ```
- **External seed:** insert a pending appointment yourself, then point the suite
  at it (you own cleanup):
  ```
  E2E_LC_CLIENT="E2E Test 180001"   # its client_name
  E2E_LC_SLOT="6:30 PM"   E2E_LC_DAYNUM=18
  ```
If neither is provided the lifecycle block is skipped.

## Run
```
node e2e/clipwise-e2e.mjs
```
Exit code is non-zero if any check fails. Screenshots are written to
`e2e/screenshots/` (git-ignored).

## Notes
- Runs against whatever DB the deployment points at. Safe pre-launch; **don't run
  against a production DB with real customers.**
- Test rows are tagged `E2E Test <marker>` / `e2e-<marker>@clipwise.test` so they
  are trivially found and removed. Self-seed mode cleans up automatically.
- Chromium is launched with `--ssl-version-max=tls1.2`: the default TLS 1.3
  ClientHello is reset by some egress proxies on CONNECT tunnels
  (`ERR_CONNECTION_RESET`). TLS 1.2 negotiates cleanly with the proxy CA already
  trusted — no certificate verification is disabled.
- `/login` has two submit buttons (a Google OAuth button above the form and the
  real "Sign In" inside it); the suite scopes its click to `form button[type=submit]`.
