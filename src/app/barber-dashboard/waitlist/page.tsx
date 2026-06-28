"use client";
import { useState, useEffect, useCallback } from "react";
import { Phone, Scissors, Clock, Bell, RefreshCw, ListOrdered, Check } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { useBarber } from "@/lib/barber-context";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { WaitlistAssignSheet } from "@/components/waitlist-assign-sheet";
import type { Service } from "@/lib/database.types";

type WalkIn = {
  id: string; shop_id: string; barber_id: string | null; service_id: string | null;
  client_name: string; client_phone: string | null; added_at: string; status: string;
};

function waitTime(addedAt: string) {
  const mins = Math.floor((Date.now() - new Date(addedAt).getTime()) / 60000);
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

/**
 * Barber-side walk-in queue. Shows today's walk-ins that chose THIS barber (or
 * "any"), and lets the barber call one → the shared assign sheet picks an open
 * slot on their schedule and books it (via /api/waitlist/seat, service-role so
 * the owner-only `waitlist` RLS doesn't block them). Completing/charging then
 * happens on their Calendar like any other appointment.
 */
export default function BarberWaitlistPage() {
  const { accessToken, profile } = useAuth();
  const { barber, shop, loading: barberLoading } = useBarber();
  const isOwner = profile?.role === "shop_owner";
  const canManage = isOwner || barber?.permissions?.manage_appointments === true;

  const [entries, setEntries] = useState<WalkIn[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState("");
  const [seatEntry, setSeatEntry] = useState<WalkIn | null>(null);

  const showToast = (m: string) => { setToast(m); setTimeout(() => setToast(""), 3000); };
  const slotInterval = (shop?.booking_settings as { slot_interval_minutes?: number } | null)?.slot_interval_minutes ?? 30;

  const load = useCallback(async () => {
    if (!shop?.id || !accessToken) { setLoading(false); return; }
    setLoading(true);
    const [walk, { data: sData }] = await Promise.all([
      fetch("/api/waitlist/walkins", {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ shop_id: shop.id }),
      }).then(r => (r.ok ? r.json() : { entries: [] })).catch(() => ({ entries: [] })),
      supabase.from("services").select("*").eq("shop_id", shop.id).eq("is_active", true).order("name"),
    ]);
    setEntries((walk.entries ?? []) as WalkIn[]);
    setServices((sData ?? []) as Service[]);
    setLoading(false);
  }, [shop?.id, accessToken]);
  useEffect(() => { load(); }, [load]);

  // Live refresh when the queue changes (owner adds/kiosk check-in). RLS blocks
  // the barber from reading rows, but the realtime change event still fires;
  // we just re-fetch through the authorized route.
  useEffect(() => {
    if (!shop?.id) return;
    const ch = supabase
      .channel(`barber-waitlist:${shop.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "waitlist", filter: `shop_id=eq.${shop.id}` }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [shop?.id, load]);

  const mine = entries.filter(e => e.status === "waiting" && (e.barber_id === barber?.id || e.barber_id == null));
  const seated = entries.filter(e => e.status === "called" && e.barber_id === barber?.id);

  const seatMine = async ({ barberId, slot, serviceId }: { barberId: string; slot: string; serviceId: string | null }): Promise<string | null> => {
    if (!seatEntry || !accessToken) return "Something went wrong — try again.";
    const r = await fetch("/api/waitlist/seat", {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ waitlist_id: seatEntry.id, barber_id: barberId, time_slot: slot, service_id: serviceId }),
    });
    const d = await r.json().catch(() => ({ error: "Network error" }));
    if (!r.ok || d.error) return d.error || "Couldn't seat that walk-in.";
    return null;
  };

  if (barberLoading) return <div className="p-6 text-[#777] text-sm">Loading…</div>;
  if (!canManage) return <div className="p-6 text-[#777] text-sm">You don&apos;t have permission to manage walk-ins.</div>;

  return (
    <div className="p-4 sm:p-6 max-w-3xl mx-auto pb-28 space-y-5">
      {toast && (
        <div className="fixed bottom-24 lg:bottom-6 right-4 z-[100] bg-[#141414] border border-[#1e1e1e] rounded-xl px-5 py-3 text-sm text-white shadow-xl">
          <span className="text-[#00e5a0]">✓</span> {toast}
        </div>
      )}

      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white uppercase tracking-wide">Walk-Ins</h1>
          <p className="text-sm text-[#777] mt-0.5">Customers waiting for you today — call one and pick an open slot.</p>
        </div>
        <button onClick={load} className="text-[#777] hover:text-white transition-colors p-2 rounded-xl hover:bg-[#141414]">
          <RefreshCw size={18} />
        </button>
      </div>

      {loading ? (
        <div className="space-y-2">{[1, 2, 3].map(i => <div key={i} className="h-16 rounded-2xl bg-[#0c0c0c] border border-[#1e1e1e] animate-pulse" />)}</div>
      ) : mine.length === 0 ? (
        <div className="rounded-2xl border border-[#1e1e1e] bg-[#0c0c0c] p-12 text-center">
          <ListOrdered size={36} className="mx-auto mb-3 text-[#555]" />
          <p className="text-white font-medium">No one waiting for you</p>
          <p className="text-sm text-[#777] mt-1">Walk-ins that pick you (or “any barber”) show up here.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {mine.map((e, idx) => (
            <div key={e.id} className="flex items-center gap-3 rounded-2xl border border-[#1e1e1e] bg-[#0c0c0c] p-4">
              <div className="w-9 h-9 rounded-full bg-[#141414] text-[#999] font-bold flex items-center justify-center flex-shrink-0">{idx + 1}</div>
              <div className="flex-1 min-w-0">
                <p className="text-white font-semibold truncate">{e.client_name}</p>
                <div className="flex flex-wrap gap-3 mt-1 text-xs text-[#777]">
                  {e.client_phone && <span className="flex items-center gap-1"><Phone size={11} />{e.client_phone}</span>}
                  {e.barber_id == null && <span className="flex items-center gap-1"><Scissors size={11} />Any barber</span>}
                  <span className="flex items-center gap-1"><Clock size={11} />{waitTime(e.added_at)}</span>
                </div>
              </div>
              <button type="button" onClick={() => setSeatEntry(e)} className="btn btn-success btn-sm flex-shrink-0">
                <Bell size={13} /> Call
              </button>
            </div>
          ))}
        </div>
      )}

      {seated.length > 0 && (
        <div>
          <h2 className="text-sm font-bold text-white mb-2">Seated today</h2>
          <div className="rounded-2xl border border-[#1e1e1e] bg-[#0c0c0c] overflow-hidden divide-y divide-[#1a1a1a]">
            {seated.map(e => (
              <div key={e.id} className="flex items-center gap-3 px-4 py-3">
                <Check size={15} className="text-emerald-400 flex-shrink-0" />
                <p className="flex-1 text-sm text-white truncate">{e.client_name}</p>
                <span className="text-xs text-[#777]">On your calendar</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {seatEntry && shop && barber && (
        <WaitlistAssignSheet
          request={{
            id: seatEntry.id,
            shop_id: shop.id,
            barber_id: barber.id,
            service_id: seatEntry.service_id,
            client_name: seatEntry.client_name,
            desired_date: new Date().toISOString().slice(0, 10),
          }}
          services={services}
          slotInterval={slotInterval}
          accessToken={accessToken}
          onBook={seatMine}
          onClose={() => setSeatEntry(null)}
          onDone={() => { showToast("Seated · added to your calendar"); load(); }}
        />
      )}
    </div>
  );
}
