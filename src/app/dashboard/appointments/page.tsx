"use client";
import { useState, useMemo, useEffect, useCallback } from "react";
import { cn, formatCurrency, getStatusColor, formatDateForDb } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Input, Select, Textarea } from "@/components/ui/input";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import type { AppointmentWithDetails, Barber } from "@/lib/database.types";
import type { Service } from "@/lib/database.types";

function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse bg-surface-raised rounded-xl", className)} />;
}

function Toast({ message, onClose }: { message: string; onClose: () => void }) {
  return (
    <div className="fixed bottom-6 right-6 z-[100] bg-surface-raised border border-border rounded-xl px-5 py-3 text-sm text-white shadow-xl flex items-center gap-3">
      <span className="text-gold">✓</span>{message}
      <button onClick={onClose} className="text-gray-400 hover:text-white ml-2">✕</button>
    </div>
  );
}

const STATUS_OPTIONS = ["confirmed", "pending", "completed", "cancelled", "no-show"] as const;
type AppStatus = typeof STATUS_OPTIONS[number];

export default function AppointmentsPage() {
  const { shop, profile } = useAuth();
  const [tab, setTab] = useState<"appointments" | "waitlist">("appointments");
  const [search, setSearch] = useState("");
  const [dateFilter, setDateFilter] = useState("today");
  const [barberFilter, setBarberFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [appointments, setAppointments] = useState<AppointmentWithDetails[]>([]);
  const [barbers, setBarbers] = useState<Barber[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [waitlist, setWaitlist] = useState<{ id: string; client_name: string; client_phone: string | null; service_id: string | null; barber_id: string | null; added_at: string }[]>([]);
  const [selectedApt, setSelectedApt] = useState<AppointmentWithDetails | null>(null);
  const [notes, setNotes] = useState("");
  const [showAddModal, setShowAddModal] = useState(false);
  const [toast, setToast] = useState("");
  const [savingStatus, setSavingStatus] = useState("");

  // Add appointment form state
  const [addForm, setAddForm] = useState({ client_name: "", client_phone: "", barber_id: "", service_id: "", date: formatDateForDb(new Date()), time_slot: "9:00 AM" });
  const [savingAdd, setSavingAdd] = useState(false);
  const [myBarberId, setMyBarberId] = useState<string | null>(null);

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(""), 3000); };

  // Resolve barber record for logged-in barbers
  useEffect(() => {
    if (!profile || profile.role !== "barber" || !shop) return;
    supabase.from("barbers").select("id").eq("user_id", profile.id).eq("shop_id", shop.id).maybeSingle()
      .then(({ data }) => { if (data) setMyBarberId(data.id); });
  }, [profile, shop]);

  const loadData = useCallback(async () => {
    if (!shop) { setLoading(false); return; }
    setLoading(true);

    const today = formatDateForDb(new Date());
    const weekAgo = formatDateForDb(new Date(Date.now() - 7 * 86400000));
    const weekAhead = formatDateForDb(new Date(Date.now() + 7 * 86400000));

    let apptQuery = supabase
      .from("appointments")
      .select("*, barbers(id, name), services(id, name, price, category)")
      .eq("shop_id", shop.id)
      .order("date", { ascending: false })
      .order("time_slot", { ascending: true });

    if (dateFilter === "today") apptQuery = apptQuery.eq("date", today);
    else if (dateFilter === "week") apptQuery = apptQuery.gte("date", weekAgo).lte("date", weekAhead);

    // Barbers only see their own appointments
    if (profile?.role === "barber" && myBarberId) {
      apptQuery = apptQuery.eq("barber_id", myBarberId);
    }

    const [{ data: appts }, { data: bs }, { data: svcs }, { data: wl }] = await Promise.all([
      apptQuery,
      supabase.from("barbers").select("*").eq("shop_id", shop.id).eq("is_active", true),
      supabase.from("services").select("*").eq("shop_id", shop.id).eq("is_active", true),
      supabase.from("waitlist").select("*").eq("shop_id", shop.id).order("added_at", { ascending: true }),
    ]);

    setAppointments((appts ?? []) as AppointmentWithDetails[]);
    setBarbers((bs ?? []) as Barber[]);
    setServices((svcs ?? []) as Service[]);
    setWaitlist(wl ?? []);
    setLoading(false);
  }, [shop, dateFilter, profile, myBarberId]);

  useEffect(() => { loadData(); }, [loadData]);

  const updateStatus = async (id: string, status: AppStatus) => {
    setSavingStatus(id);
    await supabase.from("appointments").update({ status }).eq("id", id);
    setSavingStatus("");

    const appt = appointments.find(a => a.id === id);

    if (status === "completed" && appt && shop) {
      // Update client stats: increment visits, add spent, update last_visit
      if (appt.client_email || appt.client_phone) {
        const matchField = appt.client_email ? "email" : "phone";
        const matchVal = appt.client_email || appt.client_phone;
        const { data: clientRow } = await supabase
          .from("clients")
          .select("id, total_visits, total_spent")
          .eq("shop_id", shop.id)
          .eq(matchField, matchVal)
          .maybeSingle();
        if (clientRow) {
          await supabase.from("clients").update({
            total_visits: (clientRow.total_visits ?? 0) + 1,
            total_spent: (clientRow.total_spent ?? 0) + (appt.total_amount ?? 0),
            last_visit: appt.date,
          }).eq("id", clientRow.id);
        }
      }

      // Send review request email (fire-and-forget)
      if (appt.client_email) {
        fetch("/api/send-email", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "review_request",
            data: {
              clientName: appt.client_name,
              clientEmail: appt.client_email,
              shopName: shop.name,
              barberName: (appt.barbers as { name: string } | null)?.name ?? "Your barber",
              serviceName: (appt.services as { name: string } | null)?.name ?? "Your service",
              reviewUrl: `${window.location.origin}/book/${shop.slug}/review?booking=${id}`,
            },
          }),
        }).catch(() => null);
      }
    }

    setAppointments(prev => prev.map(a => a.id === id ? { ...a, status } : a));
    if (selectedApt?.id === id) setSelectedApt(prev => prev ? { ...prev, status } : null);
    showToast(`Marked as ${status}`);
  };

  const saveNotes = async () => {
    if (!selectedApt) return;
    await supabase.from("appointments").update({ notes }).eq("id", selectedApt.id);
    setAppointments(prev => prev.map(a => a.id === selectedApt.id ? { ...a, notes } : a));
    showToast("Notes saved");
  };

  const addAppointment = async () => {
    if (!shop || !addForm.client_name || !addForm.service_id) { showToast("Fill in required fields"); return; }
    setSavingAdd(true);
    const svc = services.find(s => s.id === addForm.service_id);
    const { error } = await supabase.from("appointments").insert({
      shop_id: shop.id,
      barber_id: addForm.barber_id || null,
      service_id: addForm.service_id,
      client_name: addForm.client_name,
      client_phone: addForm.client_phone || null,
      date: addForm.date,
      time_slot: addForm.time_slot,
      status: "confirmed",
      total_amount: svc?.price ?? 0,
    });
    setSavingAdd(false);
    if (error) { showToast("Failed to add appointment"); return; }
    setShowAddModal(false);
    setAddForm({ client_name: "", client_phone: "", barber_id: "", service_id: "", date: formatDateForDb(new Date()), time_slot: "9:00 AM" });
    showToast("Appointment added!");
    loadData();
  };

  const filtered = useMemo(() => {
    let apts = [...appointments];
    if (barberFilter !== "all") apts = apts.filter(a => a.barber_id === barberFilter);
    if (statusFilter !== "all") apts = apts.filter(a => a.status === statusFilter);
    if (search) apts = apts.filter(a =>
      a.client_name.toLowerCase().includes(search.toLowerCase()) ||
      (a.client_phone ?? "").includes(search)
    );
    return apts;
  }, [appointments, barberFilter, statusFilter, search]);

  const today = formatDateForDb(new Date());
  const todayApts = appointments.filter(a => a.date === today);
  const confirmed = todayApts.filter(a => a.status === "confirmed").length;
  const noShows = todayApts.filter(a => a.status === "no-show").length;
  const revenue = todayApts.filter(a => a.status === "completed").reduce((s, a) => s + (a.total_amount ?? 0), 0);

  const TIME_SLOTS = ["8:00 AM","8:30 AM","9:00 AM","9:30 AM","10:00 AM","10:30 AM","11:00 AM","11:30 AM","12:00 PM","12:30 PM","1:00 PM","1:30 PM","2:00 PM","2:30 PM","3:00 PM","3:30 PM","4:00 PM","4:30 PM","5:00 PM","5:30 PM","6:00 PM","6:30 PM","7:00 PM"];

  if (!shop) {
    return (
      <div className="p-8 flex flex-col items-center justify-center min-h-[60vh] text-center">
        <p className="text-gray-500">No shop found. Set up your shop first.</p>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {toast && <Toast message={toast} onClose={() => setToast("")} />}

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Appointments</h1>
          <p className="text-sm text-gray-400 mt-0.5">Manage bookings and waitlist</p>
        </div>
        <Button onClick={() => setShowAddModal(true)}>+ Add Appointment</Button>
      </div>

      {/* Stats bar */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "Total Today", value: todayApts.length, color: "text-white" },
          { label: "Confirmed", value: confirmed, color: "text-emerald-400" },
          { label: "No-Shows", value: noShows, color: "text-orange-400" },
          { label: "Revenue Today", value: formatCurrency(revenue), color: "text-gold" },
        ].map(s => (
          <Card key={s.label} className="py-4 px-5">
            <p className="text-xs text-gray-400">{s.label}</p>
            <p className={cn("text-2xl font-bold mt-1", s.color)}>{s.value}</p>
          </Card>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border">
        {(["appointments", "waitlist"] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={cn("px-4 py-2 text-sm font-medium capitalize border-b-2 -mb-px transition-colors",
              tab === t ? "border-gold text-gold" : "border-transparent text-gray-400 hover:text-white")}>
            {t} {t === "waitlist" && waitlist.length > 0 && (
              <span className="ml-1 text-xs bg-gold/20 text-gold px-1.5 rounded-full">{waitlist.length}</span>
            )}
          </button>
        ))}
      </div>

      {tab === "appointments" ? (
        <>
          {/* Filters */}
          <div className="flex flex-wrap gap-3">
            <Input placeholder="Search client…" value={search} onChange={e => setSearch(e.target.value)} className="w-48" />
            <select value={dateFilter} onChange={e => setDateFilter(e.target.value)}
              className="rounded-xl border border-border bg-surface-raised px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-gold/50">
              <option value="today">Today</option>
              <option value="week">This Week</option>
              <option value="all">All Time</option>
            </select>
            <select value={barberFilter} onChange={e => setBarberFilter(e.target.value)}
              className="rounded-xl border border-border bg-surface-raised px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-gold/50">
              <option value="all">All Barbers</option>
              {barbers.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
              className="rounded-xl border border-border bg-surface-raised px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-gold/50">
              <option value="all">All Statuses</option>
              {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
            </select>
          </div>

          {loading ? (
            <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-14" />)}</div>
          ) : (
            <Card className="p-0 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="border-b border-border">
                    <tr>
                      {["Date", "Time", "Client", "Barber", "Service", "Status", "Amount", "Actions"].map(h => (
                        <th key={h} className="text-left text-xs font-medium text-gray-400 px-4 py-3">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.length === 0 ? (
                      <tr><td colSpan={8} className="text-center py-12 text-gray-400">No appointments found</td></tr>
                    ) : filtered.map(apt => (
                      <tr key={apt.id} onClick={() => { setSelectedApt(apt); setNotes(apt.notes ?? ""); }}
                        className="border-b border-border/50 hover:bg-surface-raised/50 cursor-pointer transition-colors">
                        <td className="px-4 py-3 text-sm text-gray-300">{apt.date}</td>
                        <td className="px-4 py-3 text-sm text-white font-medium">{apt.time_slot}</td>
                        <td className="px-4 py-3">
                          <p className="text-sm text-white">{apt.client_name}</p>
                          <p className="text-xs text-gray-400">{apt.client_phone}</p>
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-300">{apt.barbers?.name ?? "—"}</td>
                        <td className="px-4 py-3 text-sm text-gray-300">{apt.services?.name ?? "—"}</td>
                        <td className="px-4 py-3">
                          <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium border", getStatusColor(apt.status))}>
                            {apt.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-sm text-white">{formatCurrency(apt.total_amount)}</td>
                        <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                          <div className="flex gap-1">
                            <button onClick={() => updateStatus(apt.id, "confirmed")} disabled={savingStatus === apt.id}
                              className="text-xs px-2 py-1 rounded-lg bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 disabled:opacity-50">✓</button>
                            <button onClick={() => updateStatus(apt.id, "completed")} disabled={savingStatus === apt.id}
                              className="text-xs px-2 py-1 rounded-lg bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 disabled:opacity-50">Done</button>
                            <button onClick={() => updateStatus(apt.id, "cancelled")} disabled={savingStatus === apt.id}
                              className="text-xs px-2 py-1 rounded-lg bg-red-500/20 text-red-400 hover:bg-red-500/30 disabled:opacity-50">✕</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </>
      ) : (
        <Card>
          <CardHeader><CardTitle>Waitlist ({waitlist.length})</CardTitle></CardHeader>
          <CardContent>
            {waitlist.length === 0 ? (
              <p className="text-center text-gray-400 py-8">No one on the waitlist right now</p>
            ) : (
              <div className="space-y-3">
                {waitlist.map(wl => {
                  const svc = services.find(s => s.id === wl.service_id);
                  const barber = barbers.find(b => b.id === wl.barber_id);
                  return (
                    <div key={wl.id} className="flex items-center justify-between p-4 bg-surface-raised rounded-xl border border-border">
                      <div>
                        <p className="text-sm font-medium text-white">{wl.client_name} · {svc?.name ?? "Any Service"}</p>
                        <p className="text-xs text-gray-400">{wl.client_phone} · Preferred: {barber?.name ?? "Any Barber"}</p>
                        <p className="text-xs text-gray-500 mt-1">Added: {new Date(wl.added_at).toLocaleTimeString("en-CA", { hour: "2-digit", minute: "2-digit" })}</p>
                      </div>
                      <div className="flex gap-2">
                        <Button size="sm" variant="outline" onClick={() => showToast("Barber assigned")}>Assign</Button>
                        <Button size="sm" variant="danger" onClick={async () => {
                          await supabase.from("waitlist").delete().eq("id", wl.id);
                          setWaitlist(prev => prev.filter(w => w.id !== wl.id));
                        }}>Remove</Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Side Panel */}
      {selectedApt && (
        <>
          <div className="fixed inset-0 bg-black/50 z-40" onClick={() => setSelectedApt(null)} />
          <div className="fixed right-0 top-0 h-full w-full max-w-md bg-surface border-l border-border z-50 overflow-y-auto p-6 space-y-5">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-white">Appointment Details</h2>
              <button onClick={() => setSelectedApt(null)} className="text-gray-400 hover:text-white text-xl">✕</button>
            </div>
            <div className="space-y-4">
              <div className="p-4 bg-surface-raised rounded-xl border border-border space-y-1">
                <p className="text-xs text-gray-400 uppercase tracking-wide">Client</p>
                <p className="text-white font-semibold">{selectedApt.client_name}</p>
                <p className="text-sm text-gray-300">{selectedApt.client_phone}</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: "Service", value: selectedApt.services?.name ?? "—" },
                  { label: "Barber", value: selectedApt.barbers?.name ?? "—" },
                  { label: "Date", value: selectedApt.date },
                  { label: "Time", value: selectedApt.time_slot },
                  { label: "Amount", value: formatCurrency(selectedApt.total_amount) },
                  { label: "Status", value: selectedApt.status },
                ].map(item => (
                  <div key={item.label} className="p-3 bg-surface-raised rounded-xl border border-border">
                    <p className="text-xs text-gray-400">{item.label}</p>
                    <p className="text-sm text-white mt-0.5 capitalize">{item.value}</p>
                  </div>
                ))}
              </div>
              <Textarea label="Notes" value={notes} onChange={e => setNotes(e.target.value)} rows={3} placeholder="Add notes…" />
              <Button variant="outline" className="w-full" onClick={saveNotes}>Save Notes</Button>
              <div className="grid grid-cols-2 gap-2">
                <Button variant="outline" className="border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10" onClick={() => updateStatus(selectedApt.id, "confirmed")}>Confirm</Button>
                <Button variant="outline" className="border-blue-500/30 text-blue-400 hover:bg-blue-500/10" onClick={() => updateStatus(selectedApt.id, "completed")}>Complete</Button>
                <Button variant="danger" onClick={() => updateStatus(selectedApt.id, "cancelled")}>Cancel</Button>
                <Button variant="outline" className="border-orange-500/30 text-orange-400 hover:bg-orange-500/10" onClick={() => updateStatus(selectedApt.id, "no-show")}>No-Show</Button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Add Appointment Modal */}
      {showAddModal && (
        <>
          <div className="fixed inset-0 bg-black/70 z-40" onClick={() => setShowAddModal(false)} />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="bg-surface border border-border rounded-2xl p-6 w-full max-w-md space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold text-white">Add Appointment</h2>
                <button onClick={() => setShowAddModal(false)} className="text-gray-400 hover:text-white">✕</button>
              </div>
              <Input label="Client Name *" value={addForm.client_name} onChange={e => setAddForm(p => ({ ...p, client_name: e.target.value }))} placeholder="Marcus Johnson" />
              <Input label="Phone" value={addForm.client_phone} onChange={e => setAddForm(p => ({ ...p, client_phone: e.target.value }))} placeholder="(506) 555-0000" />
              <Select label="Barber" value={addForm.barber_id} onChange={e => setAddForm(p => ({ ...p, barber_id: e.target.value }))}>
                <option value="">Any Barber</option>
                {barbers.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
              </Select>
              <Select label="Service *" value={addForm.service_id} onChange={e => setAddForm(p => ({ ...p, service_id: e.target.value }))}>
                <option value="">Select a service</option>
                {services.map(s => <option key={s.id} value={s.id}>{s.name} — {formatCurrency(s.price)}</option>)}
              </Select>
              <Input label="Date" type="date" value={addForm.date} onChange={e => setAddForm(p => ({ ...p, date: e.target.value }))} />
              <Select label="Time" value={addForm.time_slot} onChange={e => setAddForm(p => ({ ...p, time_slot: e.target.value }))}>
                {TIME_SLOTS.map(t => <option key={t} value={t}>{t}</option>)}
              </Select>
              <div className="flex gap-3 pt-2">
                <Button variant="outline" className="flex-1" onClick={() => setShowAddModal(false)}>Cancel</Button>
                <Button className="flex-1" loading={savingAdd} onClick={addAppointment}>Save</Button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
