"use client";
import { useState, useEffect, useCallback } from "react";
import { DollarSign, Download, Calendar, TrendingUp } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/lib/supabase";
import { cn, formatCurrency, formatDateForDb } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import type { Barber, Appointment } from "@/lib/database.types";

interface StaffHour {
  id: string;
  barber_id: string;
  date: string;
  clock_in: string;
  clock_out: string | null;
  hours_worked: number | null;
}

interface BarberPayroll {
  barber: Barber;
  appointments: Appointment[];
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

    const [{ data: bData }, { data: apptData }, { data: hoursData }] = await Promise.all([
      supabase.from("barbers").select("*").eq("shop_id", shop.id).eq("is_active", true).order("name"),
      supabase.from("appointments").select("*").eq("shop_id", shop.id).gte("date", from).lte("date", to).eq("status", "completed"),
      supabase.from("staff_hours").select("*").eq("shop_id", shop.id).gte("date", from).lte("date", to),
    ]);

    const barberList = (bData ?? []) as Barber[];
    const appts = (apptData ?? []) as Appointment[];
    const hours = (hoursData ?? []) as StaffHour[];

    const result: BarberPayroll[] = barberList.map(b => {
      const bAppts = appts.filter(a => a.barber_id === b.id);
      const serviceRevenue = bAppts.reduce((s, a) => s + a.total_amount, 0);
      const commissionEarned = serviceRevenue * (b.commission_percent / 100);
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

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">Payroll & Earnings</h1>
          <p className="text-sm text-gray-400 mt-0.5">Staff commission and hours breakdown</p>
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
              period === opt.value ? "bg-gold/15 border-gold/30 text-gold" : "border-border text-gray-400 hover:text-white")}>
            {opt.label}
          </button>
        ))}
        <div className="flex items-center gap-2 text-xs text-gray-500 self-center ml-2">
          <Calendar size={13} />
          {from} → {to}
        </div>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="p-4">
          <p className="text-xs text-gray-400">Total Service Revenue</p>
          <p className="text-2xl font-bold text-gold mt-1">{formatCurrency(totalServiceRevenue)}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-gray-400">Total Commission Out</p>
          <p className="text-2xl font-bold text-red-400 mt-1">{formatCurrency(totalCommission)}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-gray-400">Shop Keeps</p>
          <p className="text-2xl font-bold text-emerald-400 mt-1">{formatCurrency(shopRevenue)}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-gray-400">Total Hours Worked</p>
          <p className="text-2xl font-bold text-white mt-1">{totalHours.toFixed(1)}h</p>
        </Card>
      </div>

      {/* Per-barber breakdown */}
      <Card>
        <CardHeader>
          <CardTitle>Barber Earnings Breakdown</CardTitle>
          <p className="text-xs text-gray-500">{from} to {to}</p>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="py-12 text-center text-gray-500">Loading...</div>
          ) : payroll.length === 0 ? (
            <div className="py-12 text-center text-gray-500">No barbers found</div>
          ) : (
            <div className="space-y-4">
              {payroll.map(p => (
                <div key={p.barber.id} className="bg-surface-raised rounded-2xl p-5 border border-border">
                  <div className="flex items-start justify-between gap-4 flex-wrap">
                    {/* Barber info */}
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-gold/20 border border-gold/30 flex items-center justify-center text-gold font-bold">
                        {p.barber.name[0]}
                      </div>
                      <div>
                        <h3 className="text-white font-semibold">{p.barber.name}</h3>
                        <p className="text-xs text-gray-400">{p.barber.commission_percent}% commission</p>
                      </div>
                    </div>

                    {/* Commission payout highlight */}
                    <div className="bg-gold/10 border border-gold/20 rounded-xl px-4 py-2 text-center">
                      <p className="text-xs text-gray-400">Pay Out</p>
                      <p className="text-xl font-bold text-gold">{formatCurrency(p.commissionEarned)}</p>
                    </div>
                  </div>

                  {/* Stats row */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
                    <div className="text-center bg-surface rounded-xl p-3">
                      <p className="text-lg font-bold text-white">{p.appointments.length}</p>
                      <p className="text-xs text-gray-400">Appointments</p>
                    </div>
                    <div className="text-center bg-surface rounded-xl p-3">
                      <p className="text-lg font-bold text-white">{formatCurrency(p.serviceRevenue)}</p>
                      <p className="text-xs text-gray-400">Service Revenue</p>
                    </div>
                    <div className="text-center bg-surface rounded-xl p-3">
                      <p className="text-lg font-bold text-emerald-400">{formatCurrency(p.commissionEarned)}</p>
                      <p className="text-xs text-gray-400">Commission ({p.barber.commission_percent}%)</p>
                    </div>
                    <div className="text-center bg-surface rounded-xl p-3">
                      <p className="text-lg font-bold text-white">{p.hoursWorked.toFixed(1)}h</p>
                      <p className="text-xs text-gray-400">Hours Worked</p>
                    </div>
                  </div>

                  {/* Revenue bar */}
                  {p.serviceRevenue > 0 && (
                    <div className="mt-4">
                      <div className="flex justify-between text-xs text-gray-400 mb-1">
                        <span>Commission breakdown</span>
                        <span>{p.barber.commission_percent}% to barber / {100 - p.barber.commission_percent}% to shop</span>
                      </div>
                      <div className="h-2 bg-surface rounded-full overflow-hidden flex">
                        <div className="bg-gold h-full rounded-l-full" style={{ width: `${p.barber.commission_percent}%` }} />
                        <div className="bg-emerald-500 h-full rounded-r-full flex-1" />
                      </div>
                      <div className="flex justify-between text-xs mt-1">
                        <span className="text-gold">{formatCurrency(p.commissionEarned)} barber</span>
                        <span className="text-emerald-400">{formatCurrency(p.serviceRevenue - p.commissionEarned)} shop</span>
                      </div>
                    </div>
                  )}

                  {/* Per-appointment list for non-zero */}
                  {p.appointments.length > 0 && p.appointments.length <= 5 && (
                    <div className="mt-4 border-t border-border pt-3 space-y-1">
                      {p.appointments.map(a => (
                        <div key={a.id} className="flex items-center justify-between text-xs text-gray-400">
                          <span>{a.date} — {a.client_name}</span>
                          <span className="text-gold">{formatCurrency(a.total_amount)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {p.appointments.length > 5 && (
                    <p className="text-xs text-gray-500 mt-3 border-t border-border pt-2">
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
              <TrendingUp size={18} className="text-gold" />
              <h3 className="text-white font-semibold">Shop Revenue Summary</h3>
            </div>
            <div className="grid grid-cols-3 gap-4 text-center">
              <div>
                <p className="text-xs text-gray-400">Gross Revenue</p>
                <p className="text-xl font-bold text-white mt-1">{formatCurrency(totalServiceRevenue)}</p>
              </div>
              <div>
                <p className="text-xs text-gray-400">Staff Payouts</p>
                <p className="text-xl font-bold text-red-400 mt-1">- {formatCurrency(totalCommission)}</p>
              </div>
              <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-3">
                <p className="text-xs text-gray-400">Net to Shop</p>
                <p className="text-xl font-bold text-emerald-400 mt-1">{formatCurrency(shopRevenue)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
