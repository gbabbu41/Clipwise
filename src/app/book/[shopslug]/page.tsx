"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight, Star, Clock, MapPin, Phone, Check, Calendar, Share2, User, Tag, X } from "lucide-react";
import { Logo } from "@/components/ui/logo";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn, formatCurrency, formatDateForDb, isDateInPast, getSlotsInRange, generate24hSlots } from "@/lib/utils";
import { formatPhone, validatePhone, validateEmail, isWithin6Months, isSlotInPast } from "@/lib/validation";
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
  const searchParams = useSearchParams();
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
  // Multi-service: customer can pick more than one (e.g. cut + beard, or
  // two haircuts for parent + child). They get booked back-to-back with the
  // same barber. selectedServices[0] is the legacy "primary" for code paths
  // that still need a single id (slot grid filter, etc.)
  const [selectedServices, setSelectedServices] = useState<string[]>([]);
  const selectedService = selectedServices[0] ?? null;
  const setSelectedService = (id: string | null) => {
    setSelectedServices(id ? [id] : []);
  };
  const toggleService = (id: string) => {
    setSelectedServices(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };
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
  const [clientErrors, setClientErrors] = useState<Record<string, string>>({});

  // ── Availability state ─────────────────────────────────────────────────────
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [slotGrid, setSlotGrid] = useState<SlotAvailability[]>([]);
  const [expandedSlot, setExpandedSlot] = useState<string | null>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const [barberWorkDays, setBarberWorkDays] = useState<Set<number>>(new Set());
  const [shopWorkDays, setShopWorkDays] = useState<Set<number>>(new Set());

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

  // ── Handle return from Stripe payment ──────────────────────────────────────
  useEffect(() => {
    if (!shop) return;
    if (searchParams.get("cancelled") === "1") {
      showToast("Payment cancelled — your booking was not created.", false);
      return;
    }
    if (searchParams.get("paid") === "1") {
      const sessionId = searchParams.get("session_id");
      if (!sessionId) return;
      (async () => {
        const res = await fetch("/api/stripe/booking-finalize", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ session_id: sessionId, shop_id: shop.id }),
        });
        const data = await res.json();
        if (res.ok && data.paid && data.appointmentId) {
          setBookingId(data.appointmentId);
          setConfirmed(true);
        } else {
          showToast("We couldn't confirm your payment. Contact the shop.", false);
        }
      })();
    }
  }, [shop, searchParams]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Load barber work days (for Option B calendar greying) ──────────────────
  const loadBarberWorkDays = useCallback(async () => {
    if (flow !== "barber-first" || !selectedBarber) { setBarberWorkDays(new Set()); return; }
    const { data } = await supabase
      .from("time_slots")
      .select("day_of_week")
      .eq("barber_id", selectedBarber)
      .eq("is_available", true);
    setBarberWorkDays(new Set((data ?? []).map((r: { day_of_week: number }) => r.day_of_week)));
  }, [selectedBarber, flow]);
  useEffect(() => { loadBarberWorkDays(); }, [loadBarberWorkDays]);

  // ── Load shop-wide work days (union of all barbers' schedules) ────────────
  // Used by Option A (time-first) calendar greying: a day where no barber
  // is scheduled at all is shown as disabled.
  const loadShopWorkDays = useCallback(async () => {
    if (barbers.length === 0) { setShopWorkDays(new Set()); return; }
    const { data } = await supabase
      .from("time_slots")
      .select("day_of_week")
      .in("barber_id", barbers.map(b => b.id))
      .eq("is_available", true);
    setShopWorkDays(new Set((data ?? []).map((r: { day_of_week: number }) => r.day_of_week)));
  }, [barbers]);
  useEffect(() => { loadShopWorkDays(); }, [loadShopWorkDays]);

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

  // Refs hold the latest selection so the realtime callback below always
  // sees the customer's *current* picks without having to re-subscribe every
  // time they change. Re-subscribing on every date/flow change was leaving
  // brief windows where realtime events could be missed.
  const selectedDateRef = useRef<Date | null>(null);
  const flowRef = useRef(flow);
  const selectedBarberRef = useRef<string | null>(null);
  useEffect(() => { selectedDateRef.current = selectedDate; }, [selectedDate]);
  useEffect(() => { flowRef.current = flow; }, [flow]);
  useEffect(() => { selectedBarberRef.current = selectedBarber; }, [selectedBarber]);

  // ── Real-time sync: refresh slot grid + work-day Sets whenever the owner
  //    edits a barber's schedule or a new appointment is booked elsewhere.
  useEffect(() => {
    if (!shop?.id) return;
    const refreshSlots = () => {
      const date = selectedDateRef.current;
      if (!date) return;
      if (flowRef.current === "time-first") loadTimeFirstSlots(date);
      else if (selectedBarberRef.current) loadBarberFirstSlots(selectedBarberRef.current, date);
    };
    const onTimeSlots = () => {
      // Schedule edits affect both the slot grid AND the calendar's day-greying.
      refreshSlots();
      loadBarberWorkDays();
      loadShopWorkDays();
    };
    const channel = supabase
      .channel(`book_slots:${shop.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "time_slots" }, onTimeSlots)
      .on("postgres_changes", { event: "*", schema: "public", table: "appointments", filter: `shop_id=eq.${shop.id}` }, refreshSlots)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [shop?.id, loadTimeFirstSlots, loadBarberFirstSlots, loadBarberWorkDays, loadShopWorkDays]);


  // ── Auto-scroll the When-step timeline to 9 AM on open ─────────────────────
  // The 0–24h timeline would otherwise open at midnight; landing at 9 AM gives
  // the customer the usual "morning" reference point regardless of when the
  // shop's first slot actually starts.
  useEffect(() => {
    if (slotGrid.length === 0) return;
    if (!timelineRef.current) return;
    const ROW_PX = 64;
    timelineRef.current.scrollTop = 9 * ROW_PX;
  }, [slotGrid]);

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
    if (!shop || selectedServices.length === 0 || !selectedDate || !selectedTime) return;
    if (isDateInPast(selectedDate)) { showToast("Please select a future date.", false); return; }
    if (!isWithin6Months(selectedDate)) { showToast("Cannot book more than 6 months in advance.", false); return; }
    // If the customer left the page open past the slot they picked, the slot
    // is no longer valid. Re-check at submit time.
    const bookingIsToday = formatDateForDb(selectedDate) === formatDateForDb(new Date());
    if (bookingIsToday && isSlotInPast(selectedTime)) {
      showToast("That time has just passed. Please pick a later slot.", false);
      return;
    }
    const clientErrs = validateClientInfo();
    if (Object.keys(clientErrs).length > 0) { setClientErrors(clientErrs); return; }
    setSaving(true);
    const service = services.find((s) => s.id === selectedService); // primary
    const discount = promoApplied
      ? promoApplied.discount_type === "percent"
        ? totalPrice * promoApplied.discount_value / 100
        : promoApplied.discount_value
      : 0;
    const total = Math.max(0, totalPrice - discount);

    // If flow is time-first and no specific barber picked, pick first available
    let finalBarberId = selectedBarber;
    if (!finalBarberId || finalBarberId === "any") {
      // For multi-service, find a barber that's free across the WHOLE block
      const startBlock = slotGridForBlock.find((s) => s.slot === selectedTime);
      finalBarberId = startBlock?.barberIds[0] ?? null;
      if (!finalBarberId) {
        const slot = slotGrid.find((s) => s.slot === selectedTime);
        finalBarberId = slot?.barberIds[0] ?? barbers[0]?.id ?? null;
      }
    }

    // If this service requires a deposit AND the shop accepts online payments,
    // route through Stripe Checkout. The appointment is created after payment.
    const depositAmount = service?.deposit_required ? (service.deposit_amount ?? 0) : 0;
    if (depositAmount > 0 && shop.stripe_connected) {
      try {
        const res = await fetch("/api/stripe/booking-checkout", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            shop_id: shop.id,
            shop_slug: shop.slug,
            barber_id: finalBarberId,
            service_id: selectedService,
            service_name: service?.name ?? "Service",
            client_name: clientInfo.name,
            client_email: clientInfo.email,
            client_phone: clientInfo.phone,
            date: formatDateForDb(selectedDate),
            time_slot: selectedTime,
            amount: depositAmount,
            total_amount: total,
          }),
        });
        const pay = await res.json();
        if (!res.ok || !pay.url) { showToast(pay.error ?? "Could not start payment.", false); setSaving(false); return; }
        window.location.href = pay.url; // redirect to Stripe Checkout
        return;
      } catch {
        showToast("Connection error. Please try again.", false);
        setSaving(false);
        return;
      }
    }

    // Multi-service: one appointment per service at back-to-back 30-min slots.
    // Discount applied only to the first row so the row totals sum to `total`.
    // Pre-assign UUIDs so the INSERT can use Prefer: return=minimal — anon
    // customers don't match any SELECT policy on appointments, so RETURNING
    // would be rejected ("new row violates RLS").
    const allSlots = generate24hSlots();
    const startIdx = allSlots.indexOf(selectedTime);
    const rows = servicesPicked.map((svc, i) => {
      const slotsConsumedBefore = servicesPicked.slice(0, i)
        .reduce((sum, prev) => sum + Math.max(1, Math.ceil((prev.duration_minutes ?? 30) / 30)), 0);
      const slotIdx = startIdx + slotsConsumedBefore;
      const time_slot = allSlots[slotIdx] ?? selectedTime;
      const rowAmount = i === 0 ? Math.max(0, (svc.price ?? 0) - discount) : (svc.price ?? 0);
      return {
        id: crypto.randomUUID(),
        shop_id: shop.id,
        barber_id: finalBarberId,
        service_id: svc.id,
        client_name: clientInfo.name,
        client_email: clientInfo.email,
        client_phone: clientInfo.phone,
        date: formatDateForDb(selectedDate),
        time_slot,
        status: "pending",
        total_amount: rowAmount,
        deposit_paid: false,
        notes: servicesPicked.length > 1
          ? `Part of multi-service booking · ${servicesPicked.map(s => s.name).join(" + ")}`
          : null,
      };
    });

    const { error } = await supabase.from("appointments").insert(rows);

    setSaving(false);
    if (error) { showToast("Failed to book. Please try again.", false); return; }
    setBookingId(rows[0].id);
    setConfirmed(true);

    // Create in-app notification for shop owner (fire-and-forget)
    supabase.from("notifications").insert({
      user_id: shop.owner_id,
      title: "New Booking",
      message: `${clientInfo.name} booked ${service?.name ?? "a service"} on ${formatDateForDb(selectedDate!)} at ${selectedTime}`,
      type: "booking",
      is_read: false,
    }).then(null, () => null);

    const bookingData = {
      clientName: clientInfo.name,
      clientEmail: clientInfo.email || "—",
      clientPhone: clientInfo.phone || "—",
      shopName: shop.name,
      shopEmail: shop.email ?? "",
      shopSlug: shop.slug,
      barberName: barbers.find(b => b.id === finalBarberId)?.name ?? "Any Available",
      serviceName: service?.name ?? "—",
      date: selectedDate ? formatDateForDb(selectedDate) : "",
      time: selectedTime ?? "",
      total: `$${total.toFixed(2)}`,
      bookingId: rows[0].id.slice(0, 8).toUpperCase(),
      appointmentId: rows[0].id,
    };

    // Confirmation email to customer
    if (clientInfo.email) {
      fetch("/api/send-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "booking_confirmation", data: { ...bookingData, clientEmail: clientInfo.email } }),
      }).catch(() => null);
    }

    // Notification email to shop owner
    if (shop.email) {
      fetch("/api/send-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "new_booking_owner", data: { ...bookingData, ownerEmail: shop.email } }),
      }).catch(() => null);
    }

    // Notification email to assigned barber
    const assignedBarber = barbers.find(b => b.id === finalBarberId);
    if (assignedBarber?.email) {
      fetch("/api/send-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "new_booking_barber", data: { ...bookingData, barberEmail: assignedBarber.email, barberName: assignedBarber.name } }),
      }).catch(() => null);
    }
  };

  // ── Computed values ────────────────────────────────────────────────────────
  const service = services.find((s) => s.id === selectedService); // primary (back-compat)
  const servicesPicked = selectedServices.map(id => services.find(s => s.id === id)).filter(Boolean) as Service[];
  const totalPrice = servicesPicked.reduce((sum, s) => sum + (s.price ?? 0), 0);
  const totalDuration = servicesPicked.reduce((sum, s) => sum + (s.duration_minutes ?? 0), 0);
  const barber = barbers.find((b) => b.id === selectedBarber);
  const discount = promoApplied
    ? promoApplied.discount_type === "percent"
      ? totalPrice * promoApplied.discount_value / 100
      : promoApplied.discount_value
    : 0;
  const total = Math.max(0, totalPrice - discount);
  const categories = ["All", ...Array.from(new Set(services.map((s) => s.category)))];
  const filteredServices = services.filter((s) => s.is_active && (categoryFilter === "All" || s.category === categoryFilter));

  // Calendar: 6 months from today (was 21 days)
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const calendarDays = Array.from({ length: 180 }, (_, i) => { const d = new Date(today); d.setDate(today.getDate() + i); return d; })
    .filter(d => isWithin6Months(d));

  // Multi-service: each slot in slotGrid is 30 min. For multiple services
  // we need slotsNeeded consecutive 30-min slots, all available with at
  // least one common barber (time-first) or the picked barber (barber-first).
  const slotsNeeded = Math.max(1, Math.ceil((totalDuration || 30) / 30));
  const slotGridForBlock = slotGrid.filter((s, i) => {
    if (!s.available) return false;
    if (slotsNeeded === 1) return true;
    // For each of the next (slotsNeeded - 1) slots, require availability
    // AND for time-first, require at least one barber in common across the block
    let intersection = new Set(s.barberIds);
    for (let j = 1; j < slotsNeeded; j++) {
      const next = slotGrid[i + j];
      if (!next || !next.available) return false;
      intersection = new Set(Array.from(intersection).filter(id => next.barberIds.includes(id)));
      if (intersection.size === 0) return false;
    }
    return true;
  }).map(s => ({ ...s }));

  // Steps — Date + Time merged into one Apple-style "When" step.
  const STEPS_TIME_FIRST = ["Service", "When", "Your Info", "Promo", "Confirm"];
  const STEPS_BARBER_FIRST = ["Barber", "Service", "When", "Your Info", "Promo", "Confirm"];
  const STEPS = flow === "time-first" ? STEPS_TIME_FIRST : STEPS_BARBER_FIRST;

  const validateClientInfo = () => {
    const errs: Record<string, string> = {};
    if (!clientInfo.name.trim()) errs.name = "Name is required";
    const emailErr = validateEmail(clientInfo.email);
    if (emailErr) errs.email = emailErr;
    const phoneErr = validatePhone(clientInfo.phone);
    if (phoneErr) errs.phone = phoneErr;
    return errs;
  };

  const canNext = () => {
    if (flow === "time-first") {
      if (step === 0) return !!selectedService;
      if (step === 1) return !!selectedDate && isWithin6Months(selectedDate) && !!selectedTime;
      if (step === 2) return !!(clientInfo.name && clientInfo.email && clientInfo.phone) && Object.keys(validateClientInfo()).length === 0;
      return true;
    } else {
      if (step === 0) return !!selectedBarber;
      if (step === 1) return !!selectedService;
      if (step === 2) return !!selectedDate && isWithin6Months(selectedDate) && !!selectedTime;
      if (step === 3) return !!(clientInfo.name && clientInfo.email && clientInfo.phone) && Object.keys(validateClientInfo()).length === 0;
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
          <p className="text-gray-400 mb-2">We&apos;ll send a confirmation to {clientInfo.email}</p>
          {bookingId && <a href={`/my-booking/${bookingId}`} className="text-xs text-gold hover:text-white transition-colors mb-6 block">View & Manage Booking →</a>}
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
              const end = new Date(start.getTime() + (totalDuration || 60) * 60000);
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

  // Shared steps (Date + Time merged into one Apple-style "When" step)
  const serviceStepIndex = flow === "time-first" ? 0 : 1;
  const whenStepIndex = flow === "time-first" ? 1 : 2;
  const clientStepIndex = flow === "time-first" ? 2 : 3;
  const promoStepIndex = flow === "time-first" ? 3 : 4;
  const confirmStepIndex = flow === "time-first" ? 4 : 5;

  return (
    <div className="min-h-screen bg-background">
      {toast && <ToastBar toast={toast} onClose={() => setToast(null)} />}

      {/* Shop Header */}
      <div className="bg-surface border-b border-border">
        <div className="max-w-2xl mx-auto px-4 py-5">
          <div className="flex items-start gap-4">
            <div className="w-14 h-14 rounded-2xl bg-gold/20 border border-gold/30 flex items-center justify-center flex-shrink-0 overflow-hidden">
              {shop.logo
                ? <img src={shop.logo} alt={shop.name} className="w-full h-full object-cover" />
                : <Logo size="sm" showText={false} />}
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
            <h2 className="text-lg font-semibold text-white">Choose services</h2>
            <p className="text-xs text-gray-500 -mt-1">Pick one or more (e.g. cut + beard, or two haircuts for a family booking).</p>

            {/* Selected services summary — chips with remove + running total */}
            {servicesPicked.length > 0 && (
              <div className="bg-gold/5 border border-gold/20 rounded-2xl p-3 space-y-2">
                <div className="flex flex-wrap gap-2">
                  {servicesPicked.map((s, idx) => (
                    <span key={s.id + idx} className="inline-flex items-center gap-1.5 bg-gold/15 border border-gold/30 text-gold rounded-full pl-3 pr-1 py-1 text-xs font-medium">
                      {s.name} · {formatCurrency(s.price)}
                      <button onClick={() => setSelectedServices(prev => prev.filter((_, i) => i !== idx))}
                        className="ml-0.5 w-5 h-5 rounded-full bg-gold/20 hover:bg-gold/30 flex items-center justify-center" aria-label="Remove">
                        <X size={11} />
                      </button>
                    </span>
                  ))}
                </div>
                <div className="flex items-center justify-between text-sm pt-1 border-t border-gold/10">
                  <span className="text-gray-400">{servicesPicked.length} service{servicesPicked.length !== 1 ? "s" : ""} · {totalDuration} min</span>
                  <span className="text-gold font-bold">{formatCurrency(totalPrice)}</span>
                </div>
              </div>
            )}

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
              {filteredServices.map((svc) => {
                const count = selectedServices.filter(id => id === svc.id).length;
                const isPicked = count > 0;
                return (
                <div key={svc.id}
                  className={cn("w-full flex items-center justify-between p-4 rounded-2xl border text-left transition-all", isPicked ? "border-gold bg-gold/10" : "border-border bg-surface hover:border-gold/40")}
                >
                  <div className="flex-1 pr-4 cursor-pointer" onClick={() => toggleService(svc.id)}>
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-semibold text-white">{svc.name}</p>
                      <Badge>{svc.category}</Badge>
                      {count > 1 && <span className="text-xs text-gold">× {count}</span>}
                    </div>
                    {svc.description && <p className="text-xs text-gray-500 mt-0.5">{svc.description}</p>}
                    <p className="text-xs text-gray-500 mt-1 flex items-center gap-1"><Clock size={11} /> {svc.duration_minutes} min</p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className="text-lg font-bold text-gold">{formatCurrency(svc.price)}</span>
                    <button onClick={() => setSelectedServices(prev => [...prev, svc.id])}
                      className="w-8 h-8 rounded-full bg-gold text-black flex items-center justify-center font-bold hover:bg-gold/90 transition-colors" aria-label="Add service">
                      +
                    </button>
                  </div>
                </div>);
              })}
            </div>
          </div>
        )}

        {/* When Step — Apple-style: week strip + day timeline of available slots */}
        {step === whenStepIndex && (() => {
          // Compute the visible week from selectedDate (or today's week if none picked)
          const anchor = selectedDate ?? today;
          const weekStart = new Date(anchor);
          weekStart.setDate(anchor.getDate() - anchor.getDay());
          const weekDays = Array.from({ length: 7 }, (_, i) => {
            const d = new Date(weekStart); d.setDate(weekStart.getDate() + i); return d;
          });

          const formatHourLabel = (h: number) => {
            if (h === 0) return "12 AM";
            if (h === 12) return "Noon";
            if (h < 12) return `${h} AM`;
            return `${h - 12} PM`;
          };
          const parseHour = (slotStr: string) => {
            const [time, period] = slotStr.split(" ");
            const [h, m] = time.split(":").map(Number);
            let hour = h;
            if (period === "PM" && h !== 12) hour += 12;
            if (period === "AM" && h === 12) hour = 0;
            return hour + m / 60;
          };

          const ROW_PX = 64;
          const startHour = 0, endHour = 24;
          const hoursToShow = Array.from({ length: endHour - startHour + 1 }, (_, i) => startHour + i);

          const blockSlotSet = new Set(slotGridForBlock.map(s => s.slot));
          const todayStr = formatDateForDb(new Date());
          const dateStr = selectedDate ? formatDateForDb(selectedDate) : null;
          const isTodaySelected = dateStr === todayStr;
          const bookableSlots = slotGrid.filter(({ slot }) => {
            const past = isTodaySelected && isSlotInPast(slot);
            return !past && blockSlotSet.has(slot);
          });

          return (
            <div className="flex flex-col -mx-4 sm:mx-0 animate-fade-in" style={{ height: "calc(100vh - 280px)", minHeight: "500px" }}>
              {/* Header row: back / next week arrows (icon-only) */}
              <div className="flex items-center justify-between px-4 pb-2">
                <button
                  aria-label="Previous week"
                  onClick={() => { const d = new Date(weekStart); d.setDate(d.getDate() - 7); setSelectedDate(d); setSelectedTime(null); }}
                  className="w-9 h-9 rounded-full bg-surface-raised hover:bg-surface-raised/80 flex items-center justify-center text-white transition-colors"
                >
                  <ChevronLeft size={18} />
                </button>
                <button
                  aria-label="Next week"
                  onClick={() => { const d = new Date(weekStart); d.setDate(d.getDate() + 7); setSelectedDate(d); setSelectedTime(null); }}
                  className="w-9 h-9 rounded-full bg-surface-raised hover:bg-surface-raised/80 flex items-center justify-center text-white transition-colors"
                >
                  <ChevronRight size={18} />
                </button>
              </div>

              {/* Week strip */}
              <div className="grid grid-cols-7 px-2 pb-2">
                {weekDays.map((day) => {
                  const dayStr = formatDateForDb(day);
                  const isSelectedDay = dayStr === dateStr;
                  const isPast = isDateInPast(day);
                  const dow = day.getDay();
                  const isBarberOff = flow === "barber-first" && selectedBarber && selectedBarber !== "any" && barberWorkDays.size > 0 && !barberWorkDays.has(dow);
                  const isShopClosed = flow !== "barber-first" && shopWorkDays.size > 0 && !shopWorkDays.has(dow);
                  const disabled = isPast || !!isBarberOff || isShopClosed;
                  const isTodayDay = dayStr === todayStr;
                  return (
                    <button key={dayStr} disabled={disabled}
                      onClick={() => { if (!disabled) { setSelectedDate(day); setSelectedTime(null); } }}
                      className="flex flex-col items-center py-1.5 disabled:cursor-not-allowed"
                    >
                      <span className={cn("text-[10px] uppercase tracking-wider", disabled ? "text-gray-700" : "text-gray-400")}>
                        {day.toLocaleDateString("en-CA", { weekday: "narrow" })}
                      </span>
                      <span className={cn(
                        "text-base font-medium mt-1.5 w-9 h-9 rounded-full inline-flex items-center justify-center",
                        isSelectedDay ? "bg-white text-black font-semibold" :
                        isTodayDay && !disabled ? "text-gold" :
                        disabled ? "text-gray-700" : "text-white",
                      )}>
                        {day.getDate()}
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* Date title row (center) */}
              <div className="px-4 py-2 border-t border-border/40 text-center">
                <p className="text-sm font-medium text-white">
                  {selectedDate
                    ? selectedDate.toLocaleDateString("en-CA", { weekday: "long", month: "short", day: "numeric", year: "numeric" })
                    : "Pick a day"}
                </p>
              </div>

              {/* Timeline */}
              <div ref={timelineRef} className="flex-1 overflow-y-auto border-t border-border/40">
                {!selectedDate && (
                  <div className="py-16 text-center text-gray-500 text-sm">Tap a day above to see openings.</div>
                )}
                {selectedDate && slotsLoading && (
                  <div className="py-16 text-center text-gray-500 text-sm">
                    <div className="w-6 h-6 border-2 border-gold/30 border-t-gold rounded-full animate-spin mx-auto mb-3" />
                    Loading…
                  </div>
                )}
                {selectedDate && !slotsLoading && slotGrid.length === 0 && (
                  <div className="py-16 text-center text-gray-500 text-sm">No openings on this day.</div>
                )}
                {selectedDate && !slotsLoading && slotGrid.length > 0 && bookableSlots.length === 0 && servicesPicked.length > 1 && (
                  <div className="m-4 py-5 text-center bg-yellow-500/5 border border-yellow-500/20 rounded-xl px-4">
                    <p className="text-yellow-300 text-sm font-medium">
                      {flow === "barber-first" ? "This barber doesn't have" : "No barber has"} {totalDuration} min open on this day
                    </p>
                    <p className="text-xs text-gray-500 mt-1">Try another day.</p>
                  </div>
                )}
                {selectedDate && !slotsLoading && bookableSlots.length > 0 && (
                  <div className="relative" style={{ height: `${(endHour - startHour) * ROW_PX + 24}px` }}>
                    {/* Hour lines */}
                    {hoursToShow.map((h, i) => (
                      <div key={h} className="absolute left-0 right-0 flex items-start" style={{ top: `${i * ROW_PX}px` }}>
                        <div className="w-14 pl-3 pr-2 text-[10px] text-gray-500 pt-0">
                          {formatHourLabel(h)}
                        </div>
                        <div className="flex-1 h-px bg-border/30 mt-1.5" />
                      </div>
                    ))}

                    {/* Slot chips — fixed-height pills, one per available start time. Barber
                        identity is revealed on tap (popup) or shown on the selected chip only. */}
                    {bookableSlots.map(({ slot, barberIds }) => {
                      const slotHour = parseHour(slot);
                      if (slotHour < startHour || slotHour >= endHour) return null;
                      const top = (slotHour - startHour) * ROW_PX;
                      const isSelectedSlot = selectedTime === slot;
                      return (
                        <button key={slot}
                          onClick={() => {
                            if (barberIds.length === 1) {
                              setSelectedTime(slot);
                              setSelectedBarber(barberIds[0]);
                            } else {
                              setExpandedSlot(slot);
                            }
                          }}
                          style={{ top: `${top + 4}px`, height: "26px", left: "60px", right: "12px", position: "absolute" }}
                          className={cn(
                            "rounded-md text-left pl-2.5 pr-2 flex items-center justify-between overflow-hidden transition-all border-l-2",
                            isSelectedSlot
                              ? "bg-gold/25 border-gold ring-1 ring-gold/50"
                              : "bg-sky-500/15 hover:bg-sky-500/25 border-sky-400",
                          )}
                        >
                          <span className={cn("text-xs font-semibold leading-none", isSelectedSlot ? "text-gold" : "text-sky-200")}>
                            {slot}
                          </span>
                          <span className={cn("text-[10px] leading-none ml-2", isSelectedSlot ? "text-gold/80" : "text-sky-300/70")}>
                            {barberIds.length === 1
                              ? (isSelectedSlot ? barbers.find(b => b.id === barberIds[0])?.name : "")
                              : `${barberIds.length} free`}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Barber-picker popup — for slots with multiple barbers free */}
              {expandedSlot && (() => {
                const slotEntry = slotGrid.find(s => s.slot === expandedSlot);
                if (!slotEntry) return null;
                const slotBarbers = barbers.filter(b => slotEntry.barberIds.includes(b.id));
                return (
                  <>
                    <div className="fixed inset-0 bg-black/60 z-40" onClick={() => setExpandedSlot(null)} />
                    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
                      <div className="bg-surface border border-border rounded-t-2xl sm:rounded-2xl p-5 w-full max-w-sm space-y-3 animate-fade-in">
                        <div className="flex items-center justify-between">
                          <div>
                            <h3 className="text-base font-bold text-white">Choose a barber</h3>
                            <p className="text-xs text-gray-400 mt-0.5">{expandedSlot} · {slotBarbers.length} available</p>
                          </div>
                          <button onClick={() => setExpandedSlot(null)} className="text-gray-400 hover:text-white"><X size={18} /></button>
                        </div>
                        <div className="space-y-2">
                          {slotBarbers.map((b) => (
                            <button key={b.id}
                              onClick={() => { setSelectedTime(expandedSlot); setSelectedBarber(b.id); setExpandedSlot(null); }}
                              className="w-full flex items-center gap-3 px-4 py-3 rounded-xl border border-border bg-surface-raised hover:border-gold/40 text-left transition-all"
                            >
                              {b.photo
                                ? <img src={b.photo} alt={b.name} className="w-10 h-10 rounded-full object-cover" />
                                : <div className="w-10 h-10 rounded-full bg-gold/20 flex items-center justify-center text-gold font-bold">{b.name[0]}</div>
                              }
                              <div className="flex-1">
                                <p className="text-sm font-semibold text-white">{b.name}</p>
                                <p className="text-xs text-gold flex items-center gap-0.5"><Star size={10} className="fill-gold" /> {b.rating} ({b.total_reviews} reviews)</p>
                              </div>
                              <ChevronRight size={16} className="text-gray-500" />
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  </>
                );
              })()}
            </div>
          );
        })()}

        {/* Client Info Step */}
        {step === clientStepIndex && (
          <div className="space-y-4 animate-fade-in">
            <h2 className="text-lg font-semibold text-white">Your information</h2>
            {([
              { key: "name" as const, label: "Full Name", placeholder: "Devon Williams", type: "text" },
              { key: "email" as const, label: "Email Address", placeholder: "devon@email.com", type: "email" },
              { key: "phone" as const, label: "Phone Number", placeholder: "506-555-0201", type: "tel" },
            ]).map(({ key, label, placeholder, type }) => (
              <div key={key} className="space-y-1.5">
                <label className="text-sm font-medium text-gray-300">{label}</label>
                <input type={type} value={clientInfo[key]}
                  onChange={(e) => {
                    const val = key === "phone" ? formatPhone(e.target.value) : e.target.value;
                    setClientInfo({ ...clientInfo, [key]: val });
                    if (clientErrors[key]) setClientErrors(prev => { const n = { ...prev }; delete n[key]; return n; });
                  }}
                  placeholder={placeholder}
                  className={cn("w-full bg-surface-raised border rounded-xl px-4 py-3 text-sm text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:border-gold/50 transition-all",
                    clientErrors[key] ? "border-red-500/50 focus:ring-red-500/30" : "border-border focus:ring-gold/50")}
                />
                {clientErrors[key] && <p className="text-xs text-red-400">{clientErrors[key]}</p>}
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
        {step === confirmStepIndex && (() => {
          const depositTotal = servicesPicked.reduce(
            (sum, s) => sum + (s.deposit_required ? (s.deposit_amount ?? 0) : 0),
            0
          );
          return (
          <div className="space-y-4 animate-fade-in">
            <h2 className="text-lg font-semibold text-white">Review your booking</h2>
            <div className="bg-surface border border-border rounded-2xl p-5 space-y-3">
              {[
                { label: "Shop", value: shop.name },
                { label: "Barber", value: barber?.name ?? "Any Available" },
                { label: servicesPicked.length > 1 ? "Services" : "Service", value: servicesPicked.map(s => s.name).join(" + ") || "" },
                { label: "Total Duration", value: `${totalDuration} min` },
                { label: "Date", value: selectedDate?.toLocaleDateString("en-CA", { weekday: "long", month: "long", day: "numeric", year: "numeric" }) ?? "" },
                { label: "Start Time", value: selectedTime ?? "" },
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
                {servicesPicked.map((s) => (
                  <div key={s.id} className="flex justify-between text-sm">
                    <span className="text-gray-500">{s.name} <span className="text-gray-600">· {s.duration_minutes}min</span></span>
                    <span className="text-white">{formatCurrency(s.price ?? 0)}</span>
                  </div>
                ))}
                {promoApplied && (
                  <div className="flex justify-between text-sm">
                    <span className="text-emerald-400">Discount ({promoApplied.code})</span>
                    <span className="text-emerald-400">-{formatCurrency(discount)}</span>
                  </div>
                )}
                <div className="flex justify-between font-bold pt-1 border-t border-border/50">
                  <span className="text-white">Total</span>
                  <span className="text-gold text-lg">{formatCurrency(total)}</span>
                </div>
                {depositTotal > 0 && (
                  <div className="flex justify-between text-sm pt-1">
                    <span className="text-gold">Deposit due now</span>
                    <span className="text-gold font-semibold">{formatCurrency(depositTotal)}</span>
                  </div>
                )}
              </div>
            </div>
            {depositTotal > 0
              ? <p className="text-xs text-gold/70 text-center">💳 A ${depositTotal} deposit is required to secure this booking · Balance paid at the shop</p>
              : <p className="text-xs text-gray-600 text-center">Payment collected at the shop · Free cancellation 24h before</p>
            }
          </div>
          );
        })()}
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
