"use client";
import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useRouter } from "next/navigation";
import { User, Search, X, UserPlus, AlertCircle, Check, ShoppingCart, ChevronDown, CreditCard, Banknote, Link2, Gift, Star, Receipt } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { useResetOnReturn } from "@/lib/use-reset-on-return";
import { effectivePlan, planHasFeature } from "@/lib/validation";
import { FeatureLock } from "@/components/dashboard/feature-lock";
import { DashboardHeader } from "@/components/dashboard/page-header";
import { supabase } from "@/lib/supabase";
import { cn, formatCurrency, timeToMinutes } from "@/lib/utils";
import { shopChargesTax, combinedTaxRate, type TaxConfig } from "@/lib/pricing";
import { useSheetDrag } from "@/hooks/use-sheet-drag";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { Barber, Service, InventoryItem, PromoCode, AppointmentWithDetails } from "@/lib/database.types";
import { clientMatchesQuery } from "@/lib/client-search";
import { ApptDetail, makeApptActions, Portal } from "@/components/calendar-view";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { safeTz } from "@/lib/timezone";

type CartItem = { id: string; name: string; price: number; qty: number; type: "service" | "product"; inventoryId?: string };
type PM = "card" | "cash" | "online";
// id is null for "past customers" surfaced from appointments (not yet saved as
// a client row); saved flags whether they're already in the clients book.
type ClientLite = { id: string | null; name: string; email: string | null; phone: string | null; saved?: boolean };

function Toast({ message, onClose }: { message: string; onClose: () => void }) {
  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[100] bg-card-raised border border-border rounded-xl px-5 py-3 text-sm text-foreground shadow-xl flex items-center gap-3">
      <span className="text-foreground">✓</span>{message}
      <button onClick={onClose} className="text-grey hover:text-foreground ml-2">✕</button>
    </div>
  );
}

// How many appointment boxes to show per section before the "Show more" toggle.
const APPT_PREVIEW = 4;

