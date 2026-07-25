"use client";
import { useState, useEffect, useCallback, useMemo, useRef, Fragment } from "react";
import Link from "next/link";
import {
  Calendar, DollarSign, Users, Star, Plus, X, ChevronDown,
  ChevronRight, AlertCircle, TrendingUp, UserX, Bell, Banknote,
} from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Calendar as CalendarPicker } from "@/components/ui/calendar";
import { ApptDetail, Portal, makeApptActions } from "@/components/calendar-view";
import { OnboardingBanner } from "@/components/dashboard/onboarding-banner";
import { StatsCarousel } from "@/components/dashboard/stats-carousel";
import { useSheetDrag } from "@/hooks/use-sheet-drag";
import { cn, formatCurrency, getDateRange, DATE_FILTER_LABELS, formatDateForDb, DateFilterKey, friendlyDate, timeToMinutes } from "@/lib/utils";
import { PaymentTag } from "@/components/payment-tag";
import { supabase } from "@/lib/supabase";
import { AvatarImage } from "@/components/ui/avatar-image";
import { useAuth } from "@/lib/auth-context";
import type { AppointmentWithDetails, Barber, Notification } from "@/lib/database.types";

// ─── Skeleton ─────────────────────────────────────────────────────────────────
function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse bg-[#141414] rounded-xl", className)} />;
}

// ─── Toast ────────────────────────────────────────────────────────────────────
function Toast({ message, onClose }: { message: string; onClose: () => void }) {
  return (
    <div className="fixed bottom-6 right-6 z-[100] bg-[#141414] border border-[#2a2a2a] rounded-xl px-5 py-3 text-sm text-white shadow-xl flex items-center gap-3">
      <span className="text-white">✓</span>{message}
      <button onClick={onClose} className="text-[#8f8f8f] hover:text-white ml-2">✕</button>
    </div>
  );
}

// ─── Stat Card ────────────────────────────────────────────────────────────────
function StatCard({ label, value, sub, icon: Icon, color = "gold", cta, prominent = false, tone = "muted" }: {
  label: string;
  value: string;
  sub: string;
  icon: React.ElementType;
  color?: string;
  // When the card represents zero/empty data, pass a `cta` and the sub line
  // is replaced by a small gold link nudging the owner toward a useful next
  // step (e.g. "Book your first appointment →").
  cta?: { text: string; href: string };
  prominent?: boolean;
  // Sub-line color tone — matches the v2 reference's stat-note treatment:
  //   "up"   = green (positive trend, ↑ This week, ↑ $4 vs last wk)
  //   "down" = red (warning, "Follow up")
  //   "muted" (default) = gray neutral
  tone?: "muted" | "up" | "down";
}) {
  // On the light dashboard surface the icon chip is the only colored thing
  // on the card. Two-tone tinted background overlay was a dark-mode device —
  // on white it just looks like a misprint. Dropped entirely.
  const iconChipByColor: Record<string, string> = {
    gold: "bg-[#141414] text-[#8f8f8f]",
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
          <p className={cn("text-[#8f8f8f] font-medium uppercase tracking-wider", prominent ? "text-[11px]" : "text-xs")}>
            {label}
          </p>
          <p
            className={cn(
              // DM Mono via font-mono. Consistent 28px on every viewport —
              // matches the reference design's stat-val treatment exactly.
              "font-extrabold text-white mt-1.5 font-mono tracking-tighter leading-none",
              prominent ? "text-3xl sm:text-4xl" : "text-[28px]",
            )}
          >
            {value}
          </p>
          {/* Indicator line — always rendered with a color tone, never
              replaced by a plain link. The cta destination still applies
              if you tap the whole card. */}
          <p className={cn(
            "mt-2 font-medium",
            prominent ? "text-xs" : "text-[11px]",
            tone === "up"   && "text-emerald-400",
            tone === "down" && "text-red-400",
            tone === "muted" && "text-[#8f8f8f]",
          )}>{sub}</p>
          {cta && (
            <Link
              href={cta.href}
              className={cn(
                "mt-1 inline-flex items-center gap-0.5 text-white/70 hover:text-white hover:underline",
                prominent ? "text-xs" : "text-[10px]",
              )}
            >
              {cta.text}
              <ChevronRight size={prominent ? 12 : 10} />
            </Link>
          )}
        </div>
        {/* Icon chip removed entirely — the reference design's stat cards
            are clean label/value/sub. Keeps the same visual on every screen. */}
      </div>
    </Card>
  );
}

