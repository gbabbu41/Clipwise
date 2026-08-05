"use client";
import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { X, Calendar, Clock, User, Scissors, MapPin, Phone, ArrowLeft, RefreshCw } from "lucide-react";
import { Logo } from "@/components/ui/logo";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn, formatCurrency, formatDateForDb, prettyDate } from "@/lib/utils";
import { hoursUntilBooking } from "@/lib/timezone";

// Customer "manage my booking" screen. appointments RLS is stakeholder-only, so
// the anon browser client can't read the row — everything here goes through the
// service-role /api/my-booking/[id] route (keyed by the unguessable booking
// UUID in the confirmation email/SMS), which returns display-only fields.
interface AppointmentDetail {
  id: string;
  client_name: string;
  date: string;
  time_slot: string;
  status: string;
  total_amount: number;
  shop_id: string;
  barber_id: string | null;
  barbers?: { id: string; name: string } | null;
  services?: { id: string; name: string; price: number; duration_minutes: number } | null;
  shops?: {
    id: string; name: string; slug: string; address: string; city: string; province: string; phone: string;
    timezone?: string | null;
    booking_settings?: { cancellation_hours?: number } | null;
  } | null;
}

interface SlotRow { slot: string; available: boolean }

const STATUS_STYLES: Record<string, { label: string; variant: "success" | "warning" | "danger" | "info" | "gold" }> = {
  pending: { label: "Pending Confirmation", variant: "warning" },
  confirmed: { label: "Confirmed", variant: "success" },
  completed: { label: "Completed", variant: "info" },
  cancelled: { label: "Cancelled", variant: "danger" },
  "no-show": { label: "No Show", variant: "danger" },
};

