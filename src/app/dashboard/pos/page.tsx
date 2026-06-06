"use client";
import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useRouter } from "next/navigation";
import { User, Scissors, Search, X, UserPlus, AlertCircle } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/lib/supabase";
import { cn, formatCurrency } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { Barber, Service, InventoryItem, Transaction, PromoCode } from "@/lib/database.types";

type CartItem = { id: string; name: string; price: number; qty: number; type: "service" | "product"; inventoryId?: string };
type PM = "card" | "cash" | "online";
// id is null for "past customers" surfaced from appointments (not yet saved as
// a client row); saved flags whether they're already in the clients book.
type ClientLite = { id: string | null; name: string; email: string | null; phone: string | null; saved?: boolean };

function Toast({ message, onClose }: { message: string; onClose: () => void }) {
  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[100] bg-[#141414] border border-[#1e1e1e] rounded-xl px-5 py-3 text-sm text-white shadow-xl flex items-center gap-3">
      <span className="text-white">✓</span>{message}
      <button onClick={onClose} className="text-[#777] hover:text-white ml-2">✕</button>
    </div>
  );
}

export default function POSPage() {
  const { shop } = useAuth();
  const [barbers, setBarbers] = useState<Barber[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [recentTx, setRecentTx] = useState<Transaction[]>([]);
  const [promoCodes, setPromoCodes] = useState<PromoCode[]>([]);
  const [dataLoaded, setDataLoaded] = useState(false);

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
  const [paymentMethod, setPaymentMethod] = useState<PM>("card");
  const [charging, setCharging] = useState(false);
  const [success, setSuccess] = useState(false);
  const [toast, setToast] = useState("");
  const [lastCharge, setLastCharge] = useState<{ total: number; subtotal: number; method: PM; items: CartItem[]; tip: number; discount: number; summaryLabel?: string } | null>(null);
  const [lastReceiptId, setLastReceiptId] = useState<string | null>(null);

  const router = useRouter();
  // Guards the card-return finalize so it runs at most once per mount even if
  // React re-renders or the user refreshes (transactions has no idempotency key).
  const finalizedRef = useRef(false);

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(""), 3000); };

  const loadData = useCallback(async () => {
    if (!shop) return;
    const [barbersRes, svcsRes, invRes, txRes, promoRes, clientsRes] = await Promise.all([
      supabase.from("barbers").select("*").eq("shop_id", shop.id).eq("is_active", true).order("name"),
      supabase.from("services").select("*").eq("shop_id", shop.id).eq("is_active", true).order("category").order("name"),
      supabase.from("inventory").select("*").eq("shop_id", shop.id).order("name"),
      supabase.from("transactions").select("*").eq("shop_id", shop.id).order("created_at", { ascending: false }).limit(10),
      supabase.from("promo_codes").select("*").eq("shop_id", shop.id).eq("is_active", true),
      // Single source of truth — the clients book. Bookings now auto-register
      // customers here (see /api/clients/upsert), so this is the one list POS
      // and the Clients page both read from.
      supabase.from("clients").select("id, name, email, phone").eq("shop_id", shop.id).order("name"),
    ]);
    if (barbersRes.data) { setBarbers(barbersRes.data); if (barbersRes.data.length > 0) setBarberId(barbersRes.data[0].id); }
    if (svcsRes.data) setServices(svcsRes.data);
    if (invRes.data) setInventory(invRes.data);
    if (txRes.data) setRecentTx(txRes.data);
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
    setClientSearch(""); setDupClient(null);
    setAddName(""); setAddPhone(""); setAddEmail("");
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
            items: [], tip: res.sale.tip, discount: res.sale.discount ?? 0,
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
  const total = Math.max(0, subtotal + tipAmt - discount);

  const applyPromo = () => {
    const found = promoCodes.find(p => p.code === promoCode.toUpperCase() && p.is_active);
    if (found) { setPromoApplied(found); showToast(`Promo ${found.code} applied!`); }
    else showToast("Invalid or expired promo code");
  };

  const charge = async () => {
    if (cart.length === 0) { showToast("Please select a service first"); return; }
    if (total <= 0) { showToast("Cannot charge $0 — please add items"); return; }
    // A customer must be chosen (existing client or a name entered) before charging.
    if (!client.trim()) { showToast("Select or add a customer first"); setPickerOpen(true); return; }
    const tipPct = tipPercent !== null ? tipPercent : customTip ? (Number(customTip) / subtotal) * 100 : 0;
    if (tipPct > 100) { showToast("Tip cannot exceed 100%"); return; }
    if (paymentMethod === "cash") {
      const cashEl = document.getElementById("cash-input") as HTMLInputElement | null;
      const cashVal = cashEl ? parseFloat(cashEl.value) : NaN;
      if (!isNaN(cashVal) && cashVal < total) { showToast(`Cash amount ($${cashVal.toFixed(2)}) is less than total ($${total.toFixed(2)})`); return; }
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
    if (paymentMethod === "card" || paymentMethod === "online") {
      const products = cart
        .filter(i => i.type === "product" && i.inventoryId)
        .map(i => ({ id: i.inventoryId!, qty: i.qty }));
      try {
        const res = await fetch("/api/stripe/pos-checkout", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            shop_id: shop!.id,
            origin: window.location.origin,
            barber_id: barberId || null,
            client_name: client,
            client_email: custEmail.trim(),
            client_phone: custPhone.trim(),
            service_name: serviceName,
            subtotal, tip: tipAmt, discount, total,
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

    // ── Cash → record the sale immediately ───────────────────────────────────
    const { data: txData, error: txError } = await supabase.from("transactions").insert({
      shop_id: shop!.id,
      barber_id: barberId || null,
      client_name: client,
      service_name: serviceName,
      amount: subtotal,
      tip: tipAmt,
      commission_amount: commission,
      payment_method: paymentMethod,
      type: txType,
    }).select("id").single();

    if (txError) { showToast("Error saving transaction"); setCharging(false); return; }
    if (txData?.id) setLastReceiptId(txData.id);

    // Decrement inventory for product items, alert on low stock
    for (const item of cart.filter(i => i.type === "product" && i.inventoryId)) {
      const inv = inventory.find(i => i.id === item.inventoryId);
      if (inv) {
        const newQty = Math.max(0, inv.quantity - item.qty);
        await supabase.from("inventory").update({ quantity: newQty }).eq("id", inv.id);
        // Create low-stock notification if below threshold
        if (newQty <= inv.low_stock_threshold && inv.quantity > inv.low_stock_threshold) {
          supabase.from("notifications").insert({
            user_id: shop!.owner_id,
            title: "Low Stock Alert",
            message: `${inv.name} is running low — only ${newQty} units remaining.`,
            type: "inventory",
            is_read: false,
          }).then(null, () => null);
        }
      }
    }

    setLastCharge({ total, subtotal, method: paymentMethod, items: [...cart], tip: tipAmt, discount });
    setCharging(false);
    setSuccess(true);

    // Reload recent transactions
    loadData();
  };

  const reset = () => {
    setCart([]); setTipPercent(null); setCustomTip(""); setPromoCode(""); setPromoApplied(null);
    setPaymentMethod("card"); setSuccess(false); setLastCharge(null); setLastReceiptId(null); setClient("");
    setCustPhone(""); setCustEmail("");
    setSelectedClientId(null); setPickerOpen(false); setClientSearch(""); setDupClient(null);
    setAddName(""); setAddPhone(""); setAddEmail("");
    finalizedRef.current = false; // allow the next card sale to finalize
    if (barbers.length > 0) setBarberId(barbers[0].id);
  };

  if (!shop) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center p-6">
        <div className="text-center">
          <p className="text-3xl mb-3">💳</p>
          <h2 className="text-lg font-bold text-white mb-1">No shop linked</h2>
          <p className="text-sm text-[#777]">POS will be available once your shop is set up.</p>
        </div>
      </div>
    );
  }

  if (success && lastCharge) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center p-6">
        <div className="w-full max-w-md space-y-6 text-center">
          <div className="w-24 h-24 rounded-full bg-emerald-500/20 border-2 border-emerald-500 flex items-center justify-center mx-auto">
            <span className="text-4xl">✓</span>
          </div>
          <div>
            <h2 className="text-2xl font-bold text-white">Payment Received!</h2>
            <p className="text-3xl font-bold text-white mt-2">{formatCurrency(lastCharge.total)}</p>
          </div>
          <Card className="text-left space-y-3">
            <div className="space-y-2">
              {lastCharge.items.length > 0 ? (
                lastCharge.items.map(item => (
                  <div key={item.id} className="flex justify-between text-sm">
                    <span className="text-[#777]">{item.name} × {item.qty}</span>
                    <span className="text-white">{formatCurrency(item.price * item.qty)}</span>
                  </div>
                ))
              ) : (
                // Card sales come back from Stripe with the cart cleared — show
                // the service label captured at checkout instead.
                <div className="flex justify-between text-sm">
                  <span className="text-[#777]">{lastCharge.summaryLabel ?? "Sale"}</span>
                  <span className="text-white">{formatCurrency(lastCharge.subtotal)}</span>
                </div>
              )}
            </div>
            <div className="border-t border-[#1e1e1e] pt-3 space-y-1">
              <div className="flex justify-between text-sm"><span className="text-[#777]">Subtotal</span><span className="text-white">{formatCurrency(lastCharge.subtotal)}</span></div>
              <div className="flex justify-between text-sm"><span className="text-[#777]">Tip</span><span className="text-white">{formatCurrency(lastCharge.tip)}</span></div>
              {lastCharge.discount > 0 && <div className="flex justify-between text-sm"><span className="text-[#777]">Discount</span><span className="text-emerald-400">-{formatCurrency(lastCharge.discount)}</span></div>}
              <div className="flex justify-between font-bold border-t border-[#1e1e1e] pt-2 mt-2"><span className="text-white">Total</span><span className="text-white text-lg">{formatCurrency(lastCharge.total)}</span></div>
            </div>
            <div className="flex justify-between text-sm pt-2 border-t border-[#1e1e1e]">
              <span className="text-[#777]">Payment</span>
              <span className="text-white capitalize">{lastCharge.method}</span>
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

  // Stack vertically on mobile (left panel scrolls, cart docks below);
  // side-by-side on tablet+. h-screen on desktop only — on mobile the
  // page can scroll naturally so the bottom nav stays clear.
  return (
    <div className="bg-black">
      {toast && <Toast message={toast} onClose={() => setToast("")} />}
      {/* Fixed two-zone app layout: on phones it fills the space between the
          top bar (3.5rem) and bottom nav (68px); on tablet/desktop it's a full
          -height two-pane. Cards scroll in the top zone, cart docks below. */}
      <div className="flex flex-col lg:flex-row overflow-hidden h-[calc(100dvh-3.5rem-68px)] md:h-screen">

      {/* Left Panel — services (scrolls in the top zone) */}
      <div className="flex-1 min-h-0 overflow-y-auto p-3 sm:p-4 space-y-3 sm:space-y-4 lg:border-r border-[#1e1e1e]">
        <div>
          <h1 className="hidden lg:block text-xl font-bold text-white mb-3">Point of Sale</h1>
          <div className="grid grid-cols-2 gap-2">
            {/* Customer selector — opens the search / add picker. Prompts the
                cashier to pick a customer; amber outline until one is chosen. */}
            <div>
              <label className="block text-[11px] uppercase tracking-wide text-[#777] font-semibold mb-1">Customer</label>
              <button type="button" onClick={() => setPickerOpen(true)}
                className={cn(
                  "w-full flex items-center gap-2 rounded-xl border bg-[#141414] px-3 py-2.5 text-sm text-left transition-colors",
                  client ? "border-[#1e1e1e] hover:border-white" : "border-amber-500/40 hover:border-amber-400",
                )}>
                <User size={15} className="text-[#777] flex-shrink-0" />
                <span className="flex-1 min-w-0">
                  <span className={cn("block truncate", client ? "text-white" : "text-[#888]")}>
                    {client || "Select customer…"}
                  </span>
                  {/* Show the selected customer's email (or phone) underneath. */}
                  {client && (custEmail || custPhone) && (
                    <span className="block text-[11px] text-[#777] truncate leading-tight">{custEmail || custPhone}</span>
                  )}
                </span>
                <Search size={13} className="text-[#777] flex-shrink-0" />
              </button>
            </div>
            <div>
              <label className="block text-[11px] uppercase tracking-wide text-[#777] font-semibold mb-1">Barber</label>
              <select value={barberId} onChange={e => setBarberId(e.target.value)}
                className="w-full rounded-xl border border-[#1e1e1e] bg-[#141414] px-3 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-black/20">
                {barbers.length === 0 && <option value="">No barbers</option>}
                {barbers.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
          </div>
          {/* Chosen-customer confirmation row */}
          {client && (
            <div className="flex items-center gap-2 mt-2 text-xs">
              {selectedClientId
                ? <span className="inline-flex items-center gap-1 bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 rounded-full px-2 py-0.5">Saved client</span>
                : <span className="inline-flex items-center gap-1 bg-[#141414] border border-[#1e1e1e] text-[#999] rounded-full px-2 py-0.5">Walk-in</span>}
              <span className="text-[#777] truncate">{[custEmail, custPhone].filter(Boolean).join(" · ") || "no contact on file"}</span>
              <button onClick={clearClient} className="ml-auto text-[#777] hover:text-white underline">Change</button>
            </div>
          )}
        </div>

        {/* Services by category — small tiles: 3-up on phones, 4-up on
            tablet/iPad, 5-up on wide desktop. Consistent compact sizing. */}
        {!dataLoaded ? (
          <div className="grid grid-cols-3 sm:grid-cols-4 xl:grid-cols-5 gap-2">
            {Array.from({ length: 8 }).map((_, i) => <div key={i} className="h-[68px] rounded-xl bg-[#171717] animate-pulse" />)}
          </div>
        ) : (
          Object.entries(servicesByCategory).map(([cat, svcs]) => (
            <div key={cat}>
              <p className="text-[10px] text-[#888] mb-1.5 font-semibold uppercase tracking-wider">{cat}</p>
              <div className="grid grid-cols-3 sm:grid-cols-4 xl:grid-cols-5 gap-2">
                {svcs.map(svc => (
                  <button key={svc.id} onClick={() => addItem(svc.id, svc.name, svc.price, "service")}
                    className="group p-2.5 rounded-xl border border-[#2a2a2a] bg-[#171717] hover:border-gold hover:bg-[#1f1f1f] transition-all active:scale-95 text-left">
                    <p className="text-[12px] font-semibold text-white leading-tight line-clamp-2">{svc.name}</p>
                    <p className="text-[10px] text-[#888] mt-0.5">{svc.duration_minutes} min</p>
                    <p className="text-sm font-bold text-gold mt-1">{formatCurrency(svc.price)}</p>
                  </button>
                ))}
              </div>
            </div>
          ))
        )}

        {/* Products */}
        {inventory.length > 0 && (
          <div>
            <p className="text-[10px] text-[#888] mb-1.5 font-semibold uppercase tracking-wider">Products</p>
            <div className="grid grid-cols-3 sm:grid-cols-4 xl:grid-cols-5 gap-2">
              {inventory.map(inv => (
                <button key={inv.id} onClick={() => addItem(`inv-${inv.id}`, inv.name, inv.price, "product", inv.id)}
                  className={cn("p-2.5 rounded-xl border border-[#2a2a2a] bg-[#171717] hover:border-gold hover:bg-[#1f1f1f] transition-all active:scale-95 text-left",
                    inv.quantity === 0 && "opacity-40 pointer-events-none")}>
                  <p className="text-[11px] font-medium text-white leading-tight line-clamp-2">{inv.name}</p>
                  <p className="text-sm font-bold text-gold mt-0.5">{formatCurrency(inv.price)}</p>
                  {inv.quantity <= inv.low_stock_threshold && inv.quantity > 0 && (
                    <p className="text-[10px] text-red-400 mt-0.5">{inv.quantity} left</p>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}

      </div>

      {/* Right Panel - Order Summary. Full width when stacked (mobile + iPad
          portrait, where the 256px sidebar leaves too little room for a
          side-by-side split), fixed 320px column from lg up. */}
      <div className="w-full lg:w-80 shrink-0 max-h-[52vh] lg:max-h-none flex flex-col overflow-hidden bg-[#0c0c0c] lg:bg-black border-t lg:border-t-0 lg:border-l border-[#1e1e1e]">
        <div className="shrink-0 p-3 sm:p-4 border-b border-[#1e1e1e]">
          <h2 className="text-base font-bold text-white">Order Summary</h2>
          <p className="text-xs text-[#777] truncate">{client || "No customer"} · {barbers.find(b => b.id === barberId)?.name ?? "—"}</p>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-3 sm:p-4 space-y-2">
          {cart.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-4xl mb-2">🛒</p>
              <p className="text-sm text-[#777]">No items added</p>
            </div>
          ) : cart.map(item => (
            <div key={item.id} className="flex items-center gap-2 p-3 bg-[#141414] rounded-xl border border-[#1e1e1e]">
              <div className="flex-1 min-w-0">
                <p className="text-sm text-white truncate">{item.name}</p>
                <p className="text-xs text-white">{formatCurrency(item.price)}</p>
              </div>
              <div className="flex items-center gap-1">
                <button onClick={() => changeQty(item.id, -1)} className="w-6 h-6 rounded-lg bg-black shadow-sm text-white text-xs flex items-center justify-center hover:bg-border">−</button>
                <span className="text-sm text-white w-4 text-center">{item.qty}</span>
                <button onClick={() => changeQty(item.id, 1)} className="w-6 h-6 rounded-lg bg-black shadow-sm text-white text-xs flex items-center justify-center hover:bg-border">+</button>
              </div>
              <button onClick={() => removeItem(item.id)} className="text-red-400 hover:text-red-300 text-sm">✕</button>
            </div>
          ))}
        </div>

        <div className="shrink-0 p-3 sm:p-4 border-t border-[#1e1e1e] space-y-3">
          {/* Tip */}
          <div>
            <p className="text-xs text-[#777] mb-2">Tip</p>
            <div className="flex gap-1 flex-wrap">
              {[10,15,20].map(t => (
                <button key={t} onClick={() => { setTipPercent(tipPercent === t ? null : t); setCustomTip(""); }}
                  className={cn("flex-1 py-1.5 rounded-lg text-xs font-medium transition-colors", tipPercent === t ? "bg-gold text-black" : "bg-[#141414] text-[#777] hover:text-white border border-[#1e1e1e]")}>
                  {t}%
                </button>
              ))}
              <input type="number" placeholder="$" value={customTip} onChange={e => { setCustomTip(e.target.value); setTipPercent(null); }}
                className="flex-1 min-w-12 rounded-lg border border-[#1e1e1e] bg-[#141414] px-2 py-1.5 text-xs text-white focus:outline-none focus:ring-1 focus:ring-black/20 text-center" />
            </div>
          </div>

          {/* Promo */}
          {promoCodes.length > 0 && (
            <div className="flex gap-2">
              <Input placeholder="Promo code" value={promoCode} onChange={e => setPromoCode(e.target.value)} className="flex-1 text-xs" />
              <Button variant="outline" size="sm" onClick={applyPromo}>Apply</Button>
            </div>
          )}

          {/* Totals */}
          <div className="space-y-1 text-sm">
            <div className="flex justify-between text-[#777]"><span>Subtotal</span><span className="text-white">{formatCurrency(subtotal)}</span></div>
            <div className="flex justify-between text-[#777]"><span>Tip</span><span className="text-white">{formatCurrency(tipAmt)}</span></div>
            {discount > 0 && <div className="flex justify-between text-[#777]"><span>Discount</span><span className="text-emerald-400">-{formatCurrency(discount)}</span></div>}
            <div className="flex justify-between font-bold border-t border-[#1e1e1e] pt-2 mt-2"><span className="text-white">Total</span><span className="text-white text-lg">{formatCurrency(total)}</span></div>
          </div>

          {/* Payment Method */}
          <div className="grid grid-cols-3 gap-2">
            {(["card","cash","online"] as PM[]).map(m => (
              <button key={m} onClick={() => setPaymentMethod(m)}
                className={cn("py-2 rounded-xl text-xs font-medium capitalize transition-colors border", paymentMethod === m ? "bg-gold text-black border-black" : "bg-[#141414] text-[#777] border-[#1e1e1e] hover:border-black")}>
                {m === "card" ? "💳 Card" : m === "cash" ? "💵 Cash" : "🌐 Online"}
              </button>
            ))}
          </div>

          <Button className="w-full" size="lg" loading={charging} onClick={charge} disabled={cart.length === 0}>
            {charging ? "Processing..." : `Charge ${formatCurrency(total)}`}
          </Button>
        </div>
      </div>
      </div>

      {/* Recent Transactions — moved below the checkout so the order summary
          stays the focus. Full-width under the two-pane area: stacked on
          mobile, a 3-up grid on desktop. */}
      {recentTx.length > 0 && (
        <div className="p-4 border-t border-[#1e1e1e]">
          <p className="text-xs text-[#777] mb-2 font-medium uppercase tracking-wide">Recent Transactions</p>
          <div className="space-y-2 lg:grid lg:grid-cols-3 lg:gap-2 lg:space-y-0">
            {recentTx.map(tx => {
              const barberName = barbers.find(b => b.id === tx.barber_id)?.name;
              return (
                <div key={tx.id} className="flex items-start justify-between gap-2 p-3 bg-[#141414] rounded-xl border border-[#1e1e1e]">
                  <div className="min-w-0">
                    <p className="text-sm text-white truncate">{tx.service_name}</p>
                    {/* Small badges: customer + barber, only when available */}
                    {(tx.client_name || barberName) && (
                      <div className="flex flex-wrap items-center gap-1 mt-1.5">
                        {tx.client_name && (
                          <span className="inline-flex items-center gap-1 max-w-[140px] text-[10px] text-[#aaa] bg-black/40 border border-[#1e1e1e] rounded-full px-2 py-0.5">
                            <User size={9} className="flex-shrink-0 text-[#777]" />
                            <span className="truncate">{tx.client_name}</span>
                          </span>
                        )}
                        {barberName && (
                          <span className="inline-flex items-center gap-1 max-w-[140px] text-[10px] text-[#aaa] bg-black/40 border border-[#1e1e1e] rounded-full px-2 py-0.5">
                            <Scissors size={9} className="flex-shrink-0 text-[#777]" />
                            <span className="truncate">{barberName}</span>
                          </span>
                        )}
                      </div>
                    )}
                    <p className="text-[10px] text-[#777] mt-1.5">{new Date(tx.created_at).toLocaleTimeString("en-CA", { hour: "2-digit", minute: "2-digit" })}</p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-sm font-bold text-white">{formatCurrency(tx.amount + tx.tip)}</p>
                    <p className="text-xs text-[#777] capitalize">{tx.payment_method}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Customer picker portal ─────────────────────────────────────────
          Search the client book by name / email / phone, select to pull
          their saved contact, or add a new customer. */}
      {pickerOpen && (
        <div className="fixed inset-0 z-[80] flex items-start sm:items-center justify-center p-4 bg-black/70" onClick={() => setPickerOpen(false)}>
          <div className="w-full max-w-md mt-16 sm:mt-0 bg-[#0c0c0c] border border-[#1e1e1e] rounded-2xl shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-[#1e1e1e]">
              <h3 className="text-sm font-bold text-white">Select customer</h3>
              <button onClick={() => setPickerOpen(false)} className="text-[#777] hover:text-white"><X size={18} /></button>
            </div>

            {/* Search */}
            <div className="p-3 border-b border-[#1e1e1e]">
              <div className="flex items-center gap-2 rounded-xl border border-[#1e1e1e] bg-[#141414] px-3">
                <Search size={15} className="text-[#777] flex-shrink-0" />
                <input autoFocus value={clientSearch} onChange={e => setClientSearch(e.target.value)}
                  placeholder="Search name, email, or phone"
                  className="flex-1 bg-transparent py-2 text-sm text-white focus:outline-none placeholder:text-[#555]" />
              </div>
            </div>

            {/* Results */}
            <div className="max-h-56 overflow-y-auto">
              {filteredClients.length === 0 ? (
                <p className="text-center text-xs text-[#777] py-6">{clientSearch ? "No matching clients" : "No clients yet — add one below"}</p>
              ) : filteredClients.map((c, i) => (
                <button key={c.id ?? `past-${i}-${c.email ?? c.phone ?? c.name}`} onClick={() => selectClient(c)}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-[#141414] border-b border-[#1e1e1e]/60 last:border-0">
                  <div className="w-8 h-8 rounded-full bg-[#141414] border border-[#1e1e1e] flex items-center justify-center text-white text-xs font-bold flex-shrink-0">{c.name[0]?.toUpperCase()}</div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-white truncate">{c.name}</p>
                    <p className="text-[11px] text-[#777] truncate">{[c.email, c.phone].filter(Boolean).join(" · ") || "no contact"}</p>
                  </div>
                  {!c.saved && <span className="text-[9px] uppercase tracking-wide text-[#777] border border-[#1e1e1e] rounded-full px-1.5 py-0.5 flex-shrink-0">Past</span>}
                </button>
              ))}
            </div>

            {/* Add new — columns for manual entry */}
            <div className="p-3 border-t border-[#1e1e1e] bg-[#0a0a0a]">
              <p className="text-[11px] uppercase tracking-wide text-[#777] font-semibold mb-2 flex items-center gap-1"><UserPlus size={12} /> Add new customer</p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <Input placeholder="Name *" value={addName} onChange={e => { setAddName(e.target.value); setDupClient(null); }} />
                <Input type="tel" placeholder="Phone" value={addPhone} onChange={e => { setAddPhone(e.target.value); setDupClient(null); }} />
                <Input type="email" placeholder="Email" value={addEmail} onChange={e => { setAddEmail(e.target.value); setDupClient(null); }} />
              </div>
              <p className="text-[10px] text-[#666] mt-1">Add phone/email to save them to your client book — or leave blank for a quick walk-in.</p>

              {/* Already-on-file surface — catches the same email/phone under a
                  different name and offers the existing client for reuse. */}
              {dupClient && (
                <div className="mt-2 flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-2.5">
                  <AlertCircle size={14} className="text-amber-400 flex-shrink-0 mt-0.5" />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-amber-200">
                      This {dupClient.email && addEmail.trim().toLowerCase() === dupClient.email.toLowerCase() ? "email" : "phone"} is already on file for <span className="font-semibold">{dupClient.name}</span>.
                    </p>
                    <p className="text-[10px] text-[#999] truncate">{[dupClient.email, dupClient.phone].filter(Boolean).join(" · ")}</p>
                    <button onClick={() => selectClient(dupClient)} className="mt-1.5 text-xs font-semibold text-amber-300 hover:underline">Use {dupClient.name} instead →</button>
                  </div>
                </div>
              )}

              <Button className="w-full mt-2" size="sm" loading={addingClient} onClick={addManualClient}>
                <UserPlus size={14} /> Add &amp; select
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
