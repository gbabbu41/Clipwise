"use client";
import { useEffect, useRef, useState } from "react";
import { Scissors, ArrowRight, Check } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/lib/supabase";
import { effectivePlan, isPaidPlan } from "@/lib/validation";

/**
 * Visible in-dashboard prompt for a solo Starter owner who never got set up as a
 * barber (e.g. they skipped the "add yourself" onboarding step). On Starter the
 * Staff page is hidden, so without this there's NO way back in — the owner is
 * stranded with a shop but no barber, and the calendar/booking has no one to book.
 *
 * This replaces the old silent self-heal (it fired before the access token was
 * ready and left no visible trace, so the owner "wasn't getting it"). Here the
 * owner sees exactly what's missing and clicks one button to fix it. Starter-only;
 * paid shops manage barbers from Staff.
 */
export function AddSelfBarberBanner() {
  const { user, profile, shop, accessToken, refreshShop } = useAuth();
  // "checking" until we know; "needed" shows the CTA; "ok"/"hidden" render nothing.
  const [state, setState] = useState<"checking" | "needed" | "ok" | "hidden">("checking");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState("");
  const checkedRef = useRef(false);

  const isOwner = profile?.role === "shop_owner";
  const isStarter =
    !!shop && !isPaidPlan(effectivePlan(shop.subscription_plan, shop.subscription_status));

  // Look for a barber row already linked to this owner. Only relevant on Starter;
  // paid owners have the Staff page for this.
  useEffect(() => {
    if (!user || !shop || !isOwner || !isStarter) { setState("hidden"); return; }
    if (checkedRef.current) return;
    checkedRef.current = true;
    let cancelled = false;
    (async () => {
      const { data: mine } = await supabase
        .from("barbers").select("id").eq("shop_id", shop.id).eq("user_id", user.id).maybeSingle();
      if (cancelled) return;
      setState(mine ? "hidden" : "needed");
    })();
    return () => { cancelled = true; };
  }, [user, shop, isOwner, isStarter]);

  const addSelf = async () => {
    if (!user?.email || !shop || !accessToken) {
      setError("Session expired — please sign in again.");
      return;
    }
    setAdding(true);
    setError("");
    try {
      const res = await fetch("/api/admin/barber/invite", {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          name: profile?.name || user.email.split("@")[0] || "Me",
          email: user.email,
          commission_percent: 100, // solo owner keeps 100% — one person, no split
          shop_id: shop.id,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.barber) { setError(data.error || "Couldn't add you as a barber. Please try again."); return; }
      setState("ok");
      try { await refreshShop(); } catch { /* the reload below re-syncs everything */ }
      // Reload so the calendar, booking page and everywhere else pick up the new
      // barber immediately (they each fetch their own barber list on mount).
      setTimeout(() => window.location.reload(), 1200);
    } catch {
      setError("Connection error — please try again.");
    } finally {
      setAdding(false);
    }
  };

  if (state === "hidden" || state === "checking") return null;

  if (state === "ok") {
    return (
      <div className="px-4 md:px-6 pt-4">
        <div className="flex items-center gap-3 bg-emerald-500/10 border border-emerald-500/30 rounded-2xl p-4">
          <Check size={18} className="text-emerald-400 flex-shrink-0" />
          <p className="text-sm font-semibold text-emerald-300">You&apos;re set up as a barber — updating your dashboard…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="px-4 md:px-6 pt-4">
      <div className="flex items-start gap-3 bg-amber-500/10 border border-amber-500/30 rounded-2xl p-4">
        <Scissors size={18} className="text-amber-400 flex-shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-amber-300">You&apos;re not set up as a barber yet</p>
          <p className="text-xs text-amber-200/80 mt-0.5">
            On the free plan it&apos;s just you. Add yourself as a barber so customers can book
            you and you show up on the calendar. Takes one tap — no invite needed.
          </p>
          {error && <p className="text-xs text-red-400 mt-1.5">{error}</p>}
          <button
            onClick={addSelf}
            disabled={adding}
            className="inline-flex items-center gap-1 text-xs font-semibold text-amber-300 hover:text-amber-200 mt-2 disabled:opacity-60"
          >
            {adding ? "Adding you…" : <>Add yourself as a barber <ArrowRight size={13} /></>}
          </button>
        </div>
      </div>
    </div>
  );
}
