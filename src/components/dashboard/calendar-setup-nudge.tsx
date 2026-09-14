"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import { X, Settings, Clock, Scissors, ArrowRight } from "lucide-react";
import { useAuth } from "@/lib/auth-context";

// A compact, dismissible "finish setup" nudge pinned to the bottom of the
// calendar (above the mobile tab bar). A brand-new shop lands on the calendar
// after signup, so this points them at the essentials — shop name & address,
// working hours, and services — without a big card taking over the screen.
// Shows only for an owner whose shop still has no address (a clean proxy for
// "not set up yet"); hides once that's filled or the owner dismisses it.
export function CalendarSetupNudge() {
  const { shop, profile } = useAuth();
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    if (!shop) return;
    try { setDismissed(!!localStorage.getItem(`cw_cal_setup_dismissed_${shop.id}`)); }
    catch { setDismissed(false); }
  }, [shop]);

  if (!shop || profile?.role !== "shop_owner") return null;
  const hasAddress = !!(shop.address && shop.address.trim());
  if (hasAddress || dismissed) return null;

  const dismiss = () => {
    try { localStorage.setItem(`cw_cal_setup_dismissed_${shop.id}`, "1"); } catch { /* ignore */ }
    setDismissed(true);
  };

  const links = [
    { href: "/dashboard/settings", icon: Settings, label: "Name & address" },
    { href: "/dashboard/schedule", icon: Clock, label: "Your hours" },
    { href: "/dashboard/services", icon: Scissors, label: "Services" },
  ];

  return (
    <div className="fixed left-0 right-0 z-30 px-3 bottom-[calc(4.25rem+env(safe-area-inset-bottom)+8px)] lg:bottom-4 pointer-events-none">
      <div className="pointer-events-auto mx-auto max-w-md bg-surface border border-gold/25 rounded-2xl p-3.5 shadow-xl shadow-black/40 animate-fade-in">
        <div className="flex items-start justify-between gap-2 mb-2.5">
          <div>
            <p className="text-sm font-bold text-foreground">Finish setting up {shop.name}</p>
            <p className="text-xs text-grey mt-0.5">Add your details so customers can find and book you.</p>
          </div>
          <button onClick={dismiss} aria-label="Dismiss setup" className="text-grey hover:text-foreground p-0.5 flex-shrink-0">
            <X size={15} />
          </button>
        </div>
        <div className="flex gap-2">
          {links.map(({ href, icon: Icon, label }) => (
            <Link key={href} href={href}
              className="flex-1 flex flex-col items-center gap-1.5 rounded-xl border border-border bg-card-raised hover:border-gold/40 hover:bg-gold/5 transition-colors py-2.5 px-1 text-center group">
              <Icon size={16} className="text-gold" />
              <span className="text-[11px] font-medium text-foreground leading-tight">{label}</span>
            </Link>
          ))}
        </div>
        <Link href="/onboarding" className="mt-2.5 flex items-center justify-center gap-1 text-[11px] font-medium text-grey hover:text-gold transition-colors">
          Or run the full guided setup <ArrowRight size={11} />
        </Link>
      </div>
    </div>
  );
}
