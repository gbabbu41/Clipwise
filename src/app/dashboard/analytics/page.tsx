"use client";
import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { BarChart3, Building2 } from "lucide-react";
import {
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/lib/supabase";
import { AvatarImage } from "@/components/ui/avatar-image";
import { cn, formatCurrency } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { effectivePlan, isPaidPlan } from "@/lib/validation";
import { FeatureLock } from "@/components/dashboard/feature-lock";
import { collectedTotals, countablePosTxs, isNoShowTx, isPaid, type RevAppt, type RevTx, type ByPi } from "@/lib/revenue";
import { analyticsPeriod, analyticsRevenueBuckets, analyticsFeesKnown, timestampInPeriod, topServicesWithOther } from "@/lib/analytics-period";
import { readAllRows } from "@/lib/read-all-rows";
import { safeCommission } from "@/lib/barber-earnings";
import type { Transaction, Appointment, Barber } from "@/lib/database.types";

// Theme-aware (recharts renders inside `.portal`, so the CSS vars resolve to the
// active theme). Was hardcoded dark — a black tooltip floating over the light UI.
const DARK_TOOLTIP = {
  contentStyle: { background: "var(--card)", border: "1px solid var(--border)", borderRadius: 12, color: "var(--foreground)", fontSize: 12 },
  cursor: { fill: "rgba(20,22,28,0.05)" },
};
// Chart palette — medium tones chosen to read on BOTH the dark and light theme
// (the old cream/white marks vanished on the white light-theme plot).
const GOLD_PALETTE = ["#4a86d8","#2f9e6b","#d99a2e","#8b7bd6","#e07a5f","#64748b"];

// Service ACTUALLY COLLECTED on a paid appointment, pre-tax — subtract any still-
// owed balance_due and scale the tax to the collected fraction. Identical to the
// Dashboard's apptServiceCollected, so charts + commission share ONE basis.
function apptServiceCollectedOf(a: { total_amount?: number | null; tax_amount?: number | null; balance_due?: number | null }): number {
  const total = Math.max(0, a.total_amount ?? 0);
  const bal = Math.min(Math.max(0, a.balance_due ?? 0), total);
  const collectedTotal = Math.max(0, total - bal);
  const collectedTax = total > 0 ? (a.tax_amount ?? 0) * (collectedTotal / total) : (a.tax_amount ?? 0);
  return Math.max(0, collectedTotal - collectedTax);
}
const STATUS_COLORS: Record<string, string> = {
  completed: "#10B981", confirmed: "#4a86d8", pending: "#F59E0B",
  cancelled: "#EF4444", "no-show": "#F97316",
};

function Toast({ message, onClose }: { message: string; onClose: () => void }) {
  return (
    <div className="fixed bottom-6 right-6 z-[100] bg-card-raised border border-border rounded-xl px-5 py-3 text-sm text-foreground shadow-xl flex items-center gap-3">
      <span className="text-foreground">↓</span>{message}
      <button onClick={onClose} className="text-grey hover:text-foreground ml-2">✕</button>
    </div>
  );
}

function SkeletonCard() {
  return <div className="h-28 rounded-2xl bg-card-raised animate-pulse" />;
}



function ChartDataTable({ caption, rows }: { caption: string; rows: { label: string; value: number }[] }) {
  return <details className="mt-3 text-xs text-grey"><summary className="cursor-pointer">View data table</summary>
    <div className="max-h-64 overflow-auto mt-2"><table className="w-full text-left"><caption className="sr-only">{caption}</caption>
      <thead><tr><th scope="col" className="py-2">Category</th><th scope="col" className="py-2 text-right">Amount (CAD)</th></tr></thead>
      <tbody>{rows.map((row, index) => <tr key={index}><th scope="row" className="py-1 font-normal">{row.label}</th><td className="text-right font-mono">{formatCurrency(row.value)}</td></tr>)}</tbody>
    </table></div>
  </details>;
}

export default function AnalyticsPage() {
  const { shop, accessToken } = useAuth();
  const [period, setPeriod] = useState("month");
  const [barberFilter, setBarberFilter] = useState("all");
  const [toast, setToast] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [loadedKey, setLoadedKey] = useState("");
  const requestVersion = useRef(0);
  const range = useMemo(() => analyticsPeriod(period), [period]);
  const dataKey = `${shop?.id ?? ""}:${period}`;
  // Real Stripe fees per charge (paymentIntent → {gross, fee, net}) — same source
  // the Dashboard/Payments use, so the "− Stripe fee" line here is the actual fee,
  // not a guess, and the waterfall reconciles to the Collected number.
  const [byPi, setByPi] = useState<ByPi>({});

  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  // Paid/captured appointments for the money waterfall — counted by paid_at
  // (money-moved), not booked date. `appointments` above stays booked-date for
  // operational metrics (completed count, no-shows, avg ticket).
  const [revenueAppts, setRevenueAppts] = useState<Appointment[]>([]);
  const [barbers, setBarbers] = useState<Barber[]>([]);
  // id → name lookup so the appointments fallback for "Revenue by Service"
  // shows real service names instead of raw service_id UUIDs.
  const [serviceNames, setServiceNames] = useState<Record<string, string>>({});

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(""), 3000); };

  const loadData = useCallback(async () => {
    const version = ++requestVersion.current;
    setLoading(true);
    setLoadError("");
    setLoadedKey("");
    setByPi({});
    if (!shop?.id || !accessToken) {
      if (shop?.id) setLoadError("Analytics needs an active session. Please try again.");
      setLoading(false); return;
    }
    try {
      const [txRes, apptRes, barberRes, svcRes, revApptRes, feeResponse] = await Promise.all([
        readAllRows<Transaction>((from, to) => supabase.from("transactions").select("*").eq("shop_id", shop.id).gte("created_at", range.startIso).lt("created_at", range.endIso).order("created_at").order("id").range(from, to)),
        readAllRows<Appointment>((from, to) => supabase.from("appointments").select("*").eq("shop_id", shop.id).gte("date", range.startDate).lt("date", range.endDate).order("date").order("id").range(from, to)),
        // Historical payments still owe commission/tips to inactive barbers.
        readAllRows<Barber>((from, to) => supabase.from("barbers").select("*").eq("shop_id", shop.id).order("name").order("id").range(from, to)),
        readAllRows<{ id: string; name: string }>((from, to) => supabase.from("services").select("id, name").eq("shop_id", shop.id).order("id").range(from, to)),
        readAllRows<Appointment>((from, to) => supabase.from("appointments").select("*").eq("shop_id", shop.id).in("payment_status", ["paid", "captured"]).or(`and(paid_at.gte.${range.startIso},paid_at.lt.${range.endIso}),and(paid_at.is.null,created_at.gte.${range.startIso},created_at.lt.${range.endIso})`).order("created_at").order("id").range(from, to)),
        fetch("/api/stripe/payments-summary", {
          method: "POST",
          headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
          body: JSON.stringify({ shop_id: shop.id }),
          signal: AbortSignal.timeout(15000),
        }),
      ]);
      if (!feeResponse.ok) throw new Error("Fees unavailable");
      const fees = await feeResponse.json();
      if (!fees.byPi || (fees.error && !fees.feesReady)) throw new Error("Fees unavailable");
      if (version !== requestVersion.current) return;
      setTransactions(txRes);
      setAppointments(apptRes);
      setRevenueAppts(revApptRes);
      setBarbers(barberRes);
      setBarberFilter(current => current === "all" || barberRes.some(b => b.id === current) ? current : "all");
      setServiceNames(Object.fromEntries(svcRes.map(service => [service.id, service.name])));
      setByPi(fees.byPi);
      setLoadedKey(`${shop.id}:${period}`);
    } catch {
      if (version === requestVersion.current) setLoadError("Analytics could not be loaded. Revenue and fees are unavailable. Please try again.");
    } finally {
      if (version === requestVersion.current) setLoading(false);
    }
  }, [shop?.id, accessToken, period, range]);

  useEffect(() => {
    void loadData();
    return () => { requestVersion.current += 1; };
  }, [loadData]);

  const filteredTx = useMemo(() => transactions.filter(t =>
    !t.refunded && (barberFilter === "all" || t.barber_id === barberFilter) && timestampInPeriod(t.created_at, range)
  ), [transactions, barberFilter, range]);
  const filteredAppts = useMemo(() => appointments.filter(a =>
    (barberFilter === "all" || a.barber_id === barberFilter) && a.date >= range.startDate && a.date < range.endDate
  ), [appointments, barberFilter, range]);
  const revenueApptsInRange = useMemo(() => revenueAppts.filter(a =>
    (barberFilter === "all" || a.barber_id === barberFilter) && timestampInPeriod(a.paid_at ?? a.created_at, range)
  ), [revenueAppts, barberFilter, range]);
  const buckets = useMemo(() => analyticsRevenueBuckets(revenueApptsInRange, filteredTx as RevTx[], range), [revenueApptsInRange, filteredTx, range]);
  const revenueByDay = buckets.daily;
  const hourlyRevenue = buckets.hourly;
  const dataReady = !loading && !loadError && loadedKey === dataKey;
  const feesKnown = useMemo(() => analyticsFeesKnown(revenueApptsInRange, filteredTx as RevTx[], byPi), [revenueApptsInRange, filteredTx, byPi]);

  // KPIs — the money waterfall, all from the SAME shared calculator the Dashboard
  // + Payments use (so no screen can show a different number):
  //   Gross sales → − Stripe fee → − Tax → − Tips → − Barber commission → Net revenue
  const money = useMemo(() => {
    // Owner-barber's own tips are the owner's money (like their 0-commission chair),
    // so split them out and keep them IN net revenue — see the Dashboard fix.
    const ownerBarberId = (barbers.find(b => (b as { user_id?: string | null }).user_id === shop?.owner_id)?.id) ?? null;
    const t = collectedTotals(revenueApptsInRange as RevAppt[], filteredTx as RevTx[], byPi, ownerBarberId);
    // Barber commission tallied over the SAME sales `collected` counts (same as the
    // Dashboard + Payroll), so Net reconciles: paid appointments → (total − tax) ×
    // that barber's rate; counted POS sales with a barber → the stored cut.
    // Completion rows are taken from the appointment, and no-show fees never pay
    // commission.
    const pct: Record<string, number> = Object.fromEntries(barbers.map(b => [b.id, b.commission_percent ?? 0]));
    // Commission follows the money ACTUALLY collected: a price edited above the
    // held card captures less than total_amount, leaving a balance_due. Base the
    // cut on (total − balance_due) − the tax on that collected part; it rises to
    // the full amount once the balance is collected (balance_due → 0). Matches the
    // Dashboard fix + collectedTotals.
    const apptCommission = revenueApptsInRange.reduce((sum, a) => {
      if (!isPaid(a.payment_status) || a.status === "no-show" || !a.barber_id) return sum;
      return sum + (apptServiceCollectedOf(a) * (pct[a.barber_id] ?? 0)) / 100;
    }, 0);
    const posCommission = countablePosTxs(revenueApptsInRange as RevAppt[], filteredTx as RevTx[]).reduce((sum, t2) => {
      if (t2.refunded || !t2.barber_id || isNoShowTx(t2) || t2.source === "completion") return sum;
      const p = pct[t2.barber_id] ?? 0;
      return sum + safeCommission(t2.amount, t2.commission_amount, p);
    }, 0);
    const commission = apptCommission + posCommission;
    // Net revenue = what the shop actually keeps: after Stripe fees (that's `net`),
    // then minus tax (govt), tips (barber), and barber commission (barber/owner).
    // NOT floored at 0 — mirrors the Dashboard, which shows a real negative (e.g. a
    // price raised above the held card) instead of hiding it behind a clamp.
    const paidOutTips = Math.max(0, t.tips - t.ownerTips);
    const netRevenue = t.net - t.tax - paidOutTips - commission;
    return { gross: t.gross, fees: t.fees, collected: t.net, tax: t.tax, tips: paidOutTips, totalTips: t.tips, commission, netRevenue };
  }, [revenueApptsInRange, filteredTx, byPi, barbers, shop?.owner_id]);
  const totalRevenue = money.gross;
  const totalAppts = filteredAppts.length;
  const completedAppts = filteredAppts.filter(a => a.status === "completed").length;
  const noShows = filteredAppts.filter(a => a.status === "no-show").length;
  // Rate = no-shows ÷ appointments that were SUPPOSED to happen. Cancellations
  // (cancelled in advance) are excluded from the denominator — same as the
  // Dashboard, so the two screens report the same no-show rate.
  const scheduledCount = filteredAppts.filter(a => a.status !== "cancelled").length;
  const noShowRate = scheduledCount > 0 ? ((noShows / scheduledCount) * 100).toFixed(1) : "0.0";
  // Avg ticket = pre-tax SERVICE revenue per completed appointment (matches the
  // Dashboard). Using gross (which includes POS, tips, tax) over an appointment
  // count inflated it.
  const completedApptRevenue = filteredAppts
    .filter(a => a.status === "completed" && a.payment_status !== "refunded")
    .reduce((s, a) => s + Math.max(0, (a.total_amount ?? 0) - (a.tax_amount ?? 0)), 0);
  const avgTicket = completedAppts > 0 ? completedApptRevenue / completedAppts : 0;

  // Revenue by barber — SAME basis as the money headline + the Dashboard's top
  // barbers: collected service on paid appointments (money-moved) + POS sales,
  // de-duped (completion/no-show excluded). No longer the raw tx sum (which mixed
  // date bases and could double-count completion rows against the appointment).
  const barberRevenue = useMemo(() => {
    const map: Record<string, number> = {};
    for (const a of revenueApptsInRange) {
      if (!isPaid(a.payment_status) || a.status === "no-show" || !a.barber_id) continue;
      map[a.barber_id] = (map[a.barber_id] ?? 0) + apptServiceCollectedOf(a);
    }
    for (const t of countablePosTxs(revenueApptsInRange as RevAppt[], filteredTx as RevTx[])) {
      if (t.refunded || !t.barber_id || isNoShowTx(t) || t.source === "completion") continue;
      map[t.barber_id] = (map[t.barber_id] ?? 0) + Math.max(0, t.amount ?? 0);
    }
    return barbers.map(b => ({ name: b.name, revenue: map[b.id] ?? 0 })).filter(b => b.revenue > 0);
  }, [revenueApptsInRange, filteredTx, barbers]);

  // Revenue by service name — same collected basis: paid appointments (by service)
  // + POS sales (by service_name), completion/no-show excluded so nothing double-
  // counts against the appointment it belongs to.
  const serviceRevenue = useMemo(() => {
    const map: Record<string, number> = {};
    for (const a of revenueApptsInRange) {
      if (!isPaid(a.payment_status) || a.status === "no-show") continue;
      const key = (a.service_id && serviceNames[a.service_id]) || "Service";
      map[key] = (map[key] ?? 0) + apptServiceCollectedOf(a);
    }
    for (const t of countablePosTxs(revenueApptsInRange as RevAppt[], filteredTx as RevTx[])) {
      if (t.refunded || isNoShowTx(t) || t.source === "completion") continue;
      const key = t.service_name || "Sale";
      map[key] = (map[key] ?? 0) + Math.max(0, t.amount ?? 0);
    }
    return topServicesWithOther(map)
      .map(({ name, value }, i) => ({ name, value, color: GOLD_PALETTE[i] ?? "#666" }));
  }, [revenueApptsInRange, filteredTx, serviceNames]);

  // Appointment status breakdown
  const apptStatuses = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const a of filteredAppts) {
      counts[a.status] = (counts[a.status] ?? 0) + 1;
    }
    return Object.entries(counts).map(([name, count]) => ({
      name: name.charAt(0).toUpperCase() + name.slice(1),
      value: Math.round((count / totalAppts) * 100) || 0,
      color: STATUS_COLORS[name] ?? "#666",
    }));
  }, [filteredAppts, totalAppts]);

  // Top barber
  const topBarber = barberRevenue.length > 0 ? barberRevenue.reduce((a, b) => a.revenue > b.revenue ? a : b) : null;
  // Top service
  const topService = serviceRevenue[0];

  const kpis = [
    { label: "Gross sales", value: formatCurrency(totalRevenue), sub: `before Stripe fees`, color: "text-foreground" },
    { label: "Total Appointments", value: String(totalAppts), sub: `${completedAppts} completed`, color: "text-foreground" },
    { label: "Avg Ticket Size", value: formatCurrency(avgTicket), sub: "Per completed appt", color: "text-foreground" },
    { label: "No-Show Rate", value: `${noShowRate}%`, sub: "Excludes cancelled appointments", color: "text-orange-400" },
    { label: "Top Barber", value: topBarber?.name ?? "—", sub: topBarber ? formatCurrency(topBarber.revenue) : "No data", color: "text-foreground" },
    { label: "Top Service", value: topService?.name ?? "—", sub: topService ? formatCurrency(topService.value) : "No data", color: "text-foreground" },
    { label: "Transactions", value: String(filteredTx.length), sub: "POS + walk-ins", color: "text-emerald-400" },
    { label: "Tips Collected", value: formatCurrency(money.totalTips), sub: "Includes owner tips", color: "text-foreground" },
    { label: "Tax Collected", value: formatCurrency(money.tax), sub: "GST/HST + PST to remit", color: "text-foreground" },
  ];

  if (shop && !isPaidPlan(effectivePlan(shop.subscription_plan, shop.subscription_status))) {
    return <FeatureLock title="Analytics" description="Business analytics are available on the Pro plan and up." />;
  }
  if (!shop) {
    return (
      <div className="p-8 flex flex-col items-center justify-center min-h-[60vh] text-center">
        <div className="w-12 h-12 rounded-full bg-card-raised flex items-center justify-center mx-auto mb-3 text-grey"><Building2 size={22} /></div>
        <h2 className="text-lg font-bold text-foreground mb-1">No shop linked</h2>
        <p className="text-sm text-grey">Analytics will appear here once your shop is active.</p>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {toast && <Toast message={toast} onClose={() => setToast("")} />}

      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground uppercase tracking-wide">Analytics</h1>
          <p className="text-sm text-grey mt-0.5">Business performance overview · Browser-local dates, current periods through today (weeks start Monday)</p>
        </div>
        <Button variant="outline" size="sm" disabled={!dataReady} onClick={() => {
          const rows = [
            ["Date", "Client", "Service", "Barber", "Status", "Amount"],
            ...filteredAppts.map(a => [
              a.date, a.client_name,
              ((a as unknown as { services?: { name?: string } }).services)?.name ?? "",
              ((a as unknown as { barbers?: { name?: string } }).barbers)?.name ?? "",
              a.status,
              a.total_amount,
            ]),
          ];
          const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
          const blob = new Blob([csv], { type: "text/csv" });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url; a.download = `clipwise-appointments-${period}.csv`; a.click();
          URL.revokeObjectURL(url);
          showToast("CSV exported!");
        }}>Export CSV</Button>
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap gap-3">
        <div className="flex rounded-xl border border-border overflow-x-auto max-w-full [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {[["today","Today"],["week","This Week"],["month","This Month"],["year","This Year"],["last","Last Month"]].map(([v,l]) => (
            <button key={v} aria-pressed={period === v} onClick={() => setPeriod(v)}
              className={cn("px-3 py-2 text-xs font-medium whitespace-nowrap shrink-0 transition-colors", period === v ? "bg-foreground text-background" : "text-grey hover:text-foreground bg-card-raised")}>
              {l}
            </button>
          ))}
        </div>
        <select aria-label="Filter by barber" value={barberFilter} onChange={e => setBarberFilter(e.target.value)}
          className="rounded-xl border border-border bg-card-raised px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-black/20">
          <option value="all">Shop (all barbers)</option>
          {barbers.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
      </div>

      {loadError && <Card><CardContent className="py-6"><p role="alert" className="text-sm text-grey">{loadError}</p><Button variant="outline" size="sm" className="mt-3" onClick={() => void loadData()}>Retry analytics</Button></CardContent></Card>}
      {/* KPI Cards */}
      {!dataReady && !loadError ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      ) : dataReady ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {kpis.map(k => (
            <Card key={k.label} className="py-4 px-5">
              <p className="text-xs text-grey">{k.label}</p>
              <p className={cn("text-2xl font-bold mt-1", k.color)}>{k.value}</p>
              <p className="text-xs text-grey mt-1">{k.sub}</p>
            </Card>
          ))}
        </div>
      ) : null}

      {/* Money waterfall — Gross → fees → tax → tips → barber → what the shop keeps.
          Uses the same numbers as the Dashboard/Payments (Collected = gross − fees). */}
      {dataReady && money.gross > 0 && (
        <Card>
          <CardHeader><CardTitle>Where the money goes</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-grey">Gross sales</span><span className="font-mono tabular-nums text-foreground">{formatCurrency(money.gross)}</span></div>
              <div className="flex justify-between"><span className="text-grey">− Stripe fees</span><span className="font-mono tabular-nums text-foreground">{feesKnown ? `−${formatCurrency(money.fees)}` : "Unavailable"}</span></div>
              <div className="flex justify-between border-t border-dashed border-border pt-2"><span className="text-grey">Collected <span className="text-grey-muted">(after Stripe fees)</span></span><span className="font-mono tabular-nums text-foreground">{feesKnown ? formatCurrency(money.collected) : "Unavailable"}</span></div>
              <div className="flex justify-between"><span className="text-grey">− Sales tax <span className="text-grey-muted">(owed to gov&apos;t)</span></span><span className="font-mono tabular-nums text-foreground">−{formatCurrency(money.tax)}</span></div>
              <div className="flex justify-between"><span className="text-grey">− Staff tips <span className="text-grey-muted">(excludes owner tips)</span></span><span className="font-mono tabular-nums text-foreground">−{formatCurrency(money.tips)}</span></div>
              <div className="flex justify-between"><span className="text-grey">− Barber commission</span><span className="font-mono tabular-nums text-foreground">−{formatCurrency(money.commission)}</span></div>
              <div className="flex justify-between border-t border-border pt-2"><span className="text-foreground font-semibold">Net revenue <span className="text-grey-muted font-normal">(you keep)</span></span><span className="font-mono tabular-nums font-bold text-emerald-400 text-base">{feesKnown ? formatCurrency(money.netRevenue) : "Unavailable"}</span></div>
            </div>
            {!feesKnown && <p role="status" className="text-xs text-grey mt-3">Stripe fee details are still missing for some payments. Fees and net totals will appear when available. <button className="underline" onClick={() => void loadData()}>Retry</button></p>}
            <p className="text-[11px] text-grey mt-3 leading-relaxed">
              Gross sales includes sales tax and all collected tips. Staff tips and commission are deducted here; owner tips remain in net revenue.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Revenue Over Time */}
      {dataReady && (
        <Card>
          <CardHeader><CardTitle>Gross Sales Over Time</CardTitle></CardHeader>
          <CardContent>
            <p className="text-xs text-grey mb-3">{formatCurrency(money.gross)} CAD collected in this period, including tax and tips. Payment dates use your browser&apos;s local time; bookings without a payment timestamp use their creation time.</p>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart accessibilityLayer data={revenueByDay} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="label" tick={{ fill: "var(--grey)", fontSize: 11 }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fill: "var(--grey)", fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={v => `$${v}`} />
                <Tooltip {...DARK_TOOLTIP} formatter={(v) => [`$${v}`, "Revenue"]} />
                <Line type="monotone" dataKey="revenue" stroke="#4a86d8" strokeWidth={2} dot={revenueByDay.length === 1} />
              </LineChart>
            </ResponsiveContainer>
            <ChartDataTable caption="Gross sales by payment date in CAD" rows={revenueByDay.map(d => ({ label: d.date, value: d.revenue }))} />
          </CardContent>
        </Card>
      )}

      {dataReady && money.gross === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <div className="w-12 h-12 rounded-full bg-card-raised flex items-center justify-center mx-auto mb-3 text-grey"><BarChart3 size={22} /></div>
            <p className="text-grey text-sm">No data yet for this period. Complete appointments or process POS transactions to see analytics.</p>
          </CardContent>
        </Card>
      )}

      {dataReady && (barberRevenue.length > 0 || serviceRevenue.length > 0 || totalAppts > 0 || money.gross > 0) && (
        <div className="grid md:grid-cols-2 gap-6">
          {barberRevenue.length > 0 && (
            <Card>
              <CardHeader><CardTitle>Collected Service Sales by Barber</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart accessibilityLayer data={barberRevenue} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis dataKey="name" tick={{ fill: "var(--grey)", fontSize: 12 }} tickLine={false} axisLine={false} />
                    <YAxis tick={{ fill: "var(--grey)", fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={v => `$${v}`} />
                    <Tooltip {...DARK_TOOLTIP} formatter={(v) => [`$${v}`, "Revenue"]} />
                    <Bar dataKey="revenue" fill="#4a86d8" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
                <ChartDataTable caption="Collected service sales by barber in CAD" rows={barberRevenue.map(b => ({ label: b.name, value: b.revenue }))} />
              </CardContent>
            </Card>
          )}

          {serviceRevenue.length > 0 && (
            <Card>
              <CardHeader><CardTitle>Collected Sales by Service</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart>
                    <Pie data={serviceRevenue} cx="50%" cy="50%" outerRadius={75} dataKey="value" nameKey="name"
                      label={({ name, percent }: { name?: string; percent?: number }) => `${name ?? ""} ${((percent ?? 0) * 100).toFixed(0)}%`}
                      labelLine={false} fontSize={10}>
                      {serviceRevenue.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                    </Pie>
                    <Tooltip {...DARK_TOOLTIP} formatter={(v) => [`$${v}`, "Revenue"]} />
                  </PieChart>
                </ResponsiveContainer>
                <ChartDataTable caption="Collected sales by service in CAD" rows={serviceRevenue.map(s => ({ label: s.name, value: s.value }))} />
              </CardContent>
            </Card>
          )}

          {apptStatuses.length > 0 && (
            <Card>
              <CardHeader><CardTitle>Appointment Status Breakdown</CardTitle></CardHeader>
              <CardContent>
                <div className="flex items-center gap-6">
                  <ResponsiveContainer width="50%" height={180}>
                    <PieChart>
                      <Pie data={apptStatuses} cx="50%" cy="50%" innerRadius={45} outerRadius={70} dataKey="value">
                        {apptStatuses.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                      </Pie>
                      <Tooltip {...DARK_TOOLTIP} formatter={(v) => [`${v}%`, "Share"]} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="space-y-2">
                    {apptStatuses.map(s => (
                      <div key={s.name} className="flex items-center gap-2">
                        <div className="w-2.5 h-2.5 rounded-full" style={{ background: s.color }} />
                        <span className="text-xs text-grey">{s.name}</span>
                        <span className="text-xs text-grey ml-auto">{s.value}%</span>
                      </div>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {money.gross > 0 && (
            <Card>
              <CardHeader><CardTitle>Gross Sales by Payment Hour</CardTitle></CardHeader>
              <CardContent><p className="text-xs text-grey mb-3">CAD collected across each hour in browser-local time; includes tax and tips.</p>
                <ResponsiveContainer width="100%" height={180}>
                  <BarChart accessibilityLayer data={hourlyRevenue} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis dataKey="hour" tick={{ fill: "var(--grey)", fontSize: 11 }} tickLine={false} axisLine={false} />
                    <YAxis tick={{ fill: "var(--grey)", fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={v => `$${v}`} />
                    <Tooltip {...DARK_TOOLTIP} formatter={(v) => [`$${v}`, "Revenue"]} />
                    <Bar dataKey="revenue" fill="#94a3b8" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
                <ChartDataTable caption="Gross sales by payment hour in CAD" rows={hourlyRevenue.map(h => ({ label: h.hour, value: h.revenue }))} />
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Staff Performance Table */}
      {dataReady && barbers.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Staff Performance</CardTitle></CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border">
                    {["Barber", "Appointments", "Completed", "No-Shows", "Completed Service Value", "Avg Ticket", "Completion Rate"].map(h => (
                      <th key={h} className="text-left text-xs font-medium text-grey px-3 py-2">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {barbers.map(b => {
                    const bAppts = filteredAppts.filter(a => a.barber_id === b.id);
                    const bCompleted = bAppts.filter(a => a.status === "completed");
                    const bNoShows = bAppts.filter(a => a.status === "no-show").length;
                    // Revenue excludes refunded completed appts (money handed back);
                    // the completed COUNT keeps them (the service was still rendered).
                    const bRevenue = bCompleted.filter(a => a.payment_status !== "refunded").reduce((s, a) => s + Math.max(0, (a.total_amount ?? 0) - (a.tax_amount ?? 0)), 0);
                    const bAvg = bCompleted.length > 0 ? bRevenue / bCompleted.length : 0;
                    const completionRate = bAppts.length > 0 ? Math.round((bCompleted.length / bAppts.length) * 100) : 0;
                    return (
                      <tr key={b.id} className="border-b border-border/50 hover:bg-card-raised/20">
                        <td className="px-3 py-3">
                          <div className="flex items-center gap-2">
                            <div className="w-7 h-7 rounded-full bg-card-raised border border-border flex items-center justify-center text-foreground text-xs font-bold overflow-hidden">
                              <AvatarImage src={b.photo} alt={b.name} className="w-full h-full object-cover" fallback={<>{b.name[0]}</>} />
                            </div>
                            <span className="text-sm text-foreground font-medium">{b.name}</span>
                          </div>
                        </td>
                        <td className="px-3 py-3 text-sm text-foreground">{bAppts.length}</td>
                        <td className="px-3 py-3 text-sm text-emerald-400">{bCompleted.length}</td>
                        <td className="px-3 py-3 text-sm text-orange-400">{bNoShows}</td>
                        <td className="px-3 py-3 text-sm text-foreground font-semibold">{formatCurrency(bRevenue)}</td>
                        <td className="px-3 py-3 text-sm text-grey">{formatCurrency(bAvg)}</td>
                        <td className="px-3 py-3">
                          <div className="flex items-center gap-2">
                            <div className="flex-1 h-1.5 bg-card-raised rounded-full overflow-hidden">
                              <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${completionRate}%` }} />
                            </div>
                            <span className="text-xs text-grey">{completionRate}%</span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
