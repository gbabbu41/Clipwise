"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { CalendarRange, Check, AlertTriangle, Power } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/lib/supabase";
import { ScheduleEditor } from "@/components/schedule-editor";
import { DashboardHeader } from "@/components/dashboard/page-header";
import { cn } from "@/lib/utils";

type Barber = { id: string; name: string; bookings_paused?: boolean };

export default function SchedulePage() {
  const { shop, accessToken } = useAuth();
  const [barbers, setBarbers] = useState<Barber[]>([]);
  const [selected, setSelected] = useState<string | null>(null);

  // Warm a barber's /api/schedule (serverless lambda + DB) so opening/switching
  // to them lands instantly. Deduped; best-effort.
  const warmed = useRef<Set<string>>(new Set());
  const warm = useCallback((id: string) => {
    if (!accessToken || warmed.current.has(id)) return;
    warmed.current.add(id);
    fetch(`/api/schedule?barber_id=${id}`, { headers: { Authorization: `Bearer ${accessToken}` } }).catch(() => {});
  }, [accessToken]);

  const loadBarbers = useCallback(() => {
    if (!shop) return;
    // select("*") so the optional bookings_paused column is included without
    // erroring on shops that haven't run the phase15 migration yet.
    supabase.from("barbers").select("*").eq("shop_id", shop.id).eq("is_active", true).order("name")
      .then(({ data }) => {
        const list = (data ?? []) as Barber[];
        setBarbers(list);
        setSelected(prev => prev ?? list[0]?.id ?? null);
        // Warm every barber's schedule shortly after load so switching is snappy
        // (covers phones too, where there's no hover to prefetch on).
        setTimeout(() => list.forEach(b => warm(b.id)), 600);
      });
  }, [shop, warm]);
  useEffect(() => { loadBarbers(); }, [loadBarbers]);

  const current = barbers.find(b => b.id === selected);

  // Horizontal padding only — <DashboardHeader> owns the top spacing so it's
  // consistent with every other page that uses it.
  return (
    <div className="px-4 lg:px-8 max-w-2xl mx-auto pb-28">
      <DashboardHeader title="Schedule" subtitle="Set working hours, breaks & lunch — each barber gets emailed their schedule." />

      {barbers.length === 0 ? (
        <p className="text-sm text-[#8f8f8f] py-12 text-center">No barbers yet. Add staff first.</p>
      ) : (
        <>
          {/* Barber picker first */}
          <div className="flex gap-2 overflow-x-auto pb-1 mb-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {barbers.map(b => (
              <button key={b.id} onClick={() => setSelected(b.id)} onPointerEnter={() => warm(b.id)}
                className={cn("flex-shrink-0 px-3.5 py-2 rounded-xl text-sm font-medium border transition-colors",
                  selected === b.id ? "bg-white text-black border-white" : "border-[#2a2a2a] bg-[#0c0c0c] text-[#aaa] hover:text-white")}>
                {b.name}
              </button>
            ))}
          </div>

          {current && <ScheduleEditor key={current.id} barberId={current.id} barberName={current.name} accessToken={accessToken} isOwner isPaused={!!current.bookings_paused} headerAction={<PauseBookingsToggle barberId={current.id} barberName={current.name} paused={!!current.bookings_paused} onChanged={loadBarbers} />} />}

          {/* Shop-wide setting at the bottom */}
          <div className="mt-4 pt-4 border-t border-[#161616]">
            <BookingWindowCard />
          </div>
        </>
      )}
    </div>
  );
}

