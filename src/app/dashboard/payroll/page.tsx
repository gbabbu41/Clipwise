"use client";
import { useState, useEffect, useCallback } from "react";
import { DollarSign, Download, Calendar, TrendingUp } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/lib/supabase";
import { AvatarImage } from "@/components/ui/avatar-image";
import { effectivePlan, planHasFeature } from "@/lib/validation";
import { cn, formatCurrency, formatDateForDb, prettyDate } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { countablePosTxs, isNoShowTx, isPaid, type RevAppt, type RevTx } from "@/lib/revenue";
import { safeCommission } from "@/lib/barber-earnings";
import type { Barber } from "@/lib/database.types";

// Theme-aware (renders inside `.portal`, CSS vars resolve to the active theme).
const CHART_TOOLTIP = {
  contentStyle: { background: "var(--card)", border: "1px solid var(--border)", borderRadius: 12, color: "var(--foreground)", fontSize: 12 },
  cursor: { fill: "rgba(20,22,28,0.05)" },
};

interface StaffHour {
  id: string;
  barber_id: string;
  date: string;
  clock_in: string;
  clock_out: string | null;
  hours_worked: number | null;
}

// Paid appointment row (money-moved basis) — the columns Payroll needs to compute
// collected service + commission and to list a barber's visits.
type PayAppt = {
  id: string; date: string; client_name: string | null;
  total_amount: number | null; tax_amount: number | null; balance_due: number | null;
  payment_status: string | null; status: string | null; barber_id: string | null;
  paid_at: string | null; created_at: string | null;
};

interface BarberPayroll {
  barber: Barber;
  appointments: PayAppt[];
  serviceRevenue: number;
  commissionEarned: number;
  hoursWorked: number;
  hourlyRate?: number;
}

const PERIOD_OPTIONS = [
  { value: "this_week", label: "This Week" },
  { value: "last_week", label: "Last Week" },
  { value: "this_month", label: "This Month" },
  { value: "last_month", label: "Last Month" },
] as const;

type Period = typeof PERIOD_OPTIONS[number]["value"];

function getDateRange(period: Period): { from: string; to: string } {
  const now = new Date();
  const today = formatDateForDb(now);

  if (period === "this_week") {
    const mon = new Date(now); mon.setDate(now.getDate() - now.getDay() + 1);
    const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
    return { from: formatDateForDb(mon), to: formatDateForDb(sun) };
  }
  if (period === "last_week") {
    const mon = new Date(now); mon.setDate(now.getDate() - now.getDay() - 6);
    const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
    return { from: formatDateForDb(mon), to: formatDateForDb(sun) };
  }
  if (period === "this_month") {
    const from = new Date(now.getFullYear(), now.getMonth(), 1);
    return { from: formatDateForDb(from), to: today };
  }
  // last_month
  const from = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const to = new Date(now.getFullYear(), now.getMonth(), 0);
  return { from: formatDateForDb(from), to: formatDateForDb(to) };
}