// The 7 days (Sun→Sat) of the current calendar week — powers the compact week
// calendar on the dashboard home.
function currentWeekDays(): Date[] {
  const t = new Date(); t.setHours(0, 0, 0, 0);
  const start = new Date(t); start.setDate(t.getDate() - t.getDay());
  return Array.from({ length: 7 }, (_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return d; });
}
// Hour-gutter label for the week grid ("9a" / "12p" / "5p").
const hourLabel = (h: number) => h === 0 ? "12a" : h < 12 ? `${h}a` : h === 12 ? "12p" : `${h - 12}p`;
// "Jul 20" pill label for a YYYY-MM-DD date (vs the raw ISO string).
const pillDate = (d: string) => new Date(d + "T00:00:00").toLocaleDateString("en-CA", { month: "short", day: "numeric" });

const apptMins = (a: AppointmentWithDetails): number =>
  (a.duration_minutes && a.duration_minutes > 0)
    ? a.duration_minutes
    : ((a.services as { duration_minutes?: number } | null)?.duration_minutes ?? 30);

export default function DashboardPage() {
  const { shop, profile, accessToken } = useAuth();

  // ── Filter state ────────────────────────────────────────────────────────────
  const [dateFilter, setDateFilter] = useState<DateFilterKey>("today");
  const [customStart, setCustomStart] = useState(formatDateForDb(new Date()));
  const [customEnd, setCustomEnd] = useState(formatDateForDb(new Date()));
  // Date-range pill next to the dropdown is clickable — opens a calendar
  // popover for picking a single specific date.
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [filterMenuOpen, setFilterMenuOpen] = useState(false);

  // ── Calendar state ──────────────────────────────────────────────────────────
  const [calYear, setCalYear] = useState(new Date().getFullYear());
  const [calMonth, setCalMonth] = useState(new Date().getMonth());
  const [selectedCalDate, setSelectedCalDate] = useState<string | null>(null);

  // ── Data state ──────────────────────────────────────────────────────────────
  const [loadingAppts, setLoadingAppts] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [appointments, setAppointments] = useState<AppointmentWithDetails[]>([]);
  // Appointments fetched specifically for the calendar-selected date, so
  // clicking a day outside the active dateFilter range still surfaces the
  // bookings underneath (the main `appointments` array is bound to dateFilter).
  const [selectedDayAppts, setSelectedDayAppts] = useState<AppointmentWithDetails[]>([]);
  const [loadingSelectedDay, setLoadingSelectedDay] = useState(false);
  // Whole-week appointments for the compact week calendar (independent of the
  // date filter, so the grid always shows the full current week).
  const [weekAppts, setWeekAppts] = useState<AppointmentWithDetails[]>([]);
  const [barbers, setBarbers] = useState<Barber[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [apptCounts, setApptCounts] = useState<Record<string, number>>({});
  const [myBarberId, setMyBarberId] = useState<string | null>(null);
  const [avgRating, setAvgRating] = useState<number | null>(null);
  const [totalReviews, setTotalReviews] = useState(0);
  const [ownerPhoto, setOwnerPhoto] = useState<string | null>(null);

  // ── UI state ────────────────────────────────────────────────────────────────
  const [showAddWalkin, setShowAddWalkin] = useState(false);
  const walkinSheetRef = useRef<HTMLDivElement | null>(null);
  const walkinDrag = useSheetDrag(walkinSheetRef, () => setShowAddWalkin(false), { enabled: showAddWalkin });
  const [walkinName, setWalkinName] = useState("");
  const [walkinBarber, setWalkinBarber] = useState("");
  const [walkinService, setWalkinService] = useState("");
  const [savingWalkin, setSavingWalkin] = useState(false);
  // Today's Schedule → full appointment detail modal (reuses the calendar/Appointments flow).
  const [selectedAppt, setSelectedAppt] = useState<AppointmentWithDetails | null>(null);
  const [detailBusy, setDetailBusy] = useState("");
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

  // The owner's own barber photo → shown on the owner-portal account avatar.
  useEffect(() => {
    if (!profile || !shop) { setOwnerPhoto(null); return; }
    supabase.from("barbers").select("photo").eq("user_id", profile.id).eq("shop_id", shop.id).maybeSingle()
      .then(({ data }) => setOwnerPhoto((data as { photo?: string | null } | null)?.photo ?? null));
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
    const { data, error } = await supabase.from("staff_hours").insert({
      barber_id: myBarberId,
      shop_id: shop.id,
      date: formatDateForDb(now),
      clock_in: now.toTimeString().slice(0, 5),
    }).select("id, clock_in").single();
    if (error || !data) { showToast("Couldn't clock in — please try again."); setClockLoading(false); return; }
    setClockedIn({ id: data.id, clock_in: data.clock_in }); showToast("Clocked in!");
    setClockLoading(false);
  };

  const handleClockOut = async () => {
    if (!clockedIn) return;
    setClockLoading(true);
    const now = new Date();
    const outStr = now.toTimeString().slice(0, 5);
    const [inH, inM] = clockedIn.clock_in.split(":").map(Number);
    const hours = Math.round(((now.getHours() * 60 + now.getMinutes()) - (inH * 60 + inM)) / 60 * 100) / 100;
    const { error } = await supabase.from("staff_hours").update({ clock_out: outStr, hours_worked: hours }).eq("id", clockedIn.id);
    if (error) { showToast("Couldn't clock out — please try again."); setClockLoading(false); return; }
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
      .select("*, barbers(id, name), services(id, name, price, category, duration_minutes)")
      .eq("shop_id", shop.id)
      .gte("date", start)
      .lte("date", end)
      .order("date", { ascending: true })
      .order("time_slot", { ascending: true });
    // Barbers only see their own appointments
    if (profile?.role === "barber" && myBarberId) {
      q = q.eq("barber_id", myBarberId);
    }
    const { data, error } = await q;
    setAppointments((data ?? []) as AppointmentWithDetails[]);
    setLoadError(!!error); // surface a failed load instead of showing a false "empty shop"
    setLoadingAppts(false);
  }, [shop, dateFilter, customStart, customEnd, profile, myBarberId]);

  // ── Load the current week's appointments (for the compact calendar) ─────────
  const loadWeekAppts = useCallback(async () => {
    if (!shop) return;
    const days = currentWeekDays();
    let q = supabase
      .from("appointments")
      .select("*, barbers(id, name), services(id, name, price, category, duration_minutes)")
      .eq("shop_id", shop.id)
      .gte("date", formatDateForDb(days[0]))
      .lte("date", formatDateForDb(days[6]))
      .order("time_slot", { ascending: true });
    if (profile?.role === "barber" && myBarberId) q = q.eq("barber_id", myBarberId);
    const { data } = await q;
    setWeekAppts((data ?? []) as AppointmentWithDetails[]);
  }, [shop, profile, myBarberId]);

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
  useEffect(() => { loadWeekAppts(); }, [loadWeekAppts]);

  // ── Load appointments for the calendar-selected date ───────────────────────
  // Independent of the main dateFilter — clicking June 15 should always
  // surface June 15's bookings underneath, even if the filter is "today".
  useEffect(() => {
    if (!shop || !selectedCalDate) { setSelectedDayAppts([]); return; }
    setLoadingSelectedDay(true);
    let q = supabase
      .from("appointments")
      .select("*, barbers(id, name), services(id, name, price, category, duration_minutes)")
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

  // ── Today's Schedule → full appointment actions (reuse the shared modal) ─────
  const patchAppt = useCallback((id: string, p: Partial<AppointmentWithDetails>) => {
    setAppointments(prev => prev.map(a => (a.id === id ? { ...a, ...p } as AppointmentWithDetails : a)));
    setSelectedDayAppts(prev => prev.map(a => (a.id === id ? { ...a, ...p } as AppointmentWithDetails : a)));
    setSelectedAppt(prev => (prev && prev.id === id ? { ...prev, ...p } as AppointmentWithDetails : prev));
  }, []);
  const apptActions = useMemo(
    () => makeApptActions({ shop, accessToken, patch: patchAppt, setBusy: setDetailBusy, toast: showToast, onDone: () => setSelectedAppt(null) }),
    [shop, accessToken, patchAppt],
  );
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
        <div className="w-16 h-16 bg-black/5 border border-[#2a2a2a] rounded-2xl flex items-center justify-center mx-auto mb-4">
          <Calendar size={28} className="text-white" />
        </div>
        <h2 className="text-xl font-bold text-white mb-2">
          {profile?.role === "barber" ? "You're not linked to a shop yet" : "No shop found"}
        </h2>
        <p className="text-[#8f8f8f] text-sm max-w-sm mb-6">
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
    <div className="p-4 lg:p-8 pt-6 lg:pt-8 animate-fade-in">
      {toast && <Toast message={toast} onClose={() => setToast("")} />}

      {/* Today's Schedule → full appointment detail + actions (shared modal) */}
      {selectedAppt && (
        <Portal>
          <ApptDetail
            appt={selectedAppt}
            barbers={barbers}
            onClose={() => setSelectedAppt(null)}
            actions={apptActions}
            busy={detailBusy}
          />
        </Portal>
      )}

      {/* New Booking Notification Modal */}
      {newBookingNotif && (
        <>
          <div className="fixed inset-0 bg-black/60 z-[80]" onClick={() => setNewBookingNotif(null)} />
          <div className="fixed inset-0 z-[90] flex items-center justify-center p-4 overflow-y-auto overscroll-contain [&>*]:my-auto">
            <div className="bg-black shadow-sm border border-black rounded-2xl p-6 w-full max-w-sm text-center shadow-2xl gold-glow animate-fade-in">
              <div className="w-14 h-14 rounded-full bg-black/10 border border-black flex items-center justify-center mx-auto mb-4">
                <Calendar size={24} className="text-white" />
              </div>
              <h2 className="text-lg font-bold text-white mb-1">{newBookingNotif.title}</h2>
              <p className="text-sm text-[#8f8f8f] mb-5">{newBookingNotif.message}</p>
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
      {shop && profile?.role === "shop_owner" && (shop.subscription_status === "cancelled" || shop.subscription_status === "past_due") && (
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

      {/* Onboarding banner — shown to new shop owners. No wrapper margin: the
          banner carries its own mb-6 so a dismissed (null) banner reserves NO
          space above the header, keeping the dashboard top flush with every
          other page. */}
      {shop && profile?.role === "shop_owner" && <OnboardingBanner shop={shop} />}

      {/* Header — shop title + bell + profile on one row (preview layout). */}
      <div className="cwd-hdr">
        <div className="min-w-0">
          <h1 className="truncate">{shop?.name ?? "Dashboard"}</h1>
          <p className="cwd-sub truncate">
            {new Date().toLocaleDateString("en-CA", { weekday: "long", month: "short", day: "numeric" })} · {todayAppts.length} appointment{todayAppts.length !== 1 ? "s" : ""} today
          </p>
        </div>
        <div className="cwd-cluster">
          {/* On mobile the bell opens the notification popover (same as every
              other page); on desktop it navigates to the notifications page. */}
          <Link
            href="/dashboard/notifications"
            aria-label="Notifications"
            className="cwd-icobtn"
            onClick={(e) => {
              if (typeof window !== "undefined" && window.innerWidth < 1024) {
                e.preventDefault();
                window.dispatchEvent(new Event("cw-open-notifs"));
              }
            }}
          >
            <Bell size={17} />
            {notifications.filter(n => !n.is_read).length > 0 && <span className="cwd-dot" />}
          </Link>
          <Link href="/dashboard/settings" aria-label="Account" className="cwd-avatar">
            <AvatarImage src={profile?.avatar || ownerPhoto} alt={profile?.name ?? "Account"} className="w-full h-full object-cover"
              fallback={<>{(profile?.name ?? "U").charAt(0).toUpperCase()}</>} />
          </Link>
        </div>
      </div>

      {/* Load-failure banner — distinguishes "couldn't load" from a genuinely
          empty shop, with a retry (so the owner never mistakes a broken load for
          lost data). */}
      {loadError && (
        <div className="flex items-center justify-between gap-3 bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3 mb-2">
          <p className="text-sm text-red-300">Couldn&apos;t load your latest data — it may be out of date.</p>
          <button
            onClick={() => { setLoadError(false); loadAppointments(); loadSideData(); loadWeekAppts(); }}
            className="text-xs font-semibold text-white bg-red-500/20 hover:bg-red-500/30 rounded-lg px-3 py-1.5 flex-shrink-0 transition-colors"
          >
            Retry
          </button>
        </div>
      )}

      {/* Date filter — compact dropdown (sizes to the selected label) + pill */}
      <div className="cwd-filter">
        <div className="relative">
          <button type="button" onClick={() => setFilterMenuOpen(o => !o)} className="cwd-select">
            {DATE_FILTER_LABELS[dateFilter]}
            <ChevronDown size={15} className="text-[#5a5a5a]" />
          </button>
          {filterMenuOpen && (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setFilterMenuOpen(false)} />
              <div className="cwd-menu">
                {(Object.entries(DATE_FILTER_LABELS) as [DateFilterKey, string][])
                  .filter(([k]) => k !== "custom")
                  .map(([k, v]) => (
                    <button key={k} type="button" className={dateFilter === k ? "on" : undefined}
                      onClick={() => { setDateFilter(k); setSelectedCalDate(null); setFilterMenuOpen(false); }}>
                      {v}
                    </button>
                  ))}
              </div>
            </>
          )}
        </div>
        <button type="button" onClick={() => setShowDatePicker(s => !s)} className="cwd-pill">
          {filterDateRange[0] === filterDateRange[1]
            ? pillDate(filterDateRange[0])
            : `${pillDate(filterDateRange[0])} — ${pillDate(filterDateRange[1])}`}
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

      {/* Hero + KPIs + Quick actions */}
      {loadingAppts ? (
        <div className="mb-3"><Skeleton className="h-44 rounded-2xl" /></div>
      ) : (() => {
        const newClients = appointments.filter((a) => {
          const s = filterDateRange[0]; const e = filterDateRange[1];
          return a.created_at.slice(0, 10) >= s && a.created_at.slice(0, 10) <= e;
        }).length;
        const hasAppts = appointments.length > 0;
        const hasCompleted = completed.length > 0;
        return (
          <>
            {/* Revenue hero (swipeable — revenue, bookings, top barbers, status) */}
            <StatsCarousel revenue={revenue} chartData={chartData} appointments={appointments} completed={completed} barbers={barbers} />

            <div className="cwd-kpis">
              <div className="cwd-kpi">
                <div className="cwd-klbl">New Clients</div>
                <div className="cwd-kval cwd-mono">{newClients}</div>
                <div className={cn("cwd-ksub", newClients > 0 && "up")}>{newClients > 0 ? "↑ This period" : "No new clients yet"}</div>
              </div>
              <div className="cwd-kpi">
                <div className="cwd-klbl">Avg Ticket</div>
                <div className="cwd-kval cwd-mono">{formatCurrency(avgTicket)}</div>
                <div className={cn("cwd-ksub", hasCompleted && "up")}>{hasCompleted ? "↑ Per completed visit" : "Complete a booking first"}</div>
              </div>
              <div className="cwd-kpi">
                <div className="cwd-klbl">No-Show Rate</div>
                <div className="cwd-kval cwd-mono">{hasAppts ? `${noShowRate.toFixed(1)}%` : "0%"}</div>
                <div className={cn("cwd-ksub", hasAppts && (noShows > 0 ? "down" : "up"))}>{hasAppts ? (noShows > 0 ? `${noShows} no-show${noShows !== 1 ? "s" : ""} · Follow up` : "↑ All shows kept") : "No data yet"}</div>
              </div>
              <div className="cwd-kpi">
                <div className="cwd-klbl">Avg Rating</div>
                <div className="cwd-kval cwd-mono">{avgRating != null ? `${avgRating}★` : "—"}</div>
                <div className={cn("cwd-ksub", totalReviews > 0 && "up")}>{totalReviews > 0 ? `↑ ${totalReviews} review${totalReviews !== 1 ? "s" : ""}` : "No reviews yet"}</div>
              </div>
            </div>

            <div className="cwd-qahdr">Quick Actions</div>
            <div className="cwd-qa">
              <button type="button" onClick={() => setShowAddWalkin(true)}><span className="cwd-qic">➕</span><span className="cwd-qlb">Walk In</span></button>
              <Link href="/dashboard/pos"><span className="cwd-qic">💳</span><span className="cwd-qlb">POS</span></Link>
              <Link href="/dashboard/appointments"><span className="cwd-qic">📅</span><span className="cwd-qlb">Appointments</span></Link>
              <Link href="/dashboard/analytics"><span className="cwd-qic">📊</span><span className="cwd-qlb">Reports</span></Link>
            </div>
          </>
        );
      })()}

      <div className="cwd-body">
        <div className="cwd-col">
          {/* Compact week calendar — tap to open the full Calendar tab */}
          {(() => {
            const weekDays = currentWeekDays();
            const todayKey = formatDateForDb(new Date());
            const hrs = weekAppts.map(a => { const m = timeToMinutes(a.time_slot ?? ""); return m > 0 ? Math.floor(m / 60) : -1; }).filter(h => h >= 0);
            const minH = hrs.length ? Math.min(...hrs) : 9;
            const maxH = hrs.length ? Math.max(...hrs) : 17;
            const calHours = Array.from({ length: Math.max(1, maxH - minH + 1) }, (_, i) => minH + i);
            const cols = { gridTemplateColumns: "44px repeat(7, 1fr)" };
            return (
              <Link href="/dashboard/calendar" className="cwd-cal">
                <div className="cwd-caltop">
                  <span className="cwd-calm">{new Date().toLocaleDateString("en-CA", { month: "long", year: "numeric" })}</span>
                  <div className="cwd-seg"><span>Day</span><span className="on">Week</span><span>Month</span></div>
                </div>
                <div className="cwd-calscroll">
                  <div className="cwd-calgrid" style={cols}>
                    <div style={{ borderBottom: "1px solid #1e1e1e" }} />
                    {weekDays.map(d => {
                      const isToday = formatDateForDb(d) === todayKey;
                      return (
                        <div key={formatDateForDb(d)} className={cn("cwd-hd", isToday && "today")}>
                          <div className="cwd-hdw">{d.toLocaleDateString("en-CA", { weekday: "short" })}</div>
                          <div className="cwd-hdn">{d.getDate()}</div>
                        </div>
                      );
                    })}
                    {calHours.map(h => (
                      <Fragment key={h}>
                        <div className="cwd-tcell">{hourLabel(h)}</div>
                        {weekDays.map(d => {
                          const dk = formatDateForDb(d);
                          const isToday = dk === todayKey;
                          const evs = weekAppts.filter(a => a.date === dk && a.status !== "cancelled" && Math.floor(timeToMinutes(a.time_slot ?? "") / 60) === h);
                          return (
                            <div key={dk} className={cn("cwd-cell", isToday && "todaycol")}>
                              {evs.map(a => (
                                <div key={a.id} className={cn("cwd-ev", a.status === "pending" && "pend")}>
                                  {(a.services?.name ?? "Service")} · {(a.client_name ?? "—").split(" ")[0]}
                                </div>
                              ))}
                            </div>
                          );
                        })}
                      </Fragment>
                    ))}
                  </div>
                </div>
              </Link>
            );
          })()}

          {/* Today's Schedule */}
          <div className="cwd-card tint">
            <div className="cwd-cardh">
              <span className="cwd-ct">{selectedCalDate ? `Appointments — ${friendlyDate(selectedCalDate)}` : "Today's Schedule"}</span>
              <Link href="/dashboard/appointments" className="cwd-ca">View all</Link>
            </div>
            <div className="cwd-cardb">
              {(selectedCalDate ? loadingSelectedDay : loadingAppts) ? (
                <div className="space-y-3">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-14" />)}</div>
              ) : displayAppts.length === 0 ? (
                <div className="py-8 text-center text-[#8f8f8f]">
                  <Calendar size={32} className="mx-auto mb-2 opacity-30" />
                  <p>No appointments{selectedCalDate ? " on this date" : " today"}</p>
                </div>
              ) : (
                [...displayAppts]
                  .sort((x, y) => timeToMinutes(x.time_slot ?? "") - timeToMinutes(y.time_slot ?? ""))
                  .map((apt) => {
                    const dimmed = apt.status === "cancelled" || apt.status === "no-show";
                    const mins = apptMins(apt);
                    const [hh, mer] = (apt.time_slot ?? "").split(" ");
                    return (
                      <button key={apt.id} onClick={() => setSelectedAppt(apt)} className="cwd-sch">
                        <div className="cwd-tm"><div className="cwd-th">{hh}</div><div className="cwd-tp">{mer}</div></div>
                        <div className="cwd-sep" />
                        <div className="cwd-who">
                          <div className={cn("cwd-wn", dimmed && "line-through opacity-60")}>{apt.client_name}</div>
                          <div className="cwd-ws">{apt.services?.name ?? "Service"} · {apt.barbers?.name ?? "Barber"}{mins ? ` · ${mins} min` : ""}</div>
                        </div>
                        <div className="cwd-rt">
                          <div className="cwd-amt cwd-mono">{formatCurrency(apt.total_amount)}</div>
                          <PaymentTag appt={apt} />
                        </div>
                      </button>
                    );
                  })
              )}
            </div>
          </div>
        </div>

        {/* Right column */}
        <div className="cwd-col">
          {/* Staff Status */}
          <div className="cwd-card">
            <div className="cwd-cardh"><span className="cwd-ct">Staff Status</span></div>
            <div className="cwd-cardb">
              {barbers.length === 0 ? (
                <p className="text-sm text-[#8f8f8f] text-center py-4">No active staff</p>
              ) : barbers.map((b) => (
                <div key={b.id} className="cwd-staff">
                  <div className="cwd-sav">
                    {b.photo ? <img src={b.photo} alt={b.name} className="w-full h-full object-cover" /> : b.name[0]}
                    <i />
                  </div>
                  <div className="cwd-snm">
                    <div className="cwd-sn">{b.name}</div>
                    <div className="cwd-sp">{todayAppts.filter((a) => a.barber_id === b.id).length} appts today</div>
                  </div>
                  <span className="cwd-sst">Active</span>
                </div>
              ))}
            </div>
          </div>

          {/* Recent Alerts */}
          <div className="cwd-card">
            <div className="cwd-cardh">
              <span className="cwd-ct">Recent Alerts</span>
              <Link href="/dashboard/notifications" className="cwd-ca">See all ({notifications.filter((n) => !n.is_read).length})</Link>
            </div>
            <div className="cwd-cardb" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {notifications.length === 0 ? (
                <p className="text-sm text-[#8f8f8f] text-center py-4">No notifications</p>
              ) : notifications.map((n) => {
                const kind = n.type === "no-show" ? "warn" : n.type === "review" ? "rev" : /payment|paid|charged|collected|refund/i.test(`${n.title} ${n.message}`) ? "pay" : "book";
                return (
                  <div key={n.id} className={cn("cwd-alert", !n.is_read && "unread")}>
                    <div className={cn("cwd-aic", kind)}>
                      {kind === "pay" ? <Banknote size={13} /> : kind === "rev" ? <Star size={13} /> : kind === "warn" ? <AlertCircle size={13} /> : <Calendar size={13} />}
                    </div>
                    <div className="min-w-0">
                      <div className="cwd-at">{n.title}</div>
                      <div className="cwd-am line-clamp-2">{n.message}</div>
                    </div>
                    {!n.is_read && <span className="cwd-udot" />}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Add Walk-in Modal */}
      {showAddWalkin && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4 [&>*]:my-auto">
          <div ref={walkinSheetRef}
            style={{ transform: walkinDrag.dragY ? `translate3d(0,${walkinDrag.dragY}px,0)` : undefined, transition: walkinDrag.dragging ? "none" : "transform 0.28s cubic-bezier(.32,.72,0,1)" }}
            className="bg-black shadow-sm border border-[#2a2a2a] rounded-2xl w-full max-w-md p-6 max-h-[88vh] overflow-y-auto overscroll-contain animate-slide-up">
            {/* Grab handle (mobile) — pull down to dismiss */}
            <div onClick={() => setShowAddWalkin(false)} className="sm:hidden flex justify-center -mt-2 mb-2 cursor-grab active:cursor-grabbing">
              <div className="w-10 h-1.5 rounded-full bg-[#3a3a3a]" />
            </div>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-white">Add Walk-in Client</h2>
              <button onClick={() => setShowAddWalkin(false)} className="text-[#8f8f8f] hover:text-white"><X size={20} /></button>
            </div>
            <div className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-sm text-[#8f8f8f]">Client Name</label>
                <input value={walkinName} onChange={(e) => setWalkinName(e.target.value)} className="w-full bg-[#141414] border border-[#2a2a2a] rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-black" placeholder="Walk-in Client" />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm text-[#8f8f8f]">Barber</label>
                <select value={walkinBarber} onChange={(e) => setWalkinBarber(e.target.value)} className="w-full bg-[#141414] border border-[#2a2a2a] rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-black">
                  <option value="">Any Available</option>
                  {barbers.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm text-[#8f8f8f]">Note</label>
                <input value={walkinService} onChange={(e) => setWalkinService(e.target.value)} className="w-full bg-[#141414] border border-[#2a2a2a] rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-black" placeholder="e.g. Haircut" />
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <Button variant="outline" className="flex-1" onClick={() => setShowAddWalkin(false)}>Cancel</Button>
              <Button className="flex-1" loading={savingWalkin} onClick={async () => {
                if (!shop || !walkinName.trim()) return;
                setSavingWalkin(true);
                const { error } = await supabase.from("waitlist").insert({ shop_id: shop.id, barber_id: walkinBarber || null, client_name: walkinName, client_phone: "", status: "waiting", added_at: new Date().toISOString() });
                setSavingWalkin(false);
                if (error) { showToast("Couldn't add walk-in — please try again."); return; }
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
