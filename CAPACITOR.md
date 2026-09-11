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
4. **Backend (build when starting Tap to Pay — platform-agnostic, reused by the
   plugin):**
   - `POST /api/stripe/terminal/connection-token` — Terminal connection token on
     the connected account.
   - card-present **PaymentIntent** create + capture
     (`payment_method_types: ["card_present"]`), then insert the SAME
     `transactions` row POS writes today (`payment_method: "card"`) so it shows
     live in Payments + receipts with **zero feed changes**.

A Tap to Pay sale is just another card transaction — UI, transactions table,
Payments realtime feed, and receipts all stay identical.

## App Store notes
Apple accepts web-wrapped apps when they add real native value — Tap to Pay
qualifies. Add proper icons/splash, a privacy policy, and the NFC/payments
usage strings before submitting.

## Codemagic → TestFlight (no Mac needed)
`codemagic.yaml` (repo root) builds the iOS app on Codemagic's Mac and ships it to
TestFlight — you never touch a Mac. It's a **scaffold** (written without a Mac to
test it), so expect a small tweak or two on the first run.

### One-time setup (do this AFTER buying the Apple Developer account — ~$99/yr)
1. **Apple Developer Program** — enrol at developer.apple.com ($99/yr). Required.
2. **Register the app id** — App Store Connect → Certificates, Identifiers &
   Profiles → Identifiers → add `ca.clipwise.app` (matches `capacitor.config.ts`).
3. **Create the app record** — App Store Connect → Apps → New App → bundle id
   `ca.clipwise.app`. Note the numeric **App ID**.
4. **App Store Connect API key** — App Store Connect → Users and Access → Integrations
   → App Store Connect API → generate a key (Admin/App Manager). Download the `.p8`,
   note the **Key ID** + **Issuer ID**.
5. **Codemagic** — sign up (free tier ≈ 500 Mac build-min/month), connect this
   GitHub repo + branch `claude/gallant-euler-7fkw5h`. Team settings → Integrations
   → **App Store Connect**: add the API key and name it **"ClipWise ASC Key"** (must
   match `integrations.app_store_connect` in `codemagic.yaml`, or change both).
6. In the workflow's env vars, set **`APP_STORE_APP_ID`** = the numeric App ID from
   step 3. Codemagic auto-manages the signing cert + provisioning profile from the
   API key (no certs to juggle).
7. **Run** the `ios-testflight` workflow. When it goes green, the build appears in
   **TestFlight** → install it on your iPhone from the TestFlight app.

### Then: turn on the card reader (the WisePad 3 screen already exists on `main`)
The reader screen ships from the live site (`/dashboard/pos/reader`), so it's
already in the app. To make it actually pair:
1. Install the Terminal plugin **matching your Capacitor major** (v6 here):
   `npm i @capacitor-community/stripe@^6` (or a custom plugin over Stripe's native
   Terminal SDK — confirm it supports the WisePad 3 Bluetooth transport), then
   `npx cap sync`. Commit the updated `package.json` + lock on this branch.
2. Confirm the plugin method names in `src/lib/terminal-native.ts` (each is TODO-
   flagged) against the installed plugin.
3. Add a native-only entry point to reach the screen — a "Card reader" button on
   the POS page or a sidebar item, shown only when
   `navigator.userAgent.includes("ClipWiseApp")` — linking to `/dashboard/pos/reader`.
4. Rebuild via Codemagic → TestFlight, then test on your iPhone with the **simulated
   reader** first, then the physical **WisePad 3** + the **Interac offline-PIN** test
   card. Iterate: edit → push → new TestFlight build.

Note: `codemagic.yaml` deliberately does NOT add the Terminal plugin yet, so the
first build (just the app + all web features) is a clean, known-good Capacitor
build. Add the plugin in step 1 above once the pipeline works end to end.
