"use client";
import { useState, useEffect, useCallback } from "react";
import { Users, Plus, Clock, Phone, Scissors, Check, X, Bell, RefreshCw } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/lib/supabase";
import { cn, formatCurrency, displayTimeToDb, dbTimeToDisplay } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import type { WaitlistEntry, Barber, Service } from "@/lib/database.types";

// Round the current clock to the next 30-min slot in display format
// ("9:00 AM" / "9:30 AM"). Walk-in appointments aren't pre-booked, so
// we just need a sensible slot to insert the row into.
function nextHalfHourSlot(): string {
  const d = new Date();
  if (d.getMinutes() >= 30) { d.setHours(d.getHours() + 1); d.setMinutes(0); }
  else d.setMinutes(30);
  const hh = d.getHours().toString().padStart(2, "0");
  return dbTimeToDisplay(`${hh}:${d.getMinutes().toString().padStart(2, "0")}:00`);
}

function Toast({ message, onClose }: { message: string; onClose: () => void }) {
  return (
    <div className="fixed bottom-6 right-6 z-[100] bg-[#141414] border border-[#1e1e1e] rounded-xl px-5 py-3 text-sm text-white shadow-xl flex items-center gap-3">
      <span className="text-white">✓</span>{message}
      <button onClick={onClose} className="text-[#777] hover:text-white ml-2">✕</button>
    </div>
  );
}

