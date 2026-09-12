import { headers } from "next/headers";
import { isNativeUserAgent } from "@/lib/native-app";
import DashboardLayoutClient from "./layout-client";

/**
 * Server wrapper for the owner dashboard. Its only job is to resolve "is this the
 * native app?" on the SERVER, from the request User-Agent (the Capacitor WebView
 * appends `ClipWiseApp` to every request), and hand it down to the client layout.
 *
 * Why: the trial "add a card" banner is the #1 Apple-IAP rejection risk. Passing
 * `native` from here means the banner knows it's in the app at SSR time and can
 * never be server-rendered there — its safety no longer depends on the client
 * loading-spinner gating. Reading headers() makes this segment dynamic, which the
 * authed dashboard already is, so there's no caching/perf change. The public web
 * is untouched: on a browser the UA has no tag, so `native` is false everywhere.
 */
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const native = isNativeUserAgent(headers().get("user-agent"));
  return <DashboardLayoutClient native={native}>{children}</DashboardLayoutClient>;
}
