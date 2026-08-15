"use client";
import { useState, useEffect, useCallback } from "react";
import { CreditCard, Check, AlertTriangle, ExternalLink, Crown, Building2, ArrowUpRight, ArrowDownRight } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { formatPlanPrice } from "@/lib/plans";
import { marketingFor } from "@/lib/plan-marketing";
import { effectivePlan } from "@/lib/validation";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";

function Toast({ message, onClose }: { message: string; onClose: () => void }) {
  return (
    <div className="fixed bottom-6 right-6 z-[100] bg-card-raised border border-border rounded-xl px-5 py-3 text-sm text-foreground shadow-xl flex items-center gap-3">
      <span className="text-foreground">✓</span>{message}
      <button onClick={onClose} className="text-grey hover:text-foreground ml-2">✕</button>
    </div>
  );
}

interface Billing {
  plan: string;
  subscriptionStatus: string;
  nextBilling: string | null;
  amount: number | null;
  cardLast4: string | null;
  cardBrand?: string | null;
  cancelAtPeriodEnd?: boolean;
  invoices: { id: string; amount: number; date: number; status: string; url: string | null }[];
  connect: { connected: boolean; status: string; chargesEnabled?: boolean; payoutsEnabled?: boolean; detailsSubmitted?: boolean; checkError?: boolean };
}

const PLAN_LABEL: Record<string, string> = { starter: "Starter (Free)", pro: "Pro", premium: "Premium" };

// Matches TRIAL_DAYS in /api/shops/create — the no-card trial length. Used only
// to show "Day X of 21" + the progress bar; the real expiry is trial_ends_at.
const TRIAL_DAYS = 21;

