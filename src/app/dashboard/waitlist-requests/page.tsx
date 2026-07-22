"use client";
import { useState, useEffect, useCallback } from "react";
import { BellRing, Mail, Phone, Scissors, Calendar, RefreshCw, X, Send } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { WaitlistAssignSheet, type WaitlistRequest } from "@/components/waitlist-assign-sheet";
import type { AppointmentWaitlistEntry, Barber, Service } from "@/lib/database.types";

function Toast({ message, onClose }: { message: string; onClose: () => void }) {
  return (
    <div className="fixed bottom-6 right-6 z-[100] bg-[#141414] border border-[#2a2a2a] rounded-xl px-5 py-3 text-sm text-white shadow-xl flex items-center gap-3">
      <span className="text-white">✓</span>{message}
      <button onClick={onClose} className="text-[#8f8f8f] hover:text-white ml-2">✕</button>
    </div>
  );
}

type StatusVariant = "warning" | "info" | "success" | "danger" | "outline";
const STATUS_CONFIG: Record<AppointmentWaitlistEntry["status"], { label: string; variant: StatusVariant }> = {
  waiting:   { label: "Waiting",   variant: "warning" },
  notified:  { label: "Notified",  variant: "info" },
  converted: { label: "Booked",    variant: "success" },
  cancelled: { label: "Removed",   variant: "danger" },
};

function niceDate(d: string) {
  return new Date(`${d}T12:00:00`).toLocaleDateString("en-CA", { weekday: "long", month: "short", day: "numeric" });
}

