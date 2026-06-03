"use client";
import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/lib/supabase";
import { cn, formatDateForDb } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import type { AppointmentWithDetails, Barber } from "@/lib/database.types";

// ── Time helpers ─────────────────────────────────────────────────────────────
const HOURS_24 = Array.from({ length: 24 }, (_, i) => i);
const ROW_PX = 56;                     // height of one hour row
const DEFAULT_SCROLL_HOUR = 8;         // where week/day views land on open

function parseTime(timeStr: string): number {
  const [time, period] = timeStr.split(" ");
  const [h, m] = time.split(":").map(Number);
  let hour = h;
  if (period === "PM" && h !== 12) hour += 12;
  if (period === "AM" && h === 12) hour = 0;
  return hour + m / 60;
}

function addDays(date: Date, n: number) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

function addMonths(date: Date, n: number) {
  const d = new Date(date);
  d.setMonth(d.getMonth() + n);
  return d;
}

function startOfWeek(date: Date) {
  const d = new Date(date);
  d.setDate(d.getDate() - d.getDay());
  return d;
}

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function endOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0);
}

const isToday = (date: Date) => formatDateForDb(date) === formatDateForDb(new Date());
const isSameMonth = (a: Date, b: Date) => a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear();

// ── Barber palette ───────────────────────────────────────────────────────────
// Flat fills, no borders. Colored by barber so "who is doing what" reads at a glance.
const BARBER_PALETTE = [
  "bg-sky-500/80 text-white",
  "bg-emerald-500/80 text-white",
  "bg-violet-500/80 text-white",
  "bg-rose-500/80 text-white",
  "bg-orange-500/90 text-white",
  "bg-cyan-500/80 text-white",
  "bg-fuchsia-500/80 text-white",
  "bg-lime-500/90 text-white",
];
const BARBER_DOT_PALETTE = [
  "bg-sky-400", "bg-emerald-400", "bg-violet-400", "bg-rose-400",
  "bg-orange-400", "bg-cyan-400", "bg-fuchsia-400", "bg-lime-400",
];

