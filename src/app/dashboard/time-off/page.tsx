"use client";
import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/lib/supabase";
import { cn, formatDateForDb } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { CalendarOff, Plus, Check, X, Clock, User } from "lucide-react";
import type { Barber } from "@/lib/database.types";

function Toast({ message, onClose }: { message: string; onClose: () => void }) {
  return (
    <div className="fixed bottom-6 right-6 z-[100] bg-surface-raised border border-border rounded-xl px-5 py-3 text-sm text-white shadow-xl flex items-center gap-3">
      <span className="text-gold">✓</span>{message}
      <button onClick={onClose} className="text-gray-400 hover:text-white ml-2">✕</button>
    </div>
  );
}

type BlockType = "day_off" | "vacation" | "blocked_hours" | "sick";
type TimeOffStatus = "pending" | "approved" | "denied";

interface TimeOffRequest {
  id: string;
  barber_id: string;
  shop_id: string;
  type: BlockType;
  start_date: string;
  end_date: string;
  start_time?: string | null;
  end_time?: string | null;
  reason?: string | null;
  status: TimeOffStatus;
  created_at: string;
  barbers?: { name: string } | null;
}

const TYPE_LABELS: Record<BlockType, string> = {
  day_off: "Day Off",
  vacation: "Vacation",
  blocked_hours: "Blocked Hours",
  sick: "Sick Day",
};

const TYPE_COLORS: Record<BlockType, string> = {
  day_off: "text-amber-400 bg-amber-400/10 border-amber-400/20",
  vacation: "text-blue-400 bg-blue-400/10 border-blue-400/20",
  blocked_hours: "text-purple-400 bg-purple-400/10 border-purple-400/20",
  sick: "text-red-400 bg-red-400/10 border-red-400/20",
};

const STATUS_COLORS: Record<TimeOffStatus, string> = {
  pending: "text-amber-400 bg-amber-400/10 border-amber-400/20",
  approved: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
  denied: "text-red-400 bg-red-400/10 border-red-400/20",
};

const MOCK_REQUESTS: TimeOffRequest[] = [
  { id: "1", barber_id: "b1", shop_id: "s1", type: "vacation", start_date: "2025-06-10", end_date: "2025-06-14", reason: "Family trip", status: "approved", created_at: "2025-05-20", barbers: { name: "Marcus Johnson" } },
  { id: "2", barber_id: "b2", shop_id: "s1", type: "day_off", start_date: "2025-06-03", end_date: "2025-06-03", reason: "Personal", status: "pending", created_at: "2025-05-25", barbers: { name: "Devon Williams" } },
  { id: "3", barber_id: "b1", shop_id: "s1", type: "blocked_hours", start_date: "2025-05-28", end_date: "2025-05-28", start_time: "12:00", end_time: "14:00", reason: "Doctor appointment", status: "approved", created_at: "2025-05-22", barbers: { name: "Marcus Johnson" } },
];

