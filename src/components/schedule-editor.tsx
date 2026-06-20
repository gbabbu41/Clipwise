"use client";

import { useEffect, useState, useCallback } from "react";
import { Plus, X, Check, Copy, CalendarOff } from "lucide-react";
import { cn, dbTimeToDisplay, displayTimeToDb, timeToMinutes, prettyDate } from "@/lib/utils";

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
type TimeOff = { id: string; type: string; start_date: string; end_date: string; reason: string | null; status: string };

const TIMEOFF_TYPES: { value: string; label: string }[] = [
  { value: "day_off", label: "Day Off" },
  { value: "vacation", label: "Vacation" },
  { value: "sick", label: "Sick Day" },
  { value: "blocked_hours", label: "Blocked Hours" },
];
const TIMEOFF_LABEL = (t: string) => TIMEOFF_TYPES.find(x => x.value === t)?.label ?? "Time Off";
const todayISO = () => new Date().toISOString().slice(0, 10);

const defaultDays = (): Day[] =>
  DAYS.map((_, dow) => ({ isOpen: dow >= 1 && dow <= 5, start: "9:00 AM", end: "7:00 PM", breaks: [] }));

const pct = (display: string) => {
  const m = timeToMinutes(display);
  return Math.max(0, Math.min(100, ((m - BAR_START) / SPAN) * 100));
};

