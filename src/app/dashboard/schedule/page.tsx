"use client";

import { useEffect, useState } from "react";
import { CalendarRange, Check, AlertTriangle } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/lib/supabase";
import { ScheduleEditor } from "@/components/schedule-editor";
import { cn } from "@/lib/utils";

type Barber = { id: string; name: string };

export default function SchedulePage() {
  const { shop, accessToken } = useAuth();
  const [barbers, setBarbers] = useState<Barber[]>([]);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    if (!shop) return;
    supabase.from("barbers").select("id, name").eq("shop_id", shop.id).eq("is_active", true).order("name")
      .then(({ data }) => {
        const list = (data ?? []) as Barber[];
        setBarbers(list);
        setSelected(prev => prev ?? list[0]?.id ?? null);
      });
  }, [shop]);

  const current = barbers.find(b => b.id === selected);

  return (
    <div className="p-4 sm:p-6 max-w-2xl mx-auto pb-28">
      <div className="mb-4">
        <h1 className="text-2xl font-bold text-white uppercase tracking-wide">Schedule</h1>
        <p className="text-sm text-[#777] mt-0.5">Set working hours, breaks &amp; lunch — each barber gets emailed their schedule.</p>
      </div>

      {barbers.length === 0 ? (
        <p className="text-sm text-[#777] py-12 text-center">No barbers yet. Add staff first.</p>
      ) : (
        <>
          {/* Barber picker first */}
          <div className="flex gap-2 overflow-x-auto pb-1 mb-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {barbers.map(b => (
              <button key={b.id} onClick={() => setSelected(b.id)}
                className={cn("flex-shrink-0 px-3.5 py-2 rounded-xl text-sm font-medium border transition-colors",
                  selected === b.id ? "bg-white text-black border-white" : "border-[#1e1e1e] bg-[#0c0c0c] text-[#aaa] hover:text-white")}>
                {b.name}
              </button>
            ))}
          </div>

          {current && <ScheduleEditor key={current.id} barberId={current.id} barberName={current.name} accessToken={accessToken} isOwner headerAction={<PauseBookingsToggle />} />}

          {/* Shop-wide setting at the bottom */}
          <div className="mt-4 pt-4 border-t border-[#161616]">
            <BookingWindowCard />
          </div>
        </>
      )}
    </div>
  );
}

// Emergency kill switch in the Weekly Schedule header — turning ON requires a
// confirmation; turning OFF (resume) is immediate.
function PauseBookingsToggle() {
  const { shop, refreshShop } = useAuth();
  const paused = !!(shop?.booking_settings as { bookings_paused?: boolean } | null)?.bookings_paused;
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);

  const setPaused = async (next: boolean) => {
    if (!shop || busy) return;
    setBusy(true);
    const merged = { ...((shop.booking_settings as Record<string, unknown>) ?? {}), bookings_paused: next };
    const { error } = await supabase.from("shops").update({ booking_settings: merged }).eq("id", shop.id);
    if (!error) await refreshShop();
    setBusy(false);
    setConfirm(false);
  };

  const onClick = () => { if (paused) setPaused(false); else setConfirm(true); };

  return (
    <>
      <button onClick={onClick} disabled={busy} aria-label="Pause bookings"
        className="flex flex-col items-end gap-1 flex-shrink-0 disabled:opacity-50">
        <span className="text-[11px] font-semibold text-amber-400">Pause bookings</span>
        <span className={cn("relative w-11 h-6 rounded-full transition-colors", paused ? "bg-amber-500" : "bg-[#2a2a2a]")}>
          <span className={cn("absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all", paused ? "left-[22px]" : "left-0.5")} />
        </span>
      </button>

      {confirm && (
        <>
          <div className="fixed inset-0 bg-black/70 z-[150]" onClick={() => setConfirm(false)} />
          <div className="fixed inset-0 z-[160] flex items-center justify-center p-4 overflow-y-auto overscroll-contain [&>*]:my-auto">
            <div className="bg-black shadow-sm border border-amber-500/40 rounded-2xl p-5 w-full max-w-sm space-y-4">
              <div className="flex items-center gap-2">
                <AlertTriangle size={18} className="text-amber-400 flex-shrink-0" />
                <h2 className="text-base font-bold text-white">Pause all bookings?</h2>
              </div>
              <p className="text-sm text-[#aaa]">Customers won&apos;t be able to book online until you turn this back on. Your existing appointments stay.</p>
              <div className="flex gap-2">
                <button onClick={() => setConfirm(false)} className="flex-1 rounded-xl border border-[#1e1e1e] bg-[#141414] text-[#aaa] hover:text-white text-sm font-medium py-2.5">Cancel</button>
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
  const current = Number((shop?.booking_settings as { advance_days?: number } | null)?.advance_days ?? 30);
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
    <div className="rounded-2xl border border-[#1e1e1e] bg-[#0c0c0c] p-4">
      <div className="flex items-center gap-2">
        <CalendarRange size={16} className="text-amber-400" />
        <span className="font-semibold text-white">Booking window</span>
      </div>
      <p className="text-xs text-[#666] mt-1">How far ahead customers can book online.</p>
      <div className="mt-3 flex items-center gap-2">
        <input type="number" min={1} max={365} value={days}
          onChange={e => setDays(Math.max(1, Math.min(365, Number(e.target.value) || 0)))}
          className="w-20 rounded-lg bg-[#141414] border border-[#1e1e1e] text-white text-sm px-3 py-2 focus:outline-none focus:border-white" />
        <span className="text-sm text-[#aaa]">days in advance</span>
        <button onClick={save} disabled={!dirty || saving}
          className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-white text-black font-semibold text-xs px-3 py-2 hover:bg-[#eaeaea] disabled:opacity-40 transition-colors">
          {saving ? "Saving…" : saved ? <><Check size={13} /> Saved</> : "Save"}
        </button>
      </div>
    </div>
  );
}
