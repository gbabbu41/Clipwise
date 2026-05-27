"use client";
import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/lib/supabase";
import { cn, formatCurrency } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { Barber, Service, InventoryItem, Transaction, PromoCode } from "@/lib/database.types";

type CartItem = { id: string; name: string; price: number; qty: number; type: "service" | "product"; inventoryId?: string };
type PM = "card" | "cash" | "online";

function Toast({ message, onClose }: { message: string; onClose: () => void }) {
  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[100] bg-surface-raised border border-border rounded-xl px-5 py-3 text-sm text-white shadow-xl flex items-center gap-3">
      <span className="text-gold">✓</span>{message}
      <button onClick={onClose} className="text-gray-400 hover:text-white ml-2">✕</button>
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
  const [client, setClient] = useState("Walk-in");
  const [barberId, setBarberId] = useState("");
  const [tipPercent, setTipPercent] = useState<number | null>(null);
  const [customTip, setCustomTip] = useState("");
  const [promoCode, setPromoCode] = useState("");
  const [promoApplied, setPromoApplied] = useState<PromoCode | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<PM>("card");
  const [charging, setCharging] = useState(false);
  const [success, setSuccess] = useState(false);
  const [toast, setToast] = useState("");
  const [lastCharge, setLastCharge] = useState<{ total: number; method: PM; items: CartItem[]; tip: number; discount: number } | null>(null);

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(""), 3000); };

  const loadData = useCallback(async () => {
    if (!shop) return;
    const [barbersRes, svcsRes, invRes, txRes, promoRes] = await Promise.all([
      supabase.from("barbers").select("*").eq("shop_id", shop.id).eq("is_active", true).order("name"),
      supabase.from("services").select("*").eq("shop_id", shop.id).eq("is_active", true).order("category").order("name"),
      supabase.from("inventory").select("*").eq("shop_id", shop.id).order("name"),
      supabase.from("transactions").select("*").eq("shop_id", shop.id).order("created_at", { ascending: false }).limit(10),
      supabase.from("promo_codes").select("*").eq("shop_id", shop.id).eq("is_active", true),
    ]);
    if (barbersRes.data) { setBarbers(barbersRes.data); if (barbersRes.data.length > 0) setBarberId(barbersRes.data[0].id); }
    if (svcsRes.data) setServices(svcsRes.data);
    if (invRes.data) setInventory(invRes.data);
    if (txRes.data) setRecentTx(txRes.data);
    if (promoRes.data) setPromoCodes(promoRes.data);
    setDataLoaded(true);
  }, [shop]);

  useEffect(() => { loadData(); }, [loadData]);

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
    if (cart.length === 0) { showToast("Add items first!"); return; }
    setCharging(true);

    const selectedBarber = barbers.find(b => b.id === barberId);
    const serviceItems = cart.filter(i => i.type === "service");
    const primaryService = serviceItems[0];

    const { error: txError } = await supabase.from("transactions").insert({
      shop_id: shop!.id,
      barber_id: barberId || null,
      client_name: client,
      service_name: primaryService?.name ?? cart[0]?.name ?? "Sale",
      amount: subtotal,
      tip: tipAmt,
      commission_amount: selectedBarber ? Math.round(subtotal * (selectedBarber.commission_percent / 100) * 100) / 100 : null,
      payment_method: paymentMethod,
      type: serviceItems.length > 0 ? "service" : "product",
    });

    if (txError) { showToast("Error saving transaction"); setCharging(false); return; }

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

    setLastCharge({ total, method: paymentMethod, items: [...cart], tip: tipAmt, discount });
    setCharging(false);
    setSuccess(true);

    // Reload recent transactions
    loadData();
  };

  const reset = () => {
    setCart([]); setTipPercent(null); setCustomTip(""); setPromoCode(""); setPromoApplied(null);
    setPaymentMethod("card"); setSuccess(false); setLastCharge(null); setClient("Walk-in");
    if (barbers.length > 0) setBarberId(barbers[0].id);
  };

  if (!shop) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <div className="text-center">
          <p className="text-3xl mb-3">💳</p>
          <h2 className="text-lg font-bold text-white mb-1">No shop linked</h2>
          <p className="text-sm text-gray-400">POS will be available once your shop is set up.</p>
        </div>
      </div>
    );
  }

  if (success && lastCharge) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <div className="w-full max-w-md space-y-6 text-center">
          <div className="w-24 h-24 rounded-full bg-emerald-500/20 border-2 border-emerald-500 flex items-center justify-center mx-auto">
            <span className="text-4xl">✓</span>
          </div>
          <div>
            <h2 className="text-2xl font-bold text-white">Payment Received!</h2>
            <p className="text-3xl font-bold text-gold mt-2">{formatCurrency(lastCharge.total)}</p>
          </div>
          <Card className="text-left space-y-3">
            <div className="space-y-2">
              {lastCharge.items.map(item => (
                <div key={item.id} className="flex justify-between text-sm">
                  <span className="text-gray-300">{item.name} × {item.qty}</span>
                  <span className="text-white">{formatCurrency(item.price * item.qty)}</span>
                </div>
              ))}
            </div>
            <div className="border-t border-border pt-3 space-y-1">
              <div className="flex justify-between text-sm"><span className="text-gray-400">Subtotal</span><span className="text-white">{formatCurrency(subtotal)}</span></div>
              <div className="flex justify-between text-sm"><span className="text-gray-400">Tip</span><span className="text-white">{formatCurrency(lastCharge.tip)}</span></div>
              {lastCharge.discount > 0 && <div className="flex justify-between text-sm"><span className="text-gray-400">Discount</span><span className="text-emerald-400">-{formatCurrency(lastCharge.discount)}</span></div>}
              <div className="flex justify-between font-bold border-t border-border pt-2 mt-2"><span className="text-white">Total</span><span className="text-gold text-lg">{formatCurrency(lastCharge.total)}</span></div>
            </div>
            <div className="flex justify-between text-sm pt-2 border-t border-border">
              <span className="text-gray-400">Payment</span>
              <span className="text-white capitalize">{lastCharge.method}</span>
            </div>
          </Card>
          <Button className="w-full" size="lg" onClick={reset}>New Sale</Button>
        </div>
      </div>
    );
  }

  const servicesByCategory = services.reduce((acc, s) => {
    if (!acc[s.category]) acc[s.category] = [];
    acc[s.category].push(s);
    return acc;
  }, {} as Record<string, Service[]>);

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      {toast && <Toast message={toast} onClose={() => setToast("")} />}

      {/* Left Panel */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 border-r border-border">
        <div>
          <h1 className="text-xl font-bold text-white mb-1">Point of Sale</h1>
          <div className="flex gap-2 flex-wrap">
            <Input placeholder="Client name..." value={client} onChange={e => setClient(e.target.value)} className="flex-1 min-w-32" />
            <select value={barberId} onChange={e => setBarberId(e.target.value)}
              className="flex-1 min-w-40 rounded-xl border border-border bg-surface-raised px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-gold/50">
              {barbers.length === 0 && <option value="">No barbers</option>}
              {barbers.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
        </div>

        {/* Services by category */}
        {!dataLoaded ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-20 rounded-2xl bg-surface-raised animate-pulse" />)}
          </div>
        ) : (
          Object.entries(servicesByCategory).map(([cat, svcs]) => (
            <div key={cat}>
              <p className="text-xs text-gray-400 mb-2 font-medium uppercase tracking-wide">{cat}</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {svcs.map(svc => (
                  <button key={svc.id} onClick={() => addItem(svc.id, svc.name, svc.price, "service")}
                    className="p-4 rounded-2xl border border-border bg-surface hover:border-gold/50 hover:bg-gold/5 transition-all active:scale-95 text-left">
                    <p className="text-sm font-semibold text-white">{svc.name}</p>
                    <p className="text-xs text-gray-400 mt-0.5">{svc.duration_minutes} min</p>
                    <p className="text-lg font-bold text-gold mt-1">{formatCurrency(svc.price)}</p>
                  </button>
                ))}
              </div>
            </div>
          ))
        )}

        {/* Products */}
        {inventory.length > 0 && (
          <div>
            <p className="text-xs text-gray-400 mb-2 font-medium uppercase tracking-wide">Products</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {inventory.map(inv => (
                <button key={inv.id} onClick={() => addItem(`inv-${inv.id}`, inv.name, inv.price, "product", inv.id)}
                  className={cn("p-3 rounded-xl border border-border bg-surface hover:border-gold/50 hover:bg-gold/5 transition-all active:scale-95 text-left",
                    inv.quantity === 0 && "opacity-40 pointer-events-none")}>
                  <p className="text-xs font-medium text-gray-300 truncate">{inv.name}</p>
                  <p className="text-sm font-bold text-gold mt-0.5">{formatCurrency(inv.price)}</p>
                  {inv.quantity <= inv.low_stock_threshold && inv.quantity > 0 && (
                    <p className="text-xs text-red-400 mt-0.5">{inv.quantity} left</p>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Recent Transactions */}
        {recentTx.length > 0 && (
          <div>
            <p className="text-xs text-gray-400 mb-2 font-medium uppercase tracking-wide">Recent Transactions</p>
            <div className="space-y-2">
              {recentTx.map(tx => (
                <div key={tx.id} className="flex items-center justify-between p-3 bg-surface-raised rounded-xl border border-border">
                  <div>
                    <p className="text-sm text-white">{tx.client_name} · {tx.service_name}</p>
                    <p className="text-xs text-gray-400">{new Date(tx.created_at).toLocaleTimeString("en-CA", { hour: "2-digit", minute: "2-digit" })}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-bold text-gold">{formatCurrency(tx.amount + tx.tip)}</p>
                    <p className="text-xs text-gray-400 capitalize">{tx.payment_method}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Right Panel - Order Summary */}
      <div className="w-80 flex flex-col bg-surface border-l border-border">
        <div className="p-4 border-b border-border">
          <h2 className="text-base font-bold text-white">Order Summary</h2>
          <p className="text-xs text-gray-400">{client} · {barbers.find(b => b.id === barberId)?.name ?? "—"}</p>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {cart.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-4xl mb-2">🛒</p>
              <p className="text-sm text-gray-400">No items added</p>
            </div>
          ) : cart.map(item => (
            <div key={item.id} className="flex items-center gap-2 p-3 bg-surface-raised rounded-xl border border-border">
              <div className="flex-1 min-w-0">
                <p className="text-sm text-white truncate">{item.name}</p>
                <p className="text-xs text-gold">{formatCurrency(item.price)}</p>
              </div>
              <div className="flex items-center gap-1">
                <button onClick={() => changeQty(item.id, -1)} className="w-6 h-6 rounded-lg bg-surface text-white text-xs flex items-center justify-center hover:bg-border">−</button>
                <span className="text-sm text-white w-4 text-center">{item.qty}</span>
                <button onClick={() => changeQty(item.id, 1)} className="w-6 h-6 rounded-lg bg-surface text-white text-xs flex items-center justify-center hover:bg-border">+</button>
              </div>
              <button onClick={() => removeItem(item.id)} className="text-red-400 hover:text-red-300 text-sm">✕</button>
            </div>
          ))}
        </div>

        <div className="p-4 border-t border-border space-y-4">
          {/* Tip */}
          <div>
            <p className="text-xs text-gray-400 mb-2">Tip</p>
            <div className="flex gap-1 flex-wrap">
              {[10,15,20].map(t => (
                <button key={t} onClick={() => { setTipPercent(tipPercent === t ? null : t); setCustomTip(""); }}
                  className={cn("flex-1 py-1.5 rounded-lg text-xs font-medium transition-colors", tipPercent === t ? "bg-gold text-black" : "bg-surface-raised text-gray-300 hover:text-white border border-border")}>
                  {t}%
                </button>
              ))}
              <input type="number" placeholder="$" value={customTip} onChange={e => { setCustomTip(e.target.value); setTipPercent(null); }}
                className="flex-1 min-w-12 rounded-lg border border-border bg-surface-raised px-2 py-1.5 text-xs text-white focus:outline-none focus:ring-1 focus:ring-gold/50 text-center" />
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
            <div className="flex justify-between text-gray-400"><span>Subtotal</span><span className="text-white">{formatCurrency(subtotal)}</span></div>
            <div className="flex justify-between text-gray-400"><span>Tip</span><span className="text-white">{formatCurrency(tipAmt)}</span></div>
            {discount > 0 && <div className="flex justify-between text-gray-400"><span>Discount</span><span className="text-emerald-400">-{formatCurrency(discount)}</span></div>}
            <div className="flex justify-between font-bold border-t border-border pt-2 mt-2"><span className="text-white">Total</span><span className="text-gold text-lg">{formatCurrency(total)}</span></div>
          </div>

          {/* Payment Method */}
          <div className="grid grid-cols-3 gap-2">
            {(["card","cash","online"] as PM[]).map(m => (
              <button key={m} onClick={() => setPaymentMethod(m)}
                className={cn("py-2 rounded-xl text-xs font-medium capitalize transition-colors border", paymentMethod === m ? "bg-gold text-black border-gold" : "bg-surface-raised text-gray-300 border-border hover:border-gold/50")}>
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
  );
}
