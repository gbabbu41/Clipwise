"use client";
import { useState, useEffect, useCallback } from "react";
import { CreditCard, Check, AlertTriangle, ExternalLink, Crown, Building2, ArrowUpRight } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { formatPlanPrice } from "@/lib/plans";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";

function Toast({ message, onClose }: { message: string; onClose: () => void }) {
  return (
    <div className="fixed bottom-6 right-6 z-[100] bg-[#141414] border border-[#1e1e1e] rounded-xl px-5 py-3 text-sm text-white shadow-xl flex items-center gap-3">
      <span className="text-white">✓</span>{message}
      <button onClick={onClose} className="text-[#777] hover:text-white ml-2">✕</button>
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
  const { accessToken, refreshShop, plans } = useAuth();
  const [billing, setBilling] = useState<Billing | null>(null);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState("");
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
    if (!accessToken) return; // wait for auth before confirming
    const params = new URLSearchParams(window.location.search);
    if (params.get("upgraded") !== "1") return;
    const sid = params.get("session_id");
    window.history.replaceState({}, "", "/dashboard/billing");
    (async () => {
      // Apply the plan synchronously (don't rely on the platform webhook firing).
      if (sid) {
        const res = await fetch("/api/stripe/confirm-subscription", {
          method: "POST",
          headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
          body: JSON.stringify({ session_id: sid }),
        }).catch(() => null);
        if (res && !res.ok) {
          const d = await res.json().catch(() => ({}));
          showToast(d.error ?? "Payment received, but we couldn't activate the plan — refresh in a moment.");
        }
      }
      showToast("🎉 You're subscribed! Your plan is now active.");
      await refreshShop(); // unlock premium features in sidebar immediately
      load();
    })();
  }, [accessToken, refreshShop, load]);

  const startCheckoutUpgrade = async (planId: string) => {
    if (!accessToken) return;
    setActionLoading(planId);
    const res = await fetch("/api/stripe/checkout", {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ plan: planId, upgrade: true }),
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

  // Open the Stripe Customer Portal — cancel (at period end), update card, invoices.
  const openPortal = async () => {
    if (!accessToken) return;
    setActionLoading("portal");
    const res = await fetch("/api/stripe/billing-portal", {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    });
    const data = await res.json();
    if (res.ok && data.url) window.location.href = data.url;
    else { showToast(data.error ?? "Could not open billing portal"); setActionLoading(""); }
  };

  const statusBadge = (status: string) => {
    const map: Record<string, string> = {
      active: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
      cancelled: "bg-red-500/15 text-red-400 border-red-500/30",
      past_due: "bg-orange-500/15 text-orange-400 border-orange-500/30",
      inactive: "bg-gray-500/15 text-[#777] border-gray-500/30",
    };
    const label: Record<string, string> = { active: "Active", cancelled: "Cancelled", past_due: "Past Due", inactive: "No subscription" };
    return <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium border", map[status] ?? map.inactive)}>{label[status] ?? status}</span>;
  };

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[60vh]">
        <div className="w-8 h-8 border-2 border-black border-t-gold rounded-full animate-spin" />
      </div>
    );
  }

  const isStarter = !billing || billing.plan === "starter";
  const isExpired = billing?.subscriptionStatus === "cancelled" || billing?.subscriptionStatus === "past_due";
  const currentPlanId = billing?.plan ?? "starter";
  const currentPlanName = PLAN_LABEL[currentPlanId] ?? plans.find(p => p.id === currentPlanId)?.name ?? currentPlanId;
  // Every active PAID plan the owner can move to (all tiers except their current
  // one) — driven by the admin-editable plans table, so any middle tier shows.
  const otherPaidPlans = plans.filter(p => p.is_active && p.price_cents > 0 && p.id !== currentPlanId);

  return (
    <div className="p-6 space-y-6 max-w-3xl">
      {toast && <Toast message={toast} onClose={() => setToast("")} />}

      <div>
        <h1 className="text-2xl font-bold text-white uppercase tracking-wide">Billing</h1>
        <p className="text-sm text-[#777] mt-0.5">Manage your subscription and payouts</p>
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
            <div className={cn("w-12 h-12 rounded-xl flex items-center justify-center", isStarter ? "bg-[#141414]" : "bg-black/10")}>
              <Crown size={22} className={isStarter ? "text-[#777]" : "text-white"} />
            </div>
            <div>
              <p className="text-lg font-bold text-white">{currentPlanName}</p>
              {billing?.amount != null && <p className="text-sm text-[#777]">${billing.amount}/month</p>}
            </div>
          </div>

          {!isStarter && (billing?.nextBilling || billing?.cardLast4 ? (
            <div className="grid grid-cols-2 gap-3 mb-5">
              <div className="p-3 bg-[#141414] rounded-xl border border-[#1e1e1e]">
                <p className="text-xs text-[#777]">Next billing date</p>
                <p className="text-sm text-white mt-0.5">{billing.nextBilling ? new Date(billing.nextBilling).toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric" }) : "—"}</p>
              </div>
              <div className="p-3 bg-[#141414] rounded-xl border border-[#1e1e1e]">
                <p className="text-xs text-[#777]">Payment method</p>
                <p className="text-sm text-white mt-0.5 flex items-center gap-1.5"><CreditCard size={13} className="text-[#777]" /> {billing.cardLast4 ? `•••• ${billing.cardLast4}` : "—"}</p>
              </div>
            </div>
          ) : (
            <div className="p-3 bg-[#141414] rounded-xl border border-[#1e1e1e] mb-5 text-center">
              <p className="text-xs text-[#777]">Syncing subscription details from Stripe…</p>
              <p className="text-xs text-[#777] mt-0.5">Refresh in a moment, or check your email for the receipt.</p>
            </div>
          ))}

          {otherPaidPlans.length > 0 && (
            <div className="space-y-3 mb-4">
              <p className="text-xs font-medium text-[#777] uppercase tracking-wider">{isStarter || isExpired ? "Choose a plan" : "Switch plan"}</p>
              {otherPaidPlans.map(p => (
                <div key={p.id} className="p-4 bg-[#141414] rounded-xl border border-[#1e1e1e] space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-white truncate">{p.name}{p.badge ? <span className="text-gold text-xs font-normal"> · {p.badge}</span> : null}</p>
                      <p className="text-xs text-[#777]">
                        <span className="text-white font-semibold">{formatPlanPrice(p.price_cents)}</span>/month
                        {p.barber_limit != null ? ` · up to ${p.barber_limit} barber${p.barber_limit === 1 ? "" : "s"}` : " · unlimited barbers"}
                      </p>
                    </div>
                    <Button size="sm" loading={actionLoading === p.id} onClick={() => startCheckoutUpgrade(p.id)}>
                      <ArrowUpRight size={14} /> {isStarter || isExpired ? "Choose" : "Switch"}
                    </Button>
                  </div>
                  {p.highlights && p.highlights.length > 0 && (
                    <ul className="space-y-1">
                      {p.highlights.slice(0, 6).map(h => (
                        <li key={h} className="flex items-start gap-2 text-xs text-gray-300">
                          <Check size={13} className="text-emerald-400 flex-shrink-0 mt-0.5" /> {h}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
              <p className="text-[11px] text-[#777] leading-relaxed">
                Billed monthly in CAD · secure checkout by Stripe. Your plan renews automatically each month.
                You can cancel or update your card anytime via <span className="text-gray-300">Manage subscription</span> — cancelling stops future charges and keeps your plan active until the end of the billing period (no refund for the unused days), then reverts to the free Starter plan. No contracts, no hidden fees.
              </p>
            </div>
          )}
          {!isStarter && (
            <Button variant="outline" loading={actionLoading === "portal"} onClick={openPortal}>
              <CreditCard size={15} /> Manage subscription
            </Button>
          )}
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
            <div className="w-10 h-10 rounded-xl bg-[#141414] flex items-center justify-center">
              <Building2 size={18} className="text-white" />
            </div>
            <p className="text-sm text-[#777]">
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
                <div key={inv.id} className="flex items-center justify-between p-3 bg-[#141414] rounded-xl border border-[#1e1e1e]">
                  <div>
                    <p className="text-sm text-white">{inv.id}</p>
                    <p className="text-xs text-[#777]">{new Date(inv.date * 1000).toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric" })}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-medium text-white">${inv.amount.toFixed(2)}</span>
                    <span className={cn("text-xs px-2 py-0.5 rounded-full", inv.status === "paid" ? "text-emerald-400 bg-emerald-500/10" : "text-[#777] bg-gray-500/10")}>{inv.status}</span>
                    {inv.url && <a href={inv.url} target="_blank" rel="noopener noreferrer" className="text-[#777] hover:text-white"><ExternalLink size={14} /></a>}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

    </div>
  );
}
