"use client";
import { useState } from "react";
import {
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import {
  mockRevenueData, mockHourlyRevenue, mockRevenueByService,
  mockAppointmentStatuses, mockBarbers,
} from "@/lib/mock-data";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";

const DARK_TOOLTIP = {
  contentStyle: { background: "#2C2C2E", border: "1px solid #2C2C2E", borderRadius: 12, color: "#fff", fontSize: 12 },
  cursor: { fill: "rgba(201,168,76,0.08)" },
};

function Toast({ message, onClose }: { message: string; onClose: () => void }) {
  return (
    <div className="fixed bottom-6 right-6 z-[100] bg-surface-raised border border-border rounded-xl px-5 py-3 text-sm text-white shadow-xl flex items-center gap-3">
      <span className="text-gold">↓</span>{message}
      <button onClick={onClose} className="text-gray-400 hover:text-white ml-2">✕</button>
    </div>
  );
}

const kpis = [
  { label: "Total Revenue", value: "$9,340", sub: "+12% vs last month", color: "text-gold" },
  { label: "Total Appointments", value: "217", sub: "+8% vs last month", color: "text-white" },
  { label: "New Clients", value: "3", sub: "This month", color: "text-emerald-400" },
  { label: "Avg Ticket Size", value: "$43.02", sub: "Per appointment", color: "text-white" },
  { label: "No-Show Rate", value: "8.3%", sub: "Industry avg 12%", color: "text-orange-400" },
  { label: "Top Barber", value: "Marcus", sub: "$2,610 this month", color: "text-gold" },
  { label: "Top Service", value: "Skin Fade", sub: "$1,260 revenue", color: "text-white" },
  { label: "Busiest Day", value: "Saturday", sub: "Avg $420/day", color: "text-white" },
];

const barberRevenue = mockBarbers.map(b => ({ name: b.name.split(" ")[0], revenue: b.revenue_this_month }));

export default function AnalyticsPage() {
  const [period, setPeriod] = useState("month");
  const [barberFilter, setBarberFilter] = useState("all");
  const [clientType, setClientType] = useState("all");
  const [toast, setToast] = useState("");

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(""), 3000); };

  const revenueSlice = period === "today" ? mockRevenueData.slice(-1)
    : period === "week" ? mockRevenueData.slice(-7)
    : period === "last" ? mockRevenueData.slice(0, 15)
    : mockRevenueData;

  return (
    <div className="p-6 space-y-6">
      {toast && <Toast message={toast} onClose={() => setToast("")} />}

      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Analytics</h1>
          <p className="text-sm text-gray-400 mt-0.5">Business performance overview</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => showToast("Downloading report... (Demo mode)")}>Export CSV</Button>
          <Button variant="outline" size="sm" onClick={() => showToast("Generating PDF... (Demo mode)")}>Export PDF</Button>
        </div>
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap gap-3">
        <div className="flex rounded-xl border border-border overflow-hidden">
          {[["today","Today"],["week","This Week"],["month","This Month"],["last","Last Month"]].map(([v,l]) => (
            <button key={v} onClick={() => setPeriod(v)}
              className={cn("px-3 py-2 text-xs font-medium transition-colors", period === v ? "bg-gold text-black" : "text-gray-400 hover:text-white bg-surface-raised")}>
              {l}
            </button>
          ))}
        </div>
        <select value={barberFilter} onChange={e => setBarberFilter(e.target.value)}
          className="rounded-xl border border-border bg-surface-raised px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-gold/50">
          <option value="all">All Barbers</option>
          {mockBarbers.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
        <select value={clientType} onChange={e => setClientType(e.target.value)}
          className="rounded-xl border border-border bg-surface-raised px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-gold/50">
          <option value="all">All Clients</option>
          <option value="new">New Clients</option>
          <option value="returning">Returning</option>
        </select>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {kpis.map(k => (
          <Card key={k.label} className="py-4 px-5">
            <p className="text-xs text-gray-400">{k.label}</p>
            <p className={cn("text-2xl font-bold mt-1", k.color)}>{k.value}</p>
            <p className="text-xs text-gray-500 mt-1">{k.sub}</p>
          </Card>
        ))}
      </div>

      {/* Revenue Over Time */}
      <Card>
        <CardHeader><CardTitle>Revenue Over Time</CardTitle></CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={revenueSlice} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2C2C2E" />
              <XAxis dataKey="label" tick={{ fill: "#9CA3AF", fontSize: 11 }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fill: "#9CA3AF", fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={v => `$${v}`} />
              <Tooltip {...DARK_TOOLTIP} formatter={(v) => [`$${v}`, "Revenue"]} />
              <Line type="monotone" dataKey="revenue" stroke="#C9A84C" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <div className="grid md:grid-cols-2 gap-6">
        {/* Revenue by Barber */}
        <Card>
          <CardHeader><CardTitle>Revenue by Barber</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={barberRevenue} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#2C2C2E" />
                <XAxis dataKey="name" tick={{ fill: "#9CA3AF", fontSize: 12 }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fill: "#9CA3AF", fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={v => `$${v}`} />
                <Tooltip {...DARK_TOOLTIP} formatter={(v) => [`$${v}`, "Revenue"]} />
                <Bar dataKey="revenue" fill="#C9A84C" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Revenue by Service */}
        <Card>
          <CardHeader><CardTitle>Revenue by Service</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie data={mockRevenueByService} cx="50%" cy="50%" outerRadius={75} dataKey="value" nameKey="name" label={({ name, percent }: { name?: string; percent?: number }) => `${name ?? ""} ${((percent ?? 0) * 100).toFixed(0)}%`} labelLine={false} fontSize={10}>
                  {mockRevenueByService.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                </Pie>
                <Tooltip {...DARK_TOOLTIP} formatter={(v) => [`$${v}`, "Revenue"]} contentStyle={DARK_TOOLTIP.contentStyle} />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Appointment Status */}
        <Card>
          <CardHeader><CardTitle>Appointment Status Breakdown</CardTitle></CardHeader>
          <CardContent>
            <div className="flex items-center gap-6">
              <ResponsiveContainer width="50%" height={180}>
                <PieChart>
                  <Pie data={mockAppointmentStatuses} cx="50%" cy="50%" innerRadius={45} outerRadius={70} dataKey="value">
                    {mockAppointmentStatuses.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                  </Pie>
                  <Tooltip {...DARK_TOOLTIP} formatter={(v) => [`${v}%`, "Share"]} contentStyle={DARK_TOOLTIP.contentStyle} />
                </PieChart>
              </ResponsiveContainer>
              <div className="space-y-2">
                {mockAppointmentStatuses.map(s => (
                  <div key={s.name} className="flex items-center gap-2">
                    <div className="w-2.5 h-2.5 rounded-full" style={{ background: s.color }} />
                    <span className="text-xs text-gray-300">{s.name}</span>
                    <span className="text-xs text-gray-500 ml-auto">{s.value}%</span>
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Busiest Hours */}
        <Card>
          <CardHeader><CardTitle>Busiest Hours</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={mockHourlyRevenue} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#2C2C2E" />
                <XAxis dataKey="hour" tick={{ fill: "#9CA3AF", fontSize: 11 }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fill: "#9CA3AF", fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={v => `$${v}`} />
                <Tooltip {...DARK_TOOLTIP} formatter={(v) => [`$${v}`, "Revenue"]} />
                <Bar dataKey="revenue" fill="#A07830" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Client Retention */}
      <Card>
        <CardHeader><CardTitle>Client Retention</CardTitle></CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-3xl font-bold text-gold">68%</p>
                <p className="text-sm text-gray-400 mt-1">Returning clients this month</p>
              </div>
              <div className="text-right">
                <p className="text-lg font-semibold text-white">32%</p>
                <p className="text-sm text-gray-400">New clients</p>
              </div>
            </div>
            <div className="w-full h-3 rounded-full bg-surface-raised overflow-hidden">
              <div className="h-full bg-gold rounded-full" style={{ width: "68%" }} />
            </div>
            <div className="grid grid-cols-3 gap-4 pt-2">
              <div className="text-center">
                <p className="text-xl font-bold text-white">147</p>
                <p className="text-xs text-gray-400">Returning clients</p>
              </div>
              <div className="text-center">
                <p className="text-xl font-bold text-white">70</p>
                <p className="text-xs text-gray-400">New clients</p>
              </div>
              <div className="text-center">
                <p className="text-xl font-bold text-white">217</p>
                <p className="text-xs text-gray-400">Total this month</p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
