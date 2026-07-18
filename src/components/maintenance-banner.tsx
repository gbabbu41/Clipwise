"use client";
import { useEffect, useState } from "react";
import { Wrench } from "lucide-react";

// Thin banner shown across dashboards when the admin flips on maintenance mode.
// Reads the public /api/platform/status (no auth, non-sensitive) and self-hides
// when maintenance is off or the endpoint is unreachable.
export function MaintenanceBanner() {
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/platform/status")
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (cancelled || !d?.maintenance_mode) return;
        setMsg(d.maintenance_message?.trim() || "Scheduled maintenance in progress — some features may be briefly unavailable.");
      })
      .catch(() => null);
    return () => { cancelled = true; };
  }, []);

  if (!msg) return null;
  return (
    <div className="bg-orange-500/15 border-b border-orange-500/30 text-orange-300 text-sm px-4 py-2.5 flex items-center justify-center gap-2 text-center">
      <Wrench size={14} className="flex-shrink-0" />
      <span>{msg}</span>
    </div>
  );
}
