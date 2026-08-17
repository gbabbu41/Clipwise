"use client";
import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { cn, formatCurrency, formatDateForDb } from "@/lib/utils";
import { X, Check } from "lucide-react";

/**
 * Global "New appointment" modal. Opens INSTANTLY over whatever page you're on
 * (fired by the bottom-nav + via the `cw-open-newappt` event) — no navigating to
 * the calendar, no background page swap. It posts to the SAME /api/book/in-person
 * endpoint the calendar's add form uses, so the booking rules (double-booking
 * guard, math, dedupe) are the ONE shared server path — this modal never forks the
 * booking logic. Mounted once in the dashboard layout.
 */
type BarberLite = { id: string; name: string };
type ServiceLite = { id: string; name: string; price: number | null; duration_minutes: number | null };

// Time options in the SAME display format the booking API expects ("9:00 AM").
// Broad range — staff may book off-hours; the server is authoritative on conflicts.
const TIME_OPTIONS: string[] = (() => {
  const out: string[] = [];
  for (let m = 6 * 60; m <= 22 * 60; m += 15) {
    const h24 = Math.floor(m / 60), min = m % 60;
    const ampm = h24 < 12 ? "AM" : "PM";
    const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
    out.push(`${h12}:${String(min).padStart(2, "0")} ${ampm}`);
  }
  return out;
})();

