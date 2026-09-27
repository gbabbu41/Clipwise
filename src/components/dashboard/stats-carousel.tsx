"use client";

import { createPortal } from "react-dom";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import {
  BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, ResponsiveContainer, Tooltip,
} from "recharts";
import { ChevronLeft, ChevronRight, ChevronDown } from "lucide-react";
import { cn, formatCurrency } from "@/lib/utils";
import type { AppointmentWithDetails } from "@/lib/database.types";
import { bookingChartDays, bookingChartSeries, bookingReportRange } from "@/lib/booking-chart";

/**
 * Swipeable stats carousel — the dashboard's premium visual anchor. Real
 * scroll-snap slides (Revenue area chart, Bookings bars, Top barbers, Status
 * mix donut) with paging dots. All charts derive from the data already loaded.
 */
// This carousel uses a blue/neutral palette; status labels retain their meaning.
const CHART_COLORS = { bookings: "#6ea8fe", barbers: "#6ea8fe" } as const;
const SLIDE_NAMES = ["Revenue", "Bookings", "Top barbers", "Booking status"] as const;

export function StatsCarousel({
  revenue, taxCollected = 0, cashIncluded = 0, feesPaid = 0, tips = 0, commission = 0, netRevenue, feesLoading = false, feesUnavailable = false, paidVisits = 0, appointments, completed, topBarbers, filterControl, periodLabel, rangeStart, rangeEnd, initialSlide = 0, onSlideChange,
}: {
  revenue: number;         // COLLECTED = net after Stripe fees (incl. tax + cash + tips)
  taxCollected?: number;   // GST/HST + PST portion (subtracted in the waterfall — owed to gov't)
  cashIncluded?: number;   // cash portion of the total (shown as an "incl. cash" note)
  feesPaid?: number;       // Stripe processing fees deducted (Gross − fees = Collected)
  tips?: number;           // tips collected (the barber's — subtracted in the waterfall)
  commission?: number;     // barber commission tallied for the period (services only — subtracted)
  netRevenue?: number;     // what the shop KEEPS = Collected − tax − tips − commission
  feesLoading?: boolean;   // true until live Stripe fee data resolves → skeleton the Gross/fee rows
  feesUnavailable?: boolean; // revenue prop is gross, not net, while fees are unknown
  paidVisits?: number;     // paid appts in the window (money-moved basis) — reconciles with Collected
  appointments: AppointmentWithDetails[];
  completed: AppointmentWithDetails[];
  topBarbers: { name: string; revenue: number }[]; // precomputed by the page on the money-moved basis (incl. POS)
  periodLabel?: string;    // active date-filter label ("Today", "This Week", …)
  rangeStart: string;
  rangeEnd: string;
  filterControl?: ReactNode; // the date-filter (Today ▾) — overlaid at the first card's top-right
  initialSlide?: number;      // restores the slide a parent-level remount (e.g. a loading skeleton swap) would otherwise reset to 0
  onSlideChange?: (i: number) => void;
}) {
  // Fall back to computing net revenue locally if the parent didn't pass it. NOT
  // floored — a real loss shows as a red negative (see the Net row below).
  const netRev = netRevenue ?? (revenue - taxCollected - tips - commission);
  const [idx, setIdxState] = useState(initialSlide);
  const setIdx = (v: number | ((prev: number) => number)) => {
    setIdxState(prev => {
      const next = typeof v === "function" ? v(prev) : v;
      onSlideChange?.(next);
      return next;
    });
  };
  // Revenue card keeps a CALM default — Gross → − Stripe fees → Net — and tucks the
  // full breakdown (Collected, cash, tax, tips, commission) behind a tap.
  const [showBreakdown, setShowBreakdown] = useState(false);
  const hasBreakdown = cashIncluded > 0 || taxCollected > 0 || tips > 0 || commission > 0;
  const ref = useRef<HTMLDivElement>(null);

  // On mount, jump straight to the restored slide (no animation, before paint)
  // so a parent-level remount doesn't flash slide 1 before snapping over.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || initialSlide <= 0) return;
    const card = el.children[Math.min(initialSlide, el.children.length - 1)] as HTMLElement | undefined;
    const first = el.children[0] as HTMLElement | undefined;
    if (card && first) el.scrollLeft = card.offsetLeft - first.offsetLeft;
    // Restore-on-mount only — not a response to initialSlide changing later.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Datasets (from already-loaded data) ──
  const bookingsByDay = bookingChartDays(appointments, rangeStart, rangeEnd);
  const bookingSeries = bookingChartSeries(bookingsByDay);

  // Precomputed by the page on the SAME basis as the Collected headline (money-
  // moved paid appointments + POS), so this reconciles with slide 1 instead of the
  // old appointment-date, POS-excluding, unpaid-counting basis.
  const revenueByBarber = topBarbers;

  const statusMix = (() => {
    const labels: Record<string, { name: string; color: string }> = {
      completed: { name: "Completed", color: "#3f70ae" },
      confirmed: { name: "Confirmed", color: "#6ea8fe" },
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

  const onScroll = () => {
    const el = ref.current; if (!el) return;
    const cards = Array.from(el.children) as HTMLElement[];
    const offsets = cards.map(card => card.offsetLeft - cards[0].offsetLeft);
    setIdx(offsets.reduce((best, offset, i) => Math.abs(offset - el.scrollLeft) < Math.abs(offsets[best] - el.scrollLeft) ? i : best, 0));
  };
  const goTo = (i: number) => {
    const el = ref.current; if (!el) return;
    const card = el.children[Math.max(0, Math.min(i, el.children.length - 1))] as HTMLElement;
    const first = el.children[0] as HTMLElement;
    el.scrollTo({ left: card.offsetLeft - first.offsetLeft, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  };

  const Empty = () => <div className="h-full flex items-center justify-center text-xs text-grey">No data for this period</div>;
  const card = "cwd-stat bg-card rounded-2xl pt-[18px] px-[18px] pb-[14px] h-full flex flex-col";
  // Recharts still selects the hovered/touched datum, but details render in a
  // reserved row outside the plot so they cannot obscure bars, axes or legends.
  const detailRows = useRef<Array<HTMLDivElement | null>>([]);
  const chartDetail = (i: number, active: boolean | undefined, label: string, value: string) => {
    const target = detailRows.current[i];
    return active && idx === i + 1 && target ? createPortal(
      <div className="text-[11px] leading-4 text-foreground break-words">
        <span>{label}</span><span className="block font-mono tabular-nums">{value}</span>
      </div>, target,
    ) : null;
  };
  const detailRow = (i: number) => <div ref={el => { detailRows.current[i] = el; }}
    data-chart-detail aria-live="polite" className="min-h-[40px] shrink-0 pt-1" />;

  const slides = [
    // 1 — Revenue (area)
    <div key="rev" className={card}>
      {/* pr keeps the right side clear for the Today ▾ filter the parent overlays
          at the card's top-right corner. */}
      <p className="text-[10.5px] uppercase tracking-[0.16em] text-grey">{feesUnavailable ? "Gross collected" : "Collected"}</p>
      <p className="text-[34px] font-bold text-foreground font-mono tracking-[-0.02em] mt-1.5 leading-none">
        {formatCurrency(revenue)}
      </p>
      {/* Count is on the SAME money-moved basis as Collected (paid this period), so
          the two lines describe the same window. */}
      <span className="mt-1.5 block text-[12px] font-medium text-grey">
        {paidVisits > 0 ? `${paidVisits} paid` : "Nothing paid yet"}
      </span>
      {/* Spacer so the receipt ledger settles toward the bottom of the card and
          the empty state ($0) isn't top-heavy. (The old placeholder bar graph —
          which drew dummy bars with no data — was removed here.) */}
      <div className="flex-1 min-h-[8px]" />
      {/* Receipt ledger — the money waterfall, identical to Analytics & Payments:
          Gross → − Stripe fees → Collected → − sales tax → − tips → − barber
          commission → Net revenue (what the shop keeps). Zero lines are hidden so
          a solo/cash shop's receipt stays clean. */}
      {feesUnavailable && <p className="text-xs text-grey mt-3">{feesLoading ? "Checking processing fees…" : "Processing fees unavailable."} Net revenue is not calculated until fees are verified.</p>}
      {!feesUnavailable && revenue + feesPaid > 0 && (
        <div className="mt-3 border-t border-border pt-2.5 flex flex-col gap-1.5">
          {/* Gross + Stripe fees: skeleton until the live fee data resolves (so it
              doesn't briefly show Gross == Collected then jump); once loaded, the
              rows are hidden entirely on a no-fee (all-cash) day so Collected is the
              single top line. */}
          {feesLoading ? (
            <>
              <div className="flex justify-between text-[12px]"><span className="text-grey">Gross</span><span className="inline-block h-3 w-16 rounded bg-card-raised animate-pulse" /></div>
              <div className="flex justify-between text-[12px]"><span className="text-grey">− Stripe fees</span><span className="inline-block h-3 w-12 rounded bg-card-raised animate-pulse" /></div>
            </>
          ) : feesPaid > 0 ? (
            <>
              <div className="flex justify-between text-[12px]"><span className="text-grey">Gross</span><span className="font-mono tabular-nums text-foreground">{formatCurrency(revenue + feesPaid)}</span></div>
              <div className="flex justify-between text-[12px]"><span className="text-grey">− Stripe fees</span><span className="font-mono tabular-nums text-foreground">−{formatCurrency(feesPaid)}</span></div>
            </>
          ) : null}
          {/* The full breakdown (Collected, cash, tax, tips, commission) stays hidden
              until the owner taps "Show breakdown" — the default receipt is just
              Gross → − Stripe fees → Net revenue. */}
          {showBreakdown && (
            <>
              <div className={cn("flex justify-between text-[12px]", (feesLoading || feesPaid > 0) && "border-t border-dashed border-border pt-2")}><span className="text-foreground">Collected</span><span className="font-mono tabular-nums text-foreground">{formatCurrency(revenue)}</span></div>
              {cashIncluded > 0 && <div className="flex justify-between text-[11px] text-grey"><span>incl. cash</span><span className="font-mono tabular-nums">{formatCurrency(cashIncluded)}</span></div>}
              {taxCollected > 0 && <div className="flex justify-between text-[12px]"><span className="text-grey">− Sales tax</span><span className="font-mono tabular-nums text-foreground">−{formatCurrency(taxCollected)}</span></div>}
              {tips > 0 && <div className="flex justify-between text-[12px]"><span className="text-grey">− Tips</span><span className="font-mono tabular-nums text-foreground">−{formatCurrency(tips)}</span></div>}
              {commission > 0 && <div className="flex justify-between text-[12px]"><span className="text-grey">− Barber commission</span><span className="font-mono tabular-nums text-foreground">−{formatCurrency(commission)}</span></div>}
            </>
          )}
          <div className={cn("flex justify-between text-[12px]", (feesLoading || feesPaid > 0 || showBreakdown) && "border-t border-border pt-2")}><span className="text-foreground font-semibold">Net revenue</span><span className={cn("font-mono tabular-nums font-bold text-[14px]", netRev < 0 ? "text-red-400" : "text-foreground")}>{formatCurrency(netRev)}</span></div>
          {hasBreakdown && (
            <button type="button" aria-expanded={showBreakdown} onClick={() => setShowBreakdown(v => !v)}
              className="mt-1 self-center inline-flex items-center gap-1 text-[11px] text-grey hover:text-foreground transition-colors">
              {showBreakdown ? "Hide breakdown" : "Show breakdown"}
              <ChevronDown size={12} className={cn("transition-transform", showBreakdown && "rotate-180")} />
            </button>
          )}
        </div>
      )}
    </div>,

    // 2 — Bookings (bars)
    <div key="bk" className={card}>
      <p className="text-[10.5px] uppercase tracking-[0.16em] text-grey">Bookings</p>
      <p className="text-[34px] font-bold text-foreground font-mono tracking-[-0.02em] mt-1.5 leading-none">{totalBookings}</p>
      <p className="text-xs mt-1 font-medium text-grey">
        {hasCompleted
          ? `${completed.length} completed`
          : totalBookings > 0 ? "0 completed" : "No bookings yet"}
      </p>
      <div className="flex-1 min-h-[96px] mt-1 -mx-1">
        {bookingsByDay.some(day => day.count > 0) ? (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart key={`${rangeStart}:${rangeEnd}`} data={bookingSeries} margin={{ top: 6, right: 8, left: 8, bottom: 0 }}>
              <XAxis dataKey="day" tick={{ fontSize: 9, fill: "var(--grey)" }} interval="preserveStartEnd" minTickGap={24} axisLine={false} tickLine={false} />
              <Bar dataKey="count" fill={CHART_COLORS.bookings} radius={[4, 4, 0, 0]} maxBarSize={26} isAnimationActive={false} />
              <Tooltip isAnimationActive={false} cursor={false} content={({ active, payload }) => {
                const row = payload?.[0]?.payload;
                return chartDetail(0, active && !!row, row ? bookingReportRange(row.date, row.endDate) : "", `Bookings: ${row?.count ?? 0}`);
              }} />
            </BarChart>
          </ResponsiveContainer>
        ) : <Empty />}
      </div>
      {detailRow(0)}
      {bookingsByDay.length > 45 && <p className="text-[11px] text-grey mt-1">Monthly bookings</p>}
    </div>,

    // 3 — Top barbers (horizontal bars)
    <div key="tb" className={card}>
      <p className="text-[10.5px] uppercase tracking-[0.16em] text-grey">Top barbers</p>
      <p className="text-xs text-grey mt-1">Service revenue</p>
      <div className="flex-1 min-h-[112px] mt-2">
        {revenueByBarber.length > 0 ? (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart key={`${rangeStart}:${rangeEnd}`} data={revenueByBarber} layout="vertical" margin={{ top: 4, right: 12, left: 4, bottom: 0 }}>
              <XAxis type="number" hide />
              <YAxis type="category" dataKey="name" width={56} tick={{ fontSize: 11, fill: "var(--grey)" }} axisLine={false} tickLine={false} />
              <Bar dataKey="revenue" fill={CHART_COLORS.barbers} maxBarSize={28} radius={[0, 4, 4, 0]} isAnimationActive={false} />
              <Tooltip isAnimationActive={false} cursor={false} content={({ active, payload }) => {
                const row = payload?.[0]?.payload;
                return chartDetail(1, active && !!row, row?.name ?? "", `Revenue: ${formatCurrency(row?.revenue ?? 0)}`);
              }} />
            </BarChart>
          </ResponsiveContainer>
        ) : <Empty />}
      </div>
      {detailRow(1)}
    </div>,

    // 4 — Status mix (donut)
    <div key="st" className={card}>
      <p className="text-[10.5px] uppercase tracking-[0.16em] text-grey">Booking status</p>
      <div className="flex-1 min-h-[112px] mt-2 flex items-center">
        {statusMix.length > 0 ? (
          <>
            <div className="w-1/2 h-[120px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart key={`${rangeStart}:${rangeEnd}`}>
                  <Pie data={statusMix} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={32} outerRadius={52} paddingAngle={2} stroke="none" isAnimationActive={false}>
                    {statusMix.map((s, i) => <Cell key={i} fill={s.color} />)}
                  </Pie>
                  <Tooltip isAnimationActive={false} content={({ active, payload }) => {
                    const row = payload?.[0]?.payload;
                    return chartDetail(2, active && !!row, row?.name ?? "", `Bookings: ${row?.value ?? 0}`);
                  }} />
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
      {detailRow(2)}
    </div>,
  ];

  const arrowBtn =
    "hidden md:flex absolute top-1/2 -translate-y-1/2 z-10 w-8 h-8 items-center justify-center " +
    "rounded-full bg-card border border-border text-foreground shadow-sm transition-all " +
    "hover:bg-surface-overlay disabled:opacity-0 disabled:pointer-events-none";

  return (
    <div className="mb-3">
      <p className="text-xs text-grey mb-2" aria-label="Reporting period">{bookingReportRange(rangeStart, rangeEnd)}</p>
      <div className="relative">
        {/* py + -my gives the card's elevation shadow room to render INSIDE the
            scroll viewport (overflow clips at the padding edge), then pulls the
            box back so layout doesn't move — so the carousel card shows the SAME
            soft shadow as the KPI cards instead of needing a border. */}
        <div ref={ref} onScroll={onScroll}
          role="region" aria-roledescription="carousel" aria-label="Shop stats" tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "ArrowRight") { e.preventDefault(); goTo(Math.min(idx + 1, slides.length - 1)); }
            else if (e.key === "ArrowLeft") { e.preventDefault(); goTo(Math.max(idx - 1, 0)); }
          }}
          className="flex overflow-x-auto snap-x snap-mandatory gap-3 py-5 -my-4 rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-accent/50 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
          {/* min-h holds the tallest (populated slide 1 with the full ledger) so the
              carousel doesn't shrink/grow as the period filter changes. */}
          {slides.map((s, i) => (
            <div key={i} className="min-w-full snap-center min-h-[232px]">{s}</div>
          ))}
        </div>
        {/* Announce the current slide to screen readers as it changes. */}
        <div className="sr-only" aria-live="polite">{SLIDE_NAMES[idx]}</div>
        {/* Desktop-only prev/next — mobile navigates by swipe. Hidden at the ends. */}
        <button type="button" aria-label="Previous" onClick={() => goTo(idx - 1)} disabled={idx === 0}
          className={cn(arrowBtn, "left-1.5")}>
          <ChevronLeft size={18} />
        </button>
        <button type="button" aria-label="Next" onClick={() => goTo(idx + 1)} disabled={idx >= slides.length - 1}
          className={cn(arrowBtn, "right-1.5")}>
          <ChevronRight size={18} />
        </button>
        {/* Date filter (Today ▾) overlaid at the first card's top-right — rendered
            OUTSIDE the scroll container so its dropdown/date-picker aren't clipped
            by the carousel's overflow. Last child so it paints above the slides. */}
        {filterControl && (
          <div className="absolute right-[18px] top-[13px]">{filterControl}</div>
        )}
      </div>
      <div className="flex justify-center gap-1 mt-2">
        {slides.map((_, i) => (
          <button key={i} type="button" onClick={() => goTo(i)} aria-label={SLIDE_NAMES[i] ?? `Slide ${i + 1}`} aria-current={i === idx ? "true" : undefined}
            className="h-8 w-8 flex items-center justify-center rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2">
            <span className={cn("h-1.5 rounded-full transition-all", i === idx ? "w-4 bg-accent" : "w-1.5 bg-border-strong")} />
          </button>
        ))}
      </div>
      <details className="text-xs text-grey mt-1">
        <summary className="cursor-pointer py-2 w-fit">Chart data</summary>
        <p className="py-2">{periodLabel ?? "Selected period"}. Collected includes paid sales; bookings follow appointment dates. Average ticket covers paid, completed visits only. Barber revenue excludes tax and tips, before processing fees.</p>
        <div className="grid sm:grid-cols-2 gap-4 py-2">
          <table className="w-full text-left"><caption className="text-left font-medium mb-2">Daily bookings · full reporting period</caption><thead><tr><th scope="col">Date</th><th scope="col" className="text-right">Bookings</th></tr></thead><tbody>{bookingsByDay.map(d => <tr key={d.date}><th scope="row" className="font-normal py-1">{d.date}</th><td className="text-right tabular-nums">{d.count}</td></tr>)}</tbody></table>
          <table className="w-full text-left"><caption className="text-left font-medium mb-2">Top barbers · service revenue (CAD)</caption><thead><tr><th scope="col">Barber</th><th scope="col" className="text-right">Revenue</th></tr></thead><tbody>{topBarbers.map((b, i) => <tr key={i}><th scope="row" className="font-normal py-1">{b.name}</th><td className="text-right tabular-nums">{formatCurrency(b.revenue)}</td></tr>)}</tbody></table>
        </div>
      </details>
    </div>
  );
}