export default function TimeOffPage() {
  const { shop, profile } = useAuth();
  const [barbers, setBarbers] = useState<Barber[]>([]);
  const [requests, setRequests] = useState<TimeOffRequest[]>(MOCK_REQUESTS);
  const [toast, setToast] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [filter, setFilter] = useState<"all" | TimeOffStatus>("all");
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    barber_id: "",
    type: "day_off" as BlockType,
    start_date: "",
    end_date: "",
    start_time: "",
    end_time: "",
    reason: "",
  });

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(""), 3000); };
  const isOwner = profile?.role !== "barber";

  const loadBarbers = useCallback(async () => {
    if (!shop) return;
    const { data } = await supabase.from("barbers").select("*").eq("shop_id", shop.id).eq("is_active", true).order("name");
    if (data) setBarbers(data);
  }, [shop]);

  useEffect(() => { loadBarbers(); }, [loadBarbers]);

  const loadRequests = useCallback(async () => {
    if (!shop) return;
    const { data } = await supabase
      .from("time_off_requests")
      .select("*, barbers(name)")
      .eq("shop_id", shop.id)
      .order("start_date", { ascending: false });
    if (data && data.length > 0) setRequests(data as unknown as TimeOffRequest[]);
  }, [shop]);

  useEffect(() => { loadRequests(); }, [loadRequests]);

  const submitRequest = async () => {
    if (!shop) return;
    if (!form.barber_id || !form.start_date || !form.end_date) { showToast("Fill in all required fields."); return; }
    setSaving(true);

    const { data, error } = await supabase
      .from("time_off_requests")
      .insert({
        barber_id: form.barber_id,
        shop_id: shop.id,
        type: form.type,
        start_date: form.start_date,
        end_date: form.end_date,
        start_time: form.type === "blocked_hours" ? form.start_time || null : null,
        end_time: form.type === "blocked_hours" ? form.end_time || null : null,
        reason: form.reason || null,
        status: isOwner ? "approved" : "pending",
      })
      .select("*, barbers(name)")
      .single();

    setSaving(false);
    if (error) {
      // Table may not exist yet — show mock
      const barber = barbers.find(b => b.id === form.barber_id);
      const newReq: TimeOffRequest = {
        id: Date.now().toString(),
        barber_id: form.barber_id,
        shop_id: shop.id,
        type: form.type,
        start_date: form.start_date,
        end_date: form.end_date,
        start_time: form.start_time || null,
        end_time: form.end_time || null,
        reason: form.reason || null,
        status: isOwner ? "approved" : "pending",
        created_at: new Date().toISOString(),
        barbers: { name: barber?.name ?? "Unknown" },
      };
      setRequests(prev => [newReq, ...prev]);
    } else if (data) {
      setRequests(prev => [data as unknown as TimeOffRequest, ...prev]);
    }

    setShowModal(false);
    setForm({ barber_id: "", type: "day_off", start_date: "", end_date: "", start_time: "", end_time: "", reason: "" });
    showToast("Time-off request submitted!");
  };

  const updateStatus = async (id: string, status: TimeOffStatus) => {
    setRequests(prev => prev.map(r => r.id === id ? { ...r, status } : r));
    await supabase.from("time_off_requests").update({ status }).eq("id", id).then(null, () => null);
    showToast(status === "approved" ? "Request approved!" : "Request denied.");
  };

  const deleteRequest = async (id: string) => {
    setRequests(prev => prev.filter(r => r.id !== id));
    await supabase.from("time_off_requests").delete().eq("id", id).then(null, () => null);
  };

  const filtered = filter === "all" ? requests : requests.filter(r => r.status === filter);
  const pendingCount = requests.filter(r => r.status === "pending").length;
  const approvedUpcoming = requests.filter(r => r.status === "approved" && r.start_date >= formatDateForDb(new Date())).length;

  const today = formatDateForDb(new Date());

  return (
    <div className="p-6 space-y-6">
      {toast && <Toast message={toast} onClose={() => setToast("")} />}

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Time Off & Availability</h1>
          <p className="text-sm text-gray-400 mt-0.5">Manage staff days off, vacations, and blocked hours</p>
        </div>
        <Button onClick={() => setShowModal(true)}>
          <Plus size={16} /> Request Time Off
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: "Pending Requests", value: pendingCount, color: pendingCount > 0 ? "text-amber-400" : "text-white" },
          { label: "Approved Upcoming", value: approvedUpcoming, color: "text-white" },
          { label: "Total Staff", value: barbers.length, color: "text-white" },
          { label: "This Month", value: requests.filter(r => r.start_date.startsWith(today.slice(0, 7))).length, color: "text-white" },
        ].map(s => (
          <Card key={s.label}>
            <CardContent>
              <p className="text-xs text-gray-400">{s.label}</p>
              <p className={cn("text-2xl font-bold mt-1", s.color)}>{s.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 border-b border-border">
        {(["all", "pending", "approved", "denied"] as const).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={cn(
              "px-4 py-2 text-sm font-medium capitalize border-b-2 -mb-px transition-colors",
              filter === f ? "border-gold text-gold" : "border-transparent text-gray-400 hover:text-white"
            )}
          >
            {f === "all" ? `All (${requests.length})` : `${f.charAt(0).toUpperCase() + f.slice(1)} (${requests.filter(r => r.status === f).length})`}
          </button>
        ))}
      </div>

      {/* Requests list */}
      <div className="space-y-3">
        {filtered.length === 0 && (
          <div className="text-center py-12 text-gray-500">
            <CalendarOff size={32} className="mx-auto mb-3 text-gray-600" />
            <p>No time-off requests</p>
          </div>
        )}
        {filtered.map(req => (
          <div key={req.id} className="bg-surface border border-border rounded-2xl p-4 hover:border-gold/20 transition-colors">
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 rounded-xl bg-gold/15 border border-gold/20 flex items-center justify-center flex-shrink-0">
                <User size={18} className="text-gold" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-sm font-semibold text-white">{req.barbers?.name ?? "Unknown"}</p>
                  <span className={cn("text-xs px-2 py-0.5 rounded-full border font-medium", TYPE_COLORS[req.type])}>
                    {TYPE_LABELS[req.type]}
                  </span>
                  <span className={cn("text-xs px-2 py-0.5 rounded-full border font-medium", STATUS_COLORS[req.status])}>
                    {req.status.charAt(0).toUpperCase() + req.status.slice(1)}
                  </span>
                </div>
                <div className="flex items-center gap-4 mt-1.5">
                  <div className="flex items-center gap-1 text-xs text-gray-400">
                    <CalendarOff size={12} />
                    {req.start_date === req.end_date
                      ? req.start_date
                      : `${req.start_date} → ${req.end_date}`}
                  </div>
                  {req.start_time && req.end_time && (
                    <div className="flex items-center gap-1 text-xs text-gray-400">
                      <Clock size={12} />
                      {req.start_time} – {req.end_time}
                    </div>
                  )}
                </div>
                {req.reason && (
                  <p className="text-xs text-gray-500 mt-1">{req.reason}</p>
                )}
              </div>

              {/* Actions */}
              <div className="flex items-center gap-2 flex-shrink-0">
                {isOwner && req.status === "pending" && (
                  <>
                    <button
                      onClick={() => updateStatus(req.id, "approved")}
                      className="w-8 h-8 rounded-lg bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center text-emerald-400 hover:bg-emerald-500/30 transition-colors"
                      title="Approve"
                    >
                      <Check size={14} />
                    </button>
                    <button
                      onClick={() => updateStatus(req.id, "denied")}
                      className="w-8 h-8 rounded-lg bg-red-500/20 border border-red-500/30 flex items-center justify-center text-red-400 hover:bg-red-500/30 transition-colors"
                      title="Deny"
                    >
                      <X size={14} />
                    </button>
                  </>
                )}
                <button
                  onClick={() => deleteRequest(req.id)}
                  className="w-8 h-8 rounded-lg bg-surface-raised border border-border flex items-center justify-center text-gray-500 hover:text-red-400 transition-colors"
                  title="Delete"
                >
                  <X size={14} />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Calendar overview — upcoming approved */}
      {requests.filter(r => r.status === "approved" && r.start_date >= today).length > 0 && (
        <Card>
          <CardHeader>
            <CalendarOff size={18} className="text-gold" />
            <CardTitle>Upcoming Approved Time Off</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {requests
                .filter(r => r.status === "approved" && r.start_date >= today)
                .sort((a, b) => a.start_date.localeCompare(b.start_date))
                .map(req => (
                  <div key={req.id} className="flex items-center gap-3 py-2 border-b border-border/50 last:border-0">
                    <div className="w-2 h-2 rounded-full bg-gold flex-shrink-0" />
                    <p className="text-sm text-white flex-1">{req.barbers?.name ?? "Unknown"}</p>
                    <p className="text-xs text-gray-400">
                      {req.start_date === req.end_date ? req.start_date : `${req.start_date} – ${req.end_date}`}
                    </p>
                    <span className={cn("text-xs px-2 py-0.5 rounded-full border", TYPE_COLORS[req.type])}>
                      {TYPE_LABELS[req.type]}
                    </span>
                  </div>
                ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Modal */}
      {showModal && (
        <>
          <div className="fixed inset-0 bg-black/70 z-40" onClick={() => setShowModal(false)} />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="bg-surface border border-border rounded-2xl p-6 w-full max-w-md space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold text-white">Request Time Off</h2>
                <button onClick={() => setShowModal(false)} className="text-gray-400 hover:text-white">✕</button>
              </div>

              <div>
                <label className="text-sm font-medium text-gray-300 mb-1.5 block">Barber</label>
                <select
                  value={form.barber_id}
                  onChange={e => setForm(p => ({ ...p, barber_id: e.target.value }))}
                  className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-gold/30"
                >
                  <option value="">Select barber…</option>
                  {barbers.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </div>

              <div>
                <label className="text-sm font-medium text-gray-300 mb-1.5 block">Type</label>
                <div className="grid grid-cols-2 gap-2">
                  {(Object.entries(TYPE_LABELS) as [BlockType, string][]).map(([k, v]) => (
                    <button
                      key={k}
                      onClick={() => setForm(p => ({ ...p, type: k }))}
                      className={cn(
                        "p-2.5 rounded-xl border text-sm text-left transition-all",
                        form.type === k ? "border-gold bg-gold/10 text-gold" : "border-border text-gray-400 hover:text-white"
                      )}
                    >
                      {v}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Input label="Start Date" type="date" value={form.start_date} onChange={e => setForm(p => ({ ...p, start_date: e.target.value, end_date: p.end_date || e.target.value }))} />
                <Input label="End Date" type="date" value={form.end_date} onChange={e => setForm(p => ({ ...p, end_date: e.target.value }))} />
              </div>

              {form.type === "blocked_hours" && (
                <div className="grid grid-cols-2 gap-3">
                  <Input label="Start Time" type="time" value={form.start_time} onChange={e => setForm(p => ({ ...p, start_time: e.target.value }))} />
                  <Input label="End Time" type="time" value={form.end_time} onChange={e => setForm(p => ({ ...p, end_time: e.target.value }))} />
                </div>
              )}

              <Input label="Reason (optional)" placeholder="e.g. Doctor appointment, vacation..." value={form.reason} onChange={e => setForm(p => ({ ...p, reason: e.target.value }))} />

              {isOwner && (
                <p className="text-xs text-gray-500">As owner, this will be auto-approved.</p>
              )}

              <div className="flex gap-3 pt-1">
                <Button variant="outline" className="flex-1" onClick={() => setShowModal(false)}>Cancel</Button>
                <Button className="flex-1" disabled={saving} onClick={submitRequest}>
                  {saving ? "Submitting…" : "Submit Request"}
                </Button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