export function AddAppointmentModal() {
  const { shop, accessToken } = useAuth();
  const { confirm } = useConfirm();
  const [open, setOpen] = useState(false);
  const [barbers, setBarbers] = useState<BarberLite[]>([]);
  const [services, setServices] = useState<ServiceLite[]>([]);
  const [barberId, setBarberId] = useState("");
  const [serviceIds, setServiceIds] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("9:00 AM");
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState("");
  const showToast = (m: string) => { setToast(m); setTimeout(() => setToast(""), 3000); };

  const reset = useCallback(() => {
    setName(""); setPhone(""); setEmail(""); setServiceIds([]); setTime("9:00 AM");
    setDate(formatDateForDb(new Date()));
  }, []);

  // Open on the global quick-add event (bottom-nav +). Instant, over the current page.
  useEffect(() => {
    const openIt = () => { reset(); setOpen(true); };
    window.addEventListener("cw-open-newappt", openIt);
    return () => window.removeEventListener("cw-open-newappt", openIt);
  }, [reset]);

  // Load barbers + services when the modal opens.
  useEffect(() => {
    if (!open || !shop) return;
    supabase.from("barbers").select("id, name").eq("shop_id", shop.id).eq("is_active", true).order("name")
      .then(({ data }) => { const b = (data ?? []) as BarberLite[]; setBarbers(b); setBarberId(prev => prev || b[0]?.id || ""); });
    supabase.from("services").select("id, name, price, duration_minutes").eq("shop_id", shop.id).order("name")
      .then(({ data }) => setServices((data ?? []) as ServiceLite[]));
  }, [open, shop]);

  // Escape closes; lock body scroll while open (own lock — the inline-rgba backdrop
  // deliberately avoids ModalChrome's bg-black selector so its iOS body-lock, which
  // breaks sheet height, never engages here).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow; document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [open]);

  const toggleService = (id: string) =>
    setServiceIds(ids => ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id]);

  const totalDuration = serviceIds.reduce((n, id) => n + (services.find(s => s.id === id)?.duration_minutes || 0), 0);
  const totalPrice = serviceIds.reduce((n, id) => n + Number(services.find(s => s.id === id)?.price || 0), 0);

  const submit = async () => {
    if (!shop) return;
    if (!barberId) { showToast("Pick a barber"); return; }
    const chosen = serviceIds.filter(Boolean);
    if (!name.trim() || chosen.length === 0) { showToast("Add a name and pick a service"); return; }
    const svcs = chosen.map(id => services.find(s => s.id === id)).filter(Boolean) as ServiceLite[];
    const duration = svcs.reduce((n, s) => n + (s.duration_minutes || 0), 0);
    const price = svcs.reduce((n, s) => n + Number(s.price || 0), 0);
    // SAME endpoint + payload shape as the calendar's add form — one shared create
    // path, so the server runs the identical double-booking guard, math and dedupe.
    const send = (overrideBlock: boolean) => fetch("/api/book/in-person", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) },
      body: JSON.stringify({
        shop_id: shop.id, barber_id: barberId, service_id: svcs[0].id,
        service_ids: chosen,
        service_names: svcs.length > 1 ? svcs.map(s => s.name).join(" + ") : undefined,
        client_name: name.trim(), client_phone: phone.trim() || undefined,
        client_email: email.trim() || undefined,
        date, time_slot: time,
        total_amount: price, duration_minutes: duration, pay_in_person: true, confirmed: true,
        override_block: overrideBlock || undefined,
      }),
    });
    setSaving(true);
    let res = await send(false);
    let data = await res.json().catch(() => ({}));
    // A deliberate break / time-off returns { blocked } — offer to book over it,
    // exactly like the calendar. A double-booking has no `blocked` flag → hard stop.
    if (!res.ok && data.blocked) {
      setSaving(false);
      const barberName = barbers.find(b => b.id === barberId)?.name ?? "That barber";
      const ok = await confirm({ message: `${barberName} has time off or a break during this slot. Book them in anyway?`, confirmText: "Book anyway" });
      if (!ok) return;
      setSaving(true);
      res = await send(true);
      data = await res.json().catch(() => ({}));
    }
    setSaving(false);
    if (!res.ok) { showToast(data.error ?? "Couldn't add the appointment"); return; }
    showToast("Booked ✓");
    setOpen(false);
    reset();
    // If the calendar is mounted underneath, let it refresh to show the new appt.
    window.dispatchEvent(new Event("cw-appt-created"));
  };

  if (!open) return null;
  return (
    <>
      {toast && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-[120] bg-card-raised border border-border rounded-xl px-5 py-3 text-sm text-foreground shadow-xl">{toast}</div>
      )}
      <div
        className="fixed inset-0 z-[70] backdrop-blur-sm animate-fade-in"
        style={{ background: "rgba(0,0,0,0.6)" }}
        onClick={() => setOpen(false)}
      />
      <div className="fixed inset-x-0 bottom-0 sm:inset-0 z-[80] sm:flex sm:items-center sm:justify-center sm:p-4">
        <div
          className="bg-card border-t sm:border border-border rounded-t-2xl sm:rounded-2xl shadow-2xl w-full sm:max-w-md max-h-[90dvh] flex flex-col pb-[max(1rem,env(safe-area-inset-bottom))] sm:pb-0 animate-slide-up"
          onClick={e => e.stopPropagation()}
        >
          <div className="flex items-center justify-between px-5 py-4 border-b border-border flex-shrink-0">
            <h2 className="text-base font-bold text-foreground">New appointment</h2>
            <button onClick={() => setOpen(false)} aria-label="Close" className="w-9 h-9 rounded-full flex items-center justify-center text-grey hover:text-foreground hover:bg-surface-overlay transition-colors"><X size={18} /></button>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-4">
            <div>
              <label className="text-xs font-semibold text-grey uppercase tracking-wide">Barber</label>
              <select value={barberId} onChange={e => setBarberId(e.target.value)}
                className="mt-1 w-full bg-card-raised border border-border rounded-xl px-3 py-2.5 text-sm text-foreground focus:outline-none focus:border-foreground">
                {barbers.length === 0 && <option value="">No barbers</option>}
                {barbers.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>

            <div>
              <label className="text-xs font-semibold text-grey uppercase tracking-wide">Service{serviceIds.length > 1 ? "s" : ""}</label>
              <div className="mt-1.5 flex flex-wrap gap-2">
                {services.map(s => {
                  const on = serviceIds.includes(s.id);
                  return (
                    <button key={s.id} type="button" onClick={() => toggleService(s.id)}
                      className={cn("px-3 py-1.5 rounded-full text-sm border transition-colors", on ? "bg-foreground text-background border-foreground" : "bg-card-raised text-foreground border-border hover:border-foreground/40")}>
                      {on && <Check size={13} className="inline -mt-0.5 mr-1" />}{s.name}
                    </button>
                  );
                })}
                {services.length === 0 && <p className="text-sm text-grey">No services yet — add one in Services first.</p>}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold text-grey uppercase tracking-wide">Date</label>
                <input type="date" value={date} onChange={e => setDate(e.target.value)}
                  className="mt-1 w-full bg-card-raised border border-border rounded-xl px-3 py-2.5 text-sm text-foreground focus:outline-none focus:border-foreground" />
              </div>
              <div>
                <label className="text-xs font-semibold text-grey uppercase tracking-wide">Time</label>
                <select value={time} onChange={e => setTime(e.target.value)}
                  className="mt-1 w-full bg-card-raised border border-border rounded-xl px-3 py-2.5 text-sm text-foreground focus:outline-none focus:border-foreground">
                  {TIME_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
            </div>

            <div className="space-y-2">
              <input value={name} onChange={e => setName(e.target.value)} placeholder="Customer name"
                className="w-full bg-card-raised border border-border rounded-xl px-3 py-2.5 text-sm text-foreground placeholder:text-grey focus:outline-none focus:border-foreground" />
              <input value={phone} onChange={e => setPhone(e.target.value)} placeholder="Phone (optional)" inputMode="tel"
                className="w-full bg-card-raised border border-border rounded-xl px-3 py-2.5 text-sm text-foreground placeholder:text-grey focus:outline-none focus:border-foreground" />
              <input value={email} onChange={e => setEmail(e.target.value)} placeholder="Email (optional)" inputMode="email"
                className="w-full bg-card-raised border border-border rounded-xl px-3 py-2.5 text-sm text-foreground placeholder:text-grey focus:outline-none focus:border-foreground" />
            </div>
          </div>

          <div className="px-5 py-4 border-t border-border flex-shrink-0">
            <button onClick={submit} disabled={saving}
              className="w-full py-3 rounded-xl bg-foreground text-background font-semibold text-sm disabled:opacity-50 transition-opacity">
              {saving ? "Booking…" : totalPrice > 0 ? `Book · ${formatCurrency(totalPrice)}${totalDuration ? ` · ${totalDuration} min` : ""}` : "Book appointment"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
