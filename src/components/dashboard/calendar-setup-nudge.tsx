"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/lib/supabase";
import { SetupSheet } from "./setup-sheet";
import { canPromptPaymentSetup } from "@/lib/setup-prompts";

// Squire-style setup nudge on the calendar with a smart completion flow:
//   • LOCATION + HOURS are the essentials — they keep coming back until actually
//     done (dismissing only snoozes them for the session).
//   • Every other step is a one-time nudge: once tapped it's resolved forever
//     (stored per shop) and never returns.
//   • The card is dismissible; once no essential is left it hides for good.
interface SetupStep { key: string; prompt: string; cta: string; href: string; done: boolean }
const MAJOR = new Set(["location", "hours"]);

export function CalendarSetupNudge() {
  const { shop, profile } = useAuth();
  const [steps, setSteps] = useState<SetupStep[] | null>(null);
  const [sheet, setSheet] = useState<"location" | "hours" | null>(null);
  const [skips, setSkips] = useState<Set<string>>(new Set());
  const [snoozed, setSnoozed] = useState(false);
  const [hidden, setHidden] = useState(false);
  const router = useRouter();

  // Load per-shop flags (tapped-minor skips, permanent hide, session snooze).
  useEffect(() => {
    if (!shop) return;
    try {
      setSkips(new Set((localStorage.getItem(`cw_setup_skips_${shop.id}`) || "").split(",").filter(Boolean)));
      setHidden(!!localStorage.getItem(`cw_setup_hide_${shop.id}`));
      setSnoozed(!!sessionStorage.getItem(`cw_setup_snooze_${shop.id}`));
    } catch { /* storage blocked — show the card */ }
  }, [shop]);

  useEffect(() => {
    if (!shop || profile?.role !== "shop_owner") { setSteps(null); return; }
    setSteps(null);
    let cancelled = false;
    (async () => {
      const [{ count: svcCount, error: servicesError }, { data: barbers, error: barbersError }] = await Promise.all([
        supabase.from("services").select("id", { count: "exact", head: true }).eq("shop_id", shop.id),
        supabase.from("barbers").select("id").eq("shop_id", shop.id),
      ]);
      if (servicesError || barbersError) return; // unavailable is not "not set up"
      const barberIds = (barbers ?? []).map((b: { id: string }) => b.id);
      let hasHours = false;
      if (barberIds.length) {
        const { count: tsCount, error: hoursError } = await supabase.from("time_slots").select("id", { count: "exact", head: true }).in("barber_id", barberIds);
        if (hoursError) return;
        hasHours = (tsCount ?? 0) > 0;
      }
      let shared = false;
      try { shared = !!localStorage.getItem(`clipwise_shared_${shop.id}`); } catch { /* ignore */ }

      const list: SetupStep[] = [
        { key: "location", prompt: "tell your clients where you work", cta: "Set business location", href: "/dashboard/settings", done: !!(shop.address && shop.address.trim()) },
        { key: "hours", prompt: "set your working hours", cta: "Set your hours", href: "/dashboard/schedule", done: hasHours },
        { key: "services", prompt: "list the services you offer", cta: "Add your services", href: "/dashboard/services", done: (svcCount ?? 0) > 0 },
        { key: "barber", prompt: "add yourself to the calendar", cta: "Add yourself as a barber", href: "/dashboard/staff", done: barberIds.length > 0 },
        { key: "logo", prompt: "add your shop logo", cta: "Add a logo", href: "/dashboard/settings", done: !!shop.logo },
        { key: "phone", prompt: "add a contact number", cta: "Add your phone number", href: "/dashboard/settings", done: !!(shop.phone && shop.phone.trim()) },
        ...(canPromptPaymentSetup(shop) ? [{ key: "payments", prompt: "connect payments to accept cards", cta: "Set up customer payments", href: "/onboarding/stripe-connect", done: shop.stripe_connected === true }] : []),
        { key: "share", prompt: "share your booking link", cta: "Share your booking link", href: "/dashboard/share", done: shared },
      ];
      if (!cancelled) setSteps(list);
    })().catch(() => { /* Don't show incorrect setup advice after a failed read. */ });
    return () => { cancelled = true; };
  }, [shop, profile]);

  if (!shop || profile?.role !== "shop_owner" || !steps) return null;

  // A minor step counts as resolved once tapped; a major only when actually done.
  const isResolved = (s: SetupStep) => s.done || (!MAJOR.has(s.key) && skips.has(s.key));
  const total = steps.length;
  const doneCount = steps.filter(isResolved).length;
  const next = steps.find(s => !isResolved(s));
  const majorOpen = steps.some(s => MAJOR.has(s.key) && !s.done);

  if (!next) return null;                       // everything handled
  if (snoozed) return null;                     // dismissed this session (majors return next session)
  if (hidden && !majorOpen) return null;        // permanently dismissed & nothing essential left

  const pct = Math.round((doneCount / total) * 100);
  const displayName = (profile?.name || shop.name || "").trim() || "Hey";
  const R = 25, C = 2 * Math.PI * R, ARC = 0.75, frac = doneCount / total;

  const openNext = () => {
    if (MAJOR.has(next.key)) { setSheet(next.key as "location" | "hours"); return; }
    // Minor step → resolve it forever, then go do it.
    const ns = new Set(skips); ns.add(next.key);
    setSkips(ns);
    try { localStorage.setItem(`cw_setup_skips_${shop.id}`, Array.from(ns).join(",")); } catch { /* ignore */ }
    router.push(next.href);
  };

  const dismiss = () => {
    if (majorOpen) {
      // Essentials still pending → only snooze; they come back next session.
      try { sessionStorage.setItem(`cw_setup_snooze_${shop.id}`, "1"); } catch { /* ignore */ }
      setSnoozed(true);
    } else {
      try { localStorage.setItem(`cw_setup_hide_${shop.id}`, "1"); } catch { /* ignore */ }
      setHidden(true);
    }
  };

  return (
    <>
      <div className="fixed left-0 right-0 z-30 px-3 bottom-[calc(4.25rem+env(safe-area-inset-bottom)+8px)] lg:bottom-4 pointer-events-none">
        <div className="pointer-events-auto mx-auto max-w-2xl relative bg-surface border border-border rounded-2xl shadow-xl shadow-black/40 animate-fade-in">
          <button type="button" onClick={openNext} className="w-full text-left px-5 py-4 pr-10 flex items-center gap-4">
            <div className="flex-1 min-w-0">
              <p className="text-[15px] font-bold text-foreground leading-snug">{displayName}, {next.prompt}</p>
              <span className="text-[15px] font-semibold mt-1.5 inline-block" style={{ color: "#0A84FF" }}>{next.cta}</span>
            </div>
            <div className="relative flex-shrink-0" style={{ width: 68, height: 68 }}>
              <svg width="68" height="68" viewBox="0 0 68 68" style={{ transform: "rotate(135deg)", transformOrigin: "center" }}>
                <circle cx="34" cy="34" r={R} fill="none" stroke="#2b2b31" strokeWidth="6" strokeLinecap="round" strokeDasharray={`${ARC * C} ${(1 - ARC) * C}`} />
                <circle cx="34" cy="34" r={R} fill="none" stroke="#0A84FF" strokeWidth="6" strokeLinecap="round" strokeDasharray={`${frac * ARC * C} ${C}`} />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-lg font-extrabold text-foreground leading-none">{pct}%</span>
                <span className="text-[9px] font-semibold tracking-wide text-grey mt-1">{doneCount} OF {total}</span>
              </div>
            </div>
          </button>
          <button type="button" onClick={dismiss} aria-label="Dismiss" className="absolute top-2.5 right-2.5 text-grey hover:text-foreground p-1 rounded-full">
            <X size={15} />
          </button>
        </div>
      </div>
      {sheet && <SetupSheet step={sheet} onClose={() => setSheet(null)} />}
    </>
  );
}
