# ClipWise native app (Capacitor) — setup & Tap to Pay runbook

This wraps the **existing** Next.js web app in a native iOS/Android shell. It is
**additive** — the web app, PWA, and Vercel deploy are untouched. The native
shell loads the live `https://clipwise.ca` (see `capacitor.config.ts`) and only
**adds** native capabilities (Stripe Terminal / Tap to Pay) the browser can't reach.

## 🔒 Golden rules (don't break the web app)
- ❌ **Never** add `output: "export"` to `next.config.mjs` — it kills every `/api`
  route + SSR. We deliberately use `server.url` (wrap the hosted site) instead.
- ❌ Don't commit native **build artifacts** (Pods, `.gradle`, `build/`) — already
  in `.gitignore`. **Do** commit the `ios/` and `android/` source folders.
- ❌ Capacitor work stays off `main` until tested — it doesn't need to deploy to
  Vercel. Pull this branch onto your Mac to continue.
- ✅ The web codebase is unchanged. A native build is just `npm install` + the
  steps below.

## Already done in this branch
- Installed `@capacitor/core`, `@capacitor/cli`, `@capacitor/ios`, `@capacitor/android`.
- `capacitor.config.ts` — `appId: ca.clipwise.app`, loads `https://clipwise.ca`,
  `appendUserAgent: "ClipWiseApp"` so web code can detect the app.
- `capacitor-www/index.html` — minimal offline/launch fallback (the `webDir`).
- `npm run cap:sync | cap:ios | cap:android` scripts.

## Generate the native projects (on your Mac — needs Xcode / Android Studio)
```bash
git checkout claude/gallant-euler-7fkw5h   # this branch
npm install                                # pulls Capacitor deps
npx cap add ios
npx cap add android
npx cap sync
npm run cap:ios       # opens Xcode   (or cap:android for Android Studio)
```
First run will load clipwise.ca inside the app. Everything (login, booking, POS,
payments, realtime) works because it's your live site.

### Local dev against `npm run dev`
Temporarily, in `capacitor.config.ts`: set `server.url` to your Mac's LAN IP
(`http://192.168.x.x:3000`) and `cleartext: true`, run `npm run dev`, then
`npx cap sync`. Revert before a release build.

### Detecting the app in web code (to show native-only UI)
```ts
const inApp = typeof navigator !== "undefined" && navigator.userAgent.includes("ClipWiseApp");
```

## Tap to Pay — what's needed (Canada ✅ supported)
1. **Native plugin**: `@capacitor-community/stripe` (includes Terminal / Tap to
   Pay), or a thin custom plugin over Stripe's native Terminal SDK.
2. **Apple**: request the *Tap to Pay on iPhone* entitlement
   (`com.apple.developer.proximity-reader.payment.acceptance`); iPhone XS+ /
   iOS 16.7+; paid Apple Developer account. **Android**: NFC device, Android 11+.
3. **Stripe**: enable Terminal; create a **Location** object per shop; charges
   run on each shop's **connected account** (same Connect model as today).
