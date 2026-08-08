"use client";
import { useState, useEffect, useCallback, useMemo } from "react";
import { Users, Plus, Clock, Phone, Scissors, Check, X, Bell, RefreshCw, CreditCard } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { WaitlistAssignSheet } from "@/components/waitlist-assign-sheet";
import { ApptDetail, Portal, makeApptActions } from "@/components/calendar-view";
import type { WaitlistEntry, Barber, Service, AppointmentWithDetails } from "@/lib/database.types";
import { effectivePlan, isPaidPlan } from "@/lib/validation";
import { FeatureLock } from "@/components/dashboard/feature-lock";

// Walk-in appointments are tagged with this note when seated from the queue, so
// we can match a queue row back to its appointment (for the time + checkout).
const WALKIN_NOTE = "Walk-in from waitlist";
type LinkedAppt = { id: string; time_slot: string; status: string };

function Toast({ message, onClose }: { message: string; onClose: () => void }) {
  return (
    <div className="fixed bottom-6 right-6 z-[100] bg-card-raised border border-border rounded-xl px-5 py-3 text-sm text-foreground shadow-xl flex items-center gap-3">
      <span className="text-foreground">✓</span>{message}
      <button onClick={onClose} className="text-grey hover:text-foreground ml-2">✕</button>
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

type BlankEntry = { client_name: string; client_phone: string; client_email: string; barber_id: string; service_id: string };
const BLANK: BlankEntry = { client_name: "", client_phone: "", client_email: "", barber_id: "", service_id: "" };

export default function WaitlistPage() {
  const { shop, accessToken } = useAuth();
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

  // Today's walk-in appointments, keyed "clientName|barberId" → so a "called"
  // queue row can show the assigned time and open the right appointment for
  // checkout (survives page refresh, unlike the in-memory link map).
  const [walkinAppts, setWalkinAppts] = useState<Record<string, LinkedAppt>>({});

  const load = useCallback(async () => {
    if (!shop) { setLoading(false); return; }
    setLoading(true);
    const today = new Date().toISOString().slice(0, 10);
    const [{ data: wData }, { data: bData }, { data: sData }, { data: aData }] = await Promise.all([
      supabase.from("waitlist").select("*").eq("shop_id", shop.id).gte("added_at", today).order("added_at"),
      supabase.from("barbers").select("*").eq("shop_id", shop.id).eq("is_active", true).order("name"),
      supabase.from("services").select("*").eq("shop_id", shop.id).eq("is_active", true).order("name"),
      supabase.from("appointments").select("id, client_name, barber_id, time_slot, status, notes, created_at")
        .eq("shop_id", shop.id).eq("date", today).order("created_at", { ascending: false }),
    ]);
    setBarbers((bData ?? []) as Barber[]);
    setServices((sData ?? []) as Service[]);
    const map: Record<string, LinkedAppt> = {};
    (aData ?? []).forEach((a) => {
      if (!(a.notes as string | null)?.includes(WALKIN_NOTE)) return;
      const key = `${a.client_name}|${a.barber_id}`;
      if (!map[key]) map[key] = { id: a.id as string, time_slot: a.time_slot as string, status: a.status as string };
    });
    setWalkinAppts(map);

    // Self-heal: if a "called" row's appointment was completed / cancelled
    // elsewhere (e.g. the barber's calendar), reflect that here so it leaves the
    // active queue instead of keeping a dead Checkout button.
    const wEntries = (wData ?? []) as WaitlistEntry[];
    const fixes: { id: string; status: WaitlistEntry["status"] }[] = [];
    const reconciled = wEntries.map((e) => {
      if (e.status !== "called") return e;
      const appt = map[`${e.client_name}|${e.barber_id}`];
      if (!appt) return e;
      if (appt.status === "completed") { fixes.push({ id: e.id, status: "served" }); return { ...e, status: "served" } as WaitlistEntry; }
      if (appt.status === "cancelled" || appt.status === "no-show") { fixes.push({ id: e.id, status: "removed" }); return { ...e, status: "removed" } as WaitlistEntry; }
      return e;
    });
    setEntries(reconciled);
    fixes.forEach(f => supabase.from("waitlist").update({ status: f.status }).eq("id", f.id).then(null, () => null));
    setLoading(false);
  }, [shop]);

  const linkFor = useCallback((e: WaitlistEntry): LinkedAppt | null => walkinAppts[`${e.client_name}|${e.barber_id}`] ?? null, [walkinAppts]);

  useEffect(() => { load(); }, [load]);

  // Real-time updates — react to queue changes AND to appointment changes (so a
  // walk-in completed/cancelled from the barber's calendar leaves the queue here).
  useEffect(() => {
    if (!shop) return;
    const channel = supabase
      .channel(`waitlist:${shop.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "waitlist", filter: `shop_id=eq.${shop.id}` }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "appointments", filter: `shop_id=eq.${shop.id}` }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [shop, load]);

  const addEntry = async () => {
    if (!shop || !form.client_name.trim()) return;
    setSaving(true);
    const row = {
      shop_id: shop.id,
      client_name: form.client_name.trim(),
      client_phone: form.client_phone.trim() || null,
      barber_id: form.barber_id || null,
      service_id: form.service_id || null,
      added_at: new Date().toISOString(),
      status: "waiting",
    };
    // Include email; retry without it if the column isn't present yet (pre-phase17).
    let { error } = await supabase.from("waitlist").insert({ ...row, client_email: form.client_email.trim() || null });
    if (error && /client_email/.test(error.message)) {
      ({ error } = await supabase.from("waitlist").insert(row));
    }
    setSaving(false);
    if (error) { showToast("Couldn't add — please try again"); return; }
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
  // "Call" opens the shared assign sheet (same one the online waitlist uses):
  // it lists today's OPEN slots for the customer's chosen barber, lets the shop
  // switch to whichever barber is free, and books the chosen slot.
  const [seatEntry, setSeatEntry] = useState<WaitlistEntry | null>(null);
  const slotInterval = (shop?.booking_settings as { slot_interval_minutes?: number } | null)?.slot_interval_minutes ?? 30;

  // Confirmation overlay shown after successful seat-confirm. Slides in,
  // auto-dismisses after 2.5s.
  const [confirmedNotice, setConfirmedNotice] = useState<{ name: string; barber: string } | null>(null);

  // Book the walk-in into the barber + slot chosen in the assign sheet. Goes
  // through /api/waitlist/seat (service-role) so booking, the queue flip, and the
  // customer text/email all happen in one place — shared with the barber portal.
  // Returns an error string (shown in the sheet) or null on success.
  const seatWalkin = async ({ barberId, slot, serviceId }: { barberId: string; slot: string; serviceId: string | null }): Promise<string | null> => {
    if (!seatEntry || !shop || !accessToken) return "Something went wrong — try again.";
    const r = await fetch("/api/waitlist/seat", {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ waitlist_id: seatEntry.id, barber_id: barberId, time_slot: slot, service_id: serviceId }),
    });
    const d = await r.json().catch(() => ({ error: "Network error" }));
    if (!r.ok || d.error) return d.error || "Couldn't seat that walk-in.";
    const barberName = barbers.find(b => b.id === barberId)?.name ?? "barber";
    setConfirmedNotice({ name: seatEntry.client_name, barber: barberName });
    setTimeout(() => setConfirmedNotice(null), 2800);
    return null;
  };

  // ── Checkout — opens the SAME appointment detail / "Check out" banner used
  // across the app, instead of a one-off payment modal here. ────────────────
  const [checkoutAppt, setCheckoutAppt] = useState<AppointmentWithDetails | null>(null);
  const [checkoutEntryId, setCheckoutEntryId] = useState<string | null>(null);
  const [detailBusy, setDetailBusy] = useState("");

  const openCheckout = async (entry: WaitlistEntry) => {
    if (!shop) return;
    const link = linkFor(entry);
    if (!link) { showToast("Couldn't find the appointment — open Appointments to finish."); return; }
    const { data } = await supabase
      .from("appointments")
      .select("*, services(name, duration_minutes), barbers(name)")
      .eq("id", link.id).maybeSingle();
    if (!data) { showToast("Appointment not found"); return; }
    setCheckoutEntryId(entry.id);
    setCheckoutAppt(data as AppointmentWithDetails);
  };

  // Keep the open detail card in sync, and mirror a terminal status back onto
  // the queue row (completed → served, cancelled → removed).
  const patchCheckout = useCallback((id: string, p: Partial<AppointmentWithDetails>) => {
    setCheckoutAppt(prev => (prev && prev.id === id ? { ...prev, ...p } as AppointmentWithDetails : prev));
    if (!checkoutEntryId) return;
    if (p.status === "completed" || p.status === "cancelled") {
      const next = p.status === "completed" ? "served" : "removed";
      supabase.from("waitlist").update({ status: next }).eq("id", checkoutEntryId).then(null, () => null);
      setEntries(prev => prev.map(e => e.id === checkoutEntryId ? ({ ...e, status: next } as WaitlistEntry) : e));
    }
  }, [checkoutEntryId]);

  const apptActions = useMemo(
    () => makeApptActions({
      shop: shop ?? null, accessToken, patch: patchCheckout, setBusy: setDetailBusy,
      toast: showToast, onDone: () => { setCheckoutAppt(null); setCheckoutEntryId(null); load(); },
    }),
    [shop, accessToken, patchCheckout, load],
  );

  const rejectFromWaitlist = async (entry: WaitlistEntry) => {
    const link = linkFor(entry);
    if (link) await supabase.from("appointments").update({ status: "cancelled" }).eq("id", link.id);
    await supabase.from("waitlist").update({ status: "removed" }).eq("id", entry.id);
    setEntries(prev => prev.map(e => e.id === entry.id ? { ...e, status: "removed" } : e));
    showToast(`${entry.client_name} rejected`);
  };

  const active = entries.filter(e => e.status === "waiting" || e.status === "called");
  const history = entries.filter(e => e.status === "served" || e.status === "removed");
  const avgWait = active.length > 1
    ? Math.floor(active.reduce((s, e) => s + (Date.now() - new Date(e.added_at).getTime()) / 60000, 0) / active.length)
    : 0;

  void now; // used for re-renders

  if (shop && !isPaidPlan(effectivePlan(shop.subscription_plan, shop.subscription_status))) {
    return <FeatureLock title="Waitlist" description="Walk-in queue & waitlist are available on the Pro plan and up." />;
  }

  return (
    <div className="p-6 space-y-6">
      {toast && <Toast message={toast} onClose={() => setToast("")} />}

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground uppercase tracking-wide">Walk-In Waitlist</h1>
          <p className="text-sm text-grey mt-0.5">Manage today's walk-in queue</p>
        </div>
        <div className="flex gap-3">
          <button onClick={load} className="text-grey hover:text-foreground transition-colors p-2 rounded-xl hover:bg-card-raised">
            <RefreshCw size={18} />
          </button>
          <Button onClick={() => setShowAdd(true)}>
            <Plus size={16} /> Add Walk-In
          </Button>
        </div>
      </div>

      {/* Stats — v2 reference treatment */}
      {(() => {
        type Tone = "muted" | "up" | "down";
        const waitingCount = active.filter(e => e.status === "waiting").length;
        const inServiceCount = active.filter(e => e.status === "called").length;
        const servedCount = history.filter(e => e.status === "served").length;
        const stats: { label: string; value: string; sub: string; tone: Tone }[] = [
          {
            label: "Waiting",
            value: String(waitingCount),
            sub: waitingCount > 0 ? `${waitingCount} in queue` : "Empty",
            tone: "muted",
          },
          {
            label: "In Service",
            value: String(inServiceCount),
            sub: inServiceCount > 0 ? "↑ At the chair" : "None yet",
            tone: inServiceCount > 0 ? "up" : "muted",
          },
          {
            label: "Avg Wait",
            value: avgWait > 0 ? `${avgWait}m` : "—",
            sub: avgWait > 30 ? "Long" : avgWait > 0 ? "Healthy" : "No data",
            tone: avgWait > 30 ? "down" : avgWait > 0 ? "up" : "muted",
          },
          {
            label: "Served Today",
            value: String(servedCount),
            sub: servedCount > 0 ? "↑ Done & gone" : "None yet",
            tone: servedCount > 0 ? "up" : "muted",
          },
        ];
        return (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {stats.map(s => (
              <div key={s.label} className="bg-card border border-border rounded-2xl p-4">
                <p className="text-[10px] text-grey font-semibold uppercase tracking-wider">{s.label}</p>
                <p className="text-[28px] font-extrabold text-foreground mt-2 font-mono tracking-tighter leading-none">{s.value}</p>
                <p className={cn(
                  "text-[11px] mt-2 font-medium",
                  s.tone === "up"    && "text-emerald-400",
                  s.tone === "down"  && "text-red-400",
                  s.tone === "muted" && "text-grey",
                )}>{s.sub}</p>
              </div>
            ))}
          </div>
        );
      })()}

      {/* Active Queue */}
      <Card>
        <CardHeader>
          <CardTitle>Current Queue</CardTitle>
          <Badge variant={active.length > 0 ? "warning" : "outline"}>{active.length} waiting</Badge>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="py-8 text-center text-grey">Loading...</div>
          ) : active.length === 0 ? (
            <div className="py-16 text-center">
              <Users size={40} className="mx-auto mb-4 text-grey" />
              <p className="text-foreground font-medium">Queue is empty</p>
              <p className="text-sm text-grey mt-1">Add a walk-in client to get started</p>
              <Button className="mt-4" onClick={() => setShowAdd(true)}>
                <Plus size={16} /> Add Walk-In
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              {active.map((entry, idx) => {
                const barber = barbers.find(b => b.id === entry.barber_id);
                const service = services.find(s => s.id === entry.service_id);
                const link = linkFor(entry);
                const mins = Math.floor((Date.now() - new Date(entry.added_at).getTime()) / 60000);
                const isLong = mins > 30;
                return (
                  <div key={entry.id} className={cn(
                    "flex items-start justify-between gap-4 p-4 rounded-2xl border transition-colors",
                    entry.status === "called" ? "bg-black/5 border-black" : "bg-card-raised border-border",
                    isLong && entry.status === "waiting" && "border-orange-500/30"
                  )}>
                    {/* Position */}
                    <div className="flex items-center gap-4">
                      <div className={cn(
                        "w-10 h-10 rounded-full flex items-center justify-center text-lg font-bold flex-shrink-0",
                        entry.status === "called" ? "bg-black/10 text-foreground" : "bg-card shadow-sm text-grey"
                      )}>
                        {idx + 1}
                      </div>
                      <div>
                        <p className="text-foreground font-semibold">{entry.client_name}</p>
                        <div className="flex flex-wrap gap-3 mt-1 text-xs text-grey">
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
                        <div className="flex items-center gap-2 mt-1.5">
                          <Badge variant={STATUS_CONFIG[entry.status].variant} className="text-xs">
                            {STATUS_CONFIG[entry.status].label}
                          </Badge>
                          {entry.status === "called" && (
                            <span className="text-xs text-emerald-400 font-medium">
                              {barber ? `With ${barber.name}` : "Assigned"}{link?.time_slot ? ` · ${link.time_slot}` : ""}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Actions — flow depends on whether the row is still
                        waiting or has been confirmed (status = called, an
                        appointment exists for the barber). */}
                    <div className="flex flex-col gap-1.5 flex-shrink-0">
                      {entry.status === "waiting" && (
                        <button type="button"
                          onClick={() => setSeatEntry(entry)}
                          className="btn btn-success btn-sm">
                          <Bell size={13} /> Call
                        </button>
                      )}
                      {entry.status === "called" && (
                        <>
                          <button type="button"
                            onClick={() => openCheckout(entry)}
                            className="btn btn-blue btn-sm">
                            <CreditCard size={13} /> Checkout
                          </button>
                          <button type="button"
                            onClick={() => rejectFromWaitlist(entry)}
                            className="btn btn-danger btn-sm">
                            <X size={13} /> Reject
                          </button>
                        </>
                      )}
                      {entry.status === "waiting" && (
                        <button
                          onClick={() => updateStatus(entry.id, "removed")}
                          className="text-xs text-grey hover:text-red-400 transition-colors text-center py-1"
                        >
                          Remove
                        </button>
                      )}
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
              <span className="text-xs text-grey">{showHistory ? "Hide" : "Show"}</span>
            </button>
          </CardHeader>
          {showHistory && (
            <CardContent>
              <div className="space-y-2">
                {history.map(entry => (
                  <div key={entry.id} className="flex items-center justify-between gap-4 p-3 rounded-xl border border-[#2a2a2a]/50 opacity-60">
                    <div>
                      <p className="text-sm text-foreground">{entry.client_name}</p>
                      {entry.client_phone && <p className="text-xs text-grey">{entry.client_phone}</p>}
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
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 overflow-y-auto overscroll-contain [&>*]:my-auto">
            <div className="bg-card shadow-sm border border-border rounded-2xl p-6 w-full max-w-md space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold text-foreground">Add Walk-In</h2>
                <button onClick={() => setShowAdd(false)} className="text-grey hover:text-foreground text-xl leading-none">✕</button>
              </div>
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <label className="text-xs text-grey">Client Name *</label>
                  <input
                    value={form.client_name}
                    onChange={e => setForm(p => ({ ...p, client_name: e.target.value }))}
                    onKeyDown={e => e.key === "Enter" && addEntry()}
                    placeholder="John Smith"
                    autoFocus
                    className="w-full bg-card-raised border border-border rounded-xl px-4 py-2.5 text-sm text-foreground placeholder:text-grey focus:outline-none focus:border-black"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-xs text-grey">Phone (optional)</label>
                    <input
                      value={form.client_phone}
                      onChange={e => setForm(p => ({ ...p, client_phone: e.target.value }))}
                      placeholder="(416) 555-0123"
                      type="tel"
                      className="w-full bg-card-raised border border-border rounded-xl px-4 py-2.5 text-sm text-foreground placeholder:text-grey focus:outline-none focus:border-black"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs text-grey">Email (optional)</label>
                    <input
                      value={form.client_email}
                      onChange={e => setForm(p => ({ ...p, client_email: e.target.value }))}
                      placeholder="you@email.com"
                      type="email"
                      className="w-full bg-card-raised border border-border rounded-xl px-4 py-2.5 text-sm text-foreground placeholder:text-grey focus:outline-none focus:border-black"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-xs text-grey">Preferred Barber</label>
                    <select value={form.barber_id} onChange={e => setForm(p => ({ ...p, barber_id: e.target.value }))}
                      className="w-full bg-card-raised border border-border rounded-xl px-3 py-2.5 text-sm text-foreground focus:outline-none focus:border-black">
                      <option value="">Any</option>
                      {barbers.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs text-grey">Service</label>
                    <select value={form.service_id} onChange={e => setForm(p => ({ ...p, service_id: e.target.value }))}
                      className="w-full bg-card-raised border border-border rounded-xl px-3 py-2.5 text-sm text-foreground focus:outline-none focus:border-black">
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

      {/* Checkout — the universal appointment detail / "Check out" banner used
          everywhere else. Completing/charging here flips the queue row to served. */}
      {checkoutAppt && (
        <Portal>
          <ApptDetail
            appt={checkoutAppt}
            barbers={barbers}
            services={services}
            onClose={() => { setCheckoutAppt(null); setCheckoutEntryId(null); }}
            actions={apptActions}
            busy={detailBusy}
          />
        </Portal>
      )}

      {/* Big toast — confirms the walk-in moved to /dashboard/appointments.
          Sits above the side-toast so it can't be missed. Auto-dismisses. */}
      {confirmedNotice && (
        <div className="fixed inset-x-0 top-20 z-[110] flex justify-center pointer-events-none">
          <div className="bg-emerald-500/15 border border-emerald-500/40 backdrop-blur-md rounded-2xl px-6 py-4 max-w-sm w-[calc(100%-2rem)] shadow-2xl animate-fade-in">
            <p className="text-emerald-300 font-semibold flex items-center gap-2">
              <Check size={16} /> Moved to Appointments
            </p>
            <p className="text-sm text-foreground mt-1">
              <span className="font-bold">{confirmedNotice.name}</span> is now confirmed with <span className="font-bold">{confirmedNotice.barber}</span>.
            </p>
            <p className="text-xs text-grey mt-1.5">Complete or reject the appointment from this list or from /dashboard/appointments.</p>
          </div>
        </div>
      )}

      {/* Call → shared assign sheet: today's open slots for the chosen barber,
          switchable to whoever's free, then books + flips the row to called. */}
      {seatEntry && shop && (
        <WaitlistAssignSheet
          request={{
            id: seatEntry.id,
            shop_id: shop.id,
            barber_id: seatEntry.barber_id ?? null,
            service_id: seatEntry.service_id ?? null,
            client_name: seatEntry.client_name,
            desired_date: new Date().toISOString().slice(0, 10),
          }}
          services={services}
          allowBarberSwitch
          slotInterval={slotInterval}
          accessToken={accessToken}
          onBook={seatWalkin}
          onClose={() => setSeatEntry(null)}
          onDone={() => load()}
        />
      )}
    </div>
  );
}
