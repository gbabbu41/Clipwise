"use client";
import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import { ChevronLeft, ChevronRight, Star, Clock, MapPin, Phone, Check, Calendar, Share2, User, Tag } from "lucide-react";
import { Logo } from "@/components/ui/logo";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn, formatCurrency, formatDateForDb, isDateInPast, getSlotsInRange } from "@/lib/utils";
import { supabase } from "@/lib/supabase";
import type { Shop, Barber, Service, PromoCode } from "@/lib/database.types";

// ─── Types ────────────────────────────────────────────────────────────────────
interface SlotAvailability {
  slot: string;
  available: boolean;
  barberIds: string[];
}

interface Toast { msg: string; ok: boolean }

// ─── Toast Component ──────────────────────────────────────────────────────────
function ToastBar({ toast, onClose }: { toast: Toast; onClose: () => void }) {
  return (
    <div className={cn(
      "fixed bottom-24 right-4 z-[200] flex items-center gap-3 px-5 py-3 rounded-xl border shadow-xl text-sm font-medium animate-slide-up",
      toast.ok ? "bg-emerald-900/80 border-emerald-500/40 text-emerald-300" : "bg-red-900/80 border-red-500/40 text-red-300"
    )}>
      {toast.ok ? <Check size={15} /> : "✕"} {toast.msg}
      <button onClick={onClose} className="ml-2 opacity-60 hover:opacity-100">✕</button>
    </div>
  );
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────
function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse bg-surface-raised rounded-xl", className)} />;
}

