"use client";
import { useEffect, useState, useCallback } from "react";
import { Fingerprint, LogIn, LogOut, Clock } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/lib/supabase";
import { cn, formatDateForDb } from "@/lib/utils";
import { isBiometricAvailable, verifyBiometric } from "@/lib/biometric";
import { AvatarImage } from "@/components/ui/avatar-image";

type Barber = { id: string; name: string; photo?: string | null };
type Hours = { id: string; barber_id: string; date: string; clock_in: string; clock_out: string | null; hours_worked: number | null };

/**
 * Shop-side check-in station. Barbers no longer self-clock from their phone —
 * the shop clocks the team in/out here (owner RLS on staff_hours allows it),
 * with a recent history below. The Clock-in / Clock-out buttons are where the
 * native Face ID / fingerprint verification will wrap (Capacitor) — see
 * CAPACITOR.md. On the web these are plain manual buttons.
 */
export default function CheckInPage() {
  const { shop } = useAuth();
  const [barbers, setBarbers] = useState<Barber[]>([]);
  const [openByBarber, setOpenByBarber] = useState<Record<string, Hours>>({});
  const [history, setHistory] = useState<Hours[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState("");
  const showToast = (m: string) => { setToast(m); setTimeout(() => setToast(""), 2500); };

  // Biometric gate (native app only). On web `bioAvailable` stays false → the
  // buttons clock directly. `bioRequired` is the owner's per-device toggle.
  const [bioAvailable, setBioAvailable] = useState(false);
  const [bioRequired, setBioRequired] = useState(true);
  useEffect(() => {
    isBiometricAvailable().then(setBioAvailable);
    try { const v = localStorage.getItem("cw_checkin_biometric"); if (v !== null) setBioRequired(v === "1"); } catch { /* ignore */ }
  }, []);
  const setBioRequiredPersist = (on: boolean) => {
    setBioRequired(on);
    try { localStorage.setItem("cw_checkin_biometric", on ? "1" : "0"); } catch { /* ignore */ }
  };
  // Confirm with Face ID / fingerprint when enabled; on web this is a no-op pass.
  const confirmBiometric = async (reason: string) => {
    if (!bioAvailable || !bioRequired) return true;
    const ok = await verifyBiometric(reason);
    if (!ok) showToast("Biometric check failed");
    return ok;
  };

  const todayStr = formatDateForDb(new Date());

  const load = useCallback(async () => {
    if (!shop?.id) { setLoading(false); return; }
    setLoading(true);
    const [{ data: b }, { data: open }, { data: hist }] = await Promise.all([
      supabase.from("barbers").select("id, name, photo").eq("shop_id", shop.id).eq("is_active", true).order("name"),
      supabase.from("staff_hours").select("id, barber_id, date, clock_in, clock_out, hours_worked")
        .eq("shop_id", shop.id).eq("date", todayStr).is("clock_out", null),
      supabase.from("staff_hours").select("id, barber_id, date, clock_in, clock_out, hours_worked")
        .eq("shop_id", shop.id).order("date", { ascending: false }).order("clock_in", { ascending: false }).limit(40),
    ]);
    setBarbers((b ?? []) as Barber[]);
    const map: Record<string, Hours> = {};
    (open ?? []).forEach((r) => { map[(r as Hours).barber_id] = r as Hours; });
    setOpenByBarber(map);
    setHistory((hist ?? []) as Hours[]);
    setLoading(false);
  }, [shop?.id, todayStr]);
  useEffect(() => { load(); }, [load]);

  const nameOf = (id: string) => barbers.find(b => b.id === id)?.name ?? "Barber";

  const clockIn = async (barberId: string) => {
    if (!shop?.id || busy) return;
    if (!(await confirmBiometric(`Confirm clock-in for ${nameOf(barberId)}`))) return;
    setBusy(barberId);
    const now = new Date();
    await supabase.from("staff_hours").insert({ barber_id: barberId, shop_id: shop.id, date: formatDateForDb(now), clock_in: now.toTimeString().slice(0, 5) });
    setBusy(null);
    showToast(`${nameOf(barberId)} clocked in`);
    load();
  };
  const clockOut = async (row: Hours) => {
    if (busy) return;
    if (!(await confirmBiometric(`Confirm clock-out for ${nameOf(row.barber_id)}`))) return;
    setBusy(row.barber_id);
    const now = new Date();
    const outStr = now.toTimeString().slice(0, 5);
    const [inH, inM] = row.clock_in.split(":").map(Number);
    const hours = Math.round(((now.getHours() * 60 + now.getMinutes()) - (inH * 60 + inM)) / 60 * 100) / 100;
    await supabase.from("staff_hours").update({ clock_out: outStr, hours_worked: hours }).eq("id", row.id);
    setBusy(null);
    showToast(`${nameOf(row.barber_id)} clocked out · ${hours}h`);
    load();
  };

  return (
    <div className="p-4 sm:p-6 max-w-3xl mx-auto pb-28 space-y-6">
      {toast && (
        <div className="fixed bottom-24 lg:bottom-6 right-4 z-[100] bg-[#141414] border border-[#1e1e1e] rounded-xl px-5 py-3 text-sm text-white shadow-xl">
          <span className="text-[#00e5a0]">✓</span> {toast}
        </div>
      )}

      <div>
        <h1 className="text-2xl font-bold text-white uppercase tracking-wide">Check-in</h1>
        <p className="text-sm text-[#777] mt-0.5">Clock your team in and out, and review their history.</p>
      </div>

      {bioAvailable ? (
        <label className="flex items-center gap-3 rounded-xl border border-[#1e1e1e] bg-[#0c0c0c] p-3 cursor-pointer">
          <Fingerprint size={18} className="text-[#00e5a0] flex-shrink-0" />
          <span className="flex-1 text-xs text-[#ccc]">Require Face ID / fingerprint to clock staff in and out on this device.</span>
          <input type="checkbox" checked={bioRequired} onChange={e => setBioRequiredPersist(e.target.checked)} className="form-check-input" />
        </label>
      ) : (
        <div className="flex items-start gap-3 rounded-xl border border-[#1e1e1e] bg-[#0c0c0c] p-3">
          <Fingerprint size={18} className="text-[#00e5a0] flex-shrink-0 mt-0.5" />
          <p className="text-xs text-[#999]">Face ID / fingerprint check-in works on the ClipWise app. On the web you clock staff in and out manually here.</p>
        </div>
      )}

      {loading ? (
        <div className="space-y-2">{[1, 2, 3].map(i => <div key={i} className="h-16 rounded-xl bg-[#0c0c0c] border border-[#1e1e1e] animate-pulse" />)}</div>
      ) : barbers.length === 0 ? (
        <div className="rounded-2xl border border-[#1e1e1e] bg-[#0c0c0c] p-10 text-center text-[#777] text-sm">No active staff yet. Add staff first.</div>
      ) : (
        <div className="space-y-2">
          {barbers.map(b => {
            const open = openByBarber[b.id];
            return (
              <div key={b.id} className="flex items-center gap-3 rounded-xl border border-[#1e1e1e] bg-[#0c0c0c] p-3">
                <div className="w-10 h-10 rounded-full bg-[#141414] text-white font-bold flex items-center justify-center flex-shrink-0 overflow-hidden">
                  <AvatarImage src={b.photo} alt={b.name} className="w-full h-full object-cover" fallback={<>{b.name.charAt(0).toUpperCase()}</>} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-white truncate">{b.name}</p>
                  <p className={cn("text-xs mt-0.5", open ? "text-emerald-400" : "text-[#777]")}>
                    {open ? `● Clocked in ${open.clock_in}` : "Not clocked in"}
                  </p>
                </div>
                {open ? (
                  <button disabled={busy === b.id} onClick={() => clockOut(open)}
                    className="flex items-center gap-1.5 rounded-lg bg-rose-500/15 text-rose-300 border border-rose-500/30 text-xs font-semibold px-3 py-2 disabled:opacity-50 transition-colors">
                    <LogOut size={14} /> Clock out
                  </button>
                ) : (
                  <button disabled={busy === b.id} onClick={() => clockIn(b.id)}
                    className="flex items-center gap-1.5 rounded-lg bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 text-xs font-semibold px-3 py-2 disabled:opacity-50 transition-colors">
                    <LogIn size={14} /> Clock in
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div>
        <div className="flex items-center gap-2 mb-2"><Clock size={15} className="text-[#777]" /><h2 className="text-sm font-bold text-white">Recent check-in history</h2></div>
        {history.length === 0 ? (
          <div className="rounded-2xl border border-[#1e1e1e] bg-[#0c0c0c] p-8 text-center text-[#777] text-sm">No check-in records yet</div>
        ) : (
          <div className="rounded-2xl border border-[#1e1e1e] bg-[#0c0c0c] overflow-hidden divide-y divide-[#1a1a1a]">
            {history.map(h => (
              <div key={h.id} className="flex items-center gap-3 px-4 py-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-white truncate">{nameOf(h.barber_id)}</p>
                  <p className="text-xs text-[#777]">{h.date}</p>
                </div>
                <div className="text-right text-xs">
                  <p><span className="text-emerald-400">{h.clock_in}</span> <span className="text-[#555]">→</span> <span className="text-rose-400">{h.clock_out ?? "—"}</span></p>
                  <p className="text-[#777] mt-0.5">{h.clock_out ? `${h.hours_worked ?? 0}h` : "Clocked in"}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
