"use client";

/**
 * WaitlistAssignSheet — assign a waitlist entry to a barber + open slot.
 *
 * Used by BOTH waitlists so the flow is identical:
 *  · Online "smart" waitlist (Waitlist Requests) — books via /api/waitlist/accept
 *    (the default), marking the appointment_waitlist row converted.
 *  · Walk-in / kiosk queue — pass `onBook` to do the walk-in booking instead,
 *    plus `services` to show a service picker and `allowBarberSwitch` so the
 *    shop can reassign to whichever barber is actually free today.
 *
 * Open slots come from /api/availability (same source as the public booking
 * page) so only genuinely-free times show — and past times drop off for today.
 * Bottom sheet on phones, centred modal on tablet/desktop.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  cn, prettyDate, getSlotsInRange, generate24hSlots,
  timeToMinutes, dbTimeToDisplay, occupiedSlots, formatCurrency,
} from "@/lib/utils";
import { useSheetDrag } from "@/hooks/use-sheet-drag";
import type { Service } from "@/lib/database.types";

type AvailBarber = {
  id: string; name: string;
  start_time: string | null; end_time: string | null; fullDayOff: boolean;
  busy: { time_slot: string; duration: number }[];
  blocked: { start_time: string; end_time: string }[];
};

export interface WaitlistRequest {
  id: string;
  shop_id: string;
  barber_id: string | null;
  service_id: string | null;
  client_name: string;
  desired_date: string;
}

// Local date math on YYYY-MM-DD strings (no UTC drift from toISOString).
function addDaysStr(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(y, m - 1, d + n);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}
function todayLocalStr(): string {
  const t = new Date();
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
}
function niceDay(dateStr: string): string {
  return new Date(dateStr + "T00:00:00").toLocaleDateString("en-CA", { weekday: "short", month: "short", day: "numeric" });
}

export function WaitlistAssignSheet({
  request, slotInterval = 30, accessToken, services, allowBarberSwitch = false,
  onClose, onDone, onBook,
}: {
  request: WaitlistRequest;
  slotInterval?: number;
  accessToken: string | null;
  /** When provided, shows a service picker (walk-in needs one for price/time). */
  services?: Service[];
  /** Always show the barber dropdown so the shop can reassign by availability. */
  allowBarberSwitch?: boolean;
  onClose: () => void;
  onDone: (msg: string) => void;
  /** Custom booking (walk-in). Return an error string, or null on success. */
  onBook?: (args: { barberId: string; slot: string; serviceId: string | null }) => Promise<string | null>;
}) {
  const [shown, setShown] = useState(false);
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const bookingInFlight = useRef(false);
  const bookingBlocked = useRef(false);
  const close = () => { if (bookingInFlight.current) return; setShown(false); setTimeout(onClose, 280); };
  const { dragY, dragging } = useSheetDrag(sheetRef, close);

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [availabilityRetry, setAvailabilityRetry] = useState(0);
  const availabilityKey = JSON.stringify([request.id, request.shop_id, request.desired_date, request.barber_id, allowBarberSwitch]);
  const [loadedAvailabilityKey, setLoadedAvailabilityKey] = useState("");
  const availabilityReady = loadedAvailabilityKey === availabilityKey && !loading && !loadError;
  const [barbers, setBarbers] = useState<AvailBarber[]>([]);
  const [barberId, setBarberId] = useState<string | null>(request.barber_id);
  const [serviceId, setServiceId] = useState<string | null>(request.service_id ?? services?.[0]?.id ?? null);
  const [slot, setSlot] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [err, setErr] = useState("");
  const showSwitch = allowBarberSwitch || !request.barber_id;

  // Multi-day "next opening" — ONLINE waitlist (accept path) only. A walk-in
  // (onBook) is always same-day, so it stays locked to the one day.
  const multiDay = !onBook;
  const [selectedDate, setSelectedDate] = useState(request.desired_date);
  const [extraDays, setExtraDays] = useState<Record<string, AvailBarber[]>>({});
  const [scanState, setScanState] = useState<"idle" | "scanning" | "done">("idle");
  const todayStr = useMemo(() => todayLocalStr(), []);
  // Barbers for the day currently shown: the requested day is the primary fetch;
  // other days come from the forward-scan cache.
  const dayBarbers = useMemo(
    () => (selectedDate === request.desired_date ? barbers : (extraDays[selectedDate] ?? [])),
    [selectedDate, barbers, extraDays, request.desired_date],
  );

  useEffect(() => { const t = setTimeout(() => setShown(true), 10); return () => clearTimeout(t); }, []);

  // Open slots for any barber on the desired day — pure, so we can use it both to
  // render the grid AND to choose a sensible default barber (one that's free).
  const slotsFor = useMemo(() => (b: AvailBarber | null, dateStr: string): string[] => {
    if (!b || b.fullDayOff || !b.start_time || !b.end_time) return [];
    const blocked = new Set<string>();
    for (const o of b.blocked) {
      const bs = timeToMinutes(dbTimeToDisplay(o.start_time));
      const be = timeToMinutes(dbTimeToDisplay(o.end_time));
      for (const s of generate24hSlots(slotInterval)) { const m = timeToMinutes(s); if (m >= bs && m < be) blocked.add(s); }
    }
    const booked = [...b.busy.flatMap(a => occupiedSlots(a.time_slot, a.duration, slotInterval)), ...Array.from(blocked)];
    return getSlotsInRange(b.start_time, b.end_time, new Date(dateStr + "T00:00:00"), booked, slotInterval)
      .filter(s => s.available).map(s => s.slot);
  }, [slotInterval]);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      setLoadError("");
      setBarbers([]);
      setSlot(null);
      try {
        // When the shop may reassign, fetch every barber's availability so the
        // dropdown can offer whoever's free — not just the customer's pick.
        const fetchBarber = allowBarberSwitch ? null : (request.barber_id ?? null);
        const r = await fetch("/api/availability", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ shop_id: request.shop_id, date: request.desired_date, barber_id: fetchBarber }),
        });
        if (!r.ok) throw new Error("Availability unavailable");
        const d = await r.json();
        if (!alive) return;
        if (!d || !Array.isArray(d.barbers)) throw new Error("Invalid availability");
        const list = d.barbers as AvailBarber[];
        if (list.some(b => !b || typeof b.id !== "string" || !Array.isArray(b.busy) || !Array.isArray(b.blocked) ||
          b.busy.some(a => !a || typeof a.time_slot !== "string" || typeof a.duration !== "number" || !Number.isFinite(a.duration)) ||
          b.blocked.some(o => !o || typeof o.start_time !== "string" || typeof o.end_time !== "string"))) {
          throw new Error("Invalid availability");
        }
        setBarbers(list);
        // Default selection: keep a valid current pick; otherwise prefer the
        // customer's chosen barber, then the first barber that actually has open
        // slots, then just the first — so the sheet doesn't open on "no time".
        setBarberId(prev => {
          if (prev && list.some(b => b.id === prev)) return prev;
          const preferred = request.barber_id ? list.find(b => b.id === request.barber_id) : null;
          const withSlots = list.find(b => slotsFor(b, request.desired_date).length > 0);
          return preferred?.id ?? withSlots?.id ?? list[0]?.id ?? null;
        });
      } catch {
        if (!alive) return;
        setBarbers([]);
        setSlot(null);
        setLoadError("Couldn't load open slots. Please try again.");
      } finally {
        if (alive) { setLoadedAvailabilityKey(availabilityKey); setLoading(false); }
      }
    })();
    return () => { alive = false; };
  }, [request.shop_id, request.desired_date, request.barber_id, allowBarberSwitch, slotsFor, availabilityKey, availabilityRetry]);

  const active = useMemo(() => dayBarbers.find(b => b.id === barberId) ?? dayBarbers[0] ?? null, [dayBarbers, barberId]);
  const openSlots = useMemo(() => (active ? slotsFor(active, selectedDate) : []), [slotsFor, active, selectedDate]);
  // Drop a chosen slot if it's no longer offered (e.g. after switching barber/day).
  useEffect(() => { setSlot(s => (s && openSlots.includes(s) ? s : null)); }, [openSlots]);

  // Keep the selected barber valid for whichever day is shown.
  useEffect(() => {
    if (!multiDay || dayBarbers.length === 0 || dayBarbers.some(b => b.id === barberId)) return;
    const withSlots = dayBarbers.find(b => slotsFor(b, selectedDate).length > 0);
    setBarberId(withSlots?.id ?? dayBarbers[0]?.id ?? null);
  }, [multiDay, dayBarbers, barberId, selectedDate, slotsFor]);

  // Reset the day scan whenever the request / scope changes.
  useEffect(() => { setSelectedDate(request.desired_date); setExtraDays({}); setScanState("idle"); }, [availabilityKey, request.desired_date]);

  // When the requested day is full for EVERY barber, scan the next ~10 days and
  // surface the ones that actually have openings (the owner-chosen behavior).
  const requestedFull = availabilityReady && barbers.length > 0 && barbers.every(b => slotsFor(b, request.desired_date).length === 0);
  useEffect(() => {
    if (!multiDay || scanState !== "idle" || !requestedFull) return;
    let alive = true;
    setScanState("scanning");
    (async () => {
      const base = request.desired_date > todayStr ? request.desired_date : todayStr;
      const days = Array.from({ length: 10 }, (_, i) => addDaysStr(base, i + 1));
      const fetchBarber = allowBarberSwitch ? null : (request.barber_id ?? null);
      const found = await Promise.all(days.map(async (d): Promise<readonly [string, AvailBarber[] | null]> => {
        try {
          const r = await fetch("/api/availability", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ shop_id: request.shop_id, date: d, barber_id: fetchBarber }),
          });
          if (!r.ok) return [d, null];
          const j = await r.json();
          if (!j || !Array.isArray(j.barbers)) return [d, null];
          const list = j.barbers as AvailBarber[];
          if (list.some(b => !b || typeof b.id !== "string" || !Array.isArray(b.busy) || !Array.isArray(b.blocked))) return [d, null];
          return [d, list];
        } catch { return [d, null]; }
      }));
      if (!alive) return;
      const map: Record<string, AvailBarber[]> = {};
      for (const [d, list] of found) if (list) map[d] = list;
      setExtraDays(map);
      const firstOpen = days.find(d => map[d]?.some(b => slotsFor(b, d).length > 0));
      if (firstOpen) setSelectedDate(firstOpen);
      setScanState("done");
    })();
    return () => { alive = false; };
  }, [multiDay, scanState, requestedFull, allowBarberSwitch, request.shop_id, request.desired_date, request.barber_id, todayStr, slotsFor]);

  // Day chips: the requested day (if not past) + scanned days that have openings.
  const dayOptions = useMemo(() => {
    const opts: string[] = [];
    if (request.desired_date >= todayStr) opts.push(request.desired_date);
    for (const d of Object.keys(extraDays).sort()) {
      if (d !== request.desired_date && extraDays[d]?.some(b => slotsFor(b, d).length > 0)) opts.push(d);
    }
    return opts;
  }, [extraDays, request.desired_date, todayStr, slotsFor]);

  const book = async () => {
    if (!availabilityReady || !barberId || !slot || busy || bookingInFlight.current || bookingBlocked.current) return;
    if (services && services.length > 0 && !serviceId) { setErr("Pick a service."); return; }
    bookingInFlight.current = true;
    setBusy(true); setErr("");
    try {
      if (onBook) {
        const error = await onBook({ barberId, slot, serviceId });
        if (error) { setErr(error); return; }
        if (error !== null) throw new Error("Unconfirmed booking");
      } else {
        const r = await fetch("/api/waitlist/accept", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) },
          body: JSON.stringify({ waitlist_id: request.id, barber_id: barberId, time_slot: slot, service_id: serviceId, date: selectedDate }),
        });
        const d = await r.json().catch(() => null);
        if (r.status >= 500 || !d) throw new Error("Unconfirmed booking");
        if (!r.ok || d.error) { setErr(typeof d.error === "string" ? d.error : "Couldn't book that slot."); return; }
        if (d.ok !== true || typeof d.appointment_id !== "string" || !d.appointment_id) throw new Error("Unconfirmed booking");
      }
      // Keep repeat clicks blocked during the sheet's closing animation too.
      bookingBlocked.current = true;
      onDone(onBook ? "Assigned · added to the schedule" : "Booked · waitlist cleared");
      bookingInFlight.current = false;
      close();
    } catch {
      bookingBlocked.current = true;
      setUncertain(true);
      setErr("Could not confirm the booking. Close this form and refresh the calendar and waitlist before trying again; it may already be booked.");
    } finally {
      bookingInFlight.current = false;
      setBusy(false);
    }
  };

  return (
    <>
      <div className={cn("fixed inset-0 bg-black/60 backdrop-blur-sm z-[70] transition-opacity duration-300", shown ? "opacity-100" : "opacity-0")} onClick={close} />
      <div className="fixed inset-x-0 bottom-0 sm:inset-0 z-[80] flex justify-center sm:items-center pointer-events-none sm:p-4">
        <div ref={sheetRef}
          style={{ transform: shown ? `translate3d(0,${dragY}px,0)` : "translate3d(0,100%,0)", transition: dragging ? "none" : "transform 0.28s cubic-bezier(.32,.72,0,1)" }}
          className="pointer-events-auto w-full sm:max-w-md bg-card-raised border-t sm:border border-border rounded-t-2xl sm:rounded-2xl shadow-2xl pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:pb-5 max-h-[85vh] overflow-y-auto overscroll-contain">
          <div onClick={close} className="flex justify-center pt-3 pb-2 cursor-grab active:cursor-grabbing">
            <div className="w-10 h-1.5 rounded-full bg-[#3a3a3a]" />
          </div>
          <div className="px-5 pb-4">
            <h3 className="text-base font-bold text-foreground">Assign {request.client_name}</h3>
            <p className="text-xs text-grey mt-0.5">{prettyDate(request.desired_date)} · pick a barber &amp; open slot</p>

            {showSwitch && barbers.length > 1 && (
              <div className="mt-3">
                <label className="text-[10px] font-semibold uppercase tracking-wider text-grey block mb-1">Barber</label>
                <select disabled={busy || uncertain} value={barberId ?? ""} onChange={e => { setBarberId(e.target.value); setSlot(null); }}
                  className="w-full bg-card-raised border border-border rounded-lg px-3 py-2.5 text-sm text-foreground focus:outline-none focus:border-white [color-scheme:dark]">
                  {barbers.map(b => <option key={b.id} value={b.id}>{b.name}{b.fullDayOff ? " — off today" : ""}</option>)}
                </select>
              </div>
            )}

            {services && services.length > 0 && (
              <div className="mt-3">
                <label className="text-[10px] font-semibold uppercase tracking-wider text-grey block mb-1">Service</label>
                <select disabled={busy || uncertain} value={serviceId ?? ""} onChange={e => setServiceId(e.target.value || null)}
                  className="w-full bg-card-raised border border-border rounded-lg px-3 py-2.5 text-sm text-foreground focus:outline-none focus:border-white [color-scheme:dark]">
                  <option value="">Select a service</option>
                  {services.map(s => <option key={s.id} value={s.id}>{s.name} — {formatCurrency(s.price)}</option>)}
                </select>
              </div>
            )}

            {/* Day picker — only appears (online waitlist) once the scan has found
                the requested day full and surfaced the next days with openings. */}
            {multiDay && dayOptions.length > 0 && (scanState === "done" || dayOptions.length > 1) && (
              <div className="mt-3">
                <label className="text-[10px] font-semibold uppercase tracking-wider text-grey block mb-1">Day</label>
                {requestedFull && selectedDate !== request.desired_date && (
                  <p className="text-xs text-amber-400 mb-1.5">{niceDay(request.desired_date)} is full — showing the next opening.</p>
                )}
                <div className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                  {dayOptions.map(d => (
                    <button key={d} type="button" disabled={busy || uncertain} onClick={() => { setSelectedDate(d); setSlot(null); }}
                      className={cn("shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors",
                        selectedDate === d ? "bg-white text-black border-white" : "bg-card-raised text-[#ccc] border-border hover:border-border")}>
                      {niceDay(d)}{d === request.desired_date ? " · requested" : ""}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="mt-3">
              <label className="text-[10px] font-semibold uppercase tracking-wider text-grey block mb-1">Open slots{multiDay ? ` · ${niceDay(selectedDate)}` : ""}</label>
              {loading || loadedAvailabilityKey !== availabilityKey ? (
                <p className="text-sm text-grey py-6 text-center">Loading open slots…</p>
              ) : loadError ? (
                <div className="py-4 text-center" role="alert">
                  <p className="text-sm text-grey">{loadError}</p>
                  <button type="button" disabled={busy || uncertain} onClick={() => { setLoading(true); setAvailabilityRetry(n => n + 1); }}
                    className="mt-2 text-sm text-foreground underline disabled:opacity-40">Retry loading slots</button>
                </div>
              ) : multiDay && scanState === "scanning" ? (
                <p className="text-sm text-grey py-6 text-center">{niceDay(request.desired_date)} is full — finding the next open day…</p>
              ) : openSlots.length === 0 ? (
                <p className="text-sm text-grey py-6 text-center">No open slots{allowBarberSwitch ? " left today" : " that day"}. Pick another barber{multiDay ? ", day," : ""} or free up time.</p>
              ) : (
                <div className="grid grid-cols-3 gap-2">
                  {openSlots.map(s => (
                    <button key={s} type="button" disabled={busy || uncertain} onClick={() => setSlot(s)}
                      className={cn("py-2.5 rounded-lg text-sm font-medium border transition-colors",
                        slot === s ? "bg-white text-black border-white" : "bg-card-raised text-[#ccc] border-border hover:border-border")}>
                      {s}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {err && <p className="text-xs text-rose-400 mt-3">{err}</p>}

            <button type="button" disabled={!availabilityReady || !slot || busy || uncertain} onClick={book}
              className="mt-4 w-full rounded-xl bg-[#00e5a0] text-black text-sm font-bold py-3 disabled:opacity-40 transition-opacity">
              {busy ? "Booking…" : slot ? `Book ${slot}` : "Pick a slot"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
