"use client";
import { useEffect, useRef, useState, useCallback } from "react";
import { Bell, X } from "lucide-react";
import { useRouter, usePathname } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/lib/supabase";
import { isNotifSoundOn } from "@/lib/notif-sound";
import { notifBelongsToShop } from "@/lib/notify";

interface Popup { id: string; title: string; message: string; type: string }

const ICON: Record<string, string> = {
  booking: "🎉", cancellation: "❌", "no-show": "⚠️", review: "⭐", inventory: "📦", system: "🔔",
};

// Tap a pop-up → land on the page where you can actually act on it, routed by
// what it's about AND which portal we're in. Owners approve bookings on the
// Appointments page; barbers approve from their Calendar. The old behaviour
// always pushed "/dashboard/notifications" — a dead end (no inline approve) and
// the wrong portal for barbers, which is why "Approve" felt like it went nowhere.
function popupHref(n: Popup, isBarber: boolean): string {
  const s = `${n.title} ${n.message}`.toLowerCase();
  if (isBarber) {
    if (/payment|charged|collected|refund|card.?hold|authoriz|\bpaid\b|failed/.test(s)) return "/barber-dashboard/earnings";
    if (n.type === "booking" || n.type === "cancellation" || n.type === "no-show" || /book(ed|ing)|appointment|waitlist/.test(s)) return "/barber-dashboard/calendar";
    return "/barber-dashboard/notifications";
  }
  if (/waitlist|waiting for a spot/.test(s)) return "/dashboard/waitlist-requests";
  if (/payment|charged|collected|refund|card.?hold|authoriz|\bpaid\b|failed/.test(s)) return "/dashboard/payments";
  if (/block|hours|time.?off|vacation|day off/.test(s)) return "/dashboard/calendar";
  if (n.type === "review" || /review/.test(s)) return "/dashboard/reviews";
  if (n.type === "inventory" || /inventory|stock/.test(s)) return "/dashboard/inventory";
  if (n.type === "booking" || n.type === "cancellation" || n.type === "no-show" || /book(ed|ing)|appointment/.test(s)) return "/dashboard/calendar";
  return "/dashboard/notifications";
}

/**
 * Live in-portal notification pop-ups with a chime. Subscribes to new rows in
 * the `notifications` table for the signed-in user (owner OR barber) and, on
 * each insert, slides in a toast top-right and plays a short two-tone sound.
 * Mounted once per portal layout (dashboard + barber-dashboard).
 *
 * The sound uses the Web Audio API (no asset file). Browsers suspend audio
 * until the first user gesture, so we resume the context on the first click/key.
 */
export function NotificationListener({ shopId }: { shopId?: string | null } = {}) {
  const { user, shop } = useAuth();
  // In the barber portal a barber can work at multiple shops, so the active shop
  // comes from BarberContext and is passed in as `shopId`. Owners render this
  // with no prop → fall back to the auth-context shop. (`undefined` = not passed;
  // `null` = passed but no shop selected yet.)
  const activeShopId = shopId === undefined ? (shop?.id ?? null) : shopId;
  const router = useRouter();
  const pathname = usePathname();
  const isBarber = !!pathname?.startsWith("/barber-dashboard");
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
    if (!isNotifSoundOn()) return; // user muted the sound in Settings
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
          const n = payload.new as Popup & { shop_id?: string | null };
          // Only pop + chime for the shop the user is currently viewing (or a
          // legacy null-shop row) — not the owner's other shops.
          if (!notifBelongsToShop(n, activeShopId ?? undefined)) return;
          setPopups(prev => [...prev, { id: n.id, title: n.title, message: n.message, type: n.type }].slice(-4));
          chime();
          // Auto-dismiss after 7s.
          setTimeout(() => dismiss(n.id), 7000);
        },
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user, activeShopId, chime, dismiss]);

  if (popups.length === 0) return null;

  return (
    <div
      className="fixed z-[200] flex flex-col gap-2 max-w-sm pointer-events-none"
      style={{
        top: "calc(env(safe-area-inset-top, 0px) + 0.75rem)",
        right: "calc(env(safe-area-inset-right, 0px) + 0.75rem)",
        left: "auto",
        width: "calc(100% - env(safe-area-inset-left, 0px) - env(safe-area-inset-right, 0px) - 1.5rem)",
      }}
    >
      {popups.map(p => (
        <button
          key={p.id}
          type="button"
          onClick={() => { dismiss(p.id); router.push(popupHref(p, isBarber)); }}
          className="pointer-events-auto text-left flex items-start gap-3 bg-card border border-gold/40 rounded-2xl p-4 shadow-2xl animate-slide-up ring-1 ring-gold/10 hover:border-gold transition-colors"
        >
          <span className="text-xl leading-none mt-0.5">{ICON[p.type] ?? "🔔"}</span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-foreground flex items-center gap-1.5">
              <Bell size={13} className="text-gold" /> {p.title}
            </p>
            <p className="text-xs text-grey mt-0.5 line-clamp-2">{p.message}</p>
          </div>
          <span
            onClick={(e) => { e.stopPropagation(); dismiss(p.id); }}
            className="text-grey hover:text-foreground flex-shrink-0"
            aria-label="Dismiss"
          >
            <X size={15} />
          </span>
        </button>
      ))}
    </div>
  );
}
