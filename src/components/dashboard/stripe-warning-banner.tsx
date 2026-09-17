"use client";
import { useEffect, useState } from "react";
import { AlertTriangle, ArrowRight } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { useResetOnReturn } from "@/lib/use-reset-on-return";
import { canPromptPaymentSetup } from "@/lib/setup-prompts";

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
  const { shop, profile, accessToken } = useAuth();
  const [setupShopId, setSetupShopId] = useState<string | null>(null);
  const [dismissedShopId, setDismissedShopId] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");
  const eligible = profile?.role === "shop_owner" && canPromptPaymentSetup(shop);
  // Returning from Stripe via Back restores this page from bfcache with `starting`
  // frozen — clear it so the button doesn't spin forever.
  useResetOnReturn(() => setStarting(false));

  // Start Stripe Connect onboarding directly (same as Billing's "Complete Setup"
  // button) — the old link only navigated to Billing without starting anything.
  const startConnect = async () => {
    if (!accessToken || !eligible || !shop || starting) return;
    setError("");
    setStarting(true);
    try {
      const res = await fetch("/api/stripe/connect", {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        // Connect the shop this banner is about (the active location), not just
        // the owner's newest shop.
        body: JSON.stringify({ shop_id: shop?.id }),
      });
      const data = await res.json();
      if (res.ok && data.url) { window.location.href = data.url; return; }
    } catch { /* fall through */ }
    setError("Couldn't open payment setup. Please try again.");
    setStarting(false);
  };

  useEffect(() => {
    setSetupShopId(null);
    setError("");
    if (!shop || !accessToken || !eligible) return;

    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/stripe/connect/status?shop_id=${shop.id}`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (!res.ok) throw new Error("Payment status unavailable");
        const data = await res.json();
        if (!cancelled) setSetupShopId(data.connected === false ? shop.id : null);
      } catch {
        // Network/Stripe hiccup — fall back to the stored flag.
        if (!cancelled) setSetupShopId(shop.stripe_connected === false ? shop.id : null);
      }
    })();
    return () => { cancelled = true; };
  }, [shop, accessToken, eligible]);

  if (!eligible || !shop || setupShopId !== shop.id || dismissedShopId === shop.id) return null;

  return (
    <div className="px-4 md:px-6 pt-4">
      <div className="flex items-start gap-3 bg-orange-500/10 border border-orange-500/30 rounded-2xl p-4">
        <AlertTriangle size={18} className="text-orange-400 flex-shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-orange-300">
            Your Stripe payouts aren&apos;t fully set up
          </p>
          <p className="text-xs text-orange-200/80 mt-0.5">
            Finish Stripe onboarding to enable customer card payments and payouts.
            This connects your shop&apos;s bank account; it is separate from your ClipWise subscription.
          </p>
          <button
            onClick={startConnect}
            disabled={starting}
            className="inline-flex items-center gap-1 text-xs font-semibold text-orange-300 hover:text-orange-200 mt-2 disabled:opacity-60"
          >
            {starting ? "Opening Stripe…" : <>Finish Stripe setup <ArrowRight size={13} /></>}
          </button>
          {error && <p role="alert" className="text-xs text-orange-200 mt-2">{error}</p>}
        </div>
        <button
          onClick={() => setDismissedShopId(shop.id)}
          className="text-orange-300/60 hover:text-orange-200 text-sm leading-none flex-shrink-0"
          aria-label="Dismiss"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
