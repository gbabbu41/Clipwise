"use client";
import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { cn, formatCurrency, getStatusColor, formatDateForDb, formatFriendlyDate, friendlyDate, prettyDate, timeAgo, timeToMinutes } from "@/lib/utils";
import { formatPhone, validatePrice, noShowFeeDollars, NO_SHOW_GRACE_MINUTES, NO_SHOW_MAX_PCT } from "@/lib/validation";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Calendar as CalendarPicker } from "@/components/ui/calendar";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import { DashboardHeader } from "@/components/dashboard/page-header";
import type { AppointmentWithDetails, Barber } from "@/lib/database.types";
import type { Service } from "@/lib/database.types";
import { useSheetDrag } from "@/hooks/use-sheet-drag";

function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse bg-card-raised rounded-xl", className)} />;
}

function Toast({ message, onClose }: { message: string; onClose: () => void }) {
  return (
    <div className="fixed bottom-6 right-6 z-[100] bg-card-raised border border-border rounded-xl px-5 py-3 text-sm text-foreground shadow-xl flex items-center gap-3">
      <span className="text-foreground">✓</span>{message}
      <button onClick={onClose} className="text-grey hover:text-foreground ml-2">✕</button>
    </div>
  );
}

const STATUS_OPTIONS = ["confirmed", "pending", "completed", "cancelled", "no-show"] as const;
type AppStatus = typeof STATUS_OPTIONS[number];

/** Context-aware "forward" action for an appointment.
 *   pending   → Approve (advances to confirmed)
 *   confirmed → Complete (advances to completed)
 *   anything else (completed / cancelled / no-show) → no forward action.
 * Reject is offered separately whenever the appointment is still pending
 * or confirmed (i.e. not yet finalized). Centralizing this here means the
 * mobile card list, desktop table, and side panel all stay in sync. */
function primaryAction(status: AppStatus): { label: string; next: AppStatus; variant: string } | null {
  // Soft transparent gradient buttons — color carries intent (green = go,
  // blue = finish, red = reject, amber = no-show) without going solid +
  // loud. Surfaces ~20% opacity, text the matching pastel.
  if (status === "pending")   return { label: "Approve",   next: "confirmed", variant: "btn-soft-success" };
  // "Check out" (not "Complete"): a confirmed appt — even one prepaid online —
  // is checked out here, where the barber takes/settles payment, which is what
  // flips it to completed. The status itself stays distinct from this action.
  if (status === "confirmed") return { label: "Check out",  next: "completed", variant: "btn-soft-blue"   };
  return null;
}
const canReject = (status: AppStatus) => status === "pending" || status === "confirmed";

/** Display label for an appointment status. DB value stays "confirmed";
 *  we just show it as "Booked" to clients/owners. */
const statusLabel = (s: string) => (s === "confirmed" ? "Booked" : s.charAt(0).toUpperCase() + s.slice(1));

/** Payment badge — strict monochrome. The card holds at most one
 *  colored element (the green price); payment state communicates via
 *  the LABEL only. Returns null when there's nothing worth showing. */
function paymentBadge(apt: AppointmentWithDetails): { label: string; bsClass: string } | null {
  const status = apt.payment_status;
  const method = apt.payment_method;
  const isCompleted = apt.status === "completed";

  // White text for actionable / fresh payment states; muted grey for
  // settled-and-done states the owner doesn't need to act on.
  const ACTIVE = "bg-surface-overlay text-foreground";
  const MUTED  = "bg-surface-overlay text-grey";
  const PAID   = "text-[#00e5a0]"; // green text only — no pill/border for paid

  if (status === "paid") {
    const suffix = method === "online" ? " · Online" : method === "card" ? " · Card" : "";
    return { label: `Paid${suffix}`, bsClass: PAID };
  }
  if (status === "held")     return { label: "💳 Card on hold", bsClass: ACTIVE };
  if (status === "saved")    return { label: "💳 Card on file", bsClass: ACTIVE };
  if (status === "captured") return { label: "Paid · Card",     bsClass: PAID };
  if (status === "refunded") return { label: "Refunded",       bsClass: MUTED };
  if (status === "failed")   return { label: "Payment failed", bsClass: ACTIVE };

  // Completed but nothing was collected/held → clearly flag as Unpaid.
  if (isCompleted && (apt.total_amount ?? 0) > 0) {
    return { label: "Unpaid", bsClass: "bg-amber-500/15 text-amber-400" };
  }

  // A checkout link is out and still unpaid → waiting on the customer (paying it
  // auto-completes the visit). Mirrors the calendar's "Awaiting payment" tag.
  if (!isCompleted && apt.stripe_checkout_session_id) {
    return { label: "Awaiting payment", bsClass: ACTIVE };
  }

  if (method === "cash" && !isCompleted) {
    return { label: "Pay in person", bsClass: MUTED };
  }
  if ((method === "online" || method === "card") && !isCompleted) {
    return { label: "Awaiting payment", bsClass: ACTIVE };
  }

  return null;
}

// Status pill. "Completed" reads as blue with a small blue tick on the left;
// every other status keeps its existing monochrome treatment.
function StatusPill({ status }: { status: string }) {
  const completed = status === "completed";
  return (
    <span className={cn(
      "inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold rounded-md whitespace-nowrap capitalize",
      completed ? "bg-blue-500/15 text-blue-400" : getStatusColor(status),
    )}>
      {completed && <span className="text-blue-400 text-[10px] leading-none">✓</span>}
      {statusLabel(status)}
    </span>
  );
}

// Block length (minutes) — multi-service bookings store their combined length
// on the row (duration_minutes); single-service rows use the service duration.
function apptDuration(a: AppointmentWithDetails): number | null {
  if (a.duration_minutes && a.duration_minutes > 0) return a.duration_minutes;
  return a.services?.duration_minutes ?? null;
}

const PAID_REFUND_WINDOW_DAYS = 30;
const isRefundable = (apt: AppointmentWithDetails) =>
  apt.payment_status === "paid" &&
  (Date.now() - new Date(apt.date).getTime()) / 86400000 <= PAID_REFUND_WINDOW_DAYS;

// Date-filter chips, in the order they appear in the bar.
const DATE_FILTERS: { key: string; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "tomorrow", label: "Tomorrow" },
  { key: "week", label: "This Week" },
  { key: "upcoming", label: "Upcoming" },
  { key: "all", label: "All Upcoming" },
];

// Thin wrapper around the shared friendlyDate so we don't sprinkle a
// stale local copy across pages. Kept here so existing call-sites don't
// need touching.
function shortFriendlyDate(dateStr: string): string {
  return friendlyDate(dateStr);
}

// Compact month + day, no year (e.g. "Jun 13") — shown small next to the
// weekday so the actual date is always visible without clutter.
function monthDay(dateStr: string): string {
  return new Date(dateStr + "T00:00:00").toLocaleDateString("en-CA", { month: "short", day: "numeric" });
}

