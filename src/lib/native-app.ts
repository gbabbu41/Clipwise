/**
 * Single source of truth for "am I running inside the ClipWise native app?"
 *
 * The native app is a Capacitor WebView loading clipwise.ca, so it identifies
 * itself two ways (capacitor.config.ts sets `appendUserAgent: "ClipWiseApp"`):
 *   • Client: Capacitor's own platform check if the bridge is present, else the
 *     ClipWiseApp user-agent tag.
 *   • Server: the same tag on the request User-Agent — the WebView appends it to
 *     EVERY request, including /api fetches — so routes can refuse billing there.
 *
 * WHY: Apple requires digital subscriptions sold in an app to use In-App Purchase.
 * We don't — so the app must have NO ClipWise-subscription billing surface at all
 * (pricing, plans, upgrade/subscribe, the trial "add a card" banner, Stripe
 * checkout/billing-portal, signup). Barbers subscribe on clipwise.ca and just log
 * in on the app. NOTE: the barber's OWN money (service prices, POS, Terminal card
 * payments, revenue) MUST stay visible — that's real-world commerce, outside IAP.
 */

/** Client-side: is this running inside the native app? SSR-safe (false on server). */
export function isNativeApp(): boolean {
  if (typeof window === "undefined") return false;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cap = (window as any).Capacitor;
  if (cap && typeof cap.isNativePlatform === "function" && cap.isNativePlatform()) return true;
  return typeof navigator !== "undefined" && navigator.userAgent.includes("ClipWiseApp");
}

/** Does this User-Agent string belong to the native app? (SSR/server helper.) */
export function isNativeUserAgent(ua: string | null | undefined): boolean {
  return (ua ?? "").includes("ClipWiseApp");
}

/** Server-side: is this request coming from the native app? (User-Agent tag). */
export function isNativeRequest(req: { headers: { get(name: string): string | null } }): boolean {
  return isNativeUserAgent(req.headers.get("user-agent"));
}