export default function BillingPage() {
  const { accessToken, refreshShop, plans, shop, shops } = useAuth();
  const [billing, setBilling] = useState<Billing | null>(null);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState("");
  const [actionLoading, setActionLoading] = useState("");
  const [showCancel, setShowCancel] = useState(false);
  const [couponCode, setCouponCode] = useState("");

  const showToast = (m: string) => { setToast(m); setTimeout(() => setToast(""), 3000); };

  const load = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    // Scope to the ACTIVE shop. Without this, a multi-location owner saw the
    // NEWEST shop's plan + Connect status (the API's fallback), not the location
    // they're viewing — which is exactly why a fully-connected shop wrongly read
    // "Not connected" (Billing was showing a different, un-connected location).
    const url = shop?.id ? `/api/stripe/billing?shop_id=${encodeURIComponent(shop.id)}` : "/api/stripe/billing";
    const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (res.ok) setBilling(await res.json());
    setLoading(false);
  }, [accessToken, shop?.id]);

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

  // Returned from Stripe's card-update page → re-read the live card and confirm
  // it was accepted + when it'll next be charged.
  useEffect(() => {
    if (!accessToken) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("card_updated") !== "1") return;
    window.history.replaceState({}, "", "/dashboard/billing");
    (async () => {
      const res = await fetch(`/api/stripe/billing${shop?.id ? `?shop_id=${encodeURIComponent(shop.id)}` : ""}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      }).catch(() => null);
      const data = res && res.ok ? await res.json().catch(() => null) : null;
      if (data) setBilling(data);
      const label = cardLabel(data?.cardLast4, data?.cardBrand);
      const when = data?.nextBilling ? ` It'll be charged on ${fmtDate(data.nextBilling)}.` : "";
      showToast(label
        ? `Card accepted — ${label} is now on file.${when}`
        : `Card accepted.${when}`);
      // Email the owner a confirmation of the card change (best-effort, server-side).
      fetch("/api/stripe/notify-card-updated", {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      }).catch(() => null);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken, shop?.id]);

  const startCheckoutUpgrade = async (planId: string) => {
    if (!accessToken) return;
    setActionLoading(planId);
    // First try an in-place switch on the existing subscription (proration —
    // credit for unused days, no card re-entry, no duplicate subscription). The
    // server returns 409 if there's no live subscription, and we fall back to
    // Checkout to collect a card.
    const pr = await fetch("/api/stripe/change-plan", {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ plan: planId }),
    }).catch(() => null);
    const prData = pr ? await pr.json().catch(() => ({})) : {};
    if (pr?.ok && prData.ok) {
      showToast("Plan updated — the difference is prorated on your next invoice.");
      await refreshShop?.();
      await load();
      setActionLoading("");
      return;
    }
    if (pr && pr.status === 409) {
      // No live subscription yet → collect a card via Checkout.
      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ plan: planId, upgrade: true }),
      });
      const data = await res.json();
      if (res.ok && data.url) window.location.href = data.url;
      else { showToast(data.error ?? "Could not start upgrade"); setActionLoading(""); }
      return;
    }
    showToast(prData.error ?? "Could not change plan");
    setActionLoading("");
  };

  // Start the no-card 21-day trial (no checkout / no card up front). Only offered
  // to a Starter shop that hasn't trialed before; the daily cron reverts it to
  // Starter if no card is added before it ends.
  const startTrial = async (planId: string) => {
    if (!accessToken) return;
    setActionLoading(planId);
    const res = await fetch("/api/shops/start-trial", {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ plan: planId, shop_id: shop?.id }),
    }).catch(() => null);
    const data = res ? await res.json().catch(() => ({})) : {};
    if (res && res.ok) {
      await refreshShop();
      await load();
      showToast("Your 21-day free trial is on — no card needed. Add a card anytime to keep it.");
    } else {
      showToast((data as { error?: string }).error ?? "Couldn't start your trial. Please try again.");
    }
    setActionLoading("");
  };

  const completeConnect = async () => {
    if (!accessToken) return;
    setActionLoading("connect");
    const res = await fetch("/api/stripe/connect", {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      // Connect the SHOP being viewed (multi-location owners have one account per
      // location), not just the newest shop.
      body: JSON.stringify({ shop_id: shop?.id }),
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

  // Open the Stripe Express dashboard (payouts, balance, transfers) via a
  // one-time login link — no separate Stripe login needed.
  const openDashboard = async () => {
    if (!accessToken) return;
    setActionLoading("dashboard");
    const res = await fetch("/api/stripe/dashboard-link", {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ shop_id: shop?.id }),
    }).catch(() => null);
    const data = res ? await res.json().catch(() => ({})) : {};
    if (res && res.ok && (data as { url?: string }).url) window.location.href = (data as { url: string }).url;
    else { showToast((data as { error?: string }).error ?? "Couldn't open the Stripe dashboard"); setActionLoading(""); }
  };

  // Cancel / downgrade to Free. immediate=false keeps access until the paid
  // period (or trial) ends; immediate=true drops to Starter right now.
  const cancelPlan = async (immediate: boolean) => {
    if (!accessToken) return;
    setActionLoading("cancel");
    const res = await fetch("/api/stripe/cancel-subscription", {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ immediate, shop_id: shop?.id }),
    }).catch(() => null);
    const data = res ? await res.json().catch(() => ({})) : {};
    setShowCancel(false);
    if (res && res.ok) {
      await refreshShop();
      await load();
      if (data.immediate) showToast("You're back on the free Starter plan.");
      else if (data.scheduled) showToast("Cancelled — you'll keep your plan until it ends, then move to free.");
      else showToast("Got it — you'll keep your plan until your trial ends, then it's free.");
    } else {
      showToast((data as { error?: string }).error ?? "Couldn't cancel — please try again.");
    }
    setActionLoading("");
  };

  // Undo a scheduled cancel before the period ends.
  const resumePlan = async () => {
    if (!accessToken) return;
    setActionLoading("resume");
    const res = await fetch("/api/stripe/resume-subscription", {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ shop_id: shop?.id }),
    }).catch(() => null);
    const data = res ? await res.json().catch(() => ({})) : {};
    if (res && res.ok) { await load(); showToast("Your plan will keep renewing — cancellation undone."); }
    else showToast((data as { error?: string }).error ?? "Couldn't resume — please try again.");
    setActionLoading("");
  };

  const fmtDate = (iso: string | null | undefined) =>
    iso ? new Date(iso).toLocaleDateString("en-CA", { month: "long", day: "numeric", year: "numeric" }) : "the end of your period";

  // "Visa •••• 4242" from the brand + last4 (brand comes lowercase from Stripe).
  const cardLabel = (last4?: string | null, brand?: string | null) => {
    if (!last4) return null;
    const b = brand ? brand.replace(/^(\w)/, c => c.toUpperCase()).replace(/^Amex$/i, "Amex") : "Card";
    return `${b} •••• ${last4}`;
  };

  // Redeem an admin comp coupon → free Pro/Premium days (no card).
  const redeemCoupon = async () => {
    if (!accessToken || !couponCode.trim()) return;
    setActionLoading("coupon");
    const res = await fetch("/api/coupons/redeem", {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ code: couponCode.trim(), shop_id: shop?.id }),
    }).catch(() => null);
    const data = res ? await res.json().catch(() => ({})) : {};
    if (res && res.ok) {
      setCouponCode("");
      await refreshShop();
      await load();
      showToast(`🎁 Gift applied — ${data.days} days of ${data.plan} unlocked!`);
    } else {
      showToast((data as { error?: string }).error ?? "Couldn't apply that coupon.");
    }
    setActionLoading("");
  };

  const statusBadge = (status: string) => {
    const map: Record<string, string> = {
      active: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
      cancelled: "bg-red-500/15 text-red-400 border-red-500/30",
      past_due: "bg-orange-500/15 text-orange-400 border-orange-500/30",
      inactive: "bg-gray-500/15 text-grey border-gray-500/30",
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

  // On a no-card trial: subscription_status is "active" but there's no Stripe
  // subscription yet (trial_ends_at set). The page offers "add card to keep your
  // CURRENT plan" — otherwise a Pro-trial owner has no way to stay on Pro.
  const isTrial = !!shop?.trial_ends_at && !shop?.stripe_subscription_id;
  const trialDaysLeft = isTrial
    ? Math.max(0, Math.ceil((new Date(shop!.trial_ends_at as string).getTime() - Date.now()) / 86_400_000))
    : 0;

  // currentPlanId = the plan on RECORD (what checkout/loading target uses).
  const currentPlanId = billing?.plan ?? shop?.subscription_plan ?? "starter";
  // activePlan = what they're ENTITLED to right now — the SAME gate the rest of
  // the app uses (effectivePlan). A lapsed/cancelled/past-due paid plan resolves
  // to "starter" here, so Billing agrees with what features are actually unlocked.
  // Without this, an expired-TRIAL shop (plan still "pro", status "inactive") was
  // shown as "Pro" with no way to restart Pro and a dead "Manage subscription"
  // button — while every feature was already locked to Starter.
  const activePlan = effectivePlan(currentPlanId, billing?.subscriptionStatus);
  const onFreePlan = activePlan === "starter";              // effectively Starter (fresh OR lapsed)
  const isLapsed = onFreePlan && currentPlanId !== "starter" && !isTrial; // had a paid plan that lapsed
  // Eligible for the no-card 21-day trial: on Starter, never trialed before, and
  // no live subscription. Lets them upgrade WITHOUT a card up front (server
  // enforces the same — one free trial ever).
  const trialEligible = onFreePlan && !shop?.trial_ends_at && !shop?.stripe_subscription_id;
  // Show the plan they're effectively on (a lapsed Pro reads as Starter, not Pro).
  const displayPlanId = onFreePlan ? "starter" : currentPlanId;
  const displayPlan = plans.find(p => p.id === displayPlanId);
  const currentPlanName = PLAN_LABEL[displayPlanId] ?? displayPlan?.name ?? displayPlanId;
  // Feature bullets come from the shared marketing list (the same one the home
  // page + signup use — ONE source of truth for wording), falling back to the
  // admin-editable DB highlights for any custom plan not in that list. This
  // account screen stays "what's included" only (green) — the honest "what you
  // don't get" ✕ list lives on the fresh-choice screens (home + signup).
  const bulletsFor = (id: string, fallback?: string[] | null) => marketingFor(id)?.yes ?? fallback ?? [];
  // What the effective plan includes — so the card says what they're really on.
  // Starter has no highlights row in the plans table; fall back to a baseline.
  const currentHighlights = bulletsFor(
    displayPlanId,
    (displayPlan?.highlights && displayPlan.highlights.length > 0)
      ? displayPlan.highlights
      : (displayPlanId === "starter" ? ["Online booking page", "Appointment calendar", "Up to 1 barber"] : []),
  );
  // Paid plans to offer. When effectively on Starter (fresh OR lapsed) show ALL
  // paid tiers so they can (re)start any — including the plan they just lapsed
  // from. When on an active paid plan, exclude the current one (up/downgrade only).
  const otherPaidPlans = plans.filter(p => p.is_active && p.price_cents > 0 && (onFreePlan || p.id !== currentPlanId));
  // Current plan price → so each option reads "Upgrade" (higher) or "Downgrade"
  // (lower) rather than a vague "Switch". On free = fresh "Choose".
  const currentPrice = onFreePlan ? 0 : (plans.find(p => p.id === currentPlanId)?.price_cents ?? 0);

  return (
    <div className="p-6 space-y-6 max-w-3xl">
      {toast && <Toast message={toast} onClose={() => setToast("")} />}

      <div>
        <h1 className="text-2xl font-bold text-foreground uppercase tracking-wide">Billing</h1>
        <p className="text-sm text-grey mt-0.5">Manage your subscription and payouts</p>
      </div>

      {isLapsed && (
        <div className="flex items-start gap-3 bg-orange-500/10 border border-orange-500/30 rounded-2xl p-4">
          <AlertTriangle size={18} className="text-orange-400 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-orange-300">
            {billing?.subscriptionStatus === "past_due"
              ? "Your last payment didn't go through, so your shop is on the free Starter plan and paid features are locked."
              : "Your free trial ended, so your shop is on the free Starter plan and paid features are locked."}{" "}
            Choose a plan below to switch them back on — your data and settings are all still here.
          </p>
        </div>
      )}

      {isTrial && (
        <div className="flex items-start gap-3 bg-sky-500/10 border border-sky-500/30 rounded-2xl p-4">
          <AlertTriangle size={18} className="text-sky-400 flex-shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-sky-300">You&apos;re on a {currentPlanName} free trial — {trialDaysLeft} day{trialDaysLeft === 1 ? "" : "s"} left</p>
            {/* Slim progress bar so the 21-day window reads at a glance. */}
            <div className="mt-2 mb-1.5">
              <div className="h-1.5 rounded-full bg-sky-500/20 overflow-hidden">
                <div className="h-full rounded-full bg-sky-400 transition-all"
                  style={{ width: `${Math.min(100, Math.max(4, ((TRIAL_DAYS - trialDaysLeft) / TRIAL_DAYS) * 100))}%` }} />
              </div>
              <p className="text-[11px] text-sky-200/70 mt-1">Day {Math.min(TRIAL_DAYS, TRIAL_DAYS - trialDaysLeft + 1)} of your {TRIAL_DAYS}-day free trial</p>
            </div>
            <p className="text-xs text-sky-200/80 mt-0.5">Add a card to keep {currentPlanName} after your trial ends. {trialDaysLeft >= 2 ? `Your card isn't charged until your trial ends — you keep all ${trialDaysLeft} remaining free days` : "Your card is charged when your trial ends"}; cancel anytime. If you do nothing, your shop drops to the free Starter plan.</p>
            <Button size="sm" className="mt-2" loading={actionLoading === currentPlanId} onClick={() => startCheckoutUpgrade(currentPlanId)}>
              <CreditCard size={14} /> Add card &amp; keep {currentPlanName}
            </Button>
          </div>
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
            <div className={cn("w-12 h-12 rounded-xl flex items-center justify-center", onFreePlan ? "bg-card-raised" : "bg-black/10")}>
              <Crown size={22} className={onFreePlan ? "text-grey" : "text-foreground"} />
            </div>
            <div>
              <p className="text-lg font-bold text-foreground">{currentPlanName}</p>
              {billing?.amount != null && <p className="text-sm text-grey">${billing.amount}/month</p>}
            </div>
          </div>

          {/* What the owner's CURRENT plan includes — so the card says what they're
              on, not just its name. Kept compact (max 6). */}
          {currentHighlights.length > 0 && (
            <div className="mb-5">
              <p className="text-xs font-medium text-grey uppercase tracking-wider mb-2">What&apos;s included</p>
              <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5">
                {currentHighlights.slice(0, 6).map(h => (
                  <li key={h} className="flex items-start gap-2 text-xs text-gray-300">
                    <Check size={13} className="text-emerald-400 flex-shrink-0 mt-0.5" /> {h}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {!onFreePlan && (billing?.nextBilling || billing?.cardLast4 ? (
            <div className="grid grid-cols-2 gap-3 mb-5">
              <div className="p-3 bg-card-raised rounded-xl border border-border">
                <p className="text-xs text-grey">Next billing date</p>
                <p className="text-sm text-foreground mt-0.5">{billing.nextBilling ? new Date(billing.nextBilling).toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric" }) : "—"}</p>
              </div>
              <div className="p-3 bg-card-raised rounded-xl border border-border">
                <p className="text-xs text-grey">Payment method</p>
                <p className={cn("text-sm mt-0.5 flex items-center gap-1.5", billing.cardLast4 ? "text-foreground" : "text-grey")}>
                  <CreditCard size={13} className="text-grey flex-shrink-0" />
                  {cardLabel(billing.cardLast4, billing.cardBrand) ?? "No card yet"}
                </p>
              </div>
            </div>
          ) : isTrial ? (
            <div className="p-3 bg-card-raised rounded-xl border border-border mb-5 text-center">
              <p className="text-xs text-grey">Free trial — no card on file yet.</p>
              <p className="text-xs text-grey mt-0.5">Add a card above to continue on {currentPlanName} after your trial.</p>
            </div>
          ) : (
            <div className="p-3 bg-card-raised rounded-xl border border-border mb-5 text-center">
              <p className="text-xs text-grey">Syncing subscription details from Stripe…</p>
              <p className="text-xs text-grey mt-0.5">Refresh in a moment, or check your email for the receipt.</p>
            </div>
          ))}

          {/* Cancel / downgrade — right under the CURRENT plan (not buried at the
              bottom). Paid/trial only; Starter has nothing to cancel. */}
          {!onFreePlan && billing?.cancelAtPeriodEnd ? (
            <div className="mb-5 flex items-start gap-3 bg-amber-500/10 border border-amber-500/25 rounded-xl p-3">
              <AlertTriangle size={16} className="text-amber-400 flex-shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="text-sm text-amber-200">Your plan ends on <span className="font-semibold text-amber-100">{fmtDate(billing?.nextBilling)}</span>, then switches to the free Starter plan. No more charges.</p>
                <button onClick={resumePlan} disabled={actionLoading === "resume"} className="text-xs font-semibold text-amber-300 hover:text-amber-200 mt-1.5 disabled:opacity-60">
                  {actionLoading === "resume" ? "Resuming…" : "Resume plan"}
                </button>
              </div>
            </div>
          ) : !onFreePlan ? (
            <div className="mb-5">
              <Button variant="danger" size="sm" onClick={() => setShowCancel(true)}>
                {isTrial ? "Cancel trial · switch to free" : "Cancel plan · switch to free"}
              </Button>
            </div>
          ) : null}

          {otherPaidPlans.length > 0 && (
            <div className="space-y-3 mb-4">
              <p className="text-xs font-medium text-grey uppercase tracking-wider">{onFreePlan ? "Choose a plan" : "Change plan"}</p>
              {otherPaidPlans.map(p => (
                <div key={p.id} className="p-4 bg-card-raised rounded-xl border border-border space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-foreground truncate">{p.name}{p.badge ? <span className="text-gold text-xs font-normal"> · {p.badge}</span> : null}</p>
                      <p className="text-xs text-grey">
                        <span className="text-foreground font-semibold">{formatPlanPrice(p.price_cents)}</span>/month
                        {p.barber_limit != null ? ` · up to ${p.barber_limit} barber${p.barber_limit === 1 ? "" : "s"}` : " · unlimited barbers"}
                      </p>
                      {trialEligible && <p className="text-[11px] font-semibold text-emerald-400 mt-1">21-day free trial · no card</p>}
                    </div>
                    {trialEligible ? (
                      <Button size="sm" variant="primary" loading={actionLoading === p.id} onClick={() => startTrial(p.id)}>
                        <ArrowUpRight size={14} /> Start free trial
                      </Button>
                    ) : (
                      <Button size="sm" variant={!onFreePlan && p.price_cents < currentPrice ? "outline" : "primary"} loading={actionLoading === p.id} onClick={() => startCheckoutUpgrade(p.id)}>
                        {onFreePlan
                          ? <><ArrowUpRight size={14} /> Choose</>
                          : p.price_cents < currentPrice
                            ? <><ArrowDownRight size={14} /> Downgrade</>
                            : <><ArrowUpRight size={14} /> Upgrade</>}
                      </Button>
                    )}
                  </div>
                  {bulletsFor(p.id, p.highlights).length > 0 && (
                    <ul className="space-y-1">
                      {bulletsFor(p.id, p.highlights).slice(0, 6).map(h => (
                        <li key={h} className="flex items-start gap-2 text-xs text-gray-300">
                          <Check size={13} className="text-emerald-400 flex-shrink-0 mt-0.5" /> {h}
                        </li>
                      ))}
                    </ul>
                  )}
                  {trialEligible && (
                    <button type="button" onClick={() => startCheckoutUpgrade(p.id)} className="text-[11px] text-grey hover:text-foreground transition-colors">
                      or subscribe now with a card
                    </button>
                  )}
                </div>
              ))}
              <p className="text-[11px] text-grey leading-relaxed">
                Billed monthly in CAD · secure checkout by Stripe. Your plan renews automatically each month.
                Cancel or switch plans anytime with the buttons here — cancelling stops future charges and keeps your plan active until the end of the billing period (no refund for the unused days), then reverts to the free Starter plan. No contracts, no hidden fees.
              </p>
            </div>
          )}
          {!onFreePlan && !isTrial && (
            <div>
              {billing?.cardLast4 && (
                <p className="text-xs text-grey mb-2">Card on file <span className="text-foreground font-medium">{cardLabel(billing.cardLast4, billing.cardBrand)}</span></p>
              )}
              <Button variant="outline" loading={actionLoading === "portal"} onClick={openPortal}>
                <CreditCard size={15} /> Update card
              </Button>
              <p className="text-[11px] text-grey mt-1.5">Opens Stripe&apos;s secure card page — number, expiry, CVC &amp; postal. Stripe checks it&apos;s valid, then brings you right back with a confirmation and when it&apos;ll next be charged. Invoices are listed below; cancel or switch plans with the buttons above.</p>
            </div>
          )}

          {/* Redeem a comp coupon → free Pro/Premium days. Shown to free/trial
              shops (a paid card sub can't use it — the server says so). */}
          {(onFreePlan || isTrial) && (
            <div className="mt-4 pt-4 border-t border-border">
              <p className="text-xs font-medium text-grey uppercase tracking-wider mb-2">Have a gift code?</p>
              <div className="flex gap-2">
                <input
                  value={couponCode}
                  onChange={e => setCouponCode(e.target.value.toUpperCase().slice(0, 40))}
                  onKeyDown={e => { if (e.key === "Enter") redeemCoupon(); }}
                  placeholder="Enter your code"
                  className="flex-1 bg-card-raised border border-border rounded-xl px-3 py-2 text-sm text-foreground placeholder:text-grey focus:outline-none focus:border-gold/50 font-mono"
                />
                <Button size="sm" loading={actionLoading === "coupon"} disabled={!couponCode.trim()} onClick={redeemCoupon}>Redeem</Button>
              </div>
              <p className="text-[11px] text-grey mt-1.5">Enter your ClipWise gift code to unlock Pro or Premium.</p>
            </div>
          )}

        </CardContent>
      </Card>

      {/* Connect / payouts card */}
      <Card>
        <CardHeader>
          <CardTitle>
            Payouts (Stripe Connect)
            {shops && shops.length > 1 && shop?.name && (
              <span className="block text-xs font-normal text-grey mt-0.5">Location: {shop.name} · each location connects its own bank</span>
            )}
          </CardTitle>
          {/* No "Not connected" warning on Starter — online payments aren't part of
              that plan, so there's nothing for them to set up. */}
          {onFreePlan ? null : (() => {
            const c = billing?.connect;
            const pill = "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium border";
            if (c?.connected) return <span className={`${pill} bg-emerald-500/15 text-emerald-400 border-emerald-500/30`}><Check size={11} /> Connected</span>;
            if (c?.checkError) return <span className={`${pill} bg-white/5 text-grey border-border`}><AlertTriangle size={11} /> Status unavailable</span>;
            if (c?.chargesEnabled || c?.detailsSubmitted) return <span className={`${pill} bg-amber-500/15 text-amber-400 border-amber-500/30`}><AlertTriangle size={11} /> Finishing setup</span>;
            return <span className={`${pill} bg-orange-500/15 text-orange-400 border-orange-500/30`}><AlertTriangle size={11} /> Not connected</span>;
          })()}
        </CardHeader>
        <CardContent>
          {onFreePlan ? (
            // Starter is cash-only — don't offer Stripe setup (connecting would do
            // nothing since online payments are locked). Point them to upgrade.
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-card-raised flex items-center justify-center flex-shrink-0">
                <Building2 size={18} className="text-foreground" />
              </div>
              <div>
                <p className="text-sm text-grey">Taking card payments online is a <span className="text-foreground font-medium">Pro &amp; Premium</span> feature. Your shop is on Starter, so bookings are cash / in-person only.</p>
                <p className="text-xs text-gold mt-1">Choose a plan above to connect your bank and accept cards.</p>
              </div>
            </div>
          ) : (() => {
            const c = billing?.connect;
            const fully = !!c?.connected;
            const partial = !fully && !c?.checkError && (c?.chargesEnabled || c?.detailsSubmitted);
            return (
              <>
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 rounded-xl bg-card-raised flex items-center justify-center flex-shrink-0">
                    <Building2 size={18} className="text-foreground" />
                  </div>
                  <p className="text-sm text-grey">
                    {fully
                      ? "Your bank account is connected. Customer payments are deposited directly to you."
                      : c?.checkError
                        ? "We couldn't reach Stripe to check your status just now — refresh in a moment. If you've finished setup, it'll show as connected once Stripe responds."
                        : partial
                          ? (c?.chargesEnabled && !c?.payoutsEnabled
                              ? "You're set up to take card payments, but Stripe is still verifying your bank before it can send payouts. Finish the last step on Stripe."
                              : "Stripe is still verifying your details. Finish the remaining steps to start receiving payments.")
                          : "Connect your bank account to receive customer payments directly via Stripe."}
                  </p>
                </div>
                {fully ? (
                  <Button variant="outline" loading={actionLoading === "dashboard"} onClick={openDashboard}>
                    <Building2 size={15} /> View payouts on Stripe
                  </Button>
                ) : c?.checkError ? (
                  <Button variant="outline" loading={loading} onClick={load}>
                    <AlertTriangle size={15} /> Retry
                  </Button>
                ) : (
                  <Button loading={actionLoading === "connect"} onClick={completeConnect}>
                    <Building2 size={15} /> {partial ? "Finish on Stripe" : "Complete Setup"}
                  </Button>
                )}
              </>
            );
          })()}
        </CardContent>
      </Card>

      {/* Invoice history */}
      {billing && billing.invoices.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Invoice History</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-2">
              {billing.invoices.map(inv => (
                <div key={inv.id} className="flex items-center justify-between p-3 bg-card-raised rounded-xl border border-border">
                  <div>
                    <p className="text-sm text-foreground">{inv.id}</p>
                    <p className="text-xs text-grey">{new Date(inv.date * 1000).toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric" })}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-medium text-foreground">${inv.amount.toFixed(2)}</span>
                    <span className={cn("text-xs px-2 py-0.5 rounded-full", inv.status === "paid" ? "text-emerald-400 bg-emerald-500/10" : "text-grey bg-gray-500/10")}>{inv.status}</span>
                    {inv.url && <a href={inv.url} target="_blank" rel="noopener noreferrer" className="text-grey hover:text-foreground"><ExternalLink size={14} /></a>}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Cancel / downgrade-to-free confirmation */}
      {showCancel && (
        <>
          <div className="fixed inset-0 bg-black/70 z-40" onClick={() => setShowCancel(false)} />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="bg-card border border-border rounded-2xl p-6 w-full max-w-md space-y-4">
              <h2 className="text-lg font-bold text-foreground">{isTrial ? "Switch to the free plan?" : `Cancel ${currentPlanName}?`}</h2>
              {isTrial ? (
                <p className="text-sm text-grey">
                  You&apos;re on a free trial{trialDaysLeft ? ` (${trialDaysLeft} day${trialDaysLeft === 1 ? "" : "s"} left)` : ""} — you won&apos;t be charged either way. You can keep {currentPlanName} until{" "}
                  <span className="text-foreground font-medium">{fmtDate(shop?.trial_ends_at as string | null)}</span>, then it becomes the free Starter plan automatically. Or switch to free right now.
                </p>
              ) : (
                <p className="text-sm text-grey">
                  You&apos;ll keep {currentPlanName} until{" "}
                  <span className="text-foreground font-medium">{fmtDate(billing?.nextBilling)}</span> — then you move to the free Starter plan. No more charges, and no refund for the unused days.
                </p>
              )}
              {shops && shops.length > 1 && (
                <p className="text-xs text-amber-500/90 bg-amber-500/10 border border-amber-500/25 rounded-lg px-3 py-2">
                  Heads up: your locations share one subscription, so this applies to <span className="font-semibold">all {shops.length} of your locations</span>.
                </p>
              )}
              <div className="flex flex-col gap-2 pt-1">
                {isTrial ? (
                  <>
                    <Button variant="danger" loading={actionLoading === "cancel"} onClick={() => cancelPlan(true)}>Switch to free now</Button>
                    <Button variant="outline" onClick={() => setShowCancel(false)}>Keep my trial</Button>
                  </>
                ) : (
                  <>
                    <Button variant="danger" loading={actionLoading === "cancel"} onClick={() => cancelPlan(false)}>Cancel — end on {fmtDate(billing?.nextBilling)}</Button>
                    <Button variant="outline" onClick={() => setShowCancel(false)}>Keep {currentPlanName}</Button>
                  </>
                )}
              </div>
            </div>
          </div>
        </>
      )}

    </div>
  );
}
