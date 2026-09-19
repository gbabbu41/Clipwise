"use client";
import { useEffect, useRef, useState } from "react";
import { Scissors, ArrowRight, Check } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/lib/supabase";
import { effectivePlan, isPaidPlan } from "@/lib/validation";
import { useBannerSlot } from "@/components/dashboard/banner-coordinator";

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
  const [state, setState] = useState<"checking" | "needed" | "ok" | "hidden" | "error">("checking");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState("");
  const [checkedScope, setCheckedScope] = useState("");
  const [checkAttempt, setCheckAttempt] = useState(0);
  const [uncertain, setUncertain] = useState(false);
  const selfRequestState = useRef<"idle" | "pending" | "uncertain" | "complete">("idle");
  const bannerContext = useRef(0);
  const reloadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isOwner = profile?.role === "shop_owner";
  const isStarter =
    !!shop && !isPaidPlan(effectivePlan(shop.subscription_plan, shop.subscription_status));
  // The public-facing name customers will see — the account/signup name (no
  // editable field, to keep the two portals from showing different names).
  const selfBarberName = profile?.name?.trim() || user?.email?.split("@")[0] || "you";
  const userId = user?.id;
  const shopId = shop?.id;
  const currentScope = `${userId ?? ""}:${shopId ?? ""}:${isOwner}:${isStarter}`;
  const bannerScope = useRef(currentScope);
  if (bannerScope.current !== currentScope) {
    bannerScope.current = currentScope;
    bannerContext.current++;
    if (selfRequestState.current === "complete") selfRequestState.current = "idle";
  }

  // Look for a barber row already linked to this owner. Only relevant on Starter;
  // paid owners have the Staff page for this.
  useEffect(() => {
    const contextRef = bannerContext;
    const timerRef = reloadTimer;
    const context = contextRef.current;
    let cancelled = false;
    const current = () => !cancelled && context === contextRef.current;
    if (!userId || !shopId || !isOwner || !isStarter) { setState("hidden"); return; }
    setState("checking");
    setError("");
    (async () => {
      try {
        const { data: mine, error: readError } = await supabase
          .from("barbers").select("id").eq("shop_id", shopId).eq("user_id", userId).maybeSingle();
        if (!current()) return;
        if (readError) throw new Error("Barber lookup failed");
        setState(mine ? "hidden" : "needed");
      } catch {
        if (current()) { setState("error"); setError("Couldn't check your barber setup. Please try again."); }
      } finally {
        if (current()) setCheckedScope(currentScope);
      }
    })();
    return () => {
      cancelled = true;
      contextRef.current++;
      if (timerRef.current !== null) { clearTimeout(timerRef.current); timerRef.current = null; }
    };
  }, [userId, shopId, isOwner, isStarter, checkAttempt, currentScope]);

  const addSelf = async () => {
    if (selfRequestState.current !== "idle" || !isOwner || !isStarter || state !== "needed" || checkedScope !== currentScope || bannerScope.current !== currentScope) return;
    if (!user?.email || !shop || !accessToken) {
      setError("Session expired — please sign in again.");
      return;
    }
    selfRequestState.current = "pending";
    const context = bannerContext.current;
    setAdding(true);
    setError("");
    try {
      const res = await fetch("/api/admin/barber/invite", {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          name: profile?.name || user.email.split("@")[0] || "Me",
          email: user.email,
          commission_percent: 0, // owner-barber: his services stay as SHOP revenue (one pocket), not split out as a separate "commission" — keeps the books from double-labeling the same dollar. He can change it later.
          shop_id: shop.id,
        }),
      });
      const data = await res.json();
      if (res.status >= 500) throw new Error("Uncertain creation outcome");
      if (context !== bannerContext.current) return;
      if (!res.ok) { setError(typeof data?.error === "string" ? data.error : "Couldn't add you as a barber. Please check the details and try again."); return; }
      if (data?.ok !== true || data.ownerSelf !== true || typeof data.barber?.id !== "string" || !data.barber.id) throw new Error("Unconfirmed creation response");
      selfRequestState.current = "complete";
      setState("ok");
      try { await refreshShop(); } catch { /* the reload below re-syncs everything */ }
      // Reload so the calendar, booking page and everywhere else pick up the new
      // barber immediately (they each fetch their own barber list on mount).
      if (context === bannerContext.current) reloadTimer.current = setTimeout(() => {
        if (context === bannerContext.current) window.location.reload();
      }, 1200);
    } catch {
      selfRequestState.current = "uncertain";
      setUncertain(true);
      if (context === bannerContext.current) setError("Couldn't confirm whether you were added. Refresh and check the original shop's barber setup before trying again.");
    } finally {
      if (selfRequestState.current === "pending") selfRequestState.current = "idle";
      setAdding(false);
    }
  };

  const wants = state !== "hidden" && state !== "checking" && checkedScope === currentScope;
  const slot = useBannerSlot("self-barber", wants);
  if (!slot) return null;

  // A polished bar floating up from the bottom (above the mobile tab bar) — the
  // same treatment as the Stripe / onboarding nudges. Starter-only, so it never
  // co-exists with the (paid-plan) Stripe bottom bar.
  const barWrap = "fixed left-0 right-0 z-30 px-3 bottom-[calc(4.25rem+env(safe-area-inset-bottom)+8px)] lg:bottom-4 pointer-events-none";
  const barCard = "pointer-events-auto mx-auto max-w-2xl bg-surface border border-border rounded-2xl shadow-xl shadow-black/40 animate-fade-in px-4 py-4 sm:px-5";

  if (state === "error") {
    return (
      <div className={barWrap}>
        <div role="alert" className={`${barCard} flex items-start gap-3.5 sm:gap-4`}>
          <span className="flex-shrink-0 w-11 h-11 rounded-xl flex items-center justify-center bg-amber-500/15 text-amber-300"><Scissors size={20} /></span>
          <div className="flex-1 min-w-0">
            <p className="text-[15px] font-bold text-foreground leading-snug">Couldn&apos;t check your setup</p>
            <p className="text-xs text-grey mt-1">{error || "Please try again."}</p>
            <button onClick={() => setCheckAttempt(value => value + 1)} className="inline-flex items-center gap-1.5 mt-2.5 rounded-lg px-3.5 py-2 text-xs font-bold bg-white text-black hover:bg-white/90 transition-colors">Retry setup check</button>
          </div>
        </div>
      </div>
    );
  }

  if (state === "ok") {
    return (
      <div className={barWrap}>
        <div className={`${barCard} flex items-center gap-3.5 sm:gap-4`}>
          <span className="flex-shrink-0 w-11 h-11 rounded-xl flex items-center justify-center bg-emerald-500/15 text-emerald-300"><Check size={20} /></span>
          <p className="text-[15px] font-bold text-foreground">You&apos;re set up as a barber — updating your dashboard…</p>
        </div>
      </div>
    );
  }

  return (
    <div className={barWrap}>
      <div className={`${barCard} flex items-start gap-3.5 sm:gap-4`}>
        <span className="flex-shrink-0 w-11 h-11 rounded-xl flex items-center justify-center bg-amber-500/15 text-amber-300"><Scissors size={20} /></span>
        <div className="flex-1 min-w-0">
          <p className="text-[15px] font-bold text-foreground leading-snug">Add yourself as a barber</p>
          <p className="text-xs text-grey mt-1 leading-relaxed">
            The free plan covers one chair. Add yourself so customers can book you and you show up on
            the calendar — you&apos;ll appear as <span className="font-semibold text-foreground">{selfBarberName}</span> on
            your booking page. One tap, no invite needed.
          </p>
          {(error || uncertain) && <p role="alert" className="text-xs text-amber-300 mt-2">{uncertain ? "Couldn't confirm whether you were added. Refresh and check your barber setup before trying again." : error}</p>}
          <button
            onClick={addSelf}
            disabled={adding || uncertain}
            className="inline-flex items-center gap-1.5 mt-2.5 rounded-lg px-3.5 py-2 text-xs font-bold bg-white text-black hover:bg-white/90 transition-colors disabled:opacity-60"
          >
            {adding ? "Adding you…" : <>Add yourself as a barber <ArrowRight size={14} /></>}
          </button>
        </div>
      </div>
    </div>
  );
}
