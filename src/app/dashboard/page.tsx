"use client";
import { useState, useEffect, useCallback, useMemo, useRef, Fragment } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Calendar, DollarSign, Users, Star, Plus, X, ChevronDown,
  ChevronRight, ChevronLeft, AlertCircle, TrendingUp, UserX, Bell, Banknote,
  CreditCard, BarChart3,
} from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Calendar as CalendarPicker } from "@/components/ui/calendar";
import { ApptDetail, Portal, makeApptActions } from "@/components/calendar-view";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { OnboardingBanner } from "@/components/dashboard/onboarding-banner";
import { StatsCarousel } from "@/components/dashboard/stats-carousel";
import { useSheetDrag } from "@/hooks/use-sheet-drag";
import { cn, formatCurrency, getDateRange, DATE_FILTER_LABELS, formatDateForDb, DateFilterKey, friendlyDate, timeToMinutes, timeAgo } from "@/lib/utils";
import { PaymentTag } from "@/components/payment-tag";
import { supabase } from "@/lib/supabase";
import { fetchShopNotifications, notifBelongsToShop } from "@/lib/notify";
import { ProfileMenu, OWNER_MENU_ITEMS } from "@/components/profile-menu";
import { UnreadBadge } from "@/components/notification-badge";
import { useShopUnreadCount } from "@/hooks/use-unread-count";
import { useAuth } from "@/lib/auth-context";
import { collectedTotals, type RevTx, type ByPi } from "@/lib/revenue";
import { shopBarberCommission } from "@/lib/barber-earnings";
import type { AppointmentWithDetails, Barber, Notification } from "@/lib/database.types";

// ─── Skeleton ─────────────────────────────────────────────────────────────────
function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse bg-card-raised rounded-xl", className)} />;
}

