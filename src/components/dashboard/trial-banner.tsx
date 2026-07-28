"use client";
import { useState } from "react";
import Link from "next/link";
import { Clock, ArrowRight } from "lucide-react";
import { useAuth } from "@/lib/auth-context";

/**
 * Countdown banner for a shop on a no-card Pro/Premium free trial. Calm blue
 * while there's time, escalates to a non-dismissible red warning at ≤3 days,
 * prompting the owner to add a card. Shows only while trial_ends_at is set + in
 * the future and no real subscription exists yet. The daily cron downgrades an
 * expired trial to Starter, after which plan gating (not this banner) takes over.
 */
export function TrialBanner() {
  const { shop } = useAuth();
  const [dismissed, setDismissed] = useState(false);

  if (!shop?.trial_ends_at || shop.stripe_subscription_id) return null;
  const endMs = new Date(shop.trial_ends_at).getTime();
  if (Number.isNaN(endMs)) return null;
  const daysLeft = Math.ceil((endMs - Date.now()) / 86_400_000);
  if (daysLeft <= 0) return null;

  const urgent = daysLeft <= 3;
  const label = daysLeft === 1 ? "1 day" : `${daysLeft} days`;
  if (dismissed && !urgent) return null;

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
        {!urgent && (
          <button onClick={() => setDismissed(true)} className="text-sm leading-none opacity-60 hover:opacity-100 flex-shrink-0" aria-label="Dismiss">✕</button>
        )}
      </div>
    </div>
  );
}
