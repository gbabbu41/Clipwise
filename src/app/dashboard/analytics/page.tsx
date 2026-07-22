"use client";
import { useState, useEffect, useCallback, useMemo } from "react";
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
import type { Transaction, Appointment, Barber } from "@/lib/database.types";

const DARK_TOOLTIP = {
  contentStyle: { background: "#2C2C2E", border: "1px solid #2C2C2E", borderRadius: 12, color: "#fff", fontSize: 12 },
  cursor: { fill: "rgba(245, 240, 230,0.08)" },
};
const GOLD_PALETTE = ["#F5F0E6","#FFFFFF","#D4CCB8","#B8AC8C","#928773","#6B6354"];
const STATUS_COLORS: Record<string, string> = {
  completed: "#10B981", confirmed: "#F5F0E6", pending: "#F59E0B",
  cancelled: "#EF4444", "no-show": "#F97316",
};

function Toast({ message, onClose }: { message: string; onClose: () => void }) {
  return (
    <div className="fixed bottom-6 right-6 z-[100] bg-[#141414] border border-[#2a2a2a] rounded-xl px-5 py-3 text-sm text-white shadow-xl flex items-center gap-3">
      <span className="text-white">↓</span>{message}
      <button onClick={onClose} className="text-[#8f8f8f] hover:text-white ml-2">✕</button>
    </div>
  );
}

function SkeletonCard() {
  return <div className="h-28 rounded-2xl bg-[#141414] animate-pulse" />;
}

type DayRevenue = { date: string; label: string; day: string; revenue: number; appointments: number };

