"use client";

import { useEffect, useState, useCallback } from "react";
import { Plus, X, Check, Copy } from "lucide-react";
import { cn, dbTimeToDisplay, displayTimeToDb, timeToMinutes } from "@/lib/utils";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const ORDER = [1, 2, 3, 4, 5, 6, 0]; // Mon-first display order
const BAR_START = 6 * 60;   // 6 AM
const BAR_END = 23 * 60;    // 11 PM
const SPAN = BAR_END - BAR_START;

// 15-min time options as display strings ("9:00 AM").
const TIME_OPTIONS = (() => {
  const out: string[] = [];
  for (let m = 5 * 60; m <= 23 * 60 + 45; m += 15) {
    out.push(dbTimeToDisplay(`${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}:00`));
  }
  return out;
})();

type Brk = { start: string; end: string; label: string };
type Day = { isOpen: boolean; start: string; end: string; breaks: Brk[] };

const defaultDays = (): Day[] =>
  DAYS.map((_, dow) => ({ isOpen: dow >= 1 && dow <= 5, start: "9:00 AM", end: "7:00 PM", breaks: [] }));

const pct = (display: string) => {
  const m = timeToMinutes(display);
  return Math.max(0, Math.min(100, ((m - BAR_START) / SPAN) * 100));
};

