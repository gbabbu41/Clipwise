"use client";
import { useState, useEffect, useCallback } from "react";
import { ChevronLeft, ChevronRight, Calendar, Clock } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/lib/supabase";
import { cn, formatDateForDb } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { AppointmentWithDetails, Barber } from "@/lib/database.types";

// Hours shown in the calendar (8am–8pm)
const HOUR_START = 8;
const HOUR_END = 20;
const HOURS = Array.from({ length: HOUR_END - HOUR_START }, (_, i) => HOUR_START + i);

const STATUS_COLORS: Record<string, string> = {
  confirmed: "bg-gold/20 border-gold/40 text-gold",
  pending: "bg-yellow-500/20 border-yellow-500/40 text-yellow-300",
  completed: "bg-emerald-500/20 border-emerald-500/40 text-emerald-300",
  cancelled: "bg-red-500/20 border-red-500/40 text-red-300 opacity-50",
  "no-show": "bg-orange-500/20 border-orange-500/40 text-orange-300 opacity-50",
};

function parseTime(timeStr: string): number {
  // "9:00 AM" => 9.0, "1:30 PM" => 13.5
  const [time, period] = timeStr.split(" ");
  const [h, m] = time.split(":").map(Number);
  let hour = h;
  if (period === "PM" && h !== 12) hour += 12;
  if (period === "AM" && h === 12) hour = 0;
  return hour + m / 60;
}

function formatDateLabel(date: Date) {
  return date.toLocaleDateString("en-CA", { weekday: "short", month: "short", day: "numeric" });
}

function addDays(date: Date, n: number) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

function startOfWeek(date: Date) {
  const d = new Date(date);
  d.setDate(d.getDate() - d.getDay());
  return d;
}

interface ApptDetailProps {
  appt: AppointmentWithDetails;
  barbers: Barber[];
  onClose: () => void;
}

function ApptDetail({ appt, barbers, onClose }: ApptDetailProps) {
  const barber = barbers.find(b => b.id === appt.barber_id);
  return (
    <>
      <div className="fixed inset-0 bg-black/60 z-40" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="bg-surface border border-border rounded-2xl p-6 w-full max-w-sm space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-bold text-white">{appt.client_name}</h3>
            <button onClick={onClose} className="text-gray-400 hover:text-white text-xl leading-none">✕</button>
          </div>
          <Badge variant={
            appt.status === "confirmed" ? "success" :
            appt.status === "completed" ? "info" :
            appt.status === "cancelled" ? "danger" : "warning"
          } className="capitalize">{appt.status}</Badge>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between py-1.5 border-b border-border/50">
              <span className="text-gray-400">Service</span>
              <span className="text-white">{(appt.services as { name: string } | null)?.name ?? "—"}</span>
            </div>
            <div className="flex justify-between py-1.5 border-b border-border/50">
              <span className="text-gray-400">Barber</span>
              <span className="text-white">{barber?.name ?? "Any"}</span>
            </div>
            <div className="flex justify-between py-1.5 border-b border-border/50">
              <span className="text-gray-400">Time</span>
              <span className="text-white">{appt.time_slot}</span>
            </div>
            <div className="flex justify-between py-1.5 border-b border-border/50">
              <span className="text-gray-400">Phone</span>
              <span className="text-white">{appt.client_phone || "—"}</span>
            </div>
            <div className="flex justify-between py-1.5">
              <span className="text-gray-400">Total</span>
              <span className="text-gold font-semibold">${Number(appt.total_amount).toFixed(2)}</span>
            </div>
          </div>
          {appt.notes && (
            <div className="bg-surface-raised rounded-xl p-3 text-xs text-gray-300">{appt.notes}</div>
          )}
        </div>
      </div>
    </>
  );
}

