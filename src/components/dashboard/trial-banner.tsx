"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import { Clock, ArrowRight, X } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { isNativeApp } from "@/lib/native-app";
import { effectivePlan } from "@/lib/validation";

/**
 * Countdown banner for a shop on a no-card Pro/Premium free trial. Prompts the
 * owner to add a card (calm blue, escalating to red at ≤3 days). Dismissing it
 * SNOOZES for 12h (persisted per shop), so it appears at most ~1–2×/day instead
 * of on every dashboard load. The permanent "add a card" CTA lives on the Billing
 * page, so snoozing this never hides the way to convert. Shows only while
 * trial_ends_at is set + in the future and no real subscription exists yet; the
 * daily cron downgrades an expired trial to Starter (plan gating takes over then).
 */
const SNOOZE_MS = 12 * 60 * 60 * 1000; // 12h → at most ~2 reminders/day

/**
 * `native` is resolved on the SERVER (request User-Agent) by the dashboard layout
 * wrapper and passed in, so this banner is known to be in the native app at SSR
 * time — it can never be server-rendered in the app (Apple IAP). If ever mounted
 * without the prop, it falls back to the client-side runtime check.
 */
export function TrialBanner({ native }: { native?: boolean } = {}) {
  const { shop, profile } = useAuth();
  const shopId = shop?.id ?? null;
  // Start hidden, reveal after checking the persisted snooze — avoids a flash and
  // any SSR/hydration mismatch. Re-checks whenever the active shop changes.
  const [snoozed, setSnoozed] = useState(true);

  useEffect(() => {
    if (!shopId) return;
    try {
      const ts = Number(localStorage.getItem(`cw_trial_snooze_${shopId}`) || 0);
      setSnoozed(Date.now() - ts < SNOOZE_MS);
    } catch { setSnoozed(false); }
  }, [shopId]);

  // Native app (Apple IAP): this banner is pure ClipWise-subscription billing
  // ("add a card", "trial ended", link to /dashboard/billing). It must NOT exist
  // in the app at all. Prefer the server-resolved `native` (known at SSR, so it's
  // never even server-rendered in the app); fall back to the client runtime check.
  if (native ?? isNativeApp()) return null;

  if (!shop || profile?.role !== "shop_owner" || shop.stripe_subscription_id) return null;

  const endMs = shop?.trial_ends_at ? new Date(shop.trial_ends_at).getTime() : NaN;
  const daysLeft = Number.isNaN(endMs) ? -1 : Math.ceil((endMs - Date.now()) / 86_400_000);
  const plan = effectivePlan(shop.subscription_plan, shop.subscription_status);
  const activeTrial = plan !== "starter" && Number.isFinite(endMs) && daysLeft > 0;

  // Trial is OVER (used a trial, no active countdown, not currently paying) → the
  // shop has dropped to free Starter. Shown even when `trial_ended_at` wasn't
  // stamped (older/manual downgrades), by leaning on `trial_used`.
  const trialEnded = !activeTrial
    && !!shop?.trial_used
    && (plan === "starter" || (Number.isFinite(endMs) && endMs <= Date.now()));

  if (!activeTrial && !trialEnded) return null;
  if (snoozed) return null;

  const snooze = () => {
    try { if (shopId) localStorage.setItem(`cw_trial_snooze_${shopId}`, String(Date.now())); } catch { /* storage unavailable */ }
    setSnoozed(true);
  };

  // ── Trial ENDED → on free Starter. Persistent (but snoozable) nudge to add a card.
  if (trialEnded) {
    const endedOn = shop?.trial_ended_at
      ? new Date(shop.trial_ended_at).toLocaleDateString("en-CA", { month: "long", day: "numeric", year: "numeric" })
      : null;
    return (
      <div className="px-4 md:px-6 pt-4">
        <div className="relative flex items-start gap-3.5 bg-surface border border-border rounded-2xl shadow-lg shadow-black/30 px-4 py-4 pr-10 sm:gap-4 sm:px-5">
          <span className="flex-shrink-0 w-11 h-11 rounded-xl flex items-center justify-center bg-amber-500/15 text-amber-300"><Clock size={20} /></span>
          <div className="flex-1 min-w-0">
            <p className="text-[15px] font-bold text-foreground leading-snug">
              Your free trial has ended{endedOn ? ` (${endedOn})` : ""}
            </p>
            <p className="text-xs text-grey mt-1 leading-relaxed">
              You&rsquo;re on the free Starter plan. Keep using it for free, or review a paid plan to restore its features — your account &amp; bookings are safe.
            </p>
            <Link href="/dashboard/billing" className="inline-flex items-center gap-1.5 mt-2.5 rounded-lg px-3.5 py-2 text-xs font-bold bg-white text-black hover:bg-white/90 transition-colors">
              Review plans <ArrowRight size={14} />
            </Link>
          </div>
          <button onClick={snooze} aria-label="Dismiss for now" className="absolute top-2.5 right-2.5 text-grey hover:text-foreground p-1 rounded-full"><X size={15} /></button>
        </div>
      </div>
    );
  }

  const urgent = daysLeft <= 3;
  const label = daysLeft === 1 ? "1 day" : `${daysLeft} days`;

  return (
    <div className="px-4 md:px-6 pt-4">
      <div className={`relative flex items-start gap-3.5 bg-surface border rounded-2xl shadow-lg shadow-black/30 px-4 py-4 pr-10 sm:gap-4 sm:px-5 ${urgent ? "border-red-500/40" : "border-border"}`}>
        <span className={`flex-shrink-0 w-11 h-11 rounded-xl flex items-center justify-center ${urgent ? "bg-red-500/15 text-red-300" : "bg-sky-500/15 text-sky-300"}`}><Clock size={20} /></span>
        <div className="flex-1 min-w-0">
          <p className="text-[15px] font-bold text-foreground leading-snug">
            {urgent ? `Your free trial ends in ${label}` : `You're on a free trial — ${label} left`}
          </p>
          <p className="text-xs text-grey mt-1 leading-relaxed">
            Review your plan before continuing with paid features. You won&apos;t be charged automatically on this no-card trial; without a subscription you return to free Starter (your account &amp; bookings stay safe).
          </p>
          <Link href="/dashboard/billing" className="inline-flex items-center gap-1.5 mt-2.5 rounded-lg px-3.5 py-2 text-xs font-bold bg-white text-black hover:bg-white/90 transition-colors">
            Review subscription <ArrowRight size={14} />
          </Link>
        </div>
        {/* Always dismissible now (even at ≤3 days) — snoozes ~12h so it never
            nags every load. The Billing page keeps the permanent reminder. */}
        <button onClick={snooze} aria-label="Dismiss for now" className="absolute top-2.5 right-2.5 text-grey hover:text-foreground p-1 rounded-full"><X size={15} /></button>
      </div>
    </div>
  );
}
