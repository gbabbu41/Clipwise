"use client";
import { useEffect, useRef, useState, useCallback } from "react";
import { Bell, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/lib/supabase";

interface Popup { id: string; title: string; message: string; type: string }

const ICON: Record<string, string> = {
  booking: "🎉", cancellation: "❌", "no-show": "⚠️", review: "⭐", inventory: "📦", system: "🔔",
};

/**
 * Live in-portal notification pop-ups with a chime. Subscribes to new rows in
 * the `notifications` table for the signed-in user (owner OR barber) and, on
 * each insert, slides in a toast top-right and plays a short two-tone sound.
 * Mounted once per portal layout (dashboard + barber-dashboard).
 *
 * The sound uses the Web Audio API (no asset file). Browsers suspend audio
 * until the first user gesture, so we resume the context on the first click/key.
 */
export function NotificationListener() {
  const { user } = useAuth();
  const router = useRouter();
  const [popups, setPopups] = useState<Popup[]>([]);
  const audioCtxRef = useRef<AudioContext | null>(null);

  // Lazily create + unlock the AudioContext on first user interaction.
  useEffect(() => {
    const unlock = () => {
      if (!audioCtxRef.current) {
        const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        if (Ctx) audioCtxRef.current = new Ctx();
      }
      audioCtxRef.current?.resume().catch(() => {});
    };
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, []);

  const chime = useCallback(() => {
    const ctx = audioCtxRef.current;
    if (!ctx) return;
    try {
      const now = ctx.currentTime;
      // Two quick rising notes — a friendly "ding-dong".
      [880, 1180].forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.value = freq;
        const t = now + i * 0.14;
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.exponentialRampToValueAtTime(0.25, t + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.32);
        osc.connect(gain).connect(ctx.destination);
        osc.start(t);
        osc.stop(t + 0.34);
      });
    } catch { /* audio not available — silently skip */ }
  }, []);

  const dismiss = useCallback((id: string) => {
    setPopups(prev => prev.filter(p => p.id !== id));
  }, []);

  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel(`notif-popup:${user.id}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${user.id}` },
        (payload) => {
          const n = payload.new as Popup;
          setPopups(prev => [...prev, { id: n.id, title: n.title, message: n.message, type: n.type }].slice(-4));
          chime();
          // Auto-dismiss after 7s.
          setTimeout(() => dismiss(n.id), 7000);
        },
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user, chime, dismiss]);

  if (popups.length === 0) return null;

  return (
    <div className="fixed top-4 right-4 z-[200] flex flex-col gap-2 w-[calc(100%-2rem)] max-w-sm pointer-events-none">
      {popups.map(p => (
        <button
          key={p.id}
          type="button"
          onClick={() => { dismiss(p.id); router.push("/dashboard/notifications"); }}
          className="pointer-events-auto text-left flex items-start gap-3 bg-[#0c0c0c] border border-gold/40 rounded-2xl p-4 shadow-2xl animate-slide-up ring-1 ring-gold/10 hover:border-gold transition-colors"
        >
          <span className="text-xl leading-none mt-0.5">{ICON[p.type] ?? "🔔"}</span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-white flex items-center gap-1.5">
              <Bell size={13} className="text-gold" /> {p.title}
            </p>
            <p className="text-xs text-[#aaa] mt-0.5 line-clamp-2">{p.message}</p>
          </div>
          <span
            onClick={(e) => { e.stopPropagation(); dismiss(p.id); }}
            className="text-[#777] hover:text-white flex-shrink-0"
            aria-label="Dismiss"
          >
            <X size={15} />
          </span>
        </button>
      ))}
    </div>
  );
}
