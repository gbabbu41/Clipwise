"use client";
import { useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from "@/lib/supabase";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { formatCurrency, formatDateForDb } from "@/lib/utils";
import { Input, Select } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { X, Plus } from "lucide-react";

/**
 * Global "New appointment" modal. Opens INSTANTLY over whatever page you're on
 * (fired by the bottom-nav + via the `cw-open-newappt` event) — no navigating to
 * the calendar, no background page swap. It posts to the SAME /api/book/in-person
 * endpoint the calendar's add form uses, so the booking rules (double-booking
 * guard, math, dedupe) are the ONE shared server path — this modal never forks the
 * booking logic. Its look mirrors the calendar's tap-to-add sheet on purpose so
 * both entry points feel identical. Mounted once per portal (owner + barber).
 *
 * Owner: full barber picker. Barber: `lockBarber` fixes it to the logged-in barber
 * (no picker), and `canAdd={false}` shows a "contact your shop" message instead of
 * the form (for a barber without the manage_appointments permission).
 */
type BarberLite = { id: string; name: string; user_id?: string | null };
type ServiceLite = { id: string; name: string; price: number | null; duration_minutes: number | null };

// Time options in the SAME display format the booking API expects ("9:00 AM").
// Broad range — staff may book off-hours; the server is authoritative on conflicts.
const TIME_OPTIONS: string[] = (() => {
  const out: string[] = [];
  for (let m = 6 * 60; m <= 22 * 60; m += 15) {
    out.push(minutesToLabel(m));
  }
  return out;
})();

function minutesToLabel(m: number): string {
  const h24 = Math.floor(m / 60), min = m % 60;
  const ampm = h24 < 12 ? "AM" : "PM";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(min).padStart(2, "0")} ${ampm}`;
}

// Default the time to the next upcoming 15-min slot (so booking a walk-in TODAY
// doesn't default to a slot that's already passed — the #1 reason a same-day add
// used to fail the server's past-time guard). Clamped to the 6 AM–10 PM range.
function nextDefaultTime(): string {
  const now = new Date();
  let m = Math.ceil((now.getHours() * 60 + now.getMinutes() + 1) / 15) * 15;
  if (m < 6 * 60) m = 6 * 60;
  if (m > 22 * 60) m = 22 * 60;
  return minutesToLabel(m);
}

export function AddAppointmentModal({
  shop, accessToken, canAdd = true, lockBarber = null, preferUserId = null,
}: {
  shop: { id: string } | null;
  accessToken: string | null;
  canAdd?: boolean;                                   // false → show "contact your shop" message instead of the form
  lockBarber?: { id: string; name: string } | null;  // barber mode: fix to this barber, hide the picker
  preferUserId?: string | null;                       // owner's user id — their own barber row sorts to the top
}) {
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
    setName(""); setPhone(""); setEmail(""); setServiceIds([]); setTime(nextDefaultTime());
    setDate(formatDateForDb(new Date()));
    if (!lockBarber) setBarberId("");   // owner must actively pick — never pre-filled
  }, [lockBarber]);

  // Open on the global quick-add event (bottom-nav +). Instant, over the current page.
  useEffect(() => {
    const openIt = () => { reset(); setOpen(true); };
    window.addEventListener("cw-open-newappt", openIt);
    return () => window.removeEventListener("cw-open-newappt", openIt);
  }, [reset]);

  // Load barbers + services when the modal opens (skipped when the barber isn't
  // allowed — then we only show the "contact your shop" message).
  useEffect(() => {
    if (!open || !shop || !canAdd) return;
    if (lockBarber) {
      setBarbers([lockBarber]);
      setBarberId(lockBarber.id);
    } else {
      // Load barbers name-sorted, then float the logged-in owner's OWN barber row
      // to the top (stable sort keeps the rest alphabetical). No pre-selection —
      // the owner must actively choose (submit blocks with "Pick a barber").
      supabase.from("barbers").select("id, name, user_id").eq("shop_id", shop.id).eq("is_active", true).order("name")
        .then(({ data }) => {
          const b = (data ?? []) as BarberLite[];
          const sorted = [...b].sort((x, y) =>
            (x.user_id === preferUserId ? 0 : 1) - (y.user_id === preferUserId ? 0 : 1));
          setBarbers(sorted);
        });
    }
    supabase.from("services").select("id, name, price, duration_minutes").eq("shop_id", shop.id).order("name")
      .then(({ data }) => setServices((data ?? []) as ServiceLite[]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, shop?.id, canAdd, lockBarber, preferUserId]);

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

  // Service dropdown rows (mirrors the calendar's add sheet). At least one empty
  // row is always shown; "Add another service" appends for a combined appointment.
  const setServiceAt = (idx: number, id: string) =>
    setServiceIds(ids => { const next = [...ids]; if (idx >= next.length) next.push(id); else next[idx] = id; return next; });
  const addServiceRow = () => setServiceIds(ids => [...ids, ""]);
  const removeServiceRow = (idx: number) => setServiceIds(ids => ids.filter((_, i) => i !== idx));

  const chosenServices = useMemo(
    () => serviceIds.filter(Boolean).map(id => services.find(s => s.id === id)).filter(Boolean) as ServiceLite[],
    [serviceIds, services],
  );
  const totalDuration = chosenServices.reduce((n, s) => n + (s.duration_minutes || 0), 0);
  const totalPrice = chosenServices.reduce((n, s) => n + Number(s.price || 0), 0);

  const close = () => { setOpen(false); };

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
    // Close first, THEN toast — the toast lives outside the open-gated markup so it
    // survives the close and the "Booked ✓" confirmation is actually seen.
    setOpen(false);
    reset();
    showToast("Booked ✓");
    // If the calendar is mounted underneath, let it refresh to show the new appt.
    window.dispatchEvent(new Event("cw-appt-created"));
  };

  // Service rows: always render at least one row so the picker is never empty.
  const rows = serviceIds.length ? serviceIds : [""];

  return (
    <>
      {/* Toast lives OUTSIDE the open-gated markup so a success message survives the
          modal closing (it used to unmount with the modal and never show). */}
      {toast && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-[120] bg-card-raised border border-border rounded-xl px-5 py-3 text-sm text-foreground shadow-xl">{toast}</div>
      )}
      {open && (
        <>
          <div
            className="fixed inset-0 z-[70] backdrop-blur-sm animate-fade-in"
            style={{ background: "rgba(0,0,0,0.6)" }}
            onClick={() => !saving && close()}
          />
          <div className="fixed inset-x-0 bottom-0 sm:inset-0 z-[80] flex justify-center sm:items-center pointer-events-none sm:p-4">
            <div className="pointer-events-auto w-full sm:max-w-md bg-card-raised border-t sm:border border-border rounded-t-2xl sm:rounded-2xl shadow-2xl pb-0 max-h-[90vh] overflow-y-auto overscroll-contain px-6 pt-0 space-y-2 cw-modal-compact animate-slide-up">
              {/* Grab handle — tap to dismiss (mirrors the calendar sheet) */}
              <div onClick={() => !saving && close()} className="flex justify-center pt-2.5 pb-1.5 -mx-6 cursor-pointer">
                <div className="w-10 h-1.5 rounded-full bg-border" />
              </div>
              <div className="flex items-center justify-between">
                <h3 className="text-base font-bold text-foreground">New appointment</h3>
                <button onClick={() => !saving && close()} aria-label="Close" className="text-grey hover:text-foreground"><X size={18} /></button>
              </div>

              {!canAdd ? (
                <div className="py-6 text-center">
                  <p className="text-sm font-semibold text-foreground mb-1.5">Adding appointments isn&apos;t enabled for your account</p>
                  <p className="text-sm text-grey mb-6">Ask your shop owner to turn on appointment access for you.</p>
                  <div className="sticky bottom-0 -mx-6 px-6 pt-3 pb-[max(1.25rem,env(safe-area-inset-bottom))] bg-card-raised border-t border-border">
                    <Button className="w-full" onClick={close}>Got it</Button>
                  </div>
                </div>
              ) : (
              <>
              {/* Barber — a fixed name box in barber mode (mirrors the calendar's
                  tapped-column box); a picker for the owner's global add. */}
              {lockBarber ? (
                <div className="bg-card-raised rounded-xl px-3 py-2 text-xs text-grey">
                  <p><span className="text-grey">Barber:</span> {lockBarber.name}</p>
                </div>
              ) : (
                <Select label="Barber *" value={barberId} onChange={e => setBarberId(e.target.value)}>
                  <option value="">{barbers.length === 0 ? "No barbers" : "Select a barber"}</option>
                  {barbers.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                </Select>
              )}

              <Input label="Client name *" value={name}
                onChange={e => setName(e.target.value)} placeholder="Marcus Johnson" />
              <Input label="Phone" value={phone}
                onChange={e => setPhone(e.target.value)} placeholder="506-555-0000" inputMode="tel" />
              <Input label="Email" type="email" value={email}
                onChange={e => setEmail(e.target.value)} placeholder="name@email.com"
                hint="Optional — we'll email them a booking confirmation" inputMode="email" />

              {/* Services — dropdown rows; "+" adds another for a combined appointment */}
              <div>
                <label className="block text-xs font-medium text-grey mb-1">Services * <span className="text-grey-muted font-normal">(add one or more)</span></label>
                <div className="space-y-2">
                  {rows.map((sid, idx) => (
                    <div key={idx} className="flex gap-2 items-center">
                      <Select value={sid} className="flex-1" onChange={e => setServiceAt(idx, e.target.value)}>
                        <option value="">Select a service</option>
                        {services.map(s => (
                          <option key={s.id} value={s.id}>{s.name} · {formatCurrency(Number(s.price))} · {s.duration_minutes}m</option>
                        ))}
                      </Select>
                      {(rows.length > 1 || !!sid) && (
                        <button type="button" onClick={() => removeServiceRow(idx)} aria-label="Remove service"
                          className="w-9 h-9 flex-shrink-0 rounded-xl border border-border text-grey hover:text-foreground hover:border-foreground flex items-center justify-center">
                          <X size={15} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                <button type="button" onClick={addServiceRow}
                  className="mt-2 inline-flex items-center gap-1.5 text-sm font-medium text-accent-soft hover:text-foreground">
                  <Plus size={15} /> Add another service
                </button>
                {chosenServices.length > 0 && (
                  <p className="text-xs text-grey mt-1.5">Total: {totalDuration} min · {formatCurrency(totalPrice)}</p>
                )}
              </div>

              {/* Date + time. Defaults to today + the next upcoming slot. */}
              <Input label="Date" type="date" value={date}
                min={formatDateForDb(new Date())}
                onChange={e => setDate(e.target.value)} />
              <Select label="Time" value={time} onChange={e => setTime(e.target.value)}>
                {TIME_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
              </Select>

              {/* Sticky action bar — pinned above the home indicator (safe-area) so
                  the primary actions are never clipped on an installed PWA. */}
              <div className="sticky bottom-0 -mx-6 px-6 pt-3 pb-[max(1.25rem,env(safe-area-inset-bottom))] bg-card-raised border-t border-border flex gap-2">
                <Button variant="outline" className="flex-1" disabled={saving} onClick={close}>Cancel</Button>
                <Button className="flex-1" loading={saving} onClick={submit}>Add</Button>
              </div>
              </>
              )}
            </div>
          </div>
        </>
      )}
    </>
  );
}