export function ScheduleEditor({ barberId, barberName, accessToken, canEdit = true }: { barberId: string; barberName: string; accessToken: string | null; canEdit?: boolean }) {
  const [days, setDays] = useState<Day[]>(defaultDays);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState("");
  const showToast = (m: string) => { setToast(m); setTimeout(() => setToast(""), 3000); };

  const load = useCallback(async () => {
    if (!barberId || !accessToken) return;
    setLoading(true);
    const res = await fetch(`/api/schedule?barber_id=${barberId}`, { headers: { Authorization: `Bearer ${accessToken}` } });
    const data = await res.json().catch(() => null);
    const next = defaultDays();
    if (data && !data.error) {
      // Working hours
      const hadSlots = (data.slots ?? []).length > 0;
      if (hadSlots) next.forEach((d, dow) => { d.isOpen = false; }); // start from actual data
      (data.slots ?? []).forEach((s: { day_of_week: number; start_time: string; end_time: string; is_available: boolean }) => {
        const d = next[s.day_of_week];
        if (d) { d.isOpen = !!s.is_available; d.start = dbTimeToDisplay(s.start_time); d.end = dbTimeToDisplay(s.end_time); }
      });
      (data.breaks ?? []).forEach((b: { day_of_week: number; start_time: string; end_time: string; label: string | null }) => {
        const d = next[b.day_of_week];
        if (d) d.breaks.push({ start: dbTimeToDisplay(b.start_time), end: dbTimeToDisplay(b.end_time), label: b.label || "Break" });
      });
    }
    setDays(next);
    setLoading(false);
  }, [barberId, accessToken]);
  useEffect(() => { load(); }, [load]);

  const setDay = (dow: number, patch: Partial<Day>) => setDays(p => p.map((d, i) => i === dow ? { ...d, ...patch } : d));
  const setBreak = (dow: number, idx: number, patch: Partial<Brk>) =>
    setDays(p => p.map((d, i) => i === dow ? { ...d, breaks: d.breaks.map((b, j) => j === idx ? { ...b, ...patch } : b) } : d));
  const addBreak = (dow: number) =>
    setDays(p => p.map((d, i) => i === dow ? { ...d, breaks: [...d.breaks, { start: "12:00 PM", end: "1:00 PM", label: "Lunch" }] } : d));
  const removeBreak = (dow: number, idx: number) =>
    setDays(p => p.map((d, i) => i === dow ? { ...d, breaks: d.breaks.filter((_, j) => j !== idx) } : d));

  // Copy the first open day's hours + breaks to every other open day.
  const copyToAll = () => {
    const src = ORDER.map(dow => days[dow]).find(d => d.isOpen);
    if (!src) { showToast("Open a day first"); return; }
    setDays(p => p.map(d => d.isOpen ? { ...d, start: src.start, end: src.end, breaks: src.breaks.map(b => ({ ...b })) } : d));
    showToast("Copied to all open days");
  };
  const setWeekdays = () =>
    setDays(p => p.map((d, dow) => ({ ...d, isOpen: dow >= 1 && dow <= 5, start: "9:00 AM", end: "7:00 PM" })));

  const save = async () => {
    if (!accessToken) return;
    // Validate end > start and breaks within hours.
    for (const dow of ORDER) {
      const d = days[dow];
      if (!d.isOpen) continue;
      if (timeToMinutes(d.end) <= timeToMinutes(d.start)) { showToast(`${DAYS[dow]}: end time must be after start`); return; }
      for (const b of d.breaks) {
        if (timeToMinutes(b.end) <= timeToMinutes(b.start)) { showToast(`${DAYS[dow]}: a break's end must be after its start`); return; }
        if (timeToMinutes(b.start) < timeToMinutes(d.start) || timeToMinutes(b.end) > timeToMinutes(d.end)) { showToast(`${DAYS[dow]}: breaks must be within working hours`); return; }
      }
    }
    setSaving(true);
    const res = await fetch("/api/schedule", {
      method: "POST", headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        barber_id: barberId,
        days: days.map((d, dow) => ({ day_of_week: dow, is_open: d.isOpen, start_time: displayTimeToDb(d.start), end_time: displayTimeToDb(d.end) })),
        breaks: days.flatMap((d, dow) => d.isOpen ? d.breaks.map(b => ({ day_of_week: dow, start_time: displayTimeToDb(b.start), end_time: displayTimeToDb(b.end), label: b.label })) : []),
      }),
    });
    setSaving(false);
    if (res.ok) showToast(`Schedule saved · emailed ${barberName.split(" ")[0]}`);
    else { const d = await res.json().catch(() => ({})); showToast(d.error ?? "Couldn't save"); }
  };

  if (loading) return <div className="py-16 text-center text-[#777] text-sm">Loading schedule…</div>;

  return (
    <div className="space-y-3">
      {/* Quick actions */}
      {canEdit && <div className="flex flex-wrap gap-2">
        <button onClick={setWeekdays} className="inline-flex items-center gap-1.5 rounded-lg border border-[#1e1e1e] bg-[#141414] text-[#aaa] hover:text-white text-xs font-medium px-3 py-1.5">
          Mon–Fri 9–7
        </button>
        <button onClick={copyToAll} className="inline-flex items-center gap-1.5 rounded-lg border border-[#1e1e1e] bg-[#141414] text-[#aaa] hover:text-white text-xs font-medium px-3 py-1.5">
          <Copy size={13} /> Copy first day to all
        </button>
      </div>}

      <div className={cn("space-y-3", !canEdit && "pointer-events-none opacity-80")}>
      {ORDER.map(dow => {
        const d = days[dow];
        return (
          <div key={dow} className="rounded-2xl border border-[#1e1e1e] bg-[#0c0c0c] p-4">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-white">{DAYS[dow]}</span>
              <button onClick={() => setDay(dow, { isOpen: !d.isOpen })}
                className={cn("relative w-11 h-6 rounded-full transition-colors", d.isOpen ? "bg-emerald-500" : "bg-[#2a2a2a]")}
                aria-label="Toggle open">
                <span className={cn("absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all", d.isOpen ? "left-[22px]" : "left-0.5")} />
              </button>
            </div>

            {!d.isOpen ? (
              <p className="text-xs text-[#666] mt-2">Closed</p>
            ) : (
              <div className="mt-3 space-y-3">
                {/* Visual timeline bar */}
                <div className="relative h-2.5 rounded-full bg-[#1a1a1a] overflow-hidden">
                  <div className="absolute inset-y-0 bg-emerald-500/70" style={{ left: `${pct(d.start)}%`, right: `${100 - pct(d.end)}%` }} />
                  {d.breaks.map((b, i) => (
                    <div key={i} className="absolute inset-y-0 bg-amber-500" style={{ left: `${pct(b.start)}%`, right: `${100 - pct(b.end)}%` }} />
                  ))}
                </div>
                {/* Working hours */}
                <div className="flex items-center gap-2 text-sm">
                  <TimeSelect value={d.start} onChange={v => setDay(dow, { start: v })} className="flex-1 min-w-0" />
                  <span className="text-[#666] flex-shrink-0">to</span>
                  <TimeSelect value={d.end} onChange={v => setDay(dow, { end: v })} className="flex-1 min-w-0" />
                </div>
                {/* Breaks */}
                {d.breaks.map((b, i) => (
                  <div key={i} className="rounded-lg border border-[#1e1e1e] bg-[#0f0f0f] p-2 space-y-2">
                    <div className="flex items-center gap-2">
                      <input value={b.label} onChange={e => setBreak(dow, i, { label: e.target.value })} placeholder="Lunch"
                        className="flex-1 min-w-0 rounded-lg bg-[#141414] border border-[#1e1e1e] text-amber-400 text-xs px-2 py-1.5 focus:outline-none focus:border-amber-500/50" />
                      <button onClick={() => removeBreak(dow, i)} className="flex-shrink-0 w-7 h-7 rounded-lg border border-[#1e1e1e] text-[#777] hover:text-white flex items-center justify-center"><X size={14} /></button>
                    </div>
                    <div className="flex items-center gap-2">
                      <TimeSelect value={b.start} onChange={v => setBreak(dow, i, { start: v })} small className="flex-1 min-w-0" />
                      <span className="text-[#666] flex-shrink-0">–</span>
                      <TimeSelect value={b.end} onChange={v => setBreak(dow, i, { end: v })} small className="flex-1 min-w-0" />
                    </div>
                  </div>
                ))}
                <button onClick={() => addBreak(dow)} className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-400 hover:text-amber-300">
                  <Plus size={14} /> Add break / lunch
                </button>
              </div>
            )}
          </div>
        );
      })}
      </div>

      {canEdit ? (
        <button onClick={save} disabled={saving}
          className="w-full rounded-xl bg-white text-black font-semibold text-sm py-3 hover:bg-[#eaeaea] disabled:opacity-50 transition-colors inline-flex items-center justify-center gap-2">
          {saving ? "Saving…" : <><Check size={16} /> Save schedule</>}
        </button>
      ) : (
        <p className="text-xs text-[#777] text-center py-1">Read-only — your shop owner manages your hours.</p>
      )}

      {toast && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-[200] bg-[#141414] border border-[#1e1e1e] rounded-xl px-4 py-2.5 text-sm text-white shadow-xl">{toast}</div>
      )}
    </div>
  );
}

function TimeSelect({ value, onChange, small, className }: { value: string; onChange: (v: string) => void; small?: boolean; className?: string }) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)}
      className={cn("rounded-lg bg-[#141414] border border-[#1e1e1e] text-white focus:outline-none focus:border-white",
        small ? "text-xs px-2 py-1.5" : "text-sm px-3 py-2 font-medium", className)}>
      {TIME_OPTIONS.map(t => <option key={t} value={t} className="bg-[#141414]">{t}</option>)}
    </select>
  );
}
