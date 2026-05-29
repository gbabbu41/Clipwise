"use client";
import { useState, useEffect, useCallback } from "react";
import { CreditCard, Check, AlertTriangle, ExternalLink, Crown, Building2, ArrowUpRight } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";

function Toast({ message, onClose }: { message: string; onClose: () => void }) {
  return (
    <div className="fixed bottom-6 right-6 z-[100] bg-surface-raised border border-border rounded-xl px-5 py-3 text-sm text-white shadow-xl flex items-center gap-3">
      <span className="text-gold">✓</span>{message}
      <button onClick={onClose} className="text-gray-400 hover:text-white ml-2">✕</button>
    </div>
  );
}

interface Billing {
  plan: string;
  subscriptionStatus: string;
  nextBilling: string | null;
  amount: number | null;
  cardLast4: string | null;
  invoices: { id: string; amount: number; date: number; status: string; url: string | null }[];
  connect: { connected: boolean; status: string };
}

const PLAN_LABEL: Record<string, string> = { starter: "Starter (Free)", pro: "Pro", premium: "Premium" };

export default function BillingPage() {
  const { accessToken } = useAuth();
  const [billing, setBilling] = useState<Billing | null>(null);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState("");
  const [showCancel, setShowCancel] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [actionLoading, setActionLoading] = useState("");

  const showToast = (m: string) => { setToast(m); setTimeout(() => setToast(""), 3000); };

  const load = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    const res = await fetch("/api/stripe/billing", { headers: { Authorization: `Bearer ${accessToken}` } });
    if (res.ok) setBilling(await res.json());
    setLoading(false);
  }, [accessToken]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("upgraded") === "1") {
      showToast("Plan upgraded! 🎉");
      window.history.replaceState({}, "", "/dashboard/billing");
    }
  }, []);

  const startCheckoutUpgrade = async () => {
    if (!accessToken) return;
    setActionLoading("upgrade");
    const res = await fetch("/api/stripe/checkout", {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ plan: "premium", upgrade: true }),
    });
    const data = await res.json();
    if (res.ok && data.url) window.location.href = data.url;
    else { showToast(data.error ?? "Could not start upgrade"); setActionLoading(""); }
  };

  const completeConnect = async () => {
    if (!accessToken) return;
    setActionLoading("connect");
    const res = await fetch("/api/stripe/connect", {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const data = await res.json();
    if (res.ok && data.url) window.location.href = data.url;
    else { showToast(data.error ?? "Could not start Stripe Connect"); setActionLoading(""); }
  };

  const cancelSubscription = async () => {
    if (!accessToken) return;
    setCancelling(true);
    const res = await fetch("/api/stripe/cancel-subscription", {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    });
    setCancelling(false);
    setShowCancel(false);
    if (res.ok) { showToast("Subscription cancelled"); load(); }
    else { const d = await res.json(); showToast(d.error ?? "Could not cancel"); }
  };

  const statusBadge = (status: string) => {
    const map: Record<string, string> = {
      active: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
      cancelled: "bg-red-500/15 text-red-400 border-red-500/30",
      past_due: "bg-orange-500/15 text-orange-400 border-orange-500/30",
      inactive: "bg-gray-500/15 text-gray-400 border-gray-500/30",
    };
    const label: Record<string, string> = { active: "Active", cancelled: "Cancelled", past_due: "Past Due", inactive: "No subscription" };
    return <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium border", map[status] ?? map.inactive)}>{label[status] ?? status}</span>;
  };

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[60vh]">
        <div className="w-8 h-8 border-2 border-gold/30 border-t-gold rounded-full animate-spin" />
      </div>
    );
  }

  const isStarter = !billing || billing.plan === "starter";
  const isExpired = billing?.subscriptionStatus === "cancelled" || billing?.subscriptionStatus === "past_due";

  return (
    <div className="p-6 space-y-6 max-w-3xl">
      {toast && <Toast message={toast} onClose={() => setToast("")} />}

      <div>
        <h1 className="text-2xl font-bold text-white">Billing</h1>
        <p className="text-sm text-gray-400 mt-0.5">Manage your subscription and payouts</p>
      </div>

      {isExpired && (
        <div className="flex items-center gap-3 bg-orange-500/10 border border-orange-500/30 rounded-2xl p-4">
          <AlertTriangle size={18} className="text-orange-400 flex-shrink-0" />
          <p className="text-sm text-orange-300">Your subscription has {billing?.subscriptionStatus === "past_due" ? "a past-due payment" : "expired"}. Premium features are locked until you reactivate.</p>
        </div>
      )}

      {/* Subscription card */}
      <Card>
        <CardHeader>
          <CardTitle>Subscription</CardTitle>
          {billing && statusBadge(billing.subscriptionStatus)}
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-3 mb-5">
            <div className={cn("w-12 h-12 rounded-xl flex items-center justify-center", isStarter ? "bg-surface-raised" : "bg-gold/15")}>
              <Crown size={22} className={isStarter ? "text-gray-400" : "text-gold"} />
            </div>
            <div>
              <p className="text-lg font-bold text-white">{PLAN_LABEL[billing?.plan ?? "starter"]}</p>
              {billing?.amount != null && <p className="text-sm text-gray-400">${billing.amount}/month</p>}
            </div>
          </div>

          {!isStarter && (
            <div className="grid grid-cols-2 gap-3 mb-5">
              <div className="p-3 bg-surface-raised rounded-xl border border-border">
                <p className="text-xs text-gray-400">Next billing date</p>
                <p className="text-sm text-white mt-0.5">{billing?.nextBilling ? new Date(billing.nextBilling).toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric" }) : "—"}</p>
              </div>
              <div className="p-3 bg-surface-raised rounded-xl border border-border">
                <p className="text-xs text-gray-400">Payment method</p>
                <p className="text-sm text-white mt-0.5 flex items-center gap-1.5"><CreditCard size={13} className="text-gray-500" /> {billing?.cardLast4 ? `•••• ${billing.cardLast4}` : "—"}</p>
              </div>
            </div>
          )}

          <div className="flex flex-wrap gap-3">
            {isStarter ? (
              <Button loading={actionLoading === "upgrade"} onClick={startCheckoutUpgrade}>
                <ArrowUpRight size={15} /> Upgrade to Premium
              </Button>
            ) : billing?.plan === "pro" ? (
              <Button loading={actionLoading === "upgrade"} onClick={startCheckoutUpgrade}>
                <ArrowUpRight size={15} /> Upgrade to Premium
              </Button>
            ) : null}
            {!isStarter && billing?.subscriptionStatus === "active" && (
              <Button variant="outline" className="text-red-400 border-red-500/30 hover:bg-red-500/10" onClick={() => setShowCancel(true)}>
                Cancel Subscription
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Connect / payouts card */}
      <Card>
        <CardHeader>
          <CardTitle>Payouts (Stripe Connect)</CardTitle>
          {billing?.connect.connected
            ? <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium border bg-emerald-500/15 text-emerald-400 border-emerald-500/30"><Check size={11} /> Connected</span>
            : <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium border bg-orange-500/15 text-orange-400 border-orange-500/30"><AlertTriangle size={11} /> Not connected</span>}
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl bg-surface-raised flex items-center justify-center">
              <Building2 size={18} className="text-gold" />
            </div>
            <p className="text-sm text-gray-300">
              {billing?.connect.connected
                ? "Your bank account is connected. Customer payments are deposited directly to you."
                : "Connect your bank account to receive customer payments directly via Stripe."}
            </p>
          </div>
          {!billing?.connect.connected && (
            <Button loading={actionLoading === "connect"} onClick={completeConnect}>
              <Building2 size={15} /> Complete Setup
            </Button>
          )}
        </CardContent>
      </Card>

      {/* Invoice history */}
      {billing && billing.invoices.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Invoice History</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-2">
              {billing.invoices.map(inv => (
                <div key={inv.id} className="flex items-center justify-between p-3 bg-surface-raised rounded-xl border border-border">
                  <div>
                    <p className="text-sm text-white">{inv.id}</p>
                    <p className="text-xs text-gray-500">{new Date(inv.date * 1000).toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric" })}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-medium text-white">${inv.amount.toFixed(2)}</span>
                    <span className={cn("text-xs px-2 py-0.5 rounded-full", inv.status === "paid" ? "text-emerald-400 bg-emerald-500/10" : "text-gray-400 bg-gray-500/10")}>{inv.status}</span>
                    {inv.url && <a href={inv.url} target="_blank" rel="noopener noreferrer" className="text-gray-400 hover:text-gold"><ExternalLink size={14} /></a>}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Cancel confirmation */}
      {showCancel && (
        <>
          <div className="fixed inset-0 bg-black/70 z-[60]" onClick={() => setShowCancel(false)} />
          <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
            <div className="bg-surface border border-border rounded-2xl p-6 w-full max-w-sm space-y-4 text-center">
              <div className="w-12 h-12 rounded-full bg-red-500/15 border border-red-500/30 flex items-center justify-center mx-auto">
                <AlertTriangle size={20} className="text-red-400" />
              </div>
              <h2 className="text-lg font-bold text-white">Cancel subscription?</h2>
              <p className="text-sm text-gray-400">Your shop will be downgraded to the free Starter plan and Premium features will be locked. This cannot be undone.</p>
              <div className="flex gap-3">
                <Button variant="outline" className="flex-1" onClick={() => setShowCancel(false)}>Keep Plan</Button>
                <Button className="flex-1 bg-red-500 hover:bg-red-600 text-white" loading={cancelling} onClick={cancelSubscription}>Cancel</Button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