export default function WaitlistRequestsPage() {
  const { shop, accessToken } = useAuth();
  const slotInterval = (shop?.booking_settings as { slot_interval_minutes?: number } | null)?.slot_interval_minutes ?? 30;
  const [assignReq, setAssignReq] = useState<WaitlistRequest | null>(null);
  const [entries, setEntries] = useState<AppointmentWaitlistEntry[]>([]);
  const [barbers, setBarbers] = useState<Barber[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState("");
  const [notifyingDate, setNotifyingDate] = useState("");

  const showToast = (m: string) => { setToast(m); setTimeout(() => setToast(""), 3000); };

  const load = useCallback(async () => {
    if (!shop) { setLoading(false); return; }
    setLoading(true);
    const today = new Date().toISOString().slice(0, 10);
    const [{ data: wData }, { data: bData }, { data: sData }] = await Promise.all([
      supabase.from("appointment_waitlist").select("*").eq("shop_id", shop.id)
        .gte("desired_date", today).order("desired_date").order("created_at"),
      supabase.from("barbers").select("*").eq("shop_id", shop.id).order("name"),
      supabase.from("services").select("*").eq("shop_id", shop.id).order("name"),
    ]);
    setEntries((wData ?? []) as AppointmentWaitlistEntry[]);
    setBarbers((bData ?? []) as Barber[]);
    setServices((sData ?? []) as Service[]);
    setLoading(false);
  }, [shop]);

  useEffect(() => { load(); }, [load]);

  // Real-time: new sign-ups appear without a refresh.
  useEffect(() => {
    if (!shop) return;
    const channel = supabase
      .channel(`appointment_waitlist:${shop.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "appointment_waitlist", filter: `shop_id=eq.${shop.id}` }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [shop, load]);

  const removeEntry = async (id: string) => {
    await supabase.from("appointment_waitlist").update({ status: "cancelled" }).eq("id", id);
    setEntries(prev => prev.map(e => e.id === id ? { ...e, status: "cancelled" } : e));
    showToast("Removed from waitlist");
  };


  // Manually nudge everyone still waiting for a given day (email + SMS).
  const notifyDay = async (date: string) => {
    if (!shop) return;
    setNotifyingDate(date);
    try {
      const res = await fetch("/api/waitlist/slot-opened", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shop_id: shop.id, date }),
      });
      const data = await res.json();
      showToast(res.ok ? `Notified ${data.notified ?? 0} waiting` : (data.error ?? "Failed"));
      load();
    } catch {
      showToast("Network error");
    } finally {
      setNotifyingDate("");
    }
  };

  const barberName = (id?: string) => id ? (barbers.find(b => b.id === id)?.name ?? "Barber") : "Any barber";
  const serviceName = (id?: string) => id ? (services.find(s => s.id === id)?.name ?? "Service") : "Any service";

  // Active = waiting/notified, grouped by date. History = converted/cancelled.
  const active = entries.filter(e => e.status === "waiting" || e.status === "notified");
  const dates = Array.from(new Set(active.map(e => e.desired_date)));
  const waitingCount = active.filter(e => e.status === "waiting").length;

  return (
    <div className="p-6 space-y-6">
      {toast && <Toast message={toast} onClose={() => setToast("")} />}

      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white uppercase tracking-wide">Spot Waitlist</h1>
          <p className="text-sm text-[#8f8f8f] mt-0.5">Customers waiting for a spot to open on a full day</p>
        </div>
        <button onClick={load} className="text-[#8f8f8f] hover:text-white transition-colors p-2 rounded-xl hover:bg-[#141414]">
          <RefreshCw size={18} />
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {[
          { label: "Waiting", value: String(waitingCount) },
          { label: "Days with a queue", value: String(dates.length) },
          { label: "Total active", value: String(active.length) },
        ].map(s => (
          <div key={s.label} className="bg-[#0c0c0c] border border-[#2a2a2a] rounded-2xl p-4">
            <p className="text-[10px] text-[#8f8f8f] font-semibold uppercase tracking-wider">{s.label}</p>
            <p className="text-[28px] font-extrabold text-white mt-2 font-mono tracking-tighter leading-none">{s.value}</p>
          </div>
        ))}
      </div>

      {loading ? (
        <div className="py-16 text-center text-[#8f8f8f]">Loading…</div>
      ) : active.length === 0 ? (
        <Card>
          <CardContent>
            <div className="py-16 text-center">
              <BellRing size={40} className="mx-auto mb-4 text-[#8f8f8f]" />
              <p className="text-white font-medium">No one waiting right now</p>
              <p className="text-sm text-[#8f8f8f] mt-1">
                When a day is fully booked, customers can tap &ldquo;Notify me if a spot opens&rdquo; on
                your booking page. They&apos;ll show up here, and get an automatic alert when an
                appointment is cancelled.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {dates.map(date => {
            const dayEntries = active.filter(e => e.desired_date === date);
            return (
              <Card key={date}>
                <CardHeader>
                  <CardTitle>
                    <span className="flex items-center gap-2">
                      <Calendar size={15} className="text-[#8f8f8f]" /> {niceDate(date)}
                    </span>
                  </CardTitle>
                  <Button
                    variant="outline"
                    className="text-xs"
                    loading={notifyingDate === date}
                    onClick={() => notifyDay(date)}
                  >
                    <Send size={13} /> Notify all
                  </Button>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {dayEntries.map(e => (
                      <div key={e.id} className="flex items-start justify-between gap-4 p-3 rounded-xl border border-[#2a2a2a] bg-[#141414]">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="text-white font-semibold">{e.client_name}</p>
                            <Badge variant={STATUS_CONFIG[e.status].variant} className="text-xs">
                              {STATUS_CONFIG[e.status].label}
                            </Badge>
                          </div>
                          <div className="flex flex-wrap gap-3 mt-1 text-xs text-[#8f8f8f]">
                            {e.client_email && <span className="flex items-center gap-1"><Mail size={11} />{e.client_email}</span>}
                            {e.client_phone && <span className="flex items-center gap-1"><Phone size={11} />{e.client_phone}</span>}
                            <span className="flex items-center gap-1"><Scissors size={11} />{barberName(e.barber_id)}</span>
                            <span>{serviceName(e.service_id)}</span>
                          </div>
                        </div>
                        <div className="flex flex-col gap-1.5 flex-shrink-0">
                          <button onClick={() => setAssignReq({ id: e.id, shop_id: e.shop_id, barber_id: e.barber_id ?? null, service_id: e.service_id ?? null, client_name: e.client_name, desired_date: e.desired_date })}
                            className="btn btn-success btn-sm whitespace-nowrap">Accept &amp; assign</button>
                          <button onClick={() => removeEntry(e.id)} className="text-xs text-[#8f8f8f] hover:text-red-400 transition-colors flex items-center gap-1 justify-center py-1">
                            <X size={12} /> Remove
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {assignReq && (
        <WaitlistAssignSheet
          request={assignReq}
          slotInterval={slotInterval}
          accessToken={accessToken}
          onClose={() => setAssignReq(null)}
          onDone={(msg) => { showToast(msg); load(); }}
        />
      )}
    </div>
  );
}
