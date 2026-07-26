"use client";
import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useRouter } from "next/navigation";
import { User, Search, X, UserPlus, AlertCircle, Check, ShoppingCart, ChevronDown } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { effectivePlan, planHasFeature } from "@/lib/validation";
import { FeatureLock } from "@/components/dashboard/feature-lock";
import { DashboardHeader } from "@/components/dashboard/page-header";
import { supabase } from "@/lib/supabase";
import { cn, formatCurrency } from "@/lib/utils";
import { useSheetDrag } from "@/hooks/use-sheet-drag";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { Barber, Service, InventoryItem, PromoCode } from "@/lib/database.types";

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

export default function POSPage() {
  const { shop, accessToken } = useAuth();
  const [barbers, setBarbers] = useState<Barber[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [promoCodes, setPromoCodes] = useState<PromoCode[]>([]);
  const [dataLoaded, setDataLoaded] = useState(false);
  // POS grid tabs — split services from physical products so a big inventory
  // doesn't bury the service menu. Products are further grouped by category.
  const [posTab, setPosTab] = useState<"services" | "products">("services");
  const [productSearch, setProductSearch] = useState("");

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
  const [paymentMethod, setPaymentMethod] = useState<PM>("card");
  const [charging, setCharging] = useState(false);
  const [cartOpen, setCartOpen] = useState(false); // bottom order-summary drawer (UI only)
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
    if (barbersRes.data) { setBarbers(barbersRes.data); if (barbersRes.data.length > 0) setBarberId(barbersRes.data[0].id); }
    if (svcsRes.data) setServices(svcsRes.data);
    if (invRes.data) setInventory(invRes.data);
    if (promoRes.data) setPromoCodes(promoRes.data);
    if (clientsRes.data) setClientsList((clientsRes.data as ClientLite[]).map(c => ({ ...c, saved: true })));
    setDataLoaded(true);
  }, [shop]);

  useEffect(() => { loadData(); }, [loadData]);

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

  // ── Customer picker helpers ─────────────────────────────────────────────
  const filteredClients = useMemo(() => {
    const q = clientSearch.trim().toLowerCase();
    const digits = q.replace(/\D/g, "");
    if (!q) return clientsList.slice(0, 8);
    return clientsList.filter(c =>
      c.name.toLowerCase().includes(q) ||
      (c.email?.toLowerCase().includes(q) ?? false) ||
      (digits.length > 0 && (c.phone?.replace(/\D/g, "").includes(digits) ?? false))
    ).slice(0, 20);
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
  const posTaxCfg = (shop?.booking_settings ?? null) as { tax_enabled?: boolean; tax_rate?: number; tax_label?: string } | null;
  const posTaxEnabled = posTaxCfg?.tax_enabled === true;
  const posTaxRate = posTaxEnabled ? Number(posTaxCfg?.tax_rate ?? 0) : 0;
  const taxLabel = (posTaxCfg?.tax_label || "Tax").trim();
  const taxableAmt = Math.max(0, subtotal - discount);
  const taxAmt = posTaxEnabled ? Math.round(taxableAmt * posTaxRate) / 100 : 0;
  const total = Math.max(0, taxableAmt + taxAmt + tipAmt);
  // A gift card is TENDER, not new revenue (its value was booked when it sold),
  // so it reduces both the amount collected now AND the recorded sale revenue.
  const giftApplied = giftCard ? Math.min(giftCard.remaining_value, total) : 0;
  const dueAfterGift = Math.max(0, total - giftApplied);

  const applyPromo = () => {
    const found = promoCodes.find(p => p.code === promoCode.toUpperCase() && p.is_active);
    if (found) { setPromoApplied(found); showToast(`Promo ${found.code} applied!`); }
    else showToast("Invalid or expired promo code");
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
    if (dueAfterGift <= 0 && !giftCard) { showToast("Cannot charge $0 — please add items"); return; }
    // A customer must be chosen (existing client or a name entered) before charging.
    if (!client.trim()) { showToast("Select or add a customer first"); setPickerOpen(true); return; }
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
    const commission = selectedBarber ? Math.round(subtotal * (selectedBarber.commission_percent / 100) * 100) / 100 : null;
    const txType = serviceItems.length > 0 ? "service" : "product";

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
            commission_amount: commission,
            type: txType,
            products,
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
          service_name: giftApplied > 0 ? `${serviceName} (gift card ${formatCurrency(giftApplied)})` : serviceName,
          amount: Math.max(0, subtotal - giftApplied),
          tip: tipAmt,
          tax: taxAmt,
          commission_amount: commission,
          payment_method: paymentMethod,
          type: txType,
          products,
          gift_card: giftCard ? { id: giftCard.id, remaining_value: giftCard.remaining_value, applied: giftApplied } : null,
        }),
      });
      const data = await res.json();
      if (!res.ok) { showToast(data.error || "Error saving transaction"); setCharging(false); return; }
      if (data.transactionId) setLastReceiptId(data.transactionId);
    } catch {
      showToast("Error saving transaction"); setCharging(false); return;
    }

    setLastCharge({ total: dueAfterGift, subtotal, method: paymentMethod, items: [...cart], tip: tipAmt, discount: discount + giftApplied, tax: taxAmt });
    setCharging(false);
    setSuccess(true);

    // Refresh services/inventory/clients after the sale.
    loadData();
  };

  const reset = () => {
    setCart([]); setTipPercent(null); setCustomTip(""); setPromoCode(""); setPromoApplied(null);
    setGiftCode(""); setGiftCard(null);
    setPaymentMethod("card"); setSuccess(false); setLastCharge(null); setLastReceiptId(null); setClient("");
    setCustPhone(""); setCustEmail("");
    setSelectedClientId(null); setPickerOpen(false); setClientSearch(""); setDupClient(null);
    setAddName(""); setAddPhone(""); setAddEmail(""); setCartOpen(false);
    finalizedRef.current = false; // allow the next card sale to finalize
    if (barbers.length > 0) setBarberId(barbers[0].id);
  };

  if (!shop) {
    return (
      <div className="min-h-screen bg-card flex items-center justify-center p-6">
        <div className="text-center">
          <p className="text-3xl mb-3">💳</p>
          <h2 className="text-lg font-bold text-foreground mb-1">No shop linked</h2>
          <p className="text-sm text-grey">POS will be available once your shop is set up.</p>
        </div>
      </div>
    );
  }

  // Plan gate — POS is a Premium feature. Backs up the hidden sidebar link so a
  // direct URL visit doesn't grant access on a plan that doesn't include it.
  if (!planHasFeature(effectivePlan(shop.subscription_plan, shop.subscription_status), "pos")) {
    return <FeatureLock title="Point of Sale" description="The in-person POS / card terminal is available on the Premium plan." />;
  }

  if (success && lastCharge) {
    return (
      <div className="min-h-screen bg-card flex items-center justify-center p-6">
        <div className="w-full max-w-md space-y-6 text-center">
          <div className="w-24 h-24 rounded-full bg-emerald-500/20 border-2 border-emerald-500 flex items-center justify-center mx-auto">
            <span className="text-4xl">✓</span>
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
                <Button variant="outline" className="w-full" size="lg">🧾 View Receipt</Button>
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
        <div className="text-center py-8"><p className="text-2xl mb-1">🛒</p><p className="text-xs text-grey-muted">No items added</p></div>
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

  const cartFooter = (
    <div className="shrink-0 px-4 pt-3 pb-4 border-t border-border space-y-3">
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
          <span className="text-xs text-foreground">🎁 {giftCard.code} · {formatCurrency(giftCard.remaining_value)} avail</span>
          <button onClick={() => { setGiftCard(null); setGiftCode(""); }} className="text-grey hover:text-foreground"><X size={14} /></button>
        </div>
      ) : (
        <div className="flex gap-2">
          <Input placeholder="Gift card code" value={giftCode} onChange={e => setGiftCode(e.target.value.toUpperCase())} className="flex-1 text-xs" />
          <Button variant="outline" size="sm" onClick={applyGift}>Apply</Button>
        </div>
      )}
      <div className="flex items-center gap-1.5">
        <span className="text-xs text-grey-muted mr-1 shrink-0">Tip</span>
        {[10,15,20].map(t => (
          <button key={t} onClick={() => { setTipPercent(tipPercent === t ? null : t); setCustomTip(""); }}
            className={cn("flex-1 py-2 rounded-lg text-xs font-medium border transition-colors", tipPercent === t ? "bg-[#00e5a0] text-black border-[#00e5a0]" : "bg-surface-overlay text-grey border-border")}>
            {t}%
          </button>
        ))}
        <input type="number" placeholder="$" value={customTip} onChange={e => { setCustomTip(e.target.value); setTipPercent(null); }}
          className="w-14 shrink-0 rounded-lg border border-border bg-surface-overlay px-1 py-2 text-xs text-foreground text-center focus:outline-none focus:border-[#00e5a0]/50" />
      </div>
      {tipAmt > 0 && <div className="flex justify-between text-xs"><span className="text-grey-muted">Tip amount</span><span className="text-foreground">{formatCurrency(tipAmt)}</span></div>}
      {discount > 0 && <div className="flex justify-between text-xs"><span className="text-grey-muted">Discount</span><span className="text-[#00e5a0]">-{formatCurrency(discount)}</span></div>}
      {taxAmt > 0 && <div className="flex justify-between text-xs"><span className="text-grey-muted">{taxLabel} ({posTaxRate}%)</span><span className="text-foreground">{formatCurrency(taxAmt)}</span></div>}
      {giftApplied > 0 && <div className="flex justify-between text-xs"><span className="text-grey-muted">Gift card</span><span className="text-[#00e5a0]">-{formatCurrency(giftApplied)}</span></div>}
      <div className="flex justify-between items-baseline border-t border-border pt-2">
        <span className="text-sm font-bold text-foreground">{giftApplied > 0 ? "DUE NOW" : "TOTAL"}</span>
        <span className="text-xl font-extrabold text-foreground">{formatCurrency(dueAfterGift)}</span>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {(["card","cash","online"] as PM[]).map(m => (
          <button key={m} onClick={() => setPaymentMethod(m)}
            className={cn("py-2.5 rounded-[10px] text-xs font-medium capitalize border transition-colors", paymentMethod === m ? "bg-surface-overlay text-foreground border-[#00e5a0]" : "bg-surface-overlay text-grey border-border")}>
            {m === "card" ? "💳 Card" : m === "cash" ? "💵 Cash" : "🌐 Online"}
          </button>
        ))}
      </div>
      <button type="button" onClick={charge} disabled={charging || cart.length === 0}
        className="w-full rounded-[14px] bg-[#00e5a0] text-black font-extrabold text-base py-4 active:scale-[0.99] transition-transform disabled:opacity-60">
        {charging ? "Processing…" : `CHARGE ${formatCurrency(dueAfterGift)}`}
      </button>
    </div>
  );

  // Stack vertically on mobile (left panel scrolls, cart docks below);
  // side-by-side on tablet+. h-screen on desktop only — on mobile the
  // page can scroll naturally so the bottom nav stays clear.
  return (
    // data-no-swipe: POS is a money workflow — never let an accidental page
    // swipe navigate away mid-sale and drop the in-progress cart.
    <div data-no-swipe className="bg-surface-sunken">
      {toast && <Toast message={toast} onClose={() => setToast("")} />}

      {/* App shell — mobile/tablet: top bar + grid stacked, with a sticky cart
          bar + drawer. PC (lg): order summary as a side panel on the RIGHT
          (flex-row-reverse keeps DOM order but renders the panel last). */}
      <div className="flex flex-col lg:flex-row-reverse h-[calc(100dvh-68px-env(safe-area-inset-top))] md:h-screen overflow-hidden">

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

        {/* 1 ─ TOP BAR (fixed): Customer | Barber side by side, no labels */}
        <div className="shrink-0 flex gap-2 p-3 border-b border-white/[0.07]">
          <button type="button" onClick={() => { setAddOpen(false); setPickerOpen(true); }}
            className={cn("flex-1 min-w-0 h-11 flex items-center gap-2 rounded-xl border bg-card-raised px-3 text-sm text-left transition-colors",
              client ? "border-border" : "border-[#00e5a0]/40")}>
            <User size={15} className="text-grey-muted shrink-0" />
            <span className="flex-1 min-w-0 leading-tight">
              <span className={cn("block truncate", client ? "text-foreground" : "text-grey-muted")}>{client || "Select customer"}</span>
              {client && (custEmail || custPhone) && <span className="block text-[10px] text-grey-muted truncate">{custEmail || custPhone}</span>}
            </span>
            <Search size={13} className="text-grey-muted shrink-0" />
          </button>
          <div className="relative flex-1 min-w-0">
            <select value={barberId} onChange={e => setBarberId(e.target.value)}
              className="w-full h-11 appearance-none rounded-xl border border-border bg-card-raised pl-3 pr-8 text-sm text-foreground focus:outline-none focus:border-[#00e5a0]/50">
              {barbers.length === 0 && <option value="">No barbers</option>}
              {barbers.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
            <ChevronDown size={15} className="text-grey-muted absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          </div>
        </div>

        {/* 2 ─ SERVICE GRID (scrollable). pb-28 keeps the last row clear of the sticky bar */}
        <div className="flex-1 min-h-0 overflow-y-auto px-3 pt-3 pb-28">

        {!dataLoaded ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
            {Array.from({ length: 8 }).map((_, i) => <div key={i} className="h-20 rounded-xl bg-card-raised animate-pulse" />)}
          </div>
        ) : (
          <>
            {/* Services / Products tabs — only when there's inventory to split out */}
            {inventory.length > 0 && (
              <div className="flex gap-1 p-1 rounded-xl bg-card-raised border border-border mb-3">
                {(["services", "products"] as const).map(t => (
                  <button key={t} type="button" onClick={() => setPosTab(t)}
                    className={cn("flex-1 h-9 rounded-lg text-sm font-semibold transition-colors",
                      posTab === t ? "bg-white text-black" : "text-grey hover:text-foreground")}>
                    {t === "products" ? `Products (${inventory.length})` : "Services"}
                  </button>
                ))}
              </div>
            )}

            {(inventory.length === 0 || posTab === "services") && Object.entries(servicesByCategory).map(([cat, svcs]) => (
              <div key={cat}>
                <p className="text-[10px] tracking-[0.15em] uppercase text-[#444] mt-4 mb-2 first:mt-0">{cat}</p>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                  {svcs.map(svc => {
                    const selected = cart.some(i => i.id === svc.id);
                    return (
                      <button key={svc.id} onClick={() => addItem(svc.id, svc.name, svc.price, "service")}
                        className={cn("relative h-20 p-3 rounded-xl border bg-card-raised flex flex-col justify-between text-left transition-all active:scale-95",
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
                            className={cn("relative h-20 p-3 rounded-xl border bg-card-raised flex flex-col justify-between text-left transition-all active:scale-95",
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
          </>
        )}

      </div>
        </div>
      </div>

      {/* 3 ─ STICKY CART BAR — mobile/tablet only (lg uses the side panel).
          Above the bottom nav on mobile; flush bottom on md. */}
      {cart.length > 0 && !cartOpen && (
        <div className="lg:hidden fixed left-0 md:left-64 right-0 bottom-[68px] md:bottom-0 z-40 p-3 bg-surface-sunken/95 backdrop-blur-xl border-t border-border">
          <div className="flex items-center gap-3">
            <button type="button" onClick={() => setCartOpen(true)} className="flex-1 min-w-0 flex items-center gap-2 text-left">
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
            <button type="button" onClick={() => setCartOpen(true)}
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
            className="lg:hidden fixed left-0 md:left-64 right-0 bottom-0 z-[60] max-h-[85vh] flex flex-col bg-card-raised rounded-t-[20px] border-t border-border animate-slide-up">
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