// Per-barber pause switch in the Weekly Schedule header — pausing ONE barber's
// online bookings (the rest of the shop stays bookable). Turning ON asks for a
// confirmation; turning OFF (resume) is immediate.
function PauseBookingsToggle({ barberId, barberName, paused, onChanged }: { barberId: string; barberName: string; paused: boolean; onChanged: () => void }) {
  const first = barberName.split(" ")[0] || "this barber";
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [err, setErr] = useState("");

  const setPaused = async (next: boolean) => {
    if (busy) return;
    setBusy(true);
    const { error } = await supabase.from("barbers").update({ bookings_paused: next }).eq("id", barberId);
    setBusy(false);
    setConfirm(false);
    if (error) {
      // Surface the real reason instead of failing silently — most likely the
      // phase15 `bookings_paused` column hasn't been added yet.
      const msg = /bookings_paused/.test(error.message)
        ? "Run the phase15 migration first (barbers.bookings_paused column is missing)."
        : (error.message || "Couldn't update — try again.");
      setErr(msg);
      setTimeout(() => setErr(""), 6000);
      return;
    }
    onChanged();
  };

  const onClick = () => { if (paused) setPaused(false); else setConfirm(true); };

  return (
    <>
      {err && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-[200] max-w-[90vw] bg-red-900/90 border border-red-500/40 text-red-100 text-xs font-medium rounded-xl px-4 py-2.5 shadow-xl">
          {err}
        </div>
      )}
      <div className="flex items-center gap-2">
        {/* Status badge — reads booking_settings.bookings_paused, the SAME flag
            the customer booking page + in-person/Stripe checkout routes check
            before accepting a booking. So "Live" genuinely means customers can
            book the same slots; "Paused" means they're blocked. One source of
            truth, no separate state to drift. */}
        <span className={cn("inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-full",
          paused ? "bg-red-500/15 text-red-400" : "bg-[#00e5a0]/15 text-[#00e5a0]")}>
          <span className={cn("w-1.5 h-1.5 rounded-full", paused ? "bg-red-400" : "bg-[#00e5a0] animate-pulse")} />
          {paused ? "Paused" : "Live"}
        </span>
        <button onClick={onClick} disabled={busy} aria-label={paused ? "Resume bookings" : "Pause bookings"}
          title={paused ? "Bookings paused — tap to resume" : "Bookings live — tap to pause"}
          className={cn("w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 transition-colors disabled:opacity-50",
            paused ? "bg-red-500/20 text-red-400" : "bg-[#00e5a0]/15 text-[#00e5a0] hover:bg-[#00e5a0]/25")}>
          <Power size={18} />
        </button>
      </div>

      {confirm && (
        <>
          <div className="fixed inset-0 bg-black/70 z-[150]" onClick={() => setConfirm(false)} />
          <div className="fixed inset-0 z-[160] flex items-center justify-center p-4 overflow-y-auto overscroll-contain [&>*]:my-auto">
            <div className="bg-black shadow-sm border border-amber-500/40 rounded-2xl p-5 w-full max-w-sm space-y-4">
              <div className="flex items-center gap-2">
                <AlertTriangle size={18} className="text-amber-400 flex-shrink-0" />
                <h2 className="text-base font-bold text-white">Pause {first}&apos;s bookings?</h2>
              </div>
              <p className="text-sm text-[#aaa]">Customers won&apos;t be able to book <span className="text-white">{first}</span> online until you turn this back on. Other barbers stay bookable, and existing appointments are kept.</p>
              <div className="flex gap-2">
                <button onClick={() => setConfirm(false)} className="flex-1 rounded-xl border border-[#2a2a2a] bg-[#141414] text-[#aaa] hover:text-white text-sm font-medium py-2.5">Cancel</button>
                <button onClick={() => setPaused(true)} disabled={busy} className="flex-1 rounded-xl bg-amber-500 text-black font-semibold text-sm py-2.5 hover:bg-amber-400 disabled:opacity-50">{busy ? "Pausing…" : "Pause bookings"}</button>
              </div>
            </div>
          </div>
        </>
      )}
    </>
  );
}

// Surface + edit the customer booking window (shops.booking_settings.advance_days).
function BookingWindowCard() {
  const { shop, refreshShop } = useAuth();
  const current = Number((shop?.booking_settings as { advance_days?: number } | null)?.advance_days ?? 15);
  const [days, setDays] = useState(current);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => { setDays(current); }, [current]);

  const dirty = days !== current && days > 0;
  const save = async () => {
    if (!shop || !dirty) return;
    setSaving(true);
    const merged = { ...((shop.booking_settings as Record<string, unknown>) ?? {}), advance_days: days };
    const { error } = await supabase.from("shops").update({ booking_settings: merged }).eq("id", shop.id);
    setSaving(false);
    if (!error) { await refreshShop(); setSaved(true); setTimeout(() => setSaved(false), 2500); }
  };

  return (
    <div className="rounded-2xl border border-[#2a2a2a] bg-[#0c0c0c] p-4">
      <div className="flex items-center gap-2">
        <CalendarRange size={16} className="text-amber-400" />
        <span className="font-semibold text-white">Booking window</span>
      </div>
      <p className="text-xs text-[#666] mt-1">How far ahead customers can book online.</p>
      <div className="mt-3 flex items-center gap-2">
        <input type="number" min={1} max={60} value={days}
          onChange={e => setDays(Math.max(1, Math.min(60, Number(e.target.value) || 0)))}
          className="w-20 rounded-lg bg-[#141414] border border-[#2a2a2a] text-white text-sm px-3 py-2 focus:outline-none focus:border-white" />
        <span className="text-sm text-[#aaa]">days in advance</span>
        <button onClick={save} disabled={!dirty || saving}
          className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-white text-black font-semibold text-xs px-3 py-2 hover:bg-[#eaeaea] disabled:opacity-40 transition-colors">
          {saving ? "Saving…" : saved ? <><Check size={13} /> Saved</> : "Save"}
        </button>
      </div>
    </div>
  );
}
