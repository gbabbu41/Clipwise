"use client";
import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/lib/auth-context";
import { cn, formatCurrency } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Check, X, CreditCard, Clock } from "lucide-react";
import { hardwareCreditCents } from "@/lib/hardware-credit-config";

interface CreditShop {
  id: string;
  name: string;
  slug: string | null;
  email: string | null;
  stripe_customer_id: string | null;
  hardware_credit_granted: boolean;
  hardware_credit_amount_cents: number | null;
  hardware_credit_at: string | null;
  hardware_credit_requested_at: string | null;
  hardware_credit_rejected_at: string | null;
  hardware_credit_note: string | null;
  users?: { name: string | null; email: string | null };
}

type CreditStatus = "pending" | "granted" | "rejected";

function statusOf(s: CreditShop): CreditStatus {
  if (s.hardware_credit_granted) return "granted";
  if (s.hardware_credit_requested_at) return "pending";
  return "rejected";
}

function whenText(iso: string | null): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString("en-CA", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  } catch { return ""; }
}

function Toast({ msg, ok, onClose }: { msg: string; ok: boolean; onClose: () => void }) {
  return (
    <div className={cn(
      "fixed bottom-6 right-6 z-[100] flex items-center gap-3 px-5 py-3 rounded-xl border shadow-xl text-sm font-medium",
      ok ? "bg-emerald-900/80 border-emerald-500/40 text-emerald-300" : "bg-red-900/80 border-red-500/40 text-red-300"
    )}>
      {ok ? <Check size={15} /> : <X size={15} />} {msg}
      <button onClick={onClose} className="ml-2 opacity-60 hover:opacity-100">✕</button>
    </div>
  );
}