export default function MyBookingPage() {
  const params = useParams();
  const id = params?.id as string;

  const [loading, setLoading] = useState(true);
  const [appt, setAppt] = useState<AppointmentDetail | null>(null);
  const [notFound, setNotFound] = useState(false);

  const [view, setView] = useState<"detail" | "reschedule" | "cancelled">("detail");
  const [cancelling, setCancelling] = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);

  // Reschedule state
  const [newDate, setNewDate] = useState<Date | null>(null);
  const [slots, setSlots] = useState<SlotRow[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [newTime, setNewTime] = useState<string | null>(null);
  const [rescheduling, setRescheduling] = useState(false);
  const [rescheduleError, setRescheduleError] = useState("");

  useEffect(() => {
    if (!id) { setNotFound(true); setLoading(false); return; }
    (async () => {
      try {
        const res = await fetch(`/api/my-booking/${id}`, { cache: "no-store" });
        if (!res.ok) { setNotFound(true); setLoading(false); return; }
        const { booking } = await res.json();
        if (!booking) { setNotFound(true); setLoading(false); return; }
        setAppt(booking as AppointmentDetail);
      } catch {
        setNotFound(true);
      }
      setLoading(false);
    })();
  }, [id]);

  const loadSlots = async (date: Date) => {
    if (!appt) return;
    setSlotsLoading(true);
    setSlots([]);
    setNewTime(null);
    setRescheduleError("");
    try {
      const res = await fetch(`/api/my-booking/${appt.id}?slots=${formatDateForDb(date)}`);
      const { slots: rows } = res.ok ? await res.json() : { slots: [] };
      setSlots(rows ?? []);
    } catch {
      setSlots([]);
    }
    setSlotsLoading(false);
  };

  const cancelBooking = async () => {
    if (!appt) return;
    setCancelling(true);
    try {
      const res = await fetch(`/api/my-booking/${appt.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cancel" }),
      });
      if (res.ok) {
        setAppt(prev => prev ? { ...prev, status: "cancelled" } : prev);
        setShowCancelConfirm(false);
        setView("cancelled");
      }
    } catch { /* keep the confirm dialog open on failure */ }
    setCancelling(false);
  };

  const reschedule = async () => {
    if (!appt || !newDate || !newTime) return;
    setRescheduling(true);
    const newDateStr = formatDateForDb(newDate);
    try {
      const res = await fetch(`/api/my-booking/${appt.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reschedule", date: newDateStr, time_slot: newTime }),
      });
      if (res.ok) {
        setAppt(prev => prev ? { ...prev, date: newDateStr, time_slot: newTime, status: "pending" } : prev);
        setView("detail");
        setNewDate(null);
        setNewTime(null);
        setSlots([]);
      } else {
        const { error } = await res.json().catch(() => ({ error: "" }));
        setRescheduleError(error || "That time is no longer available — please pick another.");
      }
    } catch {
      setRescheduleError("Something went wrong — please try again.");
    }
    setRescheduling(false);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-gold/30 border-t-gold rounded-full animate-spin" />
      </div>
    );
  }

  if (notFound || !appt) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center px-4 text-center">
        <Logo size="md" className="justify-center mb-8" />
        <div className="bg-surface border border-border rounded-2xl p-8 max-w-sm">
          <Scissors size={40} className="text-[#999] mx-auto mb-4" />
          <h1 className="text-xl font-bold text-white mb-2">Booking Not Found</h1>
          <p className="text-[#6e6e6e] text-sm">This booking link is invalid or has expired.</p>
        </div>
      </div>
    );
  }

  const status = STATUS_STYLES[appt.status] ?? { label: appt.status, variant: "info" as const };
  const isCancellable = ["pending", "confirmed"].includes(appt.status);
  const isReschedulable = ["pending", "confirmed"].includes(appt.status);
  const isUpcoming = appt.date >= formatDateForDb(new Date());
  // Cancellation-notice policy (shop's booking_settings.cancellation_hours). The
  // server is authoritative (it 403s a late cancel/reschedule), but we mirror it
  // here so we don't offer a "Yes, Cancel" button that will just fail — instead we
  // show the policy and point the customer to the shop. Judged in the shop's tz.
  const cancelHours = Number(appt.shops?.booking_settings?.cancellation_hours ?? 0);
  const hrsUntil = hoursUntilBooking(appt.date, appt.time_slot, appt.shops?.timezone ?? null);
  const withinNoticeWindow = cancelHours > 0 && hrsUntil < cancelHours;
  const noticeLabel = cancelHours % 24 === 0 ? `${cancelHours / 24} day${cancelHours / 24 === 1 ? "" : "s"}` : `${cancelHours} hour${cancelHours === 1 ? "" : "s"}`;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const calendarDays = Array.from({ length: 28 }, (_, i) => { const d = new Date(today); d.setDate(today.getDate() + i + 1); return d; });

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-lg mx-auto px-4 py-8">
        <Logo size="md" className="justify-center mb-8" />

        {view === "cancelled" && (
          <div className="text-center space-y-4">
            <div className="w-16 h-16 bg-red-500/20 rounded-full flex items-center justify-center mx-auto">
              <X size={28} className="text-red-400" />
            </div>
            <h1 className="text-xl font-bold text-white">Appointment Cancelled</h1>
            <p className="text-[#6e6e6e]">Your appointment on {prettyDate(appt.date)} at {appt.time_slot} has been cancelled.</p>
            <a href={`/book/${appt.shops?.slug ?? ""}`}>
              <Button className="w-full mt-4">Book a New Appointment</Button>
            </a>
          </div>
        )}

        {view === "detail" && (
          <div className="space-y-6">
            {/* Header */}
            <div className="text-center">
              <div className="w-16 h-16 rounded-2xl bg-gold/15 border border-gold/30 flex items-center justify-center mx-auto mb-4">
                <Scissors size={28} className="text-gold" />
              </div>
              <h1 className="text-xl font-bold text-white">{appt.shops?.name}</h1>
              <p className="text-[#6e6e6e] text-sm mt-1">Booking for {appt.client_name}</p>
              <div className="flex justify-center mt-3">
                <Badge variant={status.variant}>{status.label}</Badge>
              </div>
            </div>

            {/* Details card */}
            <div className="bg-surface border border-border rounded-2xl p-6 space-y-4">
              <p className="text-xs text-[#8f8f8f] uppercase tracking-wider font-medium">Appointment Details</p>
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-xl bg-gold/10 flex items-center justify-center flex-shrink-0">
                    <Calendar size={15} className="text-gold" />
                  </div>
                  <div>
                    <p className="text-xs text-[#8f8f8f]">Date</p>
                    <p className="text-sm font-semibold text-white">
                      {new Date(appt.date + "T12:00:00").toLocaleDateString("en-CA", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-xl bg-gold/10 flex items-center justify-center flex-shrink-0">
                    <Clock size={15} className="text-gold" />
                  </div>
                  <div>
                    <p className="text-xs text-[#8f8f8f]">Time</p>
                    <p className="text-sm font-semibold text-white">{appt.time_slot}</p>
                  </div>
                </div>
                {appt.barbers && (
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-xl bg-gold/10 flex items-center justify-center flex-shrink-0">
                      <User size={15} className="text-gold" />
                    </div>
                    <div>
                      <p className="text-xs text-[#8f8f8f]">Barber</p>
                      <p className="text-sm font-semibold text-white">{appt.barbers.name}</p>
                    </div>
                  </div>
                )}
                {appt.services && (
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-xl bg-gold/10 flex items-center justify-center flex-shrink-0">
                      <Scissors size={15} className="text-gold" />
                    </div>
                    <div>
                      <p className="text-xs text-[#8f8f8f]">Service</p>
                      <p className="text-sm font-semibold text-white">{appt.services.name}</p>
                    </div>
                  </div>
                )}
                <div className="pt-3 border-t border-border flex justify-between">
                  <span className="text-sm text-[#6e6e6e]">Total</span>
                  <span className="text-gold font-bold">{formatCurrency(appt.total_amount)}</span>
                </div>
              </div>
            </div>

            {/* Shop info */}
            {appt.shops && (
              <div className="bg-surface border border-border rounded-2xl p-4 space-y-2">
                <p className="text-xs text-[#8f8f8f] uppercase tracking-wider font-medium">Shop Info</p>
                <div className="flex items-center gap-2 text-sm text-[#6e6e6e]">
                  <MapPin size={13} className="text-gold flex-shrink-0" />
                  {appt.shops.address}, {appt.shops.city}, {appt.shops.province}
                </div>
                <div className="flex items-center gap-2 text-sm text-[#6e6e6e]">
                  <Phone size={13} className="text-gold flex-shrink-0" />
                  {appt.shops.phone}
                </div>
              </div>
            )}

            {/* Add to calendar */}
            {isUpcoming && isCancellable && (
              <Button
                variant="outline"
                className="w-full"
                onClick={() => {
                  if (!appt.services) return;
                  const [time, period] = appt.time_slot.split(" ");
                  const [hStr, mStr] = time.split(":");
                  let h = parseInt(hStr, 10);
                  const m = parseInt(mStr || "0", 10);
                  if (period === "PM" && h !== 12) h += 12;
                  if (period === "AM" && h === 12) h = 0;
                  const start = new Date(appt.date + "T12:00:00");
                  start.setHours(h, m, 0, 0);
                  const end = new Date(start.getTime() + (appt.services?.duration_minutes ?? 60) * 60000);
                  const fmt = (d: Date) => d.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
                  const url = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(`Haircut at ${appt.shops?.name ?? ""}`)}&dates=${fmt(start)}/${fmt(end)}&details=${encodeURIComponent(`Booking ID: ${appt.id.slice(0, 8).toUpperCase()}`)}&location=${encodeURIComponent(`${appt.shops?.address ?? ""}, ${appt.shops?.city ?? ""}`)}`;
                  window.open(url, "_blank");
                }}
              >
                <Calendar size={15} /> Add to Google Calendar
              </Button>
            )}

            {/* Actions — hidden inside the shop's cancellation-notice window, since
                a self-serve cancel/reschedule that late would be rejected anyway. */}
            {isUpcoming && isReschedulable && !withinNoticeWindow && (
              <Button variant="outline" className="w-full" onClick={() => { setRescheduleError(""); setView("reschedule"); }}>
                <RefreshCw size={15} /> Reschedule Appointment
              </Button>
            )}

            {isUpcoming && isCancellable && !withinNoticeWindow && (
              <>
                {!showCancelConfirm ? (
                  <button
                    onClick={() => setShowCancelConfirm(true)}
                    className="w-full text-sm text-red-400/70 hover:text-red-400 py-2 transition-colors"
                  >
                    Cancel Appointment
                  </button>
                ) : (
                  <div className="bg-red-500/10 border border-red-500/20 rounded-2xl p-4 space-y-3">
                    <p className="text-sm font-semibold text-red-400">Cancel this appointment?</p>
                    <p className="text-xs text-[#6e6e6e]">This cannot be undone. You&apos;ll need to rebook if you change your mind.</p>
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" className="flex-1" onClick={() => setShowCancelConfirm(false)}>Keep it</Button>
                      <Button variant="danger" size="sm" className="flex-1" disabled={cancelling} onClick={cancelBooking}>
                        {cancelling ? "Cancelling…" : "Yes, Cancel"}
                      </Button>
                    </div>
                  </div>
                )}
              </>
            )}

            {/* Inside the notice window: explain the policy instead of offering a
                cancel/reschedule that the server would reject. */}
            {isUpcoming && isCancellable && withinNoticeWindow && (
              <div className="bg-amber-500/10 border border-amber-500/20 rounded-2xl p-4 space-y-2">
                <p className="text-sm font-semibold text-amber-400">This appointment can no longer be changed online</p>
                <p className="text-xs text-[#8f8f8f]">
                  {appt.shops?.name ?? "This shop"} requires at least {noticeLabel} notice to cancel or reschedule.
                  To change this booking, please contact the shop directly.
                </p>
                {appt.shops?.phone && (
                  <a href={`tel:${appt.shops.phone}`} className="inline-flex items-center gap-2 text-sm font-medium text-gold hover:text-white transition-colors pt-1">
                    <Phone size={14} /> {appt.shops.phone}
                  </a>
                )}
              </div>
            )}

            <div className="text-center">
              <a href={`/book/${appt.shops?.slug ?? ""}`} className="text-sm text-gold hover:text-white transition-colors">
                Book another appointment →
              </a>
            </div>
          </div>
        )}

        {view === "reschedule" && (
          <div className="space-y-6">
            <div className="flex items-center gap-3">
              <button onClick={() => { setView("detail"); setNewDate(null); setSlots([]); setNewTime(null); setRescheduleError(""); }}
                className="w-10 h-10 rounded-xl bg-surface border border-border flex items-center justify-center text-[#6e6e6e] hover:text-white transition-colors">
                <ArrowLeft size={18} />
              </button>
              <h2 className="text-xl font-bold text-white">Reschedule</h2>
            </div>

            <div className="bg-surface border border-border rounded-2xl p-4">
              <p className="text-xs text-[#8f8f8f] mb-3 uppercase tracking-wider font-medium">Current Appointment</p>
              <p className="text-sm text-white">{prettyDate(appt.date)} at {appt.time_slot}</p>
            </div>

            {/* Date picker */}
            <div>
              <p className="text-sm font-medium text-gray-300 mb-3">Select a new date</p>
              <div className="grid grid-cols-4 gap-2">
                {calendarDays.slice(0, 16).map(d => {
                  const ds = formatDateForDb(d);
                  const isSelected = newDate && formatDateForDb(newDate) === ds;
                  return (
                    <button
                      key={ds}
                      onClick={() => { setNewDate(d); loadSlots(d); }}
                      className={cn(
                        "p-2 rounded-xl border text-center transition-all",
                        isSelected ? "border-gold bg-gold/15 text-gold" : "border-border text-[#6e6e6e] hover:border-gold/30 hover:text-white"
                      )}
                    >
                      <p className="text-xs">{d.toLocaleDateString("en-CA", { weekday: "short" })}</p>
                      <p className="text-sm font-bold">{d.getDate()}</p>
                      <p className="text-xs">{d.toLocaleDateString("en-CA", { month: "short" })}</p>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Time slots */}
            {newDate && (
              <div>
                <p className="text-sm font-medium text-gray-300 mb-3">Select a new time</p>
                {slotsLoading ? (
                  <div className="flex justify-center py-8">
                    <div className="w-6 h-6 border-2 border-gold/30 border-t-gold rounded-full animate-spin" />
                  </div>
                ) : slots.length === 0 ? (
                  <p className="text-sm text-[#8f8f8f] text-center py-4">No available slots for this date.</p>
                ) : (
                  <div className="grid grid-cols-3 gap-2">
                    {slots.filter(s => s.available).map(s => (
                      <button
                        key={s.slot}
                        onClick={() => setNewTime(s.slot)}
                        className={cn(
                          "py-2.5 rounded-xl border text-sm font-medium transition-all",
                          newTime === s.slot ? "border-gold bg-gold/15 text-gold" : "border-border text-gray-300 hover:border-gold/30"
                        )}
                      >
                        {s.slot}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {rescheduleError && (
              <p className="text-sm text-red-400 text-center">{rescheduleError}</p>
            )}

            <Button
              className="w-full"
              disabled={!newDate || !newTime || rescheduling}
              onClick={reschedule}
            >
              {rescheduling ? "Rescheduling…" : "Confirm New Time"}
            </Button>
          </div>
        )}

        <div className="mt-8 text-center">
          <p className="text-xs text-[#999]">
            Powered by <span className="text-gold font-semibold">ClipWise</span>
          </p>
        </div>
      </div>
    </div>
  );
}
