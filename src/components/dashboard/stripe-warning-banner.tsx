"use client";
import { useEffect, useState } from "react";
import { AlertTriangle, ArrowRight } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { planHasFeature, effectivePlan } from "@/lib/validation";

/**
 * Dashboard-wide warning shown to shop owners whose plan CAN take online
 * payments but whose Stripe Connect account isn't fully set up yet
 * ("Restricted" in Stripe). Without this, customers hit failed payments on
 * booking + payment links (exactly what happened with the Bloke Boyz shop:
 * the account existed but charges weren't enabled, so every link errored).
 *
 * We do a live check against /api/stripe/connect/status (which also re-syncs
 * the shops row) so a stale `stripe_connected=true` flag can't hide a
 * Restricted account.
 */
export function StripeWarningBanner() {
  const { shop, accessToken } = useAuth();
  const [needsSetup, setNeedsSetup] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [starting, setStarting] = useState(false);

  // Start Stripe Connect onboarding directly (same as Billing's "Complete Setup"
  // button) — the old link only navigated to Billing without starting anything.
  const startConnect = async () => {
    if (!accessToken) return;
    setStarting(true);
    try {
      const res = await fetch("/api/stripe/connect", {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (res.ok && data.url) { window.location.href = data.url; return; }
    } catch { /* fall through */ }
    setStarting(false);
  };

  useEffect(() => {
    if (!shop || !accessToken) return;
    // Only relevant for shops on a paid plan that unlocks online payments.
    const plan = effectivePlan(shop.subscription_plan, shop.subscription_status);
    if (!planHasFeature(plan, "payments")) { setNeedsSetup(false); return; }

    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/stripe/connect/status?shop_id=${shop.id}`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setNeedsSetup(!data.connected);
      } catch {
        // Network/Stripe hiccup — fall back to the stored flag.
        if (!cancelled) setNeedsSetup(!shop.stripe_connected);
      }
    })();
    return () => { cancelled = true; };
  }, [shop, accessToken]);

  if (!needsSetup || dismissed) return null;

  return (
    <div className="px-4 md:px-6 pt-4">
      <div className="flex items-start gap-3 bg-orange-500/10 border border-orange-500/30 rounded-2xl p-4">
        <AlertTriangle size={18} className="text-orange-400 flex-shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-orange-300">
            Your Stripe payouts aren&apos;t fully set up
          </p>
          <p className="text-xs text-orange-200/80 mt-0.5">
            Until you finish Stripe onboarding, customers can&apos;t pay online and any
            payment links you send will fail. It only takes a couple of minutes.
          </p>
          <button
            onClick={startConnect}
            disabled={starting}
            className="inline-flex items-center gap-1 text-xs font-semibold text-orange-300 hover:text-orange-200 mt-2 disabled:opacity-60"
          >
            {starting ? "Opening Stripe…" : <>Finish Stripe setup <ArrowRight size={13} /></>}
          </button>
        </div>
        <button
          onClick={() => setDismissed(true)}
          className="text-orange-300/60 hover:text-orange-200 text-sm leading-none flex-shrink-0"
          aria-label="Dismiss"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
