"use client";
import { useState, useEffect } from "react";
import { Check, X, ArrowRight } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { supabase } from "@/lib/supabase";
import type { Shop } from "@/lib/database.types";

interface Step {
  label: string;
  description: string;
  href: string;
  done: boolean;
}

interface Props {
  shop: Shop;
}

// Separate localStorage keys per banner state so dismissing the in-progress
// gold banner doesn't also prevent the "You're all set up" green banner
// from appearing later when setup completes (and vice versa).
const progressKey = (shopId: string) => `clipwise_onboarding_progress_dismissed_${shopId}`;
const completeKey = (shopId: string) => `clipwise_onboarding_complete_dismissed_${shopId}`;

export function OnboardingBanner({ shop }: Props) {
  // Both start `true` (hidden) so the banner doesn't flash before localStorage
  // is read in the effect below.
  const [progressDismissed, setProgressDismissed] = useState(true);
  const [completeDismissed, setCompleteDismissed] = useState(true);
  const [steps, setSteps] = useState<Step[]>([]);

  useEffect(() => {
    setProgressDismissed(!!localStorage.getItem(progressKey(shop.id)));
    setCompleteDismissed(!!localStorage.getItem(completeKey(shop.id)));

    // Check what's been set up
    Promise.all([
      supabase.from("services").select("id", { count: "exact", head: true }).eq("shop_id", shop.id),
      supabase.from("barbers").select("id", { count: "exact", head: true }).eq("shop_id", shop.id),
    ]).then(([svcRes, barberRes]) => {
      const hasServices = (svcRes.count ?? 0) > 0;
      const hasBarbers = (barberRes.count ?? 0) > 0;
      const hasShared = !!localStorage.getItem(`clipwise_shared_${shop.id}`);

      setSteps([
        {
          label: "Add your services",
          description: "List what you offer and set prices",
          href: "/dashboard/services",
          done: hasServices,
        },
        {
          label: "Add your first barber",
          description: "Set up staff and their schedules",
          href: "/dashboard/staff",
          done: hasBarbers,
        },
        {
          label: "Share your booking link",
          description: `book.clipwise.ca/${shop.slug}`,
          href: "/dashboard/share",
          done: hasShared,
        },
      ]);
    });
  }, [shop]);

  const doneCount = steps.filter(s => s.done).length;
  const allDone = steps.length > 0 && doneCount === steps.length;

  // Pick which banner to show (if any) based on completion + dismiss state.
  if (allDone) {
    if (completeDismissed) return null;
  } else {
    if (progressDismissed) return null;
  }

  const dismissProgress = () => {
    localStorage.setItem(progressKey(shop.id), "1");
    setProgressDismissed(true);
  };
  const dismissComplete = () => {
    localStorage.setItem(completeKey(shop.id), "1");
    setCompleteDismissed(true);
  };

  if (allDone) {
    return (
      <div className="mb-6 bg-emerald-500/10 border border-emerald-500/20 rounded-2xl p-4 flex items-center justify-between animate-fade-in">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-emerald-500/20 flex items-center justify-center">
            <Check size={16} className="text-emerald-400" />
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground">You&apos;re all set up!</p>
            <p className="text-xs text-grey">Your booking page is live. Start sharing it with clients.</p>
          </div>
        </div>
        <button
          onClick={dismissComplete}
          aria-label="Dismiss setup complete banner"
          title="Dismiss"
          className="w-8 h-8 rounded-full flex items-center justify-center text-emerald-300/70 hover:text-foreground hover:bg-emerald-500/20 transition-colors flex-shrink-0"
        >
          <X size={16} />
        </button>
      </div>
    );
  }

  return (
    <div className="mb-6 bg-surface border border-gold/20 rounded-2xl p-5 animate-fade-in">
      <div className="flex items-start justify-between mb-4">
        <div>
          <p className="text-sm font-bold text-foreground">Get your shop ready</p>
          <p className="text-xs text-grey mt-0.5">{doneCount} of {steps.length} steps complete</p>
        </div>
        <button onClick={dismissProgress} className="text-grey hover:text-gray-300 transition-colors p-1 touch-target" aria-label="Dismiss setup guide">
          <X size={14} />
        </button>
      </div>

      {/* Progress bar */}
      <div className="w-full h-1 bg-surface-raised rounded-full mb-4 overflow-hidden">
        <div className="h-full bg-gold rounded-full transition-all duration-500"
          style={{ width: `${(doneCount / steps.length) * 100}%` }} />
      </div>

      <div className="space-y-2">
        {steps.map((step, i) => (
          <Link key={i} href={step.href}
            className={cn(
              "flex items-center gap-3 p-3 rounded-xl border transition-all group",
              step.done
                ? "border-emerald-500/20 bg-emerald-500/5 cursor-default"
                : "border-border hover:border-gold/30 hover:bg-gold/5 cursor-pointer"
            )}
            onClick={step.label === "Share your booking link" ? () => localStorage.setItem(`clipwise_shared_${shop.id}`, "1") : undefined}
          >
            <div className={cn(
              "w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-bold",
              step.done ? "bg-emerald-500/20 text-emerald-400" : "bg-gold/15 text-gold"
            )}>
              {step.done ? <Check size={12} /> : i + 1}
            </div>
            <div className="flex-1 min-w-0">
              <p className={cn("text-sm font-medium", step.done ? "text-foreground/70" : "text-foreground")}>{step.label}</p>
              <p className="text-xs text-grey truncate">{step.description}</p>
            </div>
            {step.done
              ? <span className="text-[11px] font-semibold text-emerald-400 flex-shrink-0">Done</span>
              : <ArrowRight size={14} className="text-grey group-hover:text-gold transition-colors flex-shrink-0" />}
          </Link>
        ))}
      </div>
    </div>
  );
}
