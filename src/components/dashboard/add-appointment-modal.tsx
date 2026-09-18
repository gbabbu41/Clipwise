"use client";
import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { supabase } from "@/lib/supabase";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { cn, formatCurrency, formatDateForDb, timeToMinutes } from "@/lib/utils";
import { clientMatchesQuery } from "@/lib/client-search";
import { requestCalendarAddContext } from "@/lib/calendar-workflow";
import { Button } from "@/components/ui/button";
import { useSheetDrag } from "@/hooks/use-sheet-drag";
import { lockScroll } from "@/lib/scroll-lock";
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

// In-memory handoff only: no client details in URLs or browser storage.
export type NewAppointmentDetail = {
  shopId: string;
  client: Pick<ClientLite, "id" | "name" | "phone" | "email">;
};

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
// "HH:MM:SS" → minutes since midnight (working hours / breaks come in this form).
function parseHHMM(s: string): number { const [h, m] = (s || "").split(":").map(Number); return (h || 0) * 60 + (m || 0); }

// Shape returned by /api/availability for one barber on the chosen day.
type BarberAvail = {
  id: string; name: string;
  start_time: string | null; end_time: string | null;
  fullDayOff: boolean;
  busy: { time_slot: string; duration: number }[];
  blocked: { start_time: string; end_time: string }[];
};
// Default to the next upcoming 15-min slot so a same-day walk-in never defaults
// to a time that's already passed (which the server rejects).
function nextDefaultTime(): string {
  const now = new Date();
  let m = Math.ceil((now.getHours() * 60 + now.getMinutes() + 1) / 15) * 15;
  if (m < 6 * 60) m = 6 * 60;
  if (m > 22 * 60) m = 22 * 60;
  return minutesToLabel(m);
}

