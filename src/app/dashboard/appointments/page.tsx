"use client";
import { useState, useMemo, useEffect, useCallback } from "react";
import { cn, formatCurrency, getStatusColor, formatDateForDb, formatFriendlyDate } from "@/lib/utils";
import { formatPhone, validatePrice } from "@/lib/validation";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Input, Select, Textarea } from "@/components/ui/input";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import type { AppointmentWithDetails, Barber } from "@/lib/database.types";
import type { Service } from "@/lib/database.types";

function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse bg-[#141414] rounded-xl", className)} />;
}

function Toast({ message, onClose }: { message: string; onClose: () => void }) {
  return (
    <div className="fixed bottom-6 right-6 z-[100] bg-[#141414] border border-[#1e1e1e] rounded-xl px-5 py-3 text-sm text-white shadow-xl flex items-center gap-3">
      <span className="text-white">✓</span>{message}
      <button onClick={onClose} className="text-[#777] hover:text-white ml-2">✕</button>
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
  if (status === "pending")   return { label: "Approve",  next: "confirmed", variant: "btn-success" };
  if (status === "confirmed") return { label: "Complete", next: "completed", variant: "btn-primary" };
  return null;
}
const canReject = (status: AppStatus) => status === "pending" || status === "confirmed";

/** Payment badge for an appointment row. Reflects the *current* state of
 *  `payment_status` + `payment_method`. Once Stripe webhooks are live the
 *  same fields update automatically, so this stays accurate without code
 *  changes — the badges here are already "real" data, not placeholders. */
function paymentBadge(apt: AppointmentWithDetails): { label: string; bsClass: string } {
  const status = apt.payment_status;
  const method = apt.payment_method;
  if (status === "paid") {
    const suffix = method === "online" ? " · Online" : method === "card" ? " · Card" : "";
    return { label: `Paid${suffix}`, bsClass: "text-bg-success" };
  }
  if (status === "refunded") return { label: "Refunded",        bsClass: "text-bg-secondary" };
  if (status === "failed")   return { label: "Payment failed",  bsClass: "text-bg-danger" };
  if (method === "cash")     return { label: "Cash on arrival", bsClass: "text-bg-light" };
  if (method === "online" || method === "card")
                             return { label: "Awaiting payment", bsClass: "text-bg-warning" };
  return { label: "Unpaid", bsClass: "text-bg-light" };
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
  { key: "all", label: "All Time" },
];

// Compact friendly date for table cells / list rows:
//   today    → "Today · Jun 4"
//   tomorrow → "Tomorrow · Jun 5"
//   other    → "Fri · Jun 6"  (weekday abbreviation + short month-day)
function shortFriendlyDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  d.setHours(0, 0, 0, 0);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);
  const monthDay = d.toLocaleDateString("en-CA", { month: "short", day: "numeric" });
  if (d.getTime() === today.getTime()) return `Today · ${monthDay}`;
  if (d.getTime() === tomorrow.getTime()) return `Tomorrow · ${monthDay}`;
  const weekday = d.toLocaleDateString("en-CA", { weekday: "short" });
  return `${weekday} · ${monthDay}`;
}

