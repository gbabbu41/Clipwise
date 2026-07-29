"use client";

// Last-resort boundary for errors thrown by the ROOT layout itself (where
// error.tsx can't help). It must render its own <html>/<body>. Inline styles
// only — globals.css may not be available at this level.
import { useEffect } from "react";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    try {
      fetch("/api/client-error", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        keepalive: true,
        body: JSON.stringify({
          source: "react-global",
          message: error?.message || "Root layout error",
          stack: error?.stack,
          path: typeof location !== "undefined" ? location.pathname : undefined,
        }),
      }).catch(() => {});
    } catch { /* never let logging break the error screen */ }
  }, [error]);

  return (
    <html lang="en">
      <body style={{ margin: 0, background: "#000", color: "#fff", fontFamily: "system-ui, -apple-system, sans-serif" }}>
        <div style={{ minHeight: "100dvh", display: "flex", alignItems: "center", justifyContent: "center", padding: "24px", textAlign: "center" }}>
          <div style={{ maxWidth: "360px" }}>
            <div style={{ fontSize: "40px", marginBottom: "16px" }}>⚠️</div>
            <h1 style={{ fontSize: "20px", fontWeight: 700, margin: "0 0 8px" }}>Something went wrong</h1>
            <p style={{ fontSize: "14px", color: "#8f8f8f", margin: "0 0 24px", lineHeight: 1.5 }}>
              The app hit an unexpected error. Your data is safe — please try again.
            </p>
            <button
              onClick={() => reset()}
              style={{ background: "#fff", color: "#000", fontWeight: 600, fontSize: "14px", padding: "10px 20px", borderRadius: "12px", border: "none", cursor: "pointer" }}
            >
              Try again
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