// ── Appointment detail modal ────────────────────────────────────────────────
function ApptDetail({ appt, barbers, onClose }: { appt: AppointmentWithDetails; barbers: Barber[]; onClose: () => void }) {
  const barber = barbers.find(b => b.id === appt.barber_id);
  return (
    <>
      <div className="fixed inset-0 bg-black/60 z-40" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="bg-black shadow-sm border border-[#1e1e1e] rounded-2xl p-6 w-full max-w-sm space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-bold text-white">{appt.client_name}</h3>
            <button onClick={onClose} className="text-[#777] hover:text-white"><X size={18} /></button>
          </div>
          <Badge variant={
            appt.status === "confirmed" ? "success" :
            appt.status === "completed" ? "info" :
            appt.status === "cancelled" ? "danger" : "warning"
          } className="capitalize">{appt.status}</Badge>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between py-1.5 border-b border-[#1e1e1e]/50">
              <span className="text-[#777]">Service</span>
              <span className="text-white">{(appt.services as { name: string } | null)?.name ?? "—"}</span>
            </div>
            <div className="flex justify-between py-1.5 border-b border-[#1e1e1e]/50">
              <span className="text-[#777]">Barber</span>
              <span className="text-white">{barber?.name ?? "Any"}</span>
            </div>
            <div className="flex justify-between py-1.5 border-b border-[#1e1e1e]/50">
              <span className="text-[#777]">Time</span>
              <span className="text-white">{appt.time_slot}</span>
            </div>
            <div className="flex justify-between py-1.5 border-b border-[#1e1e1e]/50">
              <span className="text-[#777]">Phone</span>
              <span className="text-white">{appt.client_phone || "—"}</span>
            </div>
            <div className="flex justify-between py-1.5">
              <span className="text-[#777]">Total</span>
              <span className="text-white font-semibold">${Number(appt.total_amount).toFixed(2)}</span>
            </div>
          </div>
          {appt.notes && (
            <div className="bg-[#141414] rounded-xl p-3 text-xs text-[#777]">{appt.notes}</div>
          )}
        </div>
      </div>
    </>
  );
}

// ── Day agenda side sheet (Apple-style "this day at a glance") ──────────────
function AgendaSheet({
  date,
  appts,
  barbers,
  barberColorByIdx,
  onClose,
  onOpenAppt,
  onDrillToDay,
}: {
  date: Date;
  appts: AppointmentWithDetails[];
  barbers: Barber[];
  barberColorByIdx: (id: string | null) => number;
  onClose: () => void;
  onOpenAppt: (a: AppointmentWithDetails) => void;
  onDrillToDay: () => void;
}) {
  const dayLabel = date.toLocaleDateString("en-CA", { weekday: "long", month: "long", day: "numeric" });
  return (
    <>
      <div className="fixed inset-0 bg-black/60 z-40" onClick={onClose} />
      <div className="fixed right-0 top-0 bottom-0 w-full sm:w-[420px] bg-black shadow-sm border-l border-[#1e1e1e] z-50 flex flex-col animate-fade-in">
        <div className="p-5 border-b border-[#1e1e1e] flex items-center justify-between">
          <div>
            <p className="text-xs text-[#777]">{date.toLocaleDateString("en-CA", { year: "numeric" })}</p>
            <h3 className="text-lg font-bold text-white">{dayLabel}</h3>
            <p className="text-xs text-[#777] mt-0.5">{appts.length} {appts.length === 1 ? "appointment" : "appointments"}</p>
          </div>
          <button onClick={onClose} className="text-[#777] hover:text-white"><X size={20} /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {appts.length === 0 && (
            <div className="text-center py-12 text-[#777] text-sm">No bookings on this day.</div>
          )}
          {appts.map(appt => {
            const colorIdx = barberColorByIdx(appt.barber_id);
            const dot = BARBER_DOT_PALETTE[colorIdx];
            const barber = barbers.find(b => b.id === appt.barber_id);
            return (
              <button key={appt.id} onClick={() => onOpenAppt(appt)}
                className="w-full text-left p-3 rounded-xl bg-[#141414] hover:bg-[#141414]/80 transition-colors flex items-start gap-3">
                <span className={cn("w-2 h-2 rounded-full mt-1.5 flex-shrink-0", dot)} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className={cn("text-sm font-semibold text-white truncate", (appt.status === "cancelled" || appt.status === "no-show") && "line-through opacity-50")}>
                      {appt.client_name}
                    </p>
                    <span className="text-xs text-[#777] flex-shrink-0">{appt.time_slot}</span>
                  </div>
                  <p className="text-xs text-[#777] truncate">
                    {(appt.services as { name: string } | null)?.name ?? "—"} · {barber?.name ?? "Any"}
                  </p>
                </div>
              </button>
            );
          })}
        </div>
        <div className="p-4 border-t border-[#1e1e1e]">
          <button onClick={onDrillToDay}
            className="w-full py-2.5 rounded-xl bg-black/10 hover:bg-black/15 text-white text-sm font-medium transition-colors">
            Open day view
          </button>
        </div>
      </div>
    </>
  );
}

export default function CalendarPage() {
  const { shop, profile } = useAuth();
  const [view, setView] = useState<"month" | "week" | "day">("month");
  const [currentDate, setCurrentDate] = useState(new Date());
  const [appointments, setAppointments] = useState<AppointmentWithDetails[]>([]);
  const [barbers, setBarbers] = useState<Barber[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedAppt, setSelectedAppt] = useState<AppointmentWithDetails | null>(null);
  const [agendaDate, setAgendaDate] = useState<Date | null>(null);
  const [myBarberId, setMyBarberId] = useState<string | null>(null);
  const [isMobile, setIsMobile] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 639px)");
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (!profile || profile.role !== "barber" || !shop) return;
    supabase.from("barbers").select("id").eq("user_id", profile.id).eq("shop_id", shop.id).maybeSingle()
      .then(({ data }) => { if (data) setMyBarberId(data.id); });
  }, [profile, shop]);

  const load = useCallback(async () => {
    if (!shop) { setLoading(false); return; }
    setLoading(true);

    let rangeStart: Date, rangeEnd: Date;
    if (view === "month") {
      const monthStart = startOfMonth(currentDate);
      rangeStart = addDays(monthStart, -monthStart.getDay()); // back to Sunday
      rangeEnd = addDays(rangeStart, 41);                     // 6 weeks
    } else if (view === "week") {
      rangeStart = startOfWeek(currentDate);
      rangeEnd = addDays(rangeStart, 6);
    } else {
      rangeStart = currentDate;
      rangeEnd = currentDate;
    }

    let q = supabase
      .from("appointments")
      .select("*, barbers(id, name), services(id, name, price, duration_minutes, category)")
      .eq("shop_id", shop.id)
      .gte("date", formatDateForDb(rangeStart))
      .lte("date", formatDateForDb(rangeEnd))
      .order("time_slot");

    if (profile?.role === "barber" && myBarberId) {
      q = q.eq("barber_id", myBarberId);
    }

    const [{ data: appts }, { data: bs }] = await Promise.all([
      q,
      supabase.from("barbers").select("*").eq("shop_id", shop.id).eq("is_active", true).order("name"),
    ]);

    setAppointments((appts ?? []) as AppointmentWithDetails[]);
    setBarbers((bs ?? []) as Barber[]);
    setLoading(false);
  }, [shop, currentDate, view, profile, myBarberId]);

  useEffect(() => { load(); }, [load]);

  // Scroll Day/Week views to 8 AM on mount or when switching into them.
  useEffect(() => {
    if ((view === "day" || view === "week") && scrollRef.current) {
      scrollRef.current.scrollTop = DEFAULT_SCROLL_HOUR * ROW_PX;
    }
  }, [view]);

  // Stable barber → palette index map
  const barberColorByIdx = useMemo(() => {
    const m = new Map<string, number>();
    barbers.forEach((b, i) => m.set(b.id, i % BARBER_PALETTE.length));
    return (id: string | null) => (id && m.has(id)) ? m.get(id)! : 0;
  }, [barbers]);

  const navigate = (dir: -1 | 1) => {
    if (view === "month") setCurrentDate(prev => addMonths(prev, dir));
    else if (view === "week") setCurrentDate(prev => addDays(prev, dir * 7));
    else setCurrentDate(prev => addDays(prev, dir));
  };

  const titleText = useMemo(() => {
    const monthFmt = isMobile ? "short" : "long";
    if (view === "month") return currentDate.toLocaleDateString("en-CA", { month: monthFmt, year: "numeric" });
    if (view === "week") {
      const ws = startOfWeek(currentDate);
      const we = addDays(ws, 6);
      const sameMonth = ws.getMonth() === we.getMonth();
      if (isMobile) {
        return sameMonth
          ? `${ws.toLocaleDateString("en-CA", { month: "short" })} ${ws.getDate()}–${we.getDate()}`
          : `${ws.toLocaleDateString("en-CA", { month: "short", day: "numeric" })} – ${we.toLocaleDateString("en-CA", { month: "short", day: "numeric" })}`;
      }
      return sameMonth
        ? `${ws.toLocaleDateString("en-CA", { month: "long" })} ${ws.getDate()}–${we.getDate()}, ${we.getFullYear()}`
        : `${ws.toLocaleDateString("en-CA", { month: "short", day: "numeric" })} – ${we.toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric" })}`;
    }
    return isMobile
      ? currentDate.toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric" })
      : currentDate.toLocaleDateString("en-CA", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  }, [view, currentDate, isMobile]);

  // ── MONTH VIEW ─────────────────────────────────────────────────────────────
  const renderMonthView = () => {
    const monthStart = startOfMonth(currentDate);
    const monthEnd = endOfMonth(currentDate);
    const gridStart = addDays(monthStart, -monthStart.getDay());
    const days = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
    // Trim trailing all-next-month week if not needed
    const lastWithCurrentMonth = days.findLastIndex(d => d.getMonth() === monthStart.getMonth() || d <= monthEnd);
    const rows = Math.ceil((lastWithCurrentMonth + 1) / 7);
    const visibleDays = days.slice(0, rows * 7);

    const apptsByDate = new Map<string, AppointmentWithDetails[]>();
    appointments.forEach(a => {
      const arr = apptsByDate.get(a.date) ?? [];
      arr.push(a);
      apptsByDate.set(a.date, arr);
    });

    return (
      <div className="flex flex-col h-full">
        <div className="grid grid-cols-7 border-b border-[#1e1e1e] bg-[#141414]/30">
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(d => (
            <div key={d} className="px-2 py-2 text-xs font-medium text-[#777] text-center">{d}</div>
          ))}
        </div>
        <div className="flex-1 grid grid-cols-7 auto-rows-fr">
          {visibleDays.map((day) => {
            const inMonth = isSameMonth(day, currentDate);
            const dayStr = formatDateForDb(day);
            const dayAppts = (apptsByDate.get(dayStr) ?? []).filter(a => a.status !== "cancelled" && a.status !== "no-show");
            const visible = dayAppts.slice(0, 2);
            const overflow = dayAppts.length - visible.length;
            return (
              <button
                key={dayStr}
                onClick={() => setAgendaDate(day)}
                className={cn(
                  "border-r border-b border-[#1e1e1e]/40 p-1 sm:p-1.5 text-left flex flex-col gap-1 min-h-[72px] sm:min-h-[88px] transition-colors",
                  "hover:bg-[#141414]/40",
                  !inMonth && "bg-black shadow-sm/30",
                )}
              >
                <div className="flex items-center justify-between">
                  <span className={cn(
                    "text-xs font-medium w-6 h-6 rounded-full flex items-center justify-center",
                    isToday(day) ? "bg-gold text-black font-bold" :
                    inMonth ? "text-white" : "text-[#777]",
                  )}>
                    {day.getDate()}
                  </span>
                </div>
                {isMobile ? (
                  // Phones: just colored dots per booking; cell is too narrow for chip text
                  <div className="flex flex-wrap gap-0.5 overflow-hidden">
                    {dayAppts.slice(0, 6).map(a => (
                      <span key={a.id} className={cn("w-1.5 h-1.5 rounded-full", BARBER_DOT_PALETTE[barberColorByIdx(a.barber_id)])} />
                    ))}
                    {dayAppts.length > 6 && (
                      <span className="text-[9px] text-[#777] leading-none">+{dayAppts.length - 6}</span>
                    )}
                  </div>
                ) : (
                  <div className="flex flex-col gap-0.5 overflow-hidden">
                    {visible.map(a => {
                      const colorIdx = barberColorByIdx(a.barber_id);
                      return (
                        <span key={a.id}
                          className={cn(
                            "truncate text-[10px] leading-4 px-1.5 rounded-sm",
                            BARBER_PALETTE[colorIdx],
                          )}
                        >
                          {a.time_slot.replace(/:00 /, " ")} {a.client_name}
                        </span>
                      );
                    })}
                    {overflow > 0 && (
                      <span className="text-[10px] text-[#777] pl-1.5">+{overflow} more</span>
                    )}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  // ── DAY VIEW ───────────────────────────────────────────────────────────────
  const renderDayView = () => {
    const dateStr = formatDateForDb(currentDate);
    const dayAppts = appointments.filter(a => a.date === dateStr);

    // Mobile: single vertical timeline, barber shown as a colored dot + name inline
    if (isMobile) {
      return (
        <div ref={scrollRef} className="overflow-auto h-full">
          <div className="relative">
            {HOURS_24.map(hour => (
              <div key={hour} className="grid border-b border-[#1e1e1e]/20" style={{ gridTemplateColumns: `48px 1fr`, height: `${ROW_PX}px` }}>
                <div className="text-[10px] text-[#777] text-right pr-2 pt-1">
                  {hour === 0 ? "12 AM" : hour < 12 ? `${hour} AM` : hour === 12 ? "12 PM" : `${hour - 12} PM`}
                </div>
                <div className="border-l border-[#1e1e1e]/20" />
              </div>
            ))}
            <div className="absolute inset-0 pointer-events-none" style={{ display: "grid", gridTemplateColumns: `48px 1fr` }}>
              <div />
              <div className="relative">
                {dayAppts.map(appt => {
                  const startH = parseTime(appt.time_slot);
                  const duration = (appt.services as { duration_minutes?: number } | null)?.duration_minutes ?? 30;
                  const top = startH * ROW_PX;
                  const height = Math.max(36, (duration / 60) * ROW_PX - 4);
                  const colorIdx = barberColorByIdx(appt.barber_id);
                  const barber = barbers.find(b => b.id === appt.barber_id);
                  const dimmed = appt.status === "cancelled" || appt.status === "no-show";
                  return (
                    <button
                      key={appt.id}
                      style={{ top: `${top + 2}px`, height: `${height}px`, left: "6px", right: "6px", position: "absolute" }}
                      className={cn(
                        "rounded-lg px-2.5 py-1.5 text-left overflow-hidden pointer-events-auto shadow-sm",
                        BARBER_PALETTE[colorIdx],
                        dimmed && "opacity-40 line-through",
                      )}
                      onClick={() => setSelectedAppt(appt)}
                    >
                      <p className="text-xs font-semibold truncate leading-tight">{appt.time_slot} · {appt.client_name}</p>
                      {height > 44 && (
                        <p className="text-[11px] opacity-90 truncate">
                          {(appt.services as { name: string } | null)?.name} · {barber?.name ?? "Any"}
                        </p>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
            {isToday(currentDate) && (() => {
              const now = new Date();
              const currentH = now.getHours() + now.getMinutes() / 60;
              const top = currentH * ROW_PX;
              return (
                <div className="absolute left-0 right-0 pointer-events-none z-20" style={{ top: `${top}px` }}>
                  <div className="flex items-center">
                    <div className="w-12 pr-2 text-right">
                      <div className="w-2 h-2 rounded-full bg-red-500 ml-auto" />
                    </div>
                    <div className="flex-1 h-px bg-red-500" />
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      );
    }

    // Desktop: per-barber columns
    const cols = barbers.length > 0 ? barbers : [{ id: "none", name: "All Barbers" } as Barber];

    return (
      <div ref={scrollRef} className="overflow-auto h-full">
        <div className="min-w-[600px]">
          <div className="grid sticky top-0 z-10 bg-black shadow-sm border-b border-[#1e1e1e]" style={{ gridTemplateColumns: `56px repeat(${cols.length}, 1fr)` }}>
            <div />
            {cols.map((b, i) => (
              <div key={b.id} className="px-3 py-3 text-center border-l border-[#1e1e1e]/40">
                <div className="flex items-center justify-center gap-2">
                  <span className={cn("w-2 h-2 rounded-full", BARBER_DOT_PALETTE[i % BARBER_DOT_PALETTE.length])} />
                  <p className="text-xs text-white font-medium">{b.name}</p>
                </div>
                <p className="text-[10px] text-[#777] mt-0.5">
                  {dayAppts.filter(a => barbers.length === 0 || a.barber_id === b.id).length} appts
                </p>
              </div>
            ))}
          </div>

          <div className="relative">
            {HOURS_24.map(hour => (
              <div key={hour} className="grid border-b border-[#1e1e1e]/20" style={{ gridTemplateColumns: `56px repeat(${cols.length}, 1fr)`, height: `${ROW_PX}px` }}>
                <div className="text-[10px] text-[#777] text-right pr-2 pt-1">
                  {hour === 0 ? "12 AM" : hour < 12 ? `${hour} AM` : hour === 12 ? "12 PM" : `${hour - 12} PM`}
                </div>
                {cols.map(b => (
                  <div key={b.id} className="border-l border-[#1e1e1e]/20" />
                ))}
              </div>
            ))}

            <div className="absolute inset-0 pointer-events-none" style={{ display: "grid", gridTemplateColumns: `56px repeat(${cols.length}, 1fr)` }}>
              <div />
              {cols.map((b) => {
                const colAppts = dayAppts.filter(a => barbers.length === 0 || a.barber_id === b.id);
                return (
                  <div key={b.id} className="relative">
                    {colAppts.map(appt => {
                      const startH = parseTime(appt.time_slot);
                      const duration = (appt.services as { duration_minutes?: number } | null)?.duration_minutes ?? 30;
                      const top = startH * ROW_PX;
                      const height = Math.max(28, (duration / 60) * ROW_PX - 4);
                      const colorIdx = barberColorByIdx(appt.barber_id);
                      const dimmed = appt.status === "cancelled" || appt.status === "no-show";
                      return (
                        <button
                          key={appt.id}
                          style={{ top: `${top + 2}px`, height: `${height}px`, left: "4px", right: "4px", position: "absolute" }}
                          className={cn(
                            "rounded-lg px-2 py-1 text-left overflow-hidden pointer-events-auto transition-all hover:scale-[1.02] hover:z-10 shadow-sm",
                            BARBER_PALETTE[colorIdx],
                            dimmed && "opacity-40 line-through",
                          )}
                          onClick={() => setSelectedAppt(appt)}
                        >
                          <p className="text-xs font-semibold truncate leading-tight">{appt.client_name}</p>
                          {height > 36 && (
                            <p className="text-[11px] opacity-90 truncate">{(appt.services as { name: string } | null)?.name}</p>
                          )}
                          {height > 52 && (
                            <p className="text-[10px] opacity-75">{appt.time_slot}</p>
                          )}
                        </button>
                      );
                    })}
                  </div>
                );
              })}
            </div>

            {isToday(currentDate) && (() => {
              const now = new Date();
              const currentH = now.getHours() + now.getMinutes() / 60;
              const top = currentH * ROW_PX;
              return (
                <div className="absolute left-0 right-0 pointer-events-none z-20" style={{ top: `${top}px` }}>
                  <div className="flex items-center">
                    <div className="w-14 pr-2 text-right">
                      <div className="w-2 h-2 rounded-full bg-red-500 ml-auto" />
                    </div>
                    <div className="flex-1 h-px bg-red-500" />
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      </div>
    );
  };

  // ── WEEK VIEW ──────────────────────────────────────────────────────────────
  const renderWeekView = () => {
    const weekStart = startOfWeek(currentDate);
    const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

    // Mobile: date strip at top, then a single-day timeline for currentDate
    if (isMobile) {
      const selectedStr = formatDateForDb(currentDate);
      const dayAppts = appointments.filter(a => a.date === selectedStr);
      return (
        <div className="flex flex-col h-full">
          {/* Date strip — tap to switch day */}
          <div className="grid grid-cols-7 border-b border-[#1e1e1e] bg-[#141414]/30 flex-shrink-0">
            {weekDays.map(day => {
              const dateStr = formatDateForDb(day);
              const isSelected = dateStr === selectedStr;
              const today = isToday(day);
              const count = appointments.filter(a => a.date === dateStr && a.status !== "cancelled" && a.status !== "no-show").length;
              return (
                <button key={dateStr} onClick={() => setCurrentDate(day)}
                  className="py-2 text-center hover:bg-[#141414]/50 transition-colors">
                  <p className={cn("text-[10px] uppercase tracking-wider", today ? "text-white" : "text-[#777]")}>
                    {day.toLocaleDateString("en-CA", { weekday: "narrow" })}
                  </p>
                  <p className={cn(
                    "text-base font-bold mt-0.5 inline-flex items-center justify-center w-8 h-8 rounded-full",
                    isSelected ? "bg-gold text-black" : today ? "text-white" : "text-white",
                  )}>
                    {day.getDate()}
                  </p>
                  <div className="flex justify-center gap-0.5 mt-0.5 h-1">
                    {count > 0 && <span className="w-1 h-1 rounded-full bg-gold/60" />}
                    {count > 3 && <span className="w-1 h-1 rounded-full bg-gold/60" />}
                    {count > 6 && <span className="w-1 h-1 rounded-full bg-gold/60" />}
                  </div>
                </button>
              );
            })}
          </div>
          {/* Single-day timeline for the selected day */}
          <div ref={scrollRef} className="overflow-auto flex-1">
            <div className="relative">
              {HOURS_24.map(hour => (
                <div key={hour} className="grid border-b border-[#1e1e1e]/20" style={{ gridTemplateColumns: `48px 1fr`, height: `${ROW_PX}px` }}>
                  <div className="text-[10px] text-[#777] text-right pr-2 pt-1">
                    {hour === 0 ? "12 AM" : hour < 12 ? `${hour} AM` : hour === 12 ? "12 PM" : `${hour - 12} PM`}
                  </div>
                  <div className="border-l border-[#1e1e1e]/20" />
                </div>
              ))}
              <div className="absolute inset-0 pointer-events-none" style={{ display: "grid", gridTemplateColumns: `48px 1fr` }}>
                <div />
                <div className="relative">
                  {dayAppts.map(appt => {
                    const startH = parseTime(appt.time_slot);
                    const duration = (appt.services as { duration_minutes?: number } | null)?.duration_minutes ?? 30;
                    const top = startH * ROW_PX;
                    const height = Math.max(36, (duration / 60) * ROW_PX - 4);
                    const colorIdx = barberColorByIdx(appt.barber_id);
                    const barber = barbers.find(b => b.id === appt.barber_id);
                    const dimmed = appt.status === "cancelled" || appt.status === "no-show";
                    return (
                      <button
                        key={appt.id}
                        style={{ top: `${top + 2}px`, height: `${height}px`, left: "6px", right: "6px", position: "absolute" }}
                        className={cn(
                          "rounded-lg px-2.5 py-1.5 text-left overflow-hidden pointer-events-auto shadow-sm",
                          BARBER_PALETTE[colorIdx],
                          dimmed && "opacity-40 line-through",
                        )}
                        onClick={() => setSelectedAppt(appt)}
                      >
                        <p className="text-xs font-semibold truncate leading-tight">{appt.time_slot} · {appt.client_name}</p>
                        {height > 44 && (
                          <p className="text-[11px] opacity-90 truncate">
                            {(appt.services as { name: string } | null)?.name} · {barber?.name ?? "Any"}
                          </p>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
              {isToday(currentDate) && (() => {
                const now = new Date();
                const currentH = now.getHours() + now.getMinutes() / 60;
                const top = currentH * ROW_PX;
                return (
                  <div className="absolute left-0 right-0 pointer-events-none z-20" style={{ top: `${top}px` }}>
                    <div className="flex items-center">
                      <div className="w-12 pr-2 text-right">
                        <div className="w-2 h-2 rounded-full bg-red-500 ml-auto" />
                      </div>
                      <div className="flex-1 h-px bg-red-500" />
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      );
    }

    return (
      <div ref={scrollRef} className="overflow-auto h-full">
        <div className="min-w-[700px]">
          <div className="grid sticky top-0 z-10 bg-black shadow-sm border-b border-[#1e1e1e]" style={{ gridTemplateColumns: `56px repeat(7, 1fr)` }}>
            <div />
            {weekDays.map(day => {
              const dateStr = formatDateForDb(day);
              const dayAppts = appointments.filter(a => a.date === dateStr);
              const today = isToday(day);
              return (
                <button key={dateStr} onClick={() => setAgendaDate(day)}
                  className={cn("py-2 text-center border-l border-[#1e1e1e]/40 hover:bg-[#141414]/30 transition-colors", today && "bg-black/5")}>
                  <p className={cn("text-[10px] uppercase tracking-wider", today ? "text-white" : "text-[#777]")}>
                    {day.toLocaleDateString("en-CA", { weekday: "short" })}
                  </p>
                  <p className={cn(
                    "text-lg font-bold mt-0.5 inline-flex items-center justify-center w-8 h-8 rounded-full",
                    today ? "bg-gold text-black" : "text-white",
                  )}>
                    {day.getDate()}
                  </p>
                  {dayAppts.length > 0 && (
                    <p className="text-[10px] text-[#777] mt-0.5">{dayAppts.length}</p>
                  )}
                </button>
              );
            })}
          </div>

          <div className="relative">
            {HOURS_24.map(hour => (
              <div key={hour} className="grid border-b border-[#1e1e1e]/20" style={{ gridTemplateColumns: `56px repeat(7, 1fr)`, height: `${ROW_PX}px` }}>
                <div className="text-[10px] text-[#777] text-right pr-2 pt-1">
                  {hour === 0 ? "12 AM" : hour < 12 ? `${hour} AM` : hour === 12 ? "12 PM" : `${hour - 12} PM`}
                </div>
                {weekDays.map(day => (
                  <div key={formatDateForDb(day)} className={cn("border-l border-[#1e1e1e]/20", isToday(day) && "bg-black/5")} />
                ))}
              </div>
            ))}

            <div className="absolute inset-0 pointer-events-none" style={{ display: "grid", gridTemplateColumns: `56px repeat(7, 1fr)` }}>
              <div />
              {weekDays.map(day => {
                const dateStr = formatDateForDb(day);
                const dayAppts = appointments.filter(a => a.date === dateStr);
                return (
                  <div key={dateStr} className="relative">
                    {dayAppts.map(appt => {
                      const startH = parseTime(appt.time_slot);
                      const duration = (appt.services as { duration_minutes?: number } | null)?.duration_minutes ?? 30;
                      const top = startH * ROW_PX;
                      const height = Math.max(22, (duration / 60) * ROW_PX - 3);
                      const colorIdx = barberColorByIdx(appt.barber_id);
                      const dimmed = appt.status === "cancelled" || appt.status === "no-show";
                      return (
                        <button
                          key={appt.id}
                          style={{ top: `${top + 2}px`, height: `${height}px`, left: "2px", right: "2px", position: "absolute" }}
                          className={cn(
                            "rounded px-1.5 py-0.5 text-left overflow-hidden pointer-events-auto transition-all hover:z-10 hover:scale-[1.02] shadow-sm",
                            BARBER_PALETTE[colorIdx],
                            dimmed && "opacity-40 line-through",
                          )}
                          onClick={() => setSelectedAppt(appt)}
                        >
                          <p className="text-[11px] font-semibold leading-tight truncate">{appt.client_name}</p>
                          {height > 36 && (
                            <p className="text-[10px] opacity-90 truncate">{appt.time_slot}</p>
                          )}
                        </button>
                      );
                    })}
                  </div>
                );
              })}
            </div>

            {weekDays.some(d => isToday(d)) && (() => {
              const now = new Date();
              const currentH = now.getHours() + now.getMinutes() / 60;
              const top = currentH * ROW_PX;
              return (
                <div className="absolute left-0 right-0 pointer-events-none z-20" style={{ top: `${top}px` }}>
                  <div className="flex items-center">
                    <div className="w-14" />
                    <div className="flex-1 h-px bg-red-500" />
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      </div>
    );
  };

  // ── Layout ─────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full">
      {/* Apple-style header bar */}
      <div className="p-4 sm:p-6 pb-3 border-b border-[#1e1e1e] space-y-3 sm:space-y-0 sm:flex sm:items-center sm:justify-between sm:gap-4">
        <div className="flex items-center gap-2">
          <button onClick={() => navigate(-1)} aria-label="Previous"
            className="p-2 rounded-lg text-[#777] hover:text-white hover:bg-[#141414] transition-colors">
            <ChevronLeft size={18} />
          </button>
          <button onClick={() => setCurrentDate(new Date())}
            className="px-3 py-1.5 text-xs font-medium text-white border border-black rounded-lg hover:bg-black/5 transition-colors">
            Today
          </button>
          <button onClick={() => navigate(1)} aria-label="Next"
            className="p-2 rounded-lg text-[#777] hover:text-white hover:bg-[#141414] transition-colors">
            <ChevronRight size={18} />
          </button>
          <h2 className="ml-2 text-lg sm:text-xl font-bold text-white">
            {titleText}
            {loading && <span className="text-xs text-[#777] ml-2 animate-pulse">Loading…</span>}
          </h2>
        </div>
        <div className="flex bg-[#141414] border border-[#1e1e1e] rounded-xl p-1 gap-1 self-start sm:self-auto">
          {(["month", "week", "day"] as const).map(v => (
            <button key={v} onClick={() => setView(v)}
              className={cn("px-3 py-1.5 text-xs font-medium rounded-lg capitalize transition-colors",
                view === v ? "bg-black/10 text-white" : "text-[#777] hover:text-white")}>
              {v}
            </button>
          ))}
        </div>
      </div>

      {/* Barber legend (only when there are multiple) */}
      {barbers.length > 1 && (
        <div className="px-4 sm:px-6 py-2 border-b border-[#1e1e1e]/50 flex flex-wrap gap-x-4 gap-y-1.5">
          {barbers.map((b, i) => (
            <span key={b.id} className="inline-flex items-center gap-1.5 text-xs">
              <span className={cn("w-2.5 h-2.5 rounded-full", BARBER_DOT_PALETTE[i % BARBER_DOT_PALETTE.length])} />
              <span className="text-[#777]">{b.name}</span>
            </span>
          ))}
        </div>
      )}

      <div className="flex-1 overflow-hidden bg-black shadow-sm">
        {view === "month" ? renderMonthView() : view === "week" ? renderWeekView() : renderDayView()}
      </div>

      {selectedAppt && <ApptDetail appt={selectedAppt} barbers={barbers} onClose={() => setSelectedAppt(null)} />}
      {agendaDate && (
        <AgendaSheet
          date={agendaDate}
          appts={appointments.filter(a => a.date === formatDateForDb(agendaDate))}
          barbers={barbers}
          barberColorByIdx={barberColorByIdx}
          onClose={() => setAgendaDate(null)}
          onOpenAppt={(a) => { setAgendaDate(null); setSelectedAppt(a); }}
          onDrillToDay={() => {
            setCurrentDate(agendaDate);
            setView("day");
            setAgendaDate(null);
          }}
        />
      )}
    </div>
  );
}