4. **Backend — ✅ BUILT (on `main`, dormant; nothing on the web calls it).**
   The platform-agnostic routes the native plugin will call. SAME server code
   serves a Bluetooth WisePad 3 AND Tap to Pay — only the native SDK connection
   differs. All auth-gated (owner/barber), require the payments plan + completed
   Connect, charge on the shop's connected account (0% platform fee):
   - `POST /api/stripe/terminal/connection-token` — connection token +
     (best-effort) the shop's Terminal Location id. Location logic in
     `src/lib/terminal.ts` (`ensureTerminalLocation`).
   - `POST /api/stripe/terminal/status` — **readiness gate. Call this FIRST**,
     before showing any reader UI. Returns `{ ready, reason?, location_id? }`.
     `ready:false` reasons: `plan` (no payments plan), `connect_incomplete`,
     `card_payments_pending` (Connect done but the `card_payments` capability
     isn't ACTIVE yet — send them to finish Stripe onboarding, don't let them pair
     a reader that fails at payment).
   - `POST /api/stripe/terminal/create-intent` — card-present PaymentIntent.
     For Canada it sets `payment_method_types:["card_present","interac_present"]`
     (Interac debit is most Canadian cards — without it every debit tap declines)
     and `capture_method:"automatic"` with `card_present.capture_method:
     "manual_preferred"` (credit holds for the no-show deposit flow; Interac is
     single-message / take-now and can't be held). Sale details stamped into PI
     metadata server-side.
   - `POST /api/stripe/terminal/capture` — captures after the reader collects,
     then inserts the SAME `transactions` row POS writes (`payment_method:"card"`,
     `source:"pos"`, real Stripe fee), idempotent on `payment_intent_id`. Shows
     live in Payments + receipts with **zero feed changes**.
   - Migration: `phase41_terminal_location.sql` (adds `shops.stripe_terminal_location_id`).

### WisePad 3 (Bluetooth) reader screen — DRAFT built, finish on-device
A working **draft screen** now ships in the web app (loads inside the native app,
inert in a browser). Files:
- `src/app/dashboard/pos/reader/page.tsx` — the full screen + state machine (gate →
  pair → firmware progress → amount → collect → done/error), backend-wired,
  remembers the last reader, "buy a WisePad 3" link, web fallback.
- `src/lib/terminal-native.ts` — the **native-plugin seam** (reached via the
  Capacitor global bridge, so the web build needs no native package). ⚠️ Every
  plugin method here is marked TODO — confirm names/shapes against the installed
  plugin on the Mac; the backend calls are already correct.
- `src/lib/terminal-client.ts` — typed fetch wrappers for the routes below.

To finish it on-device (needs a Mac + the **simulated reader** first, then the
**physical WisePad 3**):
1. Install a Terminal plugin on this branch (`@capacitor-community/stripe` or a
   custom one over Stripe's native Terminal SDK) that registers as `StripeTerminal`;
   `npx cap sync`.
2. Confirm/adjust the method names in `terminal-native.ts` against that plugin.
3. Add a **native-only entry point** (a "Card reader" button on the POS page or a
   sidebar item, guarded by the `ClipWiseApp` user-agent) linking to
   `/dashboard/pos/reader`.
4. Apple *Tap to Pay* entitlement only if you also want Tap to Pay; the WisePad 3
   itself just needs Bluetooth permission strings.
5. Test the flow, especially the **Canadian offline-PIN** path (simulated Interac +
   offline-PIN test cards, then the physical Interac test card).

The screen calls, in order (all built + test-mode-verified):

1. **Gate** — call `terminal/status`. If not `ready`, show the reason (e.g. "finish
   Stripe setup") instead of the reader UI.
2. **Init SDK** — call `terminal/connection-token` for the token (+ `location_id`).
3. **Connect (step 4)** — scan over Bluetooth, list readers, connect using the
   shop's `locationId`. Remember the last reader so they don't re-pair each shift.
   Handle: reader off / low battery / already connected to another phone.
4. **Firmware (step 5)** — the SDK can push a required update on connect (minutes).
   Show a real progress screen, not a frozen app. Use the SDK's test hooks to
   simulate it.
5. **Take payment (step 6)** — `terminal/create-intent` → collect on the reader via
   the SDK → `terminal/capture`.
6. **Canadian PIN (step 7)** — test the decline-then-offline-PIN flow with the
   simulated Interac + offline-PIN test cards, THEN the physical Interac test card.
   This is the most likely thing to break in a real shop.
   - **Do NOT** build a central `/admin/readers` pool (platform-owned readers is a
     Stripe preview we're not using) and **do NOT** let a shop register a reader
     with their own Stripe keys — the platform mints the token for the shop's
     account (the routes above already do this), keeping charges direct.

### Hardware: the shop buys its own reader
ClipWise does **not** buy, rent, or resell readers — Stripe's Terminal terms bar
renting/reselling without authorized-reseller status. So each shop buys its own
WisePad 3 (or is given one at our cost). The reader screen should link them to buy
one. This is stated in the Terms of Service (§5) and the plan copy
("card reader sold separately").

A Tap to Pay sale is just another card transaction — UI, transactions table,
Payments realtime feed, and receipts all stay identical.

## App Store notes
Apple accepts web-wrapped apps when they add real native value — Tap to Pay
qualifies. Add proper icons/splash, a privacy policy, and the NFC/payments
usage strings before submitting.

## Biometric check-in (Face ID / fingerprint) — native plan
Goal: barbers clock in/out on the SHOP device via biometrics, with the owner
registering each barber. Web can't do biometrics, so this is Capacitor-only.

Where it plugs in: `src/app/dashboard/check-in/page.tsx` already is the shop-side
check-in station (clock any barber in/out + history, writing to `staff_hours`).
The Clock-in / Clock-out buttons are the hook points — wrap them with a native
verify step on Capacitor; keep the plain buttons as the web fallback.

Steps:
1. Plugin: `@aparajita/capacitor-biometric-auth` (or `@capgo/capacitor-native-biometric`).
   `npm i` then `npx cap sync`. iOS: add `NSFaceIDUsageDescription` to Info.plist.
2. A small wrapper `src/lib/biometric.ts`:
   - `isBiometricAvailable()` → false on web (so the page falls back to manual).
   - `enrollBarber(barberId)` → store a credential keyed to the barber (Keychain/
     Keystore via the plugin's `setCredentials`, or a per-barber secret).
   - `verifyBarber(barberId)` → prompt Face ID/fingerprint; resolve true/false.
3. Registration UI: on the check-in page (native only), an "Enroll" action per
   barber that the owner runs once on the shop device.
4. Gate clock-in/out: on native, call `verifyBarber` before the existing
   `clockIn`/`clockOut`; on web, run them directly (current behavior).
Note: device biometrics identify the *device owner*, not arbitrary people — so
"register each barber's face" means per-barber enrolled credentials on the shop
device, verified at check-in. True multi-person face recognition would need a
cloud vision service (out of scope).

### Status — scaffolded (2026-06)
DONE (web-safe, already in the repo):
- Deps: `@aparajita/capacitor-biometric-auth@^9` (Capacitor 6 line) + `@capacitor/app@^6`.
- `src/lib/biometric.ts` — `isBiometricAvailable()` + `verifyBiometric(reason)`,
  both no-op/false off native so the web build + browser fall back to manual.
- `/dashboard/check-in` gates clock-in/out behind `verifyBiometric` when a
  sensor is present, with an owner "Require Face ID / fingerprint" toggle
  (persisted per device). Web is unchanged (manual buttons).

REMAINING for the native app:
- `npx cap sync` after building the web bundle.
- iOS: add `NSFaceIDUsageDescription` to Info.plist (e.g. "Confirm staff check-in").
- Test on a real device (simulator Face ID works too).