export default function AnalyticsPage() {
  const { shop } = useAuth();
  const [period, setPeriod] = useState("month");
  const [barberFilter, setBarberFilter] = useState("all");
  const [toast, setToast] = useState("");
  const [loading, setLoading] = useState(true);

  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [barbers, setBarbers] = useState<Barber[]>([]);
  // id → name lookup so the appointments fallback for "Revenue by Service"
  // shows real service names instead of raw service_id UUIDs.
  const [serviceNames, setServiceNames] = useState<Record<string, string>>({});

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(""), 3000); };

  const loadData = useCallback(async () => {
    if (!shop) { setLoading(false); return; }
    setLoading(true);
    const [txRes, apptRes, barberRes, svcRes] = await Promise.all([
      supabase.from("transactions").select("*").eq("shop_id", shop.id).order("created_at", { ascending: true }),
      supabase.from("appointments").select("*").eq("shop_id", shop.id),
      supabase.from("barbers").select("*").eq("shop_id", shop.id).eq("is_active", true).order("name"),
      supabase.from("services").select("id, name").eq("shop_id", shop.id),
    ]);
    if (txRes.data) setTransactions(txRes.data);
    if (apptRes.data) setAppointments(apptRes.data);
    if (barberRes.data) setBarbers(barberRes.data);
    if (svcRes.data) setServiceNames(Object.fromEntries(svcRes.data.map((s: { id: string; name: string }) => [s.id, s.name])));
    setLoading(false);
  }, [shop]);

  useEffect(() => { loadData(); }, [loadData]);

  const today = new Date().toISOString().split("T")[0];
  const thisMonth = today.slice(0, 7);
  const lastMonth = new Date(new Date(today).setMonth(new Date(today).getMonth() - 1)).toISOString().slice(0, 7);

  const filteredTx = useMemo(() => {
    let list = transactions;
    if (barberFilter !== "all") list = list.filter(t => t.barber_id === barberFilter);
    if (period === "today") list = list.filter(t => t.created_at.startsWith(today));
    else if (period === "week") {
      const weekAgo = new Date(today); weekAgo.setDate(weekAgo.getDate() - 7);
      list = list.filter(t => new Date(t.created_at) >= weekAgo);
    } else if (period === "month") list = list.filter(t => t.created_at.startsWith(thisMonth));
    else if (period === "last") list = list.filter(t => t.created_at.startsWith(lastMonth));
    return list;
  }, [transactions, barberFilter, period, today, thisMonth, lastMonth]);

  const filteredAppts = useMemo(() => {
    let list = appointments;
    if (barberFilter !== "all") list = list.filter(a => a.barber_id === barberFilter);
    if (period === "today") list = list.filter(a => a.date === today);
    else if (period === "week") {
      const weekAgo = new Date(today); weekAgo.setDate(weekAgo.getDate() - 7);
      list = list.filter(a => new Date(a.date) >= weekAgo);
    } else if (period === "month") list = list.filter(a => a.date.startsWith(thisMonth));
    else if (period === "last") list = list.filter(a => a.date.startsWith(lastMonth));
    return list;
  }, [appointments, barberFilter, period, today, thisMonth, lastMonth]);

  // Revenue over time (from transactions)
  const revenueByDay = useMemo<DayRevenue[]>(() => {
    const map: Record<string, { revenue: number; appointments: number }> = {};
    for (const tx of filteredTx) {
      const d = tx.created_at.split("T")[0];
      if (!map[d]) map[d] = { revenue: 0, appointments: 0 };
      map[d].revenue += tx.amount + tx.tip;
      map[d].appointments += 1;
    }
    // If no transactions, build date range from appointments
    if (Object.keys(map).length === 0) {
      for (const a of filteredAppts.filter(a => a.status === "completed")) {
        if (!map[a.date]) map[a.date] = { revenue: 0, appointments: 0 };
        map[a.date].revenue += a.total_amount;
        map[a.date].appointments += 1;
      }
    }
    return Object.entries(map).sort(([a], [b]) => a.localeCompare(b)).map(([date, v]) => {
      const d = new Date(date);
      return { date, label: d.toLocaleDateString("en-CA", { month: "short", day: "numeric" }), day: d.toLocaleDateString("en-CA", { weekday: "short" }), ...v };
    });
  }, [filteredTx, filteredAppts]);

  // KPIs
  const totalRevenue = filteredTx.reduce((s, t) => s + t.amount + t.tip, 0)
    || filteredAppts.filter(a => a.status === "completed").reduce((s, a) => s + a.total_amount, 0);
  const totalAppts = filteredAppts.length;
  const completedAppts = filteredAppts.filter(a => a.status === "completed").length;
  const noShows = filteredAppts.filter(a => a.status === "no-show").length;
  const noShowRate = totalAppts > 0 ? ((noShows / totalAppts) * 100).toFixed(1) : "0.0";
  const avgTicket = completedAppts > 0 ? totalRevenue / completedAppts : 0;

  // Revenue by barber
  const barberRevenue = useMemo(() => {
    const map: Record<string, number> = {};
    for (const tx of filteredTx) {
      if (!tx.barber_id) continue;
      map[tx.barber_id] = (map[tx.barber_id] ?? 0) + tx.amount + tx.tip;
    }
    // Fallback to appointments if no transactions
    if (Object.keys(map).length === 0) {
      for (const a of filteredAppts.filter(a => a.status === "completed")) {
        map[a.barber_id] = (map[a.barber_id] ?? 0) + a.total_amount;
      }
    }
    return barbers.map(b => ({ name: b.name.split(" ")[0], revenue: Math.round(map[b.id] ?? 0) })).filter(b => b.revenue > 0);
  }, [filteredTx, filteredAppts, barbers]);

  // Revenue by service name
  const serviceRevenue = useMemo(() => {
    const map: Record<string, number> = {};
    for (const tx of filteredTx) {
      if (!tx.service_name) continue;
      map[tx.service_name] = (map[tx.service_name] ?? 0) + tx.amount;
    }
    if (Object.keys(map).length === 0) {
      for (const a of filteredAppts.filter(a => a.status === "completed")) {
        // Resolve the service_id to its real name; fall back to "Unknown"
        // so the chart never renders a raw UUID.
        const key = (a.service_id && serviceNames[a.service_id]) || "Unknown";
        map[key] = (map[key] ?? 0) + a.total_amount;
      }
    }
    return Object.entries(map)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 6)
      .map(([name, value], i) => ({ name, value, color: GOLD_PALETTE[i] ?? "#666" }));
  }, [filteredTx, filteredAppts, serviceNames]);

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

  // Busiest hours (from transactions)
  const hourlyRevenue = useMemo(() => {
    const map: Record<number, { revenue: number; appointments: number }> = {};
    for (const tx of filteredTx) {
      const hour = new Date(tx.created_at).getHours();
      if (!map[hour]) map[hour] = { revenue: 0, appointments: 0 };
      map[hour].revenue += tx.amount + tx.tip;
      map[hour].appointments += 1;
    }
    return Object.entries(map).sort(([a], [b]) => Number(a) - Number(b)).map(([h, v]) => {
      const hr = Number(h);
      const label = hr === 0 ? "12 AM" : hr < 12 ? `${hr} AM` : hr === 12 ? "12 PM" : `${hr-12} PM`;
      return { hour: label, ...v };
    });
  }, [filteredTx]);

  // Top barber
  const topBarber = barberRevenue.length > 0 ? barberRevenue.reduce((a, b) => a.revenue > b.revenue ? a : b) : null;
  // Top service
  const topService = serviceRevenue[0];

  const kpis = [
    { label: "Total Revenue", value: formatCurrency(totalRevenue), sub: `${completedAppts} completed`, color: "text-white" },
    { label: "Total Appointments", value: String(totalAppts), sub: `${completedAppts} completed`, color: "text-white" },
    { label: "Avg Ticket Size", value: formatCurrency(avgTicket), sub: "Per completed appt", color: "text-white" },
    { label: "No-Show Rate", value: `${noShowRate}%`, sub: "Industry avg 12%", color: "text-orange-400" },
    { label: "Top Barber", value: topBarber?.name ?? "—", sub: topBarber ? formatCurrency(topBarber.revenue) : "No data", color: "text-white" },
    { label: "Top Service", value: topService?.name ?? "—", sub: topService ? formatCurrency(topService.value) : "No data", color: "text-white" },
    { label: "Transactions", value: String(filteredTx.length), sub: "POS + walk-ins", color: "text-emerald-400" },
    { label: "Tips Collected", value: formatCurrency(filteredTx.reduce((s, t) => s + t.tip, 0)), sub: "Via POS", color: "text-white" },
  ];

  if (!shop) {
    return (
      <div className="p-8 flex flex-col items-center justify-center min-h-[60vh] text-center">
        <p className="text-2xl mb-2">📊</p>
        <h2 className="text-lg font-bold text-white mb-1">No shop linked</h2>
        <p className="text-sm text-[#8f8f8f]">Analytics will appear here once your shop is active.</p>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {toast && <Toast message={toast} onClose={() => setToast("")} />}

      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white uppercase tracking-wide">Analytics</h1>
          <p className="text-sm text-[#8f8f8f] mt-0.5">Business performance overview</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => {
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
        <div className="flex rounded-xl border border-[#2a2a2a] overflow-hidden">
          {[["today","Today"],["week","This Week"],["month","This Month"],["last","Last Month"]].map(([v,l]) => (
            <button key={v} onClick={() => setPeriod(v)}
              className={cn("px-3 py-2 text-xs font-medium transition-colors", period === v ? "bg-gold text-black" : "text-[#8f8f8f] hover:text-white bg-[#141414]")}>
              {l}
            </button>
          ))}
        </div>
        <select value={barberFilter} onChange={e => setBarberFilter(e.target.value)}
          className="rounded-xl border border-[#2a2a2a] bg-[#141414] px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-black/20">
          <option value="all">All Barbers</option>
          {barbers.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
      </div>

      {/* KPI Cards */}
      {loading ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {kpis.map(k => (
            <Card key={k.label} className="py-4 px-5">
              <p className="text-xs text-[#8f8f8f]">{k.label}</p>
              <p className={cn("text-2xl font-bold mt-1", k.color)}>{k.value}</p>
              <p className="text-xs text-[#8f8f8f] mt-1">{k.sub}</p>
            </Card>
          ))}
        </div>
      )}

      {/* Revenue Over Time */}
      {revenueByDay.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Revenue Over Time</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={revenueByDay} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#2C2C2E" />
                <XAxis dataKey="label" tick={{ fill: "#9CA3AF", fontSize: 11 }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fill: "#9CA3AF", fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={v => `$${v}`} />
                <Tooltip {...DARK_TOOLTIP} formatter={(v) => [`$${v}`, "Revenue"]} />
                <Line type="monotone" dataKey="revenue" stroke="#F5F0E6" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {revenueByDay.length === 0 && !loading && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <p className="text-3xl mb-3">📊</p>
            <p className="text-[#8f8f8f] text-sm">No data yet for this period. Complete appointments or process POS transactions to see analytics.</p>
          </CardContent>
        </Card>
      )}

      {(barberRevenue.length > 0 || serviceRevenue.length > 0) && (
        <div className="grid md:grid-cols-2 gap-6">
          {barberRevenue.length > 0 && (
            <Card>
              <CardHeader><CardTitle>Revenue by Barber</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={barberRevenue} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#2C2C2E" />
                    <XAxis dataKey="name" tick={{ fill: "#9CA3AF", fontSize: 12 }} tickLine={false} axisLine={false} />
                    <YAxis tick={{ fill: "#9CA3AF", fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={v => `$${v}`} />
                    <Tooltip {...DARK_TOOLTIP} formatter={(v) => [`$${v}`, "Revenue"]} />
                    <Bar dataKey="revenue" fill="#F5F0E6" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}

          {serviceRevenue.length > 0 && (
            <Card>
              <CardHeader><CardTitle>Revenue by Service</CardTitle></CardHeader>
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
                        <span className="text-xs text-[#8f8f8f]">{s.name}</span>
                        <span className="text-xs text-[#8f8f8f] ml-auto">{s.value}%</span>
                      </div>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {hourlyRevenue.length > 0 && (
            <Card>
              <CardHeader><CardTitle>Busiest Hours</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={180}>
                  <BarChart data={hourlyRevenue} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#2C2C2E" />
                    <XAxis dataKey="hour" tick={{ fill: "#9CA3AF", fontSize: 11 }} tickLine={false} axisLine={false} />
                    <YAxis tick={{ fill: "#9CA3AF", fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={v => `$${v}`} />
                    <Tooltip {...DARK_TOOLTIP} formatter={(v) => [`$${v}`, "Revenue"]} />
                    <Bar dataKey="revenue" fill="#D4CCB8" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Staff Performance Table */}
      {barbers.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Staff Performance</CardTitle></CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-[#2a2a2a]">
                    {["Barber", "Appointments", "Completed", "No-Shows", "Revenue", "Avg Ticket", "Completion Rate"].map(h => (
                      <th key={h} className="text-left text-xs font-medium text-[#8f8f8f] px-3 py-2">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {barbers.map(b => {
                    const bAppts = filteredAppts.filter(a => a.barber_id === b.id);
                    const bCompleted = bAppts.filter(a => a.status === "completed");
                    const bNoShows = bAppts.filter(a => a.status === "no-show").length;
                    const bRevenue = bCompleted.reduce((s, a) => s + a.total_amount, 0);
                    const bAvg = bCompleted.length > 0 ? bRevenue / bCompleted.length : 0;
                    const completionRate = bAppts.length > 0 ? Math.round((bCompleted.length / bAppts.length) * 100) : 0;
                    return (
                      <tr key={b.id} className="border-b border-[#2a2a2a]/50 hover:bg-[#141414]/20">
                        <td className="px-3 py-3">
                          <div className="flex items-center gap-2">
                            <div className="w-7 h-7 rounded-full bg-black/10 border border-black flex items-center justify-center text-white text-xs font-bold overflow-hidden">
                              <AvatarImage src={b.photo} alt={b.name} className="w-full h-full object-cover" fallback={<>{b.name[0]}</>} />
                            </div>
                            <span className="text-sm text-white font-medium">{b.name}</span>
                          </div>
                        </td>
                        <td className="px-3 py-3 text-sm text-white">{bAppts.length}</td>
                        <td className="px-3 py-3 text-sm text-emerald-400">{bCompleted.length}</td>
                        <td className="px-3 py-3 text-sm text-orange-400">{bNoShows}</td>
                        <td className="px-3 py-3 text-sm text-white font-semibold">{formatCurrency(bRevenue)}</td>
                        <td className="px-3 py-3 text-sm text-[#8f8f8f]">{formatCurrency(bAvg)}</td>
                        <td className="px-3 py-3">
                          <div className="flex items-center gap-2">
                            <div className="flex-1 h-1.5 bg-[#141414] rounded-full overflow-hidden">
                              <div className="h-full bg-gold rounded-full" style={{ width: `${completionRate}%` }} />
                            </div>
                            <span className="text-xs text-[#8f8f8f]">{completionRate}%</span>
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