export default function AdminReaderCreditsPage() {
  const { user, loading: authLoading, accessToken } = useAuth();
  const [shops, setShops] = useState<CreditShop[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [rejectModal, setRejectModal] = useState<CreditShop | null>(null);
  const [rejectNote, setRejectNote] = useState("");
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);

  const offerLabel = formatCurrency(hardwareCreditCents() / 100);
  const showToast = (msg: string, ok = true) => { setToast({ msg, ok }); setTimeout(() => setToast(null), 3800); };

  const load = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    try {
      const res = await fetch("/api/admin/hardware-credit", { headers: { Authorization: `Bearer ${accessToken}` } });
      if (res.ok) { const json = await res.json(); setShops((json.shops ?? []) as CreditShop[]); }
    } catch { /* leave list as-is */ }
    setLoading(false);
  }, [accessToken]);

  useEffect(() => { if (!authLoading && user) load(); }, [authLoading, user, load]);

  const act = async (shop: CreditShop, action: "approve" | "reject", note?: string) => {
    setSavingId(shop.id);
    try {
      const res = await fetch("/api/admin/hardware-credit", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken ?? ""}` },
        body: JSON.stringify({ shop_id: shop.id, action, note }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { showToast(json.error || "Something went wrong", false); return false; }
      showToast(action === "approve" ? `${offerLabel} credit applied to ${shop.name}` : `${shop.name}'s request rejected`);
      await load();
      return true;
    } catch { showToast("Network error — try again", false); return false; }
    finally { setSavingId(null); }
  };

  const confirmReject = async () => {
    if (!rejectModal) return;
    const ok = await act(rejectModal, "reject", rejectNote.trim() || undefined);
    if (ok) { setRejectModal(null); setRejectNote(""); }
  };

  const pending = shops.filter(s => statusOf(s) === "pending");
  const history = shops.filter(s => statusOf(s) !== "pending");

  return (
    <div className="p-4 lg:p-8 space-y-6">
      {toast && <Toast msg={toast.msg} ok={toast.ok} onClose={() => setToast(null)} />}

      <div>
        <h1 className="text-2xl font-bold text-white">Reader Credits</h1>
        <p className="text-sm text-[#8f8f8f] mt-0.5">
          Barbers who bought a WisePad 3 and requested their {offerLabel} subscription credit. Approving applies the Stripe credit to their plan.
        </p>
      </div>

      {loading ? (
        <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-16 animate-pulse bg-surface-raised rounded-xl" />)}</div>
      ) : (
        <>
          {/* Pending review */}
          <div className="space-y-3">
            <h2 className="text-sm font-semibold text-white flex items-center gap-2">
              <Clock size={15} className="text-amber-400" /> Awaiting review
              <span className="text-xs font-medium text-[#8f8f8f]">({pending.length})</span>
            </h2>
            {pending.length === 0 ? (
              <Card><div className="py-10 text-center text-sm text-[#8f8f8f]">No credit requests waiting. New requests show up here.</div></Card>
            ) : (
              <div className="space-y-2">
                {pending.map(s => (
                  <Card key={s.id}>
                    <CardContent className="flex flex-col sm:flex-row sm:items-center gap-3 py-4">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-white truncate">{s.name}</p>
                        <p className="text-xs text-[#8f8f8f] truncate">{s.users?.name || "—"} · {s.users?.email || s.email || "—"}</p>
                        <p className="text-xs text-[#6e6e6e] mt-0.5">
                          Requested {whenText(s.hardware_credit_requested_at)}
                          {!s.stripe_customer_id && <span className="text-amber-400"> · no active subscription yet</span>}
                        </p>
                      </div>
                      <div className="flex gap-2 flex-shrink-0">
                        <Button size="sm" loading={savingId === s.id} onClick={() => act(s, "approve")}>Approve {offerLabel}</Button>
                        <Button size="sm" variant="danger" disabled={savingId === s.id} onClick={() => { setRejectModal(s); setRejectNote(""); }}>Reject</Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>

          {/* History */}
          {history.length > 0 && (
            <div className="space-y-3">
              <h2 className="text-sm font-semibold text-white flex items-center gap-2">
                <CreditCard size={15} className="text-[#8f8f8f]" /> History
                <span className="text-xs font-medium text-[#8f8f8f]">({history.length})</span>
              </h2>
              <Card>
                <CardContent className="divide-y divide-border/50 py-0">
                  {history.map(s => {
                    const st = statusOf(s);
                    return (
                      <div key={s.id} className="flex items-center gap-3 py-3">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-white truncate">{s.name}</p>
                          <p className="text-xs text-[#8f8f8f] truncate">
                            {st === "granted"
                              ? `Credited ${formatCurrency((s.hardware_credit_amount_cents ?? hardwareCreditCents()) / 100)} · ${whenText(s.hardware_credit_at)}`
                              : `Rejected ${whenText(s.hardware_credit_rejected_at)}${s.hardware_credit_note ? ` · ${s.hardware_credit_note}` : ""}`}
                          </p>
                        </div>
                        {st === "granted" ? (
                          <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 flex items-center gap-1"><Check size={12} /> Credited</span>
                        ) : (
                          <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-red-500/15 text-red-300">Rejected</span>
                        )}
                      </div>
                    );
                  })}
                </CardContent>
              </Card>
            </div>
          )}
        </>
      )}

      {/* Reject modal */}
      {rejectModal && (
        <>
          <div className="fixed inset-0 bg-black/70 z-40" onClick={() => setRejectModal(null)} />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 overflow-y-auto overscroll-contain [&>*]:my-auto">
            <div className="bg-surface border border-border rounded-2xl p-6 w-full max-w-md space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold text-white">Reject credit request</h2>
                <button onClick={() => setRejectModal(null)} className="text-[#6e6e6e] hover:text-white text-xl">✕</button>
              </div>
              <p className="text-sm text-[#6e6e6e]">Rejecting <span className="text-white font-medium">{rejectModal.name}</span>. They can re-request later. Add a note (optional, shown to them):</p>
              <textarea
                value={rejectNote}
                onChange={e => setRejectNote(e.target.value)}
                rows={3}
                placeholder="e.g. We couldn't confirm a WisePad 3 purchase on your account."
                className="w-full bg-surface-raised border border-border rounded-xl px-4 py-3 text-sm text-white placeholder:text-[#8f8f8f] focus:outline-none focus:border-gold/50 resize-none"
              />
              <div className="flex gap-3">
                <Button variant="outline" className="flex-1" onClick={() => setRejectModal(null)}>Cancel</Button>
                <Button variant="danger" className="flex-1" loading={savingId === rejectModal.id} onClick={confirmReject}>Confirm rejection</Button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
