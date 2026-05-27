"use client";
import { useState, useEffect, useCallback } from "react";
import { Gift, Plus, Search, Check, X, Copy, DollarSign } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/lib/supabase";
import { cn, formatCurrency } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";

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

function Toast({ message, onClose }: { message: string; onClose: () => void }) {
  return (
    <div className="fixed bottom-6 right-6 z-[100] bg-surface-raised border border-border rounded-xl px-5 py-3 text-sm text-white shadow-xl flex items-center gap-3">
      <span className="text-gold">✓</span>{message}
      <button onClick={onClose} className="text-gray-400 hover:text-white ml-2">✕</button>
    </div>
  );
}

function generateCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 12 }, (_, i) => {
    const c = chars[Math.floor(Math.random() * chars.length)];
    return i === 4 || i === 8 ? `-${c}` : c;
  }).join("");
}

type BlankForm = {
  initial_value: string;
  purchased_by: string;
  purchased_by_email: string;
  recipient_name: string;
  recipient_email: string;
  note: string;
};
const BLANK: BlankForm = { initial_value: "50", purchased_by: "", purchased_by_email: "", recipient_name: "", recipient_email: "", note: "" };

export default function GiftCardsPage() {
  const { shop } = useAuth();
  const [cards, setCards] = useState<GiftCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "active" | "used">("all");
  const [showAdd, setShowAdd] = useState(false);
  const [showRedeem, setShowRedeem] = useState(false);
  const [form, setForm] = useState<BlankForm>(BLANK);
  const [redeemCode, setRedeemCode] = useState("");
  const [redeemAmount, setRedeemAmount] = useState("");
  const [redeemResult, setRedeemResult] = useState<GiftCard | null>(null);
  const [saving, setSaving] = useState(false);
  const [redeeming, setRedeeming] = useState(false);
  const [toast, setToast] = useState("");

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(""), 3000); };

  const load = useCallback(async () => {
    if (!shop) { setLoading(false); return; }
    setLoading(true);
    const { data } = await supabase
      .from("gift_cards")
      .select("*")
      .eq("shop_id", shop.id)
      .order("created_at", { ascending: false });
    setCards((data ?? []) as GiftCard[]);
    setLoading(false);
  }, [shop]);

  useEffect(() => { load(); }, [load]);

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

  const issueCard = async () => {
    if (!shop || !form.initial_value) return;
    setSaving(true);
    const code = generateCode();
    const value = parseFloat(form.initial_value) || 0;
    const { error } = await supabase.from("gift_cards").insert({
      shop_id: shop.id,
      code,
      initial_value: value,
      remaining_value: value,
      purchased_by: form.purchased_by.trim() || null,
      purchased_by_email: form.purchased_by_email.trim() || null,
      recipient_name: form.recipient_name.trim() || null,
      recipient_email: form.recipient_email.trim() || null,
      note: form.note.trim() || null,
      is_active: true,
    });
    setSaving(false);
    if (error) { showToast("Error issuing gift card"); return; }
    setShowAdd(false);
    setForm(BLANK);
    showToast(`Gift card issued: ${code}`);
    load();
  };

  const lookupCard = async () => {
    if (!shop || !redeemCode.trim()) return;
    setRedeeming(true);
    const { data } = await supabase
      .from("gift_cards")
      .select("*")
      .eq("shop_id", shop.id)
      .eq("code", redeemCode.trim().toUpperCase().replace(/\s+/g, ""))
      .maybeSingle();
    setRedeeming(false);
    if (!data) { showToast("Gift card not found"); return; }
    setRedeemResult(data as GiftCard);
  };

  const redeemCard = async () => {
    if (!redeemResult) return;
    const amount = parseFloat(redeemAmount) || 0;
    if (amount <= 0 || amount > redeemResult.remaining_value) {
      showToast(`Amount must be between $0.01 and ${formatCurrency(redeemResult.remaining_value)}`);
      return;
    }
    setRedeeming(true);
    const newBalance = Math.max(0, redeemResult.remaining_value - amount);
    await supabase.from("gift_cards").update({
      remaining_value: newBalance,
      is_active: newBalance > 0,
      redeemed_at: new Date().toISOString(),
    }).eq("id", redeemResult.id);
    setRedeeming(false);
    showToast(`Redeemed ${formatCurrency(amount)} — Remaining: ${formatCurrency(newBalance)}`);
    setShowRedeem(false);
    setRedeemCode("");
    setRedeemAmount("");
    setRedeemResult(null);
    load();
  };

  const copyCode = (code: string) => {
    navigator.clipboard.writeText(code).then(() => showToast("Code copied!")).catch(() => null);
  };

  const deactivate = async (id: string) => {
    await supabase.from("gift_cards").update({ is_active: false }).eq("id", id);
    setCards(prev => prev.map(c => c.id === id ? { ...c, is_active: false } : c));
    showToast("Gift card deactivated");
  };

  return (
    <div className="p-6 space-y-6">
      {toast && <Toast message={toast} onClose={() => setToast("")} />}

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">Gift Cards</h1>
          <p className="text-sm text-gray-400 mt-0.5">Issue and redeem gift cards</p>
        </div>
        <div className="flex gap-3">
          <Button variant="outline" onClick={() => setShowRedeem(true)}>
            <DollarSign size={16} /> Redeem
          </Button>
          <Button onClick={() => setShowAdd(true)}>
            <Plus size={16} /> Issue Gift Card
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="p-4">
          <p className="text-xs text-gray-400">Total Issued</p>
          <p className="text-2xl font-bold text-white mt-1">{cards.length}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-gray-400">Total Value Sold</p>
          <p className="text-2xl font-bold text-gold mt-1">{formatCurrency(totalIssued)}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-gray-400">Outstanding Balance</p>
          <p className="text-2xl font-bold text-yellow-400 mt-1">{formatCurrency(totalOutstanding)}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-gray-400">Total Redeemed</p>
          <p className="text-2xl font-bold text-emerald-400 mt-1">{formatCurrency(totalRedeemed)}</p>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by code, name..."
            className="w-full bg-surface border border-border rounded-xl pl-9 pr-4 py-2.5 text-sm text-white placeholder:text-gray-500 focus:outline-none focus:border-gold/50" />
        </div>
        <div className="flex gap-2">
          {(["all", "active", "used"] as const).map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className={cn("px-3 py-1.5 text-xs rounded-lg border font-medium capitalize transition-colors",
                filter === f ? "bg-gold/15 border-gold/30 text-gold" : "border-border text-gray-400 hover:text-white")}>
              {f}
            </button>
          ))}
        </div>
      </div>

      {/* Cards Table */}
      <Card>
        <CardContent>
          {loading ? (
            <div className="py-12 text-center text-gray-500">Loading...</div>
          ) : filtered.length === 0 ? (
            <div className="py-16 text-center">
              <Gift size={40} className="mx-auto mb-4 text-gray-600" />
              <p className="text-white font-medium">No gift cards yet</p>
              <p className="text-sm text-gray-500 mt-1">Issue your first gift card to get started</p>
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
                      <th key={h} className="text-left text-xs font-medium text-gray-400 px-3 py-3">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(card => {
                    const pctLeft = card.initial_value > 0 ? (card.remaining_value / card.initial_value) * 100 : 0;
                    const isUsed = !card.is_active || card.remaining_value === 0;
                    return (
                      <tr key={card.id} className={cn("border-b border-border/50 hover:bg-surface-raised/20 transition-colors", isUsed && "opacity-50")}>
                        <td className="px-3 py-3">
                          <div className="flex items-center gap-2">
                            <code className="text-sm font-mono text-gold bg-gold/10 px-2 py-0.5 rounded">{card.code}</code>
                            <button onClick={() => copyCode(card.code)} className="text-gray-500 hover:text-white transition-colors">
                              <Copy size={13} />
                            </button>
                          </div>
                        </td>
                        <td className="px-3 py-3">
                          <p className="text-sm text-white">{card.recipient_name || card.purchased_by || "—"}</p>
                          {card.recipient_email && <p className="text-xs text-gray-500">{card.recipient_email}</p>}
                        </td>
                        <td className="px-3 py-3 text-sm text-white">{formatCurrency(card.initial_value)}</td>
                        <td className="px-3 py-3">
                          <div className="space-y-1">
                            <p className={cn("text-sm font-semibold", card.remaining_value > 0 ? "text-emerald-400" : "text-gray-500")}>
                              {formatCurrency(card.remaining_value)}
                            </p>
                            <div className="w-20 h-1 bg-surface-raised rounded-full overflow-hidden">
                              <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${pctLeft}%` }} />
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-3">
                          <Badge variant={isUsed ? "outline" : "success"} className="text-xs">
                            {isUsed ? "Used/Void" : "Active"}
                          </Badge>
                        </td>
                        <td className="px-3 py-3 text-xs text-gray-400">
                          {new Date(card.created_at).toLocaleDateString("en-CA")}
                        </td>
                        <td className="px-3 py-3">
                          {!isUsed && (
                            <button onClick={() => deactivate(card.id)} className="text-xs text-gray-500 hover:text-red-400 transition-colors">
                              <X size={14} className="inline" /> Void
                            </button>
                          )}
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
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="bg-surface border border-border rounded-2xl p-6 w-full max-w-md space-y-4 max-h-[90vh] overflow-y-auto">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold text-white">Issue Gift Card</h2>
                <button onClick={() => setShowAdd(false)} className="text-gray-400 hover:text-white text-xl leading-none">✕</button>
              </div>

              {/* Value quick-select */}
              <div>
                <label className="text-xs text-gray-400 block mb-2">Amount *</label>
                <div className="flex gap-2 flex-wrap mb-2">
                  {["25", "50", "75", "100", "150", "200"].map(v => (
                    <button key={v} onClick={() => setForm(p => ({ ...p, initial_value: v }))}
                      className={cn("px-3 py-1.5 text-sm rounded-lg border font-medium transition-colors",
                        form.initial_value === v ? "bg-gold/20 border-gold/40 text-gold" : "border-border text-gray-400 hover:text-white")}>
                      ${v}
                    </button>
                  ))}
                </div>
                <input value={form.initial_value} onChange={e => setForm(p => ({ ...p, initial_value: e.target.value }))} type="number" min="1" placeholder="Custom amount"
                  className="w-full bg-surface-raised border border-border rounded-xl px-4 py-2.5 text-sm text-white placeholder:text-gray-500 focus:outline-none focus:border-gold/50" />
              </div>

              {/* Recipient */}
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <label className="text-xs text-gray-400">Recipient Name</label>
                  <input value={form.recipient_name} onChange={e => setForm(p => ({ ...p, recipient_name: e.target.value }))} placeholder="Jane Smith"
                    className="w-full bg-surface-raised border border-border rounded-xl px-4 py-2.5 text-sm text-white placeholder:text-gray-500 focus:outline-none focus:border-gold/50" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs text-gray-400">Recipient Email (optional)</label>
                  <input value={form.recipient_email} onChange={e => setForm(p => ({ ...p, recipient_email: e.target.value }))} type="email" placeholder="jane@example.com"
                    className="w-full bg-surface-raised border border-border rounded-xl px-4 py-2.5 text-sm text-white placeholder:text-gray-500 focus:outline-none focus:border-gold/50" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs text-gray-400">Purchased By</label>
                  <input value={form.purchased_by} onChange={e => setForm(p => ({ ...p, purchased_by: e.target.value }))} placeholder="John Smith"
                    className="w-full bg-surface-raised border border-border rounded-xl px-4 py-2.5 text-sm text-white placeholder:text-gray-500 focus:outline-none focus:border-gold/50" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs text-gray-400">Note (optional)</label>
                  <input value={form.note} onChange={e => setForm(p => ({ ...p, note: e.target.value }))} placeholder="Birthday gift"
                    className="w-full bg-surface-raised border border-border rounded-xl px-4 py-2.5 text-sm text-white placeholder:text-gray-500 focus:outline-none focus:border-gold/50" />
                </div>
              </div>

              <div className="flex gap-3 pt-2">
                <Button variant="outline" className="flex-1" onClick={() => setShowAdd(false)}>Cancel</Button>
                <Button className="flex-1" loading={saving} onClick={issueCard}>Issue Gift Card</Button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Redeem Modal */}
      {showRedeem && (
        <>
          <div className="fixed inset-0 bg-black/70 z-40" onClick={() => { setShowRedeem(false); setRedeemResult(null); setRedeemCode(""); setRedeemAmount(""); }} />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="bg-surface border border-border rounded-2xl p-6 w-full max-w-sm space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold text-white">Redeem Gift Card</h2>
                <button onClick={() => { setShowRedeem(false); setRedeemResult(null); setRedeemCode(""); setRedeemAmount(""); }} className="text-gray-400 hover:text-white text-xl leading-none">✕</button>
              </div>

              {!redeemResult ? (
                <>
                  <div className="space-y-1.5">
                    <label className="text-xs text-gray-400">Gift Card Code</label>
                    <input
                      value={redeemCode}
                      onChange={e => setRedeemCode(e.target.value.toUpperCase())}
                      onKeyDown={e => e.key === "Enter" && lookupCard()}
                      placeholder="XXXX-XXXX-XXXX"
                      className="w-full bg-surface-raised border border-border rounded-xl px-4 py-2.5 text-sm font-mono text-white placeholder:text-gray-500 focus:outline-none focus:border-gold/50"
                      autoFocus
                    />
                  </div>
                  <div className="flex gap-3">
                    <Button variant="outline" className="flex-1" onClick={() => setShowRedeem(false)}>Cancel</Button>
                    <Button className="flex-1" loading={redeeming} onClick={lookupCard}>Look Up</Button>
                  </div>
                </>
              ) : (
                <>
                  <div className={cn("rounded-xl p-4 border", redeemResult.is_active && redeemResult.remaining_value > 0 ? "bg-emerald-500/10 border-emerald-500/30" : "bg-red-500/10 border-red-500/30")}>
                    <div className="flex items-center gap-2 mb-2">
                      {redeemResult.is_active && redeemResult.remaining_value > 0 ? (
                        <Check size={16} className="text-emerald-400" />
                      ) : (
                        <X size={16} className="text-red-400" />
                      )}
                      <p className="text-sm font-semibold text-white">{redeemResult.code}</p>
                    </div>
                    {redeemResult.recipient_name && <p className="text-xs text-gray-400">For: {redeemResult.recipient_name}</p>}
                    <div className="flex justify-between mt-2 text-sm">
                      <span className="text-gray-400">Balance:</span>
                      <span className="text-gold font-bold">{formatCurrency(redeemResult.remaining_value)}</span>
                    </div>
                  </div>

                  {redeemResult.is_active && redeemResult.remaining_value > 0 && (
                    <>
                      <div className="space-y-1.5">
                        <label className="text-xs text-gray-400">Amount to Redeem ($)</label>
                        <input
                          value={redeemAmount}
                          onChange={e => setRedeemAmount(e.target.value)}
                          type="number"
                          min="0.01"
                          step="0.01"
                          max={redeemResult.remaining_value}
                          placeholder={`Max ${formatCurrency(redeemResult.remaining_value)}`}
                          className="w-full bg-surface-raised border border-border rounded-xl px-4 py-2.5 text-sm text-white placeholder:text-gray-500 focus:outline-none focus:border-gold/50"
                          autoFocus
                        />
                      </div>
                      <div className="flex gap-3">
                        <Button variant="outline" className="flex-1" onClick={() => { setRedeemResult(null); setRedeemCode(""); setRedeemAmount(""); }}>
                          Back
                        </Button>
                        <Button className="flex-1" loading={redeeming} onClick={redeemCard}>Redeem</Button>
                      </div>
                    </>
                  )}

                  {(!redeemResult.is_active || redeemResult.remaining_value === 0) && (
                    <Button variant="outline" className="w-full" onClick={() => { setRedeemResult(null); setRedeemCode(""); }}>
                      Try Another Code
                    </Button>
                  )}
                </>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