function waitTime(addedAt: string) {
  const mins = Math.floor((Date.now() - new Date(addedAt).getTime()) / 60000);
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

type StatusVariant = "warning" | "info" | "success" | "danger" | "outline";
const STATUS_CONFIG: Record<WaitlistEntry["status"], { label: string; variant: StatusVariant }> = {
  waiting: { label: "Waiting", variant: "warning" },
  called: { label: "Called", variant: "info" },
  served: { label: "Served", variant: "success" },
  removed: { label: "Removed", variant: "danger" },
};

type BlankEntry = { client_name: string; client_phone: string; barber_id: string; service_id: string };
const BLANK: BlankEntry = { client_name: "", client_phone: "", barber_id: "", service_id: "" };

export default function WaitlistPage() {
  const { shop } = useAuth();
  const [entries, setEntries] = useState<WaitlistEntry[]>([]);
  const [barbers, setBarbers] = useState<Barber[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState<BlankEntry>(BLANK);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  const [now, setNow] = useState(new Date());

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(""), 3000); };

  // Tick every minute to update wait times
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(t);
  }, []);

  const load = useCallback(async () => {
    if (!shop) { setLoading(false); return; }
    setLoading(true);
    const today = new Date().toISOString().slice(0, 10);
    const [{ data: wData }, { data: bData }, { data: sData }] = await Promise.all([
      supabase.from("waitlist").select("*").eq("shop_id", shop.id).gte("added_at", today).order("added_at"),
      supabase.from("barbers").select("*").eq("shop_id", shop.id).eq("is_active", true).order("name"),
      supabase.from("services").select("*").eq("shop_id", shop.id).eq("is_active", true).order("name"),
    ]);
    setEntries((wData ?? []) as WaitlistEntry[]);
    setBarbers((bData ?? []) as Barber[]);
    setServices((sData ?? []) as Service[]);
    setLoading(false);
  }, [shop]);

  useEffect(() => { load(); }, [load]);

  // Real-time updates
  useEffect(() => {
    if (!shop) return;
    const channel = supabase
      .channel(`waitlist:${shop.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "waitlist", filter: `shop_id=eq.${shop.id}` }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [shop, load]);

  const addEntry = async () => {
    if (!shop || !form.client_name.trim()) return;
    setSaving(true);
    await supabase.from("waitlist").insert({
      shop_id: shop.id,
      client_name: form.client_name.trim(),
      client_phone: form.client_phone.trim() || null,
      barber_id: form.barber_id || null,
      service_id: form.service_id || null,
      added_at: new Date().toISOString(),
      status: "waiting",
    });
    setSaving(false);
    setShowAdd(false);
    setForm(BLANK);
    showToast(`${form.client_name} added to waitlist`);
    load();
  };

  const updateStatus = async (id: string, status: WaitlistEntry["status"]) => {
    await supabase.from("waitlist").update({ status }).eq("id", id);
    setEntries(prev => prev.map(e => e.id === id ? { ...e, status } : e));
    const entry = entries.find(e => e.id === id);
    if (entry) showToast(`${entry.client_name} marked as ${status}`);
  };

  // ── Call / Confirm flow ──────────────────────────────────────────────────
  // "Call" opens a tiny picker — owner / front desk confirms which barber
  // is taking the walk-in (+ service). Confirm writes a real appointment
  // as "confirmed" (so it shows up on /dashboard/appointments and the
  // barber's schedule with the regular Complete / Reject action buttons),
  // and removes the row from the active queue.
  const [seatEntry, setSeatEntry] = useState<WaitlistEntry | null>(null);
  const [seatBarberId, setSeatBarberId] = useState("");
  const [seatServiceId, setSeatServiceId] = useState("");
  const [seatSaving, setSeatSaving] = useState(false);

  // Surface barbers who don't currently have an in-progress appt — a soft
  // hint, not a hard constraint. The owner can still pick a busy one if
  // they're queuing the next chair-time.
  const [busyBarberIds, setBusyBarberIds] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!shop) return;
    const today = new Date().toISOString().slice(0, 10);
    supabase
      .from("appointments")
      .select("barber_id, status")
      .eq("shop_id", shop.id)
      .eq("date", today)
      .in("status", ["confirmed", "pending"])
      .then(({ data }) => {
        const ids = new Set<string>();
        (data ?? []).forEach(a => { if (a.barber_id) ids.add(a.barber_id as string); });
        setBusyBarberIds(ids);
      });
  }, [shop, entries]);

  const openSeatModal = (entry: WaitlistEntry) => {
    setSeatEntry(entry);
    // Preselect: barber on the row, else first idle, else first barber.
    const idleBarber = barbers.find(b => !busyBarberIds.has(b.id));
    setSeatBarberId(entry.barber_id ?? idleBarber?.id ?? barbers[0]?.id ?? "");
    setSeatServiceId(entry.service_id ?? services[0]?.id ?? "");
  };

  const confirmSeat = async () => {
    if (!seatEntry || !shop || !seatBarberId || !seatServiceId) return;
    const svc = services.find(s => s.id === seatServiceId);
    const price = svc?.price ?? 0;
    setSeatSaving(true);
    const today = new Date().toISOString().slice(0, 10);
    const slot = nextHalfHourSlot();
    // Walk-in lands on /dashboard/appointments as `confirmed` so the
    // barber's portal shows the regular Complete + Reject buttons.
    // Payment is left untouched — collected later from the appointment
    // side panel via the standard Take Payment / PaymentModal flow.
    const { error: apptErr } = await supabase.from("appointments").insert({
      shop_id: shop.id,
      barber_id: seatBarberId,
      service_id: seatServiceId,
      client_name: seatEntry.client_name,
      client_phone: seatEntry.client_phone ?? null,
      date: today,
      time_slot: slot,
      status: "confirmed",
      total_amount: price,
      notes: `Walk-in from waitlist`,
    });
    if (apptErr) {
      setSeatSaving(false);
      showToast(`Failed: ${apptErr.message}`);
      return;
    }
    // Mark the waitlist row served so it drops out of the active queue.
    await supabase.from("waitlist").update({ status: "served" }).eq("id", seatEntry.id);
    setEntries(prev => prev.map(e => e.id === seatEntry.id ? { ...e, status: "served" } : e));
    setSeatSaving(false);
    const barberName = barbers.find(b => b.id === seatBarberId)?.name ?? "barber";
    showToast(`${seatEntry.client_name} confirmed with ${barberName}`);
    setSeatEntry(null);
  };
  // displayTimeToDb is imported alongside dbTimeToDisplay so the round-up
  // helper has both sides of the conversion available.
  void displayTimeToDb;
  void formatCurrency;

  const active = entries.filter(e => e.status === "waiting" || e.status === "called");
  const history = entries.filter(e => e.status === "served" || e.status === "removed");
  const avgWait = active.length > 1
    ? Math.floor(active.reduce((s, e) => s + (Date.now() - new Date(e.added_at).getTime()) / 60000, 0) / active.length)
    : 0;

  void now; // used for re-renders

  return (
    <div className="p-6 space-y-6">
      {toast && <Toast message={toast} onClose={() => setToast("")} />}

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">Walk-In Waitlist</h1>
          <p className="text-sm text-[#777] mt-0.5">Manage today's walk-in queue</p>
        </div>
        <div className="flex gap-3">
          <button onClick={load} className="text-[#777] hover:text-white transition-colors p-2 rounded-xl hover:bg-[#141414]">
            <RefreshCw size={18} />
          </button>
          <Button onClick={() => setShowAdd(true)}>
            <Plus size={16} /> Add Walk-In
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="p-4">
          <p className="text-xs text-[#777]">Currently Waiting</p>
          <p className="text-2xl font-bold text-white mt-1">{active.filter(e => e.status === "waiting").length}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-[#777]">Being Served</p>
          <p className="text-2xl font-bold text-white mt-1">{active.filter(e => e.status === "called").length}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-[#777]">Avg Wait Time</p>
          <p className="text-2xl font-bold text-white mt-1">{avgWait > 0 ? `${avgWait}m` : "—"}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-[#777]">Served Today</p>
          <p className="text-2xl font-bold text-emerald-400 mt-1">{history.filter(e => e.status === "served").length}</p>
        </Card>
      </div>

      {/* Active Queue */}
      <Card>
        <CardHeader>
          <CardTitle>Current Queue</CardTitle>
          <Badge variant={active.length > 0 ? "warning" : "outline"}>{active.length} waiting</Badge>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="py-8 text-center text-[#777]">Loading...</div>
          ) : active.length === 0 ? (
            <div className="py-16 text-center">
              <Users size={40} className="mx-auto mb-4 text-[#777]" />
              <p className="text-white font-medium">Queue is empty</p>
              <p className="text-sm text-[#777] mt-1">Add a walk-in client to get started</p>
              <Button className="mt-4" onClick={() => setShowAdd(true)}>
                <Plus size={16} /> Add Walk-In
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              {active.map((entry, idx) => {
                const barber = barbers.find(b => b.id === entry.barber_id);
                const service = services.find(s => s.id === entry.service_id);
                const mins = Math.floor((Date.now() - new Date(entry.added_at).getTime()) / 60000);
                const isLong = mins > 30;
                return (
                  <div key={entry.id} className={cn(
                    "flex items-start justify-between gap-4 p-4 rounded-2xl border transition-colors",
                    entry.status === "called" ? "bg-black/5 border-black" : "bg-[#141414] border-[#1e1e1e]",
                    isLong && entry.status === "waiting" && "border-orange-500/30"
                  )}>
                    {/* Position */}
                    <div className="flex items-center gap-4">
                      <div className={cn(
                        "w-10 h-10 rounded-full flex items-center justify-center text-lg font-bold flex-shrink-0",
                        entry.status === "called" ? "bg-black/10 text-white" : "bg-black shadow-sm text-[#777]"
                      )}>
                        {idx + 1}
                      </div>
                      <div>
                        <p className="text-white font-semibold">{entry.client_name}</p>
                        <div className="flex flex-wrap gap-3 mt-1 text-xs text-[#777]">
                          {entry.client_phone && (
                            <span className="flex items-center gap-1"><Phone size={11} />{entry.client_phone}</span>
                          )}
                          {barber && (
                            <span className="flex items-center gap-1"><Scissors size={11} />{barber.name}</span>
                          )}
                          {service && (
                            <span>{service.name}</span>
                          )}
                          <span className={cn("flex items-center gap-1", isLong && "text-orange-400")}>
                            <Clock size={11} />{waitTime(entry.added_at)}
                            {isLong && " — Long wait"}
                          </span>
                        </div>
                        <Badge variant={STATUS_CONFIG[entry.status].variant} className="text-xs mt-1.5">
                          {STATUS_CONFIG[entry.status].label}
                        </Badge>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex flex-col gap-1.5 flex-shrink-0">
                      {/* Call opens the barber-assign modal directly. On
                          confirm an appointment is created on /dashboard/
                          appointments and the barber's schedule, and this
                          row drops out of the active queue. */}
                      <Button size="sm" onClick={() => openSeatModal(entry)}>
                        <Bell size={13} /> Call
                      </Button>
                      <button
                        onClick={() => updateStatus(entry.id, "removed")}
                        className="text-xs text-[#777] hover:text-red-400 transition-colors text-center py-1"
                      >
                        <X size={13} className="inline mr-1" />Remove
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* History Toggle */}
      {history.length > 0 && (
        <Card>
          <CardHeader>
            <button
              onClick={() => setShowHistory(p => !p)}
              className="flex items-center justify-between w-full"
            >
              <CardTitle>Today's History ({history.length})</CardTitle>
              <span className="text-xs text-[#777]">{showHistory ? "Hide" : "Show"}</span>
            </button>
          </CardHeader>
          {showHistory && (
            <CardContent>
              <div className="space-y-2">
                {history.map(entry => (
                  <div key={entry.id} className="flex items-center justify-between gap-4 p-3 rounded-xl border border-[#1e1e1e]/50 opacity-60">
                    <div>
                      <p className="text-sm text-white">{entry.client_name}</p>
                      {entry.client_phone && <p className="text-xs text-[#777]">{entry.client_phone}</p>}
                    </div>
                    <Badge variant={STATUS_CONFIG[entry.status].variant} className="text-xs">
                      {STATUS_CONFIG[entry.status].label}
                    </Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          )}
        </Card>
      )}

      {/* Add Modal */}
      {showAdd && (
        <>
          <div className="fixed inset-0 bg-black/70 z-40" onClick={() => setShowAdd(false)} />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="bg-black shadow-sm border border-[#1e1e1e] rounded-2xl p-6 w-full max-w-md space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold text-white">Add Walk-In</h2>
                <button onClick={() => setShowAdd(false)} className="text-[#777] hover:text-white text-xl leading-none">✕</button>
              </div>
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <label className="text-xs text-[#777]">Client Name *</label>
                  <input
                    value={form.client_name}
                    onChange={e => setForm(p => ({ ...p, client_name: e.target.value }))}
                    onKeyDown={e => e.key === "Enter" && addEntry()}
                    placeholder="John Smith"
                    autoFocus
                    className="w-full bg-[#141414] border border-[#1e1e1e] rounded-xl px-4 py-2.5 text-sm text-white placeholder:text-[#777] focus:outline-none focus:border-black"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs text-[#777]">Phone (optional)</label>
                  <input
                    value={form.client_phone}
                    onChange={e => setForm(p => ({ ...p, client_phone: e.target.value }))}
                    placeholder="(416) 555-0123"
                    type="tel"
                    className="w-full bg-[#141414] border border-[#1e1e1e] rounded-xl px-4 py-2.5 text-sm text-white placeholder:text-[#777] focus:outline-none focus:border-black"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-xs text-[#777]">Preferred Barber</label>
                    <select value={form.barber_id} onChange={e => setForm(p => ({ ...p, barber_id: e.target.value }))}
                      className="w-full bg-[#141414] border border-[#1e1e1e] rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-black">
                      <option value="">Any</option>
                      {barbers.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs text-[#777]">Service</label>
                    <select value={form.service_id} onChange={e => setForm(p => ({ ...p, service_id: e.target.value }))}
                      className="w-full bg-[#141414] border border-[#1e1e1e] rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-black">
                      <option value="">Not selected</option>
                      {services.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                  </div>
                </div>
              </div>
              <div className="flex gap-3 pt-2">
                <Button variant="outline" className="flex-1" onClick={() => setShowAdd(false)}>Cancel</Button>
                <Button className="flex-1" loading={saving} disabled={!form.client_name.trim()} onClick={addEntry}>
                  Add to Queue
                </Button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Call modal — pick a barber + service, confirm, done. The walk-in
          becomes an appointment on /dashboard/appointments and the barber
          gets the regular Complete / Reject controls there. */}
      {seatEntry && (
        <>
          <div className="fixed inset-0 bg-black/70 z-40" onClick={() => !seatSaving && setSeatEntry(null)} />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="bg-[#0c0c0c] border border-[#1e1e1e] rounded-2xl p-6 w-full max-w-md space-y-4 shadow-xl">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold text-white">Confirm {seatEntry.client_name}</h2>
                <button onClick={() => !seatSaving && setSeatEntry(null)} className="text-[#777] hover:text-white text-xl leading-none">✕</button>
              </div>

              {/* Barber picker — idle barbers shown first, busy ones tagged */}
              <div>
                <label className="text-[10px] font-semibold uppercase tracking-wider text-[#777] block mb-2">Barber</label>
                <div className="grid grid-cols-2 gap-2">
                  {barbers
                    .slice()
                    .sort((a, b) => {
                      const ba = busyBarberIds.has(a.id) ? 1 : 0;
                      const bb = busyBarberIds.has(b.id) ? 1 : 0;
                      return ba - bb;
                    })
                    .map(b => {
                      const isBusy = busyBarberIds.has(b.id);
                      const selected = seatBarberId === b.id;
                      return (
                        <button
                          key={b.id}
                          type="button"
                          onClick={() => setSeatBarberId(b.id)}
                          className={cn(
                            "p-3 rounded-xl border text-left transition-colors",
                            selected ? "bg-white text-black border-white" : "bg-[#141414] border-[#1e1e1e] hover:border-white"
                          )}
                        >
                          <p className="text-sm font-semibold truncate">{b.name}</p>
                          <p className={cn("text-[10px] mt-0.5", selected ? "text-black/60" : isBusy ? "text-amber-400" : "text-emerald-400")}>
                            {isBusy ? "Busy now" : "Available"}
                          </p>
                        </button>
                      );
                    })}
                  {barbers.length === 0 && (
                    <p className="col-span-2 text-sm text-[#777]">No active barbers — add one from Staff.</p>
                  )}
                </div>
              </div>

              {/* Service picker */}
              <div>
                <label className="text-[10px] font-semibold uppercase tracking-wider text-[#777] block mb-2">Service</label>
                <select
                  value={seatServiceId}
                  onChange={e => setSeatServiceId(e.target.value)}
                  className="w-full bg-[#141414] border border-[#1e1e1e] rounded-xl px-3 py-2.5 text-sm text-white focus:outline-none focus:border-white"
                >
                  <option value="">Select a service</option>
                  {services.map(s => (
                    <option key={s.id} value={s.id}>{s.name} — {formatCurrency(s.price)}</option>
                  ))}
                </select>
              </div>

              <p className="text-xs text-[#777]">
                Confirming creates an appointment for the barber on today&apos;s
                schedule. They&apos;ll see <span className="text-white">Complete</span> and
                <span className="text-white"> Reject</span> on their row, and you can take payment
                from the appointment side panel any time.
              </p>

              <div className="flex gap-3 pt-2">
                <Button variant="outline" className="flex-1" onClick={() => setSeatEntry(null)}>Cancel</Button>
                <Button
                  className="flex-1"
                  loading={seatSaving}
                  disabled={!seatBarberId || !seatServiceId}
                  onClick={confirmSeat}
                >
                  Confirm Walk-In
                </Button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
