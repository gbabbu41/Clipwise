"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/lib/supabase";

// Squire-style setup nudge pinned to the bottom of the calendar: a personalized
// one-line prompt for the NEXT incomplete step + a circular % progress ring
// ("30% · 2 of 7"). A brand-new shop lands on the calendar after signup, so this
// walks them through setup one task at a time. Hides once everything's done.
interface SetupStep { key: string; prompt: string; cta: string; href: string; done: boolean }

export function CalendarSetupNudge() {
  const { shop, profile } = useAuth();
  const [steps, setSteps] = useState<SetupStep[] | null>(null);

  useEffect(() => {
    if (!shop || profile?.role !== "shop_owner") { setSteps(null); return; }
    let cancelled = false;
    (async () => {
      const [{ count: svcCount }, { data: barbers }] = await Promise.all([
        supabase.from("services").select("id", { count: "exact", head: true }).eq("shop_id", shop.id),
        supabase.from("barbers").select("id").eq("shop_id", shop.id),
      ]);
      const barberIds = (barbers ?? []).map((b: { id: string }) => b.id);
      let hasHours = false;
      if (barberIds.length) {
        const { count: tsCount } = await supabase.from("time_slots").select("id", { count: "exact", head: true }).in("barber_id", barberIds);
        hasHours = (tsCount ?? 0) > 0;
      }
      let shared = false;
      try { shared = !!localStorage.getItem(`clipwise_shared_${shop.id}`); } catch { /* ignore */ }

      const next: SetupStep[] = [
        { key: "location", prompt: "tell your clients where you work", cta: "Set business location", href: "/dashboard/settings", done: !!(shop.address && shop.address.trim()) },
        { key: "hours", prompt: "set your working hours", cta: "Set your hours", href: "/dashboard/schedule", done: hasHours },
        { key: "services", prompt: "list the services you offer", cta: "Add your services", href: "/dashboard/services", done: (svcCount ?? 0) > 0 },
        { key: "barber", prompt: "add yourself to the calendar", cta: "Add yourself as a barber", href: "/dashboard/staff", done: barberIds.length > 0 },
        { key: "logo", prompt: "add your shop logo", cta: "Add a logo", href: "/dashboard/settings", done: !!shop.logo },
        { key: "phone", prompt: "add a contact number", cta: "Add your phone number", href: "/dashboard/settings", done: !!(shop.phone && shop.phone.trim()) },
        { key: "share", prompt: "share your booking link", cta: "Share your booking link", href: "/dashboard/share", done: shared },
      ];
      if (!cancelled) setSteps(next);
    })();
    return () => { cancelled = true; };
  }, [shop, profile]);

  if (!shop || profile?.role !== "shop_owner" || !steps) return null;
  const total = steps.length;
  const done = steps.filter(s => s.done).length;
  if (done >= total) return null; // fully set up → nothing to nudge

  const next = steps.find(s => !s.done)!;
  const pct = Math.round((done / total) * 100);
  const firstName = (profile?.name || shop.name || "").split(/\s+/)[0] || "Hey";

  // Progress ring geometry.
  const R = 24, C = 2 * Math.PI * R, offset = C * (1 - done / total);

  return (
    <div className="fixed left-0 right-0 z-30 px-3 bottom-[calc(4.25rem+env(safe-area-inset-bottom)+8px)] lg:bottom-4 pointer-events-none">
      <Link href={next.href}
        className="pointer-events-auto mx-auto max-w-md bg-surface border border-border rounded-2xl px-4 py-3.5 shadow-xl shadow-black/40 flex items-center gap-4 animate-fade-in hover:border-gold/30 transition-colors">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-foreground leading-snug">{firstName}, {next.prompt}</p>
          <span className="text-sm font-semibold text-gold mt-1 inline-block">{next.cta} →</span>
        </div>
        <div className="relative flex-shrink-0" style={{ width: 60, height: 60 }}>
          <svg width="60" height="60" viewBox="0 0 60 60" className="-rotate-90">
            <circle cx="30" cy="30" r={R} fill="none" stroke="#2b2b31" strokeWidth="5" />
            <circle cx="30" cy="30" r={R} fill="none" className="text-gold" stroke="currentColor" strokeWidth="5" strokeLinecap="round" strokeDasharray={C} strokeDashoffset={offset} />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-sm font-bold text-foreground leading-none">{pct}%</span>
            <span className="text-[9px] text-grey mt-0.5">{done} of {total}</span>
          </div>
        </div>
      </Link>
    </div>
  );
}
