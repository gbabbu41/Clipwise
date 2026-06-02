"use client";
import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Calendar } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { useBarber } from "@/lib/barber-context";
import { supabase } from "@/lib/supabase";
import { cn, formatCurrency } from "@/lib/utils";

type AppStatus = "confirmed" | "pending" | "completed" | "cancelled" | "no-show";

interface Appointment {
  id: string;
  shop_id: string;
  client_name: string;
  client_email?: string | null;
  client_phone?: string | null;
  time_slot: string;
  status: AppStatus;
  total_amount: number;
  date: string;
  payment_status?: "paid" | "failed" | "refunded" | "unpaid" | null;
  payment_method?: "card" | "cash" | "online" | null;
  services?: { name: string; price?: number; duration_minutes?: number };
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const STATUS_STYLES: Record<string, string> = {
  confirmed: "bg-green-500/15 text-green-400 border-green-500/30",
  pending: "bg-orange-500/15 text-orange-400 border-orange-500/30",
  completed: "bg-gray-500/15 text-[#555] border-gray-500/30",
  cancelled: "bg-red-500/15 text-red-400 border-red-500/30",
  "no-show": "bg-red-500/15 text-red-400 border-red-500/30",
};

function getWeekDates(offset = 0) {
  const now = new Date();
  const day = now.getDay();
  const start = new Date(now);
  start.setDate(now.getDate() - day + offset * 7);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });
}

/** Same context-aware action as the owner-side appointments page. */
function primaryAction(status: AppStatus): { label: string; next: AppStatus; variant: string } | null {
  if (status === "pending")   return { label: "Approve",  next: "confirmed", variant: "btn-success" };
  if (status === "confirmed") return { label: "Complete", next: "completed", variant: "btn-primary" };
  return null;
}
const canReject = (status: AppStatus) => status === "pending" || status === "confirmed";
const isUnpaidWithBalance = (a: Appointment) =>
  a.payment_status !== "paid" && a.payment_status !== "refunded" && (a.total_amount ?? 0) > 0;