export default function AppointmentsPage() {
  const { shop, profile, accessToken } = useAuth();
  const [tab, setTab] = useState<"appointments" | "waitlist">("appointments");
  const [search, setSearch] = useState("");
  const [dateFilter, setDateFilter] = useState("today");
  const [barberFilter, setBarberFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [appointments, setAppointments] = useState<AppointmentWithDetails[]>([]);
  const [barbers, setBarbers] = useState<Barber[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [waitlist, setWaitlist] = useState<{ id: string; client_name: string; client_phone: string | null; service_id: string | null; barber_id: string | null; added_at: string }[]>([]);
  const [selectedApt, setSelectedApt] = useState<AppointmentWithDetails | null>(null);
  const [notes, setNotes] = useState("");
  const [showAddModal, setShowAddModal] = useState(false);
  const [toast, setToast] = useState("");
  const [savingStatus, setSavingStatus] = useState("");
  const [rejectModal, setRejectModal] = useState<{ appt: AppointmentWithDetails; reason: string } | null>(null);
  const [savingReject, setSavingReject] = useState(false);
  const [refundModal, setRefundModal] = useState<AppointmentWithDetails | null>(null);
  const [savingRefund, setSavingRefund] = useState(false);
  /** Opened when the owner clicks "Complete" on an unpaid appointment.
   *  Lets them either record a cash payment or email the customer a
   *  Stripe Checkout link, optionally finalizing the appointment too. */
  const [paymentModal, setPaymentModal] = useState<AppointmentWithDetails | null>(null);
  const [savingPayment, setSavingPayment] = useState<"" | "cash" | "link" | "skip">("");

  // Add appointment form state
  const [addForm, setAddForm] = useState({ client_name: "", client_phone: "", barber_id: "", service_id: "", date: formatDateForDb(new Date()), time_slot: "9:00 AM" });
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
    const isUpcomingView = dateFilter === "upcoming" || dateFilter === "week" || dateFilter === "today" || dateFilter === "tomorrow";
    let apptQuery = supabase
      .from("appointments")
      .select("*, barbers(id, name), services(id, name, price, category)")
      .eq("shop_id", shop.id)
      .order("date", { ascending: isUpcomingView })
      .order("time_slot", { ascending: true });

    if (dateFilter === "today") apptQuery = apptQuery.eq("date", today);
    else if (dateFilter === "tomorrow") apptQuery = apptQuery.eq("date", tomorrow);
    else if (dateFilter === "week") apptQuery = apptQuery.gte("date", weekStart).lte("date", weekEnd);
    else if (dateFilter === "upcoming") apptQuery = apptQuery.gte("date", today).lte("date", upcomingEnd);

    // Barbers only see their own appointments
    if (profile?.role === "barber" && myBarberId) {
      apptQuery = apptQuery.eq("barber_id", myBarberId);
    }

    const [{ data: appts }, { data: bs }, { data: svcs }, { data: wl }] = await Promise.all([
      apptQuery,
      supabase.from("barbers").select("*").eq("shop_id", shop.id).eq("is_active", true),
      supabase.from("services").select("*").eq("shop_id", shop.id).eq("is_active", true),
      supabase.from("waitlist").select("*").eq("shop_id", shop.id).order("added_at", { ascending: true }),
    ]);

    setAppointments((appts ?? []) as AppointmentWithDetails[]);
    setBarbers((bs ?? []) as Barber[]);
    setServices((svcs ?? []) as Service[]);
    setWaitlist(wl ?? []);
    setLoading(false);
  }, [shop, dateFilter, profile, myBarberId]);

  useEffect(() => { loadData(); }, [loadData]);

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

    if (status === "completed" && appt && shop) {
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

      // Send review request email (fire-and-forget)
      if (appt.client_email) {
        fetch("/api/send-email", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
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
              googlePlaceId: shop.google_place_id ?? "",
            },
          }),
        }).catch(() => null);
      }
    }

    // Send no-show follow-up email
    if (status === "no-show" && appt?.client_email && shop) {
      fetch("/api/send-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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

    setAppointments(prev => prev.map(a => a.id === id ? { ...a, status } : a));
    if (selectedApt?.id === id) setSelectedApt(prev => prev ? { ...prev, status } : null);
    showToast(`Marked as ${status}`);
  };

  const saveNotes = async () => {
    if (!selectedApt) return;
    await supabase.from("appointments").update({ notes }).eq("id", selectedApt.id);
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
    await supabase.from("appointments").update({ status: "cancelled", notes: updatedNotes }).eq("id", appt.id);
    setSavingReject(false);
    setRejectModal(null);
    setAppointments(prev => prev.map(a => a.id === appt.id ? { ...a, status: "cancelled", notes: updatedNotes } : a));
    if (selectedApt?.id === appt.id) setSelectedApt(prev => prev ? { ...prev, status: "cancelled", notes: updatedNotes } : null);

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
    if (next === "completed" && apt.payment_status !== "paid" && (apt.total_amount ?? 0) > 0) {
      setPaymentModal(apt);
      return;
    }
    updateStatus(apt.id, next);
  };

  const markCashPaid = async (alsoComplete: boolean) => {
    if (!paymentModal) return;
    setSavingPayment("cash");
    const patch: Record<string, unknown> = { payment_status: "paid", payment_method: "cash" };
    if (alsoComplete) patch.status = "completed";
    const { error } = await supabase.from("appointments").update(patch).eq("id", paymentModal.id);
    setSavingPayment("");
    if (error) { showToast(`Failed: ${error.message}`); return; }
    setAppointments(prev => prev.map(a => a.id === paymentModal.id ? { ...a, ...patch } as AppointmentWithDetails : a));
    if (selectedApt?.id === paymentModal.id) setSelectedApt(prev => prev ? { ...prev, ...patch } as AppointmentWithDetails : null);
    setPaymentModal(null);
    showToast(alsoComplete ? "Cash payment recorded · Appointment completed" : "Cash payment recorded");
  };

  const sendPaymentLink = async (alsoComplete: boolean) => {
    if (!paymentModal || !accessToken) return;
    setSavingPayment("link");
    const res = await fetch("/api/stripe/payment-link", {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ appointment_id: paymentModal.id, send_email: true }),
    });
    const data = await res.json();
    if (!res.ok) {
      setSavingPayment("");
      showToast(`Failed: ${data.error}`);
      return;
    }
    if (alsoComplete) {
      // Mark completed; the actual payment will land via the webhook when
      // the customer pays. Keep payment_status as-is until that happens.
      await supabase.from("appointments").update({ status: "completed" }).eq("id", paymentModal.id);
      setAppointments(prev => prev.map(a => a.id === paymentModal.id ? { ...a, status: "completed" as AppStatus } : a));
      if (selectedApt?.id === paymentModal.id) setSelectedApt(prev => prev ? { ...prev, status: "completed" as AppStatus } : null);
    }
    setSavingPayment("");
    setPaymentModal(null);
    showToast(data.emailed ? "Payment link emailed to customer" : "Payment link generated (no email on file)");
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
    const { error } = await supabase.from("appointments").insert({
      shop_id: shop.id,
      barber_id: addForm.barber_id || null,
      service_id: addForm.service_id,
      client_name: addForm.client_name,
      client_phone: addForm.client_phone || null,
      date: addForm.date,
      time_slot: addForm.time_slot,
      status: "confirmed",
      total_amount: svc?.price ?? 0,
    });
    setSavingAdd(false);
    if (error) { showToast("Failed to add appointment"); return; }
    setShowAddModal(false);
    setAddForm({ client_name: "", client_phone: "", barber_id: "", service_id: "", date: formatDateForDb(new Date()), time_slot: "9:00 AM" });
    showToast("Appointment added!");
    loadData();
  };

  const filtered = useMemo(() => {
    let apts = [...appointments];
    if (barberFilter !== "all") apts = apts.filter(a => a.barber_id === barberFilter);
    if (statusFilter !== "all") apts = apts.filter(a => a.status === statusFilter);
    if (search) apts = apts.filter(a =>
      a.client_name.toLowerCase().includes(search.toLowerCase()) ||
      (a.client_phone ?? "").includes(search)
    );
    return apts;
  }, [appointments, barberFilter, statusFilter, search]);

  const today = formatDateForDb(new Date());
  const todayApts = appointments.filter(a => a.date === today);
  const confirmed = todayApts.filter(a => a.status === "confirmed").length;
  const noShows = todayApts.filter(a => a.status === "no-show").length;
  const revenue = todayApts.filter(a => a.status === "completed").reduce((s, a) => s + (a.total_amount ?? 0), 0);

  const TIME_SLOTS = ["8:00 AM","8:30 AM","9:00 AM","9:30 AM","10:00 AM","10:30 AM","11:00 AM","11:30 AM","12:00 PM","12:30 PM","1:00 PM","1:30 PM","2:00 PM","2:30 PM","3:00 PM","3:30 PM","4:00 PM","4:30 PM","5:00 PM","5:30 PM","6:00 PM","6:30 PM","7:00 PM"];

  if (!shop) {
    return (
      <div className="p-8 flex flex-col items-center justify-center min-h-[60vh] text-center">
        <p className="text-[#777]">No shop found. Set up your shop first.</p>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {toast && <Toast message={toast} onClose={() => setToast("")} />}

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Appointments</h1>
          <p className="text-sm text-[#777] mt-0.5">Manage bookings and waitlist</p>
        </div>
        <Button onClick={() => setShowAddModal(true)}>+ Add Appointment</Button>
      </div>

      {/* Stats bar */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "Total Today", value: todayApts.length, color: "text-white" },
          { label: "Confirmed", value: confirmed, color: "text-emerald-700" },
          { label: "No-Shows", value: noShows, color: "text-orange-700" },
          { label: "Revenue Today", value: formatCurrency(revenue), color: "text-white" },
        ].map(s => (
          <Card key={s.label} className="py-4 px-5">
            <p className="text-xs text-[#777]">{s.label}</p>
            <p className={cn("text-2xl font-bold mt-1", s.color)}>{s.value}</p>
          </Card>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-[#1e1e1e]">
        {(["appointments", "waitlist"] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={cn("px-4 py-2 text-sm font-medium capitalize border-b-2 -mb-px transition-colors",
              tab === t ? "border-black text-white" : "border-transparent text-[#777] hover:text-white")}>
            {t} {t === "waitlist" && waitlist.length > 0 && (
              <span className="ml-1 text-xs bg-black/10 text-white px-1.5 rounded-full">{waitlist.length}</span>
            )}
          </button>
        ))}
      </div>

      {tab === "appointments" ? (
        <>
          {/* Date chips — primary navigation. Barbers usually want
              "today / tomorrow / this week", not a raw date picker. */}
          <div className="flex flex-wrap items-center gap-2">
            {DATE_FILTERS.map(f => (
              <button
                key={f.key}
                onClick={() => setDateFilter(f.key)}
                className={cn(
                  "px-3.5 py-1.5 rounded-full text-xs font-medium border transition-all",
                  dateFilter === f.key
                    ? "bg-gold text-black border-black"
                    : "bg-[#141414] text-[#999] border-[#1e1e1e] hover:border-gray-400 hover:text-white",
                )}
              >
                {f.label}
              </button>
            ))}
          </div>

          {/* Secondary filters */}
          <div className="flex flex-wrap gap-3">
            <Input placeholder="Search client…" value={search} onChange={e => setSearch(e.target.value)} className="w-48" />
            <select value={barberFilter} onChange={e => setBarberFilter(e.target.value)}
              className="rounded-xl border border-[#1e1e1e] bg-[#141414] px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-black/20">
              <option value="all">All Barbers</option>
              {barbers.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
              className="rounded-xl border border-[#1e1e1e] bg-[#141414] px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-black/20">
              <option value="all">All Statuses</option>
              {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
            </select>
          </div>

          {/* ── Mobile card list (md:hidden) ──────────────────────────── */}
          <div className="md:hidden space-y-3">
            {loading ? (
              Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="bg-black shadow-sm border border-[#1e1e1e] rounded-2xl p-4 space-y-3 animate-pulse">
                  <div className="flex justify-between"><Skeleton className="h-4 w-32" /><Skeleton className="h-5 w-16 rounded-full" /></div>
                  <Skeleton className="h-3 w-40" />
                  <Skeleton className="h-3 w-28" />
                  <div className="flex gap-2"><Skeleton className="h-8 flex-1 rounded-lg" /><Skeleton className="h-8 flex-1 rounded-lg" /><Skeleton className="h-8 flex-1 rounded-lg" /></div>
                </div>
              ))
            ) : filtered.length === 0 ? (
              <div className="bg-black shadow-sm border border-[#1e1e1e] rounded-2xl py-12 text-center">
                <p className="text-3xl mb-3">📅</p>
                <p className="text-white font-medium mb-1">{search || statusFilter !== "all" || barberFilter !== "all" ? "No appointments match your filters" : "No appointments yet"}</p>
                <p className="text-sm text-[#777] px-6">{search || statusFilter !== "all" || barberFilter !== "all" ? "Try adjusting your filters" : "Bookings will appear here once clients start scheduling"}</p>
              </div>
            ) : filtered.map(apt => (
              <div key={apt.id} onClick={() => { setSelectedApt(apt); setNotes(apt.notes ?? ""); }}
                className="bg-black shadow-sm border border-[#1e1e1e] rounded-2xl p-4 active:bg-[#141414]/50 cursor-pointer transition-colors space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-base font-semibold text-white truncate">{apt.client_name}</p>
                    <p className="text-xs text-[#777]">{apt.client_phone || "—"}</p>
                  </div>
                  <span className={cn("inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium border flex-shrink-0", getStatusColor(apt.status))}>
                    {apt.status}
                  </span>
                </div>
                <div className="space-y-1.5 text-sm">
                  <p className="text-white font-medium">{shortFriendlyDate(apt.date)} · <span className="text-white">{apt.time_slot}</span></p>
                  <p className="text-[#777]">{apt.services?.name ?? "—"} · <span className="text-white">{formatCurrency(apt.total_amount)}</span></p>
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs text-[#777]">Barber: {apt.barbers?.name ?? "—"}</p>
                    {(() => { const p = paymentBadge(apt); return <span className={cn("badge", p.bsClass)}>{p.label}</span>; })()}
                  </div>
                </div>
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
                          className="btn btn-danger flex-1">Reject</button>
                      )}
                    </div>
                  );
                })()}
              </div>
            ))}
          </div>

          {/* ── Desktop / tablet table (hidden on mobile) ─────────────── */}
          {loading ? (
            <div className="hidden md:block bg-black shadow-sm border border-[#1e1e1e] rounded-2xl overflow-hidden">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 px-4 py-3.5 border-b border-[#1e1e1e]/50 last:border-0">
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
                  <thead className="border-b border-[#1e1e1e]">
                    <tr>
                      {["Date", "Time", "Client", "Barber", "Service", "Status", "Amount", "Actions"].map(h => (
                        <th key={h} className="text-left text-xs font-medium text-[#777] px-4 py-3">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.length === 0 ? (
                      <tr><td colSpan={8} className="text-center py-16">
                        <p className="text-3xl mb-3">📅</p>
                        <p className="text-white font-medium mb-1">{search || statusFilter !== "all" || barberFilter !== "all" ? "No appointments match your filters" : "No appointments yet"}</p>
                        <p className="text-sm text-[#777]">{search || statusFilter !== "all" || barberFilter !== "all" ? "Try adjusting your filters" : "Bookings will appear here once clients start scheduling"}</p>
                      </td></tr>
                    ) : filtered.map(apt => (
                      <tr key={apt.id} onClick={() => { setSelectedApt(apt); setNotes(apt.notes ?? ""); }}
                        className="border-b border-[#1e1e1e]/50 hover:bg-[#141414]/50 cursor-pointer transition-colors">
                        <td className="px-4 py-3 text-sm text-[#999] whitespace-nowrap">{shortFriendlyDate(apt.date)}</td>
                        <td className="px-4 py-3 text-sm text-white font-medium">{apt.time_slot}</td>
                        <td className="px-4 py-3">
                          <p className="text-sm text-white">{apt.client_name}</p>
                          <p className="text-xs text-[#777]">{apt.client_phone}</p>
                        </td>
                        <td className="px-4 py-3 text-sm text-[#999]">{apt.barbers?.name ?? "—"}</td>
                        <td className="px-4 py-3 text-sm text-[#999]">{apt.services?.name ?? "—"}</td>
                        <td className="px-4 py-3">
                          <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium border", getStatusColor(apt.status))}>
                            {apt.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <p className="text-sm text-white">{formatCurrency(apt.total_amount)}</p>
                          {(() => { const p = paymentBadge(apt); return <span className={cn("badge mt-1", p.bsClass)}>{p.label}</span>; })()}
                        </td>
                        <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                          {(() => {
                            const action = primaryAction(apt.status as AppStatus);
                            const rejectable = canReject(apt.status as AppStatus);
                            if (!action && !rejectable) {
                              return <span className="text-xs text-[#555]">—</span>;
                            }
                            return (
                              <div className="flex gap-1">
                                {action && (
                                  <button type="button" onClick={() => handleStatusChange(apt, action.next)} disabled={savingStatus === apt.id}
                                    className={cn("btn btn-sm", action.variant)}>{action.label}</button>
                                )}
                                {rejectable && (
                                  <button type="button" onClick={() => setRejectModal({ appt: apt, reason: "" })} disabled={savingStatus === apt.id}
                                    className="btn btn-danger btn-sm">Reject</button>
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
              <p className="text-center text-[#777] py-8">No one on the waitlist right now</p>
            ) : (
              <div className="space-y-3">
                {waitlist.map(wl => {
                  const svc = services.find(s => s.id === wl.service_id);
                  const barber = barbers.find(b => b.id === wl.barber_id);
                  return (
                    <div key={wl.id} className="flex items-center justify-between p-4 bg-[#141414] rounded-xl border border-[#1e1e1e]">
                      <div>
                        <p className="text-sm font-medium text-white">{wl.client_name} · {svc?.name ?? "Any Service"}</p>
                        <p className="text-xs text-[#777]">{wl.client_phone} · Preferred: {barber?.name ?? "Any Barber"}</p>
                        <p className="text-xs text-[#777] mt-1">Added: {new Date(wl.added_at).toLocaleTimeString("en-CA", { hour: "2-digit", minute: "2-digit" })}</p>
                      </div>
                      <div className="flex gap-2">
                        <Button size="sm" variant="outline" onClick={() => showToast("Barber assigned")}>Assign</Button>
                        <Button size="sm" variant="danger" onClick={async () => {
                          await supabase.from("waitlist").delete().eq("id", wl.id);
                          setWaitlist(prev => prev.filter(w => w.id !== wl.id));
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
          <div className="fixed right-0 top-0 h-full w-full max-w-md bg-black shadow-sm border-l border-[#1e1e1e] z-50 overflow-y-auto p-6 space-y-5">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-white">Appointment Details</h2>
              <button onClick={() => setSelectedApt(null)} className="text-[#777] hover:text-white text-xl">✕</button>
            </div>
            <div className="space-y-4">
              <div className="p-4 bg-[#141414] rounded-xl border border-[#1e1e1e] space-y-1">
                <p className="text-xs text-[#777] uppercase tracking-wide">Client</p>
                <p className="text-white font-semibold">{selectedApt.client_name}</p>
                <p className="text-sm text-[#999]">{selectedApt.client_phone}</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: "Service", value: selectedApt.services?.name ?? "—" },
                  { label: "Barber", value: selectedApt.barbers?.name ?? "—" },
                  { label: "Date", value: formatFriendlyDate(selectedApt.date) },
                  { label: "Time", value: selectedApt.time_slot },
                  { label: "Amount", value: formatCurrency(selectedApt.total_amount) },
                  { label: "Status", value: selectedApt.status },
                ].map(item => (
                  <div key={item.label} className="p-3 bg-[#141414] rounded-xl border border-[#1e1e1e]">
                    <p className="text-xs text-[#777]">{item.label}</p>
                    <p className="text-sm text-white mt-0.5 capitalize">{item.value}</p>
                  </div>
                ))}
              </div>
              {/* Payment summary row — always shown so the owner sees at a
                  glance whether money has moved before deciding actions. */}
              {(() => {
                const p = paymentBadge(selectedApt);
                return (
                  <div className="flex items-center justify-between p-3 bg-[#141414] rounded-xl border border-[#1e1e1e]">
                    <span className="text-xs text-[#777] uppercase tracking-wide">Payment</span>
                    <span className={cn("badge", p.bsClass)}>{p.label}</span>
                  </div>
                );
              })()}
              <Textarea label="Notes" value={notes} onChange={e => setNotes(e.target.value)} rows={3} placeholder="Add notes…" />
              <Button variant="outline" className="w-full" onClick={saveNotes}>Save Notes</Button>

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
                      <button type="button" className="btn btn-danger" disabled={savingStatus === selectedApt.id}
                        onClick={() => setRejectModal({ appt: selectedApt, reason: "" })}>Reject</button>
                    )}
                    {rejectable && (
                      <button type="button" className="btn btn-warning col-span-2" disabled={savingStatus === selectedApt.id}
                        onClick={() => updateStatus(selectedApt.id, "no-show")}>Mark as No-Show</button>
                    )}
                  </div>
                );
              })()}

              {/* Take Payment — visible whenever there's an outstanding charge,
                  regardless of appointment status. Lets the owner collect
                  cash or send a Stripe link after the fact. */}
              {selectedApt.payment_status !== "paid" &&
               selectedApt.payment_status !== "refunded" &&
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
                <p className="text-center text-xs text-[#777]">✓ Refunded</p>
              )}
            </div>
          </div>
        </>
      )}

      {/* Reject Modal */}
      {rejectModal && (
        <>
          <div className="fixed inset-0 bg-black/70 z-[60]" onClick={() => setRejectModal(null)} />
          <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
            <div className="bg-black shadow-sm border border-[#1e1e1e] rounded-2xl p-6 w-full max-w-md space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold text-white">Reject Appointment</h2>
                <button onClick={() => setRejectModal(null)} className="text-[#777] hover:text-white text-xl leading-none">✕</button>
              </div>
              <div className="bg-[#141414] rounded-xl p-3 text-sm text-[#777]">
                <span className="text-white font-medium">{rejectModal.appt.client_name}</span> · {rejectModal.appt.services?.name ?? "Service"} · {shortFriendlyDate(rejectModal.appt.date)} · {rejectModal.appt.time_slot}
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-[#999]">Reason (optional)</label>
                <textarea
                  value={rejectModal.reason}
                  onChange={e => setRejectModal(prev => prev ? { ...prev, reason: e.target.value } : null)}
                  rows={3}
                  placeholder="e.g. Barber unavailable, fully booked, shop closed…"
                  className="w-full bg-[#141414] border border-[#1e1e1e] rounded-xl px-4 py-2.5 text-sm text-white placeholder:text-[#555] focus:outline-none focus:ring-2 focus:ring-red-500/30 resize-none"
                />
              </div>
              {rejectModal.appt.client_email && (
                <p className="text-xs text-[#777] bg-[#141414] rounded-xl px-3 py-2">
                  A cancellation email will be sent to <span className="text-[#999]">{rejectModal.appt.client_email}</span> with this reason.
                </p>
              )}
              <div className="flex gap-3">
                <Button variant="outline" className="flex-1" onClick={() => setRejectModal(null)}>Back</Button>
                <Button className="flex-1 bg-red-500 hover:bg-red-600 text-white" loading={savingReject} onClick={rejectAppointment}>
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
          <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
            <div className="bg-black shadow-sm border border-[#1e1e1e] rounded-2xl p-6 w-full max-w-md space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold text-white">Issue Refund</h2>
                <button onClick={() => setRefundModal(null)} className="text-[#777] hover:text-white text-xl leading-none">✕</button>
              </div>
              <div className="bg-[#141414] rounded-xl p-3 space-y-1 text-sm">
                <div className="flex justify-between"><span className="text-[#777]">Client</span><span className="text-white">{refundModal.client_name}</span></div>
                <div className="flex justify-between"><span className="text-[#777]">Service</span><span className="text-white">{refundModal.services?.name ?? "—"}</span></div>
                <div className="flex justify-between"><span className="text-[#777]">Amount</span><span className="text-white font-semibold">${(refundModal.total_amount ?? 0).toFixed(2)}</span></div>
              </div>
              <p className="text-sm text-[#777]">
                This refunds <span className="text-white font-semibold">${(refundModal.total_amount ?? 0).toFixed(2)}</span> to {refundModal.client_name} via Stripe and emails them a confirmation. <span className="text-red-400">This cannot be undone.</span>
              </p>
              <div className="flex gap-3">
                <Button variant="outline" className="flex-1" onClick={() => setRefundModal(null)}>Cancel</Button>
                <Button className="flex-1 bg-red-500 hover:bg-red-600 text-white" loading={savingRefund} onClick={issueRefund}>
                  Refund ${(refundModal.total_amount ?? 0).toFixed(2)}
                </Button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Payment Modal — opened on Complete when payment_status !== 'paid',
          or via the standalone "Take Payment" button in the side panel. */}
      {paymentModal && (
        <>
          <div className="fixed inset-0 bg-black/70 z-[60]" onClick={() => savingPayment === "" && setPaymentModal(null)} />
          <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
            <div className="bg-black border border-[#1e1e1e] rounded-2xl p-6 w-full max-w-md space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold text-white">Take Payment</h2>
                <button onClick={() => savingPayment === "" && setPaymentModal(null)} className="text-[#777] hover:text-white text-xl leading-none">✕</button>
              </div>
              <div className="bg-[#141414] rounded-xl p-3 text-sm space-y-1">
                <div className="flex justify-between"><span className="text-[#777]">Client</span><span className="text-white">{paymentModal.client_name}</span></div>
                <div className="flex justify-between"><span className="text-[#777]">Service</span><span className="text-white">{paymentModal.services?.name ?? "—"}</span></div>
                <div className="flex justify-between"><span className="text-[#777]">Amount due</span><span className="text-white font-bold">{formatCurrency(paymentModal.total_amount)}</span></div>
              </div>

              <div className="space-y-2">
                <button type="button" className="btn btn-success w-full" disabled={savingPayment !== ""}
                  onClick={() => markCashPaid(true)}>
                  {savingPayment === "cash" ? "Saving…" : "💵 Cash · Paid in shop"}
                </button>

                <button type="button" className="btn btn-primary w-full" disabled={savingPayment !== "" || !paymentModal.client_email}
                  onClick={() => sendPaymentLink(true)}>
                  {savingPayment === "link" ? "Sending…" : "📧 Send online payment link"}
                </button>
                {!paymentModal.client_email && (
                  <p className="text-xs text-[#777] text-center -mt-1">Customer has no email — can't send link</p>
                )}

                <button type="button" className="btn btn-outline-secondary w-full" disabled={savingPayment !== ""}
                  onClick={skipPaymentAndComplete}>
                  {savingPayment === "skip" ? "Completing…" : "Skip · Complete unpaid"}
                </button>
              </div>

              <p className="text-xs text-[#777] text-center">
                Cash and online links can be reconciled later from the appointment's payment badge.
              </p>
            </div>
          </div>
        </>
      )}

      {/* Add Appointment Modal */}
      {showAddModal && (
        <>
          <div className="fixed inset-0 bg-black/70 z-40" onClick={() => setShowAddModal(false)} />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="bg-black shadow-sm border border-[#1e1e1e] rounded-2xl p-6 w-full max-w-md space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold text-white">Add Appointment</h2>
                <button onClick={() => setShowAddModal(false)} className="text-[#777] hover:text-white">✕</button>
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
