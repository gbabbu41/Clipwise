"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight, Star, Clock, MapPin, Phone, Check, Calendar, Share2, User, Tag, X } from "lucide-react";
import { Logo } from "@/components/ui/logo";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn, formatCurrency, formatDateForDb, isDateInPast, getSlotsInRange, generate24hSlots, timeToMinutes, dbTimeToDisplay, occupiedSlots } from "@/lib/utils";
import { formatPhone, validatePhone, validateEmail, isWithin6Months, isSlotInPast, effectivePlan, planHasFeature } from "@/lib/validation";
import { supabase } from "@/lib/supabase";
import type { Shop, Barber, Service, PromoCode } from "@/lib/database.types";

// ─── Types ────────────────────────────────────────────────────────────────────
interface SlotAvailability {
  slot: string;
  available: boolean;
  barberIds: string[];
}

interface Toast { msg: string; ok: boolean }

// Duration (minutes) of a booked appointment row whose query joined the
// service. Supabase returns the to-one relation as an object (or array).
function apptDurationMin(a: { services?: { duration_minutes?: number } | { duration_minutes?: number }[] | null }): number {
  const s = Array.isArray(a.services) ? a.services[0] : a.services;
  return s?.duration_minutes ?? 30;
}

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
  return <div className={cn("animate-pulse bg-[#141414] rounded-xl", className)} />;
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
  const [paidThankYou, setPaidThankYou] = useState(false); // post-booking payment-link return
  const [bookingId, setBookingId] = useState<string | null>(null);
  // Booking summary returned by /booking-finalize after the Stripe round-trip —
  // the in-memory selections are wiped by the redirect, so the success screen
  // renders from this when present (online path).
  const [confirmedSummary, setConfirmedSummary] = useState<{
    shopName: string; barberName: string; serviceName: string;
    date: string; time: string; total: number; clientEmail: string; paymentNote: string;
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const [clientErrors, setClientErrors] = useState<Record<string, string>>({});
  /** Customer's payment-method pick. `null` means not yet decided. The
   *  choice screen only appears when both online (shop has Stripe Connect)
   *  and in-person (`shop.allow_pay_in_person`) are options *and* there is
   *  money to take. Otherwise we route silently down the only viable path. */
  const [payMethodChoice, setPayMethodChoice] = useState<"online" | "in_person" | null>(null);
  const [showPayChoiceModal, setShowPayChoiceModal] = useState(false);
  /** The customer's acceptance of the no-show charge disclaimer. Required
   *  before any card is taken (held ≤7 days, or saved >7 days) when the shop
   *  has no-show protection on. In-person bookings never need it. */
  const [noShowConsent, setNoShowConsent] = useState(false);

  // ── Smart waitlist (notify me when a spot opens on a full day) ──────────────
  const [showWaitlistModal, setShowWaitlistModal] = useState(false);
  const [waitlistSaving, setWaitlistSaving] = useState(false);
  const [waitlistForm, setWaitlistForm] = useState({ name: "", email: "", phone: "" });
  // Dates the customer has already joined the waitlist for, so we can swap the
  // button for a confirmation and avoid duplicate signups in one session.
  const [waitlistedDates, setWaitlistedDates] = useState<Set<string>>(new Set());

  // ── Availability state ─────────────────────────────────────────────────────
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [slotGrid, setSlotGrid] = useState<SlotAvailability[]>([]);
  const [expandedSlot, setExpandedSlot] = useState<string | null>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const [barberWorkDays, setBarberWorkDays] = useState<Set<number>>(new Set());
  const [shopWorkDays, setShopWorkDays] = useState<Set<number>>(new Set());
  // Per-barber day-of-week + approved full-day time-off, so the date strip
  // can grey out specific dates (not just whole weekdays) when every barber
  // available that day is also on vacation / day-off / sick.
  const [barberDows, setBarberDows] = useState<Record<string, Set<number>>>({});
  const [barberTimeOff, setBarberTimeOff] = useState<{ barber_id: string; start_date: string; end_date: string }[]>([]);

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
          if (data.summary) setConfirmedSummary(data.summary);
          setConfirmed(true);
        } else {
          showToast("We couldn't confirm your payment. Contact the shop.", false);
        }
      })();
    }
    // Post-booking PAYMENT LINK return (owner-sent link for an existing
    // appointment) — finalize the payment + show a "thank you" screen.
    const paidAppt = searchParams.get("paid_appt");
    if (paidAppt) {
      const sessionId = searchParams.get("session_id");
      if (!sessionId) return;
      (async () => {
        const res = await fetch("/api/stripe/payment-link-finalize", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ session_id: sessionId, appointment_id: paidAppt }),
        });
        const data = await res.json();
        if (res.ok && data.paid) {
          setBookingId(data.appointmentId);
          if (data.summary) setConfirmedSummary(data.summary);
          setPaidThankYou(true);
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
    if (barbers.length === 0) { setShopWorkDays(new Set()); setBarberDows({}); return; }
    const { data } = await supabase
      .from("time_slots")
      .select("barber_id, day_of_week")
      .in("barber_id", barbers.map(b => b.id))
      .eq("is_available", true);
    setShopWorkDays(new Set((data ?? []).map((r: { day_of_week: number }) => r.day_of_week)));
    // Also build the per-barber day-of-week index used by the date-strip
    // availability check below.
    const perBarber: Record<string, Set<number>> = {};
    for (const r of (data ?? []) as { barber_id: string; day_of_week: number }[]) {
      if (!perBarber[r.barber_id]) perBarber[r.barber_id] = new Set();
      perBarber[r.barber_id].add(r.day_of_week);
    }
    setBarberDows(perBarber);
  }, [barbers]);
  useEffect(() => { loadShopWorkDays(); }, [loadShopWorkDays]);

  // ── Load approved full-day time-off for every barber in this shop ──────────
  // (Blocked-hours is partial and doesn't make the date itself unbookable.)
  const loadBarberTimeOff = useCallback(async () => {
    if (barbers.length === 0) { setBarberTimeOff([]); return; }
    const todayStr = formatDateForDb(new Date());
    const { data } = await supabase
      .from("time_off_requests")
      .select("barber_id, start_date, end_date")
      .in("barber_id", barbers.map(b => b.id))
      .eq("status", "approved")
      .in("type", ["day_off", "vacation", "sick"])
      .gte("end_date", todayStr);
    setBarberTimeOff((data ?? []) as { barber_id: string; start_date: string; end_date: string }[]);
  }, [barbers]);
  useEffect(() => { loadBarberTimeOff(); }, [loadBarberTimeOff]);

  // Helper: does at least one barber actually work this specific date?
  // True only when some barber has the dow in their schedule AND isn't on
  // an approved full-day time-off covering the date.
  const isShopAvailableOnDate = useCallback((date: Date): boolean => {
    if (barbers.length === 0) return true; // no barbers loaded yet — don't grey
    const dow = date.getDay();
    const dateStr = formatDateForDb(date);
    return barbers.some(b => {
      const works = barberDows[b.id]?.has(dow);
      if (!works) return false;
      const onTimeOff = barberTimeOff.some(t =>
        t.barber_id === b.id && t.start_date <= dateStr && t.end_date >= dateStr
      );
      return !onTimeOff;
    });
  }, [barbers, barberDows, barberTimeOff]);

  // Helper for barber-first flow: is THIS specific barber available on date?
  const isBarberAvailableOnDate = useCallback((barberId: string, date: Date): boolean => {
    const dow = date.getDay();
    const dateStr = formatDateForDb(date);
    if (!barberDows[barberId]?.has(dow)) return false;
    const onTimeOff = barberTimeOff.some(t =>
      t.barber_id === barberId && t.start_date <= dateStr && t.end_date >= dateStr
    );
    return !onTimeOff;
  }, [barberDows, barberTimeOff]);

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
      const [{ data: ts }, { data: booked }, { data: timeOff }] = await Promise.all([
        supabase.from("time_slots").select("*").eq("barber_id", b.id).eq("day_of_week", dow).eq("is_available", true).single(),
        supabase.from("appointments").select("time_slot, services(duration_minutes)").eq("barber_id", b.id).eq("date", dateStr).in("status", ["pending", "confirmed"]),
        supabase.from("time_off_requests").select("type, start_time, end_time").eq("barber_id", b.id).eq("status", "approved").lte("start_date", dateStr).gte("end_date", dateStr),
      ]);
      if (!ts) return;
      // A whole-day type-off (day_off/vacation/sick) means this barber doesn't
      // contribute ANY slots on this date — skip them entirely.
      const fullDayOff = (timeOff ?? []).some(o => o.type === "day_off" || o.type === "vacation" || o.type === "sick");
      if (fullDayOff) return;
      // blocked_hours mark a partial window — convert each window to the set
      // of 30-min slot labels it covers and add to the booked set.
      const blockedSlotSet = new Set<string>();
      for (const o of (timeOff ?? [])) {
        if (o.type !== "blocked_hours" || !o.start_time || !o.end_time) continue;
        const blockStart = timeToMinutes(dbTimeToDisplay(o.start_time));
        const blockEnd = timeToMinutes(dbTimeToDisplay(o.end_time));
        for (const slot of generate24hSlots()) {
          const m = timeToMinutes(slot);
          if (m >= blockStart && m < blockEnd) blockedSlotSet.add(slot);
        }
      }
      const bookedSlots = [
        ...((booked ?? []).flatMap((a) => occupiedSlots(a.time_slot, apptDurationMin(a)))),
        ...Array.from(blockedSlotSet),
      ];
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
    const [{ data: ts }, { data: booked }, { data: timeOff }] = await Promise.all([
      supabase.from("time_slots").select("*").eq("barber_id", barberId).eq("day_of_week", dow).eq("is_available", true).single(),
      supabase.from("appointments").select("time_slot, services(duration_minutes)").eq("barber_id", barberId).eq("date", dateStr).in("status", ["pending", "confirmed"]),
      supabase.from("time_off_requests").select("type, start_time, end_time").eq("barber_id", barberId).eq("status", "approved").lte("start_date", dateStr).gte("end_date", dateStr),
    ]);
    if (!ts) { setSlotsLoading(false); return; }
    const fullDayOff = (timeOff ?? []).some(o => o.type === "day_off" || o.type === "vacation" || o.type === "sick");
    if (fullDayOff) { setSlotGrid([]); setSlotsLoading(false); return; }
    const blockedSlotSet = new Set<string>();
    for (const o of (timeOff ?? [])) {
      if (o.type !== "blocked_hours" || !o.start_time || !o.end_time) continue;
      const blockStart = timeToMinutes(dbTimeToDisplay(o.start_time));
      const blockEnd = timeToMinutes(dbTimeToDisplay(o.end_time));
      for (const slot of generate24hSlots()) {
        const m = timeToMinutes(slot);
        if (m >= blockStart && m < blockEnd) blockedSlotSet.add(slot);
      }
    }
    const bookedSlots = [
      ...((booked ?? []).flatMap((a) => occupiedSlots(a.time_slot, apptDurationMin(a)))),
      ...Array.from(blockedSlotSet),
    ];
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
    const onTimeOff = () => {
      // Owner approving/cancelling time-off affects both the slot grid AND
      // the date-strip greying (specific dates a barber is out).
      refreshSlots();
      loadBarberTimeOff();
    };
    const channel = supabase
      .channel(`book_slots:${shop.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "time_slots" }, onTimeSlots)
      .on("postgres_changes", { event: "*", schema: "public", table: "appointments", filter: `shop_id=eq.${shop.id}` }, refreshSlots)
      .on("postgres_changes", { event: "*", schema: "public", table: "time_off_requests", filter: `shop_id=eq.${shop.id}` }, onTimeOff)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [shop?.id, loadTimeFirstSlots, loadBarberFirstSlots, loadBarberWorkDays, loadShopWorkDays, loadBarberTimeOff]);


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
    const service = services.find((s) => s.id === selectedService); // primary
    const discount = promoApplied
      ? promoApplied.discount_type === "percent"
        ? totalPrice * promoApplied.discount_value / 100
        : promoApplied.discount_value
      : 0;
    const total = Math.max(0, totalPrice - discount);

    // ── Pay-method choice gate ──────────────────────────────────────────────
    // Online is always available — the server-side route falls back to a
    // platform charge when the shop hasn't completed Stripe Connect, so the
    // customer can pay either way regardless of the shop's onboarding state.
    // In-person availability is the owner's call (allow_pay_in_person).
    // Starter (free) shops can't take money online — pay-in-person is the only
    // option (and is always available for them regardless of the owner toggle,
    // since otherwise there'd be no way to book a paid service).
    const canPayOnline = total > 0 && shopCanCharge;
    const canPayInPerson = total > 0 && (shopCanCharge ? (shop.allow_pay_in_person ?? true) : true);
    if (canPayOnline && canPayInPerson && !payMethodChoice) {
      setShowPayChoiceModal(true);
      return;
    }
    setSaving(true);

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

    // Online-payment branch — triggered either by an explicit customer
    // choice ("pay online now" → charge the full total) or by the legacy
    // deposit-required path ("just the deposit upfront"). The API falls
    // back to the platform's Stripe account when the shop hasn't done
    // Connect, so no `stripe_connected` precondition is needed here.
    //
    // `in_person` always wins over `deposit_required` — when the customer
    // explicitly picks pay-in-person, we skip Stripe entirely even if the
    // service was tagged with a deposit requirement.
    const depositAmount = (shopCanCharge && service?.deposit_required) ? (service.deposit_amount ?? 0) : 0;
    // No-show protection options for "pay online":
    //   ≤7 days out  → AUTHORIZE the full amount (card held, not charged),
    //                  captured later on completion / no-show.
    //   >7 days out  → card holds expire ~7 days, so instead SAVE the card
    //                  (no charge now) and charge it on completion / no-show.
    const useHold = payMethodChoice === "online" && !willSaveCard;
    const useSaveCard = payMethodChoice === "online" && willSaveCard;
    // A card is being taken online — require the no-show consent first.
    if (payMethodChoice === "online" && cardForNoShow && !noShowConsent) {
      setSaving(false);
      showToast("Please accept the no-show policy to continue.", false);
      return;
    }
    // Amount to send: holds authorize the full total; saved cards charge $0
    // now (setup mode ignores it); the legacy deposit path charges the deposit.
    const chargeAmount =
      payMethodChoice === "in_person" ? 0 :
      useHold                         ? total :
      useSaveCard                     ? 0 :
                                        depositAmount;
    // Route to Stripe whenever paying online (hold or save) or a deposit is due.
    if (payMethodChoice === "online" || chargeAmount > 0) {
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
            amount: chargeAmount,
            total_amount: total,
            hold: useHold,
            saveCard: useSaveCard,
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
    // Pay-in-person bookings normally land as "pending" for the owner/barber to
    // Approve. When the shop turns on Auto-Confirm, skip that step and confirm
    // them straight away. (Online/prepaid bookings always confirm on payment.)
    const autoConfirm = !!(shop.booking_settings as { auto_confirm?: boolean } | null)?.auto_confirm;
    const inPersonStatus = autoConfirm ? "confirmed" : "pending";
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
        status: inPersonStatus,
        total_amount: rowAmount,
        deposit_paid: false,
        // When the customer explicitly picked "pay in person", tag the row
        // so the owner sees a Cash badge and can later either take cash or
        // send a Stripe link via the appointments dashboard.
        payment_method: payMethodChoice === "in_person" ? "cash" : null,
        payment_status: payMethodChoice === "in_person" ? "unpaid" : null,
        notes: servicesPicked.length > 1
          ? `Part of multi-service booking · ${servicesPicked.map(s => s.name).join(" + ")}`
          : null,
      };
    });

    // Guard against double-booking the same barber/time. Duration-aware: an
    // existing *longer* appointment that overlaps this booking's span (not just
    // one starting on the same slot) is a clash. The DB unique index still
    // backstops exact-slot races; this gives a friendlier message + catches
    // overlaps the index can't see.
    if (finalBarberId) {
      const { data: existing } = await supabase
        .from("appointments")
        .select("time_slot, services(duration_minutes)")
        .eq("barber_id", finalBarberId)
        .eq("date", formatDateForDb(selectedDate))
        .in("status", ["pending", "confirmed"]);
      const newStart = timeToMinutes(selectedTime);
      const newEnd = newStart + servicesPicked.reduce((sum, x) => sum + (x.duration_minutes ?? 30), 0);
      const clash = (existing ?? []).some((a) => {
        const s = timeToMinutes(a.time_slot);
        const e = s + apptDurationMin(a);
        return newStart < e && s < newEnd;
      });
      if (clash) {
        setSaving(false);
        showToast("Sorry, that time was just booked. Please pick another slot.", false);
        return;
      }
    }

    const { error } = await supabase.from("appointments").insert(rows);

    setSaving(false);
    if (error) {
      // 23505 = our double-booking unique index rejected a same-instant race.
      const taken = (error as { code?: string }).code === "23505";
      showToast(taken ? "That time was just booked — please pick another slot." : "Failed to book. Please try again.", false);
      return;
    }
    setBookingId(rows[0].id);
    setConfirmed(true);

    // Auto-register the customer in the shop's client book (deduped server-side
    // by email/phone). Fire-and-forget — booking already succeeded.
    fetch("/api/clients/upsert", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ shop_id: shop.id, name: clientInfo.name, email: clientInfo.email, phone: clientInfo.phone }),
    }).catch(() => null);

    // Text the customer a confirmation (best-effort; in-person path = pay later).
    if (clientInfo.phone) {
      fetch("/api/twilio/send-sms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: clientInfo.phone,
          shopName: shop.name,
          body: `Your appointment on ${selectedDate ? formatDateForDb(selectedDate) : ""} at ${selectedTime} is confirmed. Pay at the shop. Booking #${rows[0].id.slice(0, 8).toUpperCase()}.`,
        }),
      }).catch(() => null);
    }

    // Create in-app notification for shop owner (fire-and-forget)
    supabase.from("notifications").insert({
      user_id: shop.owner_id,
      title: "New booking — needs approval",
      message: `${clientInfo.name} booked ${service?.name ?? "a service"} on ${formatDateForDb(selectedDate!)} at ${selectedTime} · tap to approve`,
      type: "booking",
      is_read: false,
    }).then(null, () => null);

    // Barber in-app notification + SMS to owner & barber (server-side, so it can
    // read staff phone numbers). This is what makes the live pop-up + sound fire
    // for the assigned barber's portal too.
    fetch("/api/appointments/notify-staff", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ appointment_id: rows[0].id }),
    }).catch(() => null);

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

  // Whether THIS shop's plan includes taking money online/by card. Starter
  // (free) is pay-in-person only — so online checkout, deposits, and card-hold
  // no-show protection are all hidden for it (the booking-checkout route also
  // 403s these, but the UI must not offer them in the first place).
  const shopCanCharge = !!shop && planHasFeature(effectivePlan(shop.subscription_plan, shop.subscription_status), "payments");

  // ── No-show policy (from the shop's booking_settings JSON) ─────────────────
  const bookingSettings = (shop?.booking_settings ?? null) as { no_show_protection?: boolean; no_show_fee_amount?: number } | null;
  const noShowProtection = !!bookingSettings?.no_show_protection;
  const noShowFee = bookingSettings?.no_show_fee_amount ?? 0; // 0 = full service price
  const noShowFeeLabel = noShowFee > 0 ? formatCurrency(noShowFee) : "the full service price";
  // Days until the appointment — drives hold (≤7d) vs save-card (>7d).
  const daysOut = selectedDate ? (new Date(formatDateForDb(selectedDate) + "T00:00:00").getTime() - Date.now()) / 86400000 : 0;
  const willSaveCard = daysOut > 7; // beyond the ~7-day card-hold window
  // Whether paying online would take a card under no-show protection — used to
  // gate the consent checkbox in the pay-method modal. (In-person never takes
  // a card, so its button is never gated.)
  const cardForNoShow = noShowProtection && total > 0 && shopCanCharge;

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

  // ── Smart waitlist join ─────────────────────────────────────────────────────
  const openWaitlist = () => {
    // Prefill from anything they've already typed on the Your Info step.
    setWaitlistForm({ name: clientInfo.name, email: clientInfo.email, phone: clientInfo.phone });
    setShowWaitlistModal(true);
  };

  const joinWaitlist = async () => {
    if (!shop || !selectedDate) return;
    if (!waitlistForm.name.trim()) { setToast({ msg: "Enter your name", ok: false }); return; }
    if (!waitlistForm.email.trim() && !waitlistForm.phone.trim()) {
      setToast({ msg: "Enter an email or phone so we can reach you", ok: false });
      return;
    }
    const dateStr = formatDateForDb(selectedDate);
    setWaitlistSaving(true);
    try {
      const res = await fetch("/api/waitlist/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          shop_id: shop.id,
          desired_date: dateStr,
          client_name: waitlistForm.name,
          client_email: waitlistForm.email || null,
          client_phone: waitlistForm.phone || null,
          barber_id: flow === "barber-first" ? selectedBarber : null,
          service_id: selectedService,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setToast({ msg: data.error ?? "Could not join waitlist", ok: false }); return; }
      setWaitlistedDates(prev => new Set(prev).add(dateStr));
      setShowWaitlistModal(false);
      setToast({ msg: "You're on the list — we'll text/email if a spot opens", ok: true });
    } catch {
      setToast({ msg: "Network error — try again", ok: false });
    } finally {
      setWaitlistSaving(false);
    }
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
      <div className="min-h-screen bg-black p-6 space-y-4 max-w-2xl mx-auto">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (!shop) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center px-4">
        <div className="text-center">
          <Logo size="md" />
          <h1 className="text-2xl font-bold text-white mt-6">Shop Not Found</h1>
          <p className="text-[#777] mt-2">This booking link may be invalid.</p>
        </div>
      </div>
    );
  }

  if (shop.status !== "approved") {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center px-4">
        <div className="text-center max-w-sm">
          <div className="w-20 h-20 bg-black/5 border border-[#1e1e1e] rounded-2xl flex items-center justify-center mx-auto mb-6">
            <Logo size="sm" showText={false} />
          </div>
          <h1 className="text-2xl font-bold text-white">{shop.name}</h1>
          <p className="text-[#777] mt-3">This shop is coming soon. Check back later.</p>
          <Badge variant="warning" className="mt-4">Coming Soon</Badge>
        </div>
      </div>
    );
  }

  // ── Success screen ─────────────────────────────────────────────────────────
  if (confirmed) {
    // Prefer the server summary (online path: in-memory state was wiped by the
    // Stripe redirect); fall back to live state for the in-person path.
    const dispBarber = confirmedSummary?.barberName ?? barber?.name ?? "Any Available";
    const dispService = confirmedSummary?.serviceName ?? service?.name ?? "";
    const dispDateObj = confirmedSummary ? new Date(`${confirmedSummary.date}T12:00:00`) : selectedDate;
    const dispTime = confirmedSummary?.time ?? selectedTime ?? "";
    const dispTotal = confirmedSummary?.total ?? total;
    const dispEmail = confirmedSummary?.clientEmail || clientInfo.email;
    return (
      <div className="min-h-screen bg-black flex flex-col items-center justify-center px-4">
        {toast && <ToastBar toast={toast} onClose={() => setToast(null)} />}
        <div className="max-w-md w-full text-center">
          <div className="w-20 h-20 bg-emerald-500/20 rounded-full flex items-center justify-center mx-auto mb-6">
            <Check size={36} className="text-emerald-400" />
          </div>
          <h1 className="text-2xl font-bold text-white mb-2">{paidThankYou ? "Payment received — thank you!" : "Booking Confirmed!"}</h1>
          {bookingId && <p className="text-xs text-[#777] mb-1">Booking ID: <span className="text-white font-mono">{bookingId.slice(0, 8).toUpperCase()}</span></p>}
          {dispEmail && <p className="text-[#777] mb-2">{paidThankYou ? `We've emailed your receipt to ${dispEmail}` : `We'll send a confirmation to ${dispEmail}`}</p>}
          {bookingId && <a href={`/my-booking/${bookingId}`} className="text-xs text-white hover:text-white transition-colors mb-6 block">View & Manage Booking →</a>}
          <div className="bg-black shadow-sm border border-[#1e1e1e] rounded-2xl p-6 text-left space-y-3 mb-6">
            {[
              { label: "Shop", value: confirmedSummary?.shopName || shop.name },
              { label: "Barber", value: dispBarber },
              { label: "Service", value: dispService },
              { label: "Date", value: dispDateObj?.toLocaleDateString("en-CA", { weekday: "short", month: "short", day: "numeric" }) ?? "" },
              { label: "Time", value: dispTime },
            ].map(({ label, value }) => (
              <div key={label} className="flex justify-between text-sm">
                <span className="text-[#777]">{label}</span>
                <span className="text-white font-medium">{value}</span>
              </div>
            ))}
            <div className="border-t border-[#1e1e1e] pt-3 flex justify-between font-bold">
              <span className="text-white">Total</span>
              <span className="text-white text-lg">{formatCurrency(dispTotal)}</span>
            </div>
            {confirmedSummary?.paymentNote && (
              <p className="text-xs text-[#777] text-center pt-1">{confirmedSummary.paymentNote}</p>
            )}
          </div>
          <div className="flex gap-3">
            <Button variant="outline" className="flex-1" onClick={() => {
              if (!dispDateObj || !dispTime) return;
              const [time, period] = dispTime.split(" ");
              const [hoursStr, minutesStr] = time.split(":");
              let hours = parseInt(hoursStr, 10);
              const minutes = parseInt(minutesStr || "0", 10);
              if (period === "PM" && hours !== 12) hours += 12;
              if (period === "AM" && hours === 12) hours = 0;
              const start = new Date(dispDateObj);
              start.setHours(hours, minutes, 0, 0);
              const end = new Date(start.getTime() + (totalDuration || 60) * 60000);
              const fmt = (d: Date) => d.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
              const url = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(`Haircut at ${shop.name}`)}&dates=${fmt(start)}/${fmt(end)}&details=${encodeURIComponent(`Service: ${dispService}\nBarber: ${dispBarber}\nBooking ID: ${bookingId?.slice(0, 8).toUpperCase() ?? ""}`)}&location=${encodeURIComponent(`${shop.address ?? ""}, ${shop.city ?? ""}`)}`;
              window.open(url, "_blank");
            }}>
              <Calendar size={16} /> Add to Calendar
            </Button>
            <Button variant="outline" className="flex-1" onClick={() => { if (navigator.share) navigator.share({ title: `Booking at ${shop.name}`, text: `${shop.name} — ${dispDateObj?.toLocaleDateString()} at ${dispTime}`, url: window.location.href }); }}>
              <Share2 size={16} /> Share
            </Button>
          </div>
          <Button className="w-full mt-3 !bg-black !text-white hover:!bg-gray-800" onClick={() => { setConfirmed(false); setPaidThankYou(false); setConfirmedSummary(null); setStep(0); setSelectedBarber(null); setSelectedService(null); setSelectedDate(null); setSelectedTime(null); setPayMethodChoice(null); setNoShowConsent(false); }}>
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

  // No-show consent checkbox — shown wherever a card is about to be taken
  // online under no-show protection. In-person bookings never render it.
  const noShowConsentBox = (
    <label className="flex items-start gap-3 p-3 rounded-xl border border-amber-500/30 bg-amber-500/5 cursor-pointer">
      <input type="checkbox" checked={noShowConsent} onChange={(e) => setNoShowConsent(e.target.checked)}
        className="mt-0.5 h-4 w-4 accent-gold flex-shrink-0" />
      <span className="text-xs text-amber-200/90 leading-relaxed">
        {willSaveCard ? (
          <>This booking is more than 7 days away, so my card will be securely <span className="font-semibold">saved</span> now (not charged) and charged after my visit — or a no-show fee of <span className="font-semibold">{noShowFeeLabel}</span> if I don&apos;t show up. I accept this no-show policy.</>
        ) : (
          <>My card will be securely <span className="font-semibold">held</span> now and charged after my visit — or a no-show fee of <span className="font-semibold">{noShowFeeLabel}</span> if I don&apos;t show up. I accept this no-show policy.</>
        )}
      </span>
    </label>
  );

  return (
    <div className="min-h-screen bg-black">
      {toast && <ToastBar toast={toast} onClose={() => setToast(null)} />}

      {/* Shop Header */}
      <div className="bg-black shadow-sm border-b border-[#1e1e1e]">
        <div className="max-w-2xl mx-auto px-4 py-5">
          <div className="flex items-start gap-4">
            <div className="w-14 h-14 rounded-2xl bg-black/10 border border-black flex items-center justify-center flex-shrink-0 overflow-hidden">
              {shop.logo
                ? <img src={shop.logo} alt={shop.name} className="w-full h-full object-cover" />
                : <Logo size="sm" showText={false} />}
            </div>
            <div className="flex-1">
              <h1 className="text-xl font-bold text-white">{shop.name}</h1>
              <div className="flex flex-wrap gap-3 mt-1 text-xs text-[#777]">
                <span className="flex items-center gap-1"><MapPin size={11} /> {shop.city}, {shop.province}</span>
                <span className="flex items-center gap-1"><Phone size={11} /> {shop.phone}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Flow Toggle */}
      <div className="bg-black shadow-sm border-b border-[#1e1e1e]">
        <div className="max-w-2xl mx-auto px-4 py-3 flex gap-1">
          {(["time-first", "barber-first"] as const).map((f) => (
            <button
              key={f}
              onClick={() => switchFlow(f)}
              className={cn(
                "flex-1 py-2 px-3 rounded-xl text-xs font-semibold transition-all",
                flow === f ? "bg-gold text-black" : "text-[#777] hover:text-white border border-[#1e1e1e]"
              )}
            >
              {f === "time-first" ? "Choose Time First" : "Choose Barber First"}
            </button>
          ))}
        </div>
      </div>

      {/* Progress */}
      <div className="bg-black shadow-sm border-b border-[#1e1e1e] sticky top-0 z-10">
        <div className="max-w-2xl mx-auto px-4 py-3">
          <div className="flex items-center gap-1">
            {STEPS.map((s, i) => (
              <div key={s + i} className="flex items-center gap-1 flex-1">
                <div className={cn(
                  "flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-semibold transition-all",
                  i < step ? "bg-gold text-black" : i === step ? "bg-black/10 text-white border border-black" : "bg-[#141414] text-[#999]"
                )}>
                  {i < step ? <Check size={11} /> : i + 1}
                </div>
                {i < STEPS.length - 1 && <div className={cn("flex-1 h-px", i < step ? "bg-gold" : "bg-border")} />}
              </div>
            ))}
          </div>
          <p className="text-xs text-[#777] mt-1.5">Step {step + 1} of {STEPS.length}: <span className="text-white font-medium">{STEPS[step]}</span></p>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-6 pb-28">

        {/* BARBER FIRST — Step 0: Select Barber */}
        {step === isBarberFirstStep(0) && (
          <div className="space-y-4 animate-fade-in">
            <h2 className="text-lg font-semibold text-white">Choose your barber</h2>
            <button
              onClick={() => setSelectedBarber("any")}
              className={cn("w-full flex items-center gap-4 p-4 rounded-2xl border text-left transition-all", selectedBarber === "any" ? "border-black bg-black/5" : "border-[#1e1e1e] bg-black shadow-sm hover:border-gray-400")}
            >
              <div className="w-12 h-12 rounded-full bg-[#141414] border border-[#1e1e1e] flex items-center justify-center text-2xl">✨</div>
              <div>
                <p className="font-semibold text-white">No Preference</p>
                <p className="text-sm text-[#777]">Next available barber</p>
              </div>
              {selectedBarber === "any" && <Check size={18} className="ml-auto text-white" />}
            </button>
            {barbers.map((b) => (
              <button key={b.id} onClick={() => setSelectedBarber(b.id)}
                className={cn("w-full flex items-center gap-4 p-4 rounded-2xl border text-left transition-all", selectedBarber === b.id ? "border-black bg-black/5" : "border-[#1e1e1e] bg-black shadow-sm hover:border-gray-400")}
              >
                {b.photo
                  ? <img src={b.photo} alt={b.name} className="w-14 h-14 rounded-full object-cover border border-[#1e1e1e]" />
                  : <div className="w-14 h-14 rounded-full bg-black/10 border border-black flex items-center justify-center text-white font-bold text-xl">{b.name[0]}</div>
                }
                <div className="flex-1">
                  <p className="font-semibold text-white">{b.name}</p>
                  {b.bio && <p className="text-xs text-[#777] mt-0.5 line-clamp-1">{b.bio}</p>}
                  <span className="flex items-center gap-1 text-xs text-white mt-1">
                    <Star size={11} className="fill-gold" /> {b.rating} ({b.total_reviews} reviews)
                  </span>
                </div>
                {selectedBarber === b.id && <Check size={18} className="ml-auto flex-shrink-0 text-white" />}
              </button>
            ))}
          </div>
        )}

        {/* Service Step */}
        {step === serviceStepIndex && (
          <div className="space-y-4 animate-fade-in">
            <h2 className="text-lg font-semibold text-white">Choose services</h2>
            <p className="text-xs text-[#777] -mt-1">Pick one or more (e.g. cut + beard, or two haircuts for a family booking).</p>

            {/* Selected services summary — chips with remove + running total */}
            {servicesPicked.length > 0 && (
              <div className="bg-black/5 border border-[#1e1e1e] rounded-2xl p-3 space-y-2">
                <div className="flex flex-wrap gap-2">
                  {servicesPicked.map((s, idx) => (
                    <span key={s.id + idx} className="inline-flex items-center gap-1.5 bg-black/10 border border-black text-white rounded-full pl-3 pr-1 py-1 text-xs font-medium">
                      {s.name} · {formatCurrency(s.price)}
                      <button onClick={() => setSelectedServices(prev => prev.filter((_, i) => i !== idx))}
                        className="ml-0.5 w-5 h-5 rounded-full bg-black/10 hover:bg-gold/30 flex items-center justify-center" aria-label="Remove">
                        <X size={11} />
                      </button>
                    </span>
                  ))}
                </div>
                <div className="flex items-center justify-between text-sm pt-1 border-t border-black/10">
                  <span className="text-[#777]">{servicesPicked.length} service{servicesPicked.length !== 1 ? "s" : ""} · {totalDuration} min</span>
                  <span className="text-white font-bold">{formatCurrency(totalPrice)}</span>
                </div>
              </div>
            )}

            <div className="flex gap-2 flex-wrap">
              {categories.map((cat) => (
                <button key={cat} onClick={() => setCategoryFilter(cat)}
                  className={cn("px-4 py-1.5 rounded-full text-sm font-medium transition-all border", categoryFilter === cat ? "bg-gold text-black border-black" : "border-[#1e1e1e] text-[#777] hover:border-gray-400")}
                >{cat}</button>
              ))}
            </div>
            {filteredServices.length === 0 && (
              <div className="py-12 text-center text-[#777]">
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
                  className={cn("w-full flex items-center justify-between p-4 rounded-2xl border text-left transition-all", isPicked ? "border-black bg-black/5" : "border-[#1e1e1e] bg-black shadow-sm hover:border-gray-400")}
                >
                  <div className="flex-1 pr-4 cursor-pointer" onClick={() => toggleService(svc.id)}>
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-semibold text-white">{svc.name}</p>
                      <Badge>{svc.category}</Badge>
                      {count > 1 && <span className="text-xs text-white">× {count}</span>}
                    </div>
                    {svc.description && <p className="text-xs text-[#777] mt-0.5">{svc.description}</p>}
                    <p className="text-xs text-[#777] mt-1 flex items-center gap-1"><Clock size={11} /> {svc.duration_minutes} min</p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className="text-lg font-bold text-white">{formatCurrency(svc.price)}</span>
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
                  className="w-9 h-9 rounded-full bg-[#141414] hover:bg-[#141414]/80 flex items-center justify-center text-white transition-colors"
                >
                  <ChevronLeft size={18} />
                </button>
                <button
                  aria-label="Next week"
                  onClick={() => { const d = new Date(weekStart); d.setDate(d.getDate() + 7); setSelectedDate(d); setSelectedTime(null); }}
                  className="w-9 h-9 rounded-full bg-[#141414] hover:bg-[#141414]/80 flex items-center justify-center text-white transition-colors"
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
                  // Date-aware availability: also disables days where every
                  // barber who'd normally work that weekday has an approved
                  // full-day time-off covering this specific date.
                  const isBarberOff = flow === "barber-first" && selectedBarber && selectedBarber !== "any" && !isBarberAvailableOnDate(selectedBarber, day);
                  const isShopClosed = flow !== "barber-first" && !isShopAvailableOnDate(day);
                  const disabled = isPast || !!isBarberOff || isShopClosed;
                  const isTodayDay = dayStr === todayStr;
                  return (
                    <button key={dayStr} disabled={disabled}
                      onClick={() => { if (!disabled) { setSelectedDate(day); setSelectedTime(null); } }}
                      className="flex flex-col items-center py-1.5 disabled:cursor-not-allowed"
                    >
                      <span className={cn("text-[10px] uppercase tracking-wider", disabled ? "text-[#555]" : "text-[#777]")}>
                        {day.toLocaleDateString("en-CA", { weekday: "narrow" })}
                      </span>
                      <span className={cn(
                        "text-base font-medium mt-1.5 w-9 h-9 rounded-full inline-flex items-center justify-center",
                        isSelectedDay ? "bg-black text-white font-semibold" :
                        isTodayDay && !disabled ? "text-white" :
                        disabled ? "text-[#555]" : "text-white",
                      )}>
                        {day.getDate()}
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* Date title row (center) */}
              <div className="px-4 py-2 border-t border-[#1e1e1e]/40 text-center">
                <p className="text-sm font-medium text-white">
                  {selectedDate
                    ? selectedDate.toLocaleDateString("en-CA", { weekday: "long", month: "short", day: "numeric", year: "numeric" })
                    : "Pick a day"}
                </p>
              </div>

              {/* Timeline */}
              <div ref={timelineRef} className="flex-1 overflow-y-auto border-t border-[#1e1e1e]/40">
                {!selectedDate && (
                  <div className="py-16 text-center text-[#777] text-sm">Tap a day above to see openings.</div>
                )}
                {selectedDate && slotsLoading && (
                  <div className="py-16 text-center text-[#777] text-sm">
                    <div className="w-6 h-6 border-2 border-black border-t-gold rounded-full animate-spin mx-auto mb-3" />
                    Loading…
                  </div>
                )}
                {selectedDate && !slotsLoading && slotGrid.length === 0 && (
                  <div className="py-12 text-center px-4">
                    <p className="text-[#777] text-sm">No openings on this day.</p>
                    {selectedDate && waitlistedDates.has(formatDateForDb(selectedDate)) ? (
                      <p className="mt-3 text-xs text-emerald-400 flex items-center justify-center gap-1">
                        <Check size={13} /> You&apos;re on the waitlist for this day
                      </p>
                    ) : (
                      <>
                        <button
                          onClick={openWaitlist}
                          className="mt-4 inline-flex items-center gap-1.5 rounded-xl border border-gold/40 bg-gold/10 px-4 py-2 text-sm font-semibold text-gold hover:bg-gold/20 transition-colors"
                        >
                          🔔 Notify me if a spot opens
                        </button>
                        <p className="mt-2 text-[11px] text-[#777]">We&apos;ll text or email you the moment someone cancels.</p>
                      </>
                    )}
                  </div>
                )}
                {selectedDate && !slotsLoading && slotGrid.length > 0 && bookableSlots.length === 0 && servicesPicked.length > 1 && (
                  <div className="m-4 py-5 text-center bg-orange-500/5 border border-orange-500/20 rounded-xl px-4">
                    <p className="text-orange-300 text-sm font-medium">
                      {flow === "barber-first" ? "This barber doesn't have" : "No barber has"} {totalDuration} min open on this day
                    </p>
                    <p className="text-xs text-[#777] mt-1">Try another day.</p>
                    {selectedDate && waitlistedDates.has(formatDateForDb(selectedDate)) ? (
                      <p className="mt-3 text-xs text-emerald-400 flex items-center justify-center gap-1">
                        <Check size={13} /> You&apos;re on the waitlist for this day
                      </p>
                    ) : (
                      <button
                        onClick={openWaitlist}
                        className="mt-3 inline-flex items-center gap-1.5 rounded-xl border border-gold/40 bg-gold/10 px-4 py-2 text-sm font-semibold text-gold hover:bg-gold/20 transition-colors"
                      >
                        🔔 Notify me if a spot opens
                      </button>
                    )}
                  </div>
                )}
                {selectedDate && !slotsLoading && bookableSlots.length > 0 && (
                  <div className="relative" style={{ height: `${(endHour - startHour) * ROW_PX + 24}px` }}>
                    {/* Hour lines */}
                    {hoursToShow.map((h, i) => (
                      <div key={h} className="absolute left-0 right-0 flex items-start" style={{ top: `${i * ROW_PX}px` }}>
                        <div className="w-14 pl-3 pr-2 text-[10px] text-[#777] pt-0">
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
                              ? "bg-black/15 border-black ring-1 ring-black/20"
                              : "bg-sky-500/15 hover:bg-sky-500/25 border-sky-400",
                          )}
                        >
                          <span className={cn("text-xs font-semibold leading-none", isSelectedSlot ? "text-white" : "text-sky-200")}>
                            {slot}
                          </span>
                          <span className={cn("text-[10px] leading-none ml-2 truncate", isSelectedSlot ? "text-white/80" : "text-sky-300/70")}>
                            {barberIds.length === 1
                              ? `with ${barbers.find(b => b.id === barberIds[0])?.name?.split(" ")[0] ?? "barber"}`
                              : `${barberIds.length} barbers free`}
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
                      <div className="bg-black shadow-sm border border-[#1e1e1e] rounded-t-2xl sm:rounded-2xl p-5 w-full max-w-sm space-y-3 animate-fade-in">
                        <div className="flex items-center justify-between">
                          <div>
                            <h3 className="text-base font-bold text-white">Choose a barber</h3>
                            <p className="text-xs text-[#777] mt-0.5">{expandedSlot} · {slotBarbers.length} available</p>
                          </div>
                          <button onClick={() => setExpandedSlot(null)} className="text-[#777] hover:text-white"><X size={18} /></button>
                        </div>
                        <div className="space-y-2">
                          {slotBarbers.map((b) => (
                            <button key={b.id}
                              onClick={() => { setSelectedTime(expandedSlot); setSelectedBarber(b.id); setExpandedSlot(null); }}
                              className="w-full flex items-center gap-3 px-4 py-3 rounded-xl border border-[#1e1e1e] bg-[#141414] hover:border-gray-400 text-left transition-all"
                            >
                              {b.photo
                                ? <img src={b.photo} alt={b.name} className="w-10 h-10 rounded-full object-cover" />
                                : <div className="w-10 h-10 rounded-full bg-black/10 flex items-center justify-center text-white font-bold">{b.name[0]}</div>
                              }
                              <div className="flex-1">
                                <p className="text-sm font-semibold text-white">{b.name}</p>
                                <p className="text-xs text-white flex items-center gap-0.5"><Star size={10} className="fill-gold" /> {b.rating} ({b.total_reviews} reviews)</p>
                              </div>
                              <ChevronRight size={16} className="text-[#777]" />
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
                <label className="text-sm font-medium text-[#999]">{label}</label>
                <input type={type} value={clientInfo[key]}
                  onChange={(e) => {
                    const val = key === "phone" ? formatPhone(e.target.value) : e.target.value;
                    setClientInfo({ ...clientInfo, [key]: val });
                    if (clientErrors[key]) setClientErrors(prev => { const n = { ...prev }; delete n[key]; return n; });
                  }}
                  placeholder={placeholder}
                  className={cn("w-full bg-[#141414] border rounded-xl px-4 py-3 text-sm text-white placeholder:text-[#555] focus:outline-none focus:ring-2 focus:border-black transition-all",
                    clientErrors[key] ? "border-red-500/50 focus:ring-red-500/30" : "border-[#1e1e1e] focus:ring-black/20")}
                />
                {clientErrors[key] && <p className="text-xs text-red-400">{clientErrors[key]}</p>}
              </div>
            ))}
            <p className="text-xs text-[#999]">You&apos;ll receive a confirmation to the details provided.</p>
          </div>
        )}

        {/* Promo Code Step */}
        {step === promoStepIndex && (
          <div className="space-y-4 animate-fade-in">
            <h2 className="text-lg font-semibold text-white">Have a promo code?</h2>
            <p className="text-[#777] text-sm">Optional — skip if you don&apos;t have one.</p>
            <div className="flex gap-2">
              <input type="text" value={promoCode} onChange={(e) => setPromoCode(e.target.value.toUpperCase())} placeholder="e.g. WELCOME10"
                className="flex-1 bg-[#141414] border border-[#1e1e1e] rounded-xl px-4 py-2.5 text-sm text-white placeholder:text-[#555] focus:outline-none focus:ring-2 focus:ring-black/20 uppercase tracking-widest"
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
          const depositTotal = shopCanCharge ? servicesPicked.reduce(
            (sum, s) => sum + (s.deposit_required ? (s.deposit_amount ?? 0) : 0),
            0
          ) : 0;
          return (
          <div className="space-y-4 animate-fade-in">
            <h2 className="text-lg font-semibold text-white">Review your booking</h2>
            <div className="bg-black shadow-sm border border-[#1e1e1e] rounded-2xl p-5 space-y-3">
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
                  <span className="text-[#777]">{label}</span>
                  <span className="text-white font-medium text-right max-w-[60%]">{value}</span>
                </div>
              ))}
              <div className="border-t border-[#1e1e1e] pt-3 space-y-1.5">
                {servicesPicked.map((s) => (
                  <div key={s.id} className="flex justify-between text-sm">
                    <span className="text-[#777]">{s.name} <span className="text-[#999]">· {s.duration_minutes}min</span></span>
                    <span className="text-white">{formatCurrency(s.price ?? 0)}</span>
                  </div>
                ))}
                {promoApplied && (
                  <div className="flex justify-between text-sm">
                    <span className="text-emerald-400">Discount ({promoApplied.code})</span>
                    <span className="text-emerald-400">-{formatCurrency(discount)}</span>
                  </div>
                )}
                <div className="flex justify-between font-bold pt-1 border-t border-[#1e1e1e]/50">
                  <span className="text-white">Total</span>
                  <span className="text-white text-lg">{formatCurrency(total)}</span>
                </div>
                {depositTotal > 0 && (
                  <div className="flex justify-between text-sm pt-1">
                    <span className="text-white">Deposit due now</span>
                    <span className="text-white font-semibold">{formatCurrency(depositTotal)}</span>
                  </div>
                )}
              </div>
            </div>
            {depositTotal > 0
              ? <p className="text-xs text-white/70 text-center">💳 A ${depositTotal} deposit is required to secure this booking · Balance paid at the shop</p>
              : <p className="text-xs text-[#999] text-center">Payment collected at the shop · Free cancellation 24h before</p>
            }

            {/* No-show policy heads-up — always shown when this shop has no-show
                protection on and there's a balance, so the customer sees the
                charge policy before booking. The mandatory CONSENT checkbox
                still lives in the pay-method modal (only the online/card path
                needs to accept it); an in-person booker is never forced to. */}
            {cardForNoShow && (
              <p className="text-xs text-amber-200/90 text-center bg-amber-500/5 border border-amber-500/20 rounded-xl px-3 py-2">
                ⓘ <span className="font-semibold">No-show policy:</span> if you pay online, your card is{" "}
                {willSaveCard ? <>securely <span className="font-semibold">saved</span> (not charged now)</> : <>securely <span className="font-semibold">held</span></>}{" "}
                and charged after your visit — or a no-show fee of <span className="font-semibold">{noShowFeeLabel}</span> if you don&apos;t show up. Paying in person takes no card.
              </p>
            )}
          </div>
          );
        })()}
      </div>

      {/* Floating pill action bar — running total + primary CTA.
          Squire-style "always-visible price tally" pattern, but rendered
          as a rounded pill that floats with margin instead of a square
          edge-to-edge bar, so it reads distinct from theirs. */}
      <div className="fixed bottom-0 left-0 right-0 z-20 px-3 pb-3 pt-2 pointer-events-none">
        <div className="pointer-events-auto max-w-2xl mx-auto bg-black border border-white/15 rounded-full pl-5 pr-2 py-2 flex items-center gap-3 shadow-[0_8px_32px_rgba(0,0,0,0.45)]">
          {/* Running total — only shown when at least one service is picked.
              Falls back to a tiny step caption otherwise so the bar isn't empty. */}
          {servicesPicked.length > 0 ? (
            <div className="flex-1 min-w-0">
              <p className="text-[10px] uppercase tracking-wider text-white/50 leading-none">
                {servicesPicked.length} {servicesPicked.length === 1 ? "service" : "services"} · {totalDuration} min
              </p>
              <p className="text-base font-bold text-white leading-tight mt-0.5">
                {formatCurrency(total)}
              </p>
            </div>
          ) : (
            <p className="flex-1 text-xs text-white/60 leading-tight">
              Step {step + 1} of {STEPS.length} · {STEPS[step]}
            </p>
          )}

          {step > 0 && (
            <button
              type="button"
              onClick={() => setStep(step - 1)}
              aria-label="Back"
              className="w-9 h-9 rounded-full border border-white/15 text-white/80 hover:text-white hover:border-white/30 flex items-center justify-center flex-shrink-0 transition-colors"
            >
              <ChevronLeft size={16} />
            </button>
          )}

          {step < STEPS.length - 1 ? (
            <button
              type="button"
              disabled={!canNext()}
              onClick={() => setStep(step + 1)}
              className="rounded-full bg-black text-white px-5 py-2 text-sm font-semibold flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-black/90 transition-colors flex-shrink-0"
            >
              Continue <ChevronRight size={16} />
            </button>
          ) : (
            <button
              type="button"
              disabled={saving}
              onClick={confirmBooking}
              className="rounded-full bg-black text-white px-5 py-2 text-sm font-semibold flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-black/90 transition-colors flex-shrink-0"
            >
              {saving ? (
                <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              ) : (
                <Check size={16} />
              )}
              Confirm
            </button>
          )}
        </div>
      </div>

      {/* Pay-method choice modal — only ever opens when both online and
          in-person are valid options for this shop. Once a button is
          clicked we re-enter confirmBooking with the choice in state. */}
      {showPayChoiceModal && (
        <>
          <div className="fixed inset-0 bg-black/60 z-[80]" onClick={() => setShowPayChoiceModal(false)} />
          <div className="fixed inset-0 z-[90] flex items-center justify-center p-4">
            <div className="bg-white border border-[#1e1e1e] rounded-2xl p-6 w-full max-w-md space-y-5 shadow-xl">
              <div>
                <h2 className="text-lg font-bold text-white">How would you like to pay?</h2>
                <p className="text-sm text-[#777] mt-1">You can pay now or settle up at the shop.</p>
              </div>

              {/* No-show consent — required only for the online (card) path.
                  Paying in person stays available without it, so the customer
                  can always avoid handing over a card. */}
              {cardForNoShow && noShowConsentBox}

              <button type="button" className="btn btn-primary w-full disabled:opacity-40 disabled:cursor-not-allowed" style={{ padding: "1rem" }}
                disabled={cardForNoShow && !noShowConsent}
                onClick={() => { setShowPayChoiceModal(false); setPayMethodChoice("online"); setTimeout(confirmBooking, 0); }}>
                💳 Pay online now (secure · Stripe)
              </button>

              <button type="button" className="btn btn-outline-dark w-full" style={{ padding: "1rem" }}
                onClick={() => { setShowPayChoiceModal(false); setPayMethodChoice("in_person"); setTimeout(confirmBooking, 0); }}>
                🏪 Pay in person at the shop
              </button>

              <p className="text-xs text-[#777] text-center">
                Paying in person? Your booking is reserved as pending until the shop confirms.
              </p>
            </div>
          </div>
        </>
      )}

      {/* Smart-waitlist signup modal */}
      {showWaitlistModal && (
        <>
          <div className="fixed inset-0 bg-black/60 z-[80]" onClick={() => !waitlistSaving && setShowWaitlistModal(false)} />
          <div className="fixed inset-0 z-[90] flex items-center justify-center p-4">
            <div className="bg-black border border-[#1e1e1e] rounded-2xl p-6 w-full max-w-md space-y-4 shadow-xl">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-bold text-white">Join the waitlist</h2>
                  <p className="text-sm text-[#777] mt-0.5">
                    {selectedDate ? selectedDate.toLocaleDateString("en-CA", { weekday: "long", month: "short", day: "numeric" }) : ""}
                  </p>
                </div>
                <button onClick={() => !waitlistSaving && setShowWaitlistModal(false)} className="text-[#777] hover:text-white"><X size={18} /></button>
              </div>
              <p className="text-xs text-[#777]">
                This day is full. Leave your details and we&apos;ll text or email you the moment a spot opens — first to reply gets it.
              </p>
              <div className="space-y-3">
                <input
                  value={waitlistForm.name}
                  onChange={e => setWaitlistForm(p => ({ ...p, name: e.target.value }))}
                  placeholder="Your name"
                  className="w-full bg-[#141414] border border-[#1e1e1e] rounded-xl px-4 py-2.5 text-sm text-white placeholder:text-[#777] focus:outline-none focus:border-gold"
                />
                <input
                  value={waitlistForm.email}
                  onChange={e => setWaitlistForm(p => ({ ...p, email: e.target.value }))}
                  placeholder="Email"
                  type="email"
                  className="w-full bg-[#141414] border border-[#1e1e1e] rounded-xl px-4 py-2.5 text-sm text-white placeholder:text-[#777] focus:outline-none focus:border-gold"
                />
                <input
                  value={waitlistForm.phone}
                  onChange={e => setWaitlistForm(p => ({ ...p, phone: formatPhone(e.target.value) }))}
                  placeholder="Phone (for a text alert)"
                  type="tel"
                  className="w-full bg-[#141414] border border-[#1e1e1e] rounded-xl px-4 py-2.5 text-sm text-white placeholder:text-[#777] focus:outline-none focus:border-gold"
                />
                <p className="text-[11px] text-[#777] -mt-1">Add at least an email or phone.</p>
              </div>
              <div className="flex gap-3 pt-1">
                <Button variant="outline" className="flex-1" onClick={() => setShowWaitlistModal(false)}>Cancel</Button>
                <Button className="flex-1" loading={waitlistSaving} onClick={joinWaitlist}>Notify me</Button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