export default function POSPage() {
  const { shop, accessToken } = useAuth();
  const [barbers, setBarbers] = useState<Barber[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [promoCodes, setPromoCodes] = useState<PromoCode[]>([]);
  const [dataLoaded, setDataLoaded] = useState(false);
  // POS grid tabs — split services from physical products so a big inventory
  // doesn't bury the service menu. Products are further grouped by category.
  const [posTab, setPosTab] = useState<"services" | "products" | "appointments">("appointments");
  const [productSearch, setProductSearch] = useState("");
  // Appointments tab — charge booked appointments (capture held card / take cash /
  // send link) right from the till, using the SAME pop-up card + buttons the
  // calendar uses. Shows today's + anything still needing payment, newest first.
  const [appts, setAppts] = useState<AppointmentWithDetails[]>([]);
  const [selectedAppt, setSelectedAppt] = useState<AppointmentWithDetails | null>(null);
  const [actionBusy, setActionBusy] = useState("");
  const [todayExpanded, setTodayExpanded] = useState(false);
  const [unpaidExpanded, setUnpaidExpanded] = useState(false);
  const { confirm } = useConfirm();

  const [cart, setCart] = useState<CartItem[]>([]);
  const [client, setClient] = useState(""); // empty until a customer is chosen
  const [custPhone, setCustPhone] = useState("");
  const [custEmail, setCustEmail] = useState("");
  const [barberId, setBarberId] = useState("");

  // ── Customer picker ──────────────────────────────────────────────────────
  const [clientsList, setClientsList] = useState<ClientLite[]>([]);
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [clientSearch, setClientSearch] = useState("");
  const [addOpen, setAddOpen] = useState(false); // "add new customer" form collapsed by default
  const [addName, setAddName] = useState("");
  const [addPhone, setAddPhone] = useState("");
  const [addEmail, setAddEmail] = useState("");
  const [addingClient, setAddingClient] = useState(false);
  // Set when a manual add hits an email/phone already on file — we surface the
  // existing client (possibly under a different name) instead of duplicating.
  const [dupClient, setDupClient] = useState<ClientLite | null>(null);
  const [tipPercent, setTipPercent] = useState<number | null>(null);
  const [customTip, setCustomTip] = useState("");
  const [promoCode, setPromoCode] = useState("");
  const [promoApplied, setPromoApplied] = useState<PromoCode | null>(null);
  const [giftCode, setGiftCode] = useState("");
  const [giftCard, setGiftCard] = useState<{ id: string; code: string; remaining_value: number } | null>(null);
  // Loyalty redemption: the selected client's redeemable balance (looked up by
  // email/phone) + whether staff chose to spend it. Points are settled server-side
  // on the sale, capped at the real balance.
  const [posLoyalty, setPosLoyalty] = useState<{ eligible: boolean; points: number; value: number } | null>(null);
  const [redeemLoyalty, setRedeemLoyalty] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<PM>("card");
  const [charging, setCharging] = useState(false);
  // Back from the Stripe card-payment page restores POS from bfcache with
  // `charging` frozen — clear it so the charge button doesn't spin forever.
  useResetOnReturn(() => setCharging(false));
  const [cartOpen, setCartOpen] = useState(false); // bottom order-summary drawer (UI only)
  // Checkout is a 2-step flow: staff reviews the cart + picks the tender, THEN
  // the screen hands to the customer to choose a tip and continue to pay.
  const [checkoutStep, setCheckoutStep] = useState<"review" | "tip">("review");
  // A customer must be chosen BEFORE checkout (step 1). When someone tries to
  // check out with none, this flips the "Select customer" button red + opens
  // the picker; it clears itself the moment a customer is set.
  const [needCustomer, setNeedCustomer] = useState(false);
  useEffect(() => { if (client.trim()) setNeedCustomer(false); }, [client]);
  // The card/online charge hands off to hosted Stripe. If that opens in a new
  // tab (or the owner hits back to change their mind) the original tab would
  // otherwise sit stuck on "Processing…" forever. Unfreeze the button whenever
  // this tab becomes visible again or is restored from the back-forward cache.
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === "visible") setCharging(false); };
    const onShow = () => setCharging(false);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("pageshow", onShow);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pageshow", onShow);
    };
  }, []);
  // Pull-down-to-dismiss for the mobile bottom sheets (scroll-aware).
  const cartSheetRef = useRef<HTMLDivElement | null>(null);
  const cartDrag = useSheetDrag(cartSheetRef, () => setCartOpen(false), { enabled: cartOpen });
  const pickerSheetRef = useRef<HTMLDivElement | null>(null);
  const pickerDrag = useSheetDrag(pickerSheetRef, () => setPickerOpen(false), { enabled: pickerOpen });
  const [success, setSuccess] = useState(false);
  const [toast, setToast] = useState("");
  const [lastCharge, setLastCharge] = useState<{ total: number; subtotal: number; method: PM; items: CartItem[]; tip: number; discount: number; tax?: number; summaryLabel?: string } | null>(null);
  const [lastReceiptId, setLastReceiptId] = useState<string | null>(null);

  const router = useRouter();
  // Guards the card-return finalize so it runs at most once per mount even if
  // React re-renders or the user refreshes (transactions has no idempotency key).
  const finalizedRef = useRef(false);

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(""), 3000); };

  const loadData = useCallback(async () => {
    if (!shop) return;
    const [barbersRes, svcsRes, invRes, promoRes, clientsRes] = await Promise.all([
      supabase.from("barbers").select("*").eq("shop_id", shop.id).eq("is_active", true).order("name"),
      supabase.from("services").select("*").eq("shop_id", shop.id).eq("is_active", true).order("category").order("name"),
      supabase.from("inventory").select("*").eq("shop_id", shop.id).order("name"),
      supabase.from("promo_codes").select("*").eq("shop_id", shop.id).eq("is_active", true),
      // Single source of truth — the clients book. Bookings now auto-register
      // customers here (see /api/clients/upsert), so this is the one list POS
      // and the Clients page both read from.
      supabase.from("clients").select("id, name, email, phone").eq("shop_id", shop.id).order("name"),
    ]);
    // No auto-select — staff must explicitly pick who performed the service, so a
    // sale (and its commission) is never silently credited to the wrong barber.
    if (barbersRes.data) setBarbers(barbersRes.data);
    if (svcsRes.data) setServices(svcsRes.data);
    if (invRes.data) setInventory(invRes.data);
    if (promoRes.data) setPromoCodes(promoRes.data);
    if (clientsRes.data) setClientsList((clientsRes.data as ClientLite[]).map(c => ({ ...c, saved: true })));
    setDataLoaded(true);
  }, [shop]);

  useEffect(() => { loadData(); }, [loadData]);

  // Appointments for the Appointments tab: today's + anything still needing
  // payment (held/saved/unpaid/failed), joined to the service name for the card.
  const loadAppts = useCallback(async () => {
    if (!shop) return;
    const today = new Date().toLocaleDateString("en-CA"); // local (= shop) YYYY-MM-DD
    const { data } = await supabase
      .from("appointments")
      .select("*, services(name)")
      .eq("shop_id", shop.id)
      .neq("status", "cancelled")
      .or(`date.eq.${today},payment_status.in.(held,saved,unpaid,failed)`)
      .order("created_at", { ascending: false })
      .limit(60);
    setAppts((data ?? []) as AppointmentWithDetails[]);
  }, [shop]);
  useEffect(() => { loadAppts(); }, [loadAppts]);

  // An appointment still has money to collect (drives the tab badge + ordering).
  const needsPayment = useCallback((a: AppointmentWithDetails) =>
    a.status !== "cancelled"
    && !["paid", "captured", "refunded"].includes(a.payment_status ?? "")
    && (Number(a.total_amount ?? 0) > 0 || a.payment_status === "held" || a.payment_status === "saved" || !!a.stripe_payment_method_id),
  []);

  // Sort: unpaid first, then newest — so the one to charge is right at the top.
  const apptsSorted = useMemo(() => [...appts].sort((a, b) => {
    const an = needsPayment(a) ? 0 : 1, bn = needsPayment(b) ? 0 : 1;
    if (an !== bn) return an - bn;
    return (b.created_at ?? "").localeCompare(a.created_at ?? "");
  }), [appts, needsPayment]);
  const apptNeedCount = useMemo(() => appts.filter(needsPayment).length, [appts, needsPayment]);

  // Two sections: TODAY (all of today's, by time) and UNPAID (still owing, past
  // days), so the till reads "who's in today" then "who still owes."
  const apptGroups = useMemo(() => {
    const today = new Date().toLocaleDateString("en-CA");
    const todays = appts.filter(a => a.date === today)
      .sort((a, b) => timeToMinutes(a.time_slot ?? "") - timeToMinutes(b.time_slot ?? ""));
    const unpaid = apptsSorted.filter(a => needsPayment(a) && a.date !== today);
    return { todays, unpaid };
  }, [appts, apptsSorted, needsPayment]);

  // One appointment BOX — same shape as the service/product tiles, so the tab
  // matches the rest of the till. Shared by both sections.
  const apptBox = (a: AppointmentWithDetails) => {
    const owed = Number(a.total_amount ?? 0) + Number(a.tip_amount ?? 0);
    const paidRow = a.payment_status === "paid" || a.payment_status === "captured";
    const badge = paidRow ? { t: "Paid", c: "bg-[#00e5a0]/15 text-[#00e5a0]" }
      : a.payment_status === "held" ? { t: "Held", c: "bg-[#4a9eff]/15 text-[#4a9eff]" }
      : (a.payment_status === "saved" || a.stripe_payment_method_id) ? { t: "On file", c: "bg-[#f5c542]/15 text-[#f5c542]" }
      : a.payment_status === "refunded" ? { t: "Refund", c: "bg-white/10 text-grey" }
      : { t: "Unpaid", c: "bg-white/10 text-grey" };
    const svcName = (a.services as { name?: string } | null)?.name ?? "Service";
    return (
      <button key={a.id} type="button" onClick={() => setSelectedAppt(a)}
        className="relative h-24 p-3 rounded-xl border border-border bg-card flex flex-col justify-between text-left transition-all active:scale-95 hover:border-white/20">
        <div className="min-w-0">
          <p className="text-[13px] font-bold text-foreground leading-tight truncate">{a.client_name || "Walk-in"}</p>
          <p className="text-[11px] text-grey-muted leading-tight truncate mt-0.5">{svcName} · {a.time_slot}</p>
        </div>
        <div className="flex items-end justify-between gap-1">
          <span className="text-[13px] font-bold text-foreground leading-none tabular-nums">{owed > 0 ? formatCurrency(owed) : ""}</span>
          <span className={cn("text-[9px] font-semibold px-1.5 py-0.5 rounded whitespace-nowrap", badge.c)}>{badge.t}</span>
        </div>
      </button>
    );
  };

  // Update a row locally (+ the open card) after an action, so the list reflects
  // a capture/cash/complete without a refetch. Mirrors the calendar's patch.
  const patchAppt = useCallback((id: string, p: Partial<AppointmentWithDetails>) => {
    setAppts(prev => prev.map(a => a.id === id ? { ...a, ...p } : a));
    setSelectedAppt(prev => prev && prev.id === id ? { ...prev, ...p } : prev);
  }, []);

  // The SAME action factory the calendar uses → identical buttons + behaviour.
  const apptActions = useMemo(() => makeApptActions({
    shop, accessToken, patch: patchAppt, setBusy: setActionBusy,
    toast: showToast, onDone: () => setSelectedAppt(null),
    confirm: (m) => confirm({ message: m }),
  }), [shop, accessToken, patchAppt, confirm]); // eslint-disable-line react-hooks/exhaustive-deps

  // Save the customer as a client when contact details are given and they're
  // not already on file (matched by phone or email). Keeps the book growing
  // off POS sales. Anonymous "Walk-in" with no contact details is skipped.
  const ensureClient = useCallback(async () => {
    if (!shop) return;
    if (selectedClientId) return; // already an existing client on file — nothing to save
    const name = client.trim();
    const phone = custPhone.trim();
    const email = custEmail.trim();
    if (!name || name.toLowerCase() === "walk-in") return;
    if (!phone && !email) return; // nothing to reach them by — don't save a bare name

    let existing = null;
    if (phone) {
      const { data } = await supabase.from("clients").select("id").eq("shop_id", shop.id).eq("phone", phone).maybeSingle();
      existing = data;
    }
    if (!existing && email) {
      const { data } = await supabase.from("clients").select("id").eq("shop_id", shop.id).ilike("email", email).maybeSingle();
      existing = data;
    }
    if (existing) return;

    await supabase.from("clients").insert({
      shop_id: shop.id, name, phone, email,
      total_visits: 0, total_spent: 0, loyalty_points: 0, tag: "New",
    });
    showToast(`Added ${name} to clients`);
  }, [shop, client, custPhone, custEmail, selectedClientId]);

  // Look up the selected customer's redeemable loyalty balance (by email/phone).
  // Server decides eligibility (on-plan + enabled + worth ≥ $5). Debounced; clears
  // when the contact clears or isn't eligible.
  useEffect(() => {
    if (!shop) { setPosLoyalty(null); setRedeemLoyalty(false); return; }
    const email = custEmail.trim();
    const phone = custPhone.trim();
    if (!email.includes("@") && phone.replace(/\D/g, "").length < 7) {
      setPosLoyalty(null); setRedeemLoyalty(false); return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const res = await fetch("/api/loyalty/lookup", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ shop_id: shop.id, email, phone }),
        });
        const data = await res.json();
        if (cancelled) return;
        if (data?.eligible) setPosLoyalty(data);
        else { setPosLoyalty(null); setRedeemLoyalty(false); }
      } catch { if (!cancelled) setPosLoyalty(null); }
    }, 400);
    return () => { cancelled = true; clearTimeout(t); };
  }, [shop, custEmail, custPhone]);

  // ── Customer picker helpers ─────────────────────────────────────────────
  const filteredClients = useMemo(() => {
    if (!clientSearch.trim()) return clientsList.slice(0, 8);
    return clientsList.filter(c => clientMatchesQuery(c, clientSearch)).slice(0, 20);
  }, [clientsList, clientSearch]);

  const selectClient = (c: ClientLite) => {
    setSelectedClientId(c.id);
    setClient(c.name);
    setCustPhone(c.phone ?? "");
    setCustEmail(c.email ?? "");
    setPickerOpen(false);
    setClientSearch(""); setDupClient(null); setAddOpen(false);
    setAddName(""); setAddPhone(""); setAddEmail("");
  };

  // Open the inline "add customer" form, prefilling the name from whatever's
  // typed in the search box so "no match → add" is a single tap.
  const openAddForm = () => {
    if (clientSearch.trim() && !addName.trim()) setAddName(clientSearch.trim());
    setAddOpen(true);
  };

  const clearClient = () => {
    setSelectedClientId(null);
    setClient(""); setCustPhone(""); setCustEmail("");
  };

  // Add a client manually from the picker. Runs a LIVE db lookup by email then
  // phone first — so even if the search list is stale/glitched, an existing
  // record (possibly saved under a different name) is caught and offered for
  // reuse rather than creating a duplicate with a conflicting email.
  const addManualClient = async () => {
    if (!shop) return;
    const name = addName.trim();
    if (!name) { showToast("Enter a name"); return; }
    const email = addEmail.trim();
    const phone = addPhone.trim();
    // No contact details → treat as a one-off walk-in: use the name for this
    // sale only, don't save to the book (nothing to match/dedupe on).
    if (!email && !phone) {
      setClient(name);
      setSelectedClientId(null);
      setCustPhone(""); setCustEmail("");
      setPickerOpen(false);
      setClientSearch(""); setDupClient(null);
      setAddName(""); setAddPhone(""); setAddEmail("");
      return;
    }
    setAddingClient(true);
    setDupClient(null);
    try {
      if (email) {
        const { data: existing } = await supabase.from("clients")
          .select("id, name, email, phone").eq("shop_id", shop.id).ilike("email", email).maybeSingle();
        if (existing) { setDupClient(existing as ClientLite); return; }
      }
      if (phone) {
        const { data: existingP } = await supabase.from("clients")
          .select("id, name, email, phone").eq("shop_id", shop.id).eq("phone", phone).maybeSingle();
        if (existingP) { setDupClient(existingP as ClientLite); return; }
      }
      const { data: inserted, error } = await supabase.from("clients").insert({
        shop_id: shop.id, name, email, phone,
        total_visits: 0, total_spent: 0, loyalty_points: 0, tag: "New",
      }).select("id, name, email, phone").single();
      if (error || !inserted) { showToast("Could not add client"); return; }
      const savedClient = { ...(inserted as ClientLite), saved: true };
      setClientsList(prev => [savedClient, ...prev]);
      selectClient(savedClient);
      showToast(`Added ${name}`);
    } finally {
      setAddingClient(false);
    }
  };

  // Handle the return from a card checkout. On ?paid=1&session_id=… verify the
  // payment server-side, record the sale, show the success screen, then strip
  // the params so a refresh can't re-finalize.
  useEffect(() => {
    if (!shop || typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("cancelled")) {
      showToast("Payment cancelled");
      router.replace("/dashboard/pos");
      return;
    }
    const sessionId = params.get("session_id");
    if (!sessionId || params.get("paid") !== "1" || finalizedRef.current) return;
    finalizedRef.current = true;
    setCharging(true);
    fetch("/api/stripe/pos-finalize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: sessionId, shop_id: shop.id }),
    })
      .then(r => r.json())
      .then((res) => {
        if (res.paid && res.sale) {
          setLastCharge({
            total: res.sale.total, subtotal: res.sale.subtotal, method: "card",
            items: [], tip: res.sale.tip, discount: res.sale.discount ?? 0, tax: res.sale.tax ?? 0,
            summaryLabel: res.sale.service_name,
          });
          if (res.transactionId) setLastReceiptId(res.transactionId);
          setSuccess(true);
          loadData();
        } else {
          showToast(res.error || "Payment could not be verified");
        }
      })
      .catch(() => showToast("Could not verify payment"))
      .finally(() => { setCharging(false); router.replace("/dashboard/pos"); });
  }, [shop, router, loadData]);

  const addItem = (id: string, name: string, price: number, type: "service" | "product", inventoryId?: string) => {
    setCart(prev => {
      const existing = prev.find(i => i.id === id);
      if (existing) return prev.map(i => i.id === id ? { ...i, qty: i.qty + 1 } : i);
      return [...prev, { id, name, price, qty: 1, type, inventoryId }];
    });
  };

  const removeItem = (id: string) => setCart(prev => prev.filter(i => i.id !== id));
  const changeQty = (id: string, delta: number) => {
    setCart(prev => prev.map(i => i.id === id ? { ...i, qty: Math.max(1, i.qty + delta) } : i));
  };

  const subtotal = cart.reduce((s, i) => s + i.price * i.qty, 0);
  const tipAmt = tipPercent !== null ? subtotal * (tipPercent / 100) : customTip ? Number(customTip) : 0;
  const discount = promoApplied
    ? (promoApplied.discount_type === "percent" ? subtotal * promoApplied.discount_value / 100 : promoApplied.discount_value)
    : 0;
  // Sales tax (shop config) on the discounted service/product amount; tips aren't taxed.
  const posTaxCfg = (shop?.booking_settings ?? null) as TaxConfig | null;
  // Charge tax only when registered (valid GST/HST number on file); rate is
  // GST/HST + any optional PST the owner turned on.
  const posTaxEnabled = shopChargesTax(posTaxCfg);
  const posTaxRate = combinedTaxRate(posTaxCfg);
  const taxLabel = (posTaxCfg?.tax_label || "Tax").trim();
  // Loyalty redemption behaves like a discount: it reduces the taxable base, the
  // total the customer pays, and the recorded revenue. Capped at the client's
  // redeemable value AND the remaining service subtotal (after any promo).
  const loyaltyDiscount = redeemLoyalty && posLoyalty?.eligible
    ? Math.min(posLoyalty.value, Math.max(0, subtotal - discount))
    : 0;
  const taxableAmt = Math.max(0, subtotal - discount - loyaltyDiscount);
  const taxAmt = posTaxEnabled ? Math.round(taxableAmt * posTaxRate) / 100 : 0;
  const total = Math.max(0, taxableAmt + taxAmt + tipAmt);
  // A gift card is TENDER, not new revenue (its value was booked when it sold),
  // so it reduces both the amount collected now AND the recorded sale revenue.
  const giftApplied = giftCard ? Math.min(giftCard.remaining_value, total) : 0;
  const dueAfterGift = Math.max(0, total - giftApplied);

  const applyPromo = () => {
    const found = promoCodes.find(p => p.code === promoCode.trim().toUpperCase() && p.is_active);
    if (!found) { showToast("Invalid or expired promo code"); return; }
    // The list is loaded by is_active only, so depleted/expired codes are still
    // in it — enforce the cap + expiry here so the owner gets a real reason
    // instead of a silent "applied!".
    if (found.expires_at && found.expires_at.slice(0, 10) < new Date().toISOString().slice(0, 10)) {
      showToast("This promo code has expired."); return;
    }
    if (found.uses_left != null && found.uses_left <= 0) {
      showToast("This promo code has reached its usage limit."); return;
    }
    setPromoApplied(found); showToast(`Promo ${found.code} applied!`);
  };

  const applyGift = async () => {
    if (!shop || !giftCode.trim()) return;
    const code = giftCode.trim().toUpperCase().replace(/\s+/g, "");
    const { data } = await supabase.from("gift_cards")
      .select("id, code, remaining_value, is_active").eq("shop_id", shop.id).eq("code", code).maybeSingle();
    if (!data || !data.is_active || (data.remaining_value ?? 0) <= 0) { showToast("Gift card not found or empty"); return; }
    setGiftCard({ id: data.id, code: data.code, remaining_value: data.remaining_value });
    showToast(`Gift card applied — ${formatCurrency(data.remaining_value)} available`);
  };

  const charge = async () => {
    if (cart.length === 0) { showToast("Please select a service first"); return; }
    // $0 due is valid when it's fully covered by a gift card, loyalty points, or a
    // promo (the sale still records + points deduct via the cash path below). Only
    // block a $0 due that ISN'T covered by anything (i.e. an empty/free cart).
    if (dueAfterGift <= 0 && !giftCard && loyaltyDiscount <= 0 && discount <= 0) {
      showToast("Cannot charge $0 — please add items"); return;
    }
    // A customer must be chosen (existing client or a name entered) before charging.
    if (!client.trim()) { showToast("Select or add a customer first"); setPickerOpen(true); return; }
    // A barber must be explicitly assigned for any SERVICE sale — commission +
    // attribution ride on it, so it can't be silently credited to a default.
    // Product-only retail sales don't need one.
    if (cart.some(i => i.type === "service") && barbers.length > 0 && !barberId) {
      showToast("Select a barber for this service"); return;
    }
    const tipPct = tipPercent !== null ? tipPercent : customTip ? (Number(customTip) / subtotal) * 100 : 0;
    if (tipPct > 100) { showToast("Tip cannot exceed 100%"); return; }
    // Gift card + a card/online remainder = a split payment we don't support
    // yet; take the leftover as cash (or let the gift cover it fully).
    if (giftCard && dueAfterGift > 0 && paymentMethod !== "cash") {
      showToast("Take the remaining balance as cash, or remove the gift card.");
      return;
    }
    if (paymentMethod === "cash") {
      const cashEl = document.getElementById("cash-input") as HTMLInputElement | null;
      const cashVal = cashEl ? parseFloat(cashEl.value) : NaN;
      if (!isNaN(cashVal) && cashVal < dueAfterGift) { showToast(`Cash amount ($${cashVal.toFixed(2)}) is less than due ($${dueAfterGift.toFixed(2)})`); return; }
    }
    setCharging(true);

    const selectedBarber = barbers.find(b => b.id === barberId);
    const serviceItems = cart.filter(i => i.type === "service");
    const primaryService = serviceItems[0];
    const serviceName = primaryService?.name ?? cart[0]?.name ?? "Sale";
    // Commission is a TALLY figure (not a payout) and applies ONLY to the SERVICES
    // in the cart, for the barber actually assigned — never to retail products,
    // and computed AFTER the discount (allocated to the services' share). No
    // barber selected → no commission. Same math for an owner-barber (his rate,
    // which defaults to 0%). This stops barbers being over-paid on product sales
    // and on the pre-discount total.
    const serviceSubtotal = serviceItems.reduce((s, i) => s + i.price * i.qty, 0);
    // Allocate BOTH the promo + loyalty discounts to the services' share, so
    // commission is on what the barber's services actually netted.
    const serviceAfterDiscount = subtotal > 0
      ? Math.max(0, serviceSubtotal - (discount + loyaltyDiscount) * (serviceSubtotal / subtotal))
      : 0;
    // Commission is no longer computed here — the server recomputes it from the
    // barber's DB rate applied to `serviceAfterDiscount` (sent as commission_base),
    // so the browser can't dictate the cut. selectedBarber is still used elsewhere.
    const txType = serviceItems.length > 0 ? "service" : "product";

    // Itemized lines for the receipt — name · qty · unit price for every cart
    // item (services AND products). Compact keys (n/q/p) so the card path fits in
    // Stripe metadata. Names capped so a big cart can't blow the metadata limit.
    const receiptItems = cart.map(i => ({ n: i.name.slice(0, 40), q: i.qty, p: i.price }));

    // Save the customer to the book if they're new (applies to every method).
    await ensureClient();

    // ── Card / Online → real payment via hosted Stripe Checkout ──────────────
    // Redirects to Stripe; the transaction is recorded on return in the
    // pos-finalize effect above. Cart/inventory ride along in session metadata.
    // Skipped when a gift card fully covers the sale (dueAfterGift === 0) — that
    // is settled client-side just below with no card charge.
    if ((paymentMethod === "card" || paymentMethod === "online") && dueAfterGift > 0) {
      const products = cart
        .filter(i => i.type === "product" && i.inventoryId)
        .map(i => ({ id: i.inventoryId!, qty: i.qty }));
      try {
        const res = await fetch("/api/stripe/pos-checkout", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) },
          body: JSON.stringify({
            shop_id: shop!.id,
            origin: window.location.origin,
            barber_id: barberId || null,
            client_name: client,
            client_email: custEmail.trim(),
            client_phone: custPhone.trim(),
            service_name: serviceName,
            subtotal, tip: tipAmt, discount, total, tax: taxAmt,
            commission_base: serviceAfterDiscount,
            type: txType,
            promo_code: promoApplied?.code ?? null,
            redeem_loyalty: redeemLoyalty && !!posLoyalty?.eligible,
            loyalty_discount: loyaltyDiscount,
            products,
            items: receiptItems,
          }),
        });
        const data = await res.json();
        if (!res.ok || !data.url) { showToast(data.error || "Could not start card payment"); setCharging(false); return; }
        window.location.href = data.url; // off to Stripe; we come back to ?paid=1
      } catch {
        showToast("Could not start card payment"); setCharging(false);
      }
      return;
    }

    // ── Cash (or gift-card-covered) → record the sale server-side ────────────
    // Runs through /api/pos/cash-sale (service role) so it isn't blocked by
    // transactions RLS (there is no owner INSERT policy — client-side inserts
    // errored, which is why cash failed where card worked) and survives columns
    // prod may not have yet. The route also draws down inventory + the gift card
    // so we never double-count. Revenue recorded = the part NOT covered by the
    // gift card (the gift's value was booked as revenue when it was sold).
    const products = cart
      .filter(i => i.type === "product" && i.inventoryId)
      .map(i => ({ id: i.inventoryId!, qty: i.qty }));
    try {
      const res = await fetch("/api/pos/cash-sale", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) },
        body: JSON.stringify({
          shop_id: shop!.id,
          owner_id: shop!.owner_id,
          barber_id: barberId || null,
          client_name: client,
          client_email: custEmail.trim(),
          client_phone: custPhone.trim(),
          service_name: giftApplied > 0 ? `${serviceName} (gift card ${formatCurrency(giftApplied)})` : serviceName,
          // Recorded revenue nets out BOTH discounts (promo + loyalty — revenue
          // given up) so cash matches the card path and Payments/analytics aren't
          // overstated. Gift is tender (already booked as revenue at its sale), so
          // it's subtracted separately as before.
          amount: Math.max(0, subtotal - discount - loyaltyDiscount - giftApplied),
          tip: tipAmt,
          tax: taxAmt,
          commission_base: serviceAfterDiscount,
          payment_method: paymentMethod,
          type: txType,
          promo_code: promoApplied?.code ?? null,
          redeem_loyalty: redeemLoyalty && !!posLoyalty?.eligible,
          loyalty_discount: loyaltyDiscount,
          products,
          items: receiptItems,
          gift_card: giftCard ? { id: giftCard.id, remaining_value: giftCard.remaining_value, applied: giftApplied } : null,
        }),
      });
      const data = await res.json();
      if (!res.ok) { showToast(data.error || "Error saving transaction"); setCharging(false); return; }
      if (data.transactionId) setLastReceiptId(data.transactionId);
    } catch {
      showToast("Error saving transaction"); setCharging(false); return;
    }

    setLastCharge({ total: dueAfterGift, subtotal, method: paymentMethod, items: [...cart], tip: tipAmt, discount: discount + loyaltyDiscount + giftApplied, tax: taxAmt });
    setCharging(false);
    setSuccess(true);

    // Refresh services/inventory/clients after the sale.
    loadData();
  };

  const reset = () => {
    setCart([]); setTipPercent(null); setCustomTip(""); setPromoCode(""); setPromoApplied(null);
    setGiftCode(""); setGiftCard(null); setPosLoyalty(null); setRedeemLoyalty(false);
    setPaymentMethod("card"); setCheckoutStep("review"); setSuccess(false); setLastCharge(null); setLastReceiptId(null); setClient("");
    setCustPhone(""); setCustEmail("");
    setSelectedClientId(null); setPickerOpen(false); setClientSearch(""); setDupClient(null);
    setAddName(""); setAddPhone(""); setAddEmail(""); setCartOpen(false);
    finalizedRef.current = false; // allow the next card sale to finalize
    setBarberId(""); // reset to "Select barber" — force an explicit pick each sale
  };

  if (!shop) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <div className="text-center">
          <CreditCard className="w-9 h-9 text-grey-muted mx-auto mb-3" />
          <h2 className="text-lg font-bold text-foreground mb-1">No shop linked</h2>
          <p className="text-sm text-grey">POS will be available once your shop is set up.</p>
        </div>
      </div>
    );
  }

  // Plan gate — POS is a Premium feature. Backs up the hidden sidebar link so a
  // direct URL visit doesn't grant access on a plan that doesn't include it.
  if (!planHasFeature(effectivePlan(shop.subscription_plan, shop.subscription_status), "pos")) {
    return <FeatureLock title="Point of Sale" description="The in-person POS (cash & card) is available on the Pro and Premium plans." />;
  }

  if (success && lastCharge) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <div className="w-full max-w-md space-y-6 text-center">
          <div className="w-24 h-24 rounded-full bg-emerald-500/20 border-2 border-emerald-500 flex items-center justify-center mx-auto">
            <Check className="w-12 h-12 text-emerald-500" strokeWidth={3} />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-foreground">Payment Received!</h2>
            <p className="text-3xl font-bold text-foreground mt-2">{formatCurrency(lastCharge.total)}</p>
          </div>
          <Card className="text-left space-y-3">
            <div className="space-y-2">
              {lastCharge.items.length > 0 ? (
                lastCharge.items.map(item => (
                  <div key={item.id} className="flex justify-between text-sm">
                    <span className="text-grey">{item.name} × {item.qty}</span>
                    <span className="text-foreground">{formatCurrency(item.price * item.qty)}</span>
                  </div>
                ))
              ) : (
                // Card sales come back from Stripe with the cart cleared — show
                // the service label captured at checkout instead.
                <div className="flex justify-between text-sm">
                  <span className="text-grey">{lastCharge.summaryLabel ?? "Sale"}</span>
                  <span className="text-foreground">{formatCurrency(lastCharge.subtotal)}</span>
                </div>
              )}
            </div>
            <div className="border-t border-border pt-3 space-y-1">
              <div className="flex justify-between text-sm"><span className="text-grey">Subtotal</span><span className="text-foreground">{formatCurrency(lastCharge.subtotal)}</span></div>
              <div className="flex justify-between text-sm"><span className="text-grey">Tip</span><span className="text-foreground">{formatCurrency(lastCharge.tip)}</span></div>
              {(lastCharge.tax ?? 0) > 0 && <div className="flex justify-between text-sm"><span className="text-grey">{taxLabel}</span><span className="text-foreground">{formatCurrency(lastCharge.tax ?? 0)}</span></div>}
              {lastCharge.discount > 0 && <div className="flex justify-between text-sm"><span className="text-grey">Discount</span><span className="text-emerald-400">-{formatCurrency(lastCharge.discount)}</span></div>}
              <div className="flex justify-between font-bold border-t border-border pt-2 mt-2"><span className="text-foreground">Total</span><span className="text-foreground text-lg">{formatCurrency(lastCharge.total)}</span></div>
            </div>
            <div className="flex justify-between text-sm pt-2 border-t border-border">
              <span className="text-grey">Payment</span>
              <span className="text-foreground capitalize">{lastCharge.method}</span>
            </div>
          </Card>
          <div className="flex gap-3">
            {lastReceiptId && (
              <a href={`/receipt/${lastReceiptId}`} target="_blank" rel="noopener noreferrer" className="flex-1">
                <Button variant="outline" className="w-full" size="lg"><Receipt size={16} /> View Receipt</Button>
              </a>
            )}
            <Button className={lastReceiptId ? "flex-1" : "w-full"} size="lg" onClick={reset}>New Sale</Button>
          </div>
        </div>
      </div>
    );
  }

  const servicesByCategory = services.reduce((acc, s) => {
    if (!acc[s.category]) acc[s.category] = [];
    acc[s.category].push(s);
    return acc;
  }, {} as Record<string, Service[]>);

  // Products grouped into category sub-sections (falls back to "Products" when
  // an item has no category), filtered by the product search box. Plain compute
  // (NOT useMemo) — this lives after the early returns above, where adding a
  // hook would break the Rules of Hooks and crash the success screen.
  const productQuery = productSearch.trim().toLowerCase();
  const filteredInventory = productQuery
    ? inventory.filter(i => i.name.toLowerCase().includes(productQuery) || (i.category?.toLowerCase().includes(productQuery) ?? false))
    : inventory;
  const inventoryByCategory = filteredInventory.reduce((acc, i) => {
    const cat = i.category?.trim() || "Products";
    (acc[cat] ||= []).push(i);
    return acc;
  }, {} as Record<string, InventoryItem[]>);

  const itemCount = cart.reduce((n, i) => n + i.qty, 0);

  // Shared order-summary body — reused by the mobile drawer and the desktop
  // side panel so there's a single source for items + checkout.
  const cartItemsList = (
    <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3 space-y-2">
      {cart.length === 0 ? (
        <div className="text-center py-8"><ShoppingCart className="w-7 h-7 text-grey-muted mx-auto mb-1.5" /><p className="text-xs text-grey-muted">No items added</p></div>
      ) : cart.map(item => (
        <div key={item.id} className="flex items-center gap-2 p-3 bg-card-raised rounded-xl border border-border">
          <div className="flex-1 min-w-0">
            <p className="text-sm text-foreground truncate">{item.name}</p>
            <p className="text-xs text-grey-muted">{formatCurrency(item.price)}</p>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={() => changeQty(item.id, -1)} className="w-7 h-7 rounded-lg bg-surface-overlay border border-border text-foreground flex items-center justify-center">−</button>
            <span className="text-sm text-foreground w-5 text-center">{item.qty}</span>
            <button onClick={() => changeQty(item.id, 1)} className="w-7 h-7 rounded-lg bg-surface-overlay border border-border text-foreground flex items-center justify-center">+</button>
          </div>
          <button onClick={() => removeItem(item.id)} className="ml-1 text-red-400 hover:text-red-300"><X size={16} /></button>
        </div>
      ))}
    </div>
  );

  // Empty cart always shows the review step (never a stale tip screen).
  const step: "review" | "tip" = cart.length > 0 ? checkoutStep : "review";
  const barberFirst = (barbers.find(b => b.id === barberId)?.name ?? "").split(" ")[0];

  const cartFooter = (
    <div className="shrink-0 px-4 pt-3 pb-4 border-t border-border space-y-3">
      {step === "review" ? (
        <>
          {/* ── STEP 1 (staff): review + choose how they're paying ── */}
          <div className="flex justify-between text-sm"><span className="text-grey-muted">Subtotal</span><span className="text-foreground">{formatCurrency(subtotal)}</span></div>
          {promoCodes.length > 0 && (
            <div className="flex gap-2">
              <Input placeholder="Promo code" value={promoCode} onChange={e => setPromoCode(e.target.value)} className="flex-1 text-xs" />
              <Button variant="outline" size="sm" onClick={applyPromo}>Apply</Button>
            </div>
          )}
          {/* Gift card as tender */}
          {giftCard ? (
            <div className="flex items-center justify-between rounded-lg border border-[#00e5a0]/40 bg-[#00e5a0]/10 px-3 py-2">
              <span className="text-xs text-foreground flex items-center gap-1.5"><Gift size={13} /> {giftCard.code} · {formatCurrency(giftCard.remaining_value)} avail</span>
              <button onClick={() => { setGiftCard(null); setGiftCode(""); }} className="text-grey hover:text-foreground"><X size={14} /></button>
            </div>
          ) : (
            <div className="flex gap-2">
              <Input placeholder="Gift card code" value={giftCode} onChange={e => setGiftCode(e.target.value.toUpperCase())} className="flex-1 text-xs" />
              <Button variant="outline" size="sm" onClick={applyGift}>Apply</Button>
            </div>
          )}
          {/* Loyalty — spend the client's points (only shows with a redeemable balance) */}
          {posLoyalty?.eligible && (
            <button type="button" onClick={() => setRedeemLoyalty(v => !v)}
              className={cn("w-full flex items-center gap-2 rounded-lg border px-3 py-2 text-left transition-colors",
                redeemLoyalty ? "border-[#00e5a0]/40 bg-[#00e5a0]/10" : "border-border hover:border-[#00e5a0]/40")}>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-foreground flex items-center gap-1.5"><Star size={13} /> Use loyalty points</p>
                <p className="text-[10px] text-grey-muted">{posLoyalty.points} pts · up to {formatCurrency(posLoyalty.value)} off</p>
              </div>
              <span className={cn("w-9 h-5 rounded-full relative transition-colors flex-shrink-0", redeemLoyalty ? "bg-[#00e5a0]" : "bg-[#2a2a2a]")}>
                <span className={cn("absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all", redeemLoyalty ? "left-[18px]" : "left-0.5")} />
              </span>
            </button>
          )}
          {discount > 0 && <div className="flex justify-between text-xs"><span className="text-grey-muted">Discount</span><span className="text-[#00e5a0]">-{formatCurrency(discount)}</span></div>}
          {loyaltyDiscount > 0 && <div className="flex justify-between text-xs"><span className="text-grey-muted">Loyalty points</span><span className="text-[#00e5a0]">-{formatCurrency(loyaltyDiscount)}</span></div>}
          {taxAmt > 0 && <div className="flex justify-between text-xs"><span className="text-grey-muted">{taxLabel} ({posTaxRate}%)</span><span className="text-foreground">{formatCurrency(taxAmt)}</span></div>}
          {giftApplied > 0 && <div className="flex justify-between text-xs"><span className="text-grey-muted">Gift card</span><span className="text-[#00e5a0]">-{formatCurrency(giftApplied)}</span></div>}
          <div className="flex justify-between items-baseline border-t border-border pt-2">
            <span className="text-sm font-bold text-foreground">{giftApplied > 0 ? "DUE NOW" : "TOTAL"}</span>
            <span className="text-xl font-extrabold text-foreground">{formatCurrency(dueAfterGift)}</span>
          </div>
          <p className="text-[11px] text-grey-muted text-center pt-0.5">Pick a payment method — the customer adds a tip next</p>
          <div className="grid grid-cols-3 gap-2">
            {(["card","cash","online"] as PM[]).map(m => (
              <button key={m} onClick={() => { if (!client.trim()) { setNeedCustomer(true); setPickerOpen(true); return; } if (cart.some(i => i.type === "service") && barbers.length > 0 && !barberId) { showToast("Select a barber for this service"); return; } setPaymentMethod(m); setCheckoutStep("tip"); }}
                className="py-3 rounded-[12px] text-xs font-semibold border border-border bg-surface-overlay text-foreground hover:border-[#00e5a0]/60 active:scale-95 transition-all flex flex-col items-center gap-1">
                {m === "card" ? <CreditCard size={20} /> : m === "cash" ? <Banknote size={20} /> : <Link2 size={20} />}
                {m === "card" ? "Card / Tap" : m === "cash" ? "Cash" : "Link"}
              </button>
            ))}
          </div>
        </>
      ) : (
        <>
          {/* ── STEP 2 (customer-facing): choose a tip, then continue to pay ── */}
          <button type="button" onClick={() => setCheckoutStep("review")} className="text-xs text-grey-muted hover:text-foreground">← Back</button>
          <div className="text-center py-1">
            <p className="text-base font-semibold text-foreground">Add a tip{barberFirst ? ` for ${barberFirst}` : ""}?</p>
            <p className="text-[11px] text-grey-muted mt-0.5">on {formatCurrency(subtotal)}</p>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {[10,15,20].map(t => {
              const on = tipPercent === t;
              return (
                <button key={t} onClick={() => { setTipPercent(t); setCustomTip(""); }}
                  className={cn("py-3 rounded-xl border font-bold transition-all active:scale-95 flex flex-col items-center", on ? "bg-[#00e5a0] text-black border-[#00e5a0]" : "bg-surface-overlay text-foreground border-border")}>
                  <span className="text-base leading-none">{t}%</span>
                  <span className={cn("text-[11px] mt-0.5", on ? "text-black/70" : "text-grey-muted")}>{formatCurrency(subtotal * t / 100)}</span>
                </button>
              );
            })}
          </div>
          <div className="flex gap-2">
            <div className="flex-1 flex items-center gap-1 rounded-xl border border-border bg-surface-overlay px-3">
              <span className="text-grey-muted text-sm">$</span>
              <input type="number" inputMode="decimal" placeholder="Custom tip" value={customTip}
                onChange={e => { setCustomTip(e.target.value); setTipPercent(null); }}
                className="w-full bg-transparent py-2.5 text-sm text-foreground focus:outline-none placeholder:text-grey-muted" />
            </div>
            <button type="button" onClick={() => { setTipPercent(null); setCustomTip(""); }}
              className={cn("px-4 rounded-xl border text-sm font-semibold transition-colors", (tipPercent === null && !customTip) ? "border-[#00e5a0]/60 bg-surface-overlay text-foreground" : "border-border bg-surface-overlay text-grey")}>
              No tip
            </button>
          </div>
          {tipAmt > 0 && <div className="flex justify-between text-xs"><span className="text-grey-muted">Tip</span><span className="text-foreground">{formatCurrency(tipAmt)}</span></div>}
          <div className="flex justify-between items-baseline border-t border-border pt-2">
            <span className="text-sm font-bold text-foreground">{giftApplied > 0 ? "DUE NOW" : "TOTAL"}</span>
            <span className="text-xl font-extrabold text-foreground">{formatCurrency(dueAfterGift)}</span>
          </div>
          <button type="button" onClick={charge} disabled={charging || cart.length === 0}
            className="w-full rounded-[14px] bg-[#00e5a0] text-black font-extrabold text-base py-4 active:scale-[0.99] transition-transform disabled:opacity-60">
            {charging ? "Processing…"
              : paymentMethod === "cash" ? `Complete cash · ${formatCurrency(dueAfterGift)}`
              : paymentMethod === "online" ? `Send payment link · ${formatCurrency(dueAfterGift)}`
              : `Continue to tap card · ${formatCurrency(dueAfterGift)}`}
          </button>
        </>
      )}
    </div>
  );

  // Stack vertically on mobile (left panel scrolls, cart docks below);
  // side-by-side on tablet+. h-screen on desktop only — on mobile the
  // page can scroll naturally so the bottom nav stays clear.
  return (
    // data-no-swipe: POS is a money workflow — never let an accidental page
    // swipe navigate away mid-sale and drop the in-progress cart.
    <div data-no-swipe className="bg-background">
      {toast && <Toast message={toast} onClose={() => setToast("")} />}

      {/* Charge a booked appointment from the till — the SAME pop-up card + buttons
          the calendar uses (capture held card / take cash / send link). */}
      {selectedAppt && (
        <Portal>
          <ApptDetail
            appt={selectedAppt}
            barbers={barbers}
            services={services}
            onClose={() => setSelectedAppt(null)}
            actions={apptActions}
            busy={actionBusy}
            tz={safeTz((shop as { timezone?: string } | null)?.timezone)}
            noShowFeePercent={(shop?.booking_settings as { no_show_fee_percent?: number } | null)?.no_show_fee_percent}
            accessToken={accessToken}
          />
        </Portal>
      )}

      {/* App shell — mobile/tablet: top bar + grid stacked, with a sticky cart
          bar + drawer. PC (lg): order summary as a side panel on the RIGHT
          (flex-row-reverse keeps DOM order but renders the panel last). */}
      {/* MOBILE: no fixed height/overflow — the content flows and the PAGE scrolls
          natively. The layout's <main> already reserves 3.5rem+safe-top on top and
          6rem+safe-bottom for the nav, so native scroll always reaches the bottom
          (in the browser AND the installed PWA) regardless of banners/safe-areas —
          no fragile height math. DESKTOP (lg): the fixed side-panel shell with its
          own internal scroll, as before. */}
      <div className="flex flex-col lg:flex-row-reverse lg:h-screen lg:overflow-hidden">

        {/* PC order-summary side panel (right). Hidden below lg, where the sticky
            cart bar + drawer take over. Reuses the shared cart body. */}
        <div className="hidden lg:flex w-80 shrink-0 flex-col bg-card border-l border-border">
          <div className="shrink-0 px-4 py-3 border-b border-border">
            <h2 className="text-base font-bold text-foreground">Order Summary</h2>
            <p className="text-xs text-grey-muted truncate">{client || "No customer"} · {barbers.find(b => b.id === barberId)?.name ?? "—"}</p>
          </div>
          {cartItemsList}
          {cartFooter}
        </div>

        {/* Main column — page header + top bar + scrollable service grid */}
        <div className="flex-1 min-w-0 flex flex-col">

        {/* Page title — universal top header, so POS matches every other page.
            Sits above the workflow bar; the grid (flex-1) absorbs its height. */}
        <div className="shrink-0 px-3"><DashboardHeader title="Point of Sale" /></div>

        {/* 1 ─ TOP BAR: Customer | Barber side by side, no labels. On mobile it
            sticks just under the app's fixed top bar during native page scroll so
            the customer/barber pickers stay reachable; on desktop it's static in
            the fixed shell. */}
        <div className="shrink-0 sticky top-[calc(3.5rem+env(safe-area-inset-top))] z-20 bg-background lg:static lg:top-auto lg:z-auto flex gap-2 p-3 border-b border-white/[0.07]">
          <button type="button" onClick={() => { setAddOpen(false); setPickerOpen(true); }}
            className={cn("flex-1 min-w-0 h-11 flex items-center gap-2 rounded-xl border bg-card-raised px-3 text-sm text-left transition-colors",
              client ? "border-border" : needCustomer ? "border-red-500 bg-red-500/10 animate-pulse" : "border-[#00e5a0]/40")}>
            <User size={15} className={cn("shrink-0", needCustomer && !client ? "text-red-400" : "text-grey-muted")} />
            <span className="flex-1 min-w-0 leading-tight">
              <span className={cn("block truncate", client ? "text-foreground" : needCustomer ? "text-red-400 font-semibold" : "text-grey-muted")}>{client || "Select customer"}</span>
              {client && (custEmail || custPhone) && <span className="block text-[10px] text-grey-muted truncate">{custEmail || custPhone}</span>}
            </span>
            <Search size={13} className="text-grey-muted shrink-0" />
          </button>
          <div className="relative flex-1 min-w-0">
            <select value={barberId} onChange={e => setBarberId(e.target.value)}
              className="w-full h-11 appearance-none rounded-xl border border-border bg-card-raised pl-3 pr-8 text-sm text-foreground focus:outline-none focus:border-[#00e5a0]/50">
              <option value="" disabled={barbers.length > 0}>{barbers.length === 0 ? "No barbers" : "Select barber"}</option>
              {barbers.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
            <ChevronDown size={15} className="text-grey-muted absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          </div>
        </div>

        {/* 2 ─ SERVICE GRID. MOBILE: flows with the page (native scroll). DESKTOP:
            its own internal scroll inside the fixed shell. Big bottom padding only
            when the sticky cart bar is actually showing (cart has items) — on the
            Appointments tab there's no cart bar, so a tight pad avoids a big empty
            gap under the last row. The layout's <main> pb already clears the nav. */}
        <div className={cn("lg:flex-1 lg:min-h-0 lg:overflow-y-auto px-3 pt-3 lg:pb-28", cart.length > 0 ? "pb-28" : "pb-4")}>

        {!dataLoaded ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
            {Array.from({ length: 8 }).map((_, i) => <div key={i} className="h-20 rounded-xl bg-card-raised animate-pulse" />)}
          </div>
        ) : (
          <>
            {/* Catalog / Appointments tabs. Services + Appointments always;
                Products only when there's inventory to split out. */}
            <div className="flex gap-1 p-1 rounded-xl bg-card-raised border border-border mb-3">
              <button type="button" onClick={() => setPosTab("appointments")}
                className={cn("flex-1 h-9 rounded-lg text-sm font-semibold transition-colors",
                  posTab === "appointments" ? "bg-white text-black" : "text-grey hover:text-foreground")}>
                Appointments{apptNeedCount > 0 ? ` (${apptNeedCount})` : ""}
              </button>
              <button type="button" onClick={() => setPosTab("services")}
                className={cn("flex-1 h-9 rounded-lg text-sm font-semibold transition-colors",
                  posTab === "services" ? "bg-white text-black" : "text-grey hover:text-foreground")}>
                Services
              </button>
              {inventory.length > 0 && (
                <button type="button" onClick={() => setPosTab("products")}
                  className={cn("flex-1 h-9 rounded-lg text-sm font-semibold transition-colors",
                    posTab === "products" ? "bg-white text-black" : "text-grey hover:text-foreground")}>
                  Products ({inventory.length})
                </button>
              )}
            </div>

            {posTab === "services" && Object.entries(servicesByCategory).map(([cat, svcs]) => (
              <div key={cat}>
                <p className="text-[10px] tracking-[0.15em] uppercase text-[#444] mt-4 mb-2 first:mt-0">{cat}</p>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                  {svcs.map(svc => {
                    const selected = cart.some(i => i.id === svc.id);
                    return (
                      <button key={svc.id} onClick={() => addItem(svc.id, svc.name, svc.price, "service")}
                        className={cn("relative h-20 p-3 rounded-xl border bg-card flex flex-col justify-between text-left transition-all active:scale-95",
                          selected ? "border-[#00e5a0]" : "border-border hover:border-white/20")}>
                        {selected && (
                          <span className="absolute top-1.5 right-1.5 w-4 h-4 rounded-full bg-[#00e5a0] flex items-center justify-center">
                            <Check size={11} className="text-black" strokeWidth={3} />
                          </span>
                        )}
                        <p className="text-[14px] font-bold text-foreground leading-tight line-clamp-2 pr-4">{svc.name}</p>
                        <div className="flex items-end justify-between gap-1">
                          <span className="text-[12px] text-grey-muted leading-none">{svc.duration_minutes} min</span>
                          <span className="text-[14px] font-bold text-[#00e5a0] leading-none">{formatCurrency(svc.price)}</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}

            {inventory.length > 0 && posTab === "products" && (
              <>
                {inventory.length > 6 && (
                  <div className="flex items-center gap-2 rounded-xl border border-border bg-card-raised px-3 mb-3">
                    <Search size={15} className="text-grey shrink-0" />
                    <input value={productSearch} onChange={e => setProductSearch(e.target.value)}
                      placeholder="Search products"
                      className="flex-1 bg-transparent py-2.5 text-sm text-foreground focus:outline-none placeholder:text-grey-muted" />
                    {productSearch && <button type="button" onClick={() => setProductSearch("")} className="text-grey hover:text-foreground shrink-0"><X size={14} /></button>}
                  </div>
                )}
                {Object.keys(inventoryByCategory).length === 0 ? (
                  <p className="text-center text-xs text-grey-muted py-10">No products match &ldquo;{productSearch}&rdquo;</p>
                ) : Object.entries(inventoryByCategory).map(([cat, items]) => (
                  <div key={cat}>
                    <p className="text-[10px] tracking-[0.15em] uppercase text-[#444] mt-4 mb-2 first:mt-0">{cat}</p>
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                      {items.map(inv => {
                        const selected = cart.some(i => i.id === `inv-${inv.id}`);
                        return (
                          <button key={inv.id} onClick={() => addItem(`inv-${inv.id}`, inv.name, inv.price, "product", inv.id)}
                            className={cn("relative h-20 p-3 rounded-xl border bg-card flex flex-col justify-between text-left transition-all active:scale-95",
                              selected ? "border-[#00e5a0]" : "border-border hover:border-white/20",
                              inv.quantity === 0 && "opacity-40 pointer-events-none")}>
                            {selected && (
                              <span className="absolute top-1.5 right-1.5 w-4 h-4 rounded-full bg-[#00e5a0] flex items-center justify-center">
                                <Check size={11} className="text-black" strokeWidth={3} />
                              </span>
                            )}
                            <p className="text-[13px] font-semibold text-foreground leading-tight line-clamp-2 pr-4">{inv.name}</p>
                            <div className="flex items-end justify-between gap-1">
                              {inv.quantity <= inv.low_stock_threshold && inv.quantity > 0
                                ? <span className="text-[10px] text-red-400 leading-none">{inv.quantity} left</span>
                                : <span />}
                              <span className="text-[14px] font-bold text-[#00e5a0] leading-none">{formatCurrency(inv.price)}</span>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </>
            )}

            {posTab === "appointments" && (
              (apptGroups.todays.length === 0 && apptGroups.unpaid.length === 0) ? (
                <p className="text-center text-xs text-grey-muted py-10">No appointments today, and nothing waiting on payment.</p>
              ) : (
                <>
                  {apptGroups.todays.length > 0 && (
                    <div>
                      <p className="text-[10px] tracking-[0.15em] uppercase text-[#444] mt-4 mb-2 first:mt-0">Today ({apptGroups.todays.length})</p>
                      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                        {(todayExpanded ? apptGroups.todays : apptGroups.todays.slice(0, APPT_PREVIEW)).map(apptBox)}
                      </div>
                      {apptGroups.todays.length > APPT_PREVIEW && (
                        <button type="button" onClick={() => setTodayExpanded(v => !v)}
                          className="w-full mt-2 h-9 rounded-lg border border-border bg-card-raised text-sm font-medium text-grey hover:text-foreground transition-colors">
                          {todayExpanded ? "Show less" : `Show ${apptGroups.todays.length - APPT_PREVIEW} more`}
                        </button>
                      )}
                    </div>
                  )}
                  {apptGroups.unpaid.length > 0 && (
                    <div>
                      <p className="text-[10px] tracking-[0.15em] uppercase text-[#444] mt-6 mb-2">Unpaid ({apptGroups.unpaid.length})</p>
                      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                        {(unpaidExpanded ? apptGroups.unpaid : apptGroups.unpaid.slice(0, APPT_PREVIEW)).map(apptBox)}
                      </div>
                      {apptGroups.unpaid.length > APPT_PREVIEW && (
                        <button type="button" onClick={() => setUnpaidExpanded(v => !v)}
                          className="w-full mt-2 h-9 rounded-lg border border-border bg-card-raised text-sm font-medium text-grey hover:text-foreground transition-colors">
                          {unpaidExpanded ? "Show less" : `Show ${apptGroups.unpaid.length - APPT_PREVIEW} more`}
                        </button>
                      )}
                    </div>
                  )}
                </>
              )
            )}
          </>
        )}

      </div>
        </div>
      </div>

      {/* 3 ─ STICKY CART BAR — mobile/tablet only (lg uses the side panel).
          Above the bottom nav on mobile; flush bottom on md. */}
      {cart.length > 0 && !cartOpen && (
        <div className="lg:hidden fixed left-0 right-0 bottom-[68px] z-40 p-3 bg-surface-sunken/95 backdrop-blur-xl border-t border-border">
          <div className="flex items-center gap-3">
            <button type="button" onClick={() => { if (!client.trim()) { setNeedCustomer(true); setPickerOpen(true); return; } setCheckoutStep("review"); setCartOpen(true); }} className="flex-1 min-w-0 flex items-center gap-2 text-left">
              <ShoppingCart size={18} className="text-[#00e5a0] shrink-0" />
              <span className="text-sm text-foreground truncate">
                <span className="font-semibold">{itemCount} item{itemCount !== 1 ? "s" : ""}</span>
                <span className="text-grey-muted"> · </span>
                <span className="font-bold">{formatCurrency(total)}</span>
              </span>
              <ChevronDown size={14} className="text-grey-muted shrink-0" />
            </button>
            {/* Checkout opens the summary drawer to review, pick tender + tip,
                then charge — no more one-tap charging straight from the grid. */}
            <button type="button" onClick={() => { if (!client.trim()) { setNeedCustomer(true); setPickerOpen(true); return; } setCheckoutStep("review"); setCartOpen(true); }}
              className="shrink-0 flex items-center gap-1.5 rounded-[10px] bg-[#00e5a0] text-black font-bold text-sm px-5 py-2.5 active:scale-95 transition-transform">
              Checkout<span aria-hidden>→</span>
            </button>
          </div>
        </div>
      )}

      {/* Expanded order-summary drawer — mobile/tablet only */}
      {cartOpen && (
        <>
          <div className="lg:hidden fixed inset-0 z-[55] bg-black/60 backdrop-blur-sm animate-fade-in" onClick={() => setCartOpen(false)} />
          <div ref={cartSheetRef}
            style={{ transform: cartDrag.dragY ? `translate3d(0,${cartDrag.dragY}px,0)` : undefined, transition: cartDrag.dragging ? "none" : "transform 0.28s cubic-bezier(.32,.72,0,1)" }}
            className="lg:hidden fixed left-0 right-0 bottom-0 z-[60] max-h-[85vh] flex flex-col bg-card rounded-t-[20px] border-t border-border animate-slide-up">
            <div onClick={() => setCartOpen(false)} className="shrink-0 flex justify-center pt-2 pb-1 cursor-grab active:cursor-grabbing">
              <div className="w-10 h-1.5 rounded-full bg-[#3a3a3a]" />
            </div>
            <div className="shrink-0 flex items-center justify-between px-4 py-3 border-b border-border">
              <h2 className="text-base font-bold text-foreground">Order Summary</h2>
              <button onClick={() => setCartOpen(false)} className="text-grey-muted hover:text-foreground"><X size={20} /></button>
            </div>
            {cartItemsList}
            {cartFooter}
          </div>
        </>
      )}

      {/* ── Customer picker portal ─────────────────────────────────────────
          Search the client book by name / email / phone, select to pull
          their saved contact, or add a new customer. */}
      {pickerOpen && (
        <div className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center sm:p-4 bg-black/70" onClick={() => setPickerOpen(false)}>
          <div ref={pickerSheetRef}
            style={{ transform: pickerDrag.dragY ? `translate3d(0,${pickerDrag.dragY}px,0)` : undefined, transition: pickerDrag.dragging ? "none" : "transform 0.28s cubic-bezier(.32,.72,0,1)" }}
            className="w-full sm:max-w-md max-h-[88vh] flex flex-col bg-card border border-border rounded-t-2xl sm:rounded-2xl shadow-2xl overflow-hidden animate-slide-up" onClick={e => e.stopPropagation()}>
            <div onClick={() => setPickerOpen(false)} className="sm:hidden shrink-0 flex justify-center pt-2 pb-1 cursor-grab active:cursor-grabbing">
              <div className="w-10 h-1.5 rounded-full bg-[#3a3a3a]" />
            </div>
            <div className="shrink-0 flex items-center justify-between px-4 py-3 border-b border-border">
              <h3 className="text-sm font-bold text-foreground">Select customer</h3>
              <button onClick={() => setPickerOpen(false)} className="text-grey hover:text-foreground"><X size={18} /></button>
            </div>

            {/* Search */}
            <div className="shrink-0 p-3 border-b border-border">
              <div className="flex items-center gap-2 rounded-xl border border-border bg-card-raised px-3">
                <Search size={15} className="text-grey flex-shrink-0" />
                <input value={clientSearch} onChange={e => setClientSearch(e.target.value)}
                  placeholder="Search name, email, or phone"
                  className="flex-1 bg-transparent py-2 text-sm text-foreground focus:outline-none placeholder:text-grey-muted" />
              </div>
            </div>

            {/* Results — flexes to fill, scrolls internally */}
            <div className="flex-1 min-h-0 overflow-y-auto">
              {filteredClients.length === 0 ? (
                <p className="text-center text-xs text-grey py-6">{clientSearch ? "No matching clients" : "No clients yet — add one below"}</p>
              ) : filteredClients.map((c, i) => (
                <button key={c.id ?? `past-${i}-${c.email ?? c.phone ?? c.name}`} onClick={() => selectClient(c)}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-card-raised border-b border-[#2a2a2a]/60 last:border-0">
                  <div className="w-8 h-8 rounded-full bg-card-raised border border-border flex items-center justify-center text-foreground text-xs font-bold flex-shrink-0">{c.name[0]?.toUpperCase()}</div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-foreground truncate">{c.name}</p>
                    <p className="text-[11px] text-grey truncate">{[c.email, c.phone].filter(Boolean).join(" · ") || "no contact"}</p>
                  </div>
                  {!c.saved && <span className="text-[9px] uppercase tracking-wide text-grey border border-border rounded-full px-1.5 py-0.5 flex-shrink-0">Past</span>}
                </button>
              ))}
            </div>

            {/* Add new — collapsed by default so the sheet stays clean (just
                search + results). Expands to a compact form, with the name
                prefilled from the search term. */}
            {!addOpen ? (
              <div className="shrink-0 p-3 border-t border-border bg-surface-sunken">
                <button type="button" onClick={openAddForm}
                  className="w-full flex items-center justify-center gap-2 h-11 rounded-xl border border-dashed border-border text-sm font-semibold text-foreground hover:border-white/30 hover:bg-white/[0.03] transition-colors">
                  <UserPlus size={15} /> {clientSearch.trim() ? `Add “${clientSearch.trim()}”` : "Add new customer"}
                </button>
              </div>
            ) : (
              <div className="shrink-0 p-3 border-t border-border bg-surface-sunken space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-[11px] uppercase tracking-wide text-grey font-semibold flex items-center gap-1"><UserPlus size={12} /> Add new customer</p>
                  <button type="button" onClick={() => { setAddOpen(false); setDupClient(null); }} className="text-[11px] text-grey hover:text-foreground">Cancel</button>
                </div>
                <Input placeholder="Name *" value={addName} onChange={e => { setAddName(e.target.value); setDupClient(null); }} />
                <Input type="tel" placeholder="Phone" value={addPhone} onChange={e => { setAddPhone(e.target.value); setDupClient(null); }} />
                <Input type="email" placeholder="Email" value={addEmail} onChange={e => { setAddEmail(e.target.value); setDupClient(null); }} />
                <p className="text-[10px] text-grey-muted">Add phone/email to save them to your client book — or leave blank for a quick walk-in.</p>

                {/* Already-on-file surface — catches the same email/phone under a
                    different name and offers the existing client for reuse. */}
                {dupClient && (
                  <div className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-2.5">
                    <AlertCircle size={14} className="text-amber-400 flex-shrink-0 mt-0.5" />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs text-amber-200">
                        This {dupClient.email && addEmail.trim().toLowerCase() === dupClient.email.toLowerCase() ? "email" : "phone"} is already on file for <span className="font-semibold">{dupClient.name}</span>.
                      </p>
                      <p className="text-[10px] text-grey truncate">{[dupClient.email, dupClient.phone].filter(Boolean).join(" · ")}</p>
                      <button onClick={() => selectClient(dupClient)} className="mt-1.5 text-xs font-semibold text-amber-300 hover:underline">Use {dupClient.name} instead →</button>
                    </div>
                  </div>
                )}

                <Button className="w-full" size="sm" loading={addingClient} onClick={addManualClient}>
                  <UserPlus size={14} /> Add &amp; select
                </Button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