export default function PayrollPage() {
  const { shop } = useAuth();
  const [period, setPeriod] = useState<Period>("this_month");
  const [barbers, setBarbers] = useState<Barber[]>([]);
  const [payroll, setPayroll] = useState<BarberPayroll[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!shop) { setLoading(false); return; }
    setLoading(true);
    const { from, to } = getDateRange(period);

    // 1-day buffer on the tx window so a sale near a period edge in Atlantic time
    // (created_at is UTC) isn't cut off before the local-date filter runs below.
    const fromBuf = formatDateForDb(new Date(new Date(from + "T00:00:00").getTime() - 86400000));
    const toBuf = formatDateForDb(new Date(new Date(to + "T00:00:00").getTime() + 86400000));

    const [{ data: bData }, { data: apptData }, { data: hoursData }, txRes] = await Promise.all([
      supabase.from("barbers").select("*").eq("shop_id", shop.id).eq("is_active", true).order("name"),
      // Paid/captured appointments, fetched broad and windowed by paid_at below —
      // the SAME money-moved basis the Dashboard uses (so commission only counts
      // COLLECTED money, and a booking paid today for a future day is included).
      supabase.from("appointments")
        .select("id, date, client_name, total_amount, tax_amount, balance_due, payment_status, status, barber_id, paid_at, created_at")
        .eq("shop_id", shop.id).in("payment_status", ["paid", "captured"])
        .order("created_at", { ascending: false }).limit(5000),
      supabase.from("staff_hours").select("*").eq("shop_id", shop.id).gte("date", from).lte("date", to),
      // Transactions for the period — POS commission + real card fees. Selecting
      // the full set errors on a pre-migration schema → falls back to a lean set.
      supabase.from("transactions")
        .select("client_name, amount, tip, tax, commission_amount, barber_id, stripe_fee, refunded, source, service_name, payment_method, payment_intent_id, stripe_session_id, created_at")
        .eq("shop_id", shop.id).gte("created_at", `${fromBuf}T00:00:00`).lte("created_at", `${toBuf}T23:59:59`)
        .limit(5000),
    ]);

    const barberList = (bData ?? []) as Barber[];
    const hours = (hoursData ?? []) as StaffHour[];

    // Window appointments by WHEN THE MONEY MOVED (paid_at, else created_at), local
    // calendar day — mirrors the Dashboard/Payments so pay-period totals agree.
    const inRange = (ts: string | null | undefined) => {
      if (!ts) return false;
      const d = formatDateForDb(new Date(ts));
      return d >= from && d <= to;
    };
    const apptsInRange = ((apptData ?? []) as unknown as PayAppt[]).filter(a => inRange(a.paid_at ?? a.created_at));
    const txsInRange = ((txRes.data ?? []) as unknown as (RevTx & { created_at: string })[]).filter(t => inRange(t.created_at));

    // Sum each barber's real Stripe fees for the period (skip refunded). Empty
    // until the phase38 migration runs — then commission nets the barber's half.
    const feeByBarber = new Map<string, number>();
    for (const t of txsInRange as { barber_id: string | null; stripe_fee?: number | null; refunded?: boolean | null }[]) {
      if (t.refunded || !t.barber_id) continue;
      feeByBarber.set(t.barber_id, (feeByBarber.get(t.barber_id) ?? 0) + (t.stripe_fee ?? 0));
    }

    // Service ACTUALLY COLLECTED on a paid appointment, pre-tax — subtract any
    // still-owed balance_due (a price raised above the held card) and scale the tax
    // to the collected fraction. Identical to the Dashboard's apptServiceCollected.
    const apptServiceCollected = (a: PayAppt) => {
      const total = Math.max(0, a.total_amount ?? 0);
      const bal = Math.min(Math.max(0, a.balance_due ?? 0), total);
      const collectedTotal = Math.max(0, total - bal);
      const collectedTax = total > 0 ? (a.tax_amount ?? 0) * (collectedTotal / total) : (a.tax_amount ?? 0);
      return Math.max(0, collectedTotal - collectedTax);
    };
    // POS sales that carry commission (product / walk-in) — completion & no-show
    // rows are dropped (the appointment already covers those), de-duped vs paid
    // appointments. SAME rule as the Dashboard, so nothing is double-counted.
    const countablePos = countablePosTxs(apptsInRange as unknown as RevAppt[], txsInRange as RevTx[])
      .filter(t => !t.refunded && !!t.barber_id && !isNoShowTx(t) && t.source !== "completion");

    const result: BarberPayroll[] = barberList.map(b => {
      const pct = b.commission_percent ?? 0;
      // Paid, non-no-show appointments this barber performed (money-moved basis).
      const bAppts = apptsInRange.filter(a => a.barber_id === b.id && isPaid(a.payment_status) && a.status !== "no-show");
      const apptService = bAppts.reduce((s, a) => s + apptServiceCollected(a), 0);
      const apptCommission = (apptService * pct) / 100;
      // POS commission — prefer the stored cut (safeCommission guards a corrupt one).
      const bPos = countablePos.filter(t => t.barber_id === b.id);
      const posService = bPos.reduce((s, t) => s + Math.max(0, t.amount ?? 0), 0);
      const posCommission = bPos.reduce((s, t) => s + safeCommission(t.amount, t.commission_amount, pct), 0);
      // Revenue base = collected service + POS product sales (matches the commission).
      const serviceRevenue = apptService + posService;
      // Barber and shop split the card processing fee 50/50 — subtract the barber's
      // half so this matches their Earnings-page take-home.
      const feeShare = (feeByBarber.get(b.id) ?? 0) / 2;
      const commissionEarned = Math.max(0, apptCommission + posCommission - feeShare);
      const bHours = hours.filter(h => h.barber_id === b.id);
      const hoursWorked = bHours.reduce((s, h) => s + (h.hours_worked ?? 0), 0);
      return { barber: b, appointments: bAppts, serviceRevenue, commissionEarned, hoursWorked };
    });

    setBarbers(barberList);
    setPayroll(result);
    setLoading(false);
  }, [shop, period]);

  useEffect(() => { load(); }, [load]);

  const { from, to } = getDateRange(period);
  const totalServiceRevenue = payroll.reduce((s, p) => s + p.serviceRevenue, 0);
  const totalCommission = payroll.reduce((s, p) => s + p.commissionEarned, 0);
  const shopRevenue = totalServiceRevenue - totalCommission;
  const totalHours = payroll.reduce((s, p) => s + p.hoursWorked, 0);

  // Per-barber chart data — barber commission vs. the shop's cut, stacked so
  // each bar's height is that barber's total service revenue.
  const chartData = payroll
    .filter(p => p.serviceRevenue > 0)
    .map(p => ({
      name: p.barber.name.split(" ")[0],
      Commission: Math.round(p.commissionEarned),
      "Shop keeps": Math.round(p.serviceRevenue - p.commissionEarned),
    }));

  const exportCSV = () => {
    const rows = [
      ["Barber", "Appointments", "Service Revenue", "Commission %", "Commission Earned", "Hours Worked", "Period"],
      ...payroll.map(p => [
        p.barber.name,
        p.appointments.length,
        p.serviceRevenue.toFixed(2),
        `${p.barber.commission_percent}%`,
        p.commissionEarned.toFixed(2),
        p.hoursWorked.toFixed(1),
        `${from} to ${to}`,
      ]),
    ];
    const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `payroll-${period}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const activePlan = effectivePlan(shop?.subscription_plan, shop?.subscription_status);
  if (!shop || !planHasFeature(activePlan, "commission")) {
    return (
      <div className="p-8 flex flex-col items-center justify-center min-h-[60vh] text-center">
        <p className="text-4xl mb-4">🔒</p>
        <h2 className="text-xl font-bold text-foreground mb-2">Payroll & Earnings</h2>
        <p className="text-sm text-grey mb-6 max-w-sm">Staff commission tracking and payroll reports are available on the Premium plan.</p>
        <a href="/dashboard/billing" className="inline-flex items-center gap-2 bg-white text-black text-sm font-semibold px-5 py-2.5 rounded-xl hover:bg-white/90 transition-colors">
          Upgrade to unlock
        </a>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground uppercase tracking-wide">Payroll & Earnings</h1>
          <p className="text-sm text-grey mt-0.5">Staff commission and hours breakdown</p>
        </div>
        <div className="flex gap-3">
          <Button variant="outline" onClick={exportCSV}>
            <Download size={16} /> Export CSV
          </Button>
        </div>
      </div>

      {/* Period selector */}
      <div className="flex gap-2 flex-wrap">
        {PERIOD_OPTIONS.map(opt => (
          <button key={opt.value} onClick={() => setPeriod(opt.value)}
            className={cn("px-4 py-2 text-sm font-medium rounded-xl border transition-colors",
              period === opt.value ? "bg-black/10 border-black text-foreground" : "border-border text-grey hover:text-foreground")}>
            {opt.label}
          </button>
        ))}
        <div className="flex items-center gap-2 text-xs text-grey self-center ml-2">
          <Calendar size={13} />
          {from} → {to}
        </div>
      </div>

      {/* Summary stats. Hours tile only shows once clock-in is actually used —
          an always-zero "0.0h" reads as broken, so hide it until there's data. */}
      <div className={cn("grid grid-cols-2 gap-4", totalHours > 0 ? "md:grid-cols-4" : "md:grid-cols-3")}>
        <Card className="p-4">
          <p className="text-xs text-grey">Total Revenue Base</p>
          <p className="text-2xl font-bold text-foreground mt-1">{formatCurrency(totalServiceRevenue)}</p>
          <p className="text-[10px] text-grey-muted mt-1">Collected services + product sales, pre-tax (excludes tips)</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-grey">Total Commission Out</p>
          <p className="text-2xl font-bold text-red-400 mt-1">{formatCurrency(totalCommission)}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-grey">Shop Keeps</p>
          <p className="text-2xl font-bold text-emerald-400 mt-1">{formatCurrency(shopRevenue)}</p>
        </Card>
        {totalHours > 0 && (
          <Card className="p-4">
            <p className="text-xs text-grey">Total Hours Worked</p>
            <p className="text-2xl font-bold text-foreground mt-1">{totalHours.toFixed(1)}h</p>
          </Card>
        )}
      </div>

      {/* Earnings chart — at-a-glance comparison of each barber's payout
          vs. what the shop keeps. Stacked bar = total service revenue. */}
      {chartData.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Earnings by Barber</CardTitle>
            <p className="text-xs text-grey">Commission vs. shop&apos;s cut</p>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={chartData} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                <XAxis dataKey="name" tick={{ fontSize: 12, fill: "var(--grey)" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: "var(--grey)" }} axisLine={false} tickLine={false} tickFormatter={(v) => `$${v}`} />
                <Tooltip {...CHART_TOOLTIP} formatter={(v) => formatCurrency(Number(v))} />
                <Legend wrapperStyle={{ fontSize: 12, color: "var(--grey)" }} />
                <Bar dataKey="Commission" stackId="a" fill="#C9A84C" radius={[0, 0, 0, 0]} />
                <Bar dataKey="Shop keeps" stackId="a" fill="#10B981" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* Per-barber breakdown */}
      <Card>
        <CardHeader>
          <CardTitle>Barber Earnings Breakdown</CardTitle>
          <p className="text-xs text-grey">{from} to {to}</p>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="py-12 text-center text-grey">Loading...</div>
          ) : payroll.length === 0 ? (
            <div className="py-12 text-center text-grey">No barbers found</div>
          ) : (
            <div className="space-y-4">
              {payroll.map(p => (
                <div key={p.barber.id} className="bg-card-raised rounded-2xl p-5 border border-border">
                  <div className="flex items-start justify-between gap-4 flex-wrap">
                    {/* Barber info */}
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-black/10 border border-black flex items-center justify-center text-foreground font-bold overflow-hidden">
                        <AvatarImage src={p.barber.photo} alt={p.barber.name} className="w-full h-full object-cover" fallback={<>{p.barber.name[0]}</>} />
                      </div>
                      <div>
                        <h3 className="text-foreground font-semibold">{p.barber.name}</h3>
                        <p className="text-xs text-grey">{p.barber.commission_percent}% commission</p>
                      </div>
                    </div>

                    {/* Commission payout highlight */}
                    <div className="bg-black/5 border border-border rounded-xl px-4 py-2 text-center">
                      <p className="text-xs text-grey">Pay Out</p>
                      <p className="text-xl font-bold text-foreground">{formatCurrency(p.commissionEarned)}</p>
                    </div>
                  </div>

                  {/* Stats row. Hours tile hidden until clock-in is used (see above). */}
                  <div className={cn("grid grid-cols-2 gap-3 mt-4", totalHours > 0 ? "md:grid-cols-4" : "md:grid-cols-3")}>
                    <div className="text-center bg-card shadow-sm rounded-xl p-3">
                      <p className="text-lg font-bold text-foreground">{p.appointments.length}</p>
                      <p className="text-xs text-grey">Appointments</p>
                    </div>
                    <div className="text-center bg-card shadow-sm rounded-xl p-3">
                      <p className="text-lg font-bold text-foreground">{formatCurrency(p.serviceRevenue)}</p>
                      <p className="text-xs text-grey">Service Revenue</p>
                    </div>
                    <div className="text-center bg-card shadow-sm rounded-xl p-3">
                      <p className="text-lg font-bold text-emerald-400">{formatCurrency(p.commissionEarned)}</p>
                      <p className="text-xs text-grey">Commission ({p.barber.commission_percent}%)</p>
                    </div>
                    {totalHours > 0 && (
                      <div className="text-center bg-card shadow-sm rounded-xl p-3">
                        <p className="text-lg font-bold text-foreground">{p.hoursWorked.toFixed(1)}h</p>
                        <p className="text-xs text-grey">Hours Worked</p>
                      </div>
                    )}
                  </div>

                  {/* Revenue bar */}
                  {p.serviceRevenue > 0 && (
                    <div className="mt-4">
                      <div className="flex justify-between text-xs text-grey mb-1">
                        <span>Commission breakdown</span>
                        <span>{p.barber.commission_percent}% to barber / {100 - p.barber.commission_percent}% to shop</span>
                      </div>
                      <div className="h-2 bg-card shadow-sm rounded-full overflow-hidden flex">
                        <div className="bg-gold h-full rounded-l-full" style={{ width: `${p.barber.commission_percent}%` }} />
                        <div className="bg-emerald-500 h-full rounded-r-full flex-1" />
                      </div>
                      <div className="flex justify-between text-xs mt-1">
                        <span className="text-foreground">{formatCurrency(p.commissionEarned)} barber</span>
                        <span className="text-emerald-400">{formatCurrency(p.serviceRevenue - p.commissionEarned)} shop</span>
                      </div>
                    </div>
                  )}

                  {/* Per-appointment list for non-zero */}
                  {p.appointments.length > 0 && p.appointments.length <= 5 && (
                    <div className="mt-4 border-t border-border pt-3 space-y-1">
                      {p.appointments.map(a => (
                        <div key={a.id} className="flex items-center justify-between text-xs text-grey">
                          <span>{prettyDate(a.date)} — {a.client_name}</span>
                          <span className="text-foreground">{formatCurrency(a.total_amount ?? 0)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {p.appointments.length > 5 && (
                    <p className="text-xs text-grey mt-3 border-t border-border pt-2">
                      + {p.appointments.length - 5} more appointments
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Shop summary */}
      {totalServiceRevenue > 0 && (
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center gap-3 mb-4">
              <TrendingUp size={18} className="text-foreground" />
              <h3 className="text-foreground font-semibold">Shop Revenue Summary</h3>
            </div>
            <div className="grid grid-cols-3 gap-4 text-center">
              <div>
                <p className="text-xs text-grey">Gross Revenue</p>
                <p className="text-xl font-bold text-foreground mt-1">{formatCurrency(totalServiceRevenue)}</p>
              </div>
              <div>
                <p className="text-xs text-grey">Staff Payouts</p>
                <p className="text-xl font-bold text-red-400 mt-1">- {formatCurrency(totalCommission)}</p>
              </div>
              <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-3">
                <p className="text-xs text-grey">Net to Shop</p>
                <p className="text-xl font-bold text-emerald-400 mt-1">{formatCurrency(shopRevenue)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
