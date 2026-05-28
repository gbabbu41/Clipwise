"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Lock, Zap, Crown, CreditCard, ArrowRight } from "lucide-react";
import { Logo } from "@/components/ui/logo";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

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

// Fake card number formatting
function formatCardNumber(val: string) {
  return val.replace(/\D/g, "").slice(0, 16).replace(/(.{4})/g, "$1 ").trim();
}
function formatExpiry(val: string) {
  const digits = val.replace(/\D/g, "").slice(0, 4);
  if (digits.length >= 3) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return digits;
}

export default function PlanPage() {
  const router = useRouter();
  const [selected, setSelected] = useState<Plan | null>(null);
  const [step, setStep] = useState<"pick" | "pay" | "success">("pick");
  const [card, setCard] = useState({ name: "", number: "", expiry: "", cvv: "" });
  const [processing, setProcessing] = useState(false);

  const chosenPlan = PLANS.find(p => p.id === selected);

  function selectPlan(plan: Plan) {
    setSelected(plan);
    if (plan === "starter") {
      sessionStorage.setItem("clipwise_plan", JSON.stringify({ plan: "starter", autoApprove: false }));
      router.push("/onboarding");
    } else {
      setStep("pay");
    }
  }

  async function handlePay(e: React.FormEvent) {
    e.preventDefault();
    setProcessing(true);
    // Simulate payment processing
    await new Promise(r => setTimeout(r, 2000));
    setProcessing(false);
    setStep("success");
    sessionStorage.setItem("clipwise_plan", JSON.stringify({ plan: selected, autoApprove: true }));
    await new Promise(r => setTimeout(r, 1500));
    router.push("/onboarding");
  }

  if (step === "pay" && chosenPlan) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center px-4 py-12">
        <div className="w-full max-w-md">
          <div className="text-center mb-8">
            <Logo size="md" className="justify-center mb-4" />
            <h1 className="text-2xl font-bold text-white">Complete your subscription</h1>
            <p className="text-gray-500 text-sm mt-1">{chosenPlan.name} — {chosenPlan.price}{chosenPlan.sub}</p>
          </div>

          {step === "success" as typeof step ? null : (
            <div className="bg-surface border border-border rounded-2xl p-6">
              <div className="flex items-center gap-3 mb-6 p-3 bg-gold/10 border border-gold/20 rounded-xl">
                <Lock size={14} className="text-gold flex-shrink-0" />
                <p className="text-xs text-gray-300">Your payment info is secured. Stripe will be integrated in a future update — this is a demo checkout.</p>
              </div>

              <form onSubmit={handlePay} className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-gray-300">Name on card</label>
                  <input required value={card.name} onChange={e => setCard(c => ({ ...c, name: e.target.value }))}
                    placeholder="Marcus Johnson"
                    className="w-full bg-surface-raised border border-border rounded-xl px-4 py-2.5 text-sm text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-gold/50" />
                </div>

                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-gray-300">Card number</label>
                  <div className="relative">
                    <CreditCard size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                    <input required value={card.number} onChange={e => setCard(c => ({ ...c, number: formatCardNumber(e.target.value) }))}
                      placeholder="1234 5678 9012 3456" maxLength={19}
                      className="w-full bg-surface-raised border border-border rounded-xl pl-9 pr-4 py-2.5 text-sm text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-gold/50 font-mono tracking-wider" />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-gray-300">Expiry</label>
                    <input required value={card.expiry} onChange={e => setCard(c => ({ ...c, expiry: formatExpiry(e.target.value) }))}
                      placeholder="MM/YY" maxLength={5}
                      className="w-full bg-surface-raised border border-border rounded-xl px-4 py-2.5 text-sm text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-gold/50 font-mono" />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-gray-300">CVV</label>
                    <input required value={card.cvv} onChange={e => setCard(c => ({ ...c, cvv: e.target.value.replace(/\D/g, "").slice(0, 4) }))}
                      placeholder="•••" maxLength={4}
                      className="w-full bg-surface-raised border border-border rounded-xl px-4 py-2.5 text-sm text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-gold/50 font-mono" />
                  </div>
                </div>

                <div className="pt-2 space-y-3">
                  <div className="flex justify-between text-sm border-t border-border pt-3">
                    <span className="text-gray-400">ClipWise {chosenPlan.name}</span>
                    <span className="text-white font-semibold">{chosenPlan.price}{chosenPlan.sub}</span>
                  </div>
                  <Button type="submit" className="w-full" size="lg" loading={processing}>
                    {processing ? "Processing…" : `Pay ${chosenPlan.price} →`}
                  </Button>
                </div>
              </form>

              <button onClick={() => setStep("pick")} className="w-full text-center text-xs text-gray-500 hover:text-gray-300 mt-4 transition-colors">
                ← Back to plans
              </button>
            </div>
          )}
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
          <p className="text-gray-400 text-sm">Setting up your dashboard…</p>
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
          <p className="text-gray-500 mt-2">Start free, upgrade anytime. No hidden fees.</p>
        </div>

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
                    <Icon size={20} className={plan.id === "starter" ? "text-gray-400" : plan.id === "pro" ? "text-gold" : "text-purple-400"} />
                  </div>
                  <h2 className="text-xl font-bold text-white">{plan.name}</h2>
                  <div className="flex items-baseline gap-1 mt-1">
                    <span className="text-3xl font-bold text-white">{plan.price}</span>
                    <span className="text-gray-500 text-sm">{plan.sub}</span>
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
                    <li key={l} className="flex items-start gap-2.5 text-sm text-gray-600">
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

        <p className="text-center text-xs text-gray-600 mt-8">
          Starter is free forever. Pro and Premium are billed monthly, no contracts. Stripe integration coming soon.
        </p>
      </div>
    </div>
  );
}
