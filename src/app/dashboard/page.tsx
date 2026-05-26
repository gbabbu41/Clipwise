"use client";
import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  Calendar, DollarSign, Users, Star, Plus, X, CreditCard,
  ChevronRight, AlertCircle, ChevronLeft, TrendingUp, UserX,
} from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn, formatCurrency, getStatusColor, getDateRange, DATE_FILTER_LABELS, formatDateForDb, DateFilterKey } from "@/lib/utils";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip } from "recharts";
import type { AppointmentWithDetails, Barber, Notification } from "@/lib/database.types";

// ─── Skeleton ─────────────────────────────────────────────────────────────────
function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse bg-surface-raised rounded-xl", className)} />;
}

// ─── Toast ────────────────────────────────────────────────────────────────────
function Toast({ message, onClose }: { message: string; onClose: () => void }) {
  return (
    <div className="fixed bottom-6 right-6 z-[100] bg-surface-raised border border-border rounded-xl px-5 py-3 text-sm text-white shadow-xl flex items-center gap-3">
      <span className="text-gold">✓</span>{message}
      <button onClick={onClose} className="text-gray-400 hover:text-white ml-2">✕</button>
    </div>
  );
}

// ─── Stat Card ────────────────────────────────────────────────────────────────
function StatCard({ label, value, sub, icon: Icon, color = "gold" }: {
  label: string; value: string; sub: string; icon: React.ElementType; color?: string;
}) {
  const colorMap: Record<string, string> = { gold: "bg-gold text-gold bg-gold/15", green: "bg-emerald-500 text-emerald-400 bg-emerald-500/15", blue: "bg-blue-500 text-blue-400 bg-blue-500/15", purple: "bg-purple-500 text-purple-400 bg-purple-500/15", orange: "bg-orange-500 text-orange-400 bg-orange-500/15" };
  const [bg, text, iconBg] = colorMap[color]?.split(" ") ?? colorMap.gold.split(" ");
  return (
    <Card className="relative overflow-hidden">
      <div className={cn("absolute inset-0 opacity-5", bg)} />
      <div className="relative flex items-start justify-between">
        <div>
          <p className="text-xs text-gray-500 font-medium uppercase tracking-wider">{label}</p>
          <p className="text-2xl font-bold text-white mt-1">{value}</p>
          <p className="text-xs text-gray-500 mt-1">{sub}</p>
        </div>
        <div className={cn("p-2.5 rounded-xl", iconBg, text)}><Icon size={20} /></div>
      </div>
    </Card>
  );
}

// ─── Custom Chart Tooltip ─────────────────────────────────────────────────────
function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: { value: number }[]; label?: string }) {
  if (active && payload?.length) {
    return (
      <div className="bg-surface-raised border border-border rounded-xl px-3 py-2 text-xs">
        <p className="text-gray-400">{label}</p>
        <p className="text-gold font-semibold">{formatCurrency(payload[0].value)}</p>
      </div>
    );
  }
  return null;
}

