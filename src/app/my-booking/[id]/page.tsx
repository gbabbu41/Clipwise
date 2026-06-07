"use client";
import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { Check, X, Calendar, Clock, User, Scissors, MapPin, Phone, ArrowLeft, RefreshCw } from "lucide-react";
import { Logo } from "@/components/ui/logo";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/lib/supabase";
import { cn, formatCurrency, formatDateForDb, getSlotsInRange } from "@/lib/utils";

interface AppointmentDetail {
  id: string;
  client_name: string;
  client_email: string;
  client_phone: string;
  date: string;
  time_slot: string;
  status: string;
  total_amount: number;
  notes?: string | null;
  shop_id: string;
  barber_id: string | null;
  service_id: string | null;
  barbers?: { id: string; name: string } | null;
  services?: { id: string; name: string; price: number; duration_minutes: number } | null;
  shops?: { id: string; name: string; slug: string; address: string; city: string; province: string; phone: string } | null;
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

  useEffect(() => {
    if (!id) { setNotFound(true); setLoading(false); return; }
    (async () => {
      const { data } = await supabase
        .from("appointments")
        .select("*, barbers(id, name), services(id, name, price, duration_minutes), shops(id, name, slug, address, city, province, phone)")
        .eq("id", id)
        .single();
      if (!data) { setNotFound(true); setLoading(false); return; }
      setAppt(data as unknown as AppointmentDetail);
      setLoading(false);
    })();
  }, [id]);

  const loadSlots = async (date: Date) => {
    if (!appt?.barber_id) return;
    setSlotsLoading(true);
    setSlots([]);
    setNewTime(null);
    const dateStr = formatDateForDb(date);
    const dow = date.getDay();
    const [{ data: ts }, { data: booked }] = await Promise.all([
      supabase.from("time_slots").select("*").eq("barber_id", appt.barber_id).eq("day_of_week", dow).eq("is_available", true).single(),
      supabase.from("appointments").select("time_slot").eq("barber_id", appt.barber_id).eq("date", dateStr).in("status", ["pending", "confirmed"]),
    ]);
    if (!ts) { setSlotsLoading(false); return; }
    const bookedSlots = (booked ?? []).map((a: { time_slot: string }) => a.time_slot).filter(s => s !== appt.time_slot);
    const rows = getSlotsInRange(ts.start_time, ts.end_time, date, bookedSlots);
    setSlots(rows);
    setSlotsLoading(false);
  };

  const cancelBooking = async () => {
    if (!appt) return;
    setCancelling(true);
    await supabase.from("appointments").update({ status: "cancelled" }).eq("id", appt.id);
    setAppt(prev => prev ? { ...prev, status: "cancelled" } : prev);
    setShowCancelConfirm(false);
    setView("cancelled");
    setCancelling(false);

    // Notify the assigned barber their slot is free again (fire-and-forget).
    fetch("/api/appointments/notify-cancellation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ appointment_id: appt.id, statusLabel: "Cancelled" }),
    }).catch(() => null);

