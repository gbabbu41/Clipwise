"use client";

// App-wide error boundary. Any render-time exception in a route segment lands
// here instead of white-screening the whole app. Covers owner, barber, and the
// public booking page. `global-error.tsx` handles errors in the root layout.
import { useEffect } from "react";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[error-boundary]", error);
    // Report to the central error log (CEO panel + Vercel logs). Best-effort.
    try {
      fetch("/api/client-error", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        keepalive: true,
        body: JSON.stringify({
          source: "react-boundary",
          message: error?.message || "Render error",
          stack: error?.stack,
          path: typeof location !== "undefined" ? location.pathname : undefined,
        }),
      }).catch(() => {});
    } catch { /* never let logging break the error screen */ }
  }, [error]);

  return (
    <div className="min-h-[100dvh] bg-black flex items-center justify-center px-6 text-center">
      <div className="max-w-sm">
        <div className="w-16 h-16 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center mx-auto mb-5 text-3xl">⚠️</div>
        <h1 className="text-xl font-bold text-white mb-2">Something went wrong</h1>
        <p className="text-sm text-[#8f8f8f] mb-6">
          This screen hit an unexpected error — it&apos;s been logged. Your data is safe. Try again, and if it keeps happening, let us know.
        </p>
        <div className="flex gap-3 justify-center">
          <button onClick={() => reset()} className="rounded-xl bg-white text-black font-semibold text-sm px-5 py-2.5 hover:bg-[#eaeaea] transition-colors">
            Try again
          </button>
          <a href="/" className="rounded-xl border border-[#2a2a2a] text-white font-semibold text-sm px-5 py-2.5 hover:bg-[#141414] transition-colors">
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}