// ─── Toast ────────────────────────────────────────────────────────────────────
function Toast({ message, onClose }: { message: string; onClose: () => void }) {
  return (
    <div className="fixed bottom-6 right-6 z-[100] bg-card-raised border border-border rounded-xl px-5 py-3 text-sm text-foreground shadow-xl flex items-center gap-3">
      <span className="text-foreground">✓</span>{message}
      <button onClick={onClose} className="text-grey hover:text-foreground ml-2">✕</button>
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
    gold: "bg-card-raised text-grey",
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
          <p className={cn("text-grey font-medium uppercase tracking-wider", prominent ? "text-[11px]" : "text-xs")}>
            {label}
          </p>
          <p
            className={cn(
              // DM Mono via font-mono. Consistent 28px on every viewport —
              // matches the reference design's stat-val treatment exactly.
              "font-extrabold text-foreground mt-1.5 font-mono tracking-tighter leading-none",
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
            tone === "muted" && "text-grey",
          )}>{sub}</p>
          {cta && (
            <Link
              href={cta.href}
              className={cn(
                "mt-1 inline-flex items-center gap-0.5 text-white/70 hover:text-foreground hover:underline",
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
function currentWeekDays(offset = 0): Date[] {
  const t = new Date(); t.setHours(0, 0, 0, 0);
  const start = new Date(t); start.setDate(t.getDate() - t.getDay() + offset * 7);
  return Array.from({ length: 7 }, (_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return d; });
}
// Hour-gutter label for the week grid ("9a" / "12p" / "5p").
const hourLabel = (h: number) => h === 0 ? "12a" : h < 12 ? `${h}a` : h === 12 ? "12p" : `${h - 12}p`;
// "Jul 20" pill label for a YYYY-MM-DD date (vs the raw ISO string).

const apptMins = (a: AppointmentWithDetails): number =>
  (a.duration_minutes && a.duration_minutes > 0)
    ? a.duration_minutes
    : ((a.services as { duration_minutes?: number } | null)?.duration_minutes ?? 30);

export default function DashboardPage() {
  const { shop, profile, accessToken } = useAuth();
  const unreadCount = useShopUnreadCount(profile?.id, shop?.id);
  const router = useRouter();
  // Dashboard week calendar navigation: 0 = this week, ±n = weeks away (swipe/arrows).
  const [weekOffset, setWeekOffset] = useState(0);
  const calTouch = useRef<{ x: number; y: number } | null>(null);
  const calSwiped = useRef(false);
  const [visibleAppts, setVisibleAppts] = useState(20); // Today's Schedule list: show 20, +20 per "Load more"

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
  // Transactions (POS / gift-card / walk-in sales) for the active range — so the
  // revenue headline includes non-appointment income and matches Payments.
  const [txns, setTxns] = useState<RevTx[]>([]);
  // Exact Stripe net/fees per charge (same source the Payments page uses) so the
  // dashboard headline shows NET after fees, not gross.
  const [stripeByPi, setStripeByPi] = useState<ByPi>({});
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

  // ── Resolve the logged-in user's barber row (id + photo) in ONE query ───────
  // Used for: the barber record id (barber portal features) and the account
  // avatar photo. Previously two separate effects hit the same row.
  useEffect(() => {
    if (!profile || !shop) { setOwnerPhoto(null); return; }
    supabase.from("barbers").select("id, photo").eq("user_id", profile.id).eq("shop_id", shop.id).maybeSingle()
      .then(({ data }) => {
        const row = data as { id?: string; photo?: string | null } | null;
        setOwnerPhoto(row?.photo ?? null);
        if (profile.role === "barber" && row?.id) setMyBarberId(row.id);
      });
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
        const n = payload.new as { type: string; title: string; message: string; shop_id?: string | null };
        // Only pop for THIS shop (or a legacy null-shop row) — not the owner's other shops.
        if (n.type === "booking" && notifBelongsToShop(n, shop.id)) setNewBookingNotif({ title: n.title, message: n.message });
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
    // POS / gift-card / walk-in transactions in the same window. Owner-only:
    // these sales aren't barber-attributed, so a barber's revenue view stays
    // appointment-scoped (mirrors the Payments page's per-barber behaviour).
    // Recent transactions (matches the Payments page's 250-row cap). We filter
    // to the active window by LOCAL date at compute time — same as Payments — so
    // late-evening sales land on the right day regardless of the server's UTC.
    const txReq = (profile?.role === "barber")
      ? Promise.resolve({ data: [] as RevTx[] })
      : supabase
          .from("transactions")
          .select("client_name, service_name, amount, tip, tax, payment_method, payment_intent_id, created_at, stripe_session_id, source, refunded, barber_id, commission_amount")
          .eq("shop_id", shop.id)
          .order("created_at", { ascending: false })
          .limit(250);
    const [{ data, error }, { data: txData }] = await Promise.all([q, txReq]);
    setAppointments((data ?? []) as AppointmentWithDetails[]);
    setTxns((txData ?? []) as RevTx[]);
    setLoadError(!!error); // surface a failed load instead of showing a false "empty shop"
    setLoadingAppts(false);
  }, [shop, dateFilter, customStart, customEnd, profile, myBarberId]);

  // Live Stripe net/fees (same endpoint the Payments page uses — the money source
  // of truth). Bearer-authorized; owner or active barber of the shop. Lets the
  // dashboard headline show NET after Stripe fees instead of gross.
  useEffect(() => {
    if (!shop || !accessToken) return;
    let active = true;
    fetch("/api/stripe/payments-summary", {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ shop_id: shop.id }),
    })
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (active && d && !d.error) setStripeByPi(d.byPi ?? {}); })
      .catch(() => { /* transient — keep gross fallback */ });
    return () => { active = false; };
  }, [shop, accessToken]);

  // ── Load the current week's appointments (for the compact calendar) ─────────
  const loadWeekAppts = useCallback(async () => {
    if (!shop) return;
    const days = currentWeekDays(weekOffset);
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
  }, [shop, profile, myBarberId, weekOffset]);

  // ── Load barbers & notifications ────────────────────────────────────────────
  const loadSideData = useCallback(async () => {
    if (!shop || !profile) return;
    const [{ data: b }, notifRes, { data: rev }] = await Promise.all([
      supabase.from("barbers").select("*").eq("shop_id", shop.id).eq("is_active", true),
      // Scoped to the active shop so a multi-shop owner's alerts don't bleed in.
      fetchShopNotifications(supabase, { userId: profile.id, shopId: shop.id, limit: 5 }),
      supabase.from("reviews").select("rating").eq("shop_id", shop.id),
    ]);
    setBarbers((b ?? []) as Barber[]);
    setNotifications((notifRes.data ?? []) as unknown as Notification[]);
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
  // Reset the "Today's Schedule" list cap whenever the range/day changes.
  useEffect(() => { setVisibleAppts(20); }, [dateFilter, customStart, customEnd, selectedCalDate]);
  const todayStr = formatDateForDb(new Date());

  // ── Today's Schedule → full appointment actions (reuse the shared modal) ─────
  const patchAppt = useCallback((id: string, p: Partial<AppointmentWithDetails>) => {
    setAppointments(prev => prev.map(a => (a.id === id ? { ...a, ...p } as AppointmentWithDetails : a)));
    setSelectedDayAppts(prev => prev.map(a => (a.id === id ? { ...a, ...p } as AppointmentWithDetails : a)));
    setSelectedAppt(prev => (prev && prev.id === id ? { ...prev, ...p } as AppointmentWithDetails : prev));
  }, []);
  const { confirm } = useConfirm();
  const apptActions = useMemo(
    () => makeApptActions({ shop, accessToken, patch: patchAppt, setBusy: setDetailBusy, toast: showToast, onDone: () => setSelectedAppt(null), confirm: (m) => confirm({ message: m }) }),
    [shop, accessToken, patchAppt, confirm],
  );
  const todayAppts = appointments.filter((a) => a.date === todayStr);

  const completed = appointments.filter((a) => a.status === "completed");
  // Revenue figures exclude refunded completed appts (money handed back); the
  // completion COUNT keeps them (the service was still rendered). Revenue is
  // PRE-TAX (total_amount includes GST/HST) so it matches Analytics/Payroll/
  // Earnings — tax is shown separately as "collected".
  const paidCompleted = completed.filter((a) => a.payment_status !== "refunded");
  const revenue = paidCompleted.reduce((s, a) => s + Math.max(0, (a.total_amount ?? 0) - (a.tax_amount ?? 0)), 0);
  const taxCollected = paidCompleted.reduce((s, a) => s + (a.tax_amount ?? 0), 0);
  // Headline revenue = everything COLLECTED in the window — appointments PLUS
  // POS / gift-card / walk-in transactions (incl. cash) — so it matches the
  // Payments page. `revenue`/`taxCollected` above stay appointment-only because
  // they feed Avg Ticket + the trend chart (per-completed-visit metrics).
  const [rangeStart, rangeEnd] = getDateRange(dateFilter, customStart, customEnd);
  const txnsInRange = txns.filter((t) => {
    const d = formatDateForDb(new Date(t.created_at)); // LOCAL date, matches Payments
    return d >= rangeStart && d <= rangeEnd;
  });
  const collected = collectedTotals(appointments, txnsInRange, stripeByPi);
  // Barber commission — read from the ONE source: the transactions ledger, the
  // SAME rows + formula the barber portal (and Payments per-barber view) use, so
  // the dashboard's commission equals what the barbers actually earned. POS rows
  // carry a stored commission_amount; appointment-completion rows carry none, so
  // it falls back to the barber's rate × the service (net of tax). Gift/product/
  // no-barber sales carry no barber_id → shop revenue, no commission. Commission
  // is a reporting tally, not a payout.
  const commissionPct: Record<string, number> = Object.fromEntries(barbers.map((b) => [b.id, b.commission_percent ?? 0]));
  const commission = shopBarberCommission(txnsInRange, commissionPct);
  // Net revenue = what the shop KEEPS: Collected (after Stripe fees) − sales tax
  // (gov't) − tips (barber) − barber commission (barber/owner pay).
  const netRevenue = Math.max(0, collected.net - collected.tax - collected.tips - commission);
  const avgTicket = completed.length > 0 ? revenue / completed.length : 0;
  const noShows = appointments.filter((a) => a.status === "no-show").length;
  const noShowRate = appointments.length > 0 ? (noShows / appointments.length * 100) : 0;

  // Revenue chart data — aggregate by date
  const revenueByDate: Record<string, number> = {};
  paidCompleted.forEach((a) => { revenueByDate[a.date] = (revenueByDate[a.date] ?? 0) + Math.max(0, (a.total_amount ?? 0) - (a.tax_amount ?? 0)); });
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
        <div className="w-16 h-16 bg-black/5 border border-border rounded-2xl flex items-center justify-center mx-auto mb-4">
          <Calendar size={28} className="text-foreground" />
        </div>
        <h2 className="text-xl font-bold text-foreground mb-2">
          {profile?.role === "barber" ? "You're not linked to a shop yet" : "No shop found"}
        </h2>
        <p className="text-grey text-sm max-w-sm mb-6">
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
            tz={(shop as { timezone?: string } | null)?.timezone}
            noShowFeePercent={(shop?.booking_settings as { no_show_fee_percent?: number } | null)?.no_show_fee_percent}
          />
        </Portal>
      )}

      {/* New Booking Notification Modal */}
      {newBookingNotif && (
        <>
          <div className="fixed inset-0 bg-black/60 z-[80]" onClick={() => setNewBookingNotif(null)} />
          <div className="fixed inset-0 z-[90] flex items-center justify-center p-4 overflow-y-auto overscroll-contain [&>*]:my-auto">
            <div className="bg-card shadow-sm border border-black rounded-2xl p-6 w-full max-w-sm text-center shadow-2xl gold-glow animate-fade-in">
              <div className="w-14 h-14 rounded-full bg-black/10 border border-black flex items-center justify-center mx-auto mb-4">
                <Calendar size={24} className="text-foreground" />
              </div>
              <h2 className="text-lg font-bold text-foreground mb-1">{newBookingNotif.title}</h2>
              <p className="text-sm text-grey mb-5">{newBookingNotif.message}</p>
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

      {/* Header — shop name + subtitle stay as the in-page greeting (like the
          barber "Hi, …" line); the bell + profile are desktop-only here because
          the mobile sticky top bar carries them. */}
      <div className="cwd-hdr">
        <div className="min-w-0">
          <h1 className="truncate">{shop?.name ?? "Dashboard"}</h1>
          <p className="cwd-sub truncate">
            {new Date().toLocaleDateString("en-CA", { weekday: "long", month: "short", day: "numeric" })} · {todayAppts.length} appointment{todayAppts.length !== 1 ? "s" : ""} today
          </p>
        </div>
        <div className="cwd-cluster max-lg:hidden">
          {/* On mobile the bell opens the notification popover (same as every
              other page); on desktop it navigates to the notifications page. */}
          <Link
            href="/dashboard/notifications"
            aria-label="Notifications"
            className="cwd-icobtn relative"
            onClick={(e) => {
              if (typeof window !== "undefined" && window.innerWidth < 1024) {
                e.preventDefault();
                window.dispatchEvent(new Event("cw-open-notifs"));
              }
            }}
          >
            <Bell size={17} />
            <UnreadBadge count={unreadCount} />
          </Link>
          <ProfileMenu name={profile?.name ?? "Account"} photo={profile?.avatar || ownerPhoto} items={OWNER_MENU_ITEMS} triggerClassName="cwd-avatar" />
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
            className="text-xs font-semibold text-foreground bg-red-500/20 hover:bg-red-500/30 rounded-lg px-3 py-1.5 flex-shrink-0 transition-colors"
          >
            Retry
          </button>
        </div>
      )}

      {/* Date filter — ONE quiet control: a ghost "Today ▾" text button whose menu
          holds the ranges plus "Pick a date…" (which opens the calendar). The
          separate bordered calendar pill was removed so the top stays clean. */}
      <div className="cwd-filter">
        <div className="relative">
          <button
            type="button"
            onClick={() => setFilterMenuOpen(o => !o)}
            className={cn("cwd-trigger", filterMenuOpen && "open")}
          >
            {DATE_FILTER_LABELS[dateFilter]}
            <ChevronDown size={15} />
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
                <div className="my-1 mx-1 h-px bg-[var(--cwd-div)]" />
                <button type="button" className="flex items-center gap-2"
                  onClick={() => { setFilterMenuOpen(false); setShowDatePicker(true); }}>
                  <Calendar size={14} /> Pick a date…
                </button>
              </div>
            </>
          )}
          {showDatePicker && (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setShowDatePicker(false)} />
              <div className="absolute left-0 top-full mt-2 z-40 w-[320px] max-w-[calc(100vw-2.5rem)]">
                <CalendarPicker
                  className="shadow-xl w-full max-w-none"
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
            <StatsCarousel revenue={collected.net} taxCollected={collected.tax} cashIncluded={collected.cash} feesPaid={collected.fees} tips={collected.tips} commission={commission} netRevenue={netRevenue} chartData={chartData} appointments={appointments} completed={completed} barbers={barbers} periodLabel={DATE_FILTER_LABELS[dateFilter]} />

            {/* Minimal stat tiles — label + number only (helper sub-text removed),
                borderless tiles on the canvas (dividers removed via globals). */}
            <div className="cwd-kpis">
              <div className="cwd-kpi">
                <div className="cwd-klbl">New Clients</div>
                <div className="cwd-kval cwd-mono">{newClients}</div>
              </div>
              <div className="cwd-kpi">
                <div className="cwd-klbl">Avg Ticket</div>
                <div className="cwd-kval cwd-mono">{formatCurrency(avgTicket)}</div>
              </div>
              <div className="cwd-kpi">
                <div className="cwd-klbl">No-Show Rate</div>
                <div className="cwd-kval cwd-mono">{hasAppts ? `${noShowRate.toFixed(1)}%` : "0%"}</div>
              </div>
              <div className="cwd-kpi">
                <div className="cwd-klbl">Avg Rating</div>
                <div className="cwd-kval cwd-mono">{avgRating != null ? `${avgRating}★` : "—"}</div>
              </div>
            </div>

            <div className="cwd-qahdr">Quick Actions</div>
            <div className="cwd-qa">
              <button type="button" onClick={() => setShowAddWalkin(true)}><span className="cwd-qic"><Plus size={22} /></span><span className="cwd-qlb">Walk In</span></button>
              <Link href="/dashboard/pos"><span className="cwd-qic"><CreditCard size={21} /></span><span className="cwd-qlb">POS</span></Link>
              <Link href="/dashboard/appointments"><span className="cwd-qic"><Calendar size={21} /></span><span className="cwd-qlb">Appointments</span></Link>
              <Link href="/dashboard/analytics"><span className="cwd-qic"><BarChart3 size={21} /></span><span className="cwd-qlb">Reports</span></Link>
            </div>
          </>
        );
      })()}

      <div className="cwd-body">
        <div className="cwd-col">
          {/* Compact week calendar — tap to open the full Calendar tab */}
          {(() => {
            const weekDays = currentWeekDays(weekOffset);
            const todayKey = formatDateForDb(new Date());
            const hrs = weekAppts.map(a => { const m = timeToMinutes(a.time_slot ?? ""); return m > 0 ? Math.floor(m / 60) : -1; }).filter(h => h >= 0);
            // Always show a full day window (9a–5p) so the grid keeps a consistent
            // height — expand earlier/later only when appointments fall outside it.
            // (Otherwise a week with one appointment collapsed to a single row.)
            const minH = Math.min(9, ...hrs);
            const maxH = Math.max(17, ...hrs);
            const calHours = Array.from({ length: Math.max(1, maxH - minH + 1) }, (_, i) => minH + i);
            // Fluid columns (minmax 0) so the whole week fits ANY screen width —
            // phone/tablet/iPad — instead of a fixed 620px grid that overflowed
            // and clipped Thu–Sat on a phone.
            const cols = { gridTemplateColumns: "40px repeat(7, minmax(0, 1fr))" };
            return (
              <div
                className="cwd-cal"
                data-no-swipe
                style={{ cursor: "pointer" }}
                onClick={() => { if (calSwiped.current) { calSwiped.current = false; return; } router.push("/dashboard/calendar"); }}
                onTouchStart={(e) => { const t = e.touches[0]; calTouch.current = { x: t.clientX, y: t.clientY }; calSwiped.current = false; }}
                onTouchEnd={(e) => {
                  const s = calTouch.current; calTouch.current = null;
                  if (!s) return;
                  const t = e.changedTouches[0];
                  const dx = t.clientX - s.x, dy = t.clientY - s.y;
                  // Mostly-horizontal swipe → change week (left = next, right = prev).
                  if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) * 1.3) { calSwiped.current = true; setWeekOffset(o => o + (dx < 0 ? 1 : -1)); }
                }}
              >
                <div className="cwd-caltop">
                  <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                    <button aria-label="Previous week" onClick={(e) => { e.stopPropagation(); setWeekOffset(o => o - 1); }}
                      className="w-6 h-6 flex items-center justify-center rounded-md text-[#8a8a8a] hover:text-foreground hover:bg-white/10 transition-colors">
                      <ChevronLeft size={16} />
                    </button>
                    <button onClick={(e) => { e.stopPropagation(); setWeekOffset(0); }} className="cwd-calm"
                      title="Back to this week" style={{ background: "none", border: 0, padding: "0 4px", cursor: "pointer", whiteSpace: "nowrap" }}>
                      {weekDays[3].toLocaleDateString("en-CA", { month: "short", year: "numeric" })}
                    </button>
                    <button aria-label="Next week" onClick={(e) => { e.stopPropagation(); setWeekOffset(o => o + 1); }}
                      className="w-6 h-6 flex items-center justify-center rounded-md text-[#8a8a8a] hover:text-foreground hover:bg-white/10 transition-colors">
                      <ChevronRight size={16} />
                    </button>
                  </div>
                  <div className="cwd-seg"><span>Day</span><span className="on">Week</span><span>Month</span></div>
                </div>
                <div className="cwd-calscroll">
                  <div className="cwd-calgrid" style={cols}>
                    <div style={{ borderBottom: "1px solid var(--cwd-div)" }} />
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
                          const evs = weekAppts.filter(a => a.date === dk && a.status !== "cancelled" && Math.floor(timeToMinutes(a.time_slot ?? "") / 60) === h);
                          return (
                            <div key={dk} className="cwd-cell">
                              {evs.map(a => (
                                <Link
                                  key={a.id}
                                  href={`/dashboard/calendar?date=${dk}&appt=${a.id}`}
                                  onClick={(e) => { if (calSwiped.current) e.preventDefault(); e.stopPropagation(); }}
                                  className={cn("cwd-ev block", a.status === "pending" && "pend")}
                                >
                                  {(a.services?.name ?? "Service")} · {(a.client_name ?? "—").split(" ")[0]}
                                </Link>
                              ))}
                            </div>
                          );
                        })}
                      </Fragment>
                    ))}
                  </div>
                </div>
              </div>
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
                <div className="py-8 text-center text-grey">
                  <Calendar size={32} className="mx-auto mb-2 opacity-30" />
                  <p>No appointments{selectedCalDate ? " on this date" : " today"}</p>
                  {!selectedCalDate && (
                    <Link href="/dashboard/share" className="inline-block mt-3 text-sm font-semibold text-accent-soft hover:text-foreground transition-colors">Share your booking link →</Link>
                  )}
                </div>
              ) : (() => {
                const sorted = [...displayAppts].sort((x, y) => timeToMinutes(x.time_slot ?? "") - timeToMinutes(y.time_slot ?? ""));
                const remaining = sorted.length - visibleAppts;
                return (
                  <>
                    {sorted.slice(0, visibleAppts).map((apt) => {
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
                            <div className="cwd-amt cwd-mono">{formatCurrency(Number(apt.total_amount ?? 0) + Number(apt.tip_amount ?? 0))}</div>
                            <PaymentTag appt={apt} />
                          </div>
                        </button>
                      );
                    })}
                    {remaining > 0 && (
                      <button
                        onClick={() => setVisibleAppts(c => c + 20)}
                        className="w-full mt-3 py-2.5 rounded-xl border border-border text-sm font-medium text-[#cfcfcf] hover:bg-white/5 transition-colors"
                      >
                        Load {Math.min(20, remaining)} more · {remaining} left
                      </button>
                    )}
                  </>
                );
              })()}
            </div>
          </div>
        </div>

        {/* Right column */}
        <div className="cwd-col">
          {/* Staff Status — activity-ledger rows (Option C) */}
          <div className="cwd-card">
            <div className="cwd-cardh"><span className="cwd-ct">Staff Status</span></div>
            <div className="cwd-cardb cwd-ledgerb">
              {barbers.length === 0 ? (
                <div className="text-center py-4">
                  <p className="text-sm text-grey">No active staff</p>
                  <Link href="/dashboard/staff" className="inline-block mt-1.5 text-sm font-semibold text-accent-soft hover:text-foreground transition-colors">Add a barber →</Link>
                </div>
              ) : barbers.map((b) => {
                const cnt = todayAppts.filter((a) => a.barber_id === b.id).length;
                return (
                  <div key={b.id} className="cwd-lrow">
                    <span className={cn("cwd-led", cnt > 0 ? "on" : "off")} />
                    <div className="cwd-lgrow">
                      <div className="cwd-l1">
                        <span className="cwd-lnm">{b.name}</span>
                        <span className="cwd-lright cwd-num">{cnt} today</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Recent Alerts */}
          <div className="cwd-card">
            <div className="cwd-cardh">
              <span className="cwd-ct">Recent Alerts</span>
              <Link href="/dashboard/notifications" className="cwd-ca">See all ({notifications.filter((n) => !n.is_read).length})</Link>
            </div>
            <div className="cwd-cardb cwd-ledgerb">
              {notifications.length === 0 ? (
                <p className="text-sm text-grey text-center py-4">No notifications</p>
              ) : notifications.map((n) => {
                const text = `${n.title} ${n.message}`;
                const kind = n.type === "no-show" ? "warn" : n.type === "review" ? "rev" : /payment|paid|charged|collected|refund/i.test(text) ? "pay" : "book";
                // Pull an amount out of the title (or message), show it aligned
                // right in tabular figures; strip it from the shown text so it
                // isn't duplicated. Payments read green with a "+".
                const money = /\$[\d,]+(?:\.\d{1,2})?/;
                const amt = (n.title.match(money) || n.message.match(money) || [])[0] || null;
                const title = n.title.replace(/\s*·?\s*\$[\d,]+(?:\.\d{1,2})?\s*$/, "").trim() || n.title;
                const message = amt ? n.message.replace(amt, "").replace(/\s{2,}/g, " ").replace(/\(\s+/g, "(").trim() : n.message;
                return (
                  <div key={n.id} className={cn("cwd-lrow", n.is_read && "read")}>
                    <span className={cn("cwd-led", kind)} />
                    <div className="cwd-lgrow">
                      <div className="cwd-l1">
                        <span className="cwd-lnm">{title}</span>
                        {amt && <span className={cn("cwd-lamt cwd-num", kind === "pay" ? "pay" : "hold")}>{kind === "pay" ? `+${amt}` : amt}</span>}
                      </div>
                      <div className="cwd-l2">
                        <span className="cwd-lam">{message}</span>
                        <span className="cwd-lrt">{timeAgo(n.created_at)}</span>
                      </div>
                    </div>
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
            className="bg-card shadow-sm border border-border rounded-2xl w-full max-w-md p-6 max-h-[88vh] overflow-y-auto overscroll-contain animate-slide-up">
            {/* Grab handle (mobile) — pull down to dismiss */}
            <div onClick={() => setShowAddWalkin(false)} className="sm:hidden flex justify-center -mt-2 mb-2 cursor-grab active:cursor-grabbing">
              <div className="w-10 h-1.5 rounded-full bg-[#3a3a3a]" />
            </div>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-foreground">Add Walk-in Client</h2>
              <button onClick={() => setShowAddWalkin(false)} className="text-grey hover:text-foreground"><X size={20} /></button>
            </div>
            <div className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-sm text-grey">Client Name</label>
                <input value={walkinName} onChange={(e) => setWalkinName(e.target.value)} className="w-full bg-card-raised border border-border rounded-xl px-4 py-2.5 text-sm text-foreground focus:outline-none focus:border-black" placeholder="Walk-in Client" />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm text-grey">Barber</label>
                <select value={walkinBarber} onChange={(e) => setWalkinBarber(e.target.value)} className="w-full bg-card-raised border border-border rounded-xl px-4 py-2.5 text-sm text-foreground focus:outline-none focus:border-black">
                  <option value="">Any Available</option>
                  {barbers.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm text-grey">Note</label>
                <input value={walkinService} onChange={(e) => setWalkinService(e.target.value)} className="w-full bg-card-raised border border-border rounded-xl px-4 py-2.5 text-sm text-foreground focus:outline-none focus:border-black" placeholder="e.g. Haircut" />
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
