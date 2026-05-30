"use client";
import { useState, useEffect, useCallback } from "react";
import { useBarber } from "@/lib/barber-context";
import { supabase } from "@/lib/supabase";
import { cn, formatDateForDb } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { CalendarOff, Plus, Clock, X } from "lucide-react";

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

export default function BarberTimeOffPage() {
  const { barber, shop } = useBarber();
  const [requests, setRequests] = useState<TimeOffRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [saving, setSaving] = useState(false);

  const today = formatDateForDb(new Date());
  const [form, setForm] = useState({
    type: "day_off" as BlockType,
    start_date: today,
    end_date: today,
    start_time: "",
    end_time: "",
    reason: "",
  });

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(""), 3000); };

  const loadRequests = useCallback(async () => {
    if (!barber?.id || !shop?.id) return;
    setLoading(true);
    const { data } = await supabase
      .from("time_off_requests")
      .select("*")
      .eq("barber_id", barber.id)
      .eq("shop_id", shop.id)
      .order("start_date", { ascending: false });
    setRequests((data ?? []) as TimeOffRequest[]);
    setLoading(false);
  }, [barber?.id, shop?.id]);

  useEffect(() => { loadRequests(); }, [loadRequests]);

  const submitRequest = async () => {
    if (!barber?.id || !shop?.id) return;
    if (!form.start_date || !form.end_date) { showToast("Please pick the dates."); return; }
    if (form.end_date < form.start_date) { showToast("End date can't be before start date."); return; }
    if (form.type === "blocked_hours" && (!form.start_time || !form.end_time)) {
      showToast("Pick the blocked hours.");
      return;
    }
    if (form.type === "blocked_hours" && form.end_time <= form.start_time) {
      showToast("End time must be after start time.");
      return;
    }
    setSaving(true);
    const { error } = await supabase.from("time_off_requests").insert({
      barber_id: barber.id,
      shop_id: shop.id,
      type: form.type,
      start_date: form.start_date,
      end_date: form.end_date,
      start_time: form.type === "blocked_hours" ? form.start_time || null : null,
      end_time: form.type === "blocked_hours" ? form.end_time || null : null,
      reason: form.reason || null,
      status: "pending", // owner approves
    });
    setSaving(false);
    if (error) { showToast(`Could not submit: ${error.message}`); return; }
    setShowModal(false);
    setForm({ type: "day_off", start_date: today, end_date: today, start_time: "", end_time: "", reason: "" });
    showToast("Request submitted — your shop owner will approve it.");
    loadRequests();
  };

  const cancelRequest = async (id: string) => {
    await supabase.from("time_off_requests").delete().eq("id", id).eq("barber_id", barber?.id ?? "");
    setRequests(prev => prev.filter(r => r.id !== id));
    showToast("Request cancelled.");
  };

  // Stats
  const pending = requests.filter(r => r.status === "pending").length;
  const approved = requests.filter(r => r.status === "approved").length;
  const upcoming = requests.filter(r => r.status === "approved" && r.start_date >= today).length;

  return (
    <div className="p-6 max-w-4xl mx-auto">
      {toast && <Toast message={toast} onClose={() => setToast("")} />}

      <div className="flex items-center justify-between flex-wrap gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Time Off</h1>
          <p className="text-sm text-gray-400 mt-0.5">Request days off, block hours, log sick days</p>
        </div>
        <Button onClick={() => setShowModal(true)}>
          <Plus size={15} /> Request Time Off
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        {[
          { label: "Pending", value: pending, color: "text-amber-400" },
          { label: "Approved", value: approved, color: "text-emerald-400" },
          { label: "Upcoming", value: upcoming, color: "text-blue-400" },
        ].map(s => (
          <div key={s.label} className="bg-surface border border-border rounded-2xl p-4">
            <p className="text-xs text-gray-500">{s.label}</p>
            <p className={cn("text-2xl font-bold mt-1", s.color)}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Request list */}
      {loading ? (
        <div className="space-y-2">
          {[1,2,3].map(i => <div key={i} className="h-20 bg-surface border border-border rounded-2xl animate-pulse" />)}
        </div>
      ) : requests.length === 0 ? (
        <Card>
          <div className="py-16 text-center">
            <CalendarOff size={36} className="text-gray-600 mx-auto mb-3" />
            <p className="font-medium text-white mb-1">No time-off requests yet</p>
            <p className="text-sm text-gray-500 mb-4 max-w-xs mx-auto">Request a day off, block a few hours, or log a sick day. Your shop owner approves each one.</p>
            <Button size="sm" onClick={() => setShowModal(true)}>
              <Plus size={14} /> Submit Your First Request
            </Button>
          </div>
        </Card>
      ) : (
        <div className="space-y-2">
          {requests.map(req => (
            <div key={req.id} className="bg-surface border border-border rounded-2xl p-4 flex items-center gap-4 flex-wrap">
              <div className="flex items-center gap-3 flex-1 min-w-0">
                <span className={cn("inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium border", TYPE_COLORS[req.type])}>
                  {TYPE_LABELS[req.type]}
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-white">
                    {req.start_date}{req.start_date !== req.end_date && ` → ${req.end_date}`}
                    {req.type === "blocked_hours" && req.start_time && req.end_time && (
                      <span className="text-gray-400 ml-2"><Clock size={11} className="inline" /> {req.start_time}–{req.end_time}</span>
                    )}
                  </p>
                  {req.reason && <p className="text-xs text-gray-500 mt-0.5">{req.reason}</p>}
                </div>
              </div>
              <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium border capitalize", STATUS_COLORS[req.status])}>
                {req.status}
              </span>
              {req.status === "pending" && (
                <button onClick={() => cancelRequest(req.id)} className="text-gray-500 hover:text-red-400 transition-colors" title="Cancel request">
                  <X size={16} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Request modal */}
      {showModal && (
        <>
          <div className="fixed inset-0 bg-black/70 z-40" onClick={() => setShowModal(false)} />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="bg-surface border border-border rounded-2xl p-6 w-full max-w-md space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold text-white">Request Time Off</h2>
                <button onClick={() => setShowModal(false)} className="text-gray-400 hover:text-white text-xl leading-none">✕</button>
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-medium text-gray-300">Type</label>
                <div className="grid grid-cols-2 gap-2">
                  {(Object.keys(TYPE_LABELS) as BlockType[]).map(t => (
                    <button key={t} onClick={() => setForm(f => ({ ...f, type: t }))}
                      className={cn("py-2 px-3 rounded-xl text-sm border transition-colors",
                        form.type === t ? "bg-gold/15 text-gold border-gold/30" : "bg-surface-raised text-gray-300 border-border hover:border-gold/30")}>
                      {TYPE_LABELS[t]}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Input label="Start date" type="date" value={form.start_date} min={today}
                  onChange={e => setForm(f => ({ ...f, start_date: e.target.value }))} />
                <Input label="End date" type="date" value={form.end_date} min={form.start_date}
                  onChange={e => setForm(f => ({ ...f, end_date: e.target.value }))} />
              </div>

              {form.type === "blocked_hours" && (
                <div className="grid grid-cols-2 gap-3">
                  <Input label="Start time" type="time" value={form.start_time}
                    onChange={e => setForm(f => ({ ...f, start_time: e.target.value }))} />
                  <Input label="End time" type="time" value={form.end_time}
                    onChange={e => setForm(f => ({ ...f, end_time: e.target.value }))} />
                </div>
              )}

              <div className="space-y-1.5">
                <label className="text-sm font-medium text-gray-300">Reason <span className="text-gray-600">(optional)</span></label>
                <textarea value={form.reason} onChange={e => setForm(f => ({ ...f, reason: e.target.value }))}
                  rows={2} placeholder="e.g. Doctor appointment, family event…"
                  className="w-full bg-surface-raised border border-border rounded-xl px-4 py-2.5 text-sm text-white placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-gold/50 resize-none" />
              </div>

              <p className="text-xs text-gray-500 bg-surface-raised border border-border rounded-xl px-3 py-2">
                Your shop owner will see this and approve or deny it. You&apos;ll be notified.
              </p>

              <div className="flex gap-3">
                <Button variant="outline" className="flex-1" onClick={() => setShowModal(false)}>Cancel</Button>
                <Button className="flex-1" loading={saving} onClick={submitRequest}>Submit Request</Button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
