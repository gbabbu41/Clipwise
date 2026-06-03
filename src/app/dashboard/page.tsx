"use client";
import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  Calendar, DollarSign, Users, Star, Plus, X, CreditCard,
  ChevronRight, AlertCircle, TrendingUp, UserX,
} from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Calendar as CalendarPicker } from "@/components/ui/calendar";
import { OnboardingBanner } from "@/components/dashboard/onboarding-banner";
import { cn, formatCurrency, getStatusColor, getDateRange, DATE_FILTER_LABELS, formatDateForDb, DateFilterKey } from "@/lib/utils";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip } from "recharts";
import type { AppointmentWithDetails, Barber, Notification } from "@/lib/database.types";

// ─── Skeleton ─────────────────────────────────────────────────────────────────
function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse bg-[#141414] rounded-xl", className)} />;
}

// ─── Toast ────────────────────────────────────────────────────────────────────
function Toast({ message, onClose }: { message: string; onClose: () => void }) {
  return (
    <div className="fixed bottom-6 right-6 z-[100] bg-[#141414] border border-[#1e1e1e] rounded-xl px-5 py-3 text-sm text-white shadow-xl flex items-center gap-3">
      <span className="text-white">✓</span>{message}
      <button onClick={onClose} className="text-[#777] hover:text-white ml-2">✕</button>
    </div>
  );
}