export default function BarberSchedulePage() {
  const { accessToken } = useAuth();
  const { barber, shop } = useBarber();
  const [weekOffset, setWeekOffset] = useState(0);
  const [selectedDay, setSelectedDay] = useState(new Date().getDay());
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState("");
  const [savingId, setSavingId] = useState("");
  const [paymentModal, setPaymentModal] = useState<Appointment | null>(null);
  const [savingPayment, setSavingPayment] = useState<"" | "cash" | "link" | "skip">("");
  const [rejectModal, setRejectModal] = useState<{ appt: Appointment; reason: string } | null>(null);
  const [savingReject, setSavingReject] = useState(false);

  const canManageAppts = barber?.permissions?.manage_appointments === true;
  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(""), 3000); };

  const weekDates = getWeekDates(weekOffset);
  const from = weekDates[0].toISOString().split("T")[0];
  const to = weekDates[6].toISOString().split("T")[0];

  const loadAppts = () => {
    if (!accessToken) return;
    setLoading(true);
    const shopParam = shop?.id ? `&shop_id=${shop.id}` : "";
    fetch(`/api/barber/appointments?from=${from}&to=${to}${shopParam}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
      .then(r => r.json())
      .then(({ appointments: a }) => setAppointments(a ?? []))
      .finally(() => setLoading(false));
  };

  useEffect(loadAppts, [accessToken, from, to, shop?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Patch a single appointment on the server. Direct supabase write —
   *  RLS should allow barbers to update their own appointments. */
  const patchAppt = async (id: string, patch: Partial<Appointment>) => {
    const { error } = await supabase.from("appointments").update(patch).eq("id", id);
    if (error) {
      showToast(`Update failed: ${error.message}`);
      return false;
    }
    setAppointments(prev => prev.map(a => a.id === id ? { ...a, ...patch } as Appointment : a));
    return true;
  };

  /** Notify shop owner whenever a barber rejects an appointment. If the
   *  appointment was paid, frame it as a refund request (so the owner can
   *  issue it from the appointments side-panel). Otherwise it's just an
   *  awareness ping. Reason is the barber's free-text from the modal. */
  const notifyOwner = async (appt: Appointment, reason: string) => {
    const { data: shopRow } = await supabase
      .from("shops").select("owner_id, name").eq("id", appt.shop_id).maybeSingle();
    if (!shopRow?.owner_id) return;
    const isPaid = appt.payment_status === "paid";
    const title = isPaid ? "Refund needed" : "Appointment rejected by barber";
    const msgBase = `${barber?.name ?? "A barber"} rejected ${appt.client_name}'s appointment`;
    const msgMoney = isPaid
      ? ` (${formatCurrency(appt.total_amount)} paid — issue a refund from the Appointments page).`
      : ".";
    const msgReason = reason ? ` Reason: "${reason}"` : "";
    await supabase.from("notifications").insert({
      user_id: shopRow.owner_id,
      title,
      message: `${msgBase}${msgMoney}${msgReason}`,
      type: "system",
      is_read: false,
    });
  };

  /** Tell the customer their booking was cancelled. Same email type and
   *  template the owner-side reject flow uses, so the customer experience
   *  is identical regardless of who hit the button. */
  const emailCustomerRejection = (appt: Appointment, reason: string) => {
    if (!appt.client_email || !shop) return;
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
          serviceName: appt.services?.name ?? "Your service",
          date: appt.date,
          time: appt.time_slot,
          reason: reason || "",
        },
      }),
    }).catch(() => null);
  };

  const handlePrimary = async (apt: Appointment, next: AppStatus) => {
    // Same intercept as owner side: completing an unpaid appointment opens
    // the PaymentModal so the barber can record cash or send a Stripe link.
    if (next === "completed" && apt.payment_status !== "paid" && (apt.total_amount ?? 0) > 0) {
      setPaymentModal(apt);
      return;
    }
    setSavingId(apt.id);
    await patchAppt(apt.id, { status: next });
    setSavingId("");
    showToast(`Marked as ${next}`);
  };

  const submitReject = async () => {
    if (!rejectModal) return;
    const { appt, reason } = rejectModal;
    setSavingReject(true);
    const updatedNotes = reason
      ? `[Rejected by barber: ${reason}]`
      : undefined;
    const ok = await patchAppt(appt.id, {
      status: "cancelled",
      ...(updatedNotes ? { notes: updatedNotes } as Partial<Appointment> : {}),
    });
    setSavingReject(false);
    if (!ok) return;
    notifyOwner(appt, reason);
    emailCustomerRejection(appt, reason);
    setRejectModal(null);
    const channels: string[] = ["Owner notified"];
    if (appt.client_email) channels.push("customer emailed");
    showToast(`Appointment rejected · ${channels.join(" · ")}`);
  };

  // ── Payment modal handlers ──────────────────────────────────────────────
  const markCashPaid = async (alsoComplete: boolean) => {
    if (!paymentModal) return;
    setSavingPayment("cash");
    const patch: Partial<Appointment> = { payment_status: "paid", payment_method: "cash" };
    if (alsoComplete) patch.status = "completed";
    const ok = await patchAppt(paymentModal.id, patch);
    setSavingPayment("");
    if (!ok) return;
    setPaymentModal(null);
    showToast(alsoComplete ? "Cash payment recorded · Completed" : "Cash payment recorded");
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
    if (alsoComplete) await patchAppt(paymentModal.id, { status: "completed" });
    setSavingPayment("");
    setPaymentModal(null);
    showToast(data.emailed ? "Payment link emailed" : "Payment link generated");
  };

  const skipPaymentAndComplete = async () => {
    if (!paymentModal) return;
    setSavingPayment("skip");
    await patchAppt(paymentModal.id, { status: "completed" });
    setSavingPayment("");
    setPaymentModal(null);
    showToast("Marked completed (unpaid)");
  };

  const selectedDate = weekDates[selectedDay];
  const selectedDateStr = selectedDate.toISOString().split("T")[0];
  const dayAppts = appointments.filter(a => a.date === selectedDateStr);
  const monthLabel = weekDates[0].toLocaleDateString("en-CA", { month: "long", year: "numeric" });

  return (
    <div className="p-6 max-w-4xl mx-auto">
      {toast && (
        <div className="fixed bottom-6 right-6 z-[100] bg-surface border border-border rounded-xl px-5 py-3 text-sm text-white shadow-xl">
          {toast}
        </div>
      )}

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">My Schedule</h1>
          <p className="text-[#777] text-sm mt-0.5">{monthLabel}</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setWeekOffset(w => w - 1)} className="p-2 rounded-xl bg-surface border border-border hover:border-gold/30 text-[#555] hover:text-white transition-all">
            <ChevronLeft size={18} />
          </button>
          <button onClick={() => { setWeekOffset(0); setSelectedDay(new Date().getDay()); }} className="px-3 py-1.5 text-sm text-gold border border-gold/30 rounded-xl hover:bg-gold/10 transition-all">
            Today
          </button>
          <button onClick={() => setWeekOffset(w => w + 1)} className="p-2 rounded-xl bg-surface border border-border hover:border-gold/30 text-[#555] hover:text-white transition-all">
            <ChevronRight size={18} />
          </button>
        </div>
      </div>

      {/* Week day tabs */}
      <div className="grid grid-cols-7 gap-1 mb-6 bg-surface border border-border rounded-2xl p-2">
        {weekDates.map((date, i) => {
          const dateStr = date.toISOString().split("T")[0];
          const count = appointments.filter(a => a.date === dateStr).length;
          const isToday = dateStr === new Date().toISOString().split("T")[0];
          const isSelected = i === selectedDay;
          return (
            <button key={i} onClick={() => setSelectedDay(i)} className={cn("flex flex-col items-center py-2.5 rounded-xl transition-all", isSelected ? "bg-gold/15 border border-gold/20" : "hover:bg-surface-raised")}>
              <span className={cn("text-xs font-medium", isSelected ? "text-gold" : "text-[#777]")}>{DAYS[i]}</span>
              <span className={cn("text-lg font-bold mt-0.5", isSelected ? "text-gold" : isToday ? "text-white" : "text-gray-300")}>{date.getDate()}</span>
              {count > 0 && <span className={cn("w-1.5 h-1.5 rounded-full mt-1", isSelected ? "bg-gold" : "bg-gray-600")} />}
            </button>
          );
        })}
      </div>

      {/* Day appointments */}
      <div>
        <h2 className="text-sm font-semibold text-[#555] uppercase tracking-wider mb-3">
          {selectedDate.toLocaleDateString("en-CA", { weekday: "long", month: "long", day: "numeric" })}
          <span className="ml-2 text-[#999] normal-case">({dayAppts.length} appointment{dayAppts.length !== 1 ? "s" : ""})</span>
        </h2>

        {loading ? (
          <div className="space-y-3">
            {[1,2,3].map(i => <div key={i} className="bg-surface border border-border rounded-xl h-20 animate-pulse" />)}
          </div>
        ) : dayAppts.length === 0 ? (
          <div className="bg-surface border border-border rounded-2xl p-10 text-center">
            <Calendar size={40} className="text-[#aaa] mx-auto mb-3" />
            <p className="text-[#555]">No appointments this day</p>
          </div>
        ) : (
          <div className="space-y-3">
            {dayAppts.map(appt => {
              const action = primaryAction(appt.status);
              const rejectable = canReject(appt.status);
              const canTakePayment = isUnpaidWithBalance(appt) && appt.status === "completed";
              const showActionsRow = canManageAppts && (action || rejectable || canTakePayment);
              return (
                <div key={appt.id} className="bg-surface border border-border rounded-xl p-4 space-y-3">
                  <div className="flex items-center gap-4">
                    <div className="text-center min-w-[56px]">
                      <p className="text-sm font-bold text-white">{appt.time_slot.split(" ")[0]}</p>
                      <p className="text-xs text-[#777]">{appt.time_slot.split(" ")[1]}</p>
                    </div>
                    <div className="w-px h-10 bg-border" />
                    <div className="w-9 h-9 rounded-full bg-gold/15 border border-gold/20 flex items-center justify-center text-gold font-semibold text-sm flex-shrink-0">
                      {appt.client_name.charAt(0)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-white">{appt.client_name}</p>
                      <p className="text-sm text-[#777]">
                        {appt.services?.name ?? "Service"}
                        {appt.services?.duration_minutes ? ` · ${appt.services.duration_minutes}min` : ""}
                      </p>
                    </div>
                    <div className="text-right">
                      <span className={`text-xs px-2 py-1 rounded-full border capitalize block mb-1 ${STATUS_STYLES[appt.status] ?? STATUS_STYLES.pending}`}>
                        {appt.status}
                      </span>
                      <p className="text-sm font-medium text-gold">{formatCurrency(appt.total_amount)}</p>
                    </div>
                  </div>

                  {/* Action row — only when the owner has granted manage_appointments
                       AND there's an action available for this status. */}
                  {showActionsRow && (
                    <div className="flex gap-2 pt-1">
                      {action && (
                        <button type="button" disabled={savingId === appt.id}
                          onClick={() => handlePrimary(appt, action.next)}
                          className={cn("btn flex-1", action.variant, "btn-sm")}>
                          {action.label}
                        </button>
                      )}
                      {rejectable && (
                        <button type="button" disabled={savingId === appt.id}
                          onClick={() => setRejectModal({ appt, reason: "" })}
                          className="btn btn-danger btn-sm flex-1">
                          Reject
                        </button>
                      )}
                      {/* Take Payment standalone — only on active appointments
                          (completed unpaid case for after-the-fact collection).
                          Hidden once cancelled / no-show — those need refund,
                          not payment. */}
                      {isUnpaidWithBalance(appt) && !action && appt.status === "completed" && (
                        <button type="button" disabled={savingId === appt.id}
                          onClick={() => setPaymentModal(appt)}
                          className="btn btn-success btn-sm flex-1">
                          💳 Take Payment
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Reject Modal — same shape as the owner-side reject flow so the
          reason text propagates into both the owner notification and the
          customer's cancellation email. */}
      {rejectModal && (
        <>
          <div className="fixed inset-0 bg-black/70 z-[60]" onClick={() => !savingReject && setRejectModal(null)} />
          <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
            <div className="bg-surface border border-border rounded-2xl p-6 w-full max-w-md space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold text-white">Reject Appointment</h2>
                <button onClick={() => !savingReject && setRejectModal(null)} className="text-[#555] hover:text-white text-xl leading-none">✕</button>
              </div>
              <div className="bg-surface-raised rounded-xl p-3 text-sm text-[#555]">
                <span className="text-white font-medium">{rejectModal.appt.client_name}</span>
                {" · "}{rejectModal.appt.services?.name ?? "Service"}
                {" · "}{rejectModal.appt.time_slot}
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-gray-300">Reason (optional)</label>
                <textarea
                  value={rejectModal.reason}
                  onChange={e => setRejectModal(prev => prev ? { ...prev, reason: e.target.value } : null)}
                  rows={3}
                  placeholder="e.g. Running late, unavailable, customer no-call…"
                  className="w-full bg-surface-raised border border-border rounded-xl px-4 py-2.5 text-sm text-white placeholder:text-[#777] focus:outline-none focus:border-gold/50 resize-none"
                />
              </div>
              {rejectModal.appt.client_email ? (
                <p className="text-xs text-[#777] bg-surface-raised rounded-xl px-3 py-2">
                  A cancellation email will be sent to {rejectModal.appt.client_email} with this reason. The shop owner is also notified.
                </p>
              ) : (
                <p className="text-xs text-[#777] bg-surface-raised rounded-xl px-3 py-2">
                  No email on file for this customer. Shop owner will be notified.
                </p>
              )}
              <div className="flex gap-3">
                <button type="button" className="btn btn-outline-secondary flex-1" disabled={savingReject} onClick={() => setRejectModal(null)}>Back</button>
                <button type="button" className="btn btn-danger flex-1" disabled={savingReject} onClick={submitReject}>
                  {savingReject ? "Rejecting…" : "Reject & Notify"}
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Payment Modal — mirror of the owner-side flow. */}
      {paymentModal && (
        <>
          <div className="fixed inset-0 bg-black/70 z-[60]" onClick={() => savingPayment === "" && setPaymentModal(null)} />
          <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
            <div className="bg-surface border border-border rounded-2xl p-6 w-full max-w-md space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold text-white">Take Payment</h2>
                <button onClick={() => savingPayment === "" && setPaymentModal(null)} className="text-[#555] hover:text-white text-xl leading-none">✕</button>
              </div>
              <div className="bg-surface-raised rounded-xl p-3 text-sm space-y-1">
                <div className="flex justify-between"><span className="text-[#777]">Client</span><span className="text-white">{paymentModal.client_name}</span></div>
                <div className="flex justify-between"><span className="text-[#777]">Service</span><span className="text-white">{paymentModal.services?.name ?? "—"}</span></div>
                <div className="flex justify-between"><span className="text-[#777]">Amount due</span><span className="text-gold font-bold">{formatCurrency(paymentModal.total_amount)}</span></div>
              </div>
              <div className="space-y-2">
                <button type="button" className="btn btn-success w-full" disabled={savingPayment !== ""} onClick={() => markCashPaid(true)}>
                  {savingPayment === "cash" ? "Saving…" : "💵 Cash · Paid in shop"}
                </button>
                <button type="button" className="btn btn-primary w-full" disabled={savingPayment !== "" || !paymentModal.client_email} onClick={() => sendPaymentLink(true)}>
                  {savingPayment === "link" ? "Sending…" : "📧 Send online payment link"}
                </button>
                {!paymentModal.client_email && (
                  <p className="text-xs text-[#777] text-center -mt-1">Customer has no email — can&apos;t send link</p>
                )}
                <button type="button" className="btn btn-outline-secondary w-full" disabled={savingPayment !== ""} onClick={skipPaymentAndComplete}>
                  {savingPayment === "skip" ? "Completing…" : "Skip · Complete unpaid"}
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
