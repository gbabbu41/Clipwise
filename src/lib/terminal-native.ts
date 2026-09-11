"use client";

/**
 * Native Stripe Terminal seam for the BBPOS WisePad 3 (Bluetooth) reader.
 *
 * WHERE THIS RUNS: only inside the ClipWise Capacitor app. A browser can't do
 * Bluetooth, so on the web every call no-ops and `isNativeReaderAvailable()` is
 * false (the reader screen shows an "open the app" message instead).
 *
 * HOW IT REACHES NATIVE: through the Capacitor global bridge
 * (`window.Capacitor.Plugins.StripeTerminal`) — deliberately NOT an
 * `import` of the native package, so the WEB build never needs it installed. The
 * native app installs a Stripe Terminal plugin that registers as "StripeTerminal"
 * (either `@capacitor-community/stripe`, or a thin custom plugin over Stripe's
 * native Terminal SDK — the WisePad 3 needs the Bluetooth transport, so confirm
 * the chosen plugin supports it).
 *
 * ⚠️ ON-DEVICE TODO: the method names/shapes below are the EXPECTED plugin API and
 * are isolated here on purpose. Confirm each against the installed plugin version
 * when you build on the Mac — the backend calls (connection-token / create-intent
 * / capture) are correct as-is; only this native seam may need method-name tweaks.
 */

import { getConnectionToken } from "@/lib/terminal-client";

export type DiscoveredReader = { serialNumber: string; label?: string; batteryLevel?: number | null };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Bridge = any;

/** The native plugin, or null on web / when not installed. */
function plugin(): Bridge | null {
  if (typeof window === "undefined") return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cap = (window as any).Capacitor;
  if (!cap?.isNativePlatform?.()) return null; // web / PWA → no Bluetooth
  return cap.Plugins?.StripeTerminal ?? null;
}

/** True only inside the native app with a Terminal plugin present. */
export function isNativeReaderAvailable(): boolean {
  return !!plugin();
}

/**
 * Initialize the Terminal SDK. It needs a connection token from our backend
 * (minted on the shop's connected account). Most plugins take a token-provider
 * callback that they call whenever they need a fresh token.
 */
export async function initTerminal(shopId: string, accessToken: string): Promise<void> {
  const T = plugin();
  if (!T) throw new Error("A card reader needs the ClipWise app.");
  // ⚠️ Confirm init + token-provider API. Two common shapes:
  //   (a) T.initialize({ tokenProviderEndpoint }) — plugin fetches the token itself.
  //   (b) T.initialize() + listen for 'requestConnectionToken', then setConnectionToken.
  // We use (b) so the token is always minted server-side on the shop's account.
  await T.initialize?.({});
  T.addListener?.("requestConnectionToken", async () => {
    const { secret } = await getConnectionToken(shopId, accessToken);
    await T.setConnectionToken?.({ token: secret });
  });
}

/** Scan for nearby WisePad 3 readers over Bluetooth. */
export async function discoverReaders(): Promise<DiscoveredReader[]> {
  const T = plugin();
  if (!T) return [];
  // ⚠️ Confirm the discover method + the Bluetooth discovery-type constant.
  const res = await T.discoverReaders?.({ discoveryMethod: "bluetoothScan", simulated: false });
  // Normalize to our shape (plugins vary: reader.serialNumber / serial_number).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (res?.readers ?? []).map((r: any) => ({
    serialNumber: r.serialNumber ?? r.serial_number ?? r.serial ?? "",
    label: r.label ?? r.deviceType ?? undefined,
    batteryLevel: r.batteryLevel ?? null,
  }));
}

/** Connect to a specific reader, registering it to the shop's Location. */
export async function connectReader(serialNumber: string, locationId: string | null): Promise<void> {
  const T = plugin();
  if (!T) throw new Error("A card reader needs the ClipWise app.");
  // ⚠️ Confirm connect method + params (some plugins take the reader object, not the serial).
  await T.connectReader?.({ serialNumber, locationId: locationId ?? undefined });
}

/** Subscribe to firmware-update progress (0–100). Returns an unsubscribe fn.
 *  The SDK can push a required update on connect that takes a few minutes. */
export function onFirmwareUpdateProgress(cb: (percent: number) => void): () => void {
  const T = plugin();
  if (!T?.addListener) return () => {};
  // ⚠️ Confirm the event name + payload field.
  const handle = T.addListener("readerSoftwareUpdateProgress", (e: { progress?: number }) => {
    cb(Math.round((e?.progress ?? 0) * 100));
  });
  return () => { try { handle?.remove?.(); } catch { /* ignore */ } };
}

/** Collect + confirm a card-present payment on the connected reader for an
 *  already-created PaymentIntent (client secret from /terminal/create-intent).
 *  Handles the tap/insert AND the Canadian offline-PIN prompt inside the SDK. */
export async function collectPayment(clientSecret: string): Promise<{ status: string }> {
  const T = plugin();
  if (!T) throw new Error("A card reader needs the ClipWise app.");
  // ⚠️ Confirm the collect/confirm sequence. Typical: collectPaymentMethod → confirm.
  await T.collectPaymentMethod?.({ paymentIntentClientSecret: clientSecret });
  const res = await T.confirmPaymentIntent?.({ paymentIntentClientSecret: clientSecret });
  return { status: res?.status ?? "unknown" };
}

/** Disconnect the reader (e.g. end of shift). */
export async function disconnectReader(): Promise<void> {
  const T = plugin();
  if (!T) return;
  await T.disconnectReader?.().catch?.(() => null);
}

// ── Remember the last reader so staff don't re-pair every shift ──
const LAST_READER_KEY = "cw_last_reader_serial";
export function rememberReader(serial: string): void {
  try { localStorage.setItem(LAST_READER_KEY, serial); } catch { /* ignore */ }
}
export function lastReaderSerial(): string | null {
  try { return localStorage.getItem(LAST_READER_KEY); } catch { return null; }
}
