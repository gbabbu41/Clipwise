"use client";
import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Check, Zap, Crown, ArrowRight, AlertCircle } from "lucide-react";
import { Logo } from "@/components/ui/logo";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth-context";

type Plan = "starter" | "pro" | "premium";

const PLANS = [
  {
    id: "starter" as Plan,
    name: "Starter",
    price: "Free",
    sub: "forever",
    icon: Zap,
    accent: "border-gray-700 hover:border-gray-500",
    badge: null,
    features: [
      "1 barber",
      "Online booking page",
      "Appointment management",
      "SMS reminders",
      "Basic analytics",
    ],
    limits: [
      "No customer payments",
      "No POS",
      "Manual approval by admin",
    ],
    cta: "Get Started Free",
  },
  {
    id: "pro" as Plan,
    name: "Pro",
    price: "$23",
    sub: "/month",
    icon: Crown,
    accent: "border-gold/50 hover:border-gold ring-1 ring-gold/20",
    badge: "Most Popular",
    features: [
      "Up to 4 barbers",
      "Online booking + customer payments",
      "Advanced analytics",
      "SMS reminders",
      "Stripe Connect for payouts",
      "Instant approval",
    ],
    limits: [],
    cta: "Start with Pro",
  },
  {
    id: "premium" as Plan,
    name: "Premium",
    price: "$49",
    sub: "/month",
    icon: Crown,
    accent: "border-purple-500/50 hover:border-purple-400",
    badge: "Full Suite",
    features: [
      "Up to 9 barbers",
      "Everything in Pro",
      "Full POS via Stripe Terminal",
      "Inventory management",
      "Staff management",
      "Full analytics & reports",
      "Dedicated support",
      "Stripe Connect + Terminal ready",
      "Instant approval",
    ],
    limits: [],
    cta: "Start with Premium",
  },
];

function PlanPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { accessToken } = useAuth();
  const [step, setStep] = useState<"pick" | "redirecting" | "verifying" | "success">("pick");
  const [error, setError] = useState("");

  // Handle return from Stripe Checkout
  useEffect(() => {
    const status = searchParams.get("status");
    if (status === "cancelled") {
      setError("Payment cancelled. Choose a plan to continue.");
      router.replace("/onboarding/plan");
      return;
    }
    if (status === "success") {
      const sessionId = searchParams.get("session_id");
      const plan = searchParams.get("plan");
      if (!sessionId || !plan) return;
      setStep("verifying");
      fetch(`/api/stripe/verify-session?session_id=${sessionId}`)
        .then(r => r.json())
        .then(({ paid, subscriptionId, customerId }) => {
          if (paid) {
            sessionStorage.setItem("clipwise_plan", JSON.stringify({ plan, autoApprove: true, subscriptionId, customerId, sessionId }));
            setStep("success");
            setTimeout(() => router.push("/onboarding"), 1400);
          } else {
            setError("We couldn't confirm your payment. Please try again.");
            setStep("pick");
          }
        })
        .catch(() => { setError("Payment verification failed. Please try again."); setStep("pick"); });
    }
  }, [searchParams, router]);

  async function selectPlan(plan: Plan) {
    setError("");
    if (plan === "starter") {
      sessionStorage.setItem("clipwise_plan", JSON.stringify({ plan: "starter", autoApprove: false }));
      router.push("/onboarding");
      return;
    }
    if (!accessToken) { setError("Please sign in again to continue."); return; }
    setStep("redirecting");
    try {
      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ plan }),
      });
      const data = await res.json();
      if (!res.ok || !data.url) { setError(data.error ?? "Could not start checkout."); setStep("pick"); return; }
      window.location.href = data.url; // redirect to Stripe hosted checkout
    } catch {
      setError("Connection error. Please try again.");
      setStep("pick");
    }
  }

  if (step === "redirecting" || step === "verifying") {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <div className="w-10 h-10 border-2 border-gold/30 border-t-gold rounded-full animate-spin mx-auto mb-4" />
          <p className="font-semibold text-white">{step === "redirecting" ? "Taking you to secure checkout…" : "Confirming your payment…"}</p>
          <p className="text-[#777] text-sm mt-1">Powered by Stripe</p>
        </div>
      </div>
    );
  }

  if (step === "success") {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 rounded-full bg-green-500/15 border border-green-500/30 flex items-center justify-center mx-auto mb-4">
            <Check size={28} className="text-green-400" />
          </div>
          <h2 className="text-xl font-bold text-white mb-1">Payment successful!</h2>
          <p className="text-[#777] text-sm">Setting up your shop…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background px-4 py-12">
      <div className="max-w-5xl mx-auto">
        <div className="text-center mb-10">
          <Logo size="md" className="justify-center mb-6" />
          <h1 className="text-3xl font-bold text-white">Choose your plan</h1>
          <p className="text-[#777] mt-2">Start free, upgrade anytime. No hidden fees.</p>
        </div>

        {error && (
          <div className="max-w-md mx-auto mb-6 flex items-center gap-2 bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3">
            <AlertCircle size={16} className="text-red-400 flex-shrink-0" />
            <p className="text-sm text-red-400">{error}</p>
          </div>
        )}

        <div className="grid md:grid-cols-3 gap-6">
          {PLANS.map(plan => {
            const Icon = plan.icon;
            return (
              <div key={plan.id} className={cn("relative bg-surface border rounded-2xl p-6 flex flex-col transition-all cursor-pointer", plan.accent)}
                onClick={() => selectPlan(plan.id)}>
                {plan.badge && (
                  <div className={cn("absolute -top-3 left-1/2 -translate-x-1/2 text-xs font-bold px-3 py-1 rounded-full",
                    plan.id === "pro" ? "bg-gold text-black" : "bg-purple-500 text-white")}>
                    {plan.badge}
                  </div>
                )}

                <div className="mb-5">
                  <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center mb-4",
                    plan.id === "starter" ? "bg-surface-raised" : plan.id === "pro" ? "bg-gold/15" : "bg-purple-500/15")}>
                    <Icon size={20} className={plan.id === "starter" ? "text-[#777]" : plan.id === "pro" ? "text-gold" : "text-purple-400"} />
                  </div>
                  <h2 className="text-xl font-bold text-white">{plan.name}</h2>
                  <div className="flex items-baseline gap-1 mt-1">
                    <span className="text-3xl font-bold text-white">{plan.price}</span>
                    <span className="text-[#777] text-sm">{plan.sub}</span>
                  </div>
                </div>

                <ul className="space-y-2.5 flex-1 mb-6">
                  {plan.features.map(f => (
                    <li key={f} className="flex items-start gap-2.5 text-sm text-gray-300">
                      <Check size={15} className={cn("flex-shrink-0 mt-0.5", plan.id === "pro" ? "text-gold" : plan.id === "premium" ? "text-purple-400" : "text-emerald-400")} />
                      {f}
                    </li>
                  ))}
                  {plan.limits.map(l => (
                    <li key={l} className="flex items-start gap-2.5 text-sm text-[#777]">
                      <span className="flex-shrink-0 mt-0.5 w-[15px] text-center">—</span>
                      {l}
                    </li>
                  ))}
                </ul>

                <button className={cn("w-full py-3 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 transition-all",
                  plan.id === "starter" ? "bg-surface-raised text-white hover:bg-surface border border-border" :
                  plan.id === "pro" ? "bg-gold text-black hover:bg-gold/90" :
                  "bg-purple-500 text-white hover:bg-purple-600")}>
                  {plan.cta} <ArrowRight size={15} />
                </button>
              </div>
            );
          })}
        </div>

        <p className="text-center text-xs text-[#777] mt-8">
          Starter is free forever. Pro and Premium are billed monthly, no contracts. Secure checkout by Stripe.
        </p>
      </div>
    </div>
  );
}

export default function PlanPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-background" />}>
      <PlanPageInner />
    </Suspense>
  );
}