export default function CalendarPage() {
  const { shop, profile } = useAuth();
  const [view, setView] = useState<"day" | "week">("day");
  const [currentDate, setCurrentDate] = useState(new Date());
  const [appointments, setAppointments] = useState<AppointmentWithDetails[]>([]);
  const [barbers, setBarbers] = useState<Barber[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedAppt, setSelectedAppt] = useState<AppointmentWithDetails | null>(null);
  const [myBarberId, setMyBarberId] = useState<string | null>(null);

  // Resolve barber id for barber role
  useEffect(() => {
    if (!profile || profile.role !== "barber" || !shop) return;
    supabase.from("barbers").select("id").eq("user_id", profile.id).eq("shop_id", shop.id).maybeSingle()
      .then(({ data }) => { if (data) setMyBarberId(data.id); });
  }, [profile, shop]);

  const load = useCallback(async () => {
    if (!shop) { setLoading(false); return; }
    setLoading(true);

    const weekStart = view === "week" ? startOfWeek(currentDate) : currentDate;
    const weekEnd = view === "week" ? addDays(weekStart, 6) : currentDate;
    const from = formatDateForDb(weekStart);
    const to = formatDateForDb(weekEnd);

    let q = supabase
      .from("appointments")
      .select("*, barbers(id, name), services(id, name, price, duration_minutes, category)")
      .eq("shop_id", shop.id)
      .gte("date", from)
      .lte("date", to)
      .not("status", "in", '("cancelled","no-show")')
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

  const navigate = (dir: -1 | 1) => {
    setCurrentDate(prev => addDays(prev, dir * (view === "week" ? 7 : 1)));
  };

  const isToday = (date: Date) => formatDateForDb(date) === formatDateForDb(new Date());

  // DAY VIEW: columns = barbers, rows = time
  const renderDayView = () => {
    const dateStr = formatDateForDb(currentDate);
    const dayAppts = appointments.filter(a => a.date === dateStr);
    const cols = barbers.length > 0 ? barbers : [{ id: "none", name: "All Barbers" } as Barber];

    return (
      <div className="overflow-x-auto">
        <div className="min-w-[600px]">
          {/* Column headers */}
          <div className="grid sticky top-0 z-10 bg-surface border-b border-border" style={{ gridTemplateColumns: `64px repeat(${cols.length}, 1fr)` }}>
            <div className="p-3" />
            {cols.map(b => (
              <div key={b.id} className="p-3 text-center border-l border-border">
                <div className="w-8 h-8 rounded-full bg-gold/20 border border-gold/30 flex items-center justify-center text-gold font-bold text-sm mx-auto mb-1">
                  {b.name[0]}
                </div>
                <p className="text-xs text-white font-medium">{b.name}</p>
                <p className="text-xs text-gray-500">
                  {dayAppts.filter(a => barbers.length === 0 || a.barber_id === b.id).length} appts
                </p>
              </div>
            ))}
          </div>

          {/* Hour rows */}
          <div className="relative">
            {HOURS.map(hour => (
              <div key={hour} className="grid border-b border-border/30" style={{ gridTemplateColumns: `64px repeat(${cols.length}, 1fr)`, height: "64px" }}>
                <div className="p-2 text-xs text-gray-500 text-right pr-3 leading-tight pt-1">
                  {hour % 12 === 0 ? 12 : hour % 12}{hour < 12 ? "am" : "pm"}
                </div>
                {cols.map(b => (
                  <div key={b.id} className="border-l border-border/30 relative" />
                ))}
              </div>
            ))}

            {/* Appointment blocks */}
            <div className="absolute inset-0 pointer-events-none" style={{ display: "grid", gridTemplateColumns: `64px repeat(${cols.length}, 1fr)` }}>
              <div />
              {cols.map((b, colIdx) => {
                const colAppts = dayAppts.filter(a => barbers.length === 0 || a.barber_id === b.id);
                return (
                  <div key={b.id} className="relative border-l border-transparent">
                    {colAppts.map(appt => {
                      const startH = parseTime(appt.time_slot);
                      if (startH < HOUR_START || startH >= HOUR_END) return null;
                      const duration = (appt.services as { duration_minutes?: number } | null)?.duration_minutes ?? 30;
                      const top = (startH - HOUR_START) * 64;
                      const height = Math.max(30, (duration / 60) * 64 - 4);
                      return (
                        <button
                          key={appt.id}
                          style={{ top: `${top + 2}px`, height: `${height}px`, left: "4px", right: "4px", position: "absolute" }}
                          className={cn(
                            "rounded-lg border px-2 py-1 text-left overflow-hidden pointer-events-auto transition-all hover:scale-[1.02] hover:z-10",
                            STATUS_COLORS[appt.status] ?? "bg-surface-raised border-border text-white"
                          )}
                          onClick={() => setSelectedAppt(appt)}
                        >
                          <p className="text-xs font-semibold truncate leading-tight">{appt.client_name}</p>
                          {height > 40 && (
                            <p className="text-xs opacity-75 truncate">{(appt.services as { name: string } | null)?.name}</p>
                          )}
                          {height > 52 && (
                            <p className="text-xs opacity-60">{appt.time_slot}</p>
                          )}
                        </button>
                      );
                    })}
                  </div>
                );
              })}
            </div>

            {/* Current time line */}
            {isToday(currentDate) && (() => {
              const now = new Date();
              const currentH = now.getHours() + now.getMinutes() / 60;
              if (currentH < HOUR_START || currentH > HOUR_END) return null;
              const top = (currentH - HOUR_START) * 64;
              return (
                <div className="absolute left-0 right-0 pointer-events-none z-20" style={{ top: `${top}px` }}>
                  <div className="flex items-center">
                    <div className="w-16 pr-3 text-right">
                      <div className="w-2 h-2 rounded-full bg-red-400 ml-auto" />
                    </div>
                    <div className="flex-1 h-px bg-red-400/60" />
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      </div>
    );
  };

  // WEEK VIEW: columns = days, rows = time
  const renderWeekView = () => {
    const weekStart = startOfWeek(currentDate);
    const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

    return (
      <div className="overflow-x-auto">
        <div className="min-w-[700px]">
          {/* Day headers */}
          <div className="grid sticky top-0 z-10 bg-surface border-b border-border" style={{ gridTemplateColumns: `64px repeat(7, 1fr)` }}>
            <div className="p-3" />
            {weekDays.map(day => {
              const dateStr = formatDateForDb(day);
              const dayAppts = appointments.filter(a => a.date === dateStr);
              const today = isToday(day);
              return (
                <div key={dateStr} className={cn("p-2 text-center border-l border-border", today && "bg-gold/5")}>
                  <p className={cn("text-xs font-medium", today ? "text-gold" : "text-gray-400")}>
                    {day.toLocaleDateString("en-CA", { weekday: "short" })}
                  </p>
                  <p className={cn("text-lg font-bold", today ? "text-gold" : "text-white")}>
                    {day.getDate()}
                  </p>
                  {dayAppts.length > 0 && (
                    <p className="text-xs text-gray-500">{dayAppts.length}</p>
                  )}
                </div>
              );
            })}
          </div>

          {/* Hour rows */}
          <div className="relative">
            {HOURS.map(hour => (
              <div key={hour} className="grid border-b border-border/30" style={{ gridTemplateColumns: `64px repeat(7, 1fr)`, height: "56px" }}>
                <div className="p-2 text-xs text-gray-500 text-right pr-3 leading-tight pt-1">
                  {hour % 12 === 0 ? 12 : hour % 12}{hour < 12 ? "am" : "pm"}
                </div>
                {weekDays.map(day => (
                  <div key={formatDateForDb(day)} className={cn("border-l border-border/30", isToday(day) && "bg-gold/5")} />
                ))}
              </div>
            ))}

            {/* Appointment blocks */}
            <div className="absolute inset-0 pointer-events-none" style={{ display: "grid", gridTemplateColumns: `64px repeat(7, 1fr)` }}>
              <div />
              {weekDays.map(day => {
                const dateStr = formatDateForDb(day);
                const dayAppts = appointments.filter(a => a.date === dateStr);
                return (
                  <div key={dateStr} className="relative border-l border-transparent">
                    {dayAppts.map(appt => {
                      const startH = parseTime(appt.time_slot);
                      if (startH < HOUR_START || startH >= HOUR_END) return null;
                      const duration = (appt.services as { duration_minutes?: number } | null)?.duration_minutes ?? 30;
                      const top = (startH - HOUR_START) * 56;
                      const height = Math.max(22, (duration / 60) * 56 - 3);
                      return (
                        <button
                          key={appt.id}
                          style={{ top: `${top + 2}px`, height: `${height}px`, left: "2px", right: "2px", position: "absolute" }}
                          className={cn(
                            "rounded border px-1 py-0.5 text-left overflow-hidden pointer-events-auto transition-all hover:z-10 hover:scale-[1.02]",
                            STATUS_COLORS[appt.status] ?? "bg-surface-raised border-border text-white"
                          )}
                          onClick={() => setSelectedAppt(appt)}
                        >
                          <p className="text-xs font-semibold leading-tight truncate">{appt.client_name}</p>
                          {height > 36 && (
                            <p className="text-xs opacity-70 truncate">{appt.time_slot}</p>
                          )}
                        </button>
                      );
                    })}
                  </div>
                );
              })}
            </div>

            {/* Current time line */}
            {weekDays.some(d => isToday(d)) && (() => {
              const now = new Date();
              const currentH = now.getHours() + now.getMinutes() / 60;
              if (currentH < HOUR_START || currentH > HOUR_END) return null;
              const top = (currentH - HOUR_START) * 56;
              return (
                <div className="absolute left-0 right-0 pointer-events-none z-20" style={{ top: `${top}px` }}>
                  <div className="flex items-center">
                    <div className="w-16" />
                    <div className="flex-1 h-px bg-red-400/60" />
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      </div>
    );
  };

  const titleDate = view === "week"
    ? (() => {
        const ws = startOfWeek(currentDate);
        const we = addDays(ws, 6);
        return `${ws.toLocaleDateString("en-CA", { month: "short", day: "numeric" })} – ${we.toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric" })}`;
      })()
    : currentDate.toLocaleDateString("en-CA", { weekday: "long", month: "long", day: "numeric", year: "numeric" });

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="p-6 pb-0 space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold text-white">Calendar</h1>
            <p className="text-sm text-gray-400 mt-0.5">Visual schedule view</p>
          </div>
          <div className="flex items-center gap-3">
            {/* View toggle */}
            <div className="flex bg-surface-raised border border-border rounded-xl p-1 gap-1">
              {(["day", "week"] as const).map(v => (
                <button key={v} onClick={() => setView(v)}
                  className={cn("px-3 py-1.5 text-xs font-medium rounded-lg capitalize transition-colors",
                    view === v ? "bg-gold/20 text-gold border border-gold/30" : "text-gray-400 hover:text-white")}>
                  {v}
                </button>
              ))}
            </div>
            {/* Navigation */}
            <div className="flex items-center gap-1">
              <button onClick={() => navigate(-1)} className="p-2 rounded-xl border border-border text-gray-400 hover:text-white hover:border-gold/40 transition-colors">
                <ChevronLeft size={16} />
              </button>
              <button
                onClick={() => setCurrentDate(new Date())}
                className="px-3 py-1.5 text-xs font-medium text-gray-400 hover:text-white border border-border rounded-xl hover:border-gold/40 transition-colors"
              >
                Today
              </button>
              <button onClick={() => navigate(1)} className="p-2 rounded-xl border border-border text-gray-400 hover:text-white hover:border-gold/40 transition-colors">
                <ChevronRight size={16} />
              </button>
            </div>
          </div>
        </div>

        {/* Date label */}
        <div className="flex items-center gap-3">
          <Calendar size={16} className="text-gold" />
          <h2 className="text-base font-semibold text-white">{titleDate}</h2>
          {loading && <span className="text-xs text-gray-500 animate-pulse">Loading…</span>}
        </div>

        {/* Legend */}
        <div className="flex items-center gap-4 text-xs flex-wrap pb-4">
          {[
            { status: "confirmed", label: "Confirmed" },
            { status: "pending", label: "Pending" },
            { status: "completed", label: "Completed" },
          ].map(({ status, label }) => (
            <span key={status} className="flex items-center gap-1.5">
              <span className={cn("w-3 h-3 rounded-sm border", STATUS_COLORS[status])} />
              <span className="text-gray-400">{label}</span>
            </span>
          ))}
          <span className="flex items-center gap-1.5 ml-auto">
            <Clock size={11} className="text-gray-500" />
            <span className="text-gray-500">Click appointment to view details</span>
          </span>
        </div>
      </div>

      {/* Calendar grid */}
      <div className="flex-1 overflow-auto border-t border-border mx-6 mb-6 rounded-2xl bg-surface border">
        {view === "day" ? renderDayView() : renderWeekView()}
      </div>

      {/* Appointment detail modal */}
      {selectedAppt && (
        <ApptDetail appt={selectedAppt} barbers={barbers} onClose={() => setSelectedAppt(null)} />
      )}
    </div>
  );
}
