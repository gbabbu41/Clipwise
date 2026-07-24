"use client";

// Global offline banner. Rendered once in the root layout, so every page —
// owner, barber, and the public booking page — shows it when the device drops
// its connection. The service worker only rescues full-page navigations; this
// catches the in-app (SPA) case where data loads/saves would otherwise fail
// silently into empty states.
import { useEffect, useState } from "react";

export function OfflineBanner() {
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    const update = () => setOffline(typeof navigator !== "undefined" && !navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  if (!offline) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed top-0 left-0 right-0 z-[300] bg-amber-500 text-black text-xs sm:text-sm font-semibold text-center px-4 pb-1.5 pt-[max(0.375rem,env(safe-area-inset-top))]"
    >
      ⚠ You&apos;re offline — some things won&apos;t load or save until you reconnect.
    </div>
  );
}
