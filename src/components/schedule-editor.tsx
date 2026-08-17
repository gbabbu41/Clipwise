"use client";

import { useEffect, useState, useCallback, type ReactNode } from "react";
import { Plus, X, Copy, CalendarOff, Pencil } from "lucide-react";
import { cn, dbTimeToDisplay, displayTimeToDb, timeToMinutes, prettyDate } from "@/lib/utils";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DAY_ABBR = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
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

export function ScheduleEditor({ barberId, barberName, accessToken, canEdit = true, isOwner = false, isPaused = false, headerAction }: { barberId: string; barberName: string; accessToken: string | null; canEdit?: boolean; isOwner?: boolean; isPaused?: boolean; headerAction?: ReactNode }) {
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
  const addBreakWith = (dow: number, brk: Brk) =>
    setDays(p => p.map((d, i) => i === dow ? { ...d, breaks: [...d.breaks, brk] } : d));
  const removeBreak = (dow: number, idx: number) =>
    setDays(p => p.map((d, i) => i === dow ? { ...d, breaks: d.breaks.filter((_, j) => j !== idx) } : d));

  // Each day collapses to a one-line summary; tapping opens this day editor.
  const [dayModal, setDayModal] = useState<number | null>(null);

  // Break add/edit happens in a popup (nested on the day editor).
  const [breakModal, setBreakModal] = useState<{ dow: number; idx: number | null; label: string; start: string; end: string } | null>(null);
  const openAddBreak = (dow: number) => setBreakModal({ dow, idx: null, label: "Lunch", start: "12:00 PM", end: "1:00 PM" });
  const openEditBreak = (dow: number, idx: number) => { const b = days[dow].breaks[idx]; setBreakModal({ dow, idx, label: b.label, start: b.start, end: b.end }); };
  const saveBreakModal = () => {
    if (!breakModal) return;
    const { dow, idx, label, start, end } = breakModal;
    const day = days[dow];
    if (timeToMinutes(end) <= timeToMinutes(start)) { showToast("Break end must be after start"); return; }
    if (timeToMinutes(start) < timeToMinutes(day.start) || timeToMinutes(end) > timeToMinutes(day.end)) { showToast("Break must be within working hours"); return; }
    const brk: Brk = { label: label.trim() || "Break", start, end };
    if (idx === null) addBreakWith(dow, brk); else setBreak(dow, idx, brk);
    setBreakModal(null);
  };

  // Copy the first open day's hours + breaks to every other open day, then save.
  const copyToAll = () => {
    const src = ORDER.map(dow => days[dow]).find(d => d.isOpen);
    if (!src) { showToast("Open a day first"); return; }
    const next = days.map(d => d.isOpen ? { ...d, start: src.start, end: src.end, breaks: src.breaks.map(b => ({ ...b })) } : d);
    setDays(next);
    save(next);
  };
  const setWeekdays = () => {
    const next = days.map((d, dow) => ({ ...d, isOpen: dow >= 1 && dow <= 5, start: "9:00 AM", end: "6:00 PM" }));
    setDays(next);
    save(next);
  };

  // Persist the schedule. Editing a day (pencil → popup → Save) and the quick
  // actions all call this — there's no separate "Save schedule" button anymore.
  // Pass an explicit `override` when saving right after a setDays() so we don't
  // race React's async state (the quick actions do this).
  const save = async (override?: Day[]): Promise<boolean> => {
    if (!accessToken) return false;
    const src = override ?? days;
    // Validate end > start and breaks within hours.
    for (const dow of ORDER) {
      const d = src[dow];
      if (!d.isOpen) continue;
      if (timeToMinutes(d.end) <= timeToMinutes(d.start)) { showToast(`${DAYS[dow]}: end time must be after start`); return false; }
      for (const b of d.breaks) {
        if (timeToMinutes(b.end) <= timeToMinutes(b.start)) { showToast(`${DAYS[dow]}: a break's end must be after its start`); return false; }
        if (timeToMinutes(b.start) < timeToMinutes(d.start) || timeToMinutes(b.end) > timeToMinutes(d.end)) { showToast(`${DAYS[dow]}: breaks must be within working hours`); return false; }
      }
    }
    setSaving(true);
    const res = await fetch("/api/schedule", {
      method: "POST", headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        barber_id: barberId,
        days: src.map((d, dow) => ({ day_of_week: dow, is_open: d.isOpen, start_time: displayTimeToDb(d.start), end_time: displayTimeToDb(d.end) })),
        breaks: src.flatMap((d, dow) => d.isOpen ? d.breaks.map(b => ({ day_of_week: dow, start_time: displayTimeToDb(b.start), end_time: displayTimeToDb(b.end), label: b.label })) : []),
      }),
    });
    setSaving(false);
    if (res.ok) {
      const d = await res.json().catch(() => ({}));
      if (d?.breaksError) showToast("Hours saved, but breaks didn't save — run the barber_breaks migration.");
      else showToast(`Schedule saved · emailed ${barberName.split(" ")[0]}`);
      return true;
    } else { const d = await res.json().catch(() => ({})); showToast(d.error ?? "Couldn't save"); return false; }
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

  if (loading) return (
    <div className="space-y-4 animate-pulse">
      <div className="rounded-2xl border border-border bg-card p-4">
        <div className="h-4 w-36 bg-surface-overlay rounded" />
        <div className="mt-4 divide-y divide-border">
          {[0, 1, 2, 3, 4, 5, 6].map(i => (
            <div key={i} className="flex items-center gap-3 py-2.5">
              <div className="w-9 h-3 bg-surface-overlay rounded flex-shrink-0" />
              <div className="w-2 h-2 rounded-full bg-surface-overlay flex-shrink-0" />
              <div className="h-3 bg-surface-overlay rounded" style={{ width: `${50 + (i % 3) * 14}%` }} />
            </div>
          ))}
        </div>
      </div>
      <div className="rounded-2xl border border-border bg-card p-4 h-20" />
    </div>
  );

  const dm = dayModal !== null ? days[dayModal] : null;

  return (
    <div className="space-y-4">
      {/* ── Weekly schedule (compact one-line rows, edit in a popup) ─────── */}
      <div className="rounded-2xl border border-border bg-card p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="font-semibold text-foreground">Weekly Schedule</h3>
            <p className="text-xs text-grey-muted mt-0.5">Repeats every week — same hours, automatically.</p>
          </div>
          {headerAction}
        </div>

        <div className={cn("mt-3 divide-y divide-border", !canEdit && "opacity-80", isPaused && "opacity-40 pointer-events-none")}>
          {ORDER.map(dow => {
            const d = days[dow];
            const brk = d.breaks.length === 1 ? ` · ${d.breaks[0].label}` : d.breaks.length > 1 ? ` · ${d.breaks.length} breaks` : "";
            return (
              <button key={dow} onClick={() => canEdit && setDayModal(dow)} disabled={!canEdit}
                className="w-full flex items-center gap-3 py-2.5 text-left disabled:cursor-default">
                <span className="w-9 flex-shrink-0 text-[11px] font-bold uppercase tracking-wide text-grey">{DAY_ABBR[dow]}</span>
                <span className={cn("w-2 h-2 rounded-full flex-shrink-0", d.isOpen ? "bg-emerald-500" : "border border-border-strong")} />
                <span className="flex-1 min-w-0 text-sm truncate">
                  {d.isOpen
                    ? <span className="text-foreground">{d.start} → {d.end}<span className="text-grey">{brk}</span></span>
                    : <span className="text-grey-muted">Day off</span>}
                </span>
                {canEdit && <Pencil size={14} className="text-grey-muted flex-shrink-0" />}
              </button>
            );
          })}
        </div>

        {/* Quick actions */}
        {canEdit && <div className="flex flex-wrap gap-2 mt-3">
          <button onClick={setWeekdays} className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card-raised text-grey hover:text-foreground text-xs font-medium px-3 py-1.5">
            Quick fill: Mon–Fri 9–6
          </button>
          <button onClick={copyToAll} className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card-raised text-grey hover:text-foreground text-xs font-medium px-3 py-1.5">
            <Copy size={13} /> Copy first day to all
          </button>
        </div>}
      </div>

      {!canEdit && (
        <p className="text-xs text-grey text-center py-1">Read-only — your shop owner manages your hours.</p>
      )}

      {/* ── Time off ─────────────────────────────────────────────────────── */}
      <div className="rounded-2xl border border-border bg-card p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CalendarOff size={16} className="text-amber-400" />
            <span className="font-semibold text-foreground">Time Off</span>
          </div>
          <button onClick={() => setShowOffForm(v => !v)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card-raised text-grey hover:text-foreground text-xs font-medium px-3 py-1.5">
            <Plus size={13} /> {isOwner ? "Add time off" : "Request"}
          </button>
        </div>
        <p className="text-xs text-grey-muted mt-1">
          {isOwner ? "Block off vacation, days off or specific hours — applied instantly." : "Request a day off or vacation — your owner approves it."}
        </p>

        {/* Add / request form */}
        {showOffForm && (
          <div className="mt-3 rounded-xl border border-border bg-card p-3 space-y-2.5">
            <select value={offForm.type} onChange={e => setOffForm(f => ({ ...f, type: e.target.value }))}
              className="w-full rounded-lg bg-card-raised border border-border text-foreground text-sm px-3 py-2 focus:outline-none focus:border-white">
              {TIMEOFF_TYPES.map(t => <option key={t.value} value={t.value} className="bg-card-raised">{t.label}</option>)}
            </select>
            <div className="flex items-center gap-2 text-sm">
              <input type="date" value={offForm.start_date} min={todayISO()}
                onChange={e => setOffForm(f => ({ ...f, start_date: e.target.value, end_date: f.end_date < e.target.value ? e.target.value : f.end_date }))}
                className="flex-1 min-w-0 rounded-lg bg-card-raised border border-border text-foreground px-3 py-2 focus:outline-none focus:border-white [color-scheme:dark]" />
              <span className="text-grey-muted flex-shrink-0">to</span>
              <input type="date" value={offForm.end_date} min={offForm.start_date}
                onChange={e => setOffForm(f => ({ ...f, end_date: e.target.value }))}
                className="flex-1 min-w-0 rounded-lg bg-card-raised border border-border text-foreground px-3 py-2 focus:outline-none focus:border-white [color-scheme:dark]" />
            </div>
            {offForm.type === "blocked_hours" && (
              <div className="flex items-center gap-2 text-sm">
                <TimeSelect value={offForm.start_time} onChange={v => setOffForm(f => ({ ...f, start_time: v }))} small className="flex-1 min-w-0" />
                <span className="text-grey-muted flex-shrink-0">–</span>
                <TimeSelect value={offForm.end_time} onChange={v => setOffForm(f => ({ ...f, end_time: v }))} small className="flex-1 min-w-0" />
              </div>
            )}
            <input value={offForm.reason} onChange={e => setOffForm(f => ({ ...f, reason: e.target.value }))} placeholder="Reason (optional)"
              className="w-full rounded-lg bg-card-raised border border-border text-foreground text-sm px-3 py-2 focus:outline-none focus:border-white placeholder:text-grey-muted" />
            <button onClick={addTimeOff} disabled={offBusy}
              className="w-full rounded-lg bg-amber-500 text-black font-semibold text-sm py-2 hover:bg-amber-400 disabled:opacity-50 transition-colors">
              {offBusy ? "Saving…" : isOwner ? "Add time off" : "Send request"}
            </button>
          </div>
        )}

        {/* Upcoming list */}
        <div className="mt-3 space-y-2">
          {timeOff.length === 0 ? (
            <p className="text-xs text-grey-muted">No upcoming time off.</p>
          ) : timeOff.map(t => (
            <div key={t.id} className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-foreground truncate">{TIMEOFF_LABEL(t.type)}</span>
                  <span className={cn("text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded-full flex-shrink-0",
                    t.status === "approved" ? "bg-emerald-500/15 text-emerald-400"
                      : t.status === "rejected" ? "bg-red-500/15 text-red-400"
                        : "bg-amber-500/15 text-amber-400")}>
                    {t.status}
                  </span>
                </div>
                <p className="text-xs text-grey truncate">
                  {prettyDate(t.start_date)}{t.end_date !== t.start_date ? ` → ${prettyDate(t.end_date)}` : ""}
                  {t.reason ? ` · ${t.reason}` : ""}
                </p>
              </div>
              <button onClick={() => cancelTimeOff(t.id)} aria-label="Cancel time off"
                className="flex-shrink-0 w-7 h-7 rounded-lg border border-border text-grey hover:text-foreground flex items-center justify-center">
                <X size={14} />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* ── Day editor popup ─────────────────────────────────────────────── */}
      {dayModal !== null && dm && (
        <>
          <div className="fixed inset-0 bg-black/70 z-[150]" onClick={() => setDayModal(null)} />
          <div className="fixed inset-0 z-[160] flex items-center justify-center p-4 overflow-y-auto overscroll-contain [&>*]:my-auto">
            <div className="bg-card shadow-sm border border-border rounded-2xl p-5 w-full max-w-sm space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-bold text-foreground">{DAYS[dayModal]}</h2>
                <button onClick={() => setDayModal(null)} className="text-grey hover:text-foreground text-xl leading-none">✕</button>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-sm text-grey">{dm.isOpen ? "Open this day" : "Day off"}</span>
                <button onClick={() => setDay(dayModal, { isOpen: !dm.isOpen })}
                  className={cn("relative w-11 h-6 rounded-full transition-colors", dm.isOpen ? "bg-emerald-500" : "bg-[#2a2a2a]")}
                  aria-label="Toggle open">
                  <span className={cn("absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all", dm.isOpen ? "left-[22px]" : "left-0.5")} />
                </button>
              </div>

              {dm.isOpen ? (
                <div className="space-y-3">
                  {/* Visual timeline */}
                  <div className="relative h-2.5 rounded-full bg-surface-overlay overflow-hidden">
                    <div className="absolute inset-y-0 bg-emerald-500/70" style={{ left: `${pct(dm.start)}%`, right: `${100 - pct(dm.end)}%` }} />
                    {dm.breaks.map((b, i) => (
                      <div key={i} className="absolute inset-y-0 bg-amber-500" style={{ left: `${pct(b.start)}%`, right: `${100 - pct(b.end)}%` }} />
                    ))}
                  </div>
                  {/* Hours */}
                  <div className="flex items-center gap-2 text-sm">
                    <TimeSelect value={dm.start} onChange={v => setDay(dayModal, { start: v })} className="flex-1 min-w-0" />
                    <span className="text-grey-muted flex-shrink-0">to</span>
                    <TimeSelect value={dm.end} onChange={v => setDay(dayModal, { end: v })} className="flex-1 min-w-0" />
                  </div>
                  {/* Breaks */}
                  {dm.breaks.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {dm.breaks.map((b, i) => (
                        <div key={i} className="inline-flex items-center gap-2 rounded-full bg-card-raised pl-3 pr-2.5 py-1.5">
                          <span className="text-xs font-medium text-foreground">{b.label}</span>
                          <span className="text-[11px] text-grey">{b.start}–{b.end}</span>
                          <div className="flex items-center gap-2.5 ml-0.5">
                            <button onClick={() => openEditBreak(dayModal, i)} aria-label="Edit break"
                              className="text-grey hover:text-foreground flex items-center justify-center"><Pencil size={12} /></button>
                            <button onClick={() => removeBreak(dayModal, i)} aria-label="Remove break"
                              className="text-grey hover:text-foreground flex items-center justify-center"><X size={13} /></button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  <button onClick={() => openAddBreak(dayModal)} className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-400 hover:text-amber-300">
                    <Plus size={14} /> Add break / lunch
                  </button>
                </div>
              ) : (
                <p className="text-xs text-grey-muted">Toggle on to set working hours and breaks.</p>
              )}

              <button onClick={async () => { const ok = await save(); if (ok) setDayModal(null); }} disabled={saving}
                className="w-full rounded-xl bg-white text-black font-semibold text-sm py-2.5 hover:opacity-90 disabled:opacity-50">
                {saving ? "Saving…" : "Save"}
              </button>
              <p className="text-[11px] text-grey-muted text-center -mt-1">Saved &amp; emailed to {barberName.split(" ")[0]} instantly.</p>
            </div>
          </div>
        </>
      )}

      {/* Break add/edit popup */}
      {breakModal && (
        <>
          <div className="fixed inset-0 bg-black/70 z-[180]" onClick={() => setBreakModal(null)} />
          <div className="fixed inset-0 z-[190] flex items-center justify-center p-4 overflow-y-auto overscroll-contain [&>*]:my-auto">
            <div className="bg-card shadow-sm border border-border rounded-2xl p-5 w-full max-w-sm space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-bold text-foreground">{breakModal.idx === null ? "Add break / lunch" : "Edit break"}</h2>
                <button onClick={() => setBreakModal(null)} className="text-grey hover:text-foreground text-xl leading-none">✕</button>
              </div>
              <p className="text-xs text-grey-muted -mt-2">{DAYS[breakModal.dow]} · within {days[breakModal.dow].start}–{days[breakModal.dow].end}</p>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-grey">Label</label>
                <input value={breakModal.label} onChange={e => setBreakModal(m => m && { ...m, label: e.target.value })} placeholder="Lunch"
                  className="w-full rounded-lg bg-card-raised border border-border text-amber-400 text-sm px-3 py-2 focus:outline-none focus:border-amber-500/50" />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-grey">Time</label>
                <div className="flex items-center gap-2">
                  <TimeSelect value={breakModal.start} onChange={v => setBreakModal(m => m && { ...m, start: v })} className="flex-1 min-w-0" />
                  <span className="text-grey-muted flex-shrink-0">–</span>
                  <TimeSelect value={breakModal.end} onChange={v => setBreakModal(m => m && { ...m, end: v })} className="flex-1 min-w-0" />
                </div>
              </div>
              <div className="flex gap-2 pt-1">
                <button onClick={() => setBreakModal(null)} className="flex-1 rounded-xl border border-border bg-card-raised text-grey hover:text-foreground text-sm font-medium py-2.5">Cancel</button>
                <button onClick={saveBreakModal} className="flex-1 rounded-xl bg-amber-500 text-black font-semibold text-sm py-2.5 hover:bg-amber-400">{breakModal.idx === null ? "Add" : "Save"}</button>
              </div>
            </div>
          </div>
        </>
      )}

      {toast && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-[200] bg-card-raised border border-border rounded-xl px-4 py-2.5 text-sm text-foreground shadow-xl">{toast}</div>
      )}
    </div>
  );
}

function TimeSelect({ value, onChange, small, className }: { value: string; onChange: (v: string) => void; small?: boolean; className?: string }) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)}
      className={cn("rounded-lg bg-card-raised border border-border text-foreground focus:outline-none focus:border-white",
        small ? "text-xs px-2 py-1.5" : "text-sm px-3 py-2 font-medium", className)}>
      {TIME_OPTIONS.map(t => <option key={t} value={t} className="bg-card-raised">{t}</option>)}
    </select>
  );
}
