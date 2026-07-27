"use client";
import { useState, useEffect, useCallback, useRef, type ReactNode } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight, Star, Clock, Check, Calendar, Share2, User, Tag, X } from "lucide-react";
import { Logo } from "@/components/ui/logo";
import { AvatarImage } from "@/components/ui/avatar-image";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn, formatCurrency, formatDateForDb, isDateInPast, getSlotsInRange, generate24hSlots, timeToMinutes, dbTimeToDisplay, occupiedSlots, prettyDate } from "@/lib/utils";
import { formatPhone, validatePhone, validateEmail, isWithin6Months, isSlotInPast, effectivePlan, planHasFeature, noShowFeeDollars } from "@/lib/validation";
import { supabase } from "@/lib/supabase";
import type { Shop, Barber, Service, PromoCode } from "@/lib/database.types";

// ─── Types ────────────────────────────────────────────────────────────────────
interface SlotAvailability {
  slot: string;
  available: boolean;
  barberIds: string[];
}

interface Toast { msg: string; ok: boolean }

// Booking-window granularity (minutes between offered start times). Shops can
// opt into 15-min windows in Settings; everyone else stays on 30.
function slotIntervalOf(shop: { booking_settings?: unknown } | null | undefined): number {
  const v = (shop?.booking_settings as { slot_interval_minutes?: number } | null)?.slot_interval_minutes;
  return v === 15 ? 15 : 30;
}

