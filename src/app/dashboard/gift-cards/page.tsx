"use client";
import { useState, useEffect, useCallback } from "react";
import { Gift, Plus, Search, Copy, Mail, SlidersHorizontal } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { useResetOnReturn } from "@/lib/use-reset-on-return";
import { effectivePlan, planHasFeature } from "@/lib/validation";
import { FeatureLock } from "@/components/dashboard/feature-lock";
import { supabase } from "@/lib/supabase";
import { cn, formatCurrency } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

interface GiftCard {
  id: string;
  shop_id: string;
  code: string;
  initial_value: number;
  remaining_value: number;
  purchased_by?: string;
  purchased_by_email?: string;
  recipient_name?: string;
  recipient_email?: string;
  note?: string;
  is_active: boolean;
  created_at: string;
  redeemed_at?: string;
}

interface LedgerRow {
  id: string;
  amount: number | string;
  action: string;
  note?: string | null;
  appointment_id?: string | null;
  created_at: string;
}

// Plain-language line for each history row (phase69/70 ledger actions).
function historyLabel(h: LedgerRow): string {
  switch (h.action) {
    case "redeemed": return h.appointment_id ? "Used for a booking" : "Used at checkout";
    case "restored": return "Given back — booking cancelled or refunded";
    case "reapplied": return "Used again — booking reinstated";
    case "adjusted": return Number(h.amount) < 0 ? "Balance removed by owner" : "Balance added back by owner";
    case "voided": return "Voided";
    case "reactivated": return "Reactivated";
    case "refunded": return "Unused balance refunded — card voided";
    default: return h.action;
  }
}

function Toast({ message, onClose }: { message: string; onClose: () => void }) {
  return (
    <div className="fixed bottom-6 right-6 z-[100] bg-card-raised border border-border rounded-xl px-5 py-3 text-sm text-foreground shadow-xl flex items-center gap-3">
      <span className="text-foreground">✓</span>{message}
      <button onClick={onClose} className="text-grey hover:text-foreground ml-2">✕</button>
    </div>
  );
}

type BlankForm = {
  initial_value: string;
  purchased_by: string;
  purchased_by_email: string;
  recipient_name: string;
  recipient_email: string;
  note: string;
  payment_method: "" | "cash" | "card" | "link" | "free";
};
const BLANK: BlankForm = { initial_value: "50", purchased_by: "", purchased_by_email: "", recipient_name: "", recipient_email: "", note: "", payment_method: "" };

