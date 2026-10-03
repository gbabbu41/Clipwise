"use client";
import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import {
  Calendar, DollarSign, Users, Star, Plus, X, ChevronDown,
  ChevronRight, AlertCircle, TrendingUp, UserX, Bell, Banknote,
  CreditCard, BarChart3,
} from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Calendar as CalendarPicker } from "@/components/ui/calendar";
import { ApptDetail, Portal, makeApptActions } from "@/components/calendar-view";
import { useConfirm } from "@/components/ui/confirm-dialog";
// Lazy-load the stats carousel (it pulls in recharts, ~130 kB). Keeping it out of
// the dashboard's initial JS lets the shell paint fast; the charts hydrate a beat
// later behind a skeleton (and stay instant after the SW caches the chunk).
const StatsCarousel = dynamic(
  () => import("@/components/dashboard/stats-carousel").then(m => m.StatsCarousel),
  { ssr: false, loading: () => <div className="h-64 rounded-2xl bg-card border border-border animate-pulse" /> },
);
import { readAllRows } from "@/lib/read-all-rows";
import { cacheGet, cacheSet } from "@/lib/view-cache";
import { useLiveRefresh } from "@/lib/use-live-refresh";
import { hasMissingCardFees } from "@/lib/analytics-period";
import { useSheetDrag } from "@/hooks/use-sheet-drag";
import { cn, formatCurrency, getDateRange, DATE_FILTER_LABELS, formatDateForDb, DateFilterKey, timeToMinutes, timeAgo } from "@/lib/utils";
import { PaymentTag } from "@/components/payment-tag";
import { supabase } from "@/lib/supabase";
import { fetchShopNotifications, notifBelongsToShop } from "@/lib/notify";
import { ProfileMenu, OWNER_MENU_ITEMS } from "@/components/profile-menu";
import { UnreadBadge } from "@/components/notification-badge";
import { useShopUnreadCount } from "@/hooks/use-unread-count";
import { useAuth } from "@/lib/auth-context";
import { isNativeApp } from "@/lib/native-app";
import { apptServiceCollected as apptServiceCollectedRule, collectedTotals, countablePosTxs, isGiftRefundRow, isPaid, isRefundRow, isSale, noShowFeeVisit, paidAheadPis, type RevTx, type RevAppt, type ByPi } from "@/lib/revenue";
import { evidenceView, loadLinkedEvidence, type EvidenceSnapshot } from "@/lib/revenue-evidence";
import { refundClawback, safeCommission } from "@/lib/barber-earnings";
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
            tone === "up"   && "text-grey",
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

const apptMins = (a: AppointmentWithDetails): number =>
  (a.duration_minutes && a.duration_minutes > 0)
    ? a.duration_minutes
    : ((a.services as { duration_minutes?: number } | null)?.duration_minutes ?? 30);

