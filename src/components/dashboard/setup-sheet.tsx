"use client";
import { useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";

// Inline setup forms opened from the calendar setup card (Squire-style): fill in
// the step right here instead of being dumped into Settings.
//   • location → writes shop address/city/province/postal/phone
//   • hours    → writes weekly time_slots for the shop's barber(s); if the owner
//                has no chair yet, adds them as a barber first (commission 0),
//                so a brand-new solo shop can set hours in one go.
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const inputCls = "w-full bg-surface-sunken border border-border-strong rounded-xl px-3 py-2.5 text-sm text-foreground placeholder:text-grey focus:outline-none focus:border-foreground";

export function SetupSheet({ step, onClose }: { step: "location" | "hours"; onClose: () => void }) {
  const { shop, user, profile, accessToken, refreshShop } = useAuth();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const [loc, setLoc] = useState({
    address: shop?.address ?? "", city: shop?.city ?? "", province: shop?.province ?? "NB",
    postal_code: shop?.postal_code ?? "", phone: shop?.phone ?? "",
  });
  const [hours, setHours] = useState(DAYS.map((_, i) => ({ open: i >= 1 && i <= 6, start: "09:00", end: i <= 5 ? "19:00" : "17:00" })));

  if (!shop) return null;

  const saveLocation = async () => {
    if (!loc.address.trim()) { setError("Please enter your street address."); return; }
    setSaving(true); setError("");
    const { error: err } = await supabase.from("shops").update({
      address: loc.address.trim(),
      city: loc.city.trim() || null,
      province: (loc.province || "").trim() || null,
      postal_code: loc.postal_code.trim() || null,
      phone: loc.phone.trim() || null,
    }).eq("id", shop.id);
    setSaving(false);
    if (err) { setError("Couldn't save — please try again."); return; }
    try { await refreshShop(); } catch { /* re-synced on next load */ }
    onClose();
  };

  const saveHours = async () => {
    setSaving(true); setError("");
    try {
      // Hours attach to a barber. A brand-new solo shop has none yet — add the
      // owner as their own chair first (same call the self-barber banner uses).
      let { data: barbers } = await supabase.from("barbers").select("id").eq("shop_id", shop.id);
      if (!barbers || barbers.length === 0) {
        if (!user?.email || !accessToken) { setError("Session expired — please sign in again."); setSaving(false); return; }
        const res = await fetch("/api/admin/barber/invite", {
          method: "POST",
          headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
          body: JSON.stringify({ name: profile?.name || user.email.split("@")[0] || "Me", email: user.email, commission_percent: 0, shop_id: shop.id }),
        });
        const d = await res.json().catch(() => ({}));
        if (!res.ok || !d.barber) { setError(d.error || "Couldn't set up your chair. Please try again."); setSaving(false); return; }
        barbers = [{ id: d.barber.id }];
      }
      const slots = hours
        .map((h, idx) => h.open ? { day_of_week: idx, start_time: `${h.start}:00`, end_time: `${h.end}:00`, is_available: true } : null)
        .filter((x): x is { day_of_week: number; start_time: string; end_time: string; is_available: boolean } => x !== null);
      for (const b of barbers) {
        await supabase.from("time_slots").delete().eq("barber_id", b.id);
        if (slots.length) {
          const { error: e2 } = await supabase.from("time_slots").insert(slots.map(s => ({ ...s, barber_id: b.id })));
          if (e2) throw e2;
        }
      }
      try { await refreshShop(); } catch { /* re-synced on next load */ }
      onClose();
    } catch { setError("Couldn't save your hours — please try again."); }
    finally { setSaving(false); }
  };

  return (
    <>
      <div className="fixed inset-0 bg-black/70 z-[60]" onClick={onClose} />
      <div className="fixed inset-x-0 bottom-0 z-[61] bg-surface border-t border-border rounded-t-3xl p-5 pb-[calc(20px+env(safe-area-inset-bottom))] max-h-[85vh] overflow-y-auto animate-fade-in">
        <div className="mx-auto max-w-lg">
          <div className="flex items-center justify-between mb-1">
            <h2 className="text-lg font-bold text-white">{step === "location" ? "Business location" : "Your working hours"}</h2>
            <button onClick={onClose} aria-label="Close" className="text-grey hover:text-white p-1"><X size={18} /></button>
          </div>
          <p className="text-xs text-grey mb-4">{step === "location" ? "So clients know where to find you." : "When you're open for bookings."}</p>
          {error && <div className="mb-3 text-sm text-red-400">{error}</div>}

          {step === "location" ? (
            <div className="space-y-3">
              <div><label className="text-xs text-grey block mb-1.5">Street address</label><input className={inputCls} value={loc.address} onChange={e => setLoc(p => ({ ...p, address: e.target.value }))} placeholder="123 Main St" autoFocus /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="text-xs text-grey block mb-1.5">City</label><input className={inputCls} value={loc.city} onChange={e => setLoc(p => ({ ...p, city: e.target.value }))} placeholder="Moncton" /></div>
                <div><label className="text-xs text-grey block mb-1.5">Province</label><input className={inputCls} value={loc.province} onChange={e => setLoc(p => ({ ...p, province: e.target.value }))} placeholder="NB" /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="text-xs text-grey block mb-1.5">Postal code</label><input className={inputCls} value={loc.postal_code} onChange={e => setLoc(p => ({ ...p, postal_code: e.target.value }))} placeholder="E1C 1A1" /></div>
                <div><label className="text-xs text-grey block mb-1.5">Phone</label><input className={inputCls} value={loc.phone} onChange={e => setLoc(p => ({ ...p, phone: e.target.value }))} placeholder="(506) 555-0123" /></div>
              </div>
              <Button className="w-full" size="lg" loading={saving} onClick={saveLocation}>Save location</Button>
            </div>
          ) : (
            <div className="space-y-2.5">
              {DAYS.map((d, i) => (
                <div key={d} className="flex items-center gap-3">
                  <button type="button" onClick={() => setHours(h => h.map((x, idx) => idx === i ? { ...x, open: !x.open } : x))}
                    className={cn("w-11 h-6 rounded-full relative transition-colors flex-shrink-0", hours[i].open ? "bg-gold" : "bg-surface-raised border border-border")}>
                    <span className={cn("absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all", hours[i].open ? "left-[22px]" : "left-0.5")} />
                  </button>
                  <span className="text-sm text-white w-20 flex-shrink-0">{d}</span>
                  {hours[i].open ? (
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <input type="time" className={inputCls} value={hours[i].start} onChange={e => setHours(h => h.map((x, idx) => idx === i ? { ...x, start: e.target.value } : x))} />
                      <span className="text-grey text-xs flex-shrink-0">to</span>
                      <input type="time" className={inputCls} value={hours[i].end} onChange={e => setHours(h => h.map((x, idx) => idx === i ? { ...x, end: e.target.value } : x))} />
                    </div>
                  ) : <span className="text-sm text-grey flex-1">Closed</span>}
                </div>
              ))}
              <Button className="w-full mt-2" size="lg" loading={saving} onClick={saveHours}>Save hours</Button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
