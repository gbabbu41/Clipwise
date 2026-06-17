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