export default function DashboardPage() {
  const { shop, profile, accessToken } = useAuth();
  const unreadCount = useShopUnreadCount(profile?.id, shop?.id);
  const [visibleAppts, setVisibleAppts] = useState(20); // Today's Schedule list: show 20, +20 per "Load more"

  // ── Filter state ────────────────────────────────────────────────────────────
  const [dateFilter, setDateFilter] = useState<DateFilterKey>("today");
  const [customStart, setCustomStart] = useState(formatDateForDb(new Date()));
  const [customEnd, setCustomEnd] = useState(formatDateForDb(new Date()));
  // Date-range pill next to the dropdown is clickable — opens a calendar
  // popover for picking a single specific date.
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [filterMenuOpen, setFilterMenuOpen] = useState(false);

  // ── Data state ──────────────────────────────────────────────────────────────
  const [loadingAppts, setLoadingAppts] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const loadSequence = useRef(0);
  const sideSequence = useRef(0);
  const [loadedReportKey, setLoadedReportKey] = useState("");
  const [myBarberId, setMyBarberId] = useState<string | null>(null);
  const reportKey = JSON.stringify([shop?.id, profile?.id, accessToken, myBarberId, dateFilter, customStart, customEnd]);
  const reportScopeRef = useRef(reportKey);
  reportScopeRef.current = reportKey;
  const [scheduleAppts, setScheduleAppts] = useState<AppointmentWithDetails[]>([]);
  const [loadingSchedule, setLoadingSchedule] = useState(true);
  const [scheduleError, setScheduleError] = useState(false);
  const [loadedScheduleKey, setLoadedScheduleKey] = useState("");
  // Today's Schedule + Staff Status are always TODAY — keyed without the date
  // filter so switching the carousel period never reloads or changes them.
  const scheduleKey = JSON.stringify([shop?.id, profile?.id, accessToken, myBarberId]);
  const scheduleScopeRef = useRef(scheduleKey);
  scheduleScopeRef.current = scheduleKey;
  const scheduleSequence = useRef(0);
  // Survives the loading-skeleton swap below (which unmounts StatsCarousel on
  // every filter change) so switching the date filter doesn't bounce the
  // carousel back to its first slide.
  const [statsSlide, setStatsSlide] = useState(0);
  const [financialBarbers, setFinancialBarbers] = useState<Barber[]>([]);
  const [feesError, setFeesError] = useState(false);
  const [feeRetry, setFeeRetry] = useState(0);
  const [appointments, setAppointments] = useState<AppointmentWithDetails[]>([]);
  // Transactions (POS / gift-card / walk-in sales) for the active range — so the
  // revenue headline includes non-appointment income and matches Payments.
  const [txns, setTxns] = useState<RevTx[]>([]);
  // Revenue-side appointments — PAID/captured rows, counted by WHEN THE MONEY
  // MOVED (paid_at), not the booked date. The `appointments` list above stays
  // booked-date-windowed for the schedule/operational views (today's list, avg
  // ticket, trend); this set feeds the money totals so revenue lands on the day
  // it was actually collected (matches Payments' basis).
  type RevApptRow = RevAppt & { barber_id?: string | null; paid_at?: string | null; created_at?: string | null };
  const [revenueAppts, setRevenueAppts] = useState<RevApptRow[]>([]);
  // Exact Stripe net/fees per charge (same source the Payments page uses) so the
  // dashboard headline shows NET after fees, not gross.
  const [stripeByPi, setStripeByPi] = useState<ByPi>({});
  // True until the live Stripe fee data resolves — so the money card can skeleton
  // the Gross/fees rows instead of briefly showing Gross == Collected (no fees)
  // and then visibly changing once the fees load.
  const [feesLoading, setFeesLoading] = useState(true);
  const [barbers, setBarbers] = useState<Barber[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  // Client rows (id + created_at) for the "New Clients" KPI — a client is "new"
  // in a period if their record was first created (their first booking/POS
  // auto-registers them) in that window. Loaded once per shop; filtered by date
  // client-side so it tracks the period picker.
  const [clients, setClients] = useState<{ id: string; created_at: string }[]>([]);
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
    const sequence = ++loadSequence.current;
    if (!shop) { setLoadingAppts(false); return; }
    setLoadingAppts(true);
    setLoadError(false);
    const current = () => sequence === loadSequence.current && reportScopeRef.current === reportKey;
    try {
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
    // Window timestamps using local midnight and load every page, so quiet and
    // high-volume shops use the same complete calendar-period accounting.
    const txReq = (profile?.role === "barber")
      ? Promise.resolve([] as RevTx[])
      : readAllRows((from, to) => supabase
          .from("transactions")
          .select("id, client_name, service_name, amount, tip, tax, payment_method, payment_intent_id, created_at, stripe_session_id, source, refunded, barber_id, commission_amount, appointment_id")
          .eq("shop_id", shop.id)
          .gte("created_at", new Date(`${start}T00:00:00`).toISOString())
          .lte("created_at", new Date(`${end}T23:59:59.999`).toISOString())
          .order("created_at", { ascending: false }).order("id")
          .range(from, to));
    // Revenue appointments — paid/captured, fetched broad (NOT booked-date-
    // windowed) so a booking paid today for a future day is available; we window
    // it to the period by paid_at at compute time. Barber sees only their own.
    let revQ = supabase
      .from("appointments")
      .select("id, client_name, total_amount, tax_amount, tip_amount, gift_applied, gift_free, balance_due, payment_status, payment_method, payment_intent_id, status, barber_id, paid_at, created_at")
      .eq("shop_id", shop.id)
      // Refunded too: a sale counts on its paid day even if refunded later; its
      // refund row (in txns) subtracts on the refund's day (lib/revenue).
      .in("payment_status", ["paid", "captured", "refunded"])
      .order("created_at", { ascending: false }).order("id");
    if (profile?.role === "barber" && myBarberId) revQ = revQ.eq("barber_id", myBarberId);
    const scheduleReq = Promise.all([
      readAllRows((from, to) => q.order("id").range(from, to)),
      readAllRows((from, to) => supabase.from("barbers").select("*").eq("shop_id", shop.id).order("id").range(from, to)),
    ]).then(([data, staffData]) => ({ data, staffData }));
    // Financial publication waits for ALL rows and uses a separate atomic snapshot.
    const [schedule, txData, revData] = await Promise.all([
      scheduleReq, txReq, readAllRows((from, to) => revQ.range(from, to)),
    ]);
    if (!current()) return;
    setAppointments(schedule.data as AppointmentWithDetails[]);
    setTxns(txData as RevTx[]);
    setRevenueAppts(revData as RevApptRow[]);
    setFinancialBarbers(schedule.staffData as Barber[]);
    setLoadedReportKey(reportKey);
    } catch {
      if (current()) setLoadError(true);
    } finally {
      if (current()) setLoadingAppts(false);
    }
  }, [shop, dateFilter, customStart, customEnd, profile, myBarberId, reportKey]);

  const loadSchedule = useCallback(async () => {
    const sequence = ++scheduleSequence.current;
    if (!shop) { setLoadingSchedule(false); return; }
    setLoadingSchedule(true);
    setScheduleError(false);
    const current = () => sequence === scheduleSequence.current && scheduleScopeRef.current === scheduleKey;
    const today = formatDateForDb(new Date());
    let q = supabase
      .from("appointments")
      .select("*, barbers(id, name), services(id, name, price, category, duration_minutes)")
      .eq("shop_id", shop.id)
      .eq("date", today)
      .order("time_slot", { ascending: true });
    if (profile?.role === "barber" && myBarberId) q = q.eq("barber_id", myBarberId);
    try {
      const [data, staffData] = await Promise.all([
        readAllRows((from, to) => q.order("id").range(from, to)),
        readAllRows((from, to) => supabase.from("barbers").select("*").eq("shop_id", shop.id).order("id").range(from, to)),
      ]);
      if (!current()) return;
      setScheduleAppts(data as AppointmentWithDetails[]);
      setBarbers((staffData as Barber[]).filter(b => b.is_active));
      setLoadedScheduleKey(scheduleKey);
      setLoadingSchedule(false);
    } catch {
      if (current()) { setScheduleError(true); setLoadingSchedule(false); }
    }
  }, [shop, profile, myBarberId, scheduleKey]);

  // Live Stripe net/fees (same endpoint the Payments page uses — the money source
  // of truth). Bearer-authorized; owner or active barber of the shop. Lets the
  // dashboard headline show NET after Stripe fees instead of gross.
  useEffect(() => {
    if (!shop || !accessToken) { setFeesLoading(false); return; }
    let active = true;
    setFeesLoading(true);
    setFeesError(false);
    setStripeByPi({});
    fetch("/api/stripe/payments-summary", {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ shop_id: shop.id }),
      signal: AbortSignal.timeout(15000),
    })
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (!d || !d.byPi || (d.error && !d.feesReady)) throw new Error("Fees unavailable"); if (active) setStripeByPi(d.byPi); })
      .catch(() => { if (active) setFeesError(true); })
      .finally(() => { if (active) setFeesLoading(false); });
    return () => { active = false; };
  }, [shop, accessToken, feeRetry]);

  // ── Load barbers & notifications ────────────────────────────────────────────
  const loadSideData = useCallback(async () => {
    const sequence = ++sideSequence.current;
    if (!shop || !profile) return;
    type SideSnap = { clients: { id: string; created_at: string }[]; notifications: Notification[]; avgRating: number | null; totalReviews: number };
    const ck = `home_side_${shop.id}_${profile.id}`;
    const snap = cacheGet<SideSnap>(ck);
    if (snap) {
      setClients(snap.clients); setNotifications(snap.notifications);
      if (snap.avgRating !== null) { setAvgRating(snap.avgRating); setTotalReviews(snap.totalReviews); }
    }
    const [notifRes, { data: rev }, { data: cli }] = await Promise.all([
      // Scoped to the active shop so a multi-shop owner's alerts don't bleed in.
      fetchShopNotifications(supabase, { userId: profile.id, shopId: shop.id, limit: 5 }),
      supabase.from("reviews").select("rating").eq("shop_id", shop.id),
      supabase.from("clients").select("id, created_at").eq("shop_id", shop.id),
    ]);
    if (sequence !== sideSequence.current) return;
    setClients((cli ?? []) as { id: string; created_at: string }[]);
    setNotifications((notifRes.data ?? []) as unknown as Notification[]);
    let avgRating: number | null = null;
    if (rev && rev.length > 0) {
      const avg = rev.reduce((s: number, r: { rating: number }) => s + r.rating, 0) / rev.length;
      avgRating = Math.round(avg * 10) / 10;
      setAvgRating(avgRating);
      setTotalReviews(rev.length);
    }
    if (cli && !notifRes.error) cacheSet(ck, { clients: cli as SideSnap["clients"], notifications: (notifRes.data ?? []) as unknown as Notification[], avgRating, totalReviews: rev?.length ?? 0 } satisfies SideSnap);
  }, [shop, profile]);

  // Instant paint: show the last snapshot for this period / today's schedule
  // (memory, or device when small), then the loaders below refresh it. Kept
  // outside the tested loaders. The report cache is per date filter, so a
  // period's numbers never show under another period's label.
  const [repFromCache, setRepFromCache] = useState(false);
  const [schedFromCache, setSchedFromCache] = useState(false);
  const homeRepKey = shop?.id && profile?.id ? `home_rep_${JSON.stringify([shop.id, profile.id, myBarberId, dateFilter, customStart, customEnd])}` : "";
  const homeSchedKey = shop?.id && profile?.id ? `home_sched_${JSON.stringify([shop.id, profile.id, myBarberId, formatDateForDb(new Date())])}` : "";
  type HomeRepSnap = { appointments: AppointmentWithDetails[]; txns: RevTx[]; revenueAppts: RevApptRow[]; financialBarbers: Barber[] };
  useEffect(() => {
    const snap = homeRepKey ? cacheGet<HomeRepSnap>(homeRepKey) : null;
    if (!snap) { setRepFromCache(false); return; }
    setAppointments(snap.appointments); setTxns(snap.txns); setRevenueAppts(snap.revenueAppts); setFinancialBarbers(snap.financialBarbers);
    setLoadedReportKey(reportKey); setRepFromCache(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [homeRepKey]);
  useEffect(() => {
    const snap = homeSchedKey ? cacheGet<{ scheduleAppts: AppointmentWithDetails[]; barbers: Barber[] }>(homeSchedKey) : null;
    if (!snap) { setSchedFromCache(false); return; }
    setScheduleAppts(snap.scheduleAppts); setBarbers(snap.barbers);
    setLoadedScheduleKey(scheduleKey); setSchedFromCache(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [homeSchedKey]);
  useEffect(() => { loadAppointments(); return () => { loadSequence.current++; }; }, [loadAppointments]);
  useEffect(() => { loadSchedule(); return () => { scheduleSequence.current++; }; }, [loadSchedule]);
  // Gmail-style: a new booking / payment / client refreshes Home in the
  // background — current numbers stay on screen ("Updating…"), no skeleton.
  useLiveRefresh(shop?.id ? `home:${shop.id}` : null,
    shop?.id ? ["appointments", "transactions", "clients"].map(table => ({ table, filter: `shop_id=eq.${shop.id}` })) : [],
    () => {
      setRepFromCache(true); setSchedFromCache(true);
      void loadAppointments(); void loadSchedule(); void loadSideData();
    });
  useEffect(() => {
    if (!homeRepKey || loadingAppts || loadError || loadedReportKey !== reportKey) return;
    cacheSet(homeRepKey, { appointments, txns, revenueAppts, financialBarbers } satisfies HomeRepSnap);
    setRepFromCache(false);
  }, [homeRepKey, loadingAppts, loadError, loadedReportKey, reportKey, appointments, txns, revenueAppts, financialBarbers]);
  useEffect(() => {
    if (!homeSchedKey || loadingSchedule || scheduleError || loadedScheduleKey !== scheduleKey) return;
    cacheSet(homeSchedKey, { scheduleAppts, barbers });
    setSchedFromCache(false);
  }, [homeSchedKey, loadingSchedule, scheduleError, loadedScheduleKey, scheduleKey, scheduleAppts, barbers]);
  useEffect(() => { loadSideData(); return () => { sideSequence.current++; }; }, [loadSideData]);
  // ── Computed stats ──────────────────────────────────────────────────────────
  const todayStr = formatDateForDb(new Date());

  // ── Today's Schedule → full appointment actions (reuse the shared modal) ─────
  const patchAppt = useCallback((id: string, p: Partial<AppointmentWithDetails>) => {
    setAppointments(prev => prev.map(a => (a.id === id ? { ...a, ...p } as AppointmentWithDetails : a)));
    setScheduleAppts(prev => prev.map(a => (a.id === id ? { ...a, ...p } as AppointmentWithDetails : a)));
    setSelectedAppt(prev => (prev && prev.id === id ? { ...prev, ...p } as AppointmentWithDetails : prev));
  }, []);
  const { confirm } = useConfirm();
  const apptActions = useMemo(
    () => makeApptActions({ shop, accessToken, patch: patchAppt, setBusy: setDetailBusy, toast: showToast, onDone: () => setSelectedAppt(null), confirm: (m) => confirm({ message: m }) }),
    [shop, accessToken, patchAppt, confirm],
  );
  const todayAppts = loadedScheduleKey === scheduleKey ? scheduleAppts.filter((a) => a.date === todayStr) : [];

  const completed = appointments.filter((a) => a.status === "completed");
  // Revenue figures count only PAID/captured completed appts (money actually
  // collected) — refunded AND unpaid/null are both excluded, so Avg Ticket matches
  // the headline "Collected" basis (isPaid) instead of a second, looser definition.
  // The completion COUNT (`completed`) still keeps them all (the service was
  // rendered). Revenue is PRE-TAX (total_amount includes GST/HST) so it matches
  // Analytics/Payroll/Earnings — tax is shown separately as "collected".
  // Headline revenue = everything COLLECTED in the window — appointments PLUS
  // POS / gift-card / walk-in transactions (incl. cash) — so it matches the
  // Payments page. `revenue` above stays appointment-only because it feeds Avg
  // Ticket (a per-completed-visit metric).
  const [rangeStart, rangeEnd] = getDateRange(dateFilter, customStart, customEnd);
  const txnsInRange = txns.filter((t) => {
    const d = formatDateForDb(new Date(t.created_at)); // LOCAL date, matches Payments
    return d >= rangeStart && d <= rangeEnd;
  });
  // Revenue appointments in the window, dated by WHEN THE MONEY MOVED (paid_at,
  // else created_at) — a sale counts on the day it was PAID, not the day booked.
  const revenueApptsInRange = revenueAppts.filter((a) => {
    const ts = a.paid_at ?? a.created_at;
    if (!ts) return false;
    const d = formatDateForDb(new Date(ts));
    return d >= rangeStart && d <= rangeEnd;
  });
  // Avg Ticket basis: completed visits PAID in this window (dated by when the money
  // moved, like the headline) — not visits merely booked for these days.
  const paidCompleted = revenueApptsInRange.filter((a) => a.status === "completed" && isPaid(a.payment_status));
  const revenue = paidCompleted.reduce((s, a) => s + Math.max(0, (a.total_amount ?? 0) - (a.tax_amount ?? 0)), 0);
  // Linked-payment EVIDENCE for the window's bookings from any date — a capture
  // saved just after midnight, a prepaid charge, a separate tip or balance — so
  // each booking's collected gross resolves the same way regardless of window.
  // Lookup only (never counted as income). Owners only: barbers are redirected to
  // their own portal and load no shop transactions here, so none are fetched.
  // Evidence is only reused for the SAME shop + window: a valid previous result is
  // shown marked "Updating…" while the latest data is re-verified; a new window or
  // first load shows the loading state; a failed read → stale or unavailable (see
  // evidenceView). `evidenceVersion` changes on every report data load/refresh.
  const [evidenceGood, setEvidenceGood] = useState<EvidenceSnapshot | null>(null);
  const [evidenceFailed, setEvidenceFailed] = useState<{ key: string; version: string } | null>(null);
  const [evidenceRetry, setEvidenceRetry] = useState(0);
  const [evidenceVersion, setEvidenceVersion] = useState("");
  useEffect(() => { setEvidenceVersion(`${Date.now()}:${Math.random()}`); }, [txns, revenueAppts]);
  const evidenceCacheKey = shop?.id && profile?.id ? `home_ev_${shop.id}_${profile.id}` : "";
  useEffect(() => {
    // Instant paint on revisit: last verified evidence (same key only is ever used).
    if (evidenceCacheKey) setEvidenceGood(cacheGet<EvidenceSnapshot>(evidenceCacheKey));
  }, [evidenceCacheKey]);
  const evidenceKey = shop?.id && profile?.role !== "barber" ? `${shop.id}|${revenueApptsInRange.map((a) => a.id).join(",")}` : "";
  useEffect(() => {
    if (!evidenceKey || !shop?.id || !evidenceVersion) return;
    let active = true;
    const key = evidenceKey, version = evidenceVersion;
    loadLinkedEvidence(supabase, shop.id, revenueApptsInRange as RevAppt[]).then(({ ok, rows }) => {
      if (!active) return;
      if (ok) {
        const snap: EvidenceSnapshot = { key, version, rows };
        setEvidenceGood(snap); setEvidenceFailed(null);
        if (evidenceCacheKey) cacheSet(evidenceCacheKey, snap);
      } else setEvidenceFailed({ key, version });
    });
    return () => { active = false; };
    // Keyed on shop + the window's booking ids, the data version (+ Retry); the list is derived.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [evidenceKey, evidenceVersion, evidenceRetry]);
  const evidence = evidenceView(evidenceKey, evidenceVersion, evidenceGood, evidenceFailed);
  const linkedEvidence = evidence.rows;
  // The owner-barber's own chair: their tips are the owner's money (like their
  // 0-commission service), so collectedTotals splits them out and they're NOT
  // subtracted from net revenue. Identified by user_id === the shop owner.
  const ownerBarberId = (financialBarbers.find((b) => (b as { user_id?: string | null }).user_id === shop?.owner_id)?.id) ?? null;
  const collected = collectedTotals(revenueApptsInRange, txnsInRange, stripeByPi, ownerBarberId, linkedEvidence);
  const feesUnavailable = feesLoading || feesError || hasMissingCardFees(revenueApptsInRange, txnsInRange, stripeByPi);
  // Count on the SAME money-moved basis as Collected (paid appts, dated by paid_at,
  // no-show fees excluded) so the sub-line under Collected reconciles with the
  // dollar figure instead of mixing a paid-date total with an appointment-date count.
  const paidVisits = revenueApptsInRange.filter((a) => a.status !== "no-show").length;
  // Barber commission — read from the ONE source: the transactions ledger, the
  // SAME rows + formula the barber portal (and Payments per-barber view) use, so
  // the dashboard's commission equals what the barbers actually earned. POS rows
  // carry a stored commission_amount; appointment-completion rows carry none, so
  // it falls back to the barber's rate × the service (net of tax). Gift/product/
  // no-barber sales carry no barber_id → shop revenue, no commission. Commission
  // is a reporting tally, not a payout.
  const commissionPct: Record<string, number> = Object.fromEntries(financialBarbers.map((b) => [b.id, b.commission_percent ?? 0]));
  // Barber commission MUST be tallied over the SAME sales `collected` counts, or
  // Net revenue is apples-vs-oranges (the old code summed the raw transactions
  // ledger on a different date basis — completion rows dated apart from their
  // appointment — which over-counted commission and clamped Net to $0). Mirror
  // Payroll: commission = the barber's rate × service on each COUNTED sale.
  //  · counted paid appointments → (total − tax) × that barber's rate
  //  · counted POS sales with a barber → stored cut (or amount × rate)
  // No-show money is split like any payment (owner decision 2026-10-03): a visit
  // paid in advance counts as its appointment, a no-show fee as its own line.
  // Service revenue ACTUALLY COLLECTED for an appointment, pre-tax. Commission
  // must follow the money, not the label: a price edited ABOVE the held card
  // captures LESS than total_amount, leaving a `balance_due`. Base the cut on
  // (total − balance_due) − the tax on that collected part — so it never
  // over-pays on money that hasn't come in, and rises to the full amount once the
  // balance is collected (balance_due → 0). Matches collectedTotals + the barber
  // portal (which sums the completion + balance ledger rows).
  // (One shared rule — lib/revenue apptServiceCollected; a FREE gift card's part pays no commission.)
  const apptServiceCollected = (a: RevApptRow) => apptServiceCollectedRule(a as RevAppt);
  // Refunds (owner rule 2026-10-03): a refunded sale keeps its commission on the
  // day it was paid; its refund row takes the commission back on the refund's day
  // (refundClawback — the same rule the barber portal and Payroll use).
  // No-shows (owner decision 2026-10-03): any money paid is split — a visit paid in
  // advance counts here; a no-show FEE counts as its own line below.
  const paidAhead = paidAheadPis(txnsInRange as RevTx[]);
  const apptCommission = revenueApptsInRange.reduce((sum, a) => {
    if (!isSale(a.payment_status) || noShowFeeVisit(a, paidAhead) || !a.barber_id) return sum;
    return sum + (apptServiceCollected(a) * (commissionPct[a.barber_id] ?? 0)) / 100;
  }, 0);
  const posCommission = countablePosTxs(revenueApptsInRange, txnsInRange).reduce((sum, t) => {
    if (!t.barber_id || t.source === "completion") return sum;
    const pct = commissionPct[t.barber_id] ?? 0;
    return sum + safeCommission(t.amount, t.commission_amount, pct);
  }, 0);
  const commissionClawback = txnsInRange.reduce((sum, t) =>
    isRefundRow(t) && t.barber_id ? sum + refundClawback({ ...t, amount: t.amount ?? 0 }, commissionPct[t.barber_id] ?? 0) : sum, 0);
  const commission = apptCommission + posCommission - commissionClawback;
  // Top barbers by revenue — SAME basis as the headline: money-moved paid
  // appointments in the window + POS sales, both barber-attributed. Mirrors
  // commission/Payroll so the slide reconciles with Collected instead of using a
  // separate appointment-date basis that counted unpaid and excluded POS. Full
  // names (two barbers who share a first name stay distinct).
  const barberRevMap: Record<string, number> = {};
  revenueApptsInRange.forEach((a) => {
    if (!isSale(a.payment_status) || noShowFeeVisit(a, paidAhead) || !a.barber_id) return;
    barberRevMap[a.barber_id] = (barberRevMap[a.barber_id] ?? 0) + apptServiceCollected(a);
  });
  countablePosTxs(revenueApptsInRange, txnsInRange).forEach((t) => {
    if (!t.barber_id || t.source === "completion") return;
    barberRevMap[t.barber_id] = (barberRevMap[t.barber_id] ?? 0) + (t.amount ?? 0);
  });
  // Service handed back on a refund comes off that barber on the refund's day.
  txnsInRange.forEach((t) => {
    if (!isRefundRow(t) || !t.barber_id) return;
    barberRevMap[t.barber_id] = (barberRevMap[t.barber_id] ?? 0) - Math.abs(t.amount ?? 0);
  });
  const topBarbers = Object.entries(barberRevMap)
    .map(([id, rev]) => ({ name: financialBarbers.find((b) => b.id === id)?.name ?? "—", revenue: rev }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 5);
  // Net revenue = what the shop KEEPS: Collected (after Stripe fees) − sales tax
  // (gov't) − PAID-OUT tips (to non-owner barbers) − barber commission. The
  // owner-barber's OWN tips are the owner's money (like their 0-commission chair),
  // so they stay IN net revenue — only tips paid out to other barbers are subtracted.
  // NOT floored at 0 — a genuine loss (heavy refunds, high commission on a slow
  // week) should show as a red negative, not a misleading $0.00.
  // Not clamped: a refund gives a tip back (negative tips), which must offset.
  const paidOutTips = collected.tips - collected.ownerTips;
  const netRevenue = collected.net - collected.tax - paidOutTips - commission;
  // Avg Ticket = paid revenue ÷ the SAME paid rows (not all completions — dividing
  // by completed.length, which includes refunds, understated it).
  const avgTicket = paidCompleted.length > 0 ? revenue / paidCompleted.length : 0;
  const noShows = appointments.filter((a) => a.status === "no-show").length;
  // Rate = no-shows ÷ appointments that were SUPPOSED to happen. Cancellations
  // (cancelled in advance) are excluded from the denominator — counting them
  // dilutes the rate (industry convention).
  const scheduledCount = appointments.filter((a) => a.status !== "cancelled").length;
  const noShowRate = scheduledCount > 0 ? (noShows / scheduledCount * 100) : 0;

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

      {/* Expired / past-due subscription banner. In the native app (Apple IAP) this
          is a ClipWise-subscription surface, so it becomes a neutral note with NO
          billing link, no "reactivate", and no plan name — the app is never blocked;
          subscriptions are managed on clipwise.ca. */}
      {shop && profile?.role === "shop_owner" && (shop.subscription_status === "cancelled" || shop.subscription_status === "past_due") && (
        isNativeApp() ? (
          <div className="mb-6 flex items-center gap-3 bg-orange-500/10 border border-orange-500/30 rounded-2xl p-4">
            <AlertCircle size={18} className="text-orange-400 flex-shrink-0" />
            <p className="text-sm text-orange-200">Some features aren&rsquo;t included in your current plan.</p>
          </div>
        ) : (
          <div className="mb-6 flex flex-wrap items-center justify-between gap-3 bg-orange-500/10 border border-orange-500/30 rounded-2xl p-4">
            <div className="flex items-center gap-3">
              <AlertCircle size={18} className="text-orange-400 flex-shrink-0" />
              <p className="text-sm text-orange-200">
                Your subscription has {shop.subscription_status === "past_due" ? "a past-due payment" : "expired"}. Premium features are locked until you reactivate.
              </p>
            </div>
            <Link href="/dashboard/billing"><Button size="sm">Restore Features</Button></Link>
          </div>
        )
      )}

      {/* Setup guidance now lives on the Calendar as a Squire-style progress card
          (CalendarSetupNudge) — where new owners land after signup — so Home stays
          uncluttered. */}

      {/* Header — the mobile top bar already carries the page title ("Home") and the
          sidebar carries the shop identity. No day/"N appointments today" line: the
          period date under the filter pills and Today's Schedule already say it, so
          the header is just bell + profile on desktop and hidden on mobile (the top
          bar carries them there). */}
      <div className="cwd-hdr max-lg:hidden">
        <div className="min-w-0" />
        <div className="cwd-cluster">
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
            onClick={() => { setLoadError(false); loadAppointments(); loadSchedule(); loadSideData(); }}
            className="text-xs font-semibold text-foreground bg-red-500/20 hover:bg-red-500/30 rounded-lg px-3 py-1.5 flex-shrink-0 transition-colors"
          >
            Retry
          </button>
        </div>
      )}

      {/* Linked payment records couldn't be verified: keep the last good figures with
          a stale notice, or hide them (unavailable) rather than show an unverified
          recalculation. Same banner + Retry pattern as the load-failure above. */}
      {!loadError && (evidence.stale || evidence.unavailable) && (
        <div role="alert" className="flex items-center justify-between gap-3 bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3 mb-2">
          <p className="text-sm text-red-300">{evidence.unavailable
            ? "Couldn\u2019t verify linked payment records — collected figures are unavailable."
            : "Couldn\u2019t refresh linked payment records — collected figures may be out of date."}</p>
          <button
            onClick={() => setEvidenceRetry((v) => v + 1)}
            className="text-xs font-semibold text-foreground bg-red-500/20 hover:bg-red-500/30 rounded-lg px-3 py-1.5 flex-shrink-0 transition-colors"
          >
            Retry
          </button>
        </div>
      )}

      {/* Never label previous-period figures with the newly selected range. */}
      {loadError || evidence.unavailable ? null : (loadingAppts && !repFromCache) || loadedReportKey !== reportKey || evidence.loading ? (
        <div className="mb-3"><Skeleton className="h-44 rounded-2xl" /></div>
      ) : (() => {
        // New Clients = distinct client RECORDS first created in the window (each
        // clients row is one person), on the LOCAL date — was counting appointments
        // (so repeat bookings inflated it) against a UTC date.
        const newClients = clients.filter((c) => {
          const d = formatDateForDb(new Date(c.created_at));
          return d >= filterDateRange[0] && d <= filterDateRange[1];
        }).length;
        const hasAppts = appointments.length > 0;
        const hasCompleted = completed.length > 0;
        return (
          <>
            {/* Period filter — a pill row ABOVE the carousel (daily presets inline,
                the longer ranges + custom under "More"), so the menu never covers the
                card the way the old overlaid dropdown did. */}
            {(() => {
              const DAILY: DateFilterKey[] = ["today", "this-week", "this-month", "this-year"];
              const MORE: DateFilterKey[] = ["yesterday", "last-month", "last-3-months", "last-6-months"];
              const moreActive = MORE.includes(dateFilter) || dateFilter === "custom";
              const pill = (active: boolean) => cn(
                "flex-none inline-flex items-center gap-1 rounded-full px-3.5 py-2 text-[12.5px] font-semibold whitespace-nowrap border transition-colors",
                active ? "bg-white text-black border-white" : "bg-card text-grey border-border hover:text-foreground",
              );
              return (
                // z-40 lifts the whole filter above the carousel; the menu + picker
                // live OUTSIDE the horizontal-scroll row so its overflow can't clip them.
                <div className="relative z-40">
                  <div className="flex gap-2 overflow-x-auto pb-3 -mx-1 px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                    {DAILY.map((k) => (
                      <button key={k} type="button" className={pill(dateFilter === k)}
                        onClick={() => { setDateFilter(k); }}>
                        {DATE_FILTER_LABELS[k]}
                      </button>
                    ))}
                    <button type="button" className={pill(moreActive)} onClick={() => setFilterMenuOpen((o) => !o)}>
                      {moreActive ? DATE_FILTER_LABELS[dateFilter] : "More"}
                      <ChevronDown size={14} />
                    </button>
                  </div>
                  {filterMenuOpen && (
                    <>
                      <div className="fixed inset-0 z-30" onClick={() => setFilterMenuOpen(false)} />
                      <div className="cwd-menu cwd-menu--right" style={{ zIndex: 50 }}>
                        {MORE.map((k) => (
                          <button key={k} type="button" className={dateFilter === k ? "on" : undefined}
                            onClick={() => { setDateFilter(k); setFilterMenuOpen(false); }}>
                            {DATE_FILTER_LABELS[k]}
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
                      <div className="absolute right-0 top-full mt-2 z-50 w-[320px] max-w-[calc(100vw-2.5rem)]">
                        <CalendarPicker
                          className="shadow-xl w-full max-w-none"
                          value={new Date(filterDateRange[0] + "T00:00:00")}
                          minDate={null}
                          onChange={(d) => {
                            const ds = formatDateForDb(d);
                            setCustomStart(ds);
                            setCustomEnd(ds);
                            setDateFilter("custom" as DateFilterKey);
                            setShowDatePicker(false);
                          }}
                        />
                      </div>
                    </>
                  )}
                </div>
              );
            })()}

            {((repFromCache && loadingAppts) || evidence.updating) && <p className="text-xs text-grey mb-2" role="status">Updating…</p>}
            {/* Revenue hero (swipeable — revenue, bookings, top barbers, status) */}
            <StatsCarousel revenue={feesUnavailable ? collected.gross : collected.net} taxCollected={collected.tax} cashIncluded={collected.cash} feesPaid={collected.fees} tips={paidOutTips} commission={commission} netRevenue={netRevenue} feesLoading={feesLoading} feesUnavailable={feesUnavailable} paidVisits={paidVisits} refunds={collected.refunds} refundCount={txnsInRange.filter(t => isRefundRow(t) && !isGiftRefundRow(t)).length} freeGifts={collected.freeGifts} appointments={appointments} completed={completed} topBarbers={topBarbers} periodLabel={DATE_FILTER_LABELS[dateFilter]} rangeStart={rangeStart} rangeEnd={rangeEnd} initialSlide={statsSlide} onSlideChange={setStatsSlide} />
            {feesUnavailable && !feesLoading && <button type="button" className="mb-3 border border-border rounded-lg px-4 py-2 text-sm" onClick={() => setFeeRetry(v => v + 1)}>Retry processing fees</button>}

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
                <div className="cwd-kval cwd-mono">{scheduledCount > 0 ? `${noShowRate.toFixed(1)}%` : "—"}</div>
              </div>
              <div className="cwd-kpi">
                {/* Rating is cumulative (not period-filtered like its neighbours),
                    so it's labelled all-time to avoid implying it moves with the picker. */}
                <div className="cwd-klbl">Rating · all-time</div>
                <div className="cwd-kval cwd-mono">{avgRating != null ? `${avgRating}★` : "—"}</div>
              </div>
            </div>

            <div className="cwd-qahdr">Quick Actions</div>
            <div className="cwd-qa">
              <button type="button" onClick={() => setShowAddWalkin(true)}><span className="cwd-qic"><Plus size={22} /></span><span className="cwd-qlb">Walk In</span></button>
              <Link href="/dashboard/pos"><span className="cwd-qic"><CreditCard size={21} /></span><span className="cwd-qlb">POS</span></Link>
              <Link href="/dashboard/appointments"><span className="cwd-qic"><Calendar size={21} /></span><span className="cwd-qlb">Appointments</span></Link>
              <Link href="/dashboard/analytics"><span className="cwd-qic"><BarChart3 size={21} /></span><span className="cwd-qlb">Analytics</span></Link>
            </div>
          </>
        );
      })()}

      <div className="cwd-body">
        <div className="cwd-col">
          {/* Today's Schedule */}
          <div className="cwd-card tint">
            <div className="cwd-cardh">
              <span className="cwd-ct">Today's Schedule</span>
              <Link href="/dashboard/appointments" className="cwd-ca">View all</Link>
            </div>
            <div className="cwd-cardb">
              {scheduleError ? (
                <p role="alert" className="text-sm text-grey">Couldn&apos;t load the schedule. <button className="underline" onClick={() => void loadSchedule()}>Retry</button></p>
              ) : (loadingSchedule && !schedFromCache) || loadedScheduleKey !== scheduleKey ? (
                <div className="space-y-3">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-14" />)}</div>
              ) : scheduleAppts.length === 0 ? (
                <div className="py-8 text-center text-grey">
                  <Calendar size={32} className="mx-auto mb-2 opacity-30" />
                  <p>No appointments today</p>
                  <Link href="/dashboard/share" className="inline-block mt-3 text-sm font-semibold text-accent-soft hover:text-foreground transition-colors">Share your booking link →</Link>
                </div>
              ) : (() => {
                const sorted = [...scheduleAppts].sort((x, y) => timeToMinutes(x.time_slot ?? "") - timeToMinutes(y.time_slot ?? ""));
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
                            {dimmed && <div className="cwd-sch-status">{apt.status === "cancelled" ? "Cancelled" : "No-show"}</div>}
                          </div>
                          <div className="cwd-rt">
                            <div className="cwd-amt cwd-mono">{formatCurrency(Number(apt.total_amount ?? 0) + Number(apt.tip_amount ?? 0))}</div>
                            <PaymentTag appt={apt} variant="schedule" />
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
              {scheduleError ? <p role="alert" className="text-sm text-grey">Staff status unavailable. Retry the schedule.</p> : (loadingSchedule && !schedFromCache) || loadedScheduleKey !== scheduleKey ? <Skeleton className="h-14" /> : barbers.length === 0 ? (
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
              <Link href="/dashboard/notifications" className="cwd-ca">View all</Link>
            </div>
            <div className="cwd-cardb cwd-ledgerb">
              {notifications.length === 0 ? (
                <p className="text-sm text-grey text-center py-4">No notifications</p>
              ) : notifications.map((n) => {
                const title = n.title;
                const preview = n.message.toLowerCase().startsWith(title.toLowerCase())
                  ? n.message.slice(title.length).replace(/^[\s:·—–-]+/, "")
                  : n.message;
                return (
                  <div key={n.id} className={cn("cwd-lrow", n.is_read && "read")}>
                    <span className="cwd-led" />
                    <div className="cwd-lgrow">
                      <div className="cwd-l1">
                        <span className="cwd-lnm">{title}</span>
                      </div>
                      <div className="cwd-l2">
                        <span className="cwd-lam">{preview}</span>
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