export default function DashboardPage() {
  const { shop, profile } = useAuth();

  // ── Filter state ────────────────────────────────────────────────────────────
  const [dateFilter, setDateFilter] = useState<DateFilterKey>("today");
  const [customStart, setCustomStart] = useState(formatDateForDb(new Date()));
  const [customEnd, setCustomEnd] = useState(formatDateForDb(new Date()));

  // ── Calendar state ──────────────────────────────────────────────────────────
  const [calYear, setCalYear] = useState(new Date().getFullYear());
  const [calMonth, setCalMonth] = useState(new Date().getMonth());
  const [selectedCalDate, setSelectedCalDate] = useState<string | null>(null);

  // ── Data state ──────────────────────────────────────────────────────────────
  const [loadingAppts, setLoadingAppts] = useState(true);
  const [appointments, setAppointments] = useState<AppointmentWithDetails[]>([]);
  const [barbers, setBarbers] = useState<Barber[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [apptCounts, setApptCounts] = useState<Record<string, number>>({});

  // ── UI state ────────────────────────────────────────────────────────────────
  const [showAddWalkin, setShowAddWalkin] = useState(false);
  const [walkinName, setWalkinName] = useState("");
  const [walkinBarber, setWalkinBarber] = useState("");
  const [walkinService, setWalkinService] = useState("");
  const [savingWalkin, setSavingWalkin] = useState(false);
  const [toast, setToast] = useState("");

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(""), 3000); };

  // ── Load appointments ───────────────────────────────────────────────────────
  const loadAppointments = useCallback(async () => {
    if (!shop) { setLoadingAppts(false); return; }
    setLoadingAppts(true);
    const [start, end] = getDateRange(dateFilter, customStart, customEnd);
    const { data } = await supabase
      .from("appointments")
      .select("*, barbers(id, name), services(id, name, price, category)")
      .eq("shop_id", shop.id)
      .gte("date", start)
      .lte("date", end)
      .order("date", { ascending: true })
      .order("time_slot", { ascending: true });
    setAppointments((data ?? []) as AppointmentWithDetails[]);
    setLoadingAppts(false);
  }, [shop, dateFilter, customStart, customEnd]);

  // ── Load barbers & notifications ────────────────────────────────────────────
  const loadSideData = useCallback(async () => {
    if (!shop || !profile) return;
    const [{ data: b }, { data: n }] = await Promise.all([
      supabase.from("barbers").select("*").eq("shop_id", shop.id).eq("is_active", true),
      supabase.from("notifications").select("*").eq("user_id", profile.id).order("created_at", { ascending: false }).limit(5),
    ]);
    setBarbers((b ?? []) as Barber[]);
    setNotifications((n ?? []) as Notification[]);
  }, [shop, profile]);

  // ── Load calendar appointment counts for current month ─────────────────────
  const loadCalendarCounts = useCallback(async () => {
    if (!shop) return;
    const firstDay = formatDateForDb(new Date(calYear, calMonth, 1));
    const lastDay = formatDateForDb(new Date(calYear, calMonth + 1, 0));
    const { data } = await supabase
      .from("appointments")
      .select("date")
      .eq("shop_id", shop.id)
      .gte("date", firstDay)
      .lte("date", lastDay);
    const counts: Record<string, number> = {};
    (data ?? []).forEach((a: { date: string }) => { counts[a.date] = (counts[a.date] ?? 0) + 1; });
    setApptCounts(counts);
  }, [shop, calYear, calMonth]);

  useEffect(() => { loadAppointments(); }, [loadAppointments]);
  useEffect(() => { loadSideData(); }, [loadSideData]);
  useEffect(() => { loadCalendarCounts(); }, [loadCalendarCounts]);

  // ── Computed stats ──────────────────────────────────────────────────────────
  const displayAppts = selectedCalDate
    ? appointments.filter((a) => a.date === selectedCalDate)
    : appointments;
  const todayStr = formatDateForDb(new Date());
  const todayAppts = appointments.filter((a) => a.date === todayStr);

  const completed = appointments.filter((a) => a.status === "completed");
  const revenue = completed.reduce((s, a) => s + (a.total_amount ?? 0), 0);
  const avgTicket = completed.length > 0 ? revenue / completed.length : 0;
  const noShows = appointments.filter((a) => a.status === "no-show").length;
  const noShowRate = appointments.length > 0 ? (noShows / appointments.length * 100) : 0;

  // Revenue chart data — aggregate by date
  const revenueByDate: Record<string, number> = {};
  completed.forEach((a) => { revenueByDate[a.date] = (revenueByDate[a.date] ?? 0) + (a.total_amount ?? 0); });
  const chartData = Object.entries(revenueByDate)
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-30)
    .map(([date, rev]) => ({
      day: new Date(date + "T00:00:00").toLocaleDateString("en-CA", { month: "short", day: "numeric" }),
      revenue: rev,
    }));

  // ── Calendar logic ──────────────────────────────────────────────────────────
  const firstDow = new Date(calYear, calMonth, 1).getDay();
  const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
  const calDays: (number | null)[] = [...Array(firstDow).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];
  const calDateStr = (d: number) => `${calYear}-${String(calMonth + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

  const filterDateRange = getDateRange(dateFilter, customStart, customEnd);

  // No-shop state — barber not yet linked to a shop, or account without a shop
  if (!loadingAppts && !shop) {
    return (
      <div className="p-8 flex flex-col items-center justify-center min-h-[60vh] text-center">
        <div className="w-16 h-16 bg-gold/10 border border-gold/20 rounded-2xl flex items-center justify-center mx-auto mb-4">
          <Calendar size={28} className="text-gold" />
        </div>
        <h2 className="text-xl font-bold text-white mb-2">
          {profile?.role === "barber" ? "You're not linked to a shop yet" : "No shop found"}
        </h2>
        <p className="text-gray-500 text-sm max-w-sm mb-6">
          {profile?.role === "barber"
            ? "Ask your shop owner to add you as a barber, or join a shop once it's approved."
            : "Set up your barbershop to start managing appointments, clients, and more."}
        </p>
        {profile?.role !== "barber" && (
          <Link href="/onboarding"><Button>Set Up My Shop</Button></Link>
        )}
      </div>
    );
  }

  return (
    <div className="p-4 lg:p-8 animate-fade-in">
      {toast && <Toast message={toast} onClose={() => setToast("")} />}

      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">
            Good {new Date().getHours() < 12 ? "morning" : new Date().getHours() < 17 ? "afternoon" : "evening"}, {profile?.name?.split(" ")[0] ?? "there"}
          </h1>
          <p className="text-gray-500 text-sm mt-0.5">{new Date().toLocaleDateString("en-CA", { weekday: "long", month: "long", day: "numeric", year: "numeric" })} · {shop?.name}</p>
        </div>
        <div className="flex gap-2">
          <Link href="/dashboard/pos"><Button variant="outline" size="sm"><CreditCard size={16} /> Open POS</Button></Link>
          <Button onClick={() => setShowAddWalkin(true)} size="sm"><Plus size={16} /> Add Walk-in</Button>
        </div>
      </div>

      {/* Date Filter */}
      <div className="flex flex-wrap gap-2 mb-6 items-center">
        <select
          value={dateFilter}
          onChange={(e) => { setDateFilter(e.target.value as DateFilterKey); setSelectedCalDate(null); }}
          className="bg-surface-raised border border-border rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-gold/50"
        >
          {Object.entries(DATE_FILTER_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        {dateFilter === "custom" && (
          <>
            <input type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)}
              className="bg-surface-raised border border-border rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-gold/50" />
            <span className="text-gray-500 text-sm">to</span>
            <input type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)}
              className="bg-surface-raised border border-border rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-gold/50" />
          </>
        )}
        <span className="text-xs text-gray-500 ml-1">{filterDateRange[0]} — {filterDateRange[1]}</span>
      </div>

      {/* Stats */}
      {loadingAppts ? (
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-24" />)}
        </div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
          <StatCard label="Total Appointments" value={String(appointments.length)} sub={`${completed.length} completed`} icon={Calendar} color="gold" />
          <StatCard label="Revenue" value={formatCurrency(revenue)} sub="Completed bookings" icon={DollarSign} color="green" />
          <StatCard label="New Clients" value={String(appointments.filter((a) => {
            const s = filterDateRange[0]; const e = filterDateRange[1];
            return a.created_at.slice(0, 10) >= s && a.created_at.slice(0, 10) <= e;
          }).length)} sub="This period" icon={Users} color="blue" />
          <StatCard label="Avg Ticket" value={formatCurrency(avgTicket)} sub="Per completed visit" icon={TrendingUp} color="purple" />
          <StatCard label="No-Show Rate" value={`${noShowRate.toFixed(1)}%`} sub={`${noShows} no-shows`} icon={UserX} color="orange" />
          <StatCard label="Avg Rating" value="4.8★" sub="127 total reviews" icon={Star} color="purple" />
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left / main column */}
        <div className="lg:col-span-2 space-y-5">
          {/* Calendar Widget */}
          <Card>
            <CardHeader>
              <CardTitle>
                {new Date(calYear, calMonth).toLocaleDateString("en-CA", { month: "long", year: "numeric" })}
              </CardTitle>
              <div className="flex gap-1">
                <button onClick={() => { if (calMonth === 0) { setCalMonth(11); setCalYear(y => y - 1); } else setCalMonth(m => m - 1); }}
                  className="p-1.5 rounded-lg hover:bg-surface-raised text-gray-400 hover:text-white transition-colors"><ChevronLeft size={16} /></button>
                <button onClick={() => { if (calMonth === 11) { setCalMonth(0); setCalYear(y => y + 1); } else setCalMonth(m => m + 1); }}
                  className="p-1.5 rounded-lg hover:bg-surface-raised text-gray-400 hover:text-white transition-colors"><ChevronRight size={16} /></button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-7 gap-1 mb-2">
                {["Su","Mo","Tu","We","Th","Fr","Sa"].map((d) => (
                  <div key={d} className="text-center text-xs text-gray-500 font-medium py-1">{d}</div>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-1">
                {calDays.map((d, i) => {
                  if (d === null) return <div key={`empty-${i}`} />;
                  const ds = calDateStr(d);
                  const count = apptCounts[ds] ?? 0;
                  const isToday = ds === todayStr;
                  const isSelected = ds === selectedCalDate;
                  return (
                    <button key={ds} onClick={() => setSelectedCalDate(isSelected ? null : ds)}
                      className={cn(
                        "relative flex flex-col items-center justify-center rounded-xl py-1.5 text-sm transition-all min-h-[44px]",
                        isSelected ? "bg-gold text-black font-bold" :
                        isToday ? "border border-gold text-gold" :
                        "hover:bg-surface-raised text-gray-300"
                      )}
                    >
                      {d}
                      {count > 0 && (
                        <span className={cn("mt-0.5 min-w-[18px] text-center px-1 rounded-full text-xs font-bold", isSelected ? "bg-black/30 text-black" : "bg-gold/20 text-gold")}>{count}</span>
                      )}
                    </button>
                  );
                })}
              </div>
              {selectedCalDate && (
                <p className="text-xs text-gold mt-3 text-center">
                  Showing {apptCounts[selectedCalDate] ?? 0} appointments for {new Date(selectedCalDate + "T00:00:00").toLocaleDateString("en-CA", { month: "long", day: "numeric" })}
                  <button onClick={() => setSelectedCalDate(null)} className="ml-2 text-gray-500 hover:text-white underline">Clear</button>
                </p>
              )}
            </CardContent>
          </Card>

          {/* Today's / Selected Schedule */}
          <Card>
            <CardHeader>
              <CardTitle>{selectedCalDate ? `Appointments — ${new Date(selectedCalDate + "T00:00:00").toLocaleDateString("en-CA", { month: "short", day: "numeric" })}` : "Today's Schedule"}</CardTitle>
              <Link href="/dashboard/appointments" className="text-xs text-gold hover:underline">View all</Link>
            </CardHeader>
            <CardContent>
              {loadingAppts ? (
                <div className="space-y-3">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-14" />)}</div>
              ) : displayAppts.length === 0 ? (
                <div className="py-8 text-center text-gray-500">
                  <Calendar size={32} className="mx-auto mb-2 opacity-30" />
                  <p>No appointments{selectedCalDate ? " on this date" : " today"}</p>
                </div>
              ) : (
                displayAppts.map((apt) => (
                  <div key={apt.id} className="flex items-center gap-3 py-3 border-b border-border last:border-0">
                    <div className="text-center min-w-[52px]">
                      <p className="text-xs text-gray-500">{apt.time_slot.split(" ")[0]}</p>
                      <p className="text-xs text-gray-500">{apt.time_slot.split(" ")[1]}</p>
                    </div>
                    <div className="w-px h-10 bg-border" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-white truncate">{apt.client_name}</p>
                      <p className="text-xs text-gray-500 truncate">
                        {apt.services?.name ?? "Service"} · {apt.barbers?.name ?? "Barber"}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className={cn("text-xs px-2 py-0.5 rounded-full border font-medium capitalize", getStatusColor(apt.status))}>{apt.status}</span>
                      <span className="text-sm font-semibold text-gold">{formatCurrency(apt.total_amount)}</span>
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          {/* Revenue Chart */}
          <Card>
            <CardHeader>
              <CardTitle>Revenue Over Period</CardTitle>
              <span className="text-xs text-gray-500">Total: <span className="text-gold font-semibold">{formatCurrency(revenue)}</span></span>
            </CardHeader>
            <CardContent>
              {chartData.length === 0 ? (
                <div className="h-[180px] flex items-center justify-center text-gray-500 text-sm">No revenue data for this period</div>
              ) : (
                <ResponsiveContainer width="100%" height={180}>
                  <BarChart data={chartData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                    <XAxis dataKey="day" tick={{ fontSize: 11, fill: "#6B7280" }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 11, fill: "#6B7280" }} axisLine={false} tickLine={false} />
                    <Tooltip content={<ChartTooltip />} />
                    <Bar dataKey="revenue" fill="#C9A84C" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right column */}
        <div className="space-y-4">
          {/* Quick Actions */}
          <Card>
            <CardHeader><CardTitle>Quick Actions</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {[
                { label: "Add Walk-in", onClick: () => setShowAddWalkin(true), icon: Plus, gold: true },
                { label: "View Appointments", href: "/dashboard/appointments", icon: Calendar, gold: false },
                { label: "Open POS", href: "/dashboard/pos", icon: CreditCard, gold: false },
                { label: "Manage Staff", href: "/dashboard/staff", icon: Users, gold: false },
              ].map((action) => (
                action.href ? (
                  <Link key={action.label} href={action.href}>
                    <div className={cn("flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all cursor-pointer", action.gold ? "bg-gold/15 text-gold border border-gold/20 hover:bg-gold/20" : "text-gray-400 hover:text-white hover:bg-surface-raised")}>
                      <action.icon size={16} />{action.label}<ChevronRight size={14} className="ml-auto opacity-50" />
                    </div>
                  </Link>
                ) : (
                  <button key={action.label} onClick={action.onClick} className={cn("w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all", action.gold ? "bg-gold/15 text-gold border border-gold/20 hover:bg-gold/20" : "text-gray-400 hover:text-white hover:bg-surface-raised")}>
                    <action.icon size={16} />{action.label}<ChevronRight size={14} className="ml-auto opacity-50" />
                  </button>
                )
              ))}
            </CardContent>
          </Card>

          {/* Staff Status */}
          <Card>
            <CardHeader><CardTitle>Staff Status</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {barbers.length === 0 ? (
                <p className="text-sm text-gray-500 text-center py-4">No active staff</p>
              ) : barbers.map((b) => (
                <div key={b.id} className="flex items-center gap-3">
                  <div className="relative">
                    {b.photo
                      ? <img src={b.photo} alt={b.name} className="w-9 h-9 rounded-full object-cover border border-border" />
                      : <div className="w-9 h-9 rounded-full bg-gold/20 border border-gold/30 flex items-center justify-center text-gold font-bold text-sm">{b.name[0]}</div>
                    }
                    <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-emerald-400 border-2 border-surface rounded-full" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-white truncate">{b.name}</p>
                    <p className="text-xs text-gray-500">
                      {todayAppts.filter((a) => a.barber_id === b.id).length} appts today
                    </p>
                  </div>
                  <span className="text-xs text-emerald-400 font-medium">Active</span>
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Notifications */}
          <Card>
            <CardHeader>
              <CardTitle>Recent Alerts</CardTitle>
              <Link href="/dashboard/notifications" className="text-xs text-gold hover:underline">
                See all ({notifications.filter((n) => !n.is_read).length})
              </Link>
            </CardHeader>
            <CardContent className="space-y-3">
              {notifications.length === 0 ? (
                <p className="text-sm text-gray-500 text-center py-4">No notifications</p>
              ) : notifications.map((n) => (
                <div key={n.id} className={cn("flex gap-2.5 p-2.5 rounded-xl", !n.is_read && "bg-gold/5 border border-gold/10")}>
                  <div className={cn("mt-0.5 w-6 h-6 rounded-full flex-shrink-0 flex items-center justify-center text-xs",
                    n.type === "booking" ? "bg-gold/20 text-gold" : n.type === "no-show" ? "bg-orange-500/20 text-orange-400" : n.type === "review" ? "bg-purple-500/20 text-purple-400" : "bg-red-500/20 text-red-400")}>
                    {n.type === "booking" ? <Calendar size={12} /> : n.type === "review" ? <Star size={12} /> : <AlertCircle size={12} />}
                  </div>
                  <div>
                    <p className="text-xs font-medium text-white">{n.title}</p>
                    <p className="text-xs text-gray-500 leading-relaxed mt-0.5 line-clamp-2">{n.message}</p>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Add Walk-in Modal */}
      {showAddWalkin && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
          <div className="bg-surface border border-border rounded-2xl w-full max-w-md p-6 animate-slide-up">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-white">Add Walk-in Client</h2>
              <button onClick={() => setShowAddWalkin(false)} className="text-gray-500 hover:text-white"><X size={20} /></button>
            </div>
            <div className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-sm text-gray-400">Client Name</label>
                <input value={walkinName} onChange={(e) => setWalkinName(e.target.value)} className="w-full bg-surface-raised border border-border rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-gold/50" placeholder="Walk-in Client" />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm text-gray-400">Barber</label>
                <select value={walkinBarber} onChange={(e) => setWalkinBarber(e.target.value)} className="w-full bg-surface-raised border border-border rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-gold/50">
                  <option value="">Any Available</option>
                  {barbers.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm text-gray-400">Note</label>
                <input value={walkinService} onChange={(e) => setWalkinService(e.target.value)} className="w-full bg-surface-raised border border-border rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-gold/50" placeholder="e.g. Haircut" />
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <Button variant="outline" className="flex-1" onClick={() => setShowAddWalkin(false)}>Cancel</Button>
              <Button className="flex-1" loading={savingWalkin} onClick={async () => {
                if (!shop || !walkinName.trim()) return;
                setSavingWalkin(true);
                await supabase.from("waitlist").insert({ shop_id: shop.id, barber_id: walkinBarber || null, client_name: walkinName, client_phone: "", status: "waiting", added_at: new Date().toISOString() });
                setSavingWalkin(false);
                setShowAddWalkin(false);
                setWalkinName(""); setWalkinBarber(""); setWalkinService("");
                showToast("Walk-in added to waitlist!");
              }}>
                <Plus size={16} /> Add to Waitlist
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
