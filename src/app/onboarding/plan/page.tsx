"use client";
import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Check, X, Zap, Crown, ArrowRight, AlertCircle } from "lucide-react";
import { Logo } from "@/components/ui/logo";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth-context";
import { formatPlanPrice, type PlanRow } from "@/lib/plans";
import { marketingFor } from "@/lib/plan-marketing";

type Plan = string;

// Per-tier visual styling, keyed by plan id. Unknown ids (e.g. a custom plan
// the admin adds) fall back to the neutral premium look.
const PLAN_STYLE: Record<string, {
  icon: typeof Zap; accent: string; iconWrap: string; iconColor: string;
  checkColor: string; btn: string; badgeBg: string;
}> = {
  starter: {
    icon: Zap, accent: "border-gray-700 hover:border-gray-500",
    iconWrap: "bg-surface-raised", iconColor: "text-[#8f8f8f]", checkColor: "text-emerald-400",
    btn: "bg-surface-raised text-white hover:bg-surface border border-border", badgeBg: "bg-gold text-black",
  },
  pro: {
    icon: Crown, accent: "border-gold/50 hover:border-gold ring-1 ring-gold/20",
    iconWrap: "bg-gold/15", iconColor: "text-gold", checkColor: "text-gold",
    btn: "bg-gold text-black hover:bg-gold/90", badgeBg: "bg-gold text-black",
  },
  premium: {
    icon: Crown, accent: "border-purple-500/50 hover:border-purple-400",
    iconWrap: "bg-purple-500/15", iconColor: "text-purple-400", checkColor: "text-purple-400",
    btn: "bg-purple-500 text-white hover:bg-purple-600", badgeBg: "bg-purple-500 text-white",
  },
};
const styleFor = (id: string) => PLAN_STYLE[id] ?? PLAN_STYLE.premium;

// Plain-language "who is this for" line under each plan, so a solo barber
// renting a chair knows Pro is their sweet spot — and that they can add a shop
// + team later without switching accounts. Keyed by plan id; unknown custom
// plans simply show no tagline.
const PLAN_GUIDANCE: Record<string, string> = {
  starter: "Best for a solo barber just getting started.",
  pro: "Best for solo barbers & small shops — start solo, add your shop and up to 4 chairs anytime.",
  premium: "Best for established shops with a bigger team.",
};

// Shown until /api/plans resolves (and if it ever fails) — mirrors the seeded tiers.
const FALLBACK_PLANS: PlanRow[] = [
  { id: "starter", name: "Starter", price_cents: 0, barber_limit: 1, features: [], badge: null, description: null, is_active: true, sort_order: 0,
    highlights: ["1 barber", "Online booking page", "Appointment management", "Email confirmations & reminders"] },
  { id: "pro", name: "Pro", price_cents: 2300, barber_limit: 4, features: ["payments", "loyalty", "pos"], badge: "Most Popular", description: null, is_active: true, sort_order: 1,
    highlights: ["Up to 4 barbers", "Online booking + customer payments", "In-person POS (cash & card)", "Loyalty program", "Advanced analytics", "Stripe Connect for payouts", "Instant approval"] },
  { id: "premium", name: "Premium", price_cents: 7900, barber_limit: 9, features: ["payments", "loyalty", "pos", "inventory", "staff_portal", "commission", "multi_location"], badge: "Full Suite", description: null, is_active: true, sort_order: 2,
    highlights: ["Up to 9 barbers", "Everything in Pro", "Full POS", "Inventory management", "Staff management & payroll", "Multiple locations", "Full analytics & reports", "Dedicated support"] },
];

function PlanPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { accessToken, plans } = useAuth();
  const cards = (plans.length ? plans : FALLBACK_PLANS).filter(p => p.is_active);
  const [step, setStep] = useState<"pick" | "redirecting" | "verifying" | "success">("pick");
  const [error, setError] = useState("");

  // Plan the user picked on the homepage (/signup?plan=… → carried here). Spotlight
  // and scroll to it so their choice isn't silently forgotten.
  const preselected = searchParams.get("plan") || "";
  useEffect(() => {
    if (!preselected) return;
    const el = document.getElementById(`plan-${preselected}`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [preselected]);

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
      // Wait for the auth token to load — verify-session now requires it.
      if (!sessionId || !plan || !accessToken) return;
      setStep("verifying");
      fetch(`/api/stripe/verify-session?session_id=${sessionId}`, {
        headers: { Authorization: `Bearer ${accessToken ?? ""}` },
      })
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
  }, [searchParams, router, accessToken]);

  function selectPlan(plan: Plan) {
    setError("");
    const card = cards.find(c => c.id === plan);
    if (!card || card.price_cents === 0) {
      // Free tier → no checkout, shop goes to manual approval.
      sessionStorage.setItem("clipwise_plan", JSON.stringify({ plan, autoApprove: false }));
      router.push("/onboarding");
      return;
    }
    // Pro/Premium → start a NO-CARD 21-day free trial (no checkout up front). The
    // card is only collected when the trial ends (Billing → subscribe).
    sessionStorage.setItem("clipwise_plan", JSON.stringify({ plan, trial: true }));
    router.push("/onboarding");
  }

  if (step === "redirecting" || step === "verifying") {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <div className="w-10 h-10 border-2 border-gold/30 border-t-gold rounded-full animate-spin mx-auto mb-4" />
          <p className="font-semibold text-white">{step === "redirecting" ? "Taking you to secure checkout…" : "Confirming your payment…"}</p>
          <p className="text-[#8f8f8f] text-sm mt-1">Powered by Stripe</p>
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
          <p className="text-[#8f8f8f] text-sm">Setting up your shop…</p>
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
          <p className="text-[#8f8f8f] mt-2">Solo barber or a full shop — pick what fits today, upgrade anytime. Pro &amp; Premium include a 21-day free trial, no card needed.</p>
        </div>

        {error && (
          <div className="max-w-md mx-auto mb-6 flex items-center gap-2 bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3">
            <AlertCircle size={16} className="text-red-400 flex-shrink-0" />
            <p className="text-sm text-red-400">{error}</p>
          </div>
        )}

        <div className="grid md:grid-cols-3 gap-6">
          {cards.map(plan => {
            const st = styleFor(plan.id);
            const Icon = st.icon;
            const isFree = plan.price_cents === 0;
            const cta = isFree ? "Get Started Free" : `Start ${plan.name} — 21 days free`;
            // Marketing copy (bullets, tagline, spotlight) from the shared list so
            // this matches the home page: what's included AND what's not, with Pro
            // spotlighted. A custom plan with no entry falls back to its DB
            // highlights and shows no "not included" list.
            const mk = marketingFor(plan.id);
            const tagline = mk?.forWho ?? PLAN_GUIDANCE[plan.id];
            const included = mk?.yes ?? plan.highlights;
            const excluded = mk?.no ?? [];
            const badge = mk ? (mk.pop ? "Most popular" : null) : plan.badge;
            return (
              <div key={plan.id} id={`plan-${plan.id}`}
                className={cn("relative bg-surface border rounded-2xl p-6 flex flex-col transition-all cursor-pointer", st.accent,
                  preselected === plan.id && "ring-2 ring-gold ring-offset-2 ring-offset-background")}
                onClick={() => selectPlan(plan.id)}>
                {badge && (
                  <div className={cn("absolute -top-3 left-1/2 -translate-x-1/2 text-xs font-bold px-3 py-1 rounded-full", st.badgeBg)}>
                    {badge}
                  </div>
                )}
                {preselected === plan.id && (
                  <div className="absolute -top-3 right-3 text-[10px] font-bold px-2 py-1 rounded-full bg-emerald-500 text-white">
                    Your pick
                  </div>
                )}

                <div className="mb-5">
                  <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center mb-4", st.iconWrap)}>
                    <Icon size={20} className={st.iconColor} />
                  </div>
                  <h2 className="text-xl font-bold text-white">{plan.name}</h2>
                  {tagline && (
                    <p className="text-xs text-[#8f8f8f] mt-1 leading-snug">{tagline}</p>
                  )}
                  <div className="flex items-baseline gap-1 mt-2">
                    <span className="text-3xl font-bold text-white">{formatPlanPrice(plan.price_cents)}</span>
                    <span className="text-[#8f8f8f] text-sm">{isFree ? "forever" : "/month"}</span>
                  </div>
                </div>

                <ul className="space-y-2.5 flex-1 mb-6">
                  {included.map(f => (
                    <li key={f} className="flex items-start gap-2.5 text-sm text-gray-300">
                      <Check size={15} className={cn("flex-shrink-0 mt-0.5", st.checkColor)} />
                      {f}
                    </li>
                  ))}
                  {/* What this tier does NOT include — shown honestly (grey ✕) so
                      Starter's limits are clear and Pro reads as the upgrade. */}
                  {excluded.map(f => (
                    <li key={f} className="flex items-start gap-2.5 text-sm text-[#74747e]">
                      <X size={15} className="flex-shrink-0 mt-0.5 text-[#4a4a52]" />
                      {f}
                    </li>
                  ))}
                </ul>

                <button className={cn("w-full py-3 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 transition-all", st.btn)}>
                  {cta} <ArrowRight size={15} />
                </button>
              </div>
            );
          })}
        </div>

        <p className="text-center text-xs text-[#8f8f8f] mt-8">
          Starter is free forever. Pro &amp; Premium start with a 21-day free trial — no card required. You only add a card if you decide to keep it; billed monthly, no contracts.
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