// ─── Stat Card ────────────────────────────────────────────────────────────────
function StatCard({ label, value, sub, icon: Icon, color = "gold", cta, prominent = false }: {
  label: string;
  value: string;
  sub: string;
  icon: React.ElementType;
  color?: string;
  // When the card represents zero/empty data, pass a `cta` and the sub line
  // is replaced by a small gold link nudging the owner toward a useful next
  // step (e.g. "Book your first appointment →").
  cta?: { text: string; href: string };
  // The two headline KPIs (Total Appointments + Revenue) render with extra
  // padding, a larger value, and a subtle gold border so they read as primary.
  prominent?: boolean;
}) {
  // On the light dashboard surface the icon chip is the only colored thing
  // on the card. Two-tone tinted background overlay was a dark-mode device —
  // on white it just looks like a misprint. Dropped entirely.
  const iconChipByColor: Record<string, string> = {
    gold: "bg-[#141414] text-[#aaa]",
    green: "bg-emerald-50 text-emerald-600",
    blue: "bg-blue-50 text-blue-600",
    purple: "bg-purple-50 text-purple-600",
    orange: "bg-orange-50 text-orange-600",
  };
  const iconChip = iconChipByColor[color] ?? iconChipByColor.gold;
  return (
    <Card
      className={cn(
        prominent ? "p-5 sm:p-6" : "p-4",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className={cn("text-[#777] font-medium uppercase tracking-wider", prominent ? "text-[11px]" : "text-xs")}>
            {label}
          </p>
          <p
            className={cn(
              // Numbers use DM Mono via `font-mono` to match the design's
              // numeric type treatment. Mobile bumps base size; desktop
              // keeps the prominent variant for the 2-up KPI cards.
              "font-extrabold text-white mt-1.5 font-mono tracking-tighter leading-none",
              prominent ? "text-3xl sm:text-4xl" : "text-[28px] md:text-xl",
            )}
          >
            {value}
          </p>
          {cta ? (
            <Link
              href={cta.href}
              className={cn(
                "text-white hover:text-white/80 hover:underline mt-2 inline-flex items-center gap-0.5",
                prominent ? "text-sm" : "text-xs",
              )}
            >
              {cta.text}
              <ChevronRight size={prominent ? 13 : 11} />
            </Link>
          ) : (
            <p className={cn("text-[#777] mt-1.5", prominent ? "text-xs" : "text-[11px]")}>{sub}</p>
          )}
        </div>
        {/* Icon chip hidden on mobile to match the reference's clean
            label/value/sub stat cards. Shown md+ to break up the grid. */}
        <div
          className={cn(
            "rounded-xl flex-shrink-0 hidden md:flex items-center justify-center",
            iconChip,
            prominent ? "p-3" : "p-2",
          )}
        >
          <Icon size={prominent ? 22 : 18} />
        </div>
      </div>
    </Card>
  );
}

// ─── Custom Chart Tooltip ─────────────────────────────────────────────────────
function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: { value: number }[]; label?: string }) {
  if (active && payload?.length) {
    return (
      <div className="bg-[#141414] border border-[#1e1e1e] rounded-xl px-3 py-2 text-xs">
        <p className="text-[#777]">{label}</p>
        <p className="text-white font-semibold">{formatCurrency(payload[0].value)}</p>
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
  // Date-range pill next to the dropdown is clickable — opens a calendar
  // popover for picking a single specific date.
  const [showDatePicker, setShowDatePicker] = useState(false);

  // ── Calendar state ──────────────────────────────────────────────────────────
  const [calYear, setCalYear] = useState(new Date().getFullYear());
  const [calMonth, setCalMonth] = useState(new Date().getMonth());
  const [selectedCalDate, setSelectedCalDate] = useState<string | null>(null);

  // ── Data state ──────────────────────────────────────────────────────────────
  const [loadingAppts, setLoadingAppts] = useState(true);
  const [appointments, setAppointments] = useState<AppointmentWithDetails[]>([]);
  // Appointments fetched specifically for the calendar-selected date, so
  // clicking a day outside the active dateFilter range still surfaces the
  // bookings underneath (the main `appointments` array is bound to dateFilter).
  const [selectedDayAppts, setSelectedDayAppts] = useState<AppointmentWithDetails[]>([]);
  const [loadingSelectedDay, setLoadingSelectedDay] = useState(false);
  const [barbers, setBarbers] = useState<Barber[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [apptCounts, setApptCounts] = useState<Record<string, number>>({});
  const [myBarberId, setMyBarberId] = useState<string | null>(null);
  const [avgRating, setAvgRating] = useState<number | null>(null);
  const [totalReviews, setTotalReviews] = useState(0);

  // ── UI state ────────────────────────────────────────────────────────────────
  const [showAddWalkin, setShowAddWalkin] = useState(false);
  const [walkinName, setWalkinName] = useState("");
  const [walkinBarber, setWalkinBarber] = useState("");
  const [walkinService, setWalkinService] = useState("");
  const [savingWalkin, setSavingWalkin] = useState(false);
  const [toast, setToast] = useState("");
  const [clockedIn, setClockedIn] = useState<{ id: string; clock_in: string } | null>(null);
  const [clockLoading, setClockLoading] = useState(false);
  const [newBookingNotif, setNewBookingNotif] = useState<{ title: string; message: string } | null>(null);

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(""), 3000); };

  // ── Resolve barber record ID for logged-in barbers ─────────────────────────
  useEffect(() => {
    if (!profile || profile.role !== "barber" || !shop) return;
    supabase.from("barbers").select("id").eq("user_id", profile.id).eq("shop_id", shop.id).maybeSingle()
      .then(({ data }) => { if (data) setMyBarberId(data.id); });
  }, [profile, shop]);

  // ── Load clock-in status for barbers ────────────────────────────────────────
  useEffect(() => {
    if (!myBarberId || !shop) return;
    const today = formatDateForDb(new Date());
    supabase.from("staff_hours").select("id, clock_in").eq("barber_id", myBarberId).eq("date", today).is("clock_out", null).maybeSingle()
      .then(({ data }) => { if (data) setClockedIn({ id: data.id, clock_in: data.clock_in }); });
  }, [myBarberId, shop]);

  // ── Realtime new booking notifications for shop owners ─────────────────────
  useEffect(() => {
    if (!shop || profile?.role !== "shop_owner") return;
    const channel = supabase
      .channel(`booking-notifs:${shop.id}`)
      .on("postgres_changes", {
        event: "INSERT", schema: "public", table: "notifications",
        filter: `user_id=eq.${shop.owner_id}`,
      }, (payload) => {
        const n = payload.new as { type: string; title: string; message: string };
        if (n.type === "booking") setNewBookingNotif({ title: n.title, message: n.message });
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [shop, profile]);

  const handleClockIn = async () => {
    if (!myBarberId || !shop) return;
    setClockLoading(true);
    const now = new Date();
    const { data } = await supabase.from("staff_hours").insert({
      barber_id: myBarberId,
      shop_id: shop.id,
      date: formatDateForDb(now),
      clock_in: now.toTimeString().slice(0, 5),
    }).select("id, clock_in").single();
    if (data) { setClockedIn({ id: data.id, clock_in: data.clock_in }); showToast("Clocked in!"); }
    setClockLoading(false);
  };

  const handleClockOut = async () => {
    if (!clockedIn) return;
    setClockLoading(true);
    const now = new Date();
    const outStr = now.toTimeString().slice(0, 5);
    const [inH, inM] = clockedIn.clock_in.split(":").map(Number);
    const hours = Math.round(((now.getHours() * 60 + now.getMinutes()) - (inH * 60 + inM)) / 60 * 100) / 100;
    await supabase.from("staff_hours").update({ clock_out: outStr, hours_worked: hours }).eq("id", clockedIn.id);
    setClockedIn(null);
    showToast(`Clocked out! ${hours}h worked`);
    setClockLoading(false);
  };

  // ── Load appointments ───────────────────────────────────────────────────────
  const loadAppointments = useCallback(async () => {
    if (!shop) { setLoadingAppts(false); return; }
    setLoadingAppts(true);
    const [start, end] = getDateRange(dateFilter, customStart, customEnd);
    let q = supabase
      .from("appointments")
      .select("*, barbers(id, name), services(id, name, price, category)")
      .eq("shop_id", shop.id)
      .gte("date", start)
      .lte("date", end)
      .order("date", { ascending: true })
      .order("time_slot", { ascending: true });
    // Barbers only see their own appointments
    if (profile?.role === "barber" && myBarberId) {
      q = q.eq("barber_id", myBarberId);
    }
    const { data } = await q;
    setAppointments((data ?? []) as AppointmentWithDetails[]);
    setLoadingAppts(false);
  }, [shop, dateFilter, customStart, customEnd, profile, myBarberId]);

  // ── Load barbers & notifications ────────────────────────────────────────────
  const loadSideData = useCallback(async () => {
    if (!shop || !profile) return;
    const [{ data: b }, { data: n }, { data: rev }] = await Promise.all([
      supabase.from("barbers").select("*").eq("shop_id", shop.id).eq("is_active", true),
      supabase.from("notifications").select("*").eq("user_id", profile.id).order("created_at", { ascending: false }).limit(5),
      supabase.from("reviews").select("rating").eq("shop_id", shop.id),
    ]);
    setBarbers((b ?? []) as Barber[]);
    setNotifications((n ?? []) as Notification[]);
    if (rev && rev.length > 0) {
      const avg = rev.reduce((s: number, r: { rating: number }) => s + r.rating, 0) / rev.length;
      setAvgRating(Math.round(avg * 10) / 10);
      setTotalReviews(rev.length);
    }
  }, [shop, profile]);

  // ── Load calendar appointment counts for current month ─────────────────────
  const loadCalendarCounts = useCallback(async () => {
    if (!shop) return;
    const firstDay = formatDateForDb(new Date(calYear, calMonth, 1));
    const lastDay = formatDateForDb(new Date(calYear, calMonth + 1, 0));
    let calQ = supabase
      .from("appointments")
      .select("date")
      .eq("shop_id", shop.id)
      .gte("date", firstDay)
      .lte("date", lastDay);
    if (profile?.role === "barber" && myBarberId) {
      calQ = calQ.eq("barber_id", myBarberId);
    }
    const { data } = await calQ;
    const counts: Record<string, number> = {};
    (data ?? []).forEach((a: { date: string }) => { counts[a.date] = (counts[a.date] ?? 0) + 1; });
    setApptCounts(counts);
  }, [shop, calYear, calMonth, profile, myBarberId]);

  useEffect(() => { loadAppointments(); }, [loadAppointments]);
  useEffect(() => { loadSideData(); }, [loadSideData]);
  useEffect(() => { loadCalendarCounts(); }, [loadCalendarCounts]);

  // ── Load appointments for the calendar-selected date ───────────────────────
  // Independent of the main dateFilter — clicking June 15 should always
  // surface June 15's bookings underneath, even if the filter is "today".
  useEffect(() => {
    if (!shop || !selectedCalDate) { setSelectedDayAppts([]); return; }
    setLoadingSelectedDay(true);
    let q = supabase
      .from("appointments")
      .select("*, barbers(id, name), services(id, name, price, category)")
      .eq("shop_id", shop.id)
      .eq("date", selectedCalDate)
      .order("time_slot", { ascending: true });
    if (profile?.role === "barber" && myBarberId) {
      q = q.eq("barber_id", myBarberId);
    }
    q.then(({ data }) => {
      setSelectedDayAppts((data ?? []) as AppointmentWithDetails[]);
      setLoadingSelectedDay(false);
    });
  }, [shop, selectedCalDate, profile, myBarberId]);

  // ── Computed stats ──────────────────────────────────────────────────────────
  // When the user clicks a day in the calendar we serve the date-specific
  // fetch (selectedDayAppts) so the picked date's bookings always render,
  // independent of the page-level dateFilter.
  const displayAppts = selectedCalDate ? selectedDayAppts : appointments;
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

  // (Calendar rendering is now handled by the shared <CalendarPicker>; we
  // only keep apptCounts keyed by YYYY-MM-DD for the day-badge slot.)

  const filterDateRange = getDateRange(dateFilter, customStart, customEnd);

  // No-shop state — barber not yet linked to a shop, or account without a shop
  if (!loadingAppts && !shop) {
    return (
      <div className="p-8 flex flex-col items-center justify-center min-h-[60vh] text-center">
        <div className="w-16 h-16 bg-black/5 border border-[#1e1e1e] rounded-2xl flex items-center justify-center mx-auto mb-4">
          <Calendar size={28} className="text-white" />
        </div>
        <h2 className="text-xl font-bold text-white mb-2">
          {profile?.role === "barber" ? "You're not linked to a shop yet" : "No shop found"}
        </h2>
        <p className="text-[#777] text-sm max-w-sm mb-6">
          {profile?.role === "barber"
            ? "You're not linked to a shop yet. Browse approved shops and request to join."
            : "Set up your barbershop to start managing appointments, clients, and more."}
        </p>
        {profile?.role === "barber" ? (
          <Link href="/join-shop"><Button>Browse Shops to Join</Button></Link>
        ) : (
          <Link href="/onboarding"><Button>Set Up My Shop</Button></Link>
        )}
      </div>
    );
  }

  return (
    <div className="p-4 lg:p-8 animate-fade-in">
      {toast && <Toast message={toast} onClose={() => setToast("")} />}

      {/* New Booking Notification Modal */}
      {newBookingNotif && (
        <>
          <div className="fixed inset-0 bg-black/60 z-[80]" onClick={() => setNewBookingNotif(null)} />
          <div className="fixed inset-0 z-[90] flex items-center justify-center p-4">
            <div className="bg-black shadow-sm border border-black rounded-2xl p-6 w-full max-w-sm text-center shadow-2xl gold-glow animate-fade-in">
              <div className="w-14 h-14 rounded-full bg-black/10 border border-black flex items-center justify-center mx-auto mb-4">
                <Calendar size={24} className="text-white" />
              </div>
              <h2 className="text-lg font-bold text-white mb-1">{newBookingNotif.title}</h2>
              <p className="text-sm text-[#777] mb-5">{newBookingNotif.message}</p>
              <div className="flex gap-3">
                <Button variant="outline" className="flex-1" onClick={() => setNewBookingNotif(null)}>Dismiss</Button>
                <Link href="/dashboard/appointments" className="flex-1">
                  <Button className="w-full" onClick={() => setNewBookingNotif(null)}>View Booking</Button>
                </Link>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Expired / past-due subscription banner */}
      {shop && profile?.role === "shop_owner" && (shop.subscription_status === "cancelled" || shop.subscription_status === "past_due") && shop.subscription_plan !== "starter" && (
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 bg-orange-500/10 border border-orange-500/30 rounded-2xl p-4">
          <div className="flex items-center gap-3">
            <AlertCircle size={18} className="text-orange-400 flex-shrink-0" />
            <p className="text-sm text-orange-200">
              Your subscription has {shop.subscription_status === "past_due" ? "a past-due payment" : "expired"}. Premium features are locked until you reactivate.
            </p>
          </div>
          <Link href="/dashboard/billing"><Button size="sm">Restore Features</Button></Link>
        </div>
      )}

      {/* Onboarding banner — shown to new shop owners */}
      {shop && profile?.role === "shop_owner" && (
        <div className="mb-6">
          <OnboardingBanner shop={shop} />
        </div>
      )}

      {/* Header — v2 layout: greeting on the left, plan pill on the right.
          POS / Add-Walk-in buttons stay on tablet+ (md:flex) but on small
          phones (md:hidden) they collapse to the white plan pill so the
          header matches the mobile reference layout exactly. */}
      <div className="flex flex-wrap items-start justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">
            Hello,{" "}
            <span className="md:inline">{profile?.name?.split(" ")[0] ?? "there"}</span>
          </h1>
          <p className="text-[#777] text-sm mt-0.5">{new Date().toLocaleDateString("en-CA", { weekday: "long", month: "long", day: "numeric", year: "numeric" })} · {shop?.name}</p>
        </div>
        {shop?.subscription_plan && shop.subscription_plan !== "starter" && (
          <span className="cw-plan-pill mt-1">{shop.subscription_plan}</span>
        )}
        <div className="hidden md:flex gap-2">
          <Link href="/dashboard/pos"><Button variant="outline" size="sm"><CreditCard size={16} /> Open POS</Button></Link>
          <Button onClick={() => setShowAddWalkin(true)} size="sm"><Plus size={16} /> Add Walk-in</Button>
        </div>
      </div>

      {/* Date Filter — hidden on mobile (the reference layout doesn't show
          it; mobile defaults to Today and digs in via the calendar / list
          below if a different range is needed). */}
      <div className="hidden md:flex flex-wrap gap-2 mb-6 items-center relative">
        <select
          value={dateFilter}
          onChange={(e) => { setDateFilter(e.target.value as DateFilterKey); setSelectedCalDate(null); }}
          className="bg-[#141414] border border-[#1e1e1e] rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-black"
        >
          {(Object.entries(DATE_FILTER_LABELS) as [DateFilterKey, string][])
            // "Custom Range" was dual date inputs — replaced by the
            // clickable calendar pill below for a single picked date.
            .filter(([k]) => k !== "custom")
            .map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        {/* Clickable date pill — opens a calendar popover. Collapses to a
            single date when start === end (Today, Yesterday, a picked day);
            shows the range with an em-dash otherwise. */}
        <button
          type="button"
          onClick={() => setShowDatePicker(s => !s)}
          className="text-xs text-[#999] ml-1 px-3 py-1.5 rounded-full bg-[#141414] border border-[#1e1e1e] hover:border-gray-400 hover:text-white transition-colors"
        >
          {filterDateRange[0] === filterDateRange[1]
            ? filterDateRange[0]
            : `${filterDateRange[0]} — ${filterDateRange[1]}`}
        </button>
        {showDatePicker && (
          <>
            <div className="fixed inset-0 z-30" onClick={() => setShowDatePicker(false)} />
            <div className="absolute left-0 top-full mt-2 z-40">
              <CalendarPicker
                value={new Date(filterDateRange[0] + "T00:00:00")}
                minDate={null}
                onChange={(d) => {
                  const ds = formatDateForDb(d);
                  setCustomStart(ds);
                  setCustomEnd(ds);
                  setDateFilter("custom" as DateFilterKey);
                  setSelectedCalDate(null);
                  setShowDatePicker(false);
                }}
              />
            </div>
          </>
        )}
      </div>

      {/* Stats */}
      {loadingAppts ? (
        <div className="mb-6 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-32" />)}
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24" />)}
          </div>
        </div>
      ) : (
        (() => {
          const newClients = appointments.filter((a) => {
            const s = filterDateRange[0]; const e = filterDateRange[1];
            return a.created_at.slice(0, 10) >= s && a.created_at.slice(0, 10) <= e;
          }).length;
          const hasAppts = appointments.length > 0;
          const hasCompleted = completed.length > 0;
          return (
            <div className="mb-6 space-y-3">
              {/* Hero revenue card — mobile-only anchor of the page.
                  Mirrors `.cw-hero` from the v2 spec: white card, DM Mono
                  dollar amount, trend line, mini bar sparkline on the right.
                  Bar heights from the last 5 entries of `weeklyRevenue`,
                  with the most-recent bar highlighted in solid black. */}
              <div className="cw-hero md:flex md:hidden flex items-center justify-between">
                <div className="flex-1 min-w-0">
                  <div className="cw-hero-label">Today&apos;s Revenue</div>
                  <div className="cw-hero-value">{formatCurrency(revenue)}</div>
                  <div className="cw-hero-trend">
                    {hasCompleted
                      ? `↑ ${completed.length} booking${completed.length !== 1 ? "s" : ""}`
                      : "No bookings yet today"}
                  </div>
                </div>
                <div className="cw-mini-bars">
                  {(() => {
                    // Use the last 5 days of chartData; if no data yet, render
                    // a low placeholder set so the hero still shows the shape.
                    const tail = chartData.length > 0
                      ? chartData.slice(-5)
                      : [0,0,0,0,0].map((_, i) => ({ day: `d${i}`, revenue: 0 }));
                    const max = Math.max(1, ...tail.map(d => d.revenue));
                    return tail.map((d, i) => (
                      <div
                        key={d.day + i}
                        className={cn("cw-mb", i === tail.length - 1 && "hi")}
                        style={{ height: `${Math.max(18, (d.revenue / max) * 100)}%` }}
                      />
                    ));
                  })()}
                </div>
              </div>

              {/* Quick Actions — mobile-only row. 4 dark squares with the
                  most-tapped destinations. Walk-in opens the existing modal;
                  POS / Reports / Settings deep-link to their pages. */}
              <div className="md:hidden">
                <div className="cw-row-hdr">
                  <div className="cw-row-title">Quick Actions</div>
                </div>
                <div className="grid grid-cols-4 gap-2">
                  <button type="button" onClick={() => setShowAddWalkin(true)} className="cw-qa">
                    <div className="cw-qa-icon">➕</div>
                    <div className="cw-qa-label">Walk In</div>
                  </button>
                  <Link href="/dashboard/pos" className="cw-qa">
                    <div className="cw-qa-icon">💳</div>
                    <div className="cw-qa-label">POS</div>
                  </Link>
                  <Link href="/dashboard/analytics" className="cw-qa">
                    <div className="cw-qa-icon">📊</div>
                    <div className="cw-qa-label">Reports</div>
                  </Link>
                  <Link href="/dashboard/settings" className="cw-qa">
                    <div className="cw-qa-icon">⚙️</div>
                    <div className="cw-qa-label">Settings</div>
                  </Link>
                </div>
              </div>

              {/* Primary KPIs — Total Appointments + Revenue.
                  Prominent variant: taller cards, larger value. Hidden on
                  mobile (the hero card above already covers revenue). */}
              <div className="hidden md:grid sm:grid-cols-2 gap-4">
                <StatCard
                  label="Total Appointments"
                  value={String(appointments.length)}
                  sub={`${completed.length} completed`}
                  icon={Calendar} color="gold"
                  prominent
                  cta={!hasAppts ? { text: "Book your first appointment", href: "/dashboard/appointments" } : undefined}
                />
                <StatCard
                  label="Revenue"
                  value={formatCurrency(revenue)}
                  sub={hasCompleted ? "Completed bookings" : "No bookings yet"}
                  icon={DollarSign} color="green"
                  prominent
                />
              </div>

              {/* Secondary metrics — 2x2 on mobile (matches design),
                  4-up on desktop. */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <StatCard
                  label="Appointments"
                  value={String(appointments.length)}
                  sub={`${completed.length} completed`}
                  icon={Calendar} color="gold"
                />
                <StatCard
                  label="New Clients"
                  value={String(newClients)}
                  sub="This period"
                  icon={Users} color="blue"
                  cta={newClients === 0 ? { text: "Share booking link", href: "/dashboard/share" } : undefined}
                />
                <StatCard
                  label="Avg Ticket"
                  value={formatCurrency(avgTicket)}
                  sub={hasCompleted ? "Per completed visit" : "Complete a booking first"}
                  icon={TrendingUp} color="purple"
                />
                <StatCard
                  label="No-Show Rate"
                  value={hasAppts ? `${noShowRate.toFixed(1)}%` : "—"}
                  sub={hasAppts ? `${noShows} no-show${noShows !== 1 ? "s" : ""}` : "No data yet"}
                  icon={UserX} color="orange"
                />
                <StatCard
                  label="Avg Rating"
                  value={avgRating != null ? `${avgRating}★` : "—"}
                  sub={totalReviews > 0 ? `${totalReviews} review${totalReviews !== 1 ? "s" : ""}` : "No reviews yet"}
                  icon={Star} color="purple"
                  cta={totalReviews === 0 ? { text: "Invite reviews", href: "/dashboard/reviews" } : undefined}
                />
              </div>
            </div>
          );
        })()
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left / main column */}
        <div className="lg:col-span-2 space-y-5">
          {/* Calendar Widget — uses the shared <Calendar> component for proper
              month navigation, focus handling, and tap targets. Past dates are
              greyed via minDate, today and future remain clickable.
              Soft bone tint (matches the ceramic accent palette) so it
              visually separates from the surrounding cards. */}
          <Card className="!bg-[#141414]">
            <CardContent>
              <CalendarPicker
                value={selectedCalDate ? new Date(selectedCalDate + "T00:00:00") : null}
                onChange={(d) => {
                  const ds = formatDateForDb(d);
                  setSelectedCalDate(ds === selectedCalDate ? null : ds);
                }}
                onMonthChange={(first) => { setCalYear(first.getFullYear()); setCalMonth(first.getMonth()); }}
                renderDayBadge={(d) => {
                  const ds = formatDateForDb(d);
                  const count = apptCounts[ds] ?? 0;
                  if (count === 0) return null;
                  const isSelected = ds === selectedCalDate;
                  return (
                    <span className={cn(
                      "min-w-[18px] text-center px-1 rounded-full text-[10px] font-bold leading-tight",
                      isSelected ? "bg-blue-600 text-white" : "bg-blue-100 text-blue-700",
                    )}>
                      {count}
                    </span>
                  );
                }}
                className="max-w-none w-full"
              />
              {selectedCalDate && (
                <p className="text-xs text-white mt-3 text-center">
                  Showing {apptCounts[selectedCalDate] ?? 0} appointment{(apptCounts[selectedCalDate] ?? 0) === 1 ? "" : "s"} for {new Date(selectedCalDate + "T00:00:00").toLocaleDateString("en-CA", { month: "long", day: "numeric" })}
                  <button onClick={() => setSelectedCalDate(null)} className="ml-2 text-[#777] hover:text-white underline">Clear</button>
                </p>
              )}
            </CardContent>
          </Card>

          {/* Today's / Selected Schedule — same bone tint as the calendar
              above, so the two cards read as a connected unit. */}
          <Card className="!bg-[#141414]">
            <CardHeader>
              <CardTitle>{selectedCalDate ? `Appointments — ${new Date(selectedCalDate + "T00:00:00").toLocaleDateString("en-CA", { month: "short", day: "numeric" })}` : "Today's Schedule"}</CardTitle>
              <Link href="/dashboard/appointments" className="text-xs text-white hover:underline">View all</Link>
            </CardHeader>
            <CardContent>
              {(selectedCalDate ? loadingSelectedDay : loadingAppts) ? (
                <div className="space-y-3">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-14" />)}</div>
              ) : displayAppts.length === 0 ? (
                <div className="py-8 text-center text-[#777]">
                  <Calendar size={32} className="mx-auto mb-2 opacity-30" />
                  <p>No appointments{selectedCalDate ? " on this date" : " today"}</p>
                </div>
              ) : (
                displayAppts.map((apt) => (
                  <div key={apt.id} className="flex items-center gap-3 py-3 border-b border-[#1e1e1e] last:border-0">
                    <div className="text-center min-w-[52px]">
                      <p className="text-xs text-[#aaa]">{apt.time_slot.split(" ")[0]}</p>
                      <p className="text-xs text-[#777]">{apt.time_slot.split(" ")[1]}</p>
                    </div>
                    <div className="w-px h-10 bg-[#1e1e1e]" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-white truncate">{apt.client_name}</p>
                      <p className="text-xs text-[#777] truncate">
                        {apt.services?.name ?? "Service"} · {apt.barbers?.name ?? "Barber"}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className={cn("text-xs px-2 py-0.5 rounded-full border font-medium capitalize", getStatusColor(apt.status))}>{apt.status}</span>
                      <span className="text-sm font-semibold text-white">{formatCurrency(apt.total_amount)}</span>
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
              <span className="text-xs text-[#777]">Total: <span className="text-white font-semibold">{formatCurrency(revenue)}</span></span>
            </CardHeader>
            <CardContent>
              {chartData.length === 0 ? (
                <div className="h-[180px] flex items-center justify-center text-[#777] text-sm">No revenue data for this period</div>
              ) : (
                <ResponsiveContainer width="100%" height={180}>
                  <BarChart data={chartData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                    <XAxis dataKey="day" tick={{ fontSize: 11, fill: "#6B7280" }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 11, fill: "#6B7280" }} axisLine={false} tickLine={false} />
                    <Tooltip content={<ChartTooltip />} />
                    <Bar dataKey="revenue" fill="#F5F0E6" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right column */}
        <div className="space-y-4">
          {/* Clock In/Out — barbers only */}
          {profile?.role === "barber" && (
            <Card className={clockedIn ? "border-emerald-500/30" : ""}>
              <CardHeader>
                <CardTitle>Time Clock</CardTitle>
                {clockedIn && <span className="text-xs text-emerald-400 font-medium">● Clocked in {clockedIn.clock_in}</span>}
              </CardHeader>
              <CardContent>
                {clockedIn ? (
                  <Button variant="danger" className="w-full" loading={clockLoading} onClick={handleClockOut}>
                    Clock Out
                  </Button>
                ) : (
                  <Button className="w-full" loading={clockLoading} onClick={handleClockIn}>
                    Clock In
                  </Button>
                )}
              </CardContent>
            </Card>
          )}

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
                    <div className={cn("flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all cursor-pointer", action.gold ? "bg-black/10 text-white border border-[#1e1e1e] hover:bg-black/10" : "text-[#777] hover:text-white hover:bg-[#141414]")}>
                      <action.icon size={16} />{action.label}<ChevronRight size={14} className="ml-auto opacity-50" />
                    </div>
                  </Link>
                ) : (
                  <button key={action.label} onClick={action.onClick} className={cn("w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all", action.gold ? "bg-black/10 text-white border border-[#1e1e1e] hover:bg-black/10" : "text-[#777] hover:text-white hover:bg-[#141414]")}>
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
                <p className="text-sm text-[#777] text-center py-4">No active staff</p>
              ) : barbers.map((b) => (
                <div key={b.id} className="flex items-center gap-3">
                  <div className="relative">
                    {b.photo
                      ? <img src={b.photo} alt={b.name} className="w-9 h-9 rounded-full object-cover border border-[#1e1e1e]" />
                      : <div className="w-9 h-9 rounded-full bg-black/10 border border-black flex items-center justify-center text-white font-bold text-sm">{b.name[0]}</div>
                    }
                    <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-emerald-400 border-2 border-surface rounded-full" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-white truncate">{b.name}</p>
                    <p className="text-xs text-[#777]">
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
              <Link href="/dashboard/notifications" className="text-xs text-white hover:underline">
                See all ({notifications.filter((n) => !n.is_read).length})
              </Link>
            </CardHeader>
            <CardContent className="space-y-3">
              {notifications.length === 0 ? (
                <p className="text-sm text-[#777] text-center py-4">No notifications</p>
              ) : notifications.map((n) => (
                <div key={n.id} className={cn("flex gap-2.5 p-2.5 rounded-xl", !n.is_read && "bg-black/5 border border-black/10")}>
                  <div className={cn("mt-0.5 w-6 h-6 rounded-full flex-shrink-0 flex items-center justify-center text-xs",
                    n.type === "booking" ? "bg-black/10 text-white" : n.type === "no-show" ? "bg-orange-500/20 text-orange-400" : n.type === "review" ? "bg-purple-500/20 text-purple-400" : "bg-red-500/20 text-red-400")}>
                    {n.type === "booking" ? <Calendar size={12} /> : n.type === "review" ? <Star size={12} /> : <AlertCircle size={12} />}
                  </div>
                  <div>
                    <p className="text-xs font-medium text-white">{n.title}</p>
                    <p className="text-xs text-[#777] leading-relaxed mt-0.5 line-clamp-2">{n.message}</p>
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
          <div className="bg-black shadow-sm border border-[#1e1e1e] rounded-2xl w-full max-w-md p-6 animate-slide-up">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-white">Add Walk-in Client</h2>
              <button onClick={() => setShowAddWalkin(false)} className="text-[#777] hover:text-white"><X size={20} /></button>
            </div>
            <div className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-sm text-[#777]">Client Name</label>
                <input value={walkinName} onChange={(e) => setWalkinName(e.target.value)} className="w-full bg-[#141414] border border-[#1e1e1e] rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-black" placeholder="Walk-in Client" />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm text-[#777]">Barber</label>
                <select value={walkinBarber} onChange={(e) => setWalkinBarber(e.target.value)} className="w-full bg-[#141414] border border-[#1e1e1e] rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-black">
                  <option value="">Any Available</option>
                  {barbers.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm text-[#777]">Note</label>
                <input value={walkinService} onChange={(e) => setWalkinService(e.target.value)} className="w-full bg-[#141414] border border-[#1e1e1e] rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-black" placeholder="e.g. Haircut" />
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
