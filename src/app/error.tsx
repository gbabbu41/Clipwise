"use client";

// App-wide error boundary. Any render-time exception in a route segment lands
// here instead of white-screening the whole app. Covers owner, barber, and the
// public booking page. `global-error.tsx` handles errors in the root layout.
import { useEffect } from "react";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // Stale-deploy recovery: a ChunkLoadError means the tab is holding HTML that
    // points at JS chunks a newer Vercel deploy already removed (classic "tab open
    // across a deploy" — it was silently losing bookings on the public page). Force
    // ONE reload to pull the fresh build; a sessionStorage guard stops a loop.
    const msg = error?.message || "";
    const isChunkError = error?.name === "ChunkLoadError"
      || /Loading chunk [\w-]+ failed|ChunkLoadError|Failed to fetch dynamically imported module|error loading dynamically imported module/i.test(msg);
    if (isChunkError && typeof window !== "undefined") {
      try {
        if (!sessionStorage.getItem("cw_chunk_reloaded")) {
          sessionStorage.setItem("cw_chunk_reloaded", "1");
          window.location.reload();
          return; // reloading — skip the error screen + the log below
        }
      } catch { /* storage blocked — fall through to the normal error screen */ }
    }
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
