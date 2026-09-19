"use client";
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, ArrowRight, Clock, RefreshCw, X } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { useResetOnReturn } from "@/lib/use-reset-on-return";
import { canPromptPaymentSetup } from "@/lib/setup-prompts";
import { cn } from "@/lib/utils";

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
  // mode: "action" = they must finish/provide info (re-onboard); "verifying" =
  // details submitted, Stripe is reviewing (no re-prompt — that was the loop).
  const [mode, setMode] = useState<"action" | "verifying" | null>(null);
  const [statusShopId, setStatusShopId] = useState<string | null>(null);
  const [dismissedShopId, setDismissedShopId] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [rechecking, setRechecking] = useState(false);
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

  const checkStatus = useCallback(async () => {
    if (!shop || !accessToken || !eligible) return;
    try {
      const res = await fetch(`/api/stripe/connect/status?shop_id=${shop.id}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) throw new Error("Payment status unavailable");
      const data = await res.json();
      setStatusShopId(shop.id);
      // Connected → no banner. Not connected: only prompt onboarding when Stripe
      // actually needs something (needsAction); otherwise it's under review.
      setMode(data.connected ? null : (data.needsAction === false ? "verifying" : "action"));
    } catch {
      // Network/Stripe hiccup — fall back to the stored flag (can't tell
      // "verifying" apart without the API, so assume actionable).
      setStatusShopId(shop.id);
      setMode(shop.stripe_connected === false ? "action" : null);
    }
  }, [shop, accessToken, eligible]);

  useEffect(() => {
    setMode(null);
    setStatusShopId(null);
    setError("");
    if (!shop || !accessToken || !eligible) return;
    let cancelled = false;
    (async () => { if (!cancelled) await checkStatus(); })();
    return () => { cancelled = true; };
  }, [shop, accessToken, eligible, checkStatus]);

  const recheck = async () => {
    if (rechecking) return;
    setRechecking(true);
    await checkStatus();
    setRechecking(false);
  };

  if (!eligible || !shop || statusShopId !== shop.id || !mode || dismissedShopId === shop.id) return null;

  const verifying = mode === "verifying";

  // A polished bar that floats up from the bottom (above the mobile tab bar),
  // matching the calendar onboarding nudge — not a flat block wedged under the
  // page header. Two states: "verifying" (calm, no re-onboard — that looped) and
  // the actionable "finish setup".
  return (
    <div className="fixed left-0 right-0 z-30 px-3 bottom-[calc(4.25rem+env(safe-area-inset-bottom)+8px)] lg:bottom-4 pointer-events-none">
      <div className="pointer-events-auto mx-auto max-w-2xl relative flex items-start gap-3.5 bg-surface border border-border rounded-2xl shadow-xl shadow-black/40 animate-fade-in px-4 py-4 pr-10 sm:gap-4 sm:px-5">
        <span className={cn("flex-shrink-0 w-11 h-11 rounded-xl flex items-center justify-center",
          verifying ? "bg-sky-500/15 text-sky-300" : "bg-amber-500/15 text-amber-300")}>
          {verifying ? <Clock size={20} /> : <AlertTriangle size={20} />}
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-[15px] font-bold text-foreground leading-snug">
            {verifying ? "Stripe is verifying your account" : "Finish setting up payments"}
          </p>
          <p className="text-xs text-grey mt-1 leading-relaxed">
            {verifying
              ? "You've submitted your details — no action needed. Card payments turn on automatically once Stripe approves (usually minutes, sometimes up to a day)."
              : "Connect your bank through Stripe to accept card payments and get paid. About two minutes — it's separate from your ClipWise subscription."}
          </p>
          <button
            onClick={verifying ? recheck : startConnect}
            disabled={verifying ? rechecking : starting}
            className={cn("inline-flex items-center gap-1.5 mt-2.5 rounded-lg px-3.5 py-2 text-xs font-bold transition-colors disabled:opacity-60",
              verifying ? "border border-sky-500/30 bg-card-raised text-sky-300 hover:text-sky-200" : "bg-white text-black hover:bg-white/90")}
          >
            {verifying
              ? <><RefreshCw size={14} className={rechecking ? "animate-spin" : ""} /> {rechecking ? "Checking…" : "Check status"}</>
              : (starting ? "Opening Stripe…" : <>Finish Stripe setup <ArrowRight size={14} /></>)}
          </button>
          {error && <p role="alert" className="text-xs text-amber-300 mt-2">{error}</p>}
        </div>
        <button
          onClick={() => setDismissedShopId(shop.id)}
          aria-label="Dismiss"
          className="absolute top-2.5 right-2.5 text-grey hover:text-foreground p-1 rounded-full"
        >
          <X size={15} />
        </button>
      </div>
    </div>
  );
}
