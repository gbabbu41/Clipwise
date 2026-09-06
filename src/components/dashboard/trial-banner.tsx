"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import { Clock, ArrowRight } from "lucide-react";
import { useAuth } from "@/lib/auth-context";

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

export function TrialBanner() {
  const { shop } = useAuth();
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

  if (shop?.stripe_subscription_id) return null; // real subscriber — no trial UI

  const endMs = shop?.trial_ends_at ? new Date(shop.trial_ends_at).getTime() : NaN;
  const daysLeft = Number.isNaN(endMs) ? -1 : Math.ceil((endMs - Date.now()) / 86_400_000);
  const activeTrial = !!shop?.trial_ends_at && !Number.isNaN(endMs) && daysLeft > 0;

  // Trial is OVER (used a trial, no active countdown, not currently paying) → the
  // shop has dropped to free Starter. Shown even when `trial_ended_at` wasn't
  // stamped (older/manual downgrades), by leaning on `trial_used`.
  const trialEnded = !activeTrial
    && !!shop?.trial_used
    && shop?.subscription_status !== "active";

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
        <div className="flex items-start gap-3 border rounded-2xl p-4 bg-amber-500/10 border-amber-500/30 text-amber-300">
          <Clock size={18} className="flex-shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold">
              Your free trial has ended{endedOn ? ` (${endedOn})` : ""} — you&rsquo;re on the free Starter plan
            </p>
            <p className="text-xs opacity-80 mt-0.5">
              Add a card to switch your paid features back on (online payments, POS, loyalty &amp; extra barbers). Your account &amp; bookings are safe.
            </p>
            <Link href="/dashboard/billing" className="inline-flex items-center gap-1 text-xs font-semibold mt-2 hover:underline">
              Add your card <ArrowRight size={13} />
            </Link>
          </div>
          <button onClick={snooze} className="text-sm leading-none opacity-60 hover:opacity-100 flex-shrink-0" aria-label="Dismiss for now">✕</button>
        </div>
      </div>
    );
  }

  const urgent = daysLeft <= 3;
  const label = daysLeft === 1 ? "1 day" : `${daysLeft} days`;

  const tone = urgent
    ? "bg-red-500/10 border-red-500/30 text-red-300"
    : "bg-sky-500/10 border-sky-500/30 text-sky-300";

  return (
    <div className="px-4 md:px-6 pt-4">
      <div className={`flex items-start gap-3 border rounded-2xl p-4 ${tone}`}>
        <Clock size={18} className="flex-shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold">
            {urgent ? `⚠️ Your free trial ends in ${label}` : `You're on a free trial — ${label} left`}
          </p>
          <p className="text-xs opacity-80 mt-0.5">
            Add a card to keep online payments, POS, loyalty &amp; extra barbers. No charge until you subscribe — otherwise your shop drops to the free Starter plan (your account &amp; bookings stay safe).
          </p>
          <Link href="/dashboard/billing" className="inline-flex items-center gap-1 text-xs font-semibold mt-2 hover:underline">
            Add your card <ArrowRight size={13} />
          </Link>
        </div>
        {/* Always dismissible now (even at ≤3 days) — snoozes ~12h so it never
            nags every load. The Billing page keeps the permanent reminder. */}
        <button onClick={snooze} className="text-sm leading-none opacity-60 hover:opacity-100 flex-shrink-0" aria-label="Dismiss for now">✕</button>
      </div>
    </div>
  );
}
