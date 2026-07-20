"use client";

import { useRef, useState } from "react";
import {
  BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, ResponsiveContainer, Tooltip,
} from "recharts";
import { cn, formatCurrency } from "@/lib/utils";
import type { AppointmentWithDetails, Barber } from "@/lib/database.types";

/**
 * Swipeable stats carousel — the dashboard's premium visual anchor. Real
 * scroll-snap slides (Revenue area chart, Bookings bars, Top barbers, Status
 * mix donut) with paging dots. All charts derive from the data already loaded.
 */
export function StatsCarousel({
  revenue, chartData, appointments, completed, barbers,
}: {
  revenue: number;
  chartData: { day: string; revenue: number }[];
  appointments: AppointmentWithDetails[];
  completed: AppointmentWithDetails[];
  barbers: Barber[];
}) {
  const [idx, setIdx] = useState(0);
  const ref = useRef<HTMLDivElement>(null);

  // ── Datasets (from already-loaded data) ──
  const bookingsByDay = (() => {
    const m: Record<string, number> = {};
    appointments.forEach(a => { m[a.date] = (m[a.date] ?? 0) + 1; });
    return Object.entries(m).sort(([a], [b]) => a.localeCompare(b)).slice(-14)
      .map(([date, count]) => ({ day: new Date(date + "T00:00:00").toLocaleDateString("en-CA", { month: "short", day: "numeric" }), count }));
  })();

  const revenueByBarber = (() => {
    const m: Record<string, number> = {};
    completed.forEach(a => { if (a.barber_id) m[a.barber_id] = (m[a.barber_id] ?? 0) + (a.total_amount ?? 0); });
    return Object.entries(m)
      .map(([id, rev]) => ({ name: (barbers.find(b => b.id === id)?.name ?? "—").split(" ")[0], revenue: rev }))
      .sort((a, b) => b.revenue - a.revenue).slice(0, 5);
  })();

  const statusMix = (() => {
    const labels: Record<string, { name: string; color: string }> = {
      completed: { name: "Completed", color: "#10b981" },
      confirmed: { name: "Confirmed", color: "#6366f1" },
      pending: { name: "Pending", color: "#f59e0b" },
      "no-show": { name: "No-show", color: "#ef4444" },
      cancelled: { name: "Cancelled", color: "#9ca3af" },
    };
    const m: Record<string, number> = {};
    appointments.forEach(a => { m[a.status] = (m[a.status] ?? 0) + 1; });
    return Object.entries(m).filter(([s]) => labels[s]).map(([s, v]) => ({ ...labels[s], value: v }));
  })();

  const hasCompleted = completed.length > 0;
  const totalBookings = appointments.length;

  const onScroll = () => { const el = ref.current; if (el) setIdx(Math.round(el.scrollLeft / el.clientWidth)); };
  const goTo = (i: number) => { const el = ref.current; if (el) el.scrollTo({ left: i * el.clientWidth, behavior: "smooth" }); };

  const Empty = () => <div className="h-full flex items-center justify-center text-xs text-[#666]">No data yet</div>;
  const card = "bg-[#141414] border border-[#1e1e1e] rounded-2xl p-4 h-full flex flex-col";
  // Tooltip rides the top strip AND never captures touches (pointerEvents:none)
  // — so tapping a bar shows its value without the popup covering / blocking the
  // neighbouring bars. Shared by every chart so the behaviour is global.
  const tip = {
    contentStyle: { borderRadius: 10, border: "1px solid #1e1e1e", background: "#141414", color: "#fff", fontSize: 11, padding: "4px 8px", boxShadow: "0 6px 16px rgba(0,0,0,0.35)" },
    wrapperStyle: { pointerEvents: "none" as const, zIndex: 30 },
    position: { y: 0 },
    allowEscapeViewBox: { x: true, y: true },
    isAnimationActive: false,
  } as const;

  const slides = [
    // 1 — Revenue (area)
    <div key="rev" className={card}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-[11px] uppercase tracking-wide text-[#8a8a8a]">Revenue · Today</p>
        <span className="text-[11px] text-[#555] whitespace-nowrap">‹ swipe ›</span>
      </div>
      <p className="text-4xl font-extrabold text-white font-mono tracking-tight mt-1 leading-none">{formatCurrency(revenue)}</p>
      <p className={cn("text-xs mt-1.5 font-medium", hasCompleted ? "text-emerald-400" : "text-amber-500")}>
        {hasCompleted ? `↑ ${completed.length} booking${completed.length !== 1 ? "s" : ""}` : "No bookings yet today"}
      </p>
      <div className="flex-1 min-h-[96px] mt-3 flex items-end justify-center gap-1.5">
        {chartData.length > 0 ? (() => {
          const max = Math.max(...chartData.map(d => d.revenue), 1);
          const peak = chartData.reduce((mi, d, i, arr) => (d.revenue > arr[mi].revenue ? i : mi), 0);
          return chartData.map((d, i) => (
            <span key={i} title={`${d.day}: ${formatCurrency(d.revenue)}`}
              style={{ height: `${Math.max(6, (d.revenue / max) * 100)}%` }}
              className={cn("flex-1 max-w-[34px] rounded-t min-h-[6px]", i === peak
                ? "bg-gradient-to-t from-[#a9c6ff] to-white"
                : "bg-gradient-to-t from-[rgba(110,168,254,0.35)] to-[#6ea8fe]")} />
          ));
        })() : (
          // Empty state — faint placeholder bars so the hero keeps its shape
          // (the "No bookings yet today" line above already says there's no data).
          Array.from({ length: 7 }).map((_, i) => (
            <span key={i} style={{ height: `${28 + (i % 3) * 14}%` }} className="flex-1 max-w-[34px] rounded-t bg-white/[0.05]" />
          ))
        )}
      </div>
    </div>,

    // 2 — Bookings (bars)
    <div key="bk" className={card}>
      <p className="text-[11px] uppercase tracking-wide text-[#8a8a8a]">Bookings</p>
      <p className="text-4xl font-extrabold text-white font-mono tracking-tight mt-1 leading-none">{totalBookings}</p>
      <p className={cn("text-xs mt-1 font-medium", hasCompleted ? "text-emerald-400" : "text-amber-500")}>
        {hasCompleted ? `${completed.length} completed` : "No bookings yet"}
      </p>
      <div className="flex-1 min-h-[96px] mt-2 -mx-1">
        {bookingsByDay.length > 0 ? (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={bookingsByDay} margin={{ top: 6, right: 8, left: 8, bottom: 0 }}>
              <XAxis dataKey="day" tick={{ fontSize: 9, fill: "#9ca3af" }} interval="preserveStartEnd" minTickGap={24} axisLine={false} tickLine={false} />
              <Bar dataKey="count" fill="#6366f1" radius={[4, 4, 0, 0]} maxBarSize={26} isAnimationActive={false} />
              <Tooltip {...tip} formatter={(value) => [String(value), "Bookings"]} cursor={{ fill: "rgba(255,255,255,0.05)" }} />
            </BarChart>
          </ResponsiveContainer>
        ) : <Empty />}
      </div>
    </div>,

    // 3 — Top barbers (horizontal bars)
    <div key="tb" className={card}>
      <p className="text-[11px] uppercase tracking-wide text-[#8a8a8a]">Top barbers · revenue</p>
      <div className="flex-1 min-h-[112px] mt-2">
        {revenueByBarber.length > 0 ? (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={revenueByBarber} layout="vertical" margin={{ top: 4, right: 12, left: 4, bottom: 0 }}>
              <XAxis type="number" hide />
              <YAxis type="category" dataKey="name" width={56} tick={{ fontSize: 11, fill: "#6b7280" }} axisLine={false} tickLine={false} />
              <Bar dataKey="revenue" fill="#6ea8fe" radius={[0, 4, 4, 0]} isAnimationActive={false} />
              <Tooltip {...tip} formatter={(value) => [formatCurrency(Number(value)), "Revenue"]} cursor={{ fill: "rgba(255,255,255,0.05)" }} />
            </BarChart>
          </ResponsiveContainer>
        ) : <Empty />}
      </div>
    </div>,

    // 4 — Status mix (donut)
    <div key="st" className={card}>
      <p className="text-[11px] uppercase tracking-wide text-[#8a8a8a]">Booking status</p>
      <div className="flex-1 min-h-[112px] mt-2 flex items-center">
        {statusMix.length > 0 ? (
          <>
            <div className="w-1/2 h-[120px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={statusMix} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={32} outerRadius={52} paddingAngle={2} stroke="none" isAnimationActive={false}>
                    {statusMix.map((s, i) => <Cell key={i} fill={s.color} />)}
                  </Pie>
                  <Tooltip {...tip} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="w-1/2 space-y-1.5">
              {statusMix.map((s, i) => (
                <div key={i} className="flex items-center gap-2 text-xs text-[#aaa]">
                  <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: s.color }} />
                  <span className="flex-1 truncate">{s.name}</span>
                  <span className="font-semibold text-white">{s.value}</span>
                </div>
              ))}
            </div>
          </>
        ) : <Empty />}
      </div>
    </div>,
  ];

  return (
    <div>
      <div ref={ref} onScroll={onScroll}
        className="flex overflow-x-auto snap-x snap-mandatory gap-3 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
        {slides.map((s, i) => (
          <div key={i} className="min-w-full snap-center min-h-[180px]">{s}</div>
        ))}
      </div>
      <div className="flex justify-center gap-1.5 mt-2">
        {slides.map((_, i) => (
          <button key={i} type="button" onClick={() => goTo(i)} aria-label={`Slide ${i + 1}`}
            className={cn("h-1.5 rounded-full transition-all", i === idx ? "w-5 bg-accent" : "w-1.5 bg-[#2a2a2a]")} />
        ))}
      </div>
    </div>
  );
}