const FIELD = "w-full h-12 bg-card-raised border border-border rounded-xl px-3 text-sm text-foreground placeholder:text-grey focus:outline-none focus:border-foreground/40 transition-colors";
const UNCERTAIN_BOOKING_MESSAGE = "This booking may have been saved. Refresh and check the calendar for the shop you were booking in before trying again.";
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
  const clientFieldRef = useRef<HTMLDivElement | null>(null); // scroll the search into view on focus

  const [barbers, setBarbers] = useState<BarberLite[]>([]);
  const [services, setServices] = useState<ServiceLite[]>([]);
  const [clients, setClients] = useState<ClientLite[]>([]);
  const [resourcesLoading, setResourcesLoading] = useState(true);
  const [resourcesError, setResourcesError] = useState("");
  const [resourceAttempt, setResourceAttempt] = useState(0);
  const [loadedResourceScope, setLoadedResourceScope] = useState("");
  const resourceScope = `${shop?.id ?? ""}:${lockBarber?.id ?? ""}:${preferUserId ?? ""}`;
  const activeResourceScope = useRef(resourceScope);
  activeResourceScope.current = resourceScope;
  const previousResourceScope = useRef(resourceScope);
  const resourcesReady = open && !resourcesLoading && !resourcesError && loadedResourceScope === resourceScope;
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
  const submitState = useRef<"idle" | "pending" | "uncertain" | "complete">("idle");
  const submitContext = useRef(0);
  const [submitError, setSubmitError] = useState("");
  const [submitUncertain, setSubmitUncertain] = useState(false);
  useEffect(() => () => { submitContext.current += 1; }, []);
  const [toast, setToast] = useState("");
  const showToast = (m: string) => { setToast(m); setTimeout(() => setToast(""), 3000); };

  const reset = useCallback(() => {
    setQuery(""); setSelectedClientId(null); setMode("search"); setPhone(""); setEmail("");
    setServiceIds([]); setTime(nextDefaultTime()); setDate(formatDateForDb(new Date()));
    if (!lockBarber) setBarberId("");
  }, [lockBarber]);

  // A location/account change must not carry this appointment draft into another scope.
  useEffect(() => {
    if (previousResourceScope.current === resourceScope) return;
    previousResourceScope.current = resourceScope;
    submitContext.current += 1;
    if (submitState.current === "pending") submitState.current = "uncertain";
    const uncertain = submitState.current === "uncertain";
    if (!uncertain) submitState.current = "idle";
    setSubmitUncertain(uncertain);
    setSubmitError(uncertain ? UNCERTAIN_BOOKING_MESSAGE : "");
    setSaving(false);
    setOpen(false);
    setShown(false);
    reset();
  }, [resourceScope, reset]);

  // Animated close: slide the sheet down, then unmount.
  const close = useCallback(() => {
    if (submitState.current === "pending") return;
    const context = submitContext.current;
    setShown(false);
    window.setTimeout(() => { if (submitContext.current === context) setOpen(false); }, 240);
  }, []);

  // Both quick-add and client-profile rebooking use this same sheet/API.
  useEffect(() => {
    const openIt = (event: Event) => {
      if (open || saving || submitState.current === "pending") return;
      const detail = (event as CustomEvent<NewAppointmentDetail | undefined>).detail;
      // A stale profile from another location must not prefill this shop's form.
      if (detail && (!shop || detail.shopId !== shop.id)) return;
      submitContext.current += 1;
      setResourcesLoading(true);
      setResourcesError("");
      setLoadedResourceScope("");
      if (submitState.current === "uncertain") { setOpen(true); return; }
      submitState.current = "idle";
      setSubmitError("");
      setSubmitUncertain(false);
      reset();
      if (!detail && shop) {
        const context = requestCalendarAddContext(shop.id);
        if (context.date) {
          setDate(context.date);
          if (context.date !== formatDateForDb(new Date())) setTime("9:00 AM");
        }
        if (!lockBarber && context.barberId) setBarberId(context.barberId);
      }
      if (detail?.client) {
        setQuery(detail.client.name);
        setSelectedClientId(detail.client.id);
        setPhone(detail.client.phone ?? "");
        setEmail(detail.client.email ?? "");
        setMode("existing");
      }
      setOpen(true);
    };
    window.addEventListener("cw-open-newappt", openIt);
    return () => window.removeEventListener("cw-open-newappt", openIt);
  }, [reset, shop?.id, open, saving, lockBarber]);

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
    if (!open) return;
    if (!shop) {
      setResourcesLoading(false);
      setResourcesError("Choose a shop before adding an appointment.");
      setLoadedResourceScope("");
      return;
    }
    let cancelled = false;
    const current = () => !cancelled && activeResourceScope.current === resourceScope;
    setResourcesLoading(true);
    setResourcesError("");
    setLoadedResourceScope("");
    setBarbers([]);
    setServices([]);
    setClients([]);
    (async () => {
      try {
        const [barberResult, serviceResult, clientResult] = await Promise.all([
          lockBarber ? Promise.resolve({ data: [lockBarber], error: null }) :
            supabase.from("barbers").select("id, name, user_id").eq("shop_id", shop.id).eq("is_active", true).order("name"),
          supabase.from("services").select("id, name, price, duration_minutes").eq("shop_id", shop.id).order("name"),
          // Keep existing RLS-scoped client visibility and search limit.
          supabase.from("clients").select("id, name, phone, email, total_visits").eq("shop_id", shop.id).order("total_visits", { ascending: false }).limit(500),
        ]);
        if (!current()) return;
        if (barberResult.error || serviceResult.error || clientResult.error || !barberResult.data || !serviceResult.data || !clientResult.data) {
          throw new Error("Appointment options lookup failed");
        }
        const b = barberResult.data as BarberLite[];
        const sorted = [...b].sort((x, y) => (x.user_id === preferUserId ? 0 : 1) - (y.user_id === preferUserId ? 0 : 1));
        setBarbers(sorted);
        setServices(serviceResult.data as ServiceLite[]);
        setClients(clientResult.data as ClientLite[]);
        if (lockBarber) setBarberId(lockBarber.id);
        else {
          const mine = sorted.find(x => !!preferUserId && x.user_id === preferUserId);
          if (mine) setBarberId(prev => prev || mine.id);
        }
        setLoadedResourceScope(resourceScope);
      } catch {
        if (current()) setResourcesError("Couldn't load appointment options. Please retry before booking.");
      } finally {
        if (current()) setResourcesLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, shop?.id, lockBarber, preferUserId, resourceScope, resourceAttempt]);
  // One-barber shop: auto-select the sole barber (shown as a fixed chip, no picker).
  useEffect(() => {
    if (lockBarber) return;
    if (barbers.length === 1) setBarberId(barbers[0].id);
  }, [barbers, lockBarber]);

  // Escape closes; lock body scroll while open (shared ref-counted lock so it
  // composes with a confirm dialog / ModalChrome without stranding the page).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("keydown", onKey);
    const releaseScroll = lockScroll();
    return () => { window.removeEventListener("keydown", onKey); releaseScroll(); };
  }, [open, close]);

  // ── Client search ──────────────────────────────────────────────────────────
  const matches = useMemo(() => {
    if (!query.trim()) return [] as ClientLite[];
    return clients.filter(c => clientMatchesQuery(c, query)).slice(0, 6);
  }, [clients, query]);
  const showResults = mode === "search" && query.trim().length > 0;

  const onQueryChange = (v: string) => {
    // Abandoning an existing client must also discard their hidden contact data.
    if (mode === "existing") { setPhone(""); setEmail(""); }
    setQuery(v); setSelectedClientId(null); setMode("search");
  };
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

  // ── Real-time availability for the picked barber + date ─────────────────────
  // The Time list must reflect the CHOSEN day: refetch whenever the barber or
  // date changes so past + already-booked slots are disabled and breaks / days
  // off are flagged — the owner is never offered a time the server would reject.
  const [avail, setAvail] = useState<BarberAvail | null>(null);
  const [availLoading, setAvailLoading] = useState(false);
  const availReq = useRef(0);
  useEffect(() => {
    if (!open || !shop || !barberId || !date) { setAvail(null); return; }
    const reqId = ++availReq.current;
    setAvailLoading(true);
    fetch("/api/availability", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ shop_id: shop.id, date, barber_id: barberId }),
    })
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        if (reqId !== availReq.current) return; // a newer date/barber superseded this
        const b = ((d?.barbers ?? []) as BarberAvail[]).find(x => x.id === barberId) ?? null;
        setAvail(b);
      })
      .catch(() => { if (reqId === availReq.current) setAvail(null); })
      .finally(() => { if (reqId === availReq.current) setAvailLoading(false); });
  }, [open, shop?.id, barberId, date]);

  // Per-time status for the chosen day/barber, sized to the picked service(s).
  // disabled = the server would reject it (past / double-booked); a tag flags an
  // overridable reason (break / day off / outside posted hours).
  const slotDuration = totalDuration > 0 ? totalDuration : 30;
  const slotStatuses = useMemo(() => {
    const map = new Map<string, { disabled: boolean; tag: string }>();
    const isToday = date === formatDateForDb(new Date());
    const now = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes();
    for (const t of TIME_OPTIONS) {
      const tm = timeToMinutes(t);
      const end = tm + slotDuration;
      if (!avail) { map.set(t, { disabled: false, tag: "" }); continue; }
      if (isToday && tm <= nowMin) { map.set(t, { disabled: true, tag: "past" }); continue; }
      const booked = (avail.busy ?? []).some(b => { const bs = timeToMinutes(b.time_slot); return tm < bs + (b.duration || 30) && bs < end; });
      if (booked) { map.set(t, { disabled: true, tag: "booked" }); continue; }
      if (avail.fullDayOff) { map.set(t, { disabled: false, tag: "day off" }); continue; }
      const inBreak = (avail.blocked ?? []).some(bl => { const s = parseHHMM(bl.start_time), e = parseHHMM(bl.end_time); return tm < e && s < end; });
      if (inBreak) { map.set(t, { disabled: false, tag: "break" }); continue; }
      if (avail.start_time && avail.end_time) {
        const ws = parseHHMM(avail.start_time), we = parseHHMM(avail.end_time);
        if (tm < ws || end > we) { map.set(t, { disabled: false, tag: "off hours" }); continue; }
      } else {
        map.set(t, { disabled: false, tag: "off hours" }); continue;
      }
      map.set(t, { disabled: false, tag: "" });
    }
    return map;
  }, [avail, slotDuration, date]);

  const anyFree = useMemo(() => TIME_OPTIONS.some(t => !slotStatuses.get(t)?.disabled), [slotStatuses]);

  // If the picked time becomes unbookable after a date/barber/service change,
  // jump to the first open slot so the field never shows a rejected time.
  useEffect(() => {
    if (slotStatuses.get(time)?.disabled) {
      const firstFree = TIME_OPTIONS.find(t => !slotStatuses.get(t)?.disabled);
      if (firstFree && firstFree !== time) setTime(firstFree);
    }
  }, [slotStatuses, time]);

  const submit = async () => {
    if (!resourcesReady) return;
    if (submitState.current !== "idle" || activeResourceScope.current !== resourceScope) return;
    if (!shop) return;
    if (!barberId || !barbers.some(b => b.id === barberId)) { showToast("Pick a barber"); return; }
    const name = query.trim();
    const chosen = serviceIds.filter(Boolean);
    if (!name || chosen.length === 0) { showToast("Add a client and pick a service"); return; }
    const svcs = chosen.map(id => services.find(s => s.id === id)).filter(Boolean) as ServiceLite[];
    if (svcs.length !== chosen.length) { showToast("Please choose services from the current list."); return; }
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
    submitState.current = "pending";
    const context = submitContext.current;
    const current = () => submitContext.current === context && activeResourceScope.current === resourceScope;
    const uncertain = () => {
      submitState.current = "uncertain";
      if (current()) { setSubmitUncertain(true); setSubmitError(UNCERTAIN_BOOKING_MESSAGE); }
    };
    // Only these explicit endpoint responses establish rejection before a write
    // or rejection of the insert by the DB. Unknown statuses/bodies stay uncertain.
    const knownErrors: Record<number, string[]> = {
      400: ["Missing required fields", "That time has already passed — please pick a future time.", "One or more selected services are unavailable.", "That date is beyond this shop's booking window.", "That barber isn't part of this shop."],
      403: ["This shop isn't accepting bookings.", "This shop isn't accepting bookings right now.", "This shop requires a card to book online."],
      409: ["Sorry, that time was just booked. Please pick another slot.", "Sorry, that time is fully booked. Please pick another slot.", "That time was just booked — please pick another slot."],
      429: ["Too many requests — please slow down and try again shortly.", "You already have several bookings with this shop for that day. Please call the shop if you need to add more."],
    };
    const rejected = (status: number, data: Record<string, unknown> | null) =>
      typeof data?.error === "string" && ((status === 409 && data.blocked === true) || knownErrors[status]?.includes(data.error));
    const readReply = async (res: Response): Promise<Record<string, unknown> | null> => {
      try {
        const data: unknown = await res.json();
        return data && typeof data === "object" ? data as Record<string, unknown> : null;
      } catch { return null; }
    };
    let requestMayHaveSaved = false;
    setSaving(true);
    setSubmitError("");
    try {
      requestMayHaveSaved = true;
      let res = await send(false);
      let data = await readReply(res);
      if (!current()) return;
      if (!res.ok && res.status === 409 && data?.blocked === true && typeof data.error === "string") {
        requestMayHaveSaved = false;
        const barberName = barbers.find(b => b.id === barberId)?.name ?? "That barber";
        const ok = await confirm({ message: `${barberName} has time off or a break during this slot. Book them in anyway?`, confirmText: "Book anyway" });
        if (!current()) return;
        if (!ok) { submitState.current = "idle"; return; }
        requestMayHaveSaved = true;
        res = await send(true);
        data = await readReply(res);
        if (!current()) return;
      }
      if (!res.ok) {
        if (rejected(res.status, data)) {
          requestMayHaveSaved = false;
          submitState.current = "idle";
          setSubmitError(data!.error as string);
        } else uncertain();
        return;
      }
      if (typeof data?.id !== "string" || !data.id.trim()) { uncertain(); return; }
      requestMayHaveSaved = false;
      submitState.current = "complete";
      close();
      reset();
      showToast("Booked ✓");
      window.dispatchEvent(new Event("cw-appt-created"));
    } catch {
      if (requestMayHaveSaved) uncertain();
      else if (current() && submitState.current !== "complete") {
        submitState.current = "idle";
        setSubmitError("Couldn't continue the booking. Please try again.");
      }
    } finally {
      if (submitState.current === "pending") submitState.current = "uncertain";
      if (current()) setSaving(false);
    }
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

              {/* Header — the fixed barber rides in the header (next to Close) so it
                  doesn't need its own row; a multi-barber owner gets a picker below. */}
              <div className="flex items-center justify-between gap-2 pt-1 pb-1">
                <h2 className="text-xl font-extrabold tracking-tight text-foreground truncate">New appointment</h2>
                <div className="flex items-center gap-2 flex-none">
                  {resourcesReady && fixedBarber && (
                    <span className="inline-flex items-center gap-1.5 max-w-[8.5rem] bg-card-raised border border-border text-grey text-xs font-semibold px-2.5 py-1 rounded-full">
                      <Scissors size={12} className="flex-none" /> <span className="truncate">{fixedBarber.name}</span>
                    </span>
                  )}
                  <button onClick={() => !saving && close()} aria-label="Close" className="w-9 h-9 -mr-1.5 rounded-full flex items-center justify-center text-grey hover:text-foreground"><X size={19} /></button>
                </div>
              </div>

              {submitError && <p role="alert" className="mt-3 text-sm text-amber-400">{submitError}</p>}
              {!resourcesReady ? (
                <div className="py-6 text-sm text-grey" role={resourcesError ? "alert" : "status"}>
                  <p>{resourcesError || "Loading appointment options…"}</p>
                  {resourcesError && <Button variant="outline" className="mt-3" onClick={() => setResourceAttempt(value => value + 1)}>Retry loading</Button>}
                </div>
              ) : (<fieldset disabled={saving || submitUncertain} className="min-w-0">
              {/* Barber picker — only when the owner has several to choose from. */}
              {!fixedBarber && (
                <div className="mb-3.5 mt-1">
                  <div className="relative">
                    <select value={barberId} onChange={e => setBarberId(e.target.value)} className={cn(FIELD, "appearance-none pr-9")}>
                      <option value="">{barbers.length === 0 ? "No barbers" : "Select a barber"}</option>
                      {barbers.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                    </select>
                    <ChevronDown size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-grey" />
                  </div>
                </div>
              )}

              {/* Client — searchable (the search field + placeholder name it, so no
                  separate label). */}
              <div className="mb-3.5" ref={clientFieldRef} style={{ scrollMarginTop: 8 }}>
                <div className="relative">
                  <Search size={17} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-grey" />
                  <input
                    value={query} onChange={e => onQueryChange(e.target.value)}
                    // Focusing pops the keyboard, which eats the bottom half of the
                    // sheet. Scroll the Client field to the top so the results list
                    // sits in the space that's left, not behind the keyboard/status
                    // bar. Delayed so it runs AFTER the keyboard has animated in.
                    onFocus={() => { if (window.innerWidth >= 640) return; window.setTimeout(() => clientFieldRef.current?.scrollIntoView({ block: "start", behavior: "smooth" }), 300); }}
                    placeholder="Search or add a client"
                    className={cn(FIELD, "pl-10", mode === "existing" && "pr-9")}
                  />
                  {mode === "existing" && <Check size={17} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-emerald-400" />}
                </div>
                {showResults && (
                  <div className="mt-1.5 bg-card-raised border border-border rounded-xl overflow-y-auto overscroll-contain max-h-[min(45vh,320px)]">
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

              {/* Services — the "Select a service" placeholder names the field. */}
              <div className="mb-3.5">
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
                          className="w-12 h-12 flex-shrink-0 rounded-xl border border-border text-grey hover:text-foreground flex items-center justify-center">
                          <X size={15} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                {/* "Add another service" only appears once a first service is picked. */}
                {chosenServices.length > 0 && (
                  <button type="button" onClick={addServiceRow} className="mt-2 inline-flex items-center gap-1.5 text-sm font-semibold text-emerald-400">
                    <Plus size={15} /> Add another service
                  </button>
                )}
                {chosenServices.length > 0 && (
                  <p className="text-xs text-grey mt-2">Total: {totalDuration} min · {formatCurrency(totalPrice)}</p>
                )}
              </div>

              {/* Date + Time on one row — the Time list reflects the chosen day. */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={LABEL}>Date</label>
                  <input type="date" value={date} min={formatDateForDb(new Date())} onChange={e => setDate(e.target.value)} className={cn(FIELD, "text-left [&::-webkit-date-and-time-value]:text-left")} />
                </div>
                <div>
                  <label className={LABEL}>Time</label>
                  <div className="relative">
                    <select value={time} onChange={e => setTime(e.target.value)} className={cn(FIELD, "appearance-none pr-9")}>
                      {TIME_OPTIONS.map(t => {
                        const st = slotStatuses.get(t);
                        return <option key={t} value={t} disabled={st?.disabled}>{t}{st?.tag ? ` · ${st.tag}` : ""}</option>;
                      })}
                    </select>
                    <ChevronDown size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-grey" />
                  </div>
                </div>
              </div>
              {/* Availability hint for the chosen barber + day. */}
              {barberId && (
                <p className="mt-1.5 text-xs min-h-[1rem]">
                  {availLoading ? (
                    <span className="text-grey">Checking {fixedBarber?.name ?? "availability"}…</span>
                  ) : avail?.fullDayOff ? (
                    <span className="text-amber-400">Off this day — you can still book them in.</span>
                  ) : avail && !anyFree ? (
                    <span className="text-amber-400">Fully booked this day — try another date.</span>
                  ) : avail ? (
                    <span className="text-grey">Taken times are greyed out for this day.</span>
                  ) : null}
                </p>
              )}

              </fieldset>)}
              {/* Sticky action bar */}
              <div className="sticky bottom-0 -mx-5 px-5 pt-3 mt-4 pb-[max(0.5rem,env(safe-area-inset-bottom))] bg-card border-t border-border flex gap-3">
                <Button variant="outline" className="flex-1" disabled={saving} onClick={close}>{submitUncertain ? "Close" : "Cancel"}</Button>
                <Button className="flex-1" loading={saving} disabled={!resourcesReady || submitUncertain} onClick={submit}>Add</Button>
              </div>
            </div>
          </div>
        </>
      )}
    </>
  );
}
