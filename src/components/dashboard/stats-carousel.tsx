"use client";

import { useRef, useState } from "react";
import {
  BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, ResponsiveContainer, Tooltip,
} from "recharts";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn, formatCurrency } from "@/lib/utils";
import type { AppointmentWithDetails, Barber } from "@/lib/database.types";

/**
 * Swipeable stats carousel — the dashboard's premium visual anchor. Real
 * scroll-snap slides (Revenue area chart, Bookings bars, Top barbers, Status
 * mix donut) with paging dots. All charts derive from the data already loaded.
 */
export function StatsCarousel({
  revenue, taxCollected = 0, cashIncluded = 0, feesPaid = 0, chartData, appointments, completed, barbers, periodLabel = "Today",
}: {
  revenue: number;         // NET after Stripe fees (incl. tax + cash)
  taxCollected?: number;   // GST/HST + PST portion of the net (shown as an "incl. tax" note)
  cashIncluded?: number;   // cash portion of the total (shown as an "incl. cash" note)
  feesPaid?: number;       // Stripe processing fees deducted (shown as a "− fees" note)
  chartData: { day: string; revenue: number }[];
  appointments: AppointmentWithDetails[];
  completed: AppointmentWithDetails[];
  barbers: Barber[];
  periodLabel?: string;    // active date-filter label ("Today", "This Week", …)
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
    completed.forEach(a => { if (a.barber_id && a.payment_status !== "refunded") m[a.barber_id] = (m[a.barber_id] ?? 0) + Math.max(0, (a.total_amount ?? 0) - (a.tax_amount ?? 0)); });
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

  const Empty = () => <div className="h-full flex items-center justify-center text-xs text-grey-muted">No data yet</div>;
  const card = "cwd-stat bg-card-raised rounded-2xl pt-[18px] px-[18px] pb-[14px] h-full flex flex-col";
  // Tooltip rides the top strip AND never captures touches (pointerEvents:none)
  // — so tapping a bar shows its value without the popup covering / blocking the
  // neighbouring bars. Shared by every chart so the behaviour is global.
  const tip = {
    contentStyle: { borderRadius: 10, border: "1px solid var(--border)", background: "var(--card)", color: "var(--foreground)", fontSize: 11, padding: "4px 8px", boxShadow: "0 6px 16px rgba(20,22,28,0.18)" },
    wrapperStyle: { pointerEvents: "none" as const, zIndex: 30 },
    position: { y: 0 },
    allowEscapeViewBox: { x: true, y: true },
    isAnimationActive: false,
  } as const;

  const slides = [
    // 1 — Revenue (area)
    <div key="rev" className={card}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-[10.5px] uppercase tracking-[0.16em] text-[#8a8a8a]">Net · {periodLabel}</p>
        <span className={cn("text-[11px] font-medium whitespace-nowrap", hasCompleted ? "text-emerald-400" : "text-grey-muted")}>
          {hasCompleted ? `${completed.length} booking${completed.length !== 1 ? "s" : ""}` : "‹ swipe ›"}
        </span>
      </div>
      <p className="text-[34px] font-bold text-foreground font-mono tracking-[-0.02em] mt-1.5 leading-none">
        {formatCurrency(revenue)}
      </p>
      {/* Cash included in the net (already in hand). */}
      {cashIncluded > 0 && (
        <p className="text-[11px] text-grey-muted mt-1">incl. {formatCurrency(cashIncluded)} cash</p>
      )}
      {/* Nothing in yet → say so right under the total, above the chart (matches
          the Bookings slide's note placement). */}
      {revenue + feesPaid <= 0 && (
        <p className="text-xs mt-1 font-medium text-grey">{totalBookings > 0 ? "Nothing collected yet" : "No bookings yet"}</p>
      )}
      {/* Slim revenue strip — vertically centered in the card so the (common)
          empty state isn't top-heavy: balanced space above and below. */}
      <div className="flex-1 flex items-center mt-3 min-h-[44px]">
        <div className="w-full h-9 flex items-end justify-center gap-1.5">
          {chartData.length > 0 ? (() => {
            const max = Math.max(...chartData.map(d => d.revenue), 1);
            const peak = chartData.reduce((mi, d, i, arr) => (d.revenue > arr[mi].revenue ? i : mi), 0);
            return chartData.map((d, i) => (
              <span key={i} title={`${d.day}: ${formatCurrency(d.revenue)}`}
                style={{ height: `${Math.max(8, (d.revenue / max) * 100)}%` }}
                className={cn("flex-1 max-w-[30px] rounded-t min-h-[6px]", i === peak
                  ? "bg-gradient-to-t from-[#3f6fb2] to-[#6ea8fe]"
                  : "bg-gradient-to-t from-[rgba(110,168,254,0.35)] to-[#6ea8fe]")} />
            ));
          })() : (
            Array.from({ length: 7 }).map((_, i) => (
              <span key={i} style={{ height: `${28 + (i % 3) * 14}%` }} className="flex-1 max-w-[30px] rounded-t bg-gradient-to-t from-[#6ea8fe]/20 to-[#6ea8fe]/45" />
            ))
          )}
        </div>
      </div>
      {/* Receipt ledger — same shape as the Payments page, so both screens match. */}
      {revenue + feesPaid > 0 && (
        <div className="mt-3 border-t border-border pt-2.5 flex flex-col gap-1.5">
          <div className="flex justify-between text-[12px]"><span className="text-grey-muted">Gross</span><span className="font-mono tabular-nums text-foreground">{formatCurrency(revenue + feesPaid)}</span></div>
          {taxCollected > 0 && <div className="flex justify-between text-[12px]"><span className="text-grey-muted">Tax</span><span className="font-mono tabular-nums text-foreground">{formatCurrency(taxCollected)}</span></div>}
          {feesPaid > 0 && <div className="flex justify-between text-[12px]"><span className="text-grey-muted">Stripe fees</span><span className="font-mono tabular-nums text-foreground">−{formatCurrency(feesPaid)}</span></div>}
          <div className="flex justify-between border-t border-dashed border-border pt-2 text-[12px]"><span className="text-foreground font-semibold">You keep</span><span className="font-mono tabular-nums font-bold text-emerald-400 text-[14px]">{formatCurrency(revenue)}</span></div>
        </div>
      )}
    </div>,

    // 2 — Bookings (bars)
    <div key="bk" className={card}>
      <p className="text-[10.5px] uppercase tracking-[0.16em] text-[#8a8a8a]">Bookings</p>
      <p className="text-[34px] font-bold text-foreground font-mono tracking-[-0.02em] mt-1.5 leading-none">{totalBookings}</p>
      <p className={cn("text-xs mt-1 font-medium", hasCompleted ? "text-emerald-400" : "text-grey")}>
        {hasCompleted
          ? `${completed.length} completed`
          : totalBookings > 0 ? "None completed yet" : "No bookings yet"}
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
      <p className="text-[10.5px] uppercase tracking-[0.16em] text-[#8a8a8a]">Top barbers · revenue</p>
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
      <p className="text-[10.5px] uppercase tracking-[0.16em] text-[#8a8a8a]">Booking status</p>
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
                <div key={i} className="flex items-center gap-2 text-xs text-grey">
                  <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: s.color }} />
                  <span className="flex-1 truncate">{s.name}</span>
                  <span className="font-semibold text-foreground">{s.value}</span>
                </div>
              ))}
            </div>
          </>
        ) : <Empty />}
      </div>
    </div>,
  ];

  const arrowBtn =
    "hidden md:flex absolute top-1/2 -translate-y-1/2 z-10 w-8 h-8 items-center justify-center " +
    "rounded-full bg-card border border-border text-foreground shadow-sm transition-all " +
    "hover:bg-surface-overlay disabled:opacity-0 disabled:pointer-events-none";

  return (
    <div className="mb-3">
      <div className="relative">
        <div ref={ref} onScroll={onScroll}
          className="flex overflow-x-auto snap-x snap-mandatory gap-3 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
          {slides.map((s, i) => (
            <div key={i} className="min-w-full snap-center min-h-[180px]">{s}</div>
          ))}
        </div>
        {/* Desktop-only prev/next — mobile navigates by swipe. Hidden at the ends. */}
        <button type="button" aria-label="Previous" onClick={() => goTo(idx - 1)} disabled={idx === 0}
          className={cn(arrowBtn, "left-1.5")}>
          <ChevronLeft size={18} />
        </button>
        <button type="button" aria-label="Next" onClick={() => goTo(idx + 1)} disabled={idx >= slides.length - 1}
          className={cn(arrowBtn, "right-1.5")}>
          <ChevronRight size={18} />
        </button>
      </div>
      <div className="flex justify-center gap-1.5 mt-2">
        {slides.map((_, i) => (
          <button key={i} type="button" onClick={() => goTo(i)} aria-label={`Slide ${i + 1}`}
            className={cn("h-1.5 rounded-full transition-all", i === idx ? "w-4 bg-accent" : "w-1.5 bg-[#262626]")} />
        ))}
      </div>
    </div>
  );
}
