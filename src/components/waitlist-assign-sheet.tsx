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
  const close = () => { setShown(false); setTimeout(onClose, 280); };
  const { dragY, dragging } = useSheetDrag(sheetRef, close);

  const [loading, setLoading] = useState(true);
  const [barbers, setBarbers] = useState<AvailBarber[]>([]);
  const [barberId, setBarberId] = useState<string | null>(request.barber_id);
  const [serviceId, setServiceId] = useState<string | null>(request.service_id ?? services?.[0]?.id ?? null);
  const [slot, setSlot] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const showSwitch = allowBarberSwitch || !request.barber_id;

  useEffect(() => { const t = setTimeout(() => setShown(true), 10); return () => clearTimeout(t); }, []);

  // Open slots for any barber on the desired day — pure, so we can use it both to
  // render the grid AND to choose a sensible default barber (one that's free).
  const slotsFor = useMemo(() => (b: AvailBarber | null): string[] => {
    if (!b || b.fullDayOff || !b.start_time || !b.end_time) return [];
    const blocked = new Set<string>();
    for (const o of b.blocked) {
      const bs = timeToMinutes(dbTimeToDisplay(o.start_time));
      const be = timeToMinutes(dbTimeToDisplay(o.end_time));
      for (const s of generate24hSlots(slotInterval)) { const m = timeToMinutes(s); if (m >= bs && m < be) blocked.add(s); }
    }
    const booked = [...b.busy.flatMap(a => occupiedSlots(a.time_slot, a.duration, slotInterval)), ...Array.from(blocked)];
    return getSlotsInRange(b.start_time, b.end_time, new Date(request.desired_date + "T00:00:00"), booked, slotInterval)
      .filter(s => s.available).map(s => s.slot);
  }, [slotInterval, request.desired_date]);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        // When the shop may reassign, fetch every barber's availability so the
        // dropdown can offer whoever's free — not just the customer's pick.
        const fetchBarber = allowBarberSwitch ? null : (request.barber_id ?? null);
        const r = await fetch("/api/availability", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ shop_id: request.shop_id, date: request.desired_date, barber_id: fetchBarber }),
        });
        const d = r.ok ? await r.json() : { barbers: [] };
        if (!alive) return;
        const list = (d.barbers ?? []) as AvailBarber[];
        setBarbers(list);
        // Default selection: keep a valid current pick; otherwise prefer the
        // customer's chosen barber, then the first barber that actually has open
        // slots, then just the first — so the sheet doesn't open on "no time".
        setBarberId(prev => {
          if (prev && list.some(b => b.id === prev)) return prev;
          const preferred = request.barber_id ? list.find(b => b.id === request.barber_id) : null;
          const withSlots = list.find(b => slotsFor(b).length > 0);
          return preferred?.id ?? withSlots?.id ?? list[0]?.id ?? null;
        });
      } finally { if (alive) setLoading(false); }
    })();
    return () => { alive = false; };
  }, [request.shop_id, request.desired_date, request.barber_id, allowBarberSwitch, slotsFor]);

  const active = useMemo(() => barbers.find(b => b.id === barberId) ?? null, [barbers, barberId]);
  const openSlots = useMemo(() => slotsFor(active), [slotsFor, active]);
  // Drop a chosen slot if it's no longer offered (e.g. after switching barber).
  useEffect(() => { setSlot(s => (s && openSlots.includes(s) ? s : null)); }, [openSlots]);

  const book = async () => {
    if (!barberId || !slot || busy) return;
    if (services && services.length > 0 && !serviceId) { setErr("Pick a service."); return; }
    setBusy(true); setErr("");
    if (onBook) {
      const error = await onBook({ barberId, slot, serviceId });
      setBusy(false);
      if (error) { setErr(error); return; }
      onDone("Assigned · added to the schedule");
      close();
      return;
    }
    const r = await fetch("/api/waitlist/accept", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) },
      body: JSON.stringify({ waitlist_id: request.id, barber_id: barberId, time_slot: slot, service_id: serviceId }),
    });
    const d = await r.json().catch(() => ({ error: "Network error" }));
    setBusy(false);
    if (!r.ok || d.error) { setErr(d.error || "Couldn't book that slot."); return; }
    onDone("Booked · waitlist cleared");
    close();
  };

  return (
    <>
      <div className={cn("fixed inset-0 bg-black/60 backdrop-blur-sm z-[70] transition-opacity duration-300", shown ? "opacity-100" : "opacity-0")} onClick={close} />
      <div className="fixed inset-x-0 bottom-0 sm:inset-0 z-[80] flex justify-center sm:items-center pointer-events-none sm:p-4">
        <div ref={sheetRef}
          style={{ transform: shown ? `translate3d(0,${dragY}px,0)` : "translate3d(0,100%,0)", transition: dragging ? "none" : "transform 0.28s cubic-bezier(.32,.72,0,1)" }}
          className="pointer-events-auto w-full sm:max-w-md bg-[#111] border-t sm:border border-[#2a2a2a] rounded-t-2xl sm:rounded-2xl shadow-2xl pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:pb-5 max-h-[85vh] overflow-y-auto overscroll-contain">
          <div onClick={close} className="flex justify-center pt-3 pb-2 cursor-grab active:cursor-grabbing">
            <div className="w-10 h-1.5 rounded-full bg-[#3a3a3a]" />
          </div>
          <div className="px-5 pb-4">
            <h3 className="text-base font-bold text-white">Assign {request.client_name}</h3>
            <p className="text-xs text-[#888] mt-0.5">{prettyDate(request.desired_date)} · pick a barber &amp; open slot</p>

            {showSwitch && barbers.length > 1 && (
              <div className="mt-3">
                <label className="text-[10px] font-semibold uppercase tracking-wider text-[#8f8f8f] block mb-1">Barber</label>
                <select value={barberId ?? ""} onChange={e => { setBarberId(e.target.value); setSlot(null); }}
                  className="w-full bg-[#141414] border border-[#2a2a2a] rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-white [color-scheme:dark]">
                  {barbers.map(b => <option key={b.id} value={b.id}>{b.name}{b.fullDayOff ? " — off today" : ""}</option>)}
                </select>
              </div>
            )}

            {services && services.length > 0 && (
              <div className="mt-3">
                <label className="text-[10px] font-semibold uppercase tracking-wider text-[#8f8f8f] block mb-1">Service</label>
                <select value={serviceId ?? ""} onChange={e => setServiceId(e.target.value || null)}
                  className="w-full bg-[#141414] border border-[#2a2a2a] rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-white [color-scheme:dark]">
                  <option value="">Select a service</option>
                  {services.map(s => <option key={s.id} value={s.id}>{s.name} — {formatCurrency(s.price)}</option>)}
                </select>
              </div>
            )}

            <div className="mt-3">
              <label className="text-[10px] font-semibold uppercase tracking-wider text-[#8f8f8f] block mb-1">Open slots</label>
              {loading ? (
                <p className="text-sm text-[#8f8f8f] py-6 text-center">Loading open slots…</p>
              ) : openSlots.length === 0 ? (
                <p className="text-sm text-[#8f8f8f] py-6 text-center">No open slots{allowBarberSwitch ? " left today" : " that day"}. Pick another barber or free up time.</p>
              ) : (
                <div className="grid grid-cols-3 gap-2">
                  {openSlots.map(s => (
                    <button key={s} type="button" onClick={() => setSlot(s)}
                      className={cn("py-2.5 rounded-lg text-sm font-medium border transition-colors",
                        slot === s ? "bg-white text-black border-white" : "bg-[#141414] text-[#ccc] border-[#2a2a2a] hover:border-[#2a2a2a]")}>
                      {s}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {err && <p className="text-xs text-rose-400 mt-3">{err}</p>}

            <button type="button" disabled={!slot || busy} onClick={book}
              className="mt-4 w-full rounded-xl bg-[#00e5a0] text-black text-sm font-bold py-3 disabled:opacity-40 transition-opacity">
              {busy ? "Booking…" : slot ? `Book ${slot}` : "Pick a slot"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