export default function GiftCardsPage() {
  const { shop, accessToken } = useAuth();
  const { prompt } = useConfirm();
  const [cards, setCards] = useState<GiftCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "active" | "used">("all");
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState<BlankForm>(BLANK);
  const [saving, setSaving] = useState(false);
  // Back from the Stripe "Charge card" page: don't leave the button spinning.
  useResetOnReturn(() => setSaving(false));
  // "Manage" sheet: owner corrections (adjust / void / reactivate) + the card's history.
  const [managing, setManaging] = useState<GiftCard | null>(null);
  const [history, setHistory] = useState<LedgerRow[] | null>(null);
  const [adjustDir, setAdjustDir] = useState<"remove" | "add">("remove");
  const [adjustAmount, setAdjustAmount] = useState("");
  const [adjustReason, setAdjustReason] = useState("");
  const [adjusting, setAdjusting] = useState(false);
  const [toast, setToast] = useState("");

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(""), 3000); };

  const load = useCallback(async () => {
    if (!shop) { setLoading(false); return; }
    setLoading(true);
    const { data, error } = await supabase
      .from("gift_cards")
      .select("*")
      .eq("shop_id", shop.id)
      .order("created_at", { ascending: false });
    if (error) console.error("gift_cards load failed:", error.message);
    setCards((data ?? []) as GiftCard[]);
    setLoading(false);
  }, [shop]);

  useEffect(() => { load(); }, [load]);

  // Finalize a portal "Charge card" purchase when Stripe returns the owner here.
  useEffect(() => {
    if (!shop) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("paid") !== "1" || !params.get("session_id")) return;
    const sid = params.get("session_id")!;
    (async () => {
      try {
        const res = await fetch("/api/stripe/gift-finalize", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ session_id: sid, shop_slug: shop.slug }),
        });
        const j = await res.json();
        if (j.paid) showToast(`Gift card issued: ${j.code}`);
      } catch { /* ignore */ }
      window.history.replaceState({}, "", "/dashboard/gift-cards");
      load();
    })();
  }, [shop, load]);

  const filtered = cards.filter(c => {
    const matchFilter = filter === "all" || (filter === "active" ? c.is_active && c.remaining_value > 0 : !c.is_active || c.remaining_value === 0);
    const matchSearch = !search || c.code.toLowerCase().includes(search.toLowerCase())
      || (c.recipient_name ?? "").toLowerCase().includes(search.toLowerCase())
      || (c.purchased_by ?? "").toLowerCase().includes(search.toLowerCase());
    return matchFilter && matchSearch;
  });

  const totalIssued = cards.reduce((s, c) => s + c.initial_value, 0);
  const totalOutstanding = cards.filter(c => c.is_active).reduce((s, c) => s + c.remaining_value, 0);
  const totalRedeemed = totalIssued - totalOutstanding - cards.filter(c => !c.is_active).reduce((s, c) => s + c.remaining_value, 0);

  const authHeaders = () => ({ "Content-Type": "application/json", ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) });

  const issueCard = async () => {
    if (!shop) return;
    const value = parseFloat(form.initial_value) || 0;
    if (value <= 0) { showToast("Enter a valid amount"); return; }
    // No default: a card issued without taking money must never be booked as a cash sale.
    if (!form.payment_method) { showToast("Choose how this card is paid for"); return; }
    setSaving(true);
    try {
      // CASH — real cash collected in person: create + record + email now.
      // FREE — complimentary (owner only): create + email, record NO income.
      if (form.payment_method === "cash" || form.payment_method === "free") {
        const res = await fetch("/api/gift-card/issue-cash", {
          method: "POST", headers: authHeaders(),
          body: JSON.stringify({
            shop_id: shop.id, amount: value, mode: form.payment_method,
            purchased_by: form.purchased_by, purchased_by_email: form.purchased_by_email,
            recipient_name: form.recipient_name, recipient_email: form.recipient_email, note: form.note,
          }),
        });
        const j = await res.json();
        setSaving(false);
        if (!res.ok || !j.ok) { showToast(j.error ?? "Couldn't issue the gift card"); return; }
        setShowAdd(false); setForm(BLANK); showToast(`Gift card issued: ${j.code}`); load();
        return;
      }
      // SEND LINK — email the customer a real Stripe payment link.
      if (form.payment_method === "link") {
        const sendTo = (form.recipient_email || form.purchased_by_email).trim();
        if (!sendTo) { setSaving(false); showToast("Add a recipient or purchaser email to send the link"); return; }
        const res = await fetch("/api/gift-card/send-link", {
          method: "POST", headers: authHeaders(),
          body: JSON.stringify({
            shop_id: shop.id, amount: value, send_to: sendTo,
            purchaser_name: form.purchased_by, recipient_name: form.recipient_name,
            recipient_email: form.recipient_email, note: form.note,
          }),
        });
        const j = await res.json();
        setSaving(false);
        if (!res.ok || !j.ok) { showToast(j.error ?? "Couldn't send the payment link"); return; }
        setShowAdd(false); setForm(BLANK); showToast(`Payment link sent to ${sendTo}`);
        return;
      }
      // CARD — charge now via Stripe; returns here, then finalizes + emails.
      const res = await fetch("/api/stripe/gift-checkout", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          shop_slug: shop.slug, origin: window.location.origin, amount: value,
          recipient_name: form.recipient_name, recipient_email: form.recipient_email,
          purchaser_name: form.purchased_by, purchaser_email: form.purchased_by_email,
          note: form.note, return_path: "/dashboard/gift-cards",
        }),
      });
      const j = await res.json();
      if (!res.ok || !j.url) { setSaving(false); showToast(j.error ?? "Couldn't start card payment"); return; }
      window.location.href = j.url;
    } catch {
      setSaving(false);
      showToast("Something went wrong — please try again");
    }
  };

  const copyCode = (code: string) => {
    navigator.clipboard.writeText(code).then(() => showToast("Code copied!")).catch(() => null);
  };

  // Re-send a card's code to a customer (email confirmed/edited via a prompt).
  const resendCode = async (card: GiftCard) => {
    if (!shop) return;
    const to = await prompt({ title: "Re-send gift card", message: "Send this gift card code to which email?", type: "email", placeholder: "name@email.com", defaultValue: card.recipient_email || card.purchased_by_email || "", confirmText: "Send" });
    if (to === null) return;
    if (!to.trim()) { showToast("Enter an email address"); return; }
    const res = await fetch("/api/gift-card/resend", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) },
      body: JSON.stringify({ gift_card_id: card.id, email: to.trim() }),
    });
    const j = await res.json().catch(() => ({ ok: false }));
    showToast(j.ok ? `Gift card sent to ${to.trim()}` : (j.error ?? "Couldn't send — try again"));
  };

  const loadHistory = async (card: GiftCard) => {
    if (!shop) return;
    setHistory(null);
    const res = await fetch(`/api/gift-card/manage?shop_id=${shop.id}&gift_card_id=${card.id}`, { headers: authHeaders() });
    const j = await res.json().catch(() => ({}));
    setHistory(res.ok ? (j.history ?? []) : []);
  };

  const openManage = (card: GiftCard) => {
    setManaging(card); setAdjustDir("remove"); setAdjustAmount(""); setAdjustReason("");
    loadHistory(card);
  };

  // Every change is server-side, owner-only, atomic, and recorded with its reason.
  const manage = async (card: GiftCard, body: Record<string, unknown>) => {
    if (!shop) return null;
    const res = await fetch("/api/gift-card/manage", {
      method: "POST", headers: authHeaders(),
      body: JSON.stringify({ shop_id: shop.id, gift_card_id: card.id, ...body }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || !j.ok) { showToast(j.error ?? "Couldn't save the change — please try again."); return null; }
    return j as { ok: true; applied?: number; balance?: number };
  };

  const refreshManaged = async (card: GiftCard) => {
    const { data } = await supabase.from("gift_cards").select("*").eq("id", card.id).maybeSingle();
    if (data) { setManaging(data as GiftCard); setCards(prev => prev.map(c => c.id === card.id ? data as GiftCard : c)); }
    loadHistory(card);
  };

  const saveAdjustment = async () => {
    if (!managing) return;
    const amount = Math.round((parseFloat(adjustAmount) || 0) * 100) / 100;
    if (amount <= 0) { showToast("Enter an amount"); return; }
    if (!adjustReason.trim()) { showToast("Add a reason for the change"); return; }
    setAdjusting(true);
    const r = await manage(managing, { action: "adjust", amount: adjustDir === "remove" ? -amount : amount, reason: adjustReason });
    setAdjusting(false);
    if (!r) return;
    showToast(`${adjustDir === "remove" ? "Removed" : "Added"} ${formatCurrency(amount)} — balance ${formatCurrency(r.balance ?? 0)}`);
    setAdjustAmount(""); setAdjustReason("");
    refreshManaged(managing);
  };

  const setActive = async (card: GiftCard, active: boolean) => {
    const reason = await prompt({
      title: active ? "Reactivate gift card" : "Void gift card",
      message: active ? "The card can be used again. Reason (optional):" : `The remaining ${formatCurrency(card.remaining_value)} can't be used until it's reactivated. Reason (optional):`,
      placeholder: active ? "Voided by mistake" : "Lost card / refunded", confirmText: active ? "Reactivate" : "Void card",
    });
    if (reason === null) return;
    const r = await manage(card, { action: active ? "reactivate" : "void", reason });
    if (!r) return;
    showToast(active ? "Gift card reactivated" : "Gift card voided");
    refreshManaged(card);
  };

  // Plan gate — gift cards ride the loyalty feature (Pro/Premium).
  if (shop && !planHasFeature(effectivePlan(shop.subscription_plan, shop.subscription_status), "loyalty")) {
    return <FeatureLock title="Gift Cards" description="Gift cards are available on the Pro and Premium plans." />;
  }

  return (
    <div className="p-6 space-y-6">
      {toast && <Toast message={toast} onClose={() => setToast("")} />}

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground uppercase tracking-wide">Gift Cards</h1>
          <p className="text-sm text-grey mt-0.5">Issue gift cards — customers use them at checkout or when booking online</p>
        </div>
        <div className="flex gap-3">
          <Button onClick={() => setShowAdd(true)}>
            <Plus size={16} /> Issue Gift Card
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="p-4">
          <p className="text-xs text-grey">Total Issued</p>
          <p className="text-2xl font-bold text-foreground mt-1">{cards.length}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-grey">Total Value Sold</p>
          <p className="text-2xl font-bold text-foreground mt-1">{formatCurrency(totalIssued)}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-grey">Outstanding Balance</p>
          <p className="text-2xl font-bold text-orange-400 mt-1">{formatCurrency(totalOutstanding)}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-grey">Total Redeemed</p>
          <p className="text-2xl font-bold text-emerald-400 mt-1">{formatCurrency(totalRedeemed)}</p>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-grey" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by code, name..."
            className="w-full bg-card shadow-sm border border-border rounded-xl pl-9 pr-4 py-2.5 text-sm text-foreground placeholder:text-grey focus:outline-none focus:border-foreground/50" />
        </div>
        <div className="flex gap-2">
          {(["all", "active", "used"] as const).map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className={cn("px-3 py-1.5 text-xs rounded-lg border font-medium capitalize transition-colors",
                filter === f ? "bg-foreground text-background border-foreground" : "border-border text-grey hover:text-foreground")}>
              {f}
            </button>
          ))}
        </div>
      </div>

      {/* Cards Table */}
      <Card>
        <CardContent>
          {loading ? (
            <div className="py-12 text-center text-grey">Loading...</div>
          ) : filtered.length === 0 ? (
            <div className="py-16 text-center">
              <Gift size={40} className="mx-auto mb-4 text-grey" />
              <p className="text-foreground font-medium">No gift cards yet</p>
              <p className="text-sm text-grey mt-1">Issue your first gift card to get started</p>
              <Button className="mt-4" onClick={() => setShowAdd(true)}>
                <Plus size={16} /> Issue Gift Card
              </Button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border">
                    {["Code", "Recipient", "Value", "Remaining", "Status", "Issued", "Actions"].map(h => (
                      <th key={h} className="text-left text-xs font-medium text-grey px-3 py-3">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(card => {
                    const pctLeft = card.initial_value > 0 ? (card.remaining_value / card.initial_value) * 100 : 0;
                    const isUsed = !card.is_active || card.remaining_value === 0;
                    return (
                      <tr key={card.id} className={cn("border-b border-border/50 hover:bg-card-raised/20 transition-colors", isUsed && "opacity-50")}>
                        <td className="px-3 py-3">
                          <div className="flex items-center gap-2">
                            <code className="text-sm font-mono text-foreground bg-card-raised px-2 py-0.5 rounded">{card.code}</code>
                            <button onClick={() => copyCode(card.code)} className="text-grey hover:text-foreground transition-colors">
                              <Copy size={13} />
                            </button>
                          </div>
                        </td>
                        <td className="px-3 py-3">
                          <p className="text-sm text-foreground">{card.recipient_name || card.purchased_by || "—"}</p>
                          {card.recipient_email && <p className="text-xs text-grey">{card.recipient_email}</p>}
                        </td>
                        <td className="px-3 py-3 text-sm text-foreground">{formatCurrency(card.initial_value)}</td>
                        <td className="px-3 py-3">
                          <div className="space-y-1">
                            <p className={cn("text-sm font-semibold", card.remaining_value > 0 ? "text-emerald-400" : "text-grey")}>
                              {formatCurrency(card.remaining_value)}
                            </p>
                            <div className="w-20 h-1 bg-card-raised rounded-full overflow-hidden">
                              <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${pctLeft}%` }} />
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-3">
                          <Badge variant={isUsed ? "outline" : "success"} className="text-xs">
                            {isUsed ? "Used/Void" : "Active"}
                          </Badge>
                        </td>
                        <td className="px-3 py-3 text-xs text-grey">
                          {new Date(card.created_at).toLocaleDateString("en-CA")}
                        </td>
                        <td className="px-3 py-3">
                          <div className="flex items-center gap-3">
                            <button onClick={() => resendCode(card)} className="text-xs text-grey hover:text-foreground transition-colors" title="Email this code to a customer">
                              <Mail size={14} className="inline" /> Resend
                            </button>
                            <button onClick={() => openManage(card)} className="text-xs text-grey hover:text-foreground transition-colors" title="Adjust balance, void, or see history">
                              <SlidersHorizontal size={14} className="inline" /> Manage
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Issue Gift Card Modal */}
      {showAdd && (
        <>
          <div className="fixed inset-0 bg-black/70 z-40" onClick={() => setShowAdd(false)} />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 overflow-y-auto overscroll-contain [&>*]:my-auto">
            <div className="bg-card shadow-sm border border-border rounded-2xl p-6 w-full max-w-md space-y-4 max-h-[90vh] overflow-y-auto">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold text-foreground">Issue Gift Card</h2>
                <button onClick={() => setShowAdd(false)} className="text-grey hover:text-foreground text-xl leading-none">✕</button>
              </div>

              {/* Value quick-select */}
              <div>
                <label className="text-xs text-grey block mb-2">Amount *</label>
                <div className="flex gap-2 flex-wrap mb-2">
                  {["25", "50", "75", "100", "150", "200"].map(v => (
                    <button key={v} onClick={() => setForm(p => ({ ...p, initial_value: v }))}
                      className={cn("px-3 py-1.5 text-sm rounded-lg border font-medium transition-colors",
                        form.initial_value === v ? "bg-emerald-500/10 border-emerald-400 text-foreground" : "border-border text-grey hover:text-foreground")}>
                      ${v}
                    </button>
                  ))}
                </div>
                <input value={form.initial_value} onChange={e => setForm(p => ({ ...p, initial_value: e.target.value }))} type="number" min="1" placeholder="Custom amount"
                  className="w-full bg-card-raised border border-border rounded-xl px-4 py-2.5 text-sm text-foreground placeholder:text-grey focus:outline-none focus:border-foreground/50" />
              </div>

              {/* How it's paid for — must be chosen (no default). Cash / card / link
                  record real money; Free records none (a complimentary card). */}
              <div>
                <label className="text-xs text-grey block mb-2">How is it paid for? *</label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {([
                    { m: "cash" as const, label: "💵 Cash" },
                    { m: "card" as const, label: "💳 Card" },
                    { m: "link" as const, label: "🔗 Send link" },
                    { m: "free" as const, label: "🎁 Free" },
                  ]).map(({ m, label }) => (
                    <button key={m} onClick={() => setForm(p => ({ ...p, payment_method: m }))}
                      className={cn("px-2 py-2 text-sm rounded-lg border font-medium transition-colors",
                        form.payment_method === m ? "bg-emerald-500/10 border-emerald-400 text-foreground" : "border-border text-grey hover:text-foreground")}>
                      {label}
                    </button>
                  ))}
                </div>
                <p className="text-[11px] text-grey mt-1.5">
                  {form.payment_method === "cash" ? "Records a cash sale (income) and emails the code now."
                    : form.payment_method === "card" ? "Charge a card now via Stripe — the code is emailed once it's paid."
                    : form.payment_method === "link" ? "Emails the customer a secure payment link; the code is sent once they pay."
                    : form.payment_method === "free" ? "A complimentary card — emails the code now. No money is recorded, now or when it's used."
                    : "Pick one — only cash, card or link count as income."}
                </p>
              </div>

              {/* Recipient */}
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <label className="text-xs text-grey">Recipient Name</label>
                  <input value={form.recipient_name} onChange={e => setForm(p => ({ ...p, recipient_name: e.target.value }))} placeholder="Jane Smith"
                    className="w-full bg-card-raised border border-border rounded-xl px-4 py-2.5 text-sm text-foreground placeholder:text-grey focus:outline-none focus:border-foreground/50" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs text-grey">Recipient Email (optional)</label>
                  <input value={form.recipient_email} onChange={e => setForm(p => ({ ...p, recipient_email: e.target.value }))} type="email" placeholder="jane@example.com"
                    className="w-full bg-card-raised border border-border rounded-xl px-4 py-2.5 text-sm text-foreground placeholder:text-grey focus:outline-none focus:border-foreground/50" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs text-grey">Purchased By</label>
                  <input value={form.purchased_by} onChange={e => setForm(p => ({ ...p, purchased_by: e.target.value }))} placeholder="John Smith"
                    className="w-full bg-card-raised border border-border rounded-xl px-4 py-2.5 text-sm text-foreground placeholder:text-grey focus:outline-none focus:border-foreground/50" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs text-grey">Note (optional)</label>
                  <input value={form.note} onChange={e => setForm(p => ({ ...p, note: e.target.value }))} placeholder="Birthday gift"
                    className="w-full bg-card-raised border border-border rounded-xl px-4 py-2.5 text-sm text-foreground placeholder:text-grey focus:outline-none focus:border-foreground/50" />
                </div>
              </div>

              <div className="flex gap-3 pt-2">
                <Button variant="outline" className="flex-1" onClick={() => setShowAdd(false)}>Cancel</Button>
                <Button className="flex-1" loading={saving} onClick={issueCard}>
                  {form.payment_method === "card" ? "Charge Card" : form.payment_method === "link" ? "Send Link" : form.payment_method === "free" ? "Give Free Card" : "Issue Gift Card"}
                </Button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Manage Modal — owner corrections + history */}
      {managing && (() => {
        const voided = !managing.is_active && managing.remaining_value > 0;
        const close = () => { setManaging(null); setHistory(null); };
        return (
        <>
          <div className="fixed inset-0 bg-black/70 z-40" onClick={close} />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 overflow-y-auto overscroll-contain [&>*]:my-auto">
            <div className="bg-card shadow-sm border border-border rounded-2xl p-6 w-full max-w-md space-y-4 max-h-[90vh] overflow-y-auto">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold text-foreground">Manage gift card</h2>
                <button onClick={close} className="text-grey hover:text-foreground text-xl leading-none" aria-label="Close">✕</button>
              </div>

              <div className="rounded-xl p-4 border border-border bg-card-raised">
                <div className="flex items-center justify-between gap-2">
                  <code className="text-sm font-mono text-foreground">{managing.code}</code>
                  <Badge variant={voided ? "outline" : managing.remaining_value > 0 ? "success" : "outline"} className="text-xs">
                    {voided ? "Voided" : managing.remaining_value > 0 ? "Active" : "Used up"}
                  </Badge>
                </div>
                {(managing.recipient_name || managing.purchased_by) && <p className="text-xs text-grey mt-1">For: {managing.recipient_name || managing.purchased_by}</p>}
                <div className="flex justify-between mt-2 text-sm">
                  <span className="text-grey">Balance</span>
                  <span className="text-foreground font-bold">{formatCurrency(managing.remaining_value)} <span className="text-grey font-normal">of {formatCurrency(managing.initial_value)}</span></span>
                </div>
              </div>

              {!voided && (
                <div className="space-y-2">
                  <p className="text-sm font-semibold text-foreground">Adjust balance</p>
                  <p className="text-[11px] text-grey">For corrections only. Customers spend a card at checkout — choose “Gift card” when taking payment.</p>
                  <div className="grid grid-cols-2 gap-2">
                    {(["remove", "add"] as const).map(d => (
                      <button key={d} onClick={() => setAdjustDir(d)}
                        className={cn("px-2 py-2 text-sm rounded-lg border font-medium transition-colors",
                          adjustDir === d ? "bg-emerald-500/10 border-emerald-400 text-foreground" : "border-border text-grey hover:text-foreground")}>
                        {d === "remove" ? "− Remove" : "+ Add back"}
                      </button>
                    ))}
                  </div>
                  <input value={adjustAmount} onChange={e => setAdjustAmount(e.target.value)} type="number" min="0.01" step="0.01" inputMode="decimal"
                    placeholder={adjustDir === "remove" ? `Up to ${formatCurrency(managing.remaining_value)}` : `Up to ${formatCurrency(Math.max(0, managing.initial_value - managing.remaining_value))}`}
                    className="w-full bg-card-raised border border-border rounded-xl px-4 py-2.5 text-base sm:text-sm text-foreground placeholder:text-grey focus:outline-none focus:border-foreground/50" />
                  <input value={adjustReason} onChange={e => setAdjustReason(e.target.value)} maxLength={200} placeholder="Reason (required) — e.g. used before ClipWise"
                    className="w-full bg-card-raised border border-border rounded-xl px-4 py-2.5 text-base sm:text-sm text-foreground placeholder:text-grey focus:outline-none focus:border-foreground/50" />
                  <Button className="w-full" loading={adjusting} onClick={saveAdjustment}>Save change</Button>
                </div>
              )}

              <div className="space-y-2">
                <p className="text-sm font-semibold text-foreground">History</p>
                {history === null ? <p className="text-xs text-grey">Loading…</p> : (
                  <ul className="space-y-1.5">
                    {history.map(h => (
                      <li key={h.id} className="flex items-start justify-between gap-3 text-xs">
                        <div className="min-w-0">
                          <p className="text-foreground">{historyLabel(h)}</p>
                          {h.note && <p className="text-grey truncate">{h.note}</p>}
                          <p className="text-grey">{new Date(h.created_at).toLocaleString("en-CA", { dateStyle: "medium", timeStyle: "short" })}</p>
                        </div>
                        {Number(h.amount) !== 0 && (
                          <span className={cn("font-semibold flex-shrink-0", Number(h.amount) < 0 ? "text-foreground" : "text-emerald-400")}>
                            {Number(h.amount) < 0 ? "−" : "+"}{formatCurrency(Math.abs(Number(h.amount)))}
                          </span>
                        )}
                      </li>
                    ))}
                    <li className="flex items-start justify-between gap-3 text-xs">
                      <div>
                        <p className="text-foreground">Issued</p>
                        <p className="text-grey">{new Date(managing.created_at).toLocaleString("en-CA", { dateStyle: "medium", timeStyle: "short" })}</p>
                      </div>
                      <span className="font-semibold text-foreground">{formatCurrency(managing.initial_value)}</span>
                    </li>
                  </ul>
                )}
              </div>

              <div className="flex gap-3 pt-1">
                {voided ? (
                  <Button variant="outline" className="flex-1" onClick={() => setActive(managing, true)}>Reactivate card</Button>
                ) : managing.remaining_value > 0 ? (
                  <Button variant="outline" className="flex-1 text-red-400" onClick={() => setActive(managing, false)}>Void card</Button>
                ) : null}
                <Button variant="outline" className="flex-1" onClick={close}>Done</Button>
              </div>
            </div>
          </div>
        </>
        );
      })()}
    </div>
  );
}