export default function AppointmentsPage() {
  const { shop, profile, accessToken } = useAuth();
  const [tab, setTab] = useState<"appointments" | "waitlist">("appointments");
  const [search, setSearch] = useState("");
  // Default view = the action queue: open appointments (pending + booked) from
  // today onward. The owner can widen via the date / status dropdowns.
  const [dateFilter, setDateFilter] = useState("today");
  const [pickedDate, setPickedDate] = useState<string | null>(null); // calendar filter (YYYY-MM-DD)
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [barberFilter, setBarberFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("active"); // active = pending + confirmed/booked
  const [loading, setLoading] = useState(true);
  const [appointments, setAppointments] = useState<AppointmentWithDetails[]>([]);
  const [barbers, setBarbers] = useState<Barber[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [waitlist, setWaitlist] = useState<{ id: string; client_name: string; client_phone: string | null; service_id: string | null; barber_id: string | null; added_at: string }[]>([]);
  const [selectedApt, setSelectedApt] = useState<AppointmentWithDetails | null>(null);
  const [notes, setNotes] = useState("");
  const [showAddModal, setShowAddModal] = useState(false);
  // When assigning a waitlist entry, remember its id so the row is removed once
  // the appointment is actually created (the "Assign" button used to only toast).
  const [assignWaitlistId, setAssignWaitlistId] = useState<string | null>(null);
  // Pull-down-to-dismiss for the detail panel + add modal (scroll-aware).
  const detailSheetRef = useRef<HTMLDivElement | null>(null);
  const detailDrag = useSheetDrag(detailSheetRef, () => setSelectedApt(null), { enabled: !!selectedApt });
  const addSheetRef = useRef<HTMLDivElement | null>(null);
  const addDrag = useSheetDrag(addSheetRef, () => setShowAddModal(false), { enabled: showAddModal });
  const [toast, setToast] = useState("");
  const [savingStatus, setSavingStatus] = useState("");
  const [rejectModal, setRejectModal] = useState<{ appt: AppointmentWithDetails; reason: string } | null>(null);
  const [savingReject, setSavingReject] = useState(false);
  const [refundModal, setRefundModal] = useState<AppointmentWithDetails | null>(null);
  const [savingRefund, setSavingRefund] = useState(false);
  /** Caution dialog shown before a no-show fee is charged to a customer's card.
   *  mode "mark"  → also flag the appointment as a no-show after charging
   *  mode "charge"→ charge only (appointment is already a no-show; this is the
   *                 manual / retry path). */
  const [noShowModal, setNoShowModal] = useState<{ appt: AppointmentWithDetails; mode: "mark" | "charge" } | null>(null);
  const [savingNoShow, setSavingNoShow] = useState(false);
  // Editable no-show charge ($) shown in the confirm dialog — defaults to the
  // shop's configured fee, adjustable by the barber from $0 up to the full amount.
  const [noShowAmt, setNoShowAmt] = useState("");
  /** Opened when the owner clicks "Complete" on an unpaid appointment.
   *  Lets them either record a cash payment or email the customer a
   *  Stripe Checkout link, optionally finalizing the appointment too. */
  const [paymentModal, setPaymentModal] = useState<AppointmentWithDetails | null>(null);
  const [savingPayment, setSavingPayment] = useState<"" | "cash" | "link" | "skip">("");
  // Optional email typed at payment time (for appts with none on file) + the
  // generated link to show/copy when no email is sent.
  const [payEmail, setPayEmail] = useState("");
  const [payLink, setPayLink] = useState("");
  useEffect(() => {
    if (paymentModal) { setPayEmail(paymentModal.client_email ?? ""); setPayLink(""); }
  }, [paymentModal]);

  // Add appointment form state
  const [addForm, setAddForm] = useState({ client_name: "", client_phone: "", barber_id: "", service_id: "", date: formatDateForDb(new Date()), time_slot: "9:00 AM", repeat: "none" });
  const [savingAdd, setSavingAdd] = useState(false);
  const [myBarberId, setMyBarberId] = useState<string | null>(null);

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(""), 3000); };

  // Resolve barber record for logged-in barbers
  useEffect(() => {
    if (!profile || profile.role !== "barber" || !shop) return;
    supabase.from("barbers").select("id").eq("user_id", profile.id).eq("shop_id", shop.id).maybeSingle()
      .then(({ data }) => { if (data) setMyBarberId(data.id); });
  }, [profile, shop]);

  const loadData = useCallback(async () => {
    if (!shop) { setLoading(false); return; }
    setLoading(true);

    const today = formatDateForDb(new Date());
    const tomorrow = formatDateForDb(new Date(Date.now() + 86400000));
    const weekStart = formatDateForDb(new Date());
    const weekEnd = formatDateForDb(new Date(Date.now() + 7 * 86400000));
    const upcomingEnd = formatDateForDb(new Date(Date.now() + 30 * 86400000));

    // "Upcoming" is from today onward, sorted ascending so the next booking
    // is at the top — that's the view a barber actually wants to see.
    const isUpcomingView = !!pickedDate || dateFilter === "upcoming" || dateFilter === "week" || dateFilter === "today" || dateFilter === "tomorrow" || dateFilter === "all";
    let apptQuery = supabase
      .from("appointments")
      .select("*, barbers(id, name), services(id, name, price, duration_minutes, category)")
      .eq("shop_id", shop.id)
      .order("date", { ascending: isUpcomingView })
      .order("time_slot", { ascending: true });

    // A picked calendar date overrides the dropdown range.
    if (pickedDate) apptQuery = apptQuery.eq("date", pickedDate);
    else if (dateFilter === "today") apptQuery = apptQuery.eq("date", today);
    else if (dateFilter === "tomorrow") apptQuery = apptQuery.eq("date", tomorrow);
    else if (dateFilter === "week") apptQuery = apptQuery.gte("date", weekStart).lte("date", weekEnd);
    else if (dateFilter === "upcoming") apptQuery = apptQuery.gte("date", today).lte("date", upcomingEnd);
    else if (dateFilter === "all") apptQuery = apptQuery.gte("date", today); // from today onward, no past

    // Barbers only see their own appointments
    if (profile?.role === "barber" && myBarberId) {
      apptQuery = apptQuery.eq("barber_id", myBarberId);
    }

    const [{ data: appts, error: apptErr }, { data: bs }, { data: svcs }, { data: wl }] = await Promise.all([
      apptQuery,
      supabase.from("barbers").select("*").eq("shop_id", shop.id).eq("is_active", true),
      supabase.from("services").select("*").eq("shop_id", shop.id).eq("is_active", true),
      supabase.from("waitlist").select("*").eq("shop_id", shop.id).order("added_at", { ascending: true }),
    ]);

    if (apptErr) showToast("Couldn't load appointments — please refresh.");
    setAppointments((appts ?? []) as AppointmentWithDetails[]);
    setBarbers((bs ?? []) as Barber[]);
    setServices((svcs ?? []) as Service[]);
    setWaitlist(wl ?? []);
    setLoading(false);
  }, [shop, dateFilter, pickedDate, profile, myBarberId]);

  useEffect(() => { loadData(); }, [loadData]);

  // Catch up on payment-link payments that completed without the customer
  // returning / the webhook firing — flip them to paid, then refresh.
  useEffect(() => {
    if (!accessToken) return;
    let active = true;
    fetch("/api/stripe/reconcile-payments", { method: "POST", headers: { Authorization: `Bearer ${accessToken}` } })
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (active && d?.updated > 0) loadData(); })
      .catch(() => {});
    return () => { active = false; };
  }, [accessToken, loadData]);

  // Keyboard: Escape closes side panel and modals
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setSelectedApt(null);
        setRejectModal(null);
        setRefundModal(null);
        setPaymentModal(null);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const updateStatus = async (id: string, status: AppStatus) => {
    setSavingStatus(id);
    const { error: updateErr } = await supabase
      .from("appointments")
      .update({ status })
      .eq("id", id);
    setSavingStatus("");
    if (updateErr) {
      // Without this, an RLS / network failure would leave the row visually
      // unchanged with no feedback — the cause of "the Done button does
      // nothing" reports. Surface the message so it can be diagnosed.
      showToast(`Update failed: ${updateErr.message}`);
      return;
    }

    const appt = appointments.find(a => a.id === id);

    // Guard on the PRE-update status so completing an already-completed
    // appointment (double-tap, or completing from two surfaces) can't
    // double-count visits/spend. Loyalty is already idempotent server-side.
    if (status === "completed" && appt && shop && appt.status !== "completed") {
      // Update client stats: increment visits, add spent, update last_visit
      if (appt.client_email || appt.client_phone) {
        const matchField = appt.client_email ? "email" : "phone";
        const matchVal = appt.client_email || appt.client_phone;
        const { data: clientRow } = await supabase
          .from("clients")
          .select("id, total_visits, total_spent")
          .eq("shop_id", shop.id)
          .eq(matchField, matchVal)
          .maybeSingle();
        if (clientRow) {
          await supabase.from("clients").update({
            total_visits: (clientRow.total_visits ?? 0) + 1,
            total_spent: (clientRow.total_spent ?? 0) + (appt.total_amount ?? 0),
            last_visit: appt.date,
          }).eq("id", clientRow.id);
        }
      }

      // Award loyalty points (fire-and-forget). The route is plan-gated and
      // idempotent server-side, so it's safe to call unconditionally.
      if (accessToken) {
        fetch("/api/loyalty/award", {
          method: "POST",
          headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
          body: JSON.stringify({ appointment_id: id }),
        }).catch(() => null);
      }

      // Send review request email (fire-and-forget)
      if (appt.client_email) {
        fetch("/api/send-email", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) },
          body: JSON.stringify({
            type: "review_request",
            data: {
              clientName: appt.client_name,
              clientEmail: appt.client_email,
              shopName: shop.name,
              shopEmail: shop.email ?? "",
              barberName: (appt.barbers as { name: string } | null)?.name ?? "Your barber",
              serviceName: (appt.services as { name: string } | null)?.name ?? "Your service",
              reviewUrl: `${window.location.origin}/book/${shop.slug}/review?booking=${id}`,
              appointmentId: id,
              googlePlaceId: shop.google_place_id ?? "",
            },
          }),
        }).catch(() => null);
      }
    }

    // Booking approved (pending → confirmed): tell the customer it's confirmed.
    if (status === "confirmed" && appt && shop) {
      if (appt.client_email) {
        fetch("/api/send-email", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "booking_confirmation",
            data: {
              clientName: appt.client_name,
              clientEmail: appt.client_email,
              shopId: shop.id,
              shopName: shop.name,
              shopEmail: shop.email ?? "",
              shopSlug: shop.slug,
              barberName: (appt.barbers as { name: string } | null)?.name ?? "Your barber",
              serviceName: (appt.services as { name: string } | null)?.name ?? "Your service",
              date: appt.date,
              time: appt.time_slot,
              total: `$${Number(appt.total_amount ?? 0).toFixed(2)}`,
              paymentNote: "Pay in person at the shop",
              bookingId: id.slice(0, 8).toUpperCase(),
              appointmentId: id,
            },
          }),
        }).catch(() => null);
      }
      if (appt.client_phone) {
        fetch("/api/twilio/send-sms", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) },
          body: JSON.stringify({
            to: appt.client_phone,
            shop_id: shop.id,
            shopName: shop.name,
            body: `Good news! Your appointment at ${shop.name} on ${prettyDate(appt.date)} at ${appt.time_slot} is confirmed. Booking #${id.slice(0, 8).toUpperCase()}. Manage: ${window.location.origin}/my-booking/${id}`,
          }),
        }).catch(() => null);
      }
    }

    // Send no-show follow-up email
    if (status === "no-show" && appt?.client_email && shop) {
      fetch("/api/send-email", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) },
        body: JSON.stringify({
          type: "no_show_followup",
          data: {
            clientName: appt.client_name,
            clientEmail: appt.client_email,
            shopName: shop.name,
            shopEmail: shop.email ?? "",
            bookingUrl: `${window.location.origin}/book/${shop.slug}`,
          },
        }),
      }).catch(() => null);
    }

    // Tell the assigned barber when a slot frees up or a client no-shows.
    if (status === "no-show" || status === "cancelled") {
      fetch("/api/appointments/notify-cancellation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appointment_id: id, statusLabel: status === "no-show" ? "No-show" : "Cancelled", notifyCustomer: true }),
      }).catch(() => null);

      // Smart waitlist: a slot just freed — ping anyone waiting for that day.
      if (appt && shop) {
        fetch("/api/waitlist/slot-opened", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ shop_id: shop.id, date: appt.date, barber_id: appt.barber_id }),
        }).catch(() => null);
      }
    }

    setAppointments(prev => prev.map(a => a.id === id ? { ...a, status } : a));
    if (selectedApt?.id === id) setSelectedApt(prev => prev ? { ...prev, status } : null);
    // Completion feedback is payment-aware so the owner always knows what
    // happened to the money — not just that the status changed. (A held/saved
    // card capture shows its own "Charged $X" toast right after, which wins.)
    if (status === "completed") {
      const amt = appt?.total_amount ?? 0;
      const ps = appt?.payment_status;
      if (ps === "paid" || ps === "captured") showToast(`Completed · paid ${formatCurrency(amt)} ✓`);
      else if (amt > 0) showToast(`Completed · ${formatCurrency(amt)} still unpaid — take payment from the row`);
      else showToast("Completed · no price on this appointment, nothing to charge");
    } else {
      showToast(`Marked as ${statusLabel(status)}`);
    }
  };

  const saveNotes = async () => {
    if (!selectedApt) return;
    const { error } = await supabase.from("appointments").update({ notes }).eq("id", selectedApt.id);
    if (error) { showToast(`Couldn't save note: ${error.message}`); return; }
    setAppointments(prev => prev.map(a => a.id === selectedApt.id ? { ...a, notes } : a));
    showToast("Notes saved");
  };

  const rejectAppointment = async () => {
    if (!rejectModal || !shop) return;
    const { appt, reason } = rejectModal;
    setSavingReject(true);
    const updatedNotes = reason
      ? `[Rejected by shop: ${reason}]${appt.notes ? `\n${appt.notes}` : ""}`
      : appt.notes ?? "";

    // Undo the money: a settled charge (immediate online "paid" OR a captured
    // hold) is refunded; an uncaptured "held" card is released instead (you
    // can't refund what wasn't captured). The old check only caught "captured",
    // so rejecting a paid-online booking kept the customer's money and a held
    // card stayed authorized ~7 days.
    const hasCharge = !!(appt.payment_intent_id && (appt.payment_status === "paid" || appt.payment_status === "captured"));
    const hasHold = !!(appt.payment_intent_id && appt.payment_status === "held");
    if (hasCharge && accessToken) {
      const refundRes = await fetch("/api/stripe/refund", {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ appointment_id: appt.id }),
      }).catch(() => null);
      // Refund route already cancels the appointment, emails the customer AND
      // pings the waitlist — just mirror local state + tell the barber (no
      // second waitlist ping, which would double-notify every waiter).
      if (refundRes?.ok) {
        setSavingReject(false);
        setRejectModal(null);
        setAppointments(prev => prev.map(a => a.id === appt.id ? { ...a, status: "cancelled", payment_status: "refunded", notes: updatedNotes } : a));
        if (selectedApt?.id === appt.id) setSelectedApt(prev => prev ? { ...prev, status: "cancelled", payment_status: "refunded", notes: updatedNotes } : null);
        fetch("/api/appointments/notify-cancellation", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ appointment_id: appt.id, statusLabel: "Cancelled", notifyCustomer: true }) }).catch(() => null);
        // Also send the decline email carrying the owner's reason. The refund
        // route only sends a "money back" notice — without this, a customer who
        // PAID never learns WHY they were declined (unpaid rejections do get it).
        if (appt.client_email) {
          fetch("/api/send-email", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              type: "appointment_rejected",
              data: {
                clientName: appt.client_name,
                clientEmail: appt.client_email,
                shopName: shop.name,
                shopEmail: shop.email ?? "",
                shopSlug: shop.slug,
                serviceName: (appt.services as { name: string } | null)?.name ?? "Your service",
                date: appt.date,
                time: appt.time_slot,
                reason: reason || "",
              },
            }),
          }).catch(() => null);
        }
        showToast("Appointment rejected · Refund issued to customer");
        return;
      }
      // fall through to a plain cancel if the refund call failed
    }

    // Uncaptured hold → release the authorization so the card isn't left on hold.
    if (hasHold && accessToken) {
      await fetch("/api/stripe/release-hold", {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ appointment_id: appt.id }),
      }).catch(() => null);
    }

    await supabase.from("appointments").update({ status: "cancelled", notes: updatedNotes }).eq("id", appt.id);
    setSavingReject(false);
    setRejectModal(null);
    setAppointments(prev => prev.map(a => a.id === appt.id ? { ...a, status: "cancelled", payment_status: hasHold ? "voided" : a.payment_status, notes: updatedNotes } : a));
    if (selectedApt?.id === appt.id) setSelectedApt(prev => prev ? { ...prev, status: "cancelled", payment_status: hasHold ? "voided" : prev.payment_status, notes: updatedNotes } : null);

    // Email customer if they have an email
    if (appt.client_email) {
      fetch("/api/send-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "appointment_rejected",
          data: {
            clientName: appt.client_name,
            clientEmail: appt.client_email,
            shopName: shop.name,
            shopEmail: shop.email ?? "",
            shopSlug: shop.slug,
            serviceName: (appt.services as { name: string } | null)?.name ?? "Your service",
            date: appt.date,
            time: appt.time_slot,
            reason: reason || "",
          },
        }),
      }).catch(() => null);
    }

    // Notify the assigned barber their slot is free again + text the customer.
    fetch("/api/appointments/notify-cancellation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ appointment_id: appt.id, statusLabel: "Cancelled", notifyCustomer: true }),
    }).catch(() => null);

    // Smart waitlist: ping customers waiting for this now-free day.
    fetch("/api/waitlist/slot-opened", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ shop_id: shop.id, date: appt.date, barber_id: appt.barber_id }),
    }).catch(() => null);

    showToast("Appointment rejected" + (appt.client_email ? " · Email sent to client" : ""));
  };

  const issueRefund = async () => {
    if (!refundModal || !shop || !accessToken) return;
    const appt = refundModal;
    setSavingRefund(true);
    const res = await fetch("/api/stripe/refund", {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ appointment_id: appt.id }),
    });
    const data = await res.json();
    setSavingRefund(false);
    if (!res.ok) { showToast(`Refund failed: ${data.error}`); return; }
    setRefundModal(null);
    setAppointments(prev => prev.map(a => a.id === appt.id ? { ...a, status: "cancelled", payment_status: "refunded" } : a));
    if (selectedApt?.id === appt.id) setSelectedApt(prev => prev ? { ...prev, status: "cancelled", payment_status: "refunded" } : null);
    showToast("Refund processed" + (appt.client_email ? " · Email sent to client" : ""));
  };

  /** Intercept the "Complete" transition: if the appointment is unpaid
   *  and has a positive amount, open the PaymentModal so the owner can
   *  decide how to take payment first. Everything else routes straight
   *  through to `updateStatus`. */
  const handleStatusChange = (apt: AppointmentWithDetails, next: AppStatus) => {
    // Held or saved card (no-show protection): completing auto-charges the
    // card — held → capture, saved → off-session charge — no modal needed.
    if (next === "completed" && (apt.payment_status === "held" || apt.payment_status === "saved")) {
      captureHeldAndComplete(apt);
      return;
    }
    // No-show with a card on file: open a caution dialog first so the owner/
    // barber sees the exact fee that will hit the customer's card before it's
    // charged. Confirming charges the fee (records a transaction + emails the
    // customer a receipt) AND flags the no-show.
    if (next === "no-show" && (apt.payment_status === "held" || apt.payment_status === "saved")) {
      setNoShowModal({ appt: apt, mode: "mark" });
      return;
    }
    if (next === "completed" && apt.payment_status !== "paid" && (apt.total_amount ?? 0) > 0) {
      setPaymentModal(apt);
      return;
    }
    updateStatus(apt.id, next);
  };

  // Capture a held PaymentIntent. reason "completed" charges the full hold and
  // marks the appointment complete; "no_show" charges the no-show fee. Errors
  // surface as a toast and the appointment is flagged for review server-side.
  const captureHeld = async (appt: AppointmentWithDetails, reason: "completed" | "no_show", amountCents?: number) => {
    if (!accessToken) return false;
    const res = await fetch("/api/stripe/capture-appointment", {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ appointment_id: appt.id, reason, ...(typeof amountCents === "number" ? { amount_cents: amountCents } : {}) }),
    });
    const data = await res.json().catch(() => ({ ok: false, error: "Network error" }));
    if (!data.ok) { showToast(`Charge failed: ${data.error ?? "try again"}`); return false; }
    const nowIso = new Date().toISOString();
    setAppointments(prev => prev.map(a => a.id === appt.id ? { ...a, payment_status: "captured", paid_at: nowIso } as AppointmentWithDetails : a));
    if (selectedApt?.id === appt.id) setSelectedApt(prev => prev ? { ...prev, payment_status: "captured", paid_at: nowIso } as AppointmentWithDetails : null);
    return true;
  };

  const captureHeldAndComplete = async (appt: AppointmentWithDetails) => {
    showToast(appt.payment_status === "saved" ? "Charging saved card…" : "Charging held card…");
    const ok = await captureHeld(appt, "completed");
    if (!ok) return;
    await updateStatus(appt.id, "completed");
    showToast(`Charged ${formatCurrency(appt.total_amount ?? 0)} · Completed`);
  };

  // Mark a no-show AND charge the on-file card the no-show fee. The no-show is
  // a real event regardless of the card outcome, so we always flag it (which
  // sends the follow-up email + frees the slot); if the charge declines, the
  // server flags payment_status = "failed" and the manual retry button shows.
  const captureNoShowAndMark = async (appt: AppointmentWithDetails, amountCents: number) => {
    const noCharge = amountCents <= 0;
    showToast(noCharge ? "Marking no-show…" : (appt.payment_status === "saved" ? "Charging saved card…" : "Charging no-show fee…"));
    const ok = await captureHeld(appt, "no_show", amountCents);
    await updateStatus(appt.id, "no-show");
    showToast(ok ? (noCharge ? "Marked no-show · no charge" : "No-show fee charged · receipt emailed") : "Marked no-show · charge needs retry");
  };

  // What the card will actually be charged for a no-show — mirrors the server:
  // the shop's configured percentage of the booked total, capped at 100%. Keeps
  // the button labels and confirm honest.
  const noShowFeeFor = (appt: AppointmentWithDetails) => {
    return noShowFeeDollars(appt.total_amount ?? 0, shop?.booking_settings?.no_show_fee_percent);
  };

  // The no-show ceiling in dollars for a booking — the barber can charge up to
  // the full booked amount (NO_SHOW_MAX_PCT = 100%) via the no-show path.
  const noShowMaxFor = (appt: AppointmentWithDetails) => noShowFeeDollars(appt.total_amount ?? 0, NO_SHOW_MAX_PCT);

  // Seed the editable amount whenever the confirm dialog opens.
  useEffect(() => {
    if (noShowModal) setNoShowAmt(String(noShowFeeFor(noShowModal.appt)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noShowModal]);

  // A no-show can only be marked/charged once the appointment start time has
  // passed by the grace window — you can't no-show a slot that hasn't happened.
  const isNoShowReady = (appt: AppointmentWithDetails) => {
    // TEMP (testing): a no-show can be marked/charged ANYTIME. Flip GATE back to
    // true to restore the "only after the slot's start (+ grace)" barrier.
    const NO_SHOW_TIME_GATE = false as boolean;
    if (!NO_SHOW_TIME_GATE) return true;
    const m = (appt.time_slot ?? "").match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
    if (!appt.date || !m) return false;
    let h = Number(m[1]) % 12;
    if (/pm/i.test(m[3])) h += 12;
    const start = new Date(`${appt.date}T${String(h).padStart(2, "0")}:${m[2]}:00`);
    if (isNaN(start.getTime())) return false;
    return Date.now() >= start.getTime() + NO_SHOW_GRACE_MINUTES * 60000;
  };

  // Charge-only path (appointment is already a no-show — this is the manual /
  // retry button). Confirmation is handled by the caution modal, not here.
  const chargeNoShow = async (appt: AppointmentWithDetails, amountCents: number) => {
    if (amountCents <= 0) { showToast("Enter an amount above $0 to charge."); return; }
    showToast("Charging no-show fee…");
    const ok = await captureHeld(appt, "no_show", amountCents);
    showToast(ok ? `No-show fee charged · ${formatCurrency(amountCents / 100)}` : "Charge needs retry");
  };

  // Confirm handler for the caution modal — dispatches to the right action and
  // closes the dialog. "mark" both flags the no-show and charges the entered
  // amount (or releases the hold if $0); "charge" (retry) only charges.
  const confirmNoShow = async () => {
    if (!noShowModal) return;
    const { appt, mode } = noShowModal;
    const capped = Math.min(Math.max(Number(noShowAmt) || 0, 0), noShowMaxFor(appt));
    const cents = Math.round(capped * 100);
    setSavingNoShow(true);
    if (mode === "mark") await captureNoShowAndMark(appt, cents);
    else await chargeNoShow(appt, cents);
    setSavingNoShow(false);
    setNoShowModal(null);
  };

  const markCashPaid = async (alsoComplete: boolean) => {
    if (!paymentModal) return;
    const apptId = paymentModal.id;
    setSavingPayment("cash");
    // Record the cash PAYMENT here. The completion (when requested) runs through
    // updateStatus below so it gets the same loyalty / client-stats / review-email
    // side-effects every other completion path does — this button used to update
    // the row directly and silently skip all of them.
    const patch: Record<string, unknown> = { payment_status: "paid", payment_method: "cash", paid_at: new Date().toISOString() };
    const { error } = await supabase.from("appointments").update(patch).eq("id", apptId);
    setSavingPayment("");
    if (error) { showToast(`Failed: ${error.message}`); return; }
    setAppointments(prev => prev.map(a => a.id === apptId ? { ...a, ...patch } as AppointmentWithDetails : a));
    if (selectedApt?.id === apptId) setSelectedApt(prev => prev ? { ...prev, ...patch } as AppointmentWithDetails : null);
    // Settled by cash → expire any open payment link so it can't be paid too,
    // and LEDGER the cash sale so it shows in Payments / analytics. Without the
    // record-cash call, cash completed from this page silently never hit the
    // transactions ledger (the barber Payments view reads only that) — the exact
    // drift the calendar's cashComplete already avoided. Idempotent server-side.
    if (accessToken) {
      fetch("/api/stripe/cancel-payment-link", {
        method: "POST", headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ appointment_id: apptId }),
      }).catch(() => {});
      fetch("/api/calendar/record-cash", {
        method: "POST", headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ appointment_id: apptId }),
      }).catch(() => {});
    }
    setPaymentModal(null);
    if (alsoComplete) await updateStatus(apptId, "completed");
    showToast(alsoComplete ? "Cash payment recorded · Appointment completed" : "Cash payment recorded");
  };

  const sendPaymentLink = async (alsoComplete: boolean) => {
    if (!paymentModal || !accessToken) return;
    setSavingPayment("link");
    // Pass the typed email straight to the route, which persists it via the
    // service-role client (bypassing RLS) AND emails the link. Doing the
    // client_email update here through the user client could silently fail
    // RLS, leaving the route with a stale/empty email so nothing got sent —
    // that was the "Send link doesn't email from Appointments" bug. The
    // Payments tab always worked because it passes `email` the same way.
    const email = payEmail.trim();
    const willEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    const willSms = !!paymentModal.client_phone;
    const res = await fetch("/api/stripe/payment-link", {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        appointment_id: paymentModal.id,
        send_email: willEmail,
        email: willEmail ? email : undefined,
        send_sms: willSms,
        phone: willSms ? paymentModal.client_phone : undefined,
        // Checkout flow: paying this link auto-completes the visit server-side.
        // We do NOT mark it completed here — the status flips to "completed" only
        // when the customer actually pays (via the webhook / finalize route).
        complete_on_paid: alsoComplete,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      setSavingPayment("");
      showToast(`Failed: ${data.error}`);
      return;
    }
    // Reflect the (route-persisted) email + "awaiting payment" state locally so
    // the side panel stays fresh. The session id drives the awaiting badge and,
    // crucially, keeps the row open so it auto-completes when the customer pays.
    {
      const local: Partial<AppointmentWithDetails> = { stripe_checkout_session_id: "pending" };
      if (willEmail && email !== (paymentModal.client_email ?? "")) local.client_email = email;
      setAppointments(prev => prev.map(a => a.id === paymentModal.id ? { ...a, ...local } as AppointmentWithDetails : a));
      if (selectedApt?.id === paymentModal.id) setSelectedApt(prev => prev ? { ...prev, ...local } as AppointmentWithDetails : null);
    }
    setSavingPayment("");
    if (data.emailed || data.texted) {
      setPaymentModal(null);
      showToast(
        data.emailed && data.texted ? "Payment link sent · email + text"
          : data.emailed ? "Payment link emailed to customer"
          : "Payment link texted to customer",
      );
    } else {
      // No email — keep the modal open showing the link so it can be copied or
      // opened for the customer. Stripe collects their email on its own page.
      setPayLink(data.url ?? "");
      showToast("Payment link ready");
    }
  };

  const skipPaymentAndComplete = async () => {
    if (!paymentModal) return;
    setSavingPayment("skip");
    await updateStatus(paymentModal.id, "completed");
    setSavingPayment("");
    setPaymentModal(null);
  };

  const addAppointment = async () => {
    if (!shop || !addForm.client_name || !addForm.service_id) { showToast("Fill in required fields"); return; }
    const today = formatDateForDb(new Date());
    if (addForm.date < today) { showToast("Please select a future date"); return; }
    setSavingAdd(true);
    const svc = services.find(s => s.id === addForm.service_id);

    // Recurring: build one row per occurrence, spaced by N days. Parse the
    // date as LOCAL (not UTC) so adding days never drifts across a day boundary.
    const REPEATS: Record<string, { stepDays: number; count: number }> = {
      none:       { stepDays: 0,  count: 1 },
      weekly4:    { stepDays: 7,  count: 4 },
      biweekly4:  { stepDays: 14, count: 4 },
      biweekly6:  { stepDays: 14, count: 6 },
      monthly3:   { stepDays: 28, count: 3 },
    };
    const plan = REPEATS[addForm.repeat] ?? REPEATS.none;
    const [y, m, d] = addForm.date.split("-").map(Number);
    const rows = Array.from({ length: plan.count }, (_, i) => {
      const dt = new Date(y, m - 1, d + i * plan.stepDays);
      return {
        shop_id: shop.id,
        barber_id: addForm.barber_id || null,
        service_id: addForm.service_id,
        client_name: addForm.client_name,
        client_phone: addForm.client_phone || null,
        date: formatDateForDb(dt),
        time_slot: addForm.time_slot,
        status: "confirmed",
        total_amount: svc?.price ?? 0,
      };
    });
    // Guard against double-booking the same barber/time. Only meaningful when a
    // specific barber is chosen ("Any Barber" can't be uniquely held). The DB
    // unique index is the real enforcer; this is the friendly pre-check.
    if (addForm.barber_id) {
      const { data: clash } = await supabase
        .from("appointments")
        .select("date, time_slot")
        .eq("barber_id", addForm.barber_id)
        .in("date", rows.map(r => r.date))
        .eq("time_slot", addForm.time_slot)
        .in("status", ["pending", "confirmed"])
        .limit(1)
        .maybeSingle();
      if (clash) {
        setSavingAdd(false);
        showToast(`That barber is already booked on ${prettyDate(clash.date)} at ${clash.time_slot}`);
        return;
      }
      // Don't book over a block / time-off for that barber.
      const dur = svc?.duration_minutes ?? 30;
      const sMin = timeToMinutes(addForm.time_slot);
      const eMin = sMin + dur;
      const mins24 = (t: string) => { const [hh, mm] = t.split(":").map(Number); return (hh || 0) * 60 + (mm || 0); };
      const dates = rows.map(r => r.date);
      const { data: offs } = await supabase
        .from("time_off_requests")
        .select("type, start_time, end_time, start_date, end_date, barber_id")
        .eq("shop_id", shop.id).eq("status", "approved").eq("barber_id", addForm.barber_id);
      const blockedHit = (offs ?? []).some(o => {
        if (!dates.some(dt => dt >= o.start_date && dt <= o.end_date)) return false;
        if (o.type === "day_off" || o.type === "vacation" || o.type === "sick") return true;
        if (o.type === "blocked_hours" && o.start_time && o.end_time) return sMin < mins24(o.end_time) && eMin > mins24(o.start_time);
        return false;
      });
      if (blockedHit) {
        setSavingAdd(false);
        showToast("That time is blocked for this barber — unblock it or pick another time.");
        return;
      }
    }

    // Resolve/create the client (by phone) so the appointment carries the
    // permanent client_id link (phase 36). Best-effort; the public upsert route
    // dedupes so it won't create a duplicate.
    let addClientId: string | null = null;
    if (addForm.client_phone?.trim()) {
      try {
        const r = await fetch("/api/clients/upsert", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ shop_id: shop.id, name: addForm.client_name, phone: addForm.client_phone }),
        });
        const j = await r.json();
        if (j?.ok) addClientId = j.id;
      } catch { /* best-effort */ }
    }
    const rowsToInsert = addClientId ? rows.map(r => ({ ...r, client_id: addClientId })) : rows;
    let ins = await supabase.from("appointments").insert(rowsToInsert);
    // Fall back if the client_id column isn't present yet (migration not run).
    if (ins.error && addClientId && /client_id/.test(ins.error.message)) {
      ins = await supabase.from("appointments").insert(rows);
    }
    const { error } = ins;
    setSavingAdd(false);
    if (error) {
      const taken = (error as { code?: string }).code === "23505";
      showToast(taken ? "That barber already has a booking at this time" : "Failed to add appointment");
      return;
    }
    // If this was an assignment from the waitlist, remove that entry now that the
    // booking exists (best-effort; realtime + loadData keep everyone in sync).
    if (assignWaitlistId) {
      await supabase.from("waitlist").delete().eq("id", assignWaitlistId).then(null, () => null);
      setWaitlist(prev => prev.filter(w => w.id !== assignWaitlistId));
      setAssignWaitlistId(null);
    }
    setShowAddModal(false);
    setAddForm({ client_name: "", client_phone: "", barber_id: "", service_id: "", date: formatDateForDb(new Date()), time_slot: "9:00 AM", repeat: "none" });
    showToast(rows.length > 1 ? `${rows.length} appointments added!` : "Appointment added!");
    loadData();
  };

  const filtered = useMemo(() => {
    let apts = [...appointments];
    if (barberFilter !== "all") apts = apts.filter(a => a.barber_id === barberFilter);
    // "active" = still open (needs approval or completing); "unpaid" = money
    // owed and not yet collected/secured (incl. completed-but-unpaid, e.g. a
    // walk-in where a link was sent but the customer hasn't paid yet); else
    // exact status.
    if (statusFilter === "active") apts = apts.filter(a => a.status === "pending" || a.status === "confirmed");
    else if (statusFilter === "unpaid") apts = apts.filter(a => {
      const s = a.payment_status;
      const settledOrSecured = s === "paid" || s === "captured" || s === "refunded" || s === "held" || s === "saved";
      return (a.total_amount ?? 0) > 0 && a.status !== "cancelled" && !settledOrSecured;
    });
    else if (statusFilter !== "all") apts = apts.filter(a => a.status === statusFilter);
    if (search) apts = apts.filter(a =>
      a.client_name.toLowerCase().includes(search.toLowerCase()) ||
      (a.client_phone ?? "").includes(search)
    );
    // Chronological order — earliest first. time_slot is text ("9:00 AM"), so
    // sort by parsed minutes (a plain string sort would put "12:00 PM" above
    // "9:00 AM"). Date first (YYYY-MM-DD sorts correctly as a string), then time.
    apts.sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      return timeToMinutes(a.time_slot) - timeToMinutes(b.time_slot);
    });
    return apts;
  }, [appointments, barberFilter, statusFilter, search]);

  // Stats reflect the SAME date-filter scope as the list below — owner
  // picks "This Week" and the stat tiles roll up the whole week, not just
  // today. Labels swap accordingly so "Total Today" reads as e.g.
  // "Total Tomorrow" / "This Week" / "Upcoming" / "All Time".
  const scopeApts = appointments;
  const confirmed = scopeApts.filter(a => a.status === "confirmed").length;
  const noShows = scopeApts.filter(a => a.status === "no-show").length;
  const revenue = scopeApts.filter(a => a.status === "completed" && a.payment_status !== "refunded").reduce((s, a) => s + Math.max(0, (a.total_amount ?? 0) - (a.tax_amount ?? 0)), 0);
  const scopeLabel = pickedDate ? friendlyDate(pickedDate) : (DATE_FILTERS.find(f => f.key === dateFilter)?.label ?? "Today");
  const totalLabel = (!pickedDate && dateFilter === "today") ? "Total Today"
    : (!pickedDate && dateFilter === "tomorrow") ? "Total Tomorrow"
    : `Total · ${scopeLabel}`;
  const revLabel = (!pickedDate && dateFilter === "today") ? "Revenue Today" : `Revenue · ${scopeLabel}`;

  const TIME_SLOTS = ["8:00 AM","8:30 AM","9:00 AM","9:30 AM","10:00 AM","10:30 AM","11:00 AM","11:30 AM","12:00 PM","12:30 PM","1:00 PM","1:30 PM","2:00 PM","2:30 PM","3:00 PM","3:30 PM","4:00 PM","4:30 PM","5:00 PM","5:30 PM","6:00 PM","6:30 PM","7:00 PM"];

  if (!shop) {
    return (
      <div className="p-8 flex flex-col items-center justify-center min-h-[60vh] text-center">
        <p className="text-grey">No shop found. Set up your shop first.</p>
      </div>
    );
  }

  return (
    <div className="px-6 pb-6 space-y-6">
      {toast && <Toast message={toast} onClose={() => setToast("")} />}

      <DashboardHeader title="Appointments" subtitle="Manage bookings and waitlist"
        action={
          <button onClick={() => { setAssignWaitlistId(null); setShowAddModal(true); }} aria-label="Add appointment"
            className="w-[38px] h-[38px] rounded-full bg-white text-black flex items-center justify-center text-2xl leading-none hover:opacity-90 transition-opacity flex-shrink-0">
            +
          </button>
        } />

      {/* Stats bar — v2 reference treatment: uppercase grey label, 28px
          DM Mono value, colored indicator below (green up / red down). */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {(() => {
          type Tone = "muted" | "up" | "down";
          const stats: { label: string; value: string; sub: string; tone: Tone }[] = [
            {
              label: totalLabel,
              value: String(scopeApts.length),
              sub: scopeApts.length > 0 ? `${scopeApts.length} booking${scopeApts.length !== 1 ? "s" : ""}` : "No bookings",
              tone: "muted",
            },
            {
              label: "Confirmed",
              value: String(confirmed),
              sub: confirmed > 0 ? "↑ Locked in" : "None yet",
              tone: confirmed > 0 ? "up" : "muted",
            },
            {
              label: "No-Shows",
              value: String(noShows),
              sub: noShows > 0 ? "Follow up" : "↑ All clear",
              tone: noShows > 0 ? "down" : "up",
            },
            {
              label: revLabel,
              value: formatCurrency(revenue),
              sub: revenue > 0 ? "↑ From completed" : "Awaiting completes",
              tone: revenue > 0 ? "up" : "muted",
            },
          ];
          return stats.map(s => {
            // Revenue tile gets the green money color on the headline value
            // — matches the in-row prices everywhere else.
            const isMoney = s.label.startsWith("Revenue");
            return (
              <div key={s.label} className="bg-card border border-border rounded-2xl p-4">
                <p className="text-[10px] text-grey font-semibold uppercase tracking-wider">{s.label}</p>
                <p className={cn(
                  "text-[28px] font-extrabold mt-2 font-mono tracking-tighter leading-none",
                  isMoney ? "text-emerald-400" : "text-foreground",
                )}>{s.value}</p>
                <p className={cn(
                  "text-[11px] mt-2 font-medium",
                  s.tone === "up"    && "text-emerald-400",
                  s.tone === "down"  && "text-red-400",
                  s.tone === "muted" && "text-grey",
                )}>{s.sub}</p>
              </div>
            );
          });
        })()}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border">
        {(["appointments", "waitlist"] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={cn("px-4 py-2 text-sm font-medium capitalize border-b-2 -mb-px transition-colors",
              tab === t ? "border-black text-foreground" : "border-transparent text-grey hover:text-foreground")}>
            {t} {t === "waitlist" && waitlist.length > 0 && (
              <span className="ml-1 text-xs bg-black/10 text-foreground px-1.5 rounded-full">{waitlist.length}</span>
            )}
          </button>
        ))}
      </div>

      {tab === "appointments" ? (
        <>
          {/* Date range dropdown + calendar picker */}
          <div className="flex flex-wrap items-center gap-2 relative">
            <select
              value={pickedDate ? "" : dateFilter}
              onChange={e => { setDateFilter(e.target.value); setPickedDate(null); }}
              className="rounded-xl border border-border bg-card-raised px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-black/20"
            >
              {pickedDate && <option value="">Picked date</option>}
              {DATE_FILTERS.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}
            </select>

            <button type="button" onClick={() => setShowDatePicker(s => !s)}
              className={cn("inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-sm transition-colors",
                pickedDate ? "bg-gold text-black border-black" : "bg-card-raised text-grey border-border hover:text-foreground hover:border-gray-400")}>
              📅 {pickedDate ? friendlyDate(pickedDate) : "Pick date"}
            </button>
            {pickedDate && (
              <button type="button" onClick={() => setPickedDate(null)} className="text-grey hover:text-foreground text-sm px-1" aria-label="Clear date">✕</button>
            )}

            {showDatePicker && (
              <>
                <div className="fixed inset-0 z-30" onClick={() => setShowDatePicker(false)} />
                <div className="absolute left-0 top-full mt-2 z-40">
                  <CalendarPicker
                    value={pickedDate ? new Date(pickedDate + "T00:00:00") : null}
                    minDate={null}
                    onChange={(d) => { setPickedDate(formatDateForDb(d)); setShowDatePicker(false); }}
                  />
                </div>
              </>
            )}
          </div>

          {/* Secondary filters */}
          <div className="flex flex-wrap gap-3">
            <Input placeholder="Search client…" value={search} onChange={e => setSearch(e.target.value)} className="w-48" />
            <select value={barberFilter} onChange={e => setBarberFilter(e.target.value)}
              className="rounded-xl border border-border bg-card-raised px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-black/20">
              <option value="all">All Barbers</option>
              {barbers.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
              className="rounded-xl border border-border bg-card-raised px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-black/20">
              <option value="active">Open · needs action</option>
              <option value="unpaid">💲 Unpaid · money owed</option>
              <option value="all">All Statuses</option>
              {STATUS_OPTIONS.map(s => <option key={s} value={s}>{statusLabel(s)}</option>)}
            </select>
          </div>

          {/* ── Mobile card list (md:hidden) ──────────────────────────── */}
          <div className="md:hidden space-y-3">
            {loading ? (
              Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="bg-card border border-border rounded-2xl p-4 space-y-3 animate-pulse">
                  <div className="flex justify-between"><Skeleton className="h-4 w-32" /><Skeleton className="h-5 w-16 rounded-full" /></div>
                  <Skeleton className="h-3 w-40" />
                  <Skeleton className="h-3 w-28" />
                  <div className="flex gap-2"><Skeleton className="h-8 flex-1 rounded-lg" /><Skeleton className="h-8 flex-1 rounded-lg" /><Skeleton className="h-8 flex-1 rounded-lg" /></div>
                </div>
              ))
            ) : filtered.length === 0 ? (
              <div className="bg-card border border-border rounded-2xl py-12 text-center">
                <p className="text-3xl mb-3">📅</p>
                <p className="text-foreground font-medium mb-1">{search || statusFilter !== "all" || barberFilter !== "all" ? "No appointments match your filters" : "No appointments yet"}</p>
                <p className="text-sm text-grey px-6">{search || statusFilter !== "all" || barberFilter !== "all" ? "Try adjusting your filters" : "Bookings will appear here once clients start scheduling"}</p>
              </div>
            ) : filtered.map(apt => {
              const [timeHour, timeMeridian] = (apt.time_slot ?? "").split(" ");
              const payBadge = paymentBadge(apt);
              const hasFooter = !!apt.client_phone || !!payBadge;
              return (
              <div key={apt.id} onClick={() => { setSelectedApt(apt); setNotes(apt.notes ?? ""); }}
                className="bg-card border border-border rounded-2xl p-4 active:bg-card-raised/50 cursor-pointer transition-colors">
                {/* Primary row — time block · client/service · price/status */}
                <div className="flex items-center gap-3">
                  <div className="text-center min-w-[52px]">
                    <p className="text-base font-bold text-foreground font-mono leading-none">{timeHour}</p>
                    <p className="text-[10px] text-grey mt-1">{timeMeridian}</p>
                  </div>
                  <div className="w-px h-10 bg-[#1e1e1e] flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-foreground truncate">{apt.client_name}</p>
                    <p className="text-xs text-grey truncate">
                      {apt.services?.name ?? "—"}
                      {apptDuration(apt) ? <span className="text-grey-muted"> · {apptDuration(apt)} min</span> : null}
                      {" · "}{apt.barbers?.name ?? "—"}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                    <p className="text-sm font-bold font-mono text-emerald-400 leading-none">{formatCurrency(Number(apt.total_amount ?? 0) + Number(apt.tip_amount ?? 0))}</p>
                    <StatusPill status={apt.status} />
                  </div>
                </div>
                {/* Secondary row — date + phone + payment badge (only shown
                    when there's something worth showing). */}
                {hasFooter && (
                  <div className="flex items-center justify-between gap-2 mt-3 pt-3 border-t border-border">
                    <div className="min-w-0">
                      <p className="text-[11px] text-grey truncate">{shortFriendlyDate(apt.date)}</p>
                      <p className="text-[10px] text-grey-muted truncate leading-tight">{monthDay(apt.date)}{apt.client_phone && ` · ${apt.client_phone}`}</p>
                    </div>
                    {payBadge && (
                      <span className={cn("inline-flex items-center px-2.5 py-1 text-[11px] font-semibold rounded-md whitespace-nowrap flex-shrink-0", payBadge.bsClass)}>{payBadge.label}</span>
                    )}
                  </div>
                )}
                {(() => {
                  const action = primaryAction(apt.status as AppStatus);
                  const rejectable = canReject(apt.status as AppStatus);
                  if (!action && !rejectable) return null;
                  return (
                    <div className="flex gap-2 pt-1" onClick={e => e.stopPropagation()}>
                      {action && (
                        <button type="button" onClick={() => handleStatusChange(apt, action.next)} disabled={savingStatus === apt.id}
                          className={cn("btn flex-1", action.variant)}>{action.label}</button>
                      )}
                      {rejectable && (
                        <button type="button" onClick={() => setRejectModal({ appt: apt, reason: "" })} disabled={savingStatus === apt.id}
                          className="btn btn-soft-danger flex-1">Reject</button>
                      )}
                    </div>
                  );
                })()}
              </div>
              );
            })}
          </div>

          {/* ── Desktop / tablet table (hidden on mobile) ─────────────── */}
          {loading ? (
            <div className="hidden md:block bg-card border border-border rounded-2xl overflow-hidden">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 px-4 py-3.5 border-b border-[#2a2a2a]/50 last:border-0">
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-4 w-16" />
                <div className="flex-1 space-y-1.5"><Skeleton className="h-3.5 w-32" /><Skeleton className="h-3 w-20" /></div>
                <Skeleton className="h-3.5 w-20" />
                <Skeleton className="h-3.5 w-24" />
                <Skeleton className="h-5 w-20 rounded-full" />
                <Skeleton className="h-4 w-12" />
                <div className="flex gap-1"><Skeleton className="h-6 w-6 rounded-lg" /><Skeleton className="h-6 w-12 rounded-lg" /><Skeleton className="h-6 w-14 rounded-lg" /></div>
              </div>
            ))}
          </div>
          ) : (
            <Card className="hidden md:block p-0 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="border-b border-border">
                    <tr>
                      {["Date", "Time", "Client", "Barber", "Service", "Status", "Amount", "Actions"].map(h => (
                        <th key={h} className="text-left text-xs font-medium text-grey px-4 py-3">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.length === 0 ? (
                      <tr><td colSpan={8} className="text-center py-16">
                        <p className="text-3xl mb-3">📅</p>
                        <p className="text-foreground font-medium mb-1">{search || statusFilter !== "all" || barberFilter !== "all" ? "No appointments match your filters" : "No appointments yet"}</p>
                        <p className="text-sm text-grey">{search || statusFilter !== "all" || barberFilter !== "all" ? "Try adjusting your filters" : "Bookings will appear here once clients start scheduling"}</p>
                      </td></tr>
                    ) : filtered.map(apt => (
                      <tr key={apt.id} onClick={() => { setSelectedApt(apt); setNotes(apt.notes ?? ""); }}
                        className="border-b border-[#2a2a2a]/50 hover:bg-card-raised/50 cursor-pointer transition-colors">
                        <td className="px-4 py-3 whitespace-nowrap">
                          <p className="text-sm text-grey">{shortFriendlyDate(apt.date)}</p>
                          <p className="text-xs text-grey-muted leading-tight">{monthDay(apt.date)}</p>
                        </td>
                        <td className="px-4 py-3 text-sm text-foreground font-medium">{apt.time_slot}</td>
                        <td className="px-4 py-3">
                          <p className="text-sm text-foreground">{apt.client_name}</p>
                          <p className="text-xs text-grey">{apt.client_phone}</p>
                        </td>
                        <td className="px-4 py-3 text-sm text-grey">{apt.barbers?.name ?? "—"}</td>
                        <td className="px-4 py-3 text-sm text-grey">{apt.services?.name ?? "—"}{apptDuration(apt) ? <span className="text-grey-muted"> · {apptDuration(apt)} min</span> : null}</td>
                        <td className="px-4 py-3">
                          <StatusPill status={apt.status} />
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <p className="text-sm font-mono font-semibold text-emerald-400">{formatCurrency(Number(apt.total_amount ?? 0) + Number(apt.tip_amount ?? 0))}</p>
                          {(() => { const p = paymentBadge(apt); return p ? <span className={cn("inline-flex items-center px-2.5 py-1 text-[11px] font-semibold rounded-md whitespace-nowrap mt-1", p.bsClass)}>{p.label}</span> : null; })()}
                        </td>
                        <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                          {(() => {
                            const action = primaryAction(apt.status as AppStatus);
                            const rejectable = canReject(apt.status as AppStatus);
                            if (!action && !rejectable) {
                              return <span className="text-xs text-grey">—</span>;
                            }
                            return (
                              <div className="flex gap-1">
                                {action && (
                                  <button type="button" onClick={() => handleStatusChange(apt, action.next)} disabled={savingStatus === apt.id}
                                    className={cn("btn btn-sm", action.variant)}>{action.label}</button>
                                )}
                                {rejectable && (
                                  <button type="button" onClick={() => setRejectModal({ appt: apt, reason: "" })} disabled={savingStatus === apt.id}
                                    className="btn btn-soft-danger btn-sm">Reject</button>
                                )}
                              </div>
                            );
                          })()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </>
      ) : (
        <Card>
          <CardHeader><CardTitle>Waitlist ({waitlist.length})</CardTitle></CardHeader>
          <CardContent>
            {waitlist.length === 0 ? (
              <p className="text-center text-grey py-8">No one on the waitlist right now</p>
            ) : (
              <div className="space-y-3">
                {waitlist.map(wl => {
                  const svc = services.find(s => s.id === wl.service_id);
                  const barber = barbers.find(b => b.id === wl.barber_id);
                  return (
                    <div key={wl.id} className="flex items-center justify-between p-4 bg-card-raised rounded-xl border border-border">
                      <div>
                        <p className="text-sm font-medium text-foreground">{wl.client_name} · {svc?.name ?? "Any Service"}</p>
                        <p className="text-xs text-grey">{wl.client_phone} · Preferred: {barber?.name ?? "Any Barber"}</p>
                        <p className="text-xs text-grey mt-1">Added: {new Date(wl.added_at).toLocaleTimeString("en-CA", { hour: "2-digit", minute: "2-digit" })}</p>
                      </div>
                      <div className="flex gap-2">
                        <Button size="sm" variant="outline" onClick={() => {
                          // Open the Add-Appointment sheet prefilled from this waitlist
                          // entry; the row is deleted once the booking is created.
                          setAssignWaitlistId(wl.id);
                          setAddForm(f => ({
                            ...f,
                            client_name: wl.client_name ?? "",
                            client_phone: wl.client_phone ?? "",
                            service_id: wl.service_id ?? "",
                            barber_id: wl.barber_id ?? "",
                            date: formatDateForDb(new Date()),
                            time_slot: "9:00 AM",
                            repeat: "none",
                          }));
                          setShowAddModal(true);
                        }}>Assign</Button>
                        <Button size="sm" variant="danger" onClick={async () => {
                          const { error } = await supabase.from("waitlist").delete().eq("id", wl.id);
                          if (error) { showToast(`Couldn't remove: ${error.message}`); return; }
                          setWaitlist(prev => prev.filter(w => w.id !== wl.id));
                          showToast("Removed from waitlist");
                        }}>Remove</Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Side Panel */}
      {selectedApt && (
        <>
          <div className="fixed inset-0 bg-black/50 z-40" onClick={() => setSelectedApt(null)} />
          <div ref={detailSheetRef}
            style={{ transform: detailDrag.dragY ? `translate3d(0,${detailDrag.dragY}px,0)` : undefined, transition: detailDrag.dragging ? "none" : "transform 0.28s cubic-bezier(.32,.72,0,1)" }}
            className="fixed right-0 top-0 h-full w-full max-w-md bg-card shadow-sm border-l border-border z-50 overflow-y-auto overscroll-contain px-6 pt-[calc(env(safe-area-inset-top)+1.5rem)] pb-[calc(env(safe-area-inset-bottom)+6rem)] lg:pb-6 space-y-5">
            {/* Grab handle (mobile) — pull down anywhere to dismiss */}
            <div onClick={() => setSelectedApt(null)} className="sm:hidden flex justify-center -mt-2 mb-1 cursor-grab active:cursor-grabbing">
              <div className="w-10 h-1.5 rounded-full bg-[#3a3a3a]" />
            </div>
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-foreground">Appointment Details</h2>
              <button onClick={() => setSelectedApt(null)} className="text-grey hover:text-foreground text-xl">✕</button>
            </div>
            <div className="space-y-4">
              <div className="p-4 bg-card-raised rounded-xl border border-border space-y-1">
                <p className="text-xs text-grey uppercase tracking-wide">Client</p>
                <p className="text-foreground font-semibold">{selectedApt.client_name}</p>
                <p className="text-sm text-grey">{selectedApt.client_phone}</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: "Service", value: selectedApt.services?.name ?? "—" },
                  { label: "Barber", value: selectedApt.barbers?.name ?? "—" },
                  { label: "Date", value: formatFriendlyDate(selectedApt.date) },
                  { label: "Time", value: selectedApt.time_slot },
                  { label: "Duration", value: apptDuration(selectedApt) ? `${apptDuration(selectedApt)} min` : "—" },
                  { label: "Amount", value: formatCurrency(Number(selectedApt.total_amount ?? 0) + Number(selectedApt.tip_amount ?? 0)) },
                  { label: "Status", value: statusLabel(selectedApt.status) },
                ].map(item => (
                  <div key={item.label} className="p-3 bg-card-raised rounded-xl border border-border">
                    <p className="text-xs text-grey">{item.label}</p>
                    <p className={cn(
                      "text-sm mt-0.5 capitalize",
                      item.label === "Amount"
                        ? "font-mono font-semibold text-emerald-400"
                        : "text-foreground",
                    )}>{item.value}</p>
                  </div>
                ))}
              </div>
              {/* Payment summary row — shows the current payment state when
                  there's something to communicate. Hidden for completed +
                  unpaid (the finished status already tells the story). */}
              {(() => {
                const p = paymentBadge(selectedApt);
                if (!p) return null;
                const paidWhen = (selectedApt.payment_status === "paid" || selectedApt.payment_status === "captured")
                  ? timeAgo(selectedApt.paid_at) : "";
                return (
                  <div className="flex items-center justify-between p-3 bg-card-raised rounded-xl border border-border">
                    <span className="text-xs text-grey uppercase tracking-wide">Payment</span>
                    <span className="flex items-center gap-2">
                      {paidWhen && <span className="text-[11px] text-grey">{paidWhen}</span>}
                      <span className={cn("inline-flex items-center px-2.5 py-1 text-[11px] font-semibold rounded-md whitespace-nowrap", p.bsClass)}>{p.label}</span>
                    </span>
                  </div>
                );
              })()}
              <Textarea label="Notes" value={notes} onChange={e => setNotes(e.target.value)} rows={3} placeholder="Add notes…" />
              <Button variant="outline" className="w-full" onClick={saveNotes}>Save Notes</Button>

              {/* Post-visit tip link — copy + text to the customer so they can tip online. */}
              {(shop?.booking_settings as { tips_enabled?: boolean } | null)?.tips_enabled !== false && selectedApt.status !== "cancelled" && (
                <Button variant="ghost" className="w-full" onClick={async () => {
                  if (!navigator.clipboard) { showToast("Couldn't copy — copy it manually"); return; }
                  try { await navigator.clipboard.writeText(`${window.location.origin}/tip/${selectedApt.id}`); showToast("Tip link copied — text it to the customer 💜"); }
                  catch { showToast("Couldn't copy — copy it manually"); }
                }}>Copy tip link</Button>
              )}

              {/* Action buttons — only the ones that make sense for the current
                  status. Once an appointment is finalized (completed / cancelled
                  / no-show) the only thing left to do is issue a refund (if it
                  was paid). This mirrors the mobile-card / desktop-table logic. */}
              {(() => {
                const action = primaryAction(selectedApt.status as AppStatus);
                const rejectable = canReject(selectedApt.status as AppStatus);
                if (!action && !rejectable) return null;
                return (
                  <div className="grid grid-cols-2 gap-2">
                    {action && (
                      <button type="button" className={cn("btn", action.variant)} disabled={savingStatus === selectedApt.id}
                        onClick={() => handleStatusChange(selectedApt, action.next)}>{action.label}</button>
                    )}
                    {rejectable && (
                      <button type="button" className="btn btn-soft-danger" disabled={savingStatus === selectedApt.id}
                        onClick={() => setRejectModal({ appt: selectedApt, reason: "" })}>Reject</button>
                    )}
                    {rejectable && isNoShowReady(selectedApt) && (
                      <button type="button" className="btn btn-soft-warning col-span-2" disabled={savingStatus === selectedApt.id}
                        onClick={() => handleStatusChange(selectedApt, "no-show")}>
                        Mark as No-Show{(selectedApt.payment_status === "held" || selectedApt.payment_status === "saved") ? ` · charges ${formatCurrency(noShowFeeFor(selectedApt))}` : ""}
                      </button>
                    )}
                    {/* No-show capture / retry — card on hold/file, or a prior
                        auto-charge that failed and needs another attempt. */}
                    {selectedApt.status === "no-show" && (selectedApt.payment_status === "held" || selectedApt.payment_status === "saved" || selectedApt.payment_status === "failed") && (
                      <button type="button" className="btn btn-soft-danger col-span-2" disabled={savingStatus === selectedApt.id}
                        onClick={() => setNoShowModal({ appt: selectedApt, mode: "charge" })}>
                        {selectedApt.payment_status === "failed" ? "Retry No-Show Charge" : "Charge No-Show"} · {formatCurrency(noShowFeeFor(selectedApt))}
                      </button>
                    )}
                  </div>
                );
              })()}

              {/* Card-on-hold notice — the customer's card is authorized; it's
                  charged automatically on Complete (or via Charge No-Show). No
                  "take payment" here, or it would double-charge. */}
              {selectedApt.payment_status === "held" && selectedApt.status !== "no-show" && (
                <div className="rounded-xl border border-border bg-card-raised p-3 text-xs text-grey">
                  💳 Card on hold · <span className="text-foreground font-semibold">{formatCurrency(Number(selectedApt.total_amount ?? 0) + Number(selectedApt.tip_amount ?? 0))}</span>
                  <span className="block text-grey mt-0.5">Charged automatically when you mark this Complete.</span>
                </div>
              )}
              {/* Saved-card notice (booking was >7 days out, so the card is on
                  file rather than authorized). Charged off-session on Complete. */}
              {selectedApt.payment_status === "saved" && selectedApt.status !== "no-show" && (
                <div className="rounded-xl border border-border bg-card-raised p-3 text-xs text-grey">
                  💳 Card on file · <span className="text-foreground font-semibold">{formatCurrency(Number(selectedApt.total_amount ?? 0) + Number(selectedApt.tip_amount ?? 0))}</span>
                  <span className="block text-grey mt-0.5">Booked &gt;7 days out — charged when you mark this Complete (or as a no-show fee).</span>
                </div>
              )}
              {selectedApt.payment_status === "captured" && (
                <p className="text-center text-xs text-[#00e5a0]">✓ Paid · card charged</p>
              )}

              {/* Take Payment — only when there's still an outstanding charge and
                  no card is already held/captured. Lets the owner collect cash
                  or send a Stripe link after the fact. */}
              {selectedApt.payment_status !== "paid" &&
               selectedApt.payment_status !== "refunded" &&
               selectedApt.payment_status !== "held" &&
               selectedApt.payment_status !== "saved" &&
               selectedApt.payment_status !== "captured" &&
               (selectedApt.total_amount ?? 0) > 0 && (
                <button type="button" className="btn btn-success w-full" onClick={() => setPaymentModal(selectedApt)}>
                  💳 Take Payment ({formatCurrency(selectedApt.total_amount)})
                </button>
              )}

              {/* Refund — only when there's money to refund and we're inside
                  the refund window. Stays visible even after the appointment
                  is cancelled / completed / no-show, since that's exactly when
                  the owner needs it. */}
              {isRefundable(selectedApt) && (
                <button type="button" className="btn btn-outline-dark w-full" onClick={() => setRefundModal(selectedApt)}>
                  💳 Issue Refund ({formatCurrency(selectedApt.total_amount)})
                </button>
              )}
              {selectedApt.payment_status === "refunded" && (
                <p className="text-center text-xs text-grey">✓ Refunded</p>
              )}
            </div>
          </div>
        </>
      )}

      {/* Reject Modal */}
      {rejectModal && (
        <>
          <div className="fixed inset-0 bg-black/70 z-[60]" onClick={() => setRejectModal(null)} />
          <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 overflow-y-auto overscroll-contain [&>*]:my-auto">
            <div className="bg-card shadow-sm border border-border rounded-2xl p-6 w-full max-w-md space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold text-foreground">Reject Appointment</h2>
                <button onClick={() => setRejectModal(null)} className="text-grey hover:text-foreground text-xl leading-none">✕</button>
              </div>
              <div className="bg-card-raised rounded-xl p-3 text-sm text-grey">
                <span className="text-foreground font-medium">{rejectModal.appt.client_name}</span> · {rejectModal.appt.services?.name ?? "Service"} · {shortFriendlyDate(rejectModal.appt.date)} · {rejectModal.appt.time_slot}
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-grey">Reason (optional)</label>
                <textarea
                  value={rejectModal.reason}
                  onChange={e => setRejectModal(prev => prev ? { ...prev, reason: e.target.value } : null)}
                  rows={3}
                  placeholder="e.g. Barber unavailable, fully booked, shop closed…"
                  className="w-full bg-card-raised border border-border rounded-xl px-4 py-2.5 text-sm text-foreground placeholder:text-grey focus:outline-none focus:ring-2 focus:ring-red-500/30 resize-none"
                />
              </div>
              {rejectModal.appt.client_email && (
                <p className="text-xs text-grey bg-card-raised rounded-xl px-3 py-2">
                  A cancellation email will be sent to <span className="text-grey">{rejectModal.appt.client_email}</span> with this reason.
                </p>
              )}
              <div className="flex gap-3">
                <Button variant="outline" className="flex-1" onClick={() => setRejectModal(null)}>Back</Button>
                <Button className="flex-1 bg-red-500 hover:bg-red-600 text-foreground" loading={savingReject} onClick={rejectAppointment}>
                  Reject & Notify
                </Button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Refund Modal */}
      {refundModal && (
        <>
          <div className="fixed inset-0 bg-black/70 z-[60]" onClick={() => setRefundModal(null)} />
          <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 overflow-y-auto overscroll-contain [&>*]:my-auto">
            <div className="bg-card shadow-sm border border-border rounded-2xl p-6 w-full max-w-md space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold text-foreground">Issue Refund</h2>
                <button onClick={() => setRefundModal(null)} className="text-grey hover:text-foreground text-xl leading-none">✕</button>
              </div>
              <div className="bg-card-raised rounded-xl p-3 space-y-1 text-sm">
                <div className="flex justify-between"><span className="text-grey">Client</span><span className="text-foreground">{refundModal.client_name}</span></div>
                <div className="flex justify-between"><span className="text-grey">Service</span><span className="text-foreground">{refundModal.services?.name ?? "—"}</span></div>
                <div className="flex justify-between"><span className="text-grey">Amount</span><span className="font-mono font-bold text-emerald-400">${(refundModal.total_amount ?? 0).toFixed(2)}</span></div>
              </div>
              <p className="text-sm text-grey">
                This refunds <span className="font-mono font-semibold text-emerald-400">${(refundModal.total_amount ?? 0).toFixed(2)}</span> to {refundModal.client_name} via Stripe and emails them a confirmation. <span className="text-red-400">This cannot be undone.</span>
              </p>
              <div className="flex gap-3">
                <Button variant="outline" className="flex-1" onClick={() => setRefundModal(null)}>Cancel</Button>
                <Button className="flex-1 bg-red-500 hover:bg-red-600 text-foreground" loading={savingRefund} onClick={issueRefund}>
                  Refund ${(refundModal.total_amount ?? 0).toFixed(2)}
                </Button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* No-Show charge caution — confirms the exact fee that will hit the
          customer's card before charging. Shown for both "mark as no-show"
          (charges + flags) and the manual "charge / retry" path. */}
      {noShowModal && (
        <>
          <div className="fixed inset-0 bg-black/70 z-[60]" onClick={() => !savingNoShow && setNoShowModal(null)} />
          <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 overflow-y-auto overscroll-contain [&>*]:my-auto">
            <div className="bg-card shadow-sm border border-border rounded-2xl p-6 w-full max-w-md space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold text-foreground">{noShowModal.mode === "mark" ? "Mark No-Show & Charge?" : "Charge No-Show Fee?"}</h2>
                <button onClick={() => !savingNoShow && setNoShowModal(null)} className="text-grey hover:text-foreground text-xl leading-none">✕</button>
              </div>
              <div className="bg-card-raised rounded-xl p-3 space-y-1 text-sm">
                <div className="flex justify-between"><span className="text-grey">Client</span><span className="text-foreground">{noShowModal.appt.client_name}</span></div>
                <div className="flex justify-between"><span className="text-grey">Service</span><span className="text-foreground">{noShowModal.appt.services?.name ?? "—"}</span></div>
                <div className="flex justify-between"><span className="text-grey">When</span><span className="text-foreground">{prettyDate(noShowModal.appt.date)} · {noShowModal.appt.time_slot}</span></div>
              </div>
              {(() => {
                const max = noShowMaxFor(noShowModal.appt);
                const entered = Math.min(Math.max(Number(noShowAmt) || 0, 0), max);
                return (
                  <>
                    <div>
                      <label className="text-xs text-grey">No-show charge ($) — max {formatCurrency(max)} ({NO_SHOW_MAX_PCT}% of {formatCurrency(noShowModal.appt.total_amount ?? 0)})</label>
                      <input
                        type="number" min={0} max={max} step="0.01" inputMode="decimal"
                        value={noShowAmt}
                        onChange={e => setNoShowAmt(e.target.value)}
                        onBlur={() => setNoShowAmt(String(Math.min(Math.max(Number(noShowAmt) || 0, 0), max)))}
                        className="w-full mt-1 bg-card-raised border border-border rounded-xl px-3.5 py-2.5 text-sm text-foreground font-mono focus:outline-none focus:border-amber-500"
                      />
                      <p className="text-[11px] text-grey mt-1">Defaults to your set fee. Lower it, or set $0 to mark the no-show without charging.</p>
                    </div>
                    <p className="text-sm text-grey">
                      {entered > 0
                        ? <>⚠️ This charges <span className="text-foreground">{noShowModal.appt.client_name}</span>&apos;s card on file <span className="font-mono font-semibold text-amber-400">{formatCurrency(entered)}</span>{noShowModal.mode === "mark" ? " and marks the appointment a no-show." : "."} They&apos;ll be emailed a receipt.</>
                        : <>This marks the appointment a no-show and <span className="text-foreground">releases the hold — no charge.</span></>}
                    </p>
                    <div className="flex gap-3">
                      <Button variant="outline" className="flex-1" disabled={savingNoShow} onClick={() => setNoShowModal(null)}>Cancel</Button>
                      <Button className="flex-1 bg-amber-500 hover:bg-amber-600 text-black font-semibold" loading={savingNoShow} onClick={confirmNoShow}>
                        {entered > 0 ? `Charge ${formatCurrency(entered)}` : "Mark no-show · no charge"}
                      </Button>
                    </div>
                  </>
                );
              })()}
            </div>
          </div>
        </>
      )}

      {/* Payment Modal — opened on Complete when payment_status !== 'paid',
          or via the standalone "Take Payment" button in the side panel. */}
      {paymentModal && (
        <>
          <div className="fixed inset-0 bg-black/70 z-[60]" onClick={() => savingPayment === "" && setPaymentModal(null)} />
          <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 overflow-y-auto overscroll-contain [&>*]:my-auto">
            <div className="bg-card border border-border rounded-2xl p-6 w-full max-w-md space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold text-foreground">Check out</h2>
                <button onClick={() => savingPayment === "" && setPaymentModal(null)} className="text-grey hover:text-foreground text-xl leading-none">✕</button>
              </div>
              <div className="bg-card-raised rounded-xl p-3 text-sm space-y-1">
                <div className="flex justify-between"><span className="text-grey">Client</span><span className="text-foreground">{paymentModal.client_name}</span></div>
                <div className="flex justify-between"><span className="text-grey">Service</span><span className="text-foreground">{paymentModal.services?.name ?? "—"}</span></div>
                <div className="flex justify-between"><span className="text-grey">Amount due</span><span className="font-mono font-bold text-emerald-400">{formatCurrency(paymentModal.total_amount)}</span></div>
              </div>

              {payLink ? (
                /* Link generated without an email — show it to copy / open. */
                <div className="space-y-3">
                  <p className="text-sm text-foreground font-medium">Payment link ready</p>
                  <p className="text-xs text-grey">Send this to the customer to pay. They&apos;ll enter their email on the secure Stripe page.</p>
                  <div className="bg-card-raised border border-border rounded-xl p-2 text-xs text-sky-300 break-all">{payLink}</div>
                  <div className="grid grid-cols-2 gap-2">
                    <button type="button" className="btn btn-primary w-full"
                      onClick={async () => {
                        if (!navigator.clipboard) { showToast("Couldn't copy — copy it manually"); return; }
                        try { await navigator.clipboard.writeText(payLink); showToast("Link copied"); } catch { showToast("Couldn't copy — copy it manually"); }
                      }}>
                      Copy link
                    </button>
                    <a href={payLink} target="_blank" rel="noopener noreferrer" className="btn btn-success w-full text-center">
                      Open to pay
                    </a>
                  </div>
                  <button type="button" className="btn btn-outline-secondary w-full" onClick={() => setPaymentModal(null)}>
                    Done
                  </button>
                </div>
              ) : (
                <>
                  <div className="space-y-2">
                    <button type="button" className="btn btn-success w-full" disabled={savingPayment !== ""}
                      onClick={() => markCashPaid(true)}>
                      {savingPayment === "cash" ? "Saving…" : "💵 Cash · Paid in shop"}
                    </button>

                    {/* Optional email — type one to email the link, or leave blank
                        to just generate a link to copy/open. */}
                    <input
                      type="email"
                      value={payEmail}
                      onChange={e => setPayEmail(e.target.value)}
                      placeholder="Email (optional — to send the link)"
                      className="w-full bg-card-raised border border-border rounded-xl px-4 py-2.5 text-sm text-foreground placeholder:text-grey focus:outline-none focus:border-white"
                    />
                    <button type="button" className="btn btn-primary w-full" disabled={savingPayment !== ""}
                      onClick={() => sendPaymentLink(true)}>
                      {savingPayment === "link"
                        ? "Working…"
                        : payEmail.trim()
                          ? "📧 Email online payment link"
                          : "💳 Create online payment link"}
                    </button>

                    <button type="button" className="btn btn-outline-secondary w-full" disabled={savingPayment !== ""}
                      onClick={skipPaymentAndComplete}>
                      {savingPayment === "skip" ? "Completing…" : "Skip · Complete unpaid"}
                    </button>
                  </div>

                  <p className="text-xs text-grey text-center">
                    Cash and online links can be reconciled later from the appointment&apos;s payment badge.
                  </p>
                </>
              )}
            </div>
          </div>
        </>
      )}

      {/* Add Appointment Modal */}
      {showAddModal && (
        <>
          <div className="fixed inset-0 bg-black/70 z-40" onClick={() => setShowAddModal(false)} />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 [&>*]:my-auto">
            <div ref={addSheetRef}
              style={{ transform: addDrag.dragY ? `translate3d(0,${addDrag.dragY}px,0)` : undefined, transition: addDrag.dragging ? "none" : "transform 0.28s cubic-bezier(.32,.72,0,1)" }}
              className="bg-card shadow-sm border border-border rounded-2xl p-6 w-full max-w-md space-y-4 max-h-[88vh] overflow-y-auto overscroll-contain">
              {/* Grab handle (mobile) — pull down to dismiss */}
              <div onClick={() => setShowAddModal(false)} className="sm:hidden flex justify-center -mt-2 -mb-1 cursor-grab active:cursor-grabbing">
                <div className="w-10 h-1.5 rounded-full bg-[#3a3a3a]" />
              </div>
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold text-foreground">Add Appointment</h2>
                <button onClick={() => setShowAddModal(false)} className="text-grey hover:text-foreground">✕</button>
              </div>
              <Input label="Client Name *" value={addForm.client_name} onChange={e => setAddForm(p => ({ ...p, client_name: e.target.value }))} placeholder="Marcus Johnson" />
              <Input label="Phone" value={addForm.client_phone} onChange={e => setAddForm(p => ({ ...p, client_phone: formatPhone(e.target.value) }))} placeholder="506-555-0000" />
              <Select label="Barber" value={addForm.barber_id} onChange={e => setAddForm(p => ({ ...p, barber_id: e.target.value }))}>
                <option value="">Any Barber</option>
                {barbers.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
              </Select>
              <Select label="Service *" value={addForm.service_id} onChange={e => setAddForm(p => ({ ...p, service_id: e.target.value }))}>
                <option value="">Select a service</option>
                {services.map(s => <option key={s.id} value={s.id}>{s.name} — {formatCurrency(s.price)}</option>)}
              </Select>
              <Input label="Date" type="date" value={addForm.date} onChange={e => setAddForm(p => ({ ...p, date: e.target.value }))} />
              <Select label="Time" value={addForm.time_slot} onChange={e => setAddForm(p => ({ ...p, time_slot: e.target.value }))}>
                {TIME_SLOTS.map(t => <option key={t} value={t}>{t}</option>)}
              </Select>
              <Select label="Repeat" value={addForm.repeat} onChange={e => setAddForm(p => ({ ...p, repeat: e.target.value }))}>
                <option value="none">Does not repeat</option>
                <option value="weekly4">Weekly — 4 visits</option>
                <option value="biweekly4">Every 2 weeks — 4 visits</option>
                <option value="biweekly6">Every 2 weeks — 6 visits</option>
                <option value="monthly3">Every 4 weeks — 3 visits</option>
              </Select>
              {addForm.repeat !== "none" && (
                <p className="text-xs text-grey -mt-1">
                  Creates the same booking on each date at {addForm.time_slot}.
                </p>
              )}
              <div className="flex gap-3 pt-2">
                <Button variant="outline" className="flex-1" onClick={() => setShowAddModal(false)}>Cancel</Button>
                <Button className="flex-1" loading={savingAdd} onClick={addAppointment}>Save</Button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
