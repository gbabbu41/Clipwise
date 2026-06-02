"use client";
import { useState, useEffect, useCallback } from "react";
import { Users, Plus, Clock, Phone, Scissors, Check, X, Bell, RefreshCw } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import type { WaitlistEntry, Barber, Service } from "@/lib/database.types";

function Toast({ message, onClose }: { message: string; onClose: () => void }) {
  return (
    <div className="fixed bottom-6 right-6 z-[100] bg-gray-100 border border-gray-200 rounded-xl px-5 py-3 text-sm text-gray-900 shadow-xl flex items-center gap-3">
      <span className="text-black">✓</span>{message}
      <button onClick={onClose} className="text-gray-500 hover:text-gray-900 ml-2">✕</button>
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
          <h1 className="text-2xl font-bold text-gray-900">Walk-In Waitlist</h1>
          <p className="text-sm text-gray-500 mt-0.5">Manage today's walk-in queue</p>
        </div>
        <div className="flex gap-3">
          <button onClick={load} className="text-gray-500 hover:text-gray-900 transition-colors p-2 rounded-xl hover:bg-gray-100">
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
          <p className="text-xs text-gray-500">Currently Waiting</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">{active.filter(e => e.status === "waiting").length}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-gray-500">Being Served</p>
          <p className="text-2xl font-bold text-black mt-1">{active.filter(e => e.status === "called").length}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-gray-500">Avg Wait Time</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">{avgWait > 0 ? `${avgWait}m` : "—"}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-gray-500">Served Today</p>
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
            <div className="py-8 text-center text-gray-500">Loading...</div>
          ) : active.length === 0 ? (
            <div className="py-16 text-center">
              <Users size={40} className="mx-auto mb-4 text-gray-600" />
              <p className="text-gray-900 font-medium">Queue is empty</p>
              <p className="text-sm text-gray-500 mt-1">Add a walk-in client to get started</p>
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
                    entry.status === "called" ? "bg-black/5 border-black" : "bg-gray-100 border-gray-200",
                    isLong && entry.status === "waiting" && "border-orange-500/30"
                  )}>
                    {/* Position */}
                    <div className="flex items-center gap-4">
                      <div className={cn(
                        "w-10 h-10 rounded-full flex items-center justify-center text-lg font-bold flex-shrink-0",
                        entry.status === "called" ? "bg-black/10 text-black" : "bg-gray-50 shadow-sm text-gray-600"
                      )}>
                        {idx + 1}
                      </div>
                      <div>
                        <p className="text-gray-900 font-semibold">{entry.client_name}</p>
                        <div className="flex flex-wrap gap-3 mt-1 text-xs text-gray-500">
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
                      {entry.status === "waiting" && (
                        <Button size="sm" variant="outline" onClick={() => updateStatus(entry.id, "called")}>
                          <Bell size={13} /> Call
                        </Button>
                      )}
                      {entry.status === "called" && (
                        <Button size="sm" onClick={() => updateStatus(entry.id, "served")}>
                          <Check size={13} /> Served
                        </Button>
                      )}
                      <button
                        onClick={() => updateStatus(entry.id, "removed")}
                        className="text-xs text-gray-500 hover:text-red-400 transition-colors text-center py-1"
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
              <span className="text-xs text-gray-500">{showHistory ? "Hide" : "Show"}</span>
            </button>
          </CardHeader>
          {showHistory && (
            <CardContent>
              <div className="space-y-2">
                {history.map(entry => (
                  <div key={entry.id} className="flex items-center justify-between gap-4 p-3 rounded-xl border border-gray-200/50 opacity-60">
                    <div>
                      <p className="text-sm text-gray-900">{entry.client_name}</p>
                      {entry.client_phone && <p className="text-xs text-gray-500">{entry.client_phone}</p>}
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
            <div className="bg-gray-50 shadow-sm border border-gray-200 rounded-2xl p-6 w-full max-w-md space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold text-gray-900">Add Walk-In</h2>
                <button onClick={() => setShowAdd(false)} className="text-gray-500 hover:text-gray-900 text-xl leading-none">✕</button>
              </div>
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <label className="text-xs text-gray-500">Client Name *</label>
                  <input
                    value={form.client_name}
                    onChange={e => setForm(p => ({ ...p, client_name: e.target.value }))}
                    onKeyDown={e => e.key === "Enter" && addEntry()}
                    placeholder="John Smith"
                    autoFocus
                    className="w-full bg-gray-100 border border-gray-200 rounded-xl px-4 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-black"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs text-gray-500">Phone (optional)</label>
                  <input
                    value={form.client_phone}
                    onChange={e => setForm(p => ({ ...p, client_phone: e.target.value }))}
                    placeholder="(416) 555-0123"
                    type="tel"
                    className="w-full bg-gray-100 border border-gray-200 rounded-xl px-4 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-black"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-xs text-gray-500">Preferred Barber</label>
                    <select value={form.barber_id} onChange={e => setForm(p => ({ ...p, barber_id: e.target.value }))}
                      className="w-full bg-gray-100 border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:border-black">
                      <option value="">Any</option>
                      {barbers.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs text-gray-500">Service</label>
                    <select value={form.service_id} onChange={e => setForm(p => ({ ...p, service_id: e.target.value }))}
                      className="w-full bg-gray-100 border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:border-black">
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
    </div>
  );
}