    // Smart waitlist: ping anyone waiting for this now-free day.
    fetch("/api/waitlist/slot-opened", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ appointment_id: appt.id }),
    }).catch(() => null);

    // Notify shop owner
    if (appt.shops) {
      const { data: shopRow } = await supabase.from("shops").select("owner_id").eq("id", appt.shop_id).single();
      if (shopRow?.owner_id) {
        supabase.from("notifications").insert({
          user_id: shopRow.owner_id,
          title: "Appointment Cancelled",
          message: `${appt.client_name} cancelled their appointment on ${appt.date} at ${appt.time_slot}`,
          type: "cancellation",
          is_read: false,
        }).then(null, () => null);
      }
    }
  };

  const reschedule = async () => {
    if (!appt || !newDate || !newTime) return;
    setRescheduling(true);
    const newDateStr = formatDateForDb(newDate);
    await supabase.from("appointments").update({ date: newDateStr, time_slot: newTime, status: "pending" }).eq("id", appt.id);
    setAppt(prev => prev ? { ...prev, date: newDateStr, time_slot: newTime, status: "pending" } : prev);
    setView("detail");
    setNewDate(null);
    setNewTime(null);
    setSlots([]);
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
          <p className="text-[#555] text-sm">This booking link is invalid or has expired.</p>
        </div>
      </div>
    );
  }

  const status = STATUS_STYLES[appt.status] ?? { label: appt.status, variant: "info" as const };
  const isCancellable = ["pending", "confirmed"].includes(appt.status);
  const isReschedulable = ["pending", "confirmed"].includes(appt.status);
  const isUpcoming = appt.date >= formatDateForDb(new Date());
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
            <p className="text-[#555]">Your appointment on {appt.date} at {appt.time_slot} has been cancelled.</p>
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
              <p className="text-[#555] text-sm mt-1">Booking for {appt.client_name}</p>
              <div className="flex justify-center mt-3">
                <Badge variant={status.variant}>{status.label}</Badge>
              </div>
            </div>

            {/* Details card */}
            <div className="bg-surface border border-border rounded-2xl p-6 space-y-4">
              <p className="text-xs text-[#777] uppercase tracking-wider font-medium">Appointment Details</p>
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-xl bg-gold/10 flex items-center justify-center flex-shrink-0">
                    <Calendar size={15} className="text-gold" />
                  </div>
                  <div>
                    <p className="text-xs text-[#777]">Date</p>
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
                    <p className="text-xs text-[#777]">Time</p>
                    <p className="text-sm font-semibold text-white">{appt.time_slot}</p>
                  </div>
                </div>
                {appt.barbers && (
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-xl bg-gold/10 flex items-center justify-center flex-shrink-0">
                      <User size={15} className="text-gold" />
                    </div>
                    <div>
                      <p className="text-xs text-[#777]">Barber</p>
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
                      <p className="text-xs text-[#777]">Service</p>
                      <p className="text-sm font-semibold text-white">{appt.services.name}</p>
                    </div>
                  </div>
                )}
                <div className="pt-3 border-t border-border flex justify-between">
                  <span className="text-sm text-[#555]">Total</span>
                  <span className="text-gold font-bold">{formatCurrency(appt.total_amount)}</span>
                </div>
              </div>
            </div>

            {/* Shop info */}
            {appt.shops && (
              <div className="bg-surface border border-border rounded-2xl p-4 space-y-2">
                <p className="text-xs text-[#777] uppercase tracking-wider font-medium">Shop Info</p>
                <div className="flex items-center gap-2 text-sm text-[#555]">
                  <MapPin size={13} className="text-gold flex-shrink-0" />
                  {appt.shops.address}, {appt.shops.city}, {appt.shops.province}
                </div>
                <div className="flex items-center gap-2 text-sm text-[#555]">
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

            {/* Actions */}
            {isUpcoming && isReschedulable && (
              <Button variant="outline" className="w-full" onClick={() => setView("reschedule")}>
                <RefreshCw size={15} /> Reschedule Appointment
              </Button>
            )}

            {isUpcoming && isCancellable && (
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
                    <p className="text-xs text-[#555]">This cannot be undone. You&apos;ll need to rebook if you change your mind.</p>
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
              <button onClick={() => { setView("detail"); setNewDate(null); setSlots([]); setNewTime(null); }}
                className="w-10 h-10 rounded-xl bg-surface border border-border flex items-center justify-center text-[#555] hover:text-white transition-colors">
                <ArrowLeft size={18} />
              </button>
              <h2 className="text-xl font-bold text-white">Reschedule</h2>
            </div>

            <div className="bg-surface border border-border rounded-2xl p-4">
              <p className="text-xs text-[#777] mb-3 uppercase tracking-wider font-medium">Current Appointment</p>
              <p className="text-sm text-white">{appt.date} at {appt.time_slot}</p>
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
                        isSelected ? "border-gold bg-gold/15 text-gold" : "border-border text-[#555] hover:border-gold/30 hover:text-white"
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
                  <p className="text-sm text-[#777] text-center py-4">No available slots for this date.</p>
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