// ── Shop-header helpers ──────────────────────────────────────────────────────
const displayUrl = (u: string) => u.replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/$/, "");
const ensureHttp = (u: string) => (/^https?:\/\//i.test(u) ? u : `https://${u}`);
// Pull a clean handle out of whatever the owner typed — a bare handle, an
// @handle, or a full profile URL (instagram.com/handle). A bare "instagram.com"
// with no profile yields "" so we can hide the row instead of showing garbage.
const igHandle = (u: string) =>
  (u || "").trim()
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .replace(/^instagram\.com\/?/i, "")
    .replace(/^@/, "")
    .replace(/[/?#].*$/, "")
    .trim();
// A Google Maps DIRECTIONS link to the shop. Prefer the saved place_id for an
// exact pin; otherwise use the street address ONLY (never the shop name, which
// makes Maps do a fuzzy business search). Name is a last resort if no address.
const directionsUrl = (shop: { name?: string | null; address?: string | null; city?: string | null; province?: string | null; postal_code?: string | null; google_place_id?: string | null }) => {
  // Canadian unit-civic addresses like "106-630 Salisbury Rd" confuse Google's
  // geocoder (it reads "106-630" as a civic number and lands nearby). Drop a
  // leading unit prefix ("106-", "#106-", "Unit 106, ") so the query is the
  // plain street number, and include the postal code, which pins the exact
  // block far more reliably than a street number alone.
  const street = (shop.address ?? "")
    .replace(/^\s*(?:unit|apt|apartment|suite|ste|#)\.?\s*\d+\s*[-,]\s*/i, "")
    .replace(/^\s*\d+\s*-\s*(?=\d)/, "")
    .trim();
  const address = [street, shop.city, shop.province, shop.postal_code].filter(Boolean).join(", ");
  const dest = encodeURIComponent(address || shop.name || "");
  const base = `https://www.google.com/maps/dir/?api=1&destination=${dest}`;
  return shop.google_place_id ? `${base}&destination_place_id=${shop.google_place_id}` : base;
};
const shopInitials = (name: string | null | undefined) =>
  (name ?? "").split(/\s+/).filter(Boolean).map(w => w[0]).join("").slice(0, 2).toUpperCase() || "CW";

// Instagram glyph (lucide dropped its brand icons, so inline the outline).
function InstagramIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-white/90" aria-hidden>
      <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
      <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
      <line x1="17.5" y1="6.5" x2="17.51" y2="6.5" />
    </svg>
  );
}

// One tappable contact row — icon tile + text (iOS-list style, no chevron).
function ContactRow({ icon, text, href }: { icon: ReactNode; text: string; href: string }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer"
       className="flex items-center gap-3 py-0.5 active:opacity-60 transition-opacity">
      <span className="w-11 h-11 rounded-xl bg-[#141414] border border-[#242424] flex items-center justify-center text-lg flex-shrink-0">{icon}</span>
      <span className="flex-1 text-[15px] text-white/90 truncate">{text}</span>
    </a>
  );
}

// One barber's availability, as returned by /api/availability (no customer PII).
type AvailBarber = {
  id: string;
  name: string;
  start_time: string | null;
  end_time: string | null;
  fullDayOff: boolean;
  busy: { time_slot: string; duration: number }[];
  blocked: { start_time: string; end_time: string }[];
};

// Every booked/blocked start-slot for one barber, at the shop's interval.
function bookedSlotsFor(b: AvailBarber, interval: number): string[] {
  const blockedSlotSet = new Set<string>();
  for (const o of b.blocked) {
    const blockStart = timeToMinutes(dbTimeToDisplay(o.start_time));
    const blockEnd = timeToMinutes(dbTimeToDisplay(o.end_time));
    for (const slot of generate24hSlots(interval)) {
      const m = timeToMinutes(slot);
      if (m >= blockStart && m < blockEnd) blockedSlotSet.add(slot);
    }
  }
  return [
    ...b.busy.flatMap((a) => occupiedSlots(a.time_slot, a.duration, interval)),
    ...Array.from(blockedSlotSet),
  ];
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
  const [loadError, setLoadError] = useState(false);
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
  const [bookingPending, setBookingPending] = useState(false); // in-person booking awaiting shop approval
  const [freshStart, setFreshStart] = useState(false); // "Book another" clicked → ignore the paid=1 URL so it doesn't re-show the payment spinner
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
  // Optional tip the customer adds at booking (online payment only). Percent of
  // the discounted service subtotal; charged with the card on completion.
  const [tipPercent, setTipPercent] = useState(0);
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
  // Which date the current slotGrid was loaded for — lets the auto-advance
  // effect below know the grid reflects the *current* selectedDate (not a
  // stale previous day) before deciding whether to skip to the next day.
  const [slotsForDate, setSlotsForDate] = useState<string | null>(null);
  // Tracks the "jump to the first day with real openings" auto-navigation so
  // manual day/week taps can cancel it and it can't loop forever.
  const autoAdvanceRef = useRef<{ active: boolean; tries: number }>({ active: false, tries: 0 });
  const [expandedSlot, setExpandedSlot] = useState<string | null>(null);
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
      setLoadError(false);
      try {
        // maybeSingle (not single): 0 rows → data null + error null (a genuinely
        // invalid link → "Shop Not Found"); a real DB/network error → error set
        // (→ retry screen). single() conflated the two, so a transient failure
        // wrongly showed "Shop Not Found" on this public revenue page.
        const { data: shopData, error } = await supabase
          .from("shops")
          // Public/anon read — explicit columns only. Never select("*"): it would
          // ship stripe_customer_id / stripe_subscription_id / owner_id to any
          // visitor. (stripe_account_id + stripe_connected are needed here to
          // decide if online pay is available and are non-secret identifiers.)
          .select("id, name, slug, status, logo, address, city, province, postal_code, phone, email, website, instagram, google_place_id, allow_pay_in_person, booking_settings, subscription_plan, subscription_status, stripe_account_id, stripe_connected")
          .eq("slug", shopslug)
          .maybeSingle();
        if (error) { setLoadError(true); setPageLoading(false); return; }
        setShop(shopData as Shop | null);
        if (shopData && shopData.status === "approved") {
          const [{ data: b }, { data: s }] = await Promise.all([
            // Public booking page — never expose staff PII (email/phone),
            // commission rates, or user_id (the latter was the signal an attacker
            // used to spot a claimable barber row). Select only display fields.
            supabase.from("barbers").select("id, shop_id, name, photo, bio, rating, total_reviews, is_active").eq("shop_id", shopData.id).eq("is_active", true),
            supabase.from("services").select("*").eq("shop_id", shopData.id).eq("is_active", true),
          ]);
          setBarbers((b ?? []) as Barber[]);
          setServices((s ?? []) as Service[]);
        }
      } catch {
        setLoadError(true); // network failure — not an invalid link
      } finally {
        setPageLoading(false);
      }
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

  // Fetch real availability from the server (service-role). The booking page is
  // anonymous and the appointments/time-off RLS is stakeholder-only, so a direct
  // client query returns NOTHING — every slot would look free. This route reads
  // the truth (no PII) so the grid reflects the real database.
  const fetchAvailability = useCallback(async (date: Date, barberId?: string): Promise<AvailBarber[]> => {
    if (!shop) return [];
    const res = await fetch("/api/availability", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ shop_id: shop.id, date: formatDateForDb(date), barber_id: barberId ?? null }),
    }).catch(() => null);
    if (!res || !res.ok) return [];
    const data = await res.json().catch(() => ({ barbers: [] }));
    return (data.barbers ?? []) as AvailBarber[];
  }, [shop]);

  // ── Load slot grid (Option A — time first) ─────────────────────────────────
  const loadTimeFirstSlots = useCallback(async (date: Date) => {
    if (!shop) return;
    setSlotsLoading(true);
    setSlotGrid([]);
    setExpandedSlot(null);

    const interval = slotIntervalOf(shop);
    const barberList = await fetchAvailability(date);
    if (barberList.length === 0) { setSlotGrid([]); setSlotsForDate(formatDateForDb(date)); setSlotsLoading(false); return; }

    const slotMap: Record<string, { available: boolean; barberIds: string[] }> = {};
    for (const b of barberList) {
      // A whole-day type-off, or no working hours this weekday → no slots.
      if (b.fullDayOff || !b.start_time || !b.end_time) continue;
      const bookedSlots = bookedSlotsFor(b, interval);
      const slots = getSlotsInRange(b.start_time, b.end_time, date, bookedSlots, interval);
      slots.forEach(({ slot, available }) => {
        if (!slotMap[slot]) slotMap[slot] = { available: false, barberIds: [] };
        if (available) {
          slotMap[slot].available = true;
          slotMap[slot].barberIds.push(b.id);
        }
      });
    }

    setSlotGrid(
      Object.entries(slotMap)
        .sort(([a], [b]) => timeToMinutes(a) - timeToMinutes(b)) // chronological — string sort would put 9 AM after 12 PM
        .map(([slot, v]) => ({ slot, ...v }))
    );
    setSlotsForDate(formatDateForDb(date));
    setSlotsLoading(false);
  }, [shop, fetchAvailability]);

  // ── Load slot grid (Option B — barber first) ───────────────────────────────
  const loadBarberFirstSlots = useCallback(async (barberId: string, date: Date) => {
    if (!shop) return;
    setSlotsLoading(true);
    setSlotGrid([]);
    const interval = slotIntervalOf(shop);
    const list = await fetchAvailability(date, barberId);
    const b = list[0];
    if (!b || b.fullDayOff || !b.start_time || !b.end_time) { setSlotGrid([]); setSlotsForDate(formatDateForDb(date)); setSlotsLoading(false); return; }
    const bookedSlots = bookedSlotsFor(b, interval);
    const slots = getSlotsInRange(b.start_time, b.end_time, date, bookedSlots, interval);
    setSlotGrid(slots.map(({ slot, available }) => ({ slot, available, barberIds: available ? [barberId] : [] })));
    setSlotsForDate(formatDateForDb(date));
    setSlotsLoading(false);
  }, [shop, fetchAvailability]);

  // ── Trigger slot load when date changes ───────────────────────────────────
  useEffect(() => {
    if (!selectedDate) return;
    // "No Preference" (selectedBarber === "any") has no single barber, so load
    // the merged all-barbers grid instead — loadBarberFirstSlots would query a
    // barber literally named "any", get zero slots for EVERY day, and the
    // auto-advance effect below would then hop through ~20 empty days looking
    // for an opening (the glitch), leaving the customer unable to book.
    if (flow === "time-first" || selectedBarber === "any") loadTimeFirstSlots(selectedDate);
    else if (flow === "barber-first" && selectedBarber) loadBarberFirstSlots(selectedBarber, selectedDate);
  }, [selectedDate, flow, selectedBarber, loadTimeFirstSlots, loadBarberFirstSlots]);

  // How many bookable start-times a slot grid has for a given date — mirrors
  // the render's `bookableSlots` (drops past times on today; requires the full
  // multi-slot block to fit for multi-service). Used by the auto-advance effect
  // to decide if a day is worth landing on. Kept self-contained (reads state
  // directly) so it can run before the render-body derivations.
  const bookableCountFor = useCallback((grid: SlotAvailability[], dateStr: string | null): number => {
    if (!shop || grid.length === 0) return 0;
    const interval = slotIntervalOf(shop);
    const picked = selectedServices.map(id => services.find(s => s.id === id)).filter(Boolean) as Service[];
    const dur = picked.reduce((sum, s) => sum + (s.duration_minutes ?? 30), 0);
    const need = Math.max(1, Math.ceil((dur || interval) / interval));
    const isToday = dateStr === formatDateForDb(new Date());
    let count = 0;
    for (let i = 0; i < grid.length; i++) {
      const s = grid[i];
      if (!s.available) continue;
      if (isToday && isSlotInPast(s.slot)) continue;
      if (need > 1) {
        let intersection = new Set(s.barberIds);
        let fits = true;
        for (let j = 1; j < need; j++) {
          const next = grid[i + j];
          if (!next || !next.available) { fits = false; break; }
          intersection = new Set(Array.from(intersection).filter(id => next.barberIds.includes(id)));
          if (intersection.size === 0) { fits = false; break; }
        }
        if (!fits) continue;
      }
      count++;
    }
    return count;
  }, [shop, selectedServices, services]);

  // Find the next day (from `after`, exclusive-optional) on which the relevant
  // barber is actually scheduled and not on full-day time-off. Returns null if
  // none within `span` days. Shared by the initial pick + the auto-advance.
  const nextScheduledDay = useCallback((after: Date, inclusive: boolean, span = 60): Date | null => {
    const base = new Date(after); base.setHours(0, 0, 0, 0);
    const specificBarber =
      flow === "barber-first" && selectedBarber && selectedBarber !== "any" ? selectedBarber : null;
    // Never seed/advance past the shop's advance-booking window.
    const adv = Math.min(60, Math.max(1, Number((shop?.booking_settings as { advance_days?: number } | null)?.advance_days ?? 15)));
    const windowEnd = new Date(); windowEnd.setHours(0, 0, 0, 0); windowEnd.setDate(windowEnd.getDate() + adv);
    for (let i = inclusive ? 0 : 1; i <= span; i++) {
      const d = new Date(base); d.setDate(base.getDate() + i);
      if (d > windowEnd) return null;
      const ok = specificBarber ? isBarberAvailableOnDate(specificBarber, d) : isShopAvailableOnDate(d);
      if (ok) return d;
    }
    return null;
  }, [flow, selectedBarber, isShopAvailableOnDate, isBarberAvailableOnDate, shop]);

  // Auto-select the nearest day when the customer reaches the "When" step
  // without a day chosen. It used to open on an empty "Pick a day" void. It
  // seeds with the first *scheduled* day; the auto-advance effect below then
  // hops forward to the first day with *real openings* once slots load (a
  // scheduled day can still be fully booked or, for today, all in the past).
  // Falls back to today so we always render a real day, never a blank screen.
  useEffect(() => {
    const whenStep = flow === "time-first" ? 1 : 2;
    if (step !== whenStep || selectedDate) return;
    if (barbers.length === 0 || Object.keys(barberDows).length === 0) return;
    const base = new Date(); base.setHours(0, 0, 0, 0);
    autoAdvanceRef.current = { active: true, tries: 0 };
    setSelectedDate(nextScheduledDay(base, true) ?? base);
  }, [step, flow, selectedDate, barbers, barberDows, nextScheduledDay]);

  // Auto-advance: once the seeded/selected day's slots have loaded, if it has
  // NO bookable openings, hop to the next scheduled day and try again — so the
  // customer lands on a day they can actually book rather than a dead-empty
  // timeline. Bounded by `tries` and cancelled by any manual day/week tap.
  useEffect(() => {
    if (!autoAdvanceRef.current.active || !selectedDate) return;
    const selStr = formatDateForDb(selectedDate);
    if (slotsLoading || slotsForDate !== selStr) return; // wait for THIS day's slots
    if (bookableCountFor(slotGrid, selStr) > 0) { autoAdvanceRef.current.active = false; return; } // landed on a good day
    if (autoAdvanceRef.current.tries >= 20) { autoAdvanceRef.current.active = false; return; } // give up → empty state shows
    const next = nextScheduledDay(selectedDate, false);
    if (!next) { autoAdvanceRef.current.active = false; return; } // no scheduled days ahead
    autoAdvanceRef.current.tries += 1;
    setSelectedDate(next);
  }, [selectedDate, slotsLoading, slotsForDate, slotGrid, bookableCountFor, nextScheduledDay]);

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


  // ── Apply promo code ───────────────────────────────────────────────────────
  const applyPromo = async () => {
    if (!promoCode.trim() || !shop) return;
    setPromoLoading(true);
    setPromoError("");
    // Server validates existence + expiry + usage cap + once-per-customer, and
    // returns the authoritative discount (the client can't fake a bigger one).
    try {
      const res = await fetch("/api/promo/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shop_id: shop.id, code: promoCode, email: clientInfo.email, phone: clientInfo.phone, subtotal: totalPrice }),
      });
      const data = await res.json();
      if (data.valid) {
        setPromoApplied({ code: data.code, discount_type: data.discount_type, discount_value: data.discount_value } as PromoCode);
      } else {
        setPromoError(data.error || "Invalid or expired promo code.");
        setPromoApplied(null);
      }
    } catch {
      setPromoError("Couldn't validate the code. Please try again.");
      setPromoApplied(null);
    } finally {
      setPromoLoading(false);
    }
  };

  // ── Confirm booking ────────────────────────────────────────────────────────
  const confirmBooking = async () => {
    if (!shop || selectedServices.length === 0 || !selectedDate || !selectedTime) return;
    if (isDateInPast(selectedDate)) { showToast("Please select a future date.", false); return; }
    const advDays = Math.min(60, Math.max(1, Number((shop.booking_settings as { advance_days?: number } | null)?.advance_days ?? 15)));
    const windowEnd = new Date(); windowEnd.setHours(0, 0, 0, 0); windowEnd.setDate(windowEnd.getDate() + advDays);
    if (selectedDate > windowEnd) { showToast(`This shop only takes bookings up to ${advDays} day${advDays === 1 ? "" : "s"} ahead.`, false); return; }
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
    // The owner's `allow_pay_in_person` toggle is authoritative (see
    // canPayInPersonNow above). Online is available only when the shop can
    // actually charge (paid plan + finished Stripe Connect).
    //   • both  → let the customer choose (modal)
    //   • online only → straight to Stripe (modal only if a card + no-show
    //                    consent is required, so the consent box is shown)
    //   • in-person only → book in-person
    //   • neither → in-person is off AND the shop can't charge online yet;
    //               there's no way to take payment, so tell the customer.
    if (total > 0 && !payMethodChoice) {
      if (canPayOnlineNow && canPayInPersonNow) {
        setShowPayChoiceModal(true);
        return;
      }
      if (canPayOnlineNow) {
        if (cardForNoShow && !noShowConsent) { setShowPayChoiceModal(true); return; }
        setPayMethodChoice("online");
        setTimeout(confirmBooking, 0);
        return;
      }
      if (canPayInPersonNow) {
        setPayMethodChoice("in_person");
        setTimeout(confirmBooking, 0);
        return;
      }
      showToast("This shop requires online payment, which isn't available yet. Please contact the shop to book.", false);
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

    // Online-payment branch — the customer chose "pay online now". The API
    // falls back to the platform's Stripe account when the shop hasn't done
    // Connect, so no `stripe_connected` precondition is needed here.
    //
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
    // Amount to send: holds authorize the full total; saved cards + in-person +
    // free bookings charge nothing now.
    const chargeAmount = useHold ? total : 0;
    // Route to Stripe whenever paying online (hold or save).
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
            service_ids: selectedServices,
            service_name: servicesPicked.length > 1
              ? servicesPicked.map(s => s.name).join(" + ")
              : (service?.name ?? "Service"),
            client_name: clientInfo.name,
            client_email: clientInfo.email,
            client_phone: clientInfo.phone,
            date: formatDateForDb(selectedDate),
            time_slot: selectedTime,
            amount: chargeAmount,
            total_amount: total,
            subtotal: totalPrice,
            promo_code: promoApplied?.code ?? undefined,
            duration_minutes: servicesPicked.reduce((sum, s) => sum + (s.duration_minutes ?? 30), 0),
            service_names: servicesPicked.length > 1 ? servicesPicked.map(s => s.name).join(" + ") : "",
            hold: useHold,
            saveCard: useSaveCard,
            tip_amount: tipAmount, // optional tip; server caps + only applies online
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

    // Multi-service: ONE appointment that spans the combined length (e.g.
    // haircut 30 + beard 20 = a single 50-min booking), not one row per
    // service. The primary service stays as service_id; the full list lives in
    // notes and the block length in duration_minutes. Pre-assign the UUID so
    // the INSERT can use Prefer: return=minimal — anon customers don't match
    // any SELECT policy on appointments, so RETURNING would be rejected.
    // Pay-in-person bookings normally land as "pending" for the owner/barber to
    // Approve. When the shop turns on Auto-Confirm, skip that step and confirm
    // them straight away. (Online/prepaid bookings always confirm on payment.)
    // Re-read the shop's booking settings fresh at submit time — the page may
    // have loaded before the owner toggled Auto-Confirm, so don't trust the
    // possibly-stale in-memory copy.
    const isMulti = servicesPicked.length > 1;
    const combinedDuration = servicesPicked.reduce((sum, s) => sum + (s.duration_minutes ?? 30), 0);

    // Create the appointment SERVER-SIDE. The anonymous booking page can't read
    // appointments under RLS, so a client-side conflict check is blind (that's
    // how two customers grabbed the same slot). The route checks conflicts with
    // the service-role client, resolves "Any Available" to a concrete free
    // barber, decides auto-confirm from the shop's live settings, and lets the
    // DB unique index backstop exact-slot races.
    const res = await fetch("/api/book/in-person", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        shop_id: shop.id,
        barber_id: finalBarberId,
        service_id: selectedService, // primary service of the combined booking
        service_ids: selectedServices,
        service_names: isMulti ? servicesPicked.map(s => s.name).join(" + ") : "",
        duration_minutes: combinedDuration,
        client_name: clientInfo.name,
        client_email: clientInfo.email,
        client_phone: clientInfo.phone,
        date: formatDateForDb(selectedDate),
        time_slot: selectedTime,
        total_amount: total, // combined total (discount already applied)
        subtotal: totalPrice,
        promo_code: promoApplied?.code ?? undefined,
        pay_in_person: payMethodChoice === "in_person",
      }),
    }).catch(() => null);
    if (!res) { setSaving(false); showToast("Connection error. Please try again.", false); return; }
    const result = await res.json().catch(() => ({} as { id?: string; status?: string; barber_id?: string; error?: string }));
    setSaving(false);
    if (!res.ok) {
      showToast(result.error ?? "Failed to book. Please try again.", false);
      return;
    }
    const newApptId = result.id as string;
    const inPersonStatus = (result.status as string) ?? "pending";
    finalBarberId = (result.barber_id as string) ?? finalBarberId; // server resolved "Any Available"
    setBookingId(newApptId);
    setBookingPending(inPersonStatus === "pending");
    setConfirmed(true);

    // Auto-register the customer in the shop's client book (deduped server-side
    // by email/phone). Fire-and-forget — booking already succeeded.
    fetch("/api/clients/upsert", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ shop_id: shop.id, name: clientInfo.name, email: clientInfo.email, phone: clientInfo.phone }),
    }).catch(() => null);

    // The customer's confirmation SMS is sent server-side by /api/book/in-person
    // (so /api/twilio/send-sms can require auth — no open SMS relay).

    // Staff alerts (owner + assigned barber): in-app notifications + SMS, all
    // server-side. The owner's in-app notification used to be inserted here via
    // the anon client, which fails RLS (no auth.uid()) — so owners never got the
    // live pop-up for customer bookings. notify-staff now creates both.
    fetch("/api/appointments/notify-staff", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ appointment_id: newApptId }),
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
      bookingId: newApptId.slice(0, 8).toUpperCase(),
      appointmentId: newApptId,
    };

    // Email the customer. Pending in-person bookings get a "request received —
    // awaiting confirmation" email, NOT a confirmation (that's sent on approve).
    if (clientInfo.email) {
      fetch("/api/send-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: inPersonStatus === "pending" ? "booking_request_received" : "booking_confirmation",
          data: { ...bookingData, clientEmail: clientInfo.email },
        }),
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
  const totalDuration = servicesPicked.reduce((sum, s) => sum + (s.duration_minutes ?? 30), 0);
  const barber = barbers.find((b) => b.id === selectedBarber);
  const discount = promoApplied
    ? promoApplied.discount_type === "percent"
      ? totalPrice * promoApplied.discount_value / 100
      : promoApplied.discount_value
    : 0;
  const total = Math.max(0, totalPrice - discount);

  // Whether THIS shop can actually take money online right now. Requires the
  // paid plan (Starter = pay-in-person only) AND a finished Stripe Connect setup
  // — no platform-charge fallback in any mode, so funds always land in the
  // shop's own account. (booking-checkout enforces the same server-side.)
  const connectReady = !!(shop?.stripe_account_id && shop?.stripe_connected);
  const shopCanCharge = !!shop
    && planHasFeature(effectivePlan(shop.subscription_plan, shop.subscription_status), "payments")
    && connectReady;

  // Which payment methods the customer may use — single source of truth shared
  // by confirmBooking's gate and the pay-method modal render. The owner's
  // `allow_pay_in_person` toggle is AUTHORITATIVE: when it's off, in-person is
  // never offered (previously it was force-enabled whenever the shop couldn't
  // charge online, which silently ignored the toggle).
  const allowInPerson = shop?.allow_pay_in_person ?? true;
  const canPayOnlineNow = total > 0 && shopCanCharge;
  const canPayInPersonNow = total > 0 && allowInPerson;

  // ── Sales tax (from the shop's booking_settings JSON) — display only; the
  // server recomputes it authoritatively at checkout. Tax applies to the
  // service amount after any discount. ───────────────────────────────────────
  const taxCfg = (shop?.booking_settings ?? null) as { tax_enabled?: boolean; tax_rate?: number; tax_label?: string } | null;
  const taxEnabled = taxCfg?.tax_enabled === true;
  const taxRatePct = taxEnabled ? Number(taxCfg?.tax_rate ?? 0) : 0;
  const taxAmount = taxEnabled ? Math.round(total * taxRatePct) / 100 : 0;
  const taxLabel = (taxCfg?.tax_label || "Tax").trim();
  const grandTotal = total + taxAmount;

  // ── Optional tip (online payment only) — presets off the discounted service
  // subtotal (pre-tax). Server recomputes authoritatively at checkout. ────────
  const tipsEnabledShop = ((shop?.booking_settings ?? {}) as { tips_enabled?: boolean }).tips_enabled !== false;
  const tipAmount = tipPercent > 0 ? Math.round(total * tipPercent) / 100 : 0;
  const grandTotalWithTip = grandTotal + tipAmount;

  // ── No-show policy (from the shop's booking_settings JSON) ─────────────────
  const bookingSettings = (shop?.booking_settings ?? null) as { no_show_protection?: boolean; no_show_fee_percent?: number } | null;
  const noShowProtection = !!bookingSettings?.no_show_protection;
  // The fee is a % of the booked total (capped at 80%) — show the customer the
  // real dollar amount for THIS booking so the policy is concrete.
  const noShowFeeAmount = noShowFeeDollars(total, bookingSettings?.no_show_fee_percent);
  const noShowFeeLabel = formatCurrency(noShowFeeAmount);
  // Days until the appointment — drives hold (≤7d) vs save-card (>7d).
  const daysOut = selectedDate ? (new Date(formatDateForDb(selectedDate) + "T00:00:00").getTime() - Date.now()) / 86400000 : 0;
  const willSaveCard = daysOut > 7; // beyond the ~7-day card-hold window
  // Whether paying online would take a card under no-show protection — used to
  // gate the consent checkbox in the pay-method modal. (In-person never takes
  // a card, so its button is never gated.)
  const cardForNoShow = noShowProtection && total > 0 && shopCanCharge;

  const categories = ["All", ...Array.from(new Set(services.map((s) => s.category)))];
  const filteredServices = services.filter((s) => s.is_active && (categoryFilter === "All" || s.category === categoryFilter));

  // Calendar window = the shop's "Advance Booking Limit" (booking_settings
  // .advance_days, default 30). Customers can book from today up to that many
  // days ahead — this was hardcoded to 180 and ignored the setting, letting
  // customers book far beyond the shop's window.
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const advanceDays = Math.min(60, Math.max(1, Number((shop?.booking_settings as { advance_days?: number } | null)?.advance_days ?? 15)));
  // Last bookable day (inclusive) = today + advanceDays. Enforced in the week
  // strip (disabled days + capped Next-week arrow) and the submit guard so
  // customers can't page or book past the shop's advance-booking window.
  const maxDate = new Date(today); maxDate.setDate(today.getDate() + advanceDays);

  // Multi-service: slots are `bookingInterval` min apart. We need enough
  // consecutive slots to cover the total duration, all available with at least
  // one common barber (time-first) or the picked barber (barber-first).
  const bookingInterval = slotIntervalOf(shop);
  const slotsNeeded = Math.max(1, Math.ceil((totalDuration || bookingInterval) / bookingInterval));
  const slotGridForBlock = slotGrid.flatMap((s, i) => {
    if (!s.available) return [];
    if (slotsNeeded === 1) return [{ ...s }];
    // For each of the next (slotsNeeded - 1) slots, require availability AND (for
    // time-first) at least one barber free across the WHOLE block.
    let intersection = new Set(s.barberIds);
    for (let j = 1; j < slotsNeeded; j++) {
      const next = slotGrid[i + j];
      if (!next || !next.available) return [];
      intersection = new Set(Array.from(intersection).filter(id => next.barberIds.includes(id)));
      if (intersection.size === 0) return [];
    }
    // Attach the block-wide common barbers so "any barber" assigns one that's
    // free for the FULL duration. Using the start slot's barbers let a barber
    // who's free at 9:15 but booked at 9:30 get a 45-min booking → double-book.
    return [{ ...s, barberIds: Array.from(intersection) }];
  });

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

  // A load/network error is NOT the same as an invalid link — offer a retry
  // instead of telling a real customer the shop doesn't exist.
  if (loadError) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center px-4">
        <div className="text-center max-w-sm">
          <div className="w-16 h-16 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center mx-auto mb-5 text-3xl">⚠️</div>
          <h1 className="text-xl font-bold text-white">Couldn&apos;t load this page</h1>
          <p className="text-[#8f8f8f] mt-2 mb-6">Check your connection and try again.</p>
          <button onClick={() => window.location.reload()} className="rounded-xl bg-white text-black font-semibold text-sm px-5 py-2.5 hover:bg-[#eaeaea] transition-colors">Try again</button>
        </div>
      </div>
    );
  }

  if (!shop) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center px-4">
        <div className="text-center">
          <Logo size="md" />
          <h1 className="text-2xl font-bold text-white mt-6">Shop Not Found</h1>
          <p className="text-[#8f8f8f] mt-2">This booking link may be invalid.</p>
        </div>
      </div>
    );
  }

  if (shop.status !== "approved") {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center px-4">
        <div className="text-center max-w-sm">
          <div className="w-20 h-20 bg-black/5 border border-[#2a2a2a] rounded-2xl flex items-center justify-center mx-auto mb-6">
            <Logo size="sm" showText={false} />
          </div>
          <h1 className="text-2xl font-bold text-white">{shop.name}</h1>
          <p className="text-[#8f8f8f] mt-3">This shop is coming soon. Check back later.</p>
          <Badge variant="warning" className="mt-4">Coming Soon</Badge>
        </div>
      </div>
    );
  }

  // A payment return (online booking pay, or an owner-sent payment link) must
  // always show its result — even when online booking is paused — so the customer
  // sees "Payment received", not the "not accepting bookings" screen.
  const isPaymentReturn = (!!searchParams.get("paid_appt") || searchParams.get("paid") === "1") && !freshStart;

  // ── Emergency pause: owner flipped the kill switch → stop taking bookings ──
  if ((shop.booking_settings as { bookings_paused?: boolean } | null)?.bookings_paused && !confirmed && !isPaymentReturn) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center px-4">
        <div className="text-center max-w-sm">
          <div className="w-20 h-20 bg-black/5 border border-[#2a2a2a] rounded-2xl flex items-center justify-center mx-auto mb-6">
            <Logo size="sm" showText={false} />
          </div>
          <h1 className="text-2xl font-bold text-white">{shop.name}</h1>
          <p className="text-[#8f8f8f] mt-3">We&apos;ve temporarily paused online booking. Please check back soon{shop.phone ? " or give us a call" : ""}.</p>
          <Badge variant="warning" className="mt-4">Not accepting bookings</Badge>
          {shop.phone && <p className="text-sm text-[#aaa] mt-4">{shop.phone}</p>}
        </div>
      </div>
    );
  }

  // Finalizing a payment that just came back from Stripe (before `confirmed`
  // flips) — show a spinner instead of the booking UI / paused screen.
  if (isPaymentReturn && !confirmed) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center px-4">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-[#2a2a2a] border-t-white rounded-full animate-spin mx-auto mb-3" />
          <p className="text-[#8f8f8f] text-sm">Confirming your payment…</p>
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
          <div className={cn("w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-6", bookingPending ? "bg-amber-500/20" : "bg-emerald-500/20")}>
            <Check size={36} className={bookingPending ? "text-amber-400" : "text-emerald-400"} />
          </div>
          <h1 className="text-2xl font-bold text-white mb-2">{paidThankYou ? "Payment received — thank you!" : bookingPending ? "Request sent!" : "Booking Confirmed!"}</h1>
          {bookingId && <p className="text-xs text-[#8f8f8f] mb-1">Booking ID: <span className="text-white font-mono">{bookingId.slice(0, 8).toUpperCase()}</span></p>}
          {bookingPending && !paidThankYou && (
            <p className="text-[#8f8f8f] mb-2">Your request was sent to {confirmedSummary?.shopName || shop.name}. You&apos;ll be notified once they confirm it — track it under &quot;My Bookings.&quot;</p>
          )}
          {dispEmail && !bookingPending && <p className="text-[#8f8f8f] mb-2">{paidThankYou ? `We've emailed your receipt to ${dispEmail}` : `We'll send a confirmation to ${dispEmail}`}</p>}
          {bookingId && <a href={`/my-booking/${bookingId}`} className="text-xs text-white hover:text-white transition-colors mb-6 block">View & Manage Booking →</a>}
          <div className="bg-black shadow-sm border border-[#2a2a2a] rounded-2xl p-6 text-left space-y-3 mb-6">
            {[
              { label: "Shop", value: confirmedSummary?.shopName || shop.name },
              { label: "Barber", value: dispBarber },
              { label: "Service", value: dispService },
              { label: "Date", value: dispDateObj?.toLocaleDateString("en-CA", { weekday: "short", month: "short", day: "numeric" }) ?? "" },
              { label: "Time", value: dispTime },
            ].map(({ label, value }) => (
              <div key={label} className="flex justify-between text-sm">
                <span className="text-[#8f8f8f]">{label}</span>
                <span className="text-white font-medium">{value}</span>
              </div>
            ))}
            <div className="border-t border-[#2a2a2a] pt-3 flex justify-between font-bold">
              <span className="text-white">Total</span>
              <span className="text-white text-lg">{formatCurrency(dispTotal)}</span>
            </div>
            {confirmedSummary?.paymentNote && (
              <p className="text-xs text-[#8f8f8f] text-center pt-1">{confirmedSummary.paymentNote}</p>
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
            <Button variant="outline" className="flex-1" onClick={() => { if (navigator.share) navigator.share({ title: `Booking at ${shop.name}`, text: `${shop.name} — ${dispDateObj?.toLocaleDateString("en-CA", { month: "long", day: "numeric", year: "numeric" })} at ${dispTime}`, url: window.location.href }); }}>
              <Share2 size={16} /> Share
            </Button>
          </div>
          <Button className="w-full mt-3 !bg-black !text-white hover:!bg-gray-800" onClick={() => { setFreshStart(true); if (typeof window !== "undefined") window.history.replaceState({}, "", `/book/${shop.slug}`); setConfirmed(false); setPaidThankYou(false); setBookingPending(false); setConfirmedSummary(null); setStep(0); setSelectedBarber(null); setSelectedService(null); setSelectedDate(null); setSelectedTime(null); setPayMethodChoice(null); setNoShowConsent(false); setTipPercent(0); }}>
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
    <label className="flex items-start gap-3 p-3 rounded-xl border border-amber-300 bg-amber-50 cursor-pointer">
      <input type="checkbox" checked={noShowConsent} onChange={(e) => setNoShowConsent(e.target.checked)}
        className="mt-0.5 h-4 w-4 accent-amber-600 flex-shrink-0" />
      <span className="text-xs text-amber-900 leading-relaxed">
        {willSaveCard ? (
          <>This booking is more than 7 days away, so my card will be securely <span className="font-semibold">saved</span> now (not charged) and charged after my visit — or a no-show fee of <span className="font-semibold">{noShowFeeLabel}</span> if I don&apos;t show up. I accept this no-show policy.</>
        ) : (
          <>My card will be securely <span className="font-semibold">held</span> now and charged after my visit — or a no-show fee of <span className="font-semibold">{noShowFeeLabel}</span> if I don&apos;t show up. I accept this no-show policy.</>
        )}
      </span>
    </label>
  );

  return (
    <div className="min-h-[100dvh] bg-black overflow-x-clip pt-[env(safe-area-inset-top)]">
      {toast && <ToastBar toast={toast} onClose={() => setToast(null)} />}

      {/* Shop Header */}
      <div className="bg-black border-b border-[#2a2a2a]">
        <div className="max-w-2xl mx-auto px-5 pt-6 pb-5">
          {/* Logo */}
          <div className="w-24 h-24 rounded-[26px] overflow-hidden border border-[#242424] shadow-[0_10px_30px_rgba(0,0,0,0.55)]">
            <AvatarImage src={shop.logo} alt={shop.name} className="w-full h-full object-cover"
              fallback={
                <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-sky-500 to-sky-700 text-white text-3xl font-black tracking-tight">
                  {shopInitials(shop.name)}
                </div>
              } />
          </div>
          {/* Name */}
          <h1 className="text-[28px] leading-tight font-black text-white uppercase tracking-tight mt-5">{shop.name}</h1>
          {/* Location */}
          {(shop.city || shop.province) && (
            <p className="flex items-center gap-2 text-[15px] text-[#8a8a8a] mt-2.5">
              <span className="text-base leading-none">📍</span>
              {[shop.city, shop.province].filter(Boolean).join(", ")}
            </p>
          )}
          {/* Contact rows */}
          {(() => {
            const ig = shop.instagram ? igHandle(shop.instagram) : "";
            const hasContacts = shop.phone || ig || shop.website;
            if (!hasContacts) return null;
            return (
              <div className="mt-4 space-y-2">
                {shop.phone && <ContactRow icon="📞" text={formatPhone(shop.phone)} href={`tel:${shop.phone}`} />}
                {ig && <ContactRow icon={<InstagramIcon />} text={`@${ig}`} href={`https://instagram.com/${ig}`} />}
                {shop.website && <ContactRow icon="🌐" text={displayUrl(shop.website)} href={ensureHttp(shop.website)} />}
              </div>
            );
          })()}
          <div className="mt-4 grid grid-cols-1 gap-2">
            {/* Directions */}
            {(shop.address || shop.city) && (
              <a href={directionsUrl(shop)} target="_blank" rel="noopener noreferrer"
                 className="flex items-center justify-center gap-2 w-full py-3 rounded-2xl bg-[#141414] border border-[#242424] text-white text-sm font-semibold hover:bg-[#1a1a1a] active:opacity-70 transition-all">
                <span className="text-base leading-none">🧭</span> Get directions
              </a>
            )}
            {/* Buy a gift card (only when the shop can actually take payment) */}
            {shopCanCharge && (
              <a href={`/gift/${shop.slug}`}
                 className="flex items-center justify-center gap-2 w-full py-3 rounded-2xl bg-[#141414] border border-[#242424] text-white text-sm font-semibold hover:bg-[#1a1a1a] active:opacity-70 transition-all">
                <span className="text-base leading-none">🎁</span> Buy a gift card
              </a>
            )}
          </div>
        </div>
      </div>

      {/* Flow Toggle */}
      <div className="bg-black border-b border-[#2a2a2a]">
        <div className="max-w-2xl mx-auto px-5 py-3 flex gap-2">
          {(["time-first", "barber-first"] as const).map((f) => (
            <button
              key={f}
              onClick={() => switchFlow(f)}
              className={cn(
                "flex-1 py-3 px-3 rounded-full text-sm font-bold transition-all",
                flow === f
                  ? "bg-white text-black shadow-[0_2px_12px_rgba(255,255,255,0.12)]"
                  : "bg-[#141414] text-[#8f8f8f] border border-[#2a2a2a] hover:text-white"
              )}
            >
              {f === "time-first" ? "Choose Time First" : "Choose Barber First"}
            </button>
          ))}
        </div>
      </div>

      {/* Progress */}
      <div className="bg-black border-b border-[#2a2a2a] sticky top-0 z-10">
        <div className="max-w-2xl mx-auto px-5 py-3.5">
          <div className="flex items-center gap-1">
            {STEPS.map((s, i) => (
              <div key={s + i} className="flex items-center gap-1 flex-1 last:flex-none">
                <div className={cn(
                  "flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-all",
                  i <= step ? "bg-emerald-400 text-black" : "bg-[#141414] text-[#8f8f8f] border border-[#242424]"
                )}>
                  {i < step ? <Check size={12} /> : i + 1}
                </div>
                {i < STEPS.length - 1 && <div className={cn("flex-1 h-[2px] rounded-full", i < step ? "bg-emerald-400" : "bg-[#242424]")} />}
              </div>
            ))}
          </div>
          <p className="text-xs text-[#8f8f8f] mt-2">Step {step + 1} of {STEPS.length}: <span className="text-white font-semibold">{STEPS[step]}</span></p>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-6 pb-28">

        {/* BARBER FIRST — Step 0: Select Barber */}
        {step === isBarberFirstStep(0) && (
          <div className="space-y-4 animate-fade-in">
            <h2 className="text-lg font-semibold text-white">Choose your barber</h2>
            <button
              onClick={() => setSelectedBarber("any")}
              className={cn("w-full flex items-center gap-4 p-4 rounded-2xl border text-left transition-all", selectedBarber === "any" ? "border-gold bg-gold/10 ring-1 ring-gold/30" : "border-[#2a2a2a] bg-black hover:border-[#333]")}
            >
              <div className="w-12 h-12 rounded-full bg-[#141414] border border-[#2a2a2a] flex items-center justify-center text-2xl">✨</div>
              <div>
                <p className="font-semibold text-white">No Preference</p>
                <p className="text-sm text-[#8f8f8f]">Next available barber</p>
              </div>
              {selectedBarber === "any" && <Check size={18} className="ml-auto text-gold" />}
            </button>
            {barbers.map((b) => (
              <button key={b.id} onClick={() => setSelectedBarber(b.id)}
                className={cn("w-full flex items-center gap-4 p-4 rounded-2xl border text-left transition-all", selectedBarber === b.id ? "border-gold bg-gold/10 ring-1 ring-gold/30" : "border-[#2a2a2a] bg-black hover:border-[#333]")}
              >
                {b.photo
                  ? <img src={b.photo} alt={b.name} className="w-14 h-14 rounded-full object-cover border border-[#2a2a2a]" />
                  : <div className="w-14 h-14 rounded-full bg-[#1a1a1a] border border-[#2a2a2a] flex items-center justify-center text-white font-bold text-xl">{b.name[0]}</div>
                }
                <div className="flex-1">
                  <p className="font-semibold text-white">{b.name}</p>
                  {b.bio && <p className="text-xs text-[#8f8f8f] mt-0.5 line-clamp-1">{b.bio}</p>}
                  <span className="flex items-center gap-1 text-xs text-white mt-1">
                    <Star size={11} className="fill-amber-400 text-amber-400" /> {b.rating} ({b.total_reviews} reviews)
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
            <p className="text-xs text-[#8f8f8f] -mt-1">Pick one or more (e.g. cut + beard, or two haircuts for a family booking).</p>

            {/* Selected services summary — chips with remove + running total */}
            {servicesPicked.length > 0 && (
              <div className="bg-black/5 border border-[#2a2a2a] rounded-2xl p-3 space-y-2">
                <div className="flex flex-wrap gap-2">
                  {servicesPicked.map((s, idx) => (
                    <span key={s.id + idx} className="inline-flex items-center gap-1.5 bg-gold/15 border border-gold/30 text-white rounded-full pl-3 pr-1 py-1 text-xs font-medium">
                      {s.name} · {formatCurrency(s.price)}
                      <button onClick={() => setSelectedServices(prev => prev.filter((_, i) => i !== idx))}
                        className="ml-0.5 w-5 h-5 rounded-full bg-white/10 hover:bg-gold/40 flex items-center justify-center" aria-label="Remove">
                        <X size={11} />
                      </button>
                    </span>
                  ))}
                </div>
                <div className="flex items-center justify-between text-sm pt-1 border-t border-[#2a2a2a]">
                  <span className="text-[#8f8f8f]">{servicesPicked.length} service{servicesPicked.length !== 1 ? "s" : ""} · {totalDuration} min</span>
                  <span className="text-white font-bold">{formatCurrency(totalPrice)}</span>
                </div>
              </div>
            )}

            <div className="flex gap-2 flex-wrap">
              {categories.map((cat) => (
                <button key={cat} onClick={() => setCategoryFilter(cat)}
                  className={cn("px-4 py-2 rounded-full text-sm font-semibold transition-all border", categoryFilter === cat ? "bg-white text-black border-white" : "bg-[#141414] border-[#2a2a2a] text-[#8f8f8f] hover:text-white")}
                >{cat}</button>
              ))}
            </div>
            {filteredServices.length === 0 && (
              <div className="py-12 text-center text-[#8f8f8f]">
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
                  className={cn("w-full flex items-center justify-between p-4 rounded-2xl border text-left transition-all", isPicked ? "border-white/60 bg-white/[0.04]" : "border-[#2a2a2a] bg-[#0d0d0d] hover:border-[#333]")}
                >
                  <div className="flex-1 pr-4 cursor-pointer" onClick={() => toggleService(svc.id)}>
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-semibold text-white">{svc.name}</p>
                      <Badge>{svc.category}</Badge>
                      {count > 1 && <span className="text-xs text-white">× {count}</span>}
                    </div>
                    {svc.description && <p className="text-xs text-[#8f8f8f] mt-0.5 line-clamp-2">{svc.description}</p>}
                    <p className="text-xs text-[#8f8f8f] mt-1 flex items-center gap-1"><Clock size={11} /> {svc.duration_minutes} min</p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className="text-lg font-bold text-white">{formatCurrency(svc.price)}</span>
                    <button onClick={() => setSelectedServices(prev => [...prev, svc.id])}
                      className="w-9 h-9 rounded-full bg-white text-black flex items-center justify-center text-lg font-bold hover:bg-white/90 transition-colors" aria-label="Add service">
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
          // Rolling 7-day strip that ALWAYS starts at today (not a Sun-anchored
          // week). Paged in 7-day blocks from today, so the first cell is always
          // today and a past day can never appear — no blank leading cells when
          // it's late in the week. `pageIndex` is derived from selectedDate.
          const DAY_MS = 86400000;
          const anchor = selectedDate ?? today;
          const anchorMid = new Date(anchor); anchorMid.setHours(0, 0, 0, 0);
          const daysFromToday = Math.max(0, Math.round((anchorMid.getTime() - today.getTime()) / DAY_MS));
          const pageIndex = Math.floor(daysFromToday / 7);
          const weekStart = new Date(today); weekStart.setDate(today.getDate() + pageIndex * 7);
          const weekDays = Array.from({ length: 7 }, (_, i) => {
            const d = new Date(weekStart); d.setDate(weekStart.getDate() + i); return d;
          });
          // Customers can only look forward: "Previous week" is disabled on the
          // first page (which begins at today).
          const canGoPrev = pageIndex > 0;
          // Don't page into a week that lies entirely past the booking window.
          const nextWeekStart = new Date(weekStart); nextWeekStart.setDate(weekStart.getDate() + 7);
          const canGoNext = nextWeekStart <= maxDate;

          // Hour-of-day (0–24, fractional) for a "9:15 AM" style slot — used to
          // bucket slots into Morning / Afternoon / Evening for the chip grid.
          const parseHour = (slotStr: string) => {
            const [time, period] = slotStr.split(" ");
            const [h, m] = time.split(":").map(Number);
            let hour = h;
            if (period === "PM" && h !== 12) hour += 12;
            if (period === "AM" && h === 12) hour = 0;
            return hour + m / 60;
          };

          const blockSlotSet = new Set(slotGridForBlock.map(s => s.slot));
          const todayStr = formatDateForDb(new Date());
          const dateStr = selectedDate ? formatDateForDb(selectedDate) : null;
          const isTodaySelected = dateStr === todayStr;
          const bookableSlots = slotGrid.filter(({ slot }) => {
            const past = isTodaySelected && isSlotInPast(slot);
            return !past && blockSlotSet.has(slot);
          });

          // Group bookable slots into parts of the day so a 15-min-granularity
          // shop with 40+ openings stays scannable.
          const slotGroups = [
            { label: "Morning", slots: [] as typeof bookableSlots },
            { label: "Afternoon", slots: [] as typeof bookableSlots },
            { label: "Evening", slots: [] as typeof bookableSlots },
          ];
          for (const s of bookableSlots) {
            const h = parseHour(s.slot);
            (h < 12 ? slotGroups[0] : h < 17 ? slotGroups[1] : slotGroups[2]).slots.push(s);
          }

          return (
            <div className="flex flex-col -mx-4 sm:mx-0 animate-fade-in" style={{ maxHeight: "calc(100dvh - 210px)" }}>
              {/* Header row: back / next week arrows (icon-only) */}
              <div className="flex items-center justify-between px-4 pb-2">
                <button
                  aria-label="Previous week"
                  disabled={!canGoPrev}
                  onClick={() => { if (!canGoPrev) return; autoAdvanceRef.current.active = false; const d = new Date(weekStart); d.setDate(d.getDate() - 7); setSelectedDate(d); setSelectedTime(null); }}
                  className={cn(
                    "w-9 h-9 rounded-full flex items-center justify-center text-white transition-colors",
                    canGoPrev ? "bg-[#141414] hover:bg-[#141414]/80" : "bg-[#141414]/30 text-[#6e6e6e] cursor-not-allowed",
                  )}
                >
                  <ChevronLeft size={18} />
                </button>
                <button
                  aria-label="Next week"
                  disabled={!canGoNext}
                  onClick={() => { if (!canGoNext) return; autoAdvanceRef.current.active = false; const d = new Date(weekStart); d.setDate(d.getDate() + 7); setSelectedDate(d); setSelectedTime(null); }}
                  className={cn(
                    "w-9 h-9 rounded-full flex items-center justify-center text-white transition-colors",
                    canGoNext ? "bg-[#141414] hover:bg-[#141414]/80" : "bg-[#141414]/30 text-[#6e6e6e] cursor-not-allowed",
                  )}
                >
                  <ChevronRight size={18} />
                </button>
              </div>

              {/* Week strip */}
              <div className="grid grid-cols-7 px-2 pb-2">
                {weekDays.map((day) => {
                  const dayStr = formatDateForDb(day);
                  const isSelectedDay = dayStr === dateStr;
                  // The rolling strip starts at today, so no day here is ever in
                  // the past. Disable only days where the relevant barber isn't
                  // scheduled or is on approved full-day time-off.
                  const isBarberOff = flow === "barber-first" && selectedBarber && selectedBarber !== "any" && !isBarberAvailableOnDate(selectedBarber, day);
                  const isShopClosed = flow !== "barber-first" && !isShopAvailableOnDate(day);
                  const isBeyondWindow = day > maxDate;
                  const disabled = !!isBarberOff || isShopClosed || isBeyondWindow;
                  const isTodayDay = dayStr === todayStr;
                  return (
                    <button key={dayStr} disabled={disabled}
                      onClick={() => { if (!disabled) { autoAdvanceRef.current.active = false; setSelectedDate(day); setSelectedTime(null); } }}
                      className="flex flex-col items-center py-1.5 disabled:cursor-not-allowed"
                    >
                      <span className={cn("text-[10px] uppercase tracking-wider", disabled ? "text-[#6e6e6e]" : "text-[#8f8f8f]")}>
                        {day.toLocaleDateString("en-CA", { weekday: "narrow" })}
                      </span>
                      <span className={cn(
                        "text-base font-medium mt-1.5 w-9 h-9 rounded-full inline-flex items-center justify-center transition-colors",
                        // Selected day: solid WHITE pill (visible on the black
                        // page — a black pill was invisible before). Today (when
                        // not selected) gets a subtle ring so it's identifiable.
                        isSelectedDay ? "bg-white text-black font-bold" :
                        isTodayDay && !disabled ? "text-white ring-1 ring-white/40" :
                        disabled ? "text-[#6e6e6e]" : "text-white",
                      )}>
                        {day.getDate()}
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* Date title row (center) — weekday is always shown, with a
                  Today/Tomorrow prefix when it applies (e.g. "Tomorrow ·
                  Monday, July 13"). */}
              <div className="px-4 py-2 border-t border-[#2a2a2a]/40 text-center">
                <p className="text-sm font-semibold text-white">
                  {selectedDate ? (() => {
                    const weekday = selectedDate.toLocaleDateString("en-CA", { weekday: "long" });
                    const monthDay = selectedDate.toLocaleDateString("en-CA", { month: "long", day: "numeric" });
                    const base = new Date(); base.setHours(0, 0, 0, 0);
                    const sel = new Date(selectedDate); sel.setHours(0, 0, 0, 0);
                    const diff = Math.round((sel.getTime() - base.getTime()) / 86400000);
                    const rel = diff === 0 ? "Today" : diff === 1 ? "Tomorrow" : null;
                    return rel ? `${rel} · ${weekday}, ${monthDay}` : `${weekday}, ${monthDay}`;
                  })() : "Pick a day"}
                </p>
              </div>

              {/* Slot list */}
              <div className="flex-1 overflow-y-auto border-t border-[#2a2a2a]/40">
                {!selectedDate && (
                  <div className="py-16 text-center text-[#8f8f8f] text-sm">Tap a day above to see openings.</div>
                )}
                {selectedDate && slotsLoading && (
                  <div className="py-16 text-center text-[#8f8f8f] text-sm">
                    <div className="w-6 h-6 border-2 border-[#333] border-t-gold rounded-full animate-spin mx-auto mb-3" />
                    Loading…
                  </div>
                )}
                {selectedDate && !slotsLoading && slotGrid.length === 0 && (
                  <div className="py-12 text-center px-4">
                    <p className="text-[#8f8f8f] text-sm">No openings on this day.</p>
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
                        <p className="mt-2 text-[11px] text-[#8f8f8f]">We&apos;ll text or email you the moment someone cancels.</p>
                      </>
                    )}
                  </div>
                )}
                {selectedDate && !slotsLoading && slotGrid.length > 0 && bookableSlots.length === 0 && (
                  <div className="m-4 py-5 text-center bg-orange-500/5 border border-orange-500/20 rounded-xl px-4">
                    <p className="text-orange-300 text-sm font-medium">
                      {servicesPicked.length > 1
                        ? `${flow === "barber-first" ? "This barber doesn't have" : "No barber has"} ${totalDuration} min open on this day`
                        : "No more openings on this day"}
                    </p>
                    <p className="text-xs text-[#8f8f8f] mt-1">Try another day.</p>
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
                  <div className="px-3 py-3 space-y-5">
                    {slotGroups.filter(g => g.slots.length > 0).map((g) => (
                      <div key={g.label}>
                        <p className="text-[11px] font-semibold uppercase tracking-wider text-[#8f8f8f] px-1 mb-2">{g.label}</p>
                        <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-2">
                          {g.slots.map(({ slot, barberIds }) => {
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
                                className={cn(
                                  "rounded-xl border py-2.5 px-1 flex flex-col items-center justify-center transition-all",
                                  isSelectedSlot
                                    ? "bg-gold border-gold text-black font-bold ring-2 ring-gold/40 scale-[1.03]"
                                    : "bg-sky-500/15 border-sky-400/60 hover:bg-sky-500/25 text-white",
                                )}
                              >
                                <span className="text-sm font-semibold leading-none">{slot}</span>
                                <span className={cn("text-[10px] leading-none mt-1 truncate max-w-full", isSelectedSlot ? "text-black/70" : "text-sky-300")}>
                                  {barberIds.length === 1
                                    ? barbers.find(b => b.id === barberIds[0])?.name?.split(" ")[0] ?? "barber"
                                    : `${barberIds.length} free`}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ))}
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
                      <div className="bg-black shadow-sm border border-[#2a2a2a] rounded-t-2xl sm:rounded-2xl p-5 w-full max-w-sm space-y-3 animate-fade-in">
                        <div className="flex items-center justify-between">
                          <div>
                            <h3 className="text-base font-bold text-white">Choose a barber</h3>
                            <p className="text-xs text-[#8f8f8f] mt-0.5">{expandedSlot} · {slotBarbers.length} available</p>
                          </div>
                          <button onClick={() => setExpandedSlot(null)} className="text-[#8f8f8f] hover:text-white"><X size={18} /></button>
                        </div>
                        <div className="space-y-2">
                          {slotBarbers.map((b) => (
                            <button key={b.id}
                              onClick={() => { setSelectedTime(expandedSlot); setSelectedBarber(b.id); setExpandedSlot(null); }}
                              className="w-full flex items-center gap-3 px-4 py-3 rounded-xl border border-[#2a2a2a] bg-[#141414] hover:border-gray-400 text-left transition-all"
                            >
                              {b.photo
                                ? <img src={b.photo} alt={b.name} className="w-10 h-10 rounded-full object-cover" />
                                : <div className="w-10 h-10 rounded-full bg-[#1a1a1a] border border-[#2a2a2a] flex items-center justify-center text-white font-bold">{b.name[0]}</div>
                              }
                              <div className="flex-1">
                                <p className="text-sm font-semibold text-white">{b.name}</p>
                                <p className="text-xs text-white flex items-center gap-0.5"><Star size={10} className="fill-amber-400 text-amber-400" /> {b.rating} ({b.total_reviews} reviews)</p>
                              </div>
                              <ChevronRight size={16} className="text-[#8f8f8f]" />
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
                  className={cn("w-full bg-[#141414] border rounded-xl px-4 py-3 text-sm text-white placeholder:text-[#6e6e6e] focus:outline-none focus:ring-2 focus:border-gold/50 transition-all",
                    clientErrors[key] ? "border-red-500/50 focus:ring-red-500/30" : "border-[#2a2a2a] focus:ring-gold/30")}
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
            <p className="text-[#8f8f8f] text-sm">Optional — skip if you don&apos;t have one.</p>
            <div className="flex gap-2">
              <input type="text" value={promoCode} onChange={(e) => setPromoCode(e.target.value.toUpperCase())} placeholder="e.g. WELCOME10"
                className="flex-1 bg-[#141414] border border-[#2a2a2a] rounded-xl px-4 py-2.5 text-sm text-white placeholder:text-[#6e6e6e] focus:outline-none focus:ring-2 focus:ring-gold/30 uppercase tracking-widest"
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
          return (
          <div className="space-y-4 animate-fade-in">
            <h2 className="text-lg font-semibold text-white">Review your booking</h2>
            <div className="bg-black shadow-sm border border-[#2a2a2a] rounded-2xl p-5 space-y-3">
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
                  <span className="text-[#8f8f8f]">{label}</span>
                  <span className="text-white font-medium text-right max-w-[60%]">{value}</span>
                </div>
              ))}
              <div className="border-t border-[#2a2a2a] pt-3 space-y-1.5">
                {servicesPicked.map((s) => (
                  <div key={s.id} className="flex justify-between text-sm">
                    <span className="text-[#8f8f8f]">{s.name} <span className="text-[#999]">· {s.duration_minutes}min</span></span>
                    <span className="text-white">{formatCurrency(s.price ?? 0)}</span>
                  </div>
                ))}
                {promoApplied && (
                  <div className="flex justify-between text-sm">
                    <span className="text-emerald-400">Discount ({promoApplied.code})</span>
                    <span className="text-emerald-400">-{formatCurrency(discount)}</span>
                  </div>
                )}
                {taxEnabled && taxAmount > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-[#8f8f8f]">{taxLabel} ({taxRatePct}%)</span>
                    <span className="text-white">{formatCurrency(taxAmount)}</span>
                  </div>
                )}
                <div className="flex justify-between font-bold pt-1 border-t border-[#2a2a2a]/50">
                  <span className="text-white">Total</span>
                  <span className="text-white text-lg">{formatCurrency(grandTotal)}</span>
                </div>
              </div>
            </div>
            {/* Optional tip — online payment only. Charged with the card after the visit. */}
            {canPayOnlineNow && tipsEnabledShop && (
              <div className="bg-black border border-[#2a2a2a] rounded-2xl p-5">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm font-semibold text-white">Add a tip</span>
                  <span className="text-xs text-[#8f8f8f]">Optional · online payment</span>
                </div>
                <div className="grid grid-cols-4 gap-2">
                  {[0, 15, 18, 20].map((p) => (
                    <button key={p} type="button" onClick={() => setTipPercent(p)}
                      className={cn("py-2.5 rounded-xl text-sm font-semibold border transition-all active:scale-95",
                        tipPercent === p ? "bg-white text-black border-white" : "bg-[#141414] text-white border-[#242424] hover:border-[#3a3a3a]")}>
                      {p === 0 ? "No tip" : `${p}%`}
                    </button>
                  ))}
                </div>
                {tipAmount > 0 && (
                  <div className="mt-3 pt-3 border-t border-[#2a2a2a] space-y-1">
                    <div className="flex justify-between text-sm"><span className="text-[#8f8f8f]">Tip</span><span className="text-white">{formatCurrency(tipAmount)}</span></div>
                    <div className="flex justify-between text-sm font-bold"><span className="text-white">Total with tip</span><span className="text-white">{formatCurrency(grandTotalWithTip)}</span></div>
                  </div>
                )}
              </div>
            )}
            {canPayInPersonNow
              ? <p className="text-xs text-[#999] text-center">Payment collected at the shop · Free cancellation 24h before</p>
              : <p className="text-xs text-[#999] text-center">Secure online payment · Free cancellation 24h before</p>
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
      <div className="fixed bottom-0 left-0 right-0 z-20 px-3 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] pointer-events-none">
        <div className="pointer-events-auto max-w-2xl mx-auto bg-black border border-white/15 rounded-full pl-5 pr-2 py-2 flex items-center gap-3 shadow-[0_8px_32px_rgba(0,0,0,0.45)]">
          {/* Running total — only shown when at least one service is picked.
              Falls back to a tiny step caption otherwise so the bar isn't empty. */}
          {servicesPicked.length > 0 ? (
            <div className="flex-1 min-w-0">
              <p className="text-[10px] uppercase tracking-wider text-white/50 leading-none">
                {servicesPicked.length} {servicesPicked.length === 1 ? "service" : "services"} · {totalDuration} min
              </p>
              <p className="text-base font-bold text-white leading-tight mt-0.5">
                {formatCurrency(grandTotal)}
                {taxEnabled && taxAmount > 0 && <span className="text-[10px] font-normal text-white/50"> incl. {taxLabel}</span>}
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
              className="rounded-full bg-gold text-black px-5 py-2 text-sm font-semibold flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gold/90 transition-colors flex-shrink-0"
            >
              Continue <ChevronRight size={16} />
            </button>
          ) : (
            <button
              type="button"
              disabled={saving}
              onClick={confirmBooking}
              className="rounded-full bg-gold text-black px-5 py-2 text-sm font-semibold flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gold/90 transition-colors flex-shrink-0"
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
          <div className="fixed inset-0 z-[90] flex items-center justify-center p-4 overflow-y-auto overscroll-contain [&>*]:my-auto">
            <div className="bg-white border border-[#2a2a2a] rounded-2xl p-6 w-full max-w-md space-y-5 shadow-xl">
              <div>
                <h2 className="text-lg font-bold text-gray-900">
                  {canPayInPersonNow ? "How would you like to pay?" : "Secure your booking"}
                </h2>
                <p className="text-sm text-gray-500 mt-1">
                  {canPayInPersonNow ? "You can pay now or settle up at the shop." : "This shop takes payment online at booking."}
                </p>
              </div>

              {/* No-show consent — required only for the online (card) path.
                  Paying in person stays available without it, so the customer
                  can always avoid handing over a card. */}
              {cardForNoShow && noShowConsentBox}

              {canPayOnlineNow && (
                <button type="button" className="btn btn-primary w-full disabled:opacity-40 disabled:cursor-not-allowed" style={{ padding: "1rem" }}
                  disabled={cardForNoShow && !noShowConsent}
                  onClick={() => { setShowPayChoiceModal(false); setPayMethodChoice("online"); setTimeout(confirmBooking, 0); }}>
                  💳 Pay online now (secure · Stripe)
                </button>
              )}

              {canPayInPersonNow && (
                <button type="button" className="btn btn-outline-dark w-full" style={{ padding: "1rem" }}
                  onClick={() => { setShowPayChoiceModal(false); setPayMethodChoice("in_person"); setTimeout(confirmBooking, 0); }}>
                  🏪 Pay in person at the shop
                </button>
              )}

              {canPayInPersonNow && (
                <p className="text-xs text-[#8f8f8f] text-center">
                  Paying in person? Your booking is reserved as pending until the shop confirms.
                </p>
              )}
            </div>
          </div>
        </>
      )}

      {/* Smart-waitlist signup modal */}
      {showWaitlistModal && (
        <>
          <div className="fixed inset-0 bg-black/60 z-[80]" onClick={() => !waitlistSaving && setShowWaitlistModal(false)} />
          <div className="fixed inset-0 z-[90] flex items-center justify-center p-4 overflow-y-auto overscroll-contain [&>*]:my-auto">
            <div className="bg-black border border-[#2a2a2a] rounded-2xl p-6 w-full max-w-md space-y-4 shadow-xl">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-bold text-white">Join the waitlist</h2>
                  <p className="text-sm text-[#8f8f8f] mt-0.5">
                    {selectedDate ? selectedDate.toLocaleDateString("en-CA", { weekday: "long", month: "short", day: "numeric" }) : ""}
                  </p>
                </div>
                <button onClick={() => !waitlistSaving && setShowWaitlistModal(false)} className="text-[#8f8f8f] hover:text-white"><X size={18} /></button>
              </div>
              <p className="text-xs text-[#8f8f8f]">
                This day is full. Leave your details and we&apos;ll text or email you the moment a spot opens — first to reply gets it.
              </p>
              <div className="space-y-3">
                <input
                  value={waitlistForm.name}
                  onChange={e => setWaitlistForm(p => ({ ...p, name: e.target.value }))}
                  placeholder="Your name"
                  className="w-full bg-[#141414] border border-[#2a2a2a] rounded-xl px-4 py-2.5 text-sm text-white placeholder:text-[#8f8f8f] focus:outline-none focus:border-gold"
                />
                <input
                  value={waitlistForm.email}
                  onChange={e => setWaitlistForm(p => ({ ...p, email: e.target.value }))}
                  placeholder="Email"
                  type="email"
                  className="w-full bg-[#141414] border border-[#2a2a2a] rounded-xl px-4 py-2.5 text-sm text-white placeholder:text-[#8f8f8f] focus:outline-none focus:border-gold"
                />
                <input
                  value={waitlistForm.phone}
                  onChange={e => setWaitlistForm(p => ({ ...p, phone: formatPhone(e.target.value) }))}
                  placeholder="Phone (for a text alert)"
                  type="tel"
                  className="w-full bg-[#141414] border border-[#2a2a2a] rounded-xl px-4 py-2.5 text-sm text-white placeholder:text-[#8f8f8f] focus:outline-none focus:border-gold"
                />
                <p className="text-[11px] text-[#8f8f8f] -mt-1">Add at least an email or phone.</p>
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