export function ScheduleEditor({ barberId, barberName, accessToken, canEdit = true, isOwner = false }: { barberId: string; barberName: string; accessToken: string | null; canEdit?: boolean; isOwner?: boolean }) {
  const [days, setDays] = useState<Day[]>(defaultDays);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState("");
  const showToast = (m: string) => { setToast(m); setTimeout(() => setToast(""), 3000); };

  // ── Time off ────────────────────────────────────────────────────────────
  const [timeOff, setTimeOff] = useState<TimeOff[]>([]);
  const [showOffForm, setShowOffForm] = useState(false);
  const [offBusy, setOffBusy] = useState(false);
  const blankOff = () => ({ type: "day_off", start_date: todayISO(), end_date: todayISO(), start_time: "12:00 PM", end_time: "1:00 PM", reason: "" });
  const [offForm, setOffForm] = useState(blankOff);

  const load = useCallback(async () => {
    if (!barberId || !accessToken) return;
    setLoading(true);
    const res = await fetch(`/api/schedule?barber_id=${barberId}`, { headers: { Authorization: `Bearer ${accessToken}` } });
    const data = await res.json().catch(() => null);
    let next = defaultDays();
    if (data && !data.error) {
      // Authoritative data loaded → reflect EXACTLY what's saved: start every day
      // closed, then open the ones that have a saved slot. (Don't fall back to the
      // Mon–Fri default when 0 slots, or turning every day off looks reverted.)
      next = DAYS.map(() => ({ isOpen: false, start: "9:00 AM", end: "7:00 PM", breaks: [] as Brk[] }));
      (data.slots ?? []).forEach((s: { day_of_week: number; start_time: string; end_time: string; is_available: boolean }) => {
        const d = next[s.day_of_week];
        if (d) { d.isOpen = !!s.is_available; d.start = dbTimeToDisplay(s.start_time); d.end = dbTimeToDisplay(s.end_time); }
      });
      (data.breaks ?? []).forEach((b: { day_of_week: number; start_time: string; end_time: string; label: string | null }) => {
        const d = next[b.day_of_week];
        if (d) d.breaks.push({ start: dbTimeToDisplay(b.start_time), end: dbTimeToDisplay(b.end_time), label: b.label || "Break" });
      });
      setTimeOff((data.timeOff ?? []) as TimeOff[]);
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
    if (res.ok) {
      const d = await res.json().catch(() => ({}));
      if (d?.breaksError) showToast("Hours saved, but breaks didn't save — run the barber_breaks migration.");
      else showToast(`Schedule saved · emailed ${barberName.split(" ")[0]}`);
    } else { const d = await res.json().catch(() => ({})); showToast(d.error ?? "Couldn't save"); }
  };

  const addTimeOff = async () => {
    if (!accessToken) return;
    if (offForm.end_date < offForm.start_date) { showToast("End date can't be before start date"); return; }
    if (offForm.type === "blocked_hours" && timeToMinutes(offForm.end_time) <= timeToMinutes(offForm.start_time)) {
      showToast("Block end must be after start"); return;
    }
    setOffBusy(true);
    const res = await fetch("/api/schedule/time-off", {
      method: "POST", headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        barber_id: barberId,
        type: offForm.type,
        start_date: offForm.start_date,
        end_date: offForm.end_date,
        start_time: offForm.type === "blocked_hours" ? displayTimeToDb(offForm.start_time) : null,
        end_time: offForm.type === "blocked_hours" ? displayTimeToDb(offForm.end_time) : null,
        reason: offForm.reason || null,
      }),
    });
    setOffBusy(false);
    if (res.ok) {
      const d = await res.json().catch(() => ({}));
      // Replace state with the server's authoritative list (handles merges /
      // dedupes / deletes) so the UI never drifts from the DB.
      if (Array.isArray(d.timeOff)) setTimeOff(d.timeOff as TimeOff[]);
      else if (d.request) setTimeOff(p => [...p, d.request].sort((a, b) => a.start_date.localeCompare(b.start_date)));
      setShowOffForm(false); setOffForm(blankOff());
      const msg = d.action === "duplicate" ? "Those days are already off"
        : d.action === "merged" ? "Merged into your existing time off"
          : isOwner ? "Time off added" : "Time-off request sent for approval";
      showToast(msg);
    } else { const d = await res.json().catch(() => ({})); showToast(d.error ?? "Couldn't save time off"); }
  };

  const cancelTimeOff = async (id: string) => {
    if (!accessToken) return;
    setTimeOff(p => p.filter(t => t.id !== id));
    await fetch(`/api/schedule/time-off?id=${id}&barber_id=${barberId}`, {
      method: "DELETE", headers: { Authorization: `Bearer ${accessToken}` },
    }).catch(() => {});
  };

  if (loading) return <div className="py-16 text-center text-[#777] text-sm">Loading schedule…</div>;

  return (
    <div className="space-y-3">
      {/* ── Time off (kept up top so it's easy to reach) ─────────────────── */}
      <div className="rounded-2xl border border-[#1e1e1e] bg-[#0c0c0c] p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CalendarOff size={16} className="text-amber-400" />
            <span className="font-semibold text-white">Time Off</span>
          </div>
          <button onClick={() => setShowOffForm(v => !v)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[#1e1e1e] bg-[#141414] text-[#aaa] hover:text-white text-xs font-medium px-3 py-1.5">
            <Plus size={13} /> {isOwner ? "Add time off" : "Request"}
          </button>
        </div>
        <p className="text-xs text-[#666] mt-1">
          {isOwner ? "Block off vacation, days off or specific hours — applied instantly." : "Request a day off or vacation — your owner approves it."}
        </p>

        {/* Add / request form */}
        {showOffForm && (
          <div className="mt-3 rounded-xl border border-[#1e1e1e] bg-[#0f0f0f] p-3 space-y-2.5">
            <select value={offForm.type} onChange={e => setOffForm(f => ({ ...f, type: e.target.value }))}
              className="w-full rounded-lg bg-[#141414] border border-[#1e1e1e] text-white text-sm px-3 py-2 focus:outline-none focus:border-white">
              {TIMEOFF_TYPES.map(t => <option key={t.value} value={t.value} className="bg-[#141414]">{t.label}</option>)}
            </select>
            <div className="flex items-center gap-2 text-sm">
              <input type="date" value={offForm.start_date} min={todayISO()} style={{ colorScheme: "dark" }}
                onChange={e => setOffForm(f => ({ ...f, start_date: e.target.value, end_date: f.end_date < e.target.value ? e.target.value : f.end_date }))}
                className="flex-1 min-w-0 rounded-lg bg-[#141414] border border-[#1e1e1e] text-white px-3 py-2 focus:outline-none focus:border-white" />
              <span className="text-[#666] flex-shrink-0">to</span>
              <input type="date" value={offForm.end_date} min={offForm.start_date} style={{ colorScheme: "dark" }}
                onChange={e => setOffForm(f => ({ ...f, end_date: e.target.value }))}
                className="flex-1 min-w-0 rounded-lg bg-[#141414] border border-[#1e1e1e] text-white px-3 py-2 focus:outline-none focus:border-white" />
            </div>
            {offForm.type === "blocked_hours" && (
              <div className="flex items-center gap-2 text-sm">
                <TimeSelect value={offForm.start_time} onChange={v => setOffForm(f => ({ ...f, start_time: v }))} small className="flex-1 min-w-0" />
                <span className="text-[#666] flex-shrink-0">–</span>
                <TimeSelect value={offForm.end_time} onChange={v => setOffForm(f => ({ ...f, end_time: v }))} small className="flex-1 min-w-0" />
              </div>
            )}
            <input value={offForm.reason} onChange={e => setOffForm(f => ({ ...f, reason: e.target.value }))} placeholder="Reason (optional)"
              className="w-full rounded-lg bg-[#141414] border border-[#1e1e1e] text-white text-sm px-3 py-2 focus:outline-none focus:border-white placeholder:text-[#555]" />
            <button onClick={addTimeOff} disabled={offBusy}
              className="w-full rounded-lg bg-amber-500 text-black font-semibold text-sm py-2 hover:bg-amber-400 disabled:opacity-50 transition-colors">
              {offBusy ? "Saving…" : isOwner ? "Add time off" : "Send request"}
            </button>
          </div>
        )}

        {/* Upcoming list */}
        <div className="mt-3 space-y-2">
          {timeOff.length === 0 ? (
            <p className="text-xs text-[#666]">No upcoming time off.</p>
          ) : timeOff.map(t => (
            <div key={t.id} className="flex items-center gap-2 rounded-lg border border-[#1e1e1e] bg-[#0f0f0f] px-3 py-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-white truncate">{TIMEOFF_LABEL(t.type)}</span>
                  <span className={cn("text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded-full flex-shrink-0",
                    t.status === "approved" ? "bg-emerald-500/15 text-emerald-400"
                      : t.status === "rejected" ? "bg-red-500/15 text-red-400"
                        : "bg-amber-500/15 text-amber-400")}>
                    {t.status}
                  </span>
                </div>
                <p className="text-xs text-[#888] truncate">
                  {prettyDate(t.start_date)}{t.end_date !== t.start_date ? ` → ${prettyDate(t.end_date)}` : ""}
                  {t.reason ? ` · ${t.reason}` : ""}
                </p>
              </div>
              <button onClick={() => cancelTimeOff(t.id)} aria-label="Cancel time off"
                className="flex-shrink-0 w-7 h-7 rounded-lg border border-[#1e1e1e] text-[#777] hover:text-white flex items-center justify-center">
                <X size={14} />
              </button>
            </div>
          ))}
        </div>
      </div>

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