export default function BookingPage() {
  const params = useParams();
  const shopslug = params?.shopslug as string;

  // ── Page-level state ───────────────────────────────────────────────────────
  const [pageLoading, setPageLoading] = useState(true);
  const [shop, setShop] = useState<Shop | null>(null);
  const [barbers, setBarbers] = useState<Barber[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [toast, setToast] = useState<Toast | null>(null);

  // ── Flow selection ─────────────────────────────────────────────────────────
  const [flow, setFlow] = useState<"time-first" | "barber-first">("time-first");

  // ── Shared step state ──────────────────────────────────────────────────────
  const [step, setStep] = useState(0);
  const [selectedBarber, setSelectedBarber] = useState<string | null>(null); // null = "Any"
  const [selectedService, setSelectedService] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [selectedTime, setSelectedTime] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState("All");
  const [clientInfo, setClientInfo] = useState({ name: "", email: "", phone: "" });
  const [promoCode, setPromoCode] = useState("");
  const [promoApplied, setPromoApplied] = useState<PromoCode | null>(null);
  const [promoError, setPromoError] = useState("");
  const [promoLoading, setPromoLoading] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [bookingId, setBookingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // ── Availability state ─────────────────────────────────────────────────────
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [slotGrid, setSlotGrid] = useState<SlotAvailability[]>([]);
  const [expandedSlot, setExpandedSlot] = useState<string | null>(null);
  const [barberWorkDays, setBarberWorkDays] = useState<Set<number>>(new Set());

  const showToast = (msg: string, ok = true) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 3500);
  };

  // ── Load shop + barbers + services ─────────────────────────────────────────
  useEffect(() => {
    if (!shopslug) return;
    (async () => {
      setPageLoading(true);
      const { data: shopData } = await supabase
        .from("shops")
        .select("*")
        .eq("slug", shopslug)
        .single();
      setShop(shopData as Shop | null);
      if (shopData && shopData.status === "approved") {
        const [{ data: b }, { data: s }] = await Promise.all([
          supabase.from("barbers").select("*").eq("shop_id", shopData.id).eq("is_active", true),
          supabase.from("services").select("*").eq("shop_id", shopData.id).eq("is_active", true),
        ]);
        setBarbers((b ?? []) as Barber[]);
        setServices((s ?? []) as Service[]);
      }
      setPageLoading(false);
    })();
  }, [shopslug]);

  // ── Load barber work days (for Option B calendar greying) ──────────────────
  useEffect(() => {
    if (flow !== "barber-first" || !selectedBarber) { setBarberWorkDays(new Set()); return; }
    (async () => {
      const { data } = await supabase
        .from("time_slots")
        .select("day_of_week")
        .eq("barber_id", selectedBarber)
        .eq("is_available", true);
      setBarberWorkDays(new Set((data ?? []).map((r: { day_of_week: number }) => r.day_of_week)));
    })();
  }, [selectedBarber, flow]);

  // ── Load slot grid (Option A — time first) ─────────────────────────────────
  const loadTimeFirstSlots = useCallback(async (date: Date) => {
    if (!shop) return;
    setSlotsLoading(true);
    setSlotGrid([]);
    setExpandedSlot(null);

    const dateStr = formatDateForDb(date);
    const dow = date.getDay();

    // Get all active barbers for this shop
    const barberList = barbers;
    if (barberList.length === 0) { setSlotsLoading(false); return; }

    // For each barber: get their schedule + bookings
    const slotMap: Record<string, { available: boolean; barberIds: string[] }> = {};

    await Promise.all(barberList.map(async (b) => {
      const [{ data: ts }, { data: booked }] = await Promise.all([
        supabase.from("time_slots").select("*").eq("barber_id", b.id).eq("day_of_week", dow).eq("is_available", true).single(),
        supabase.from("appointments").select("time_slot").eq("barber_id", b.id).eq("date", dateStr).in("status", ["pending", "confirmed"]),
      ]);
      if (!ts) return;
      const bookedSlots = (booked ?? []).map((a: { time_slot: string }) => a.time_slot);
      const slots = getSlotsInRange(ts.start_time, ts.end_time, date, bookedSlots);
      slots.forEach(({ slot, available }) => {
        if (!slotMap[slot]) slotMap[slot] = { available: false, barberIds: [] };
        if (available) {
          slotMap[slot].available = true;
          slotMap[slot].barberIds.push(b.id);
        }
      });
    }));

    setSlotGrid(
      Object.entries(slotMap)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([slot, v]) => ({ slot, ...v }))
    );
    setSlotsLoading(false);
  }, [shop, barbers]);

  // ── Load slot grid (Option B — barber first) ───────────────────────────────
  const loadBarberFirstSlots = useCallback(async (barberId: string, date: Date) => {
    if (!shop) return;
    setSlotsLoading(true);
    setSlotGrid([]);
    const dateStr = formatDateForDb(date);
    const dow = date.getDay();
    const [{ data: ts }, { data: booked }] = await Promise.all([
      supabase.from("time_slots").select("*").eq("barber_id", barberId).eq("day_of_week", dow).eq("is_available", true).single(),
      supabase.from("appointments").select("time_slot").eq("barber_id", barberId).eq("date", dateStr).in("status", ["pending", "confirmed"]),
    ]);
    if (!ts) { setSlotsLoading(false); return; }
    const bookedSlots = (booked ?? []).map((a: { time_slot: string }) => a.time_slot);
    const slots = getSlotsInRange(ts.start_time, ts.end_time, date, bookedSlots);
    setSlotGrid(slots.map(({ slot, available }) => ({ slot, available, barberIds: available ? [barberId] : [] })));
    setSlotsLoading(false);
  }, [shop]);

  // ── Trigger slot load when date changes ───────────────────────────────────
  useEffect(() => {
    if (!selectedDate) return;
    if (flow === "time-first") loadTimeFirstSlots(selectedDate);
    else if (flow === "barber-first" && selectedBarber) loadBarberFirstSlots(selectedBarber, selectedDate);
  }, [selectedDate, flow, selectedBarber, loadTimeFirstSlots, loadBarberFirstSlots]);

  // ── Apply promo code ───────────────────────────────────────────────────────
  const applyPromo = async () => {
    if (!promoCode.trim() || !shop) return;
    setPromoLoading(true);
    setPromoError("");
    const today = formatDateForDb(new Date());
    const { data } = await supabase
      .from("promo_codes")
      .select("*")
      .eq("code", promoCode.toUpperCase())
      .eq("shop_id", shop.id)
      .eq("is_active", true)
      .or(`expires_at.is.null,expires_at.gte.${today}`)
      .maybeSingle();
    if (data) { setPromoApplied(data as PromoCode); }
    else { setPromoError("Invalid or expired promo code."); setPromoApplied(null); }
    setPromoLoading(false);
  };

  // ── Confirm booking ────────────────────────────────────────────────────────
  const confirmBooking = async () => {
    if (!shop || !selectedService || !selectedDate || !selectedTime) return;
    if (isDateInPast(selectedDate)) { showToast("Please select a future date.", false); return; }
    setSaving(true);
    const service = services.find((s) => s.id === selectedService);
    const discount = promoApplied
      ? promoApplied.discount_type === "percent"
        ? (service?.price ?? 0) * promoApplied.discount_value / 100
        : promoApplied.discount_value
      : 0;
    const total = Math.max(0, (service?.price ?? 0) - discount);

    // If flow is time-first and no specific barber picked, pick first available
    let finalBarberId = selectedBarber;
    if (!finalBarberId || finalBarberId === "any") {
      const slot = slotGrid.find((s) => s.slot === selectedTime);
      finalBarberId = slot?.barberIds[0] ?? barbers[0]?.id ?? null;
    }

    const { data, error } = await supabase.from("appointments").insert({
      shop_id: shop.id,
      barber_id: finalBarberId,
      service_id: selectedService,
      client_name: clientInfo.name,
      client_email: clientInfo.email,
      client_phone: clientInfo.phone,
      date: formatDateForDb(selectedDate),
      time_slot: selectedTime,
      status: "pending",
      total_amount: total,
      deposit_paid: false,
    }).select("id").single();

    setSaving(false);
    if (error) { showToast("Failed to book. Please try again.", false); return; }
    setBookingId(data.id);
    setConfirmed(true);

    // Create in-app notification for shop owner (fire-and-forget)
    supabase.from("notifications").insert({
      user_id: shop.owner_id,
      title: "New Booking",
      message: `${clientInfo.name} booked ${service?.name ?? "a service"} on ${formatDateForDb(selectedDate!)} at ${selectedTime}`,
      type: "booking",
      is_read: false,
    }).then(null, () => null);

    // Send confirmation email (fire-and-forget)
    if (clientInfo.email) {
      fetch("/api/send-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "booking_confirmation",
          data: {
            clientName: clientInfo.name,
            clientEmail: clientInfo.email,
            shopName: shop.name,
            barberName: barber?.name ?? "Any Available",
            serviceName: service?.name ?? "",
            date: selectedDate ? formatDateForDb(selectedDate) : "",
            time: selectedTime ?? "",
            total: `$${total.toFixed(2)}`,
            bookingId: data.id.slice(0, 8).toUpperCase(),
          },
        }),
      }).catch(() => null);
    }
  };

  // ── Computed values ────────────────────────────────────────────────────────
  const service = services.find((s) => s.id === selectedService);
  const barber = barbers.find((b) => b.id === selectedBarber);
  const discount = promoApplied
    ? promoApplied.discount_type === "percent"
      ? (service?.price ?? 0) * promoApplied.discount_value / 100
      : promoApplied.discount_value
    : 0;
  const total = Math.max(0, (service?.price ?? 0) - discount);
  const categories = ["All", ...Array.from(new Set(services.map((s) => s.category)))];
  const filteredServices = services.filter((s) => s.is_active && (categoryFilter === "All" || s.category === categoryFilter));

  // Calendar: 21 days from today
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const calendarDays = Array.from({ length: 21 }, (_, i) => { const d = new Date(today); d.setDate(today.getDate() + i); return d; });

  // Steps
  const STEPS_TIME_FIRST = ["Service", "Date", "Time & Barber", "Your Info", "Promo", "Confirm"];
  const STEPS_BARBER_FIRST = ["Barber", "Service", "Date", "Time", "Your Info", "Promo", "Confirm"];
  const STEPS = flow === "time-first" ? STEPS_TIME_FIRST : STEPS_BARBER_FIRST;

  const canNext = () => {
    if (flow === "time-first") {
      if (step === 0) return !!selectedService;
      if (step === 1) return !!selectedDate;
      if (step === 2) return !!selectedTime;
      if (step === 3) return !!(clientInfo.name && clientInfo.email && clientInfo.phone);
      return true;
    } else {
      if (step === 0) return !!selectedBarber;
      if (step === 1) return !!selectedService;
      if (step === 2) return !!selectedDate;
      if (step === 3) return !!selectedTime;
      if (step === 4) return !!(clientInfo.name && clientInfo.email && clientInfo.phone);
      return true;
    }
  };

  const switchFlow = (f: "time-first" | "barber-first") => {
    setFlow(f);
    setStep(0);
    setSelectedBarber(null);
    setSelectedService(null);
    setSelectedDate(null);
    setSelectedTime(null);
    setSlotGrid([]);
  };

  // ── Loading screen ─────────────────────────────────────────────────────────
  if (pageLoading) {
    return (
      <div className="min-h-screen bg-background p-6 space-y-4 max-w-2xl mx-auto">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (!shop) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-4">
        <div className="text-center">
          <Logo size="md" />
          <h1 className="text-2xl font-bold text-white mt-6">Shop Not Found</h1>
          <p className="text-gray-500 mt-2">This booking link may be invalid.</p>
        </div>
      </div>
    );
  }

  if (shop.status !== "approved") {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-4">
        <div className="text-center max-w-sm">
          <div className="w-20 h-20 bg-gold/10 border border-gold/20 rounded-2xl flex items-center justify-center mx-auto mb-6">
            <Logo size="sm" showText={false} />
          </div>
          <h1 className="text-2xl font-bold text-white">{shop.name}</h1>
          <p className="text-gray-400 mt-3">This shop is coming soon. Check back later.</p>
          <Badge variant="warning" className="mt-4">Coming Soon</Badge>
        </div>
      </div>
    );
  }

  // ── Success screen ─────────────────────────────────────────────────────────
  if (confirmed) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center px-4">
        {toast && <ToastBar toast={toast} onClose={() => setToast(null)} />}
        <div className="max-w-md w-full text-center">
          <div className="w-20 h-20 bg-emerald-500/20 rounded-full flex items-center justify-center mx-auto mb-6">
            <Check size={36} className="text-emerald-400" />
          </div>
          <h1 className="text-2xl font-bold text-white mb-2">Booking Confirmed!</h1>
          {bookingId && <p className="text-xs text-gray-500 mb-1">Booking ID: <span className="text-gold font-mono">{bookingId.slice(0, 8).toUpperCase()}</span></p>}
          <p className="text-gray-400 mb-8">We&apos;ll send a confirmation to {clientInfo.email}</p>
          <div className="bg-surface border border-border rounded-2xl p-6 text-left space-y-3 mb-6">
            {[
              { label: "Shop", value: shop.name },
              { label: "Barber", value: barber?.name ?? "Any Available" },
              { label: "Service", value: service?.name ?? "" },
              { label: "Date", value: selectedDate?.toLocaleDateString("en-CA", { weekday: "short", month: "short", day: "numeric" }) ?? "" },
              { label: "Time", value: selectedTime ?? "" },
            ].map(({ label, value }) => (
              <div key={label} className="flex justify-between text-sm">
                <span className="text-gray-500">{label}</span>
                <span className="text-white font-medium">{value}</span>
              </div>
            ))}
            <div className="border-t border-border pt-3 flex justify-between font-bold">
              <span className="text-white">Total</span>
              <span className="text-gold text-lg">{formatCurrency(total)}</span>
            </div>
          </div>
          <div className="flex gap-3">
            <Button variant="outline" className="flex-1" onClick={() => {
              if (!selectedDate || !selectedTime || !service) return;
              const [time, period] = selectedTime.split(" ");
              const [hoursStr, minutesStr] = time.split(":");
              let hours = parseInt(hoursStr, 10);
              const minutes = parseInt(minutesStr || "0", 10);
              if (period === "PM" && hours !== 12) hours += 12;
              if (period === "AM" && hours === 12) hours = 0;
              const start = new Date(selectedDate);
              start.setHours(hours, minutes, 0, 0);
              const end = new Date(start.getTime() + (service.duration_minutes ?? 60) * 60000);
              const fmt = (d: Date) => d.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
              const url = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(`Haircut at ${shop.name}`)}&dates=${fmt(start)}/${fmt(end)}&details=${encodeURIComponent(`Service: ${service.name}\nBarber: ${barber?.name ?? "Any Available"}\nBooking ID: ${bookingId?.slice(0, 8).toUpperCase() ?? ""}`)}&location=${encodeURIComponent(`${shop.address ?? ""}, ${shop.city ?? ""}`)}`;
              window.open(url, "_blank");
            }}>
              <Calendar size={16} /> Add to Calendar
            </Button>
            <Button variant="outline" className="flex-1" onClick={() => { if (navigator.share) navigator.share({ title: `Booking at ${shop.name}`, text: `${shop.name} — ${selectedDate?.toLocaleDateString()} at ${selectedTime}`, url: window.location.href }); }}>
              <Share2 size={16} /> Share
            </Button>
          </div>
          <Button className="w-full mt-3" onClick={() => { setConfirmed(false); setStep(0); setSelectedBarber(null); setSelectedService(null); setSelectedDate(null); setSelectedTime(null); }}>
            Book Another Appointment
          </Button>
        </div>
      </div>
    );
  }

  // ── Step content ───────────────────────────────────────────────────────────
  const isTimeFirstStep = (s: number) => flow === "time-first" ? s : -1;
  const isBarberFirstStep = (s: number) => flow === "barber-first" ? s : -1;

  // Shared steps
  const serviceStepIndex = flow === "time-first" ? 0 : 1;
  const dateStepIndex = flow === "time-first" ? 1 : 2;

  const clientStepIndex = flow === "time-first" ? 3 : 4;
  const promoStepIndex = flow === "time-first" ? 4 : 5;
  const confirmStepIndex = flow === "time-first" ? 5 : 6;

  return (
    <div className="min-h-screen bg-background">
      {toast && <ToastBar toast={toast} onClose={() => setToast(null)} />}

      {/* Shop Header */}
      <div className="bg-surface border-b border-border">
        <div className="max-w-2xl mx-auto px-4 py-5">
          <div className="flex items-start gap-4">
            <div className="w-14 h-14 rounded-2xl bg-gold/20 border border-gold/30 flex items-center justify-center flex-shrink-0">
              <Logo size="sm" showText={false} />
            </div>
            <div className="flex-1">
              <h1 className="text-xl font-bold text-white">{shop.name}</h1>
              <div className="flex flex-wrap gap-3 mt-1 text-xs text-gray-500">
                <span className="flex items-center gap-1"><MapPin size={11} /> {shop.city}, {shop.province}</span>
                <span className="flex items-center gap-1"><Phone size={11} /> {shop.phone}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Flow Toggle */}
      <div className="bg-surface border-b border-border">
        <div className="max-w-2xl mx-auto px-4 py-3 flex gap-1">
          {(["time-first", "barber-first"] as const).map((f) => (
            <button
              key={f}
              onClick={() => switchFlow(f)}
              className={cn(
                "flex-1 py-2 px-3 rounded-xl text-xs font-semibold transition-all",
                flow === f ? "bg-gold text-black" : "text-gray-400 hover:text-white border border-border"
              )}
            >
              {f === "time-first" ? "Choose Time First" : "Choose Barber First"}
            </button>
          ))}
        </div>
      </div>

      {/* Progress */}
      <div className="bg-surface border-b border-border sticky top-0 z-10">
        <div className="max-w-2xl mx-auto px-4 py-3">
          <div className="flex items-center gap-1">
            {STEPS.map((s, i) => (
              <div key={s + i} className="flex items-center gap-1 flex-1">
                <div className={cn(
                  "flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-semibold transition-all",
                  i < step ? "bg-gold text-black" : i === step ? "bg-gold/20 text-gold border border-gold" : "bg-surface-raised text-gray-600"
                )}>
                  {i < step ? <Check size={11} /> : i + 1}
                </div>
                {i < STEPS.length - 1 && <div className={cn("flex-1 h-px", i < step ? "bg-gold" : "bg-border")} />}
              </div>
            ))}
          </div>
          <p className="text-xs text-gray-500 mt-1.5">Step {step + 1} of {STEPS.length}: <span className="text-gold font-medium">{STEPS[step]}</span></p>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-6 pb-28">

        {/* BARBER FIRST — Step 0: Select Barber */}
        {step === isBarberFirstStep(0) && (
          <div className="space-y-4 animate-fade-in">
            <h2 className="text-lg font-semibold text-white">Choose your barber</h2>
            <button
              onClick={() => setSelectedBarber("any")}
              className={cn("w-full flex items-center gap-4 p-4 rounded-2xl border text-left transition-all", selectedBarber === "any" ? "border-gold bg-gold/10" : "border-border bg-surface hover:border-gold/40")}
            >
              <div className="w-12 h-12 rounded-full bg-surface-raised border border-border flex items-center justify-center text-2xl">✨</div>
              <div>
                <p className="font-semibold text-white">No Preference</p>
                <p className="text-sm text-gray-500">Next available barber</p>
              </div>
              {selectedBarber === "any" && <Check size={18} className="ml-auto text-gold" />}
            </button>
            {barbers.map((b) => (
              <button key={b.id} onClick={() => setSelectedBarber(b.id)}
                className={cn("w-full flex items-center gap-4 p-4 rounded-2xl border text-left transition-all", selectedBarber === b.id ? "border-gold bg-gold/10" : "border-border bg-surface hover:border-gold/40")}
              >
                {b.photo
                  ? <img src={b.photo} alt={b.name} className="w-14 h-14 rounded-full object-cover border border-border" />
                  : <div className="w-14 h-14 rounded-full bg-gold/20 border border-gold/30 flex items-center justify-center text-gold font-bold text-xl">{b.name[0]}</div>
                }
                <div className="flex-1">
                  <p className="font-semibold text-white">{b.name}</p>
                  {b.bio && <p className="text-xs text-gray-500 mt-0.5 line-clamp-1">{b.bio}</p>}
                  <span className="flex items-center gap-1 text-xs text-gold mt-1">
                    <Star size={11} className="fill-gold" /> {b.rating} ({b.total_reviews} reviews)
                  </span>
                </div>
                {selectedBarber === b.id && <Check size={18} className="ml-auto flex-shrink-0 text-gold" />}
              </button>
            ))}
          </div>
        )}

        {/* Service Step */}
        {step === serviceStepIndex && (
          <div className="space-y-4 animate-fade-in">
            <h2 className="text-lg font-semibold text-white">Choose a service</h2>
            <div className="flex gap-2 flex-wrap">
              {categories.map((cat) => (
                <button key={cat} onClick={() => setCategoryFilter(cat)}
                  className={cn("px-4 py-1.5 rounded-full text-sm font-medium transition-all border", categoryFilter === cat ? "bg-gold text-black border-gold" : "border-border text-gray-400 hover:border-gold/40")}
                >{cat}</button>
              ))}
            </div>
            {filteredServices.length === 0 && (
              <div className="py-12 text-center text-gray-500">
                <Tag size={32} className="mx-auto mb-2 opacity-30" />
                <p>No services found</p>
              </div>
            )}
            <div className="space-y-3">
              {filteredServices.map((svc) => (
                <button key={svc.id} onClick={() => setSelectedService(svc.id)}
                  className={cn("w-full flex items-center justify-between p-4 rounded-2xl border text-left transition-all", selectedService === svc.id ? "border-gold bg-gold/10" : "border-border bg-surface hover:border-gold/40")}
                >
                  <div className="flex-1 pr-4">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-semibold text-white">{svc.name}</p>
                      <Badge>{svc.category}</Badge>
                    </div>
                    {svc.description && <p className="text-xs text-gray-500 mt-0.5">{svc.description}</p>}
                    <p className="text-xs text-gray-500 mt-1 flex items-center gap-1"><Clock size={11} /> {svc.duration_minutes} min</p>
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    <span className="text-lg font-bold text-gold">{formatCurrency(svc.price)}</span>
                    {selectedService === svc.id && <Check size={18} className="text-gold" />}
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Date Step */}
        {step === dateStepIndex && (
          <div className="space-y-6 animate-fade-in">
            <h2 className="text-lg font-semibold text-white">Pick a date</h2>
            <div className="flex gap-2 overflow-x-auto pb-2 snap-x">
              {calendarDays.map((day, i) => {
                const isPast = isDateInPast(day);
                const dow = day.getDay();
                const isBarberOff = flow === "barber-first" && selectedBarber && selectedBarber !== "any" && barberWorkDays.size > 0 && !barberWorkDays.has(dow);
                const disabled = isPast || !!isBarberOff;
                const isSelected = selectedDate?.toDateString() === day.toDateString();
                const isToday = day.toDateString() === today.toDateString();
                return (
                  <button key={i} onClick={() => !disabled && setSelectedDate(day)} disabled={disabled}
                    className={cn(
                      "flex-shrink-0 snap-start flex flex-col items-center px-3 py-2.5 rounded-xl border transition-all min-w-[56px]",
                      disabled ? "border-border bg-surface opacity-30 cursor-not-allowed" :
                      isSelected ? "border-gold bg-gold/10 text-gold" :
                      isToday ? "border-gold/40 bg-surface text-white" : "border-border bg-surface text-gray-400 hover:border-gold/40"
                    )}
                  >
                    <span className="text-xs">{day.toLocaleDateString("en-CA", { weekday: "short" })}</span>
                    <span className={cn("text-lg font-bold", isSelected ? "text-gold" : "text-white")}>{day.getDate()}</span>
                    <span className="text-xs">{day.toLocaleDateString("en-CA", { month: "short" })}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Time Step (Option A — smart grid with barber expand) */}
        {step === isTimeFirstStep(2) && (
          <div className="space-y-4 animate-fade-in">
            <h2 className="text-lg font-semibold text-white">
              Pick a time{selectedDate && ` — ${selectedDate.toLocaleDateString("en-CA", { weekday: "long", month: "short", day: "numeric" })}`}
            </h2>
            {slotsLoading && (
              <div className="grid grid-cols-3 gap-2">
                {Array.from({ length: 12 }).map((_, i) => <Skeleton key={i} className="h-12" />)}
              </div>
            )}
            {!slotsLoading && slotGrid.length === 0 && (
              <div className="py-12 text-center text-gray-500">
                <Clock size={32} className="mx-auto mb-2 opacity-30" />
                <p>No available slots for this date</p>
              </div>
            )}
            {!slotsLoading && slotGrid.length > 0 && (
              <div className="space-y-2">
                {slotGrid.map(({ slot, available, barberIds }) => {
                  const isSelected = selectedTime === slot;
                  const isExpanded = expandedSlot === slot;
                  const slotBarbers = barbers.filter((b) => barberIds.includes(b.id));
                  return (
                    <div key={slot}>
                      <button
                        onClick={() => {
                          if (!available) return;
                          if (barberIds.length === 1) {
                            setSelectedTime(slot);
                            setSelectedBarber(barberIds[0]);
                            setExpandedSlot(null);
                          } else {
                            setExpandedSlot(isExpanded ? null : slot);
                            if (isSelected) { setSelectedTime(null); setSelectedBarber(null); }
                          }
                        }}
                        disabled={!available}
                        className={cn(
                          "w-full flex items-center justify-between px-4 py-3 rounded-xl border text-sm font-medium transition-all",
                          !available ? "border-border text-gray-700 cursor-not-allowed line-through opacity-50" :
                          isSelected ? "border-gold bg-gold/10 text-gold" :
                          "border-border text-white hover:border-gold/40"
                        )}
                      >
                        <span>{slot}</span>
                        {available && (
                          <span className="text-xs text-gray-500 flex items-center gap-1">
                            <User size={11} /> {barberIds.length} available
                            {barberIds.length > 1 && <ChevronRight size={12} className={cn("transition-transform", isExpanded && "rotate-90")} />}
                          </span>
                        )}
                        {isSelected && <Check size={16} className="text-gold" />}
                      </button>
                      {isExpanded && slotBarbers.length > 0 && (
                        <div className="mt-1 ml-4 space-y-1 animate-fade-in">
                          {slotBarbers.map((b) => (
                            <button key={b.id}
                              onClick={() => { setSelectedTime(slot); setSelectedBarber(b.id); setExpandedSlot(null); }}
                              className={cn(
                                "w-full flex items-center gap-3 px-4 py-2.5 rounded-xl border text-left transition-all",
                                selectedBarber === b.id && selectedTime === slot ? "border-gold bg-gold/10" : "border-border bg-surface hover:border-gold/40"
                              )}
                            >
                              {b.photo
                                ? <img src={b.photo} alt={b.name} className="w-8 h-8 rounded-full object-cover" />
                                : <div className="w-8 h-8 rounded-full bg-gold/20 flex items-center justify-center text-gold text-sm font-bold">{b.name[0]}</div>
                              }
                              <div className="flex-1">
                                <p className="text-sm font-medium text-white">{b.name}</p>
                                <p className="text-xs text-gold flex items-center gap-0.5"><Star size={10} className="fill-gold" /> {b.rating}</p>
                              </div>
                              {selectedBarber === b.id && selectedTime === slot && <Check size={14} className="text-gold" />}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Time Step (Option B — barber first) */}
        {step === isBarberFirstStep(3) && (
          <div className="space-y-4 animate-fade-in">
            <h2 className="text-lg font-semibold text-white">
              Available times{selectedDate && ` — ${selectedDate.toLocaleDateString("en-CA", { weekday: "long", month: "short", day: "numeric" })}`}
            </h2>
            {slotsLoading && (
              <div className="grid grid-cols-3 gap-2">
                {Array.from({ length: 12 }).map((_, i) => <Skeleton key={i} className="h-12" />)}
              </div>
            )}
            {!slotsLoading && slotGrid.length === 0 && (
              <div className="py-12 text-center text-gray-500">
                <Clock size={32} className="mx-auto mb-2 opacity-30" />
                <p>No available slots for this date</p>
              </div>
            )}
            {!slotsLoading && (
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                {slotGrid.map(({ slot, available }) => (
                  <button key={slot} onClick={() => available && setSelectedTime(slot)} disabled={!available}
                    className={cn(
                      "py-2.5 px-3 rounded-xl border text-sm font-medium transition-all",
                      !available ? "border-border text-gray-700 cursor-not-allowed opacity-40" :
                      selectedTime === slot ? "border-gold bg-gold/10 text-gold" : "border-border text-white hover:border-gold/40"
                    )}
                  >{slot}</button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Client Info Step */}
        {step === clientStepIndex && (
          <div className="space-y-4 animate-fade-in">
            <h2 className="text-lg font-semibold text-white">Your information</h2>
            {([
              { key: "name" as const, label: "Full Name", placeholder: "Devon Williams", type: "text" },
              { key: "email" as const, label: "Email Address", placeholder: "devon@email.com", type: "email" },
              { key: "phone" as const, label: "Phone Number", placeholder: "(506) 555-0201", type: "tel" },
            ]).map(({ key, label, placeholder, type }) => (
              <div key={key} className="space-y-1.5">
                <label className="text-sm font-medium text-gray-300">{label}</label>
                <input type={type} value={clientInfo[key]} onChange={(e) => setClientInfo({ ...clientInfo, [key]: e.target.value })}
                  placeholder={placeholder}
                  className="w-full bg-surface-raised border border-border rounded-xl px-4 py-3 text-sm text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-gold/50 focus:border-gold/50 transition-all"
                />
              </div>
            ))}
            <p className="text-xs text-gray-600">You&apos;ll receive a confirmation to the details provided.</p>
          </div>
        )}

        {/* Promo Code Step */}
        {step === promoStepIndex && (
          <div className="space-y-4 animate-fade-in">
            <h2 className="text-lg font-semibold text-white">Have a promo code?</h2>
            <p className="text-gray-500 text-sm">Optional — skip if you don&apos;t have one.</p>
            <div className="flex gap-2">
              <input type="text" value={promoCode} onChange={(e) => setPromoCode(e.target.value.toUpperCase())} placeholder="e.g. WELCOME10"
                className="flex-1 bg-surface-raised border border-border rounded-xl px-4 py-2.5 text-sm text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-gold/50 uppercase tracking-widest"
              />
              <Button onClick={applyPromo} variant="outline" loading={promoLoading}>Apply</Button>
            </div>
            {promoError && <p className="text-xs text-red-400">{promoError}</p>}
            {promoApplied && (
              <div className="flex items-center gap-2 p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-xl">
                <Check size={16} className="text-emerald-400" />
                <span className="text-sm text-emerald-400 font-medium">
                  {promoApplied.code} applied! Save {promoApplied.discount_type === "percent" ? `${promoApplied.discount_value}%` : formatCurrency(promoApplied.discount_value)}
                </span>
              </div>
            )}
          </div>
        )}

        {/* Confirm Step */}
        {step === confirmStepIndex && (
          <div className="space-y-4 animate-fade-in">
            <h2 className="text-lg font-semibold text-white">Review your booking</h2>
            <div className="bg-surface border border-border rounded-2xl p-5 space-y-3">
              {[
                { label: "Shop", value: shop.name },
                { label: "Barber", value: barber?.name ?? "Any Available" },
                { label: "Service", value: service?.name ?? "" },
                { label: "Duration", value: `${service?.duration_minutes ?? 0} min` },
                { label: "Date", value: selectedDate?.toLocaleDateString("en-CA", { weekday: "long", month: "long", day: "numeric", year: "numeric" }) ?? "" },
                { label: "Time", value: selectedTime ?? "" },
                { label: "Name", value: clientInfo.name },
                { label: "Email", value: clientInfo.email },
                { label: "Phone", value: clientInfo.phone },
              ].map(({ label, value }) => (
                <div key={label} className="flex justify-between text-sm">
                  <span className="text-gray-500">{label}</span>
                  <span className="text-white font-medium text-right max-w-[60%]">{value}</span>
                </div>
              ))}
              <div className="border-t border-border pt-3 space-y-1.5">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Service Price</span>
                  <span className="text-white">{formatCurrency(service?.price ?? 0)}</span>
                </div>
                {promoApplied && (
                  <div className="flex justify-between text-sm">
                    <span className="text-emerald-400">Discount ({promoApplied.code})</span>
                    <span className="text-emerald-400">-{formatCurrency(discount)}</span>
                  </div>
                )}
                <div className="flex justify-between font-bold">
                  <span className="text-white">Total</span>
                  <span className="text-gold text-lg">{formatCurrency(total)}</span>
                </div>
              </div>
            </div>
            <p className="text-xs text-gray-600 text-center">Payment collected at the shop · Free cancellation 24h before</p>
          </div>
        )}
      </div>

      {/* Footer Nav */}
      <div className="fixed bottom-0 left-0 right-0 bg-surface border-t border-border px-4 py-3 z-20">
        <div className="max-w-2xl mx-auto flex gap-3">
          {step > 0 && (
            <Button variant="outline" onClick={() => setStep(step - 1)} className="flex-shrink-0">
              <ChevronLeft size={16} /> Back
            </Button>
          )}
          {step < STEPS.length - 1 ? (
            <Button className="flex-1" disabled={!canNext()} onClick={() => setStep(step + 1)}>
              Continue <ChevronRight size={16} />
            </Button>
          ) : (
            <Button className="flex-1" loading={saving} onClick={confirmBooking}>
              <Check size={16} /> Confirm Booking
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
