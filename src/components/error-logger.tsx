"use client";
import { useEffect } from "react";

/**
 * Forwards UNCAUGHT browser errors to /api/client-error so they land in the
 * server logs (engineering) + the CEO error panel. This is what would have made
 * the dashboard "blank screen" instantly visible instead of needing a console
 * paste. Mounted once at the root so it catches errors on every page, including
 * chunk-load / module-eval crashes that React error boundaries can't catch.
 *
 * Safety: dedupes identical errors, caps how many it sends per page load (a
 * looping error can't flood), sends only the pathname (never query strings), and
 * never lets logging itself throw.
 */
export function ErrorLogger() {
  useEffect(() => {
    const seen = new Set<string>();
    let sent = 0;
    const MAX = 20;

    const report = (source: string, message: string, stack?: string) => {
      if (!message || message === "Script error." || sent >= MAX) return;
      const key = (message + (stack ?? "")).slice(0, 200);
      if (seen.has(key)) return;
      seen.add(key);
      sent++;
      try {
        fetch("/api/client-error", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          keepalive: true, // still sends if the page is unloading/navigating
          body: JSON.stringify({
            source,
            message: String(message).slice(0, 1000),
            stack: stack ? String(stack).slice(0, 6000) : undefined,
            path: typeof location !== "undefined" ? location.pathname : undefined,
          }),
        }).catch(() => {});
      } catch { /* never let logging break the page */ }
    };

    const onError = (e: ErrorEvent) =>
      report("window", e.message || "Uncaught error", e.error?.stack);
    const onRejection = (e: PromiseRejectionEvent) => {
      const r = e.reason as { message?: string; stack?: string } | undefined;
      report("unhandledrejection", r?.message || String(r ?? "Unhandled promise rejection"), r?.stack);
    };

    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  return null;
}
