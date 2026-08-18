"use client";
import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { supabase } from "@/lib/supabase";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { cn, formatCurrency, formatDateForDb } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useSheetDrag } from "@/hooks/use-sheet-drag";
import { X, Plus, Search, Check, ChevronDown, Scissors } from "lucide-react";

/**
 * Global "New appointment" sheet. Opens INSTANTLY over whatever page you're on
 * (fired by the bottom-nav + via the `cw-open-newappt` event) and posts to the
 * SAME /api/book/in-person endpoint the calendar uses — one shared booking path,
 * no forked logic. Mounted once per portal (owner + barber).
 *
 * Client is a SEARCH: type to find an existing client (name · phone · visits) or
 * add a new one; phone + email only appear when adding someone new. Swipe the
 * sheet down to dismiss. Owner: full barber picker (or a fixed chip when the shop
 * has one barber). Barber: `lockBarber` fixes it to the logged-in barber.
 */
type BarberLite = { id: string; name: string; user_id?: string | null };
type ServiceLite = { id: string; name: string; price: number | null; duration_minutes: number | null };
type ClientLite = { id: string; name: string; phone: string | null; email: string | null; total_visits: number | null };

// Time options in the SAME display format the booking API expects ("9:00 AM").
const TIME_OPTIONS: string[] = (() => {
  const out: string[] = [];
  for (let m = 6 * 60; m <= 22 * 60; m += 15) out.push(minutesToLabel(m));
  return out;
})();
function minutesToLabel(m: number): string {
  const h24 = Math.floor(m / 60), min = m % 60;
  const ampm = h24 < 12 ? "AM" : "PM";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(min).padStart(2, "0")} ${ampm}`;
}
// Default to the next upcoming 15-min slot so a same-day walk-in never defaults
// to a time that's already passed (which the server rejects).
function nextDefaultTime(): string {
  const now = new Date();
  let m = Math.ceil((now.getHours() * 60 + now.getMinutes() + 1) / 15) * 15;
  if (m < 6 * 60) m = 6 * 60;
  if (m > 22 * 60) m = 22 * 60;
  return minutesToLabel(m);
}

const FIELD = "w-full bg-card-raised border border-border rounded-xl px-3 py-3 text-sm text-foreground placeholder:text-grey focus:outline-none focus:border-foreground/40 transition-colors";
const LABEL = "block text-xs font-medium text-grey mb-1.5";

export function AddAppointmentModal({
  shop, accessToken, lockBarber = null, preferUserId = null,
}: {
  shop: { id: string } | null;
  accessToken: string | null;
  lockBarber?: { id: string; name: string } | null;
  preferUserId?: string | null;
}) {
  const { confirm } = useConfirm();
  const [open, setOpen] = useState(false);
  const [shown, setShown] = useState(false);            // drives the slide-up + swipe transform
  const sheetRef = useRef<HTMLDivElement | null>(null);

  const [barbers, setBarbers] = useState<BarberLite[]>([]);
  const [services, setServices] = useState<ServiceLite[]>([]);
  const [clients, setClients] = useState<ClientLite[]>([]);
  const [barberId, setBarberId] = useState("");
  const [serviceIds, setServiceIds] = useState<string[]>([]);

  // Client search: `query` doubles as the client name. mode = search | existing | new.
  const [query, setQuery] = useState("");
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const [mode, setMode] = useState<"search" | "existing" | "new">("search");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");

  const [date, setDate] = useState("");
  const [time, setTime] = useState("9:00 AM");
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState("");
  const showToast = (m: string) => { setToast(m); setTimeout(() => setToast(""), 3000); };

  const reset = useCallback(() => {
    setQuery(""); setSelectedClientId(null); setMode("search"); setPhone(""); setEmail("");
    setServiceIds([]); setTime(nextDefaultTime()); setDate(formatDateForDb(new Date()));
    if (!lockBarber) setBarberId("");
  }, [lockBarber]);

  // Animated close: slide the sheet down, then unmount.
  const close = useCallback(() => {
    setShown(false);
    window.setTimeout(() => setOpen(false), 240);
  }, []);

  // Open on the global quick-add event (bottom-nav +).
  useEffect(() => {
    const openIt = () => { reset(); setOpen(true); };
    window.addEventListener("cw-open-newappt", openIt);
    return () => window.removeEventListener("cw-open-newappt", openIt);
  }, [reset]);

  // Slide up on the frame after mount (so the transform animates from off-screen).
  useEffect(() => {
    if (!open) { setShown(false); return; }
    const r = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(r);
  }, [open]);

  // Swipe-down-to-dismiss (touch), same hook the calendar sheet uses.
  const { dragY, dragging } = useSheetDrag(sheetRef, close, { enabled: open && shown && !saving });

  // Load barbers + services + clients when the sheet opens.
  useEffect(() => {
    if (!open || !shop) return;
    if (lockBarber) {
      setBarbers([lockBarber]);
      setBarberId(lockBarber.id);
    } else {
      supabase.from("barbers").select("id, name, user_id").eq("shop_id", shop.id).eq("is_active", true).order("name")
        .then(({ data }) => {
          const b = (data ?? []) as BarberLite[];
          const sorted = [...b].sort((x, y) => (x.user_id === preferUserId ? 0 : 1) - (y.user_id === preferUserId ? 0 : 1));
          setBarbers(sorted);
        });
    }
    supabase.from("services").select("id, name, price, duration_minutes").eq("shop_id", shop.id).order("name")
      .then(({ data }) => setServices((data ?? []) as ServiceLite[]));
    // Clients for the search. RLS scopes this: the owner sees the whole book; a
    // barber only sees clients they've served (phase43) — safe either way.
    supabase.from("clients").select("id, name, phone, email, total_visits").eq("shop_id", shop.id).order("total_visits", { ascending: false }).limit(500)
      .then(({ data }) => setClients((data ?? []) as ClientLite[]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, shop?.id, lockBarber, preferUserId]);

  // One-barber shop: auto-select the sole barber (shown as a fixed chip, no picker).
  useEffect(() => {
    if (lockBarber) return;
    if (barbers.length === 1) setBarberId(barbers[0].id);
  }, [barbers, lockBarber]);

  // Escape closes; lock body scroll while open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow; document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [open, close]);

  // ── Client search ──────────────────────────────────────────────────────────
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [] as ClientLite[];
    return clients.filter(c => (c.name ?? "").toLowerCase().includes(q)).slice(0, 6);
  }, [clients, query]);
  const showResults = mode === "search" && query.trim().length > 0;

  const onQueryChange = (v: string) => { setQuery(v); setSelectedClientId(null); setMode("search"); };
  const pickExisting = (c: ClientLite) => {
    setQuery(c.name ?? ""); setSelectedClientId(c.id); setPhone(c.phone ?? ""); setEmail(c.email ?? ""); setMode("existing");
  };
  const pickNew = () => { setSelectedClientId(null); setPhone(""); setEmail(""); setMode("new"); };

  // ── Services ────────────────────────────────────────────────────────────────
  const setServiceAt = (idx: number, id: string) =>
    setServiceIds(ids => { const next = [...ids]; if (idx >= next.length) next.push(id); else next[idx] = id; return next; });
  const addServiceRow = () => setServiceIds(ids => [...ids, ""]);
  const removeServiceRow = (idx: number) => setServiceIds(ids => ids.filter((_, i) => i !== idx));
  const rows = serviceIds.length ? serviceIds : [""];
  const chosenServices = useMemo(
    () => serviceIds.filter(Boolean).map(id => services.find(s => s.id === id)).filter(Boolean) as ServiceLite[],
    [serviceIds, services],
  );
  const totalDuration = chosenServices.reduce((n, s) => n + (s.duration_minutes || 0), 0);
  const totalPrice = chosenServices.reduce((n, s) => n + Number(s.price || 0), 0);

  const fixedBarber = lockBarber ?? (barbers.length === 1 ? barbers[0] : null);

  const submit = async () => {
    if (!shop) return;
    if (!barberId) { showToast("Pick a barber"); return; }
    const name = query.trim();
    const chosen = serviceIds.filter(Boolean);
    if (!name || chosen.length === 0) { showToast("Add a client and pick a service"); return; }
    const svcs = chosen.map(id => services.find(s => s.id === id)).filter(Boolean) as ServiceLite[];
    const duration = svcs.reduce((n, s) => n + (s.duration_minutes || 0), 0);
    const price = svcs.reduce((n, s) => n + Number(s.price || 0), 0);
    const send = (overrideBlock: boolean) => fetch("/api/book/in-person", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) },
      body: JSON.stringify({
        shop_id: shop.id, barber_id: barberId, service_id: svcs[0].id,
        service_ids: chosen,
        service_names: svcs.length > 1 ? svcs.map(s => s.name).join(" + ") : undefined,
        client_name: name, client_phone: phone.trim() || undefined, client_email: email.trim() || undefined,
        date, time_slot: time,
        total_amount: price, duration_minutes: duration, pay_in_person: true, confirmed: true,
        override_block: overrideBlock || undefined,
      }),
    });
    setSaving(true);
    let res = await send(false);
    let data = await res.json().catch(() => ({}));
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
    close();
    reset();
    showToast("Booked ✓");
    window.dispatchEvent(new Event("cw-appt-created"));
  };

  return (
    <>
      {/* Toast lives OUTSIDE the open-gated markup so the success message survives the close. */}
      {toast && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-[120] bg-card-raised border border-border rounded-xl px-5 py-3 text-sm text-foreground shadow-xl">{toast}</div>
      )}
      {open && (
        <>
          <div
            className="fixed inset-0 z-[70] backdrop-blur-sm transition-opacity duration-200"
            style={{ background: "rgba(0,0,0,0.6)", opacity: shown ? 1 : 0 }}
            onClick={() => !saving && close()}
          />
          <div className="fixed inset-x-0 bottom-0 sm:inset-0 z-[80] flex justify-center sm:items-center pointer-events-none sm:p-4">
            <div
              ref={sheetRef}
              style={{
                transform: shown ? `translate3d(0, ${dragY}px, 0)` : "translate3d(0, 100%, 0)",
                transition: dragging ? "none" : "transform .26s cubic-bezier(.32,.72,0,1)",
              }}
              className="pointer-events-auto w-full sm:max-w-md bg-card border-t sm:border border-border rounded-t-2xl sm:rounded-2xl shadow-2xl max-h-[90dvh] overflow-y-auto overscroll-contain px-5 pt-0 pb-[max(1rem,env(safe-area-inset-bottom))]"
            >
              {/* Grab handle — swipe the sheet down to dismiss */}
              <div className="flex justify-center pt-2.5 pb-1.5 -mx-5 cursor-grab active:cursor-grabbing" onClick={() => !saving && close()}>
                <div className="w-10 h-1.5 rounded-full bg-border" />
              </div>

              <div className="flex items-center justify-between pt-1 pb-1">
                <h2 className="text-xl font-extrabold tracking-tight text-foreground">New appointment</h2>
                <button onClick={() => !saving && close()} aria-label="Close" className="w-9 h-9 -mr-1.5 rounded-full flex items-center justify-center text-grey hover:text-foreground"><X size={19} /></button>
              </div>

              {/* Barber — a small chip when fixed (barber portal or single-barber shop),
                  a picker when the owner has several to choose from. */}
              {fixedBarber ? (
                <span className="inline-flex items-center gap-1.5 bg-card-raised border border-border text-grey text-xs font-semibold px-2.5 py-1 rounded-full mb-4">
                  <Scissors size={12} /> {fixedBarber.name}
                </span>
              ) : (
                <div className="mb-3.5 mt-1">
                  <label className={LABEL}>Barber <span className="text-emerald-400">*</span></label>
                  <div className="relative">
                    <select value={barberId} onChange={e => setBarberId(e.target.value)} className={cn(FIELD, "appearance-none pr-9")}>
                      <option value="">{barbers.length === 0 ? "No barbers" : "Select a barber"}</option>
                      {barbers.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                    </select>
                    <ChevronDown size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-grey" />
                  </div>
                </div>
              )}

              {/* Client — searchable */}
              <div className="mb-3.5">
                <label className={LABEL}>Client <span className="text-emerald-400">*</span></label>
                <div className="relative">
                  <Search size={17} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-grey" />
                  <input
                    value={query} onChange={e => onQueryChange(e.target.value)}
                    placeholder="Search or add a client"
                    className={cn(FIELD, "pl-10", mode === "existing" && "pr-9")}
                  />
                  {mode === "existing" && <Check size={17} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-emerald-400" />}
                </div>
                {showResults && (
                  <div className="mt-1.5 bg-card-raised border border-border rounded-xl overflow-hidden">
                    {matches.map(c => (
                      <button key={c.id} type="button" onClick={() => pickExisting(c)}
                        className="w-full flex items-center gap-3 px-3 py-2.5 text-left border-t border-border first:border-t-0 hover:bg-surface-overlay transition-colors">
                        <span className="w-7 h-7 rounded-full bg-surface-overlay text-foreground text-xs font-bold flex items-center justify-center flex-shrink-0">{(c.name ?? "?").charAt(0).toUpperCase()}</span>
                        <span className="min-w-0">
                          <span className="block text-sm font-semibold text-foreground truncate">{c.name}</span>
                          <span className="block text-xs text-grey truncate">{[c.phone, `${c.total_visits ?? 0} visit${(c.total_visits ?? 0) === 1 ? "" : "s"}`].filter(Boolean).join(" · ")}</span>
                        </span>
                      </button>
                    ))}
                    <button type="button" onClick={pickNew}
                      className="w-full flex items-center gap-2 px-3 py-2.5 text-left border-t border-border text-sm font-semibold text-emerald-400 hover:bg-surface-overlay transition-colors">
                      <Plus size={15} /> Add “{query.trim()}” as a new client
                    </button>
                  </div>
                )}
              </div>

              {/* Phone + email — only when adding a NEW client (an existing one already has theirs). */}
              {mode === "new" && (
                <div className="mb-3.5 space-y-2.5">
                  <input value={phone} onChange={e => setPhone(e.target.value)} placeholder="Phone (optional)" inputMode="tel" className={FIELD} />
                  <input value={email} onChange={e => setEmail(e.target.value)} placeholder="Email (optional)" inputMode="email" className={FIELD} />
                  <p className="text-xs text-grey">Optional — for their booking confirmation.</p>
                </div>
              )}

              {/* Services */}
              <div className="mb-3.5">
                <label className={LABEL}>Service <span className="text-emerald-400">*</span></label>
                <div className="space-y-2">
                  {rows.map((sid, idx) => (
                    <div key={idx} className="flex gap-2 items-center">
                      <div className="relative flex-1">
                        <select value={sid} onChange={e => setServiceAt(idx, e.target.value)} className={cn(FIELD, "appearance-none pr-9")}>
                          <option value="">Select a service</option>
                          {services.map(s => <option key={s.id} value={s.id}>{s.name} · {formatCurrency(Number(s.price))} · {s.duration_minutes}m</option>)}
                        </select>
                        <ChevronDown size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-grey" />
                      </div>
                      {(rows.length > 1 || !!sid) && (
                        <button type="button" onClick={() => removeServiceRow(idx)} aria-label="Remove service"
                          className="w-11 h-11 flex-shrink-0 rounded-xl border border-border text-grey hover:text-foreground flex items-center justify-center">
                          <X size={15} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                <button type="button" onClick={addServiceRow} className="mt-2 inline-flex items-center gap-1.5 text-sm font-semibold text-emerald-400">
                  <Plus size={15} /> Add another service
                </button>
                {chosenServices.length > 0 && (
                  <p className="text-xs text-grey mt-2">Total: {totalDuration} min · {formatCurrency(totalPrice)}</p>
                )}
              </div>

              {/* Date + Time on one row */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={LABEL}>Date</label>
                  <input type="date" value={date} min={formatDateForDb(new Date())} onChange={e => setDate(e.target.value)} className={FIELD} />
                </div>
                <div>
                  <label className={LABEL}>Time</label>
                  <div className="relative">
                    <select value={time} onChange={e => setTime(e.target.value)} className={cn(FIELD, "appearance-none pr-9")}>
                      {TIME_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                    <ChevronDown size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-grey" />
                  </div>
                </div>
              </div>

              {/* Sticky action bar */}
              <div className="sticky bottom-0 -mx-5 px-5 pt-3 mt-4 pb-[max(0.5rem,env(safe-area-inset-bottom))] bg-card border-t border-border flex gap-3">
                <Button variant="outline" className="flex-1" disabled={saving} onClick={close}>Cancel</Button>
                <Button className="flex-1" loading={saving} onClick={submit}>Add</Button>
              </div>
            </div>
          </div>
        </>
      )}
    </>
  );
}
