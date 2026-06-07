"use client";
import { useEffect, useState } from "react";
import { Bell, BellOff } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { isNotifSoundOn, setNotifSound } from "@/lib/notif-sound";

/**
 * Drop-in row letting staff mute/unmute the in-portal notification chime.
 * Preference is per-device (localStorage). Used in owner Settings + barber
 * Profile. Self-contained — no parent wiring needed.
 */
export function NotifSoundToggle() {
  const [on, setOn] = useState(true);
  // Read the stored value after mount (localStorage is client-only).
  useEffect(() => { setOn(isNotifSoundOn()); }, []);

  const toggle = () => {
    const next = !on;
    setOn(next);
    setNotifSound(next);
  };

  return (
    <div className="flex items-center justify-between gap-4 p-4 rounded-2xl border border-[#1e1e1e] bg-[#0c0c0c]">
      <div className="flex items-center gap-3 min-w-0">
        <div className="w-10 h-10 rounded-xl bg-[#141414] flex items-center justify-center flex-shrink-0">
          {on ? <Bell size={18} className="text-gold" /> : <BellOff size={18} className="text-[#777]" />}
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-white">Notification sound</p>
          <p className="text-xs text-[#777]">
            {on ? "Plays a chime when a new booking or alert arrives." : "Muted on this device."}
          </p>
        </div>
      </div>
      <Switch checked={on} onChange={toggle} />
    </div>
  );
}
