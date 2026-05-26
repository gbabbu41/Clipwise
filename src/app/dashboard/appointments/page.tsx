"use client";
import { useState, useMemo } from "react";
import { mockAppointments, mockBarbers, mockServices, mockWaitlist } from "@/lib/mock-data";
import { cn, formatCurrency, getStatusColor } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Input, Select, Textarea } from "@/components/ui/input";

type Appointment = typeof mockAppointments[0];

function Toast({ message, onClose }: { message: string; onClose: () => void }) {
  return (
    <div className="fixed bottom-6 right-6 z-[100] bg-surface-raised border border-border rounded-xl px-5 py-3 text-sm text-white shadow-xl flex items-center gap-3">
      <span className="text-gold">✓</span>
      {message}
      <button onClick={onClose} className="text-gray-400 hover:text-white ml-2">✕</button>
    </div>
  );
}

export default function AppointmentsPage() {
  const [tab, setTab] = useState<"appointments" | "waitlist">("appointments");
  const [search, setSearch] = useState("");
  const [dateFilter, setDateFilter] = useState("today");
  const [barberFilter, setBarberFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [paymentFilter, setPaymentFilter] = useState("all");
  const [sortField, setSortField] = useState<keyof Appointment>("time_slot");
  const [sortAsc, setSortAsc] = useState(true);
  const [selectedApt, setSelectedApt] = useState<Appointment | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [notes, setNotes] = useState("");
  const [toast, setToast] = useState("");
  const [statuses, setStatuses] = useState<Record<string, string>>({});
  const [waitlist, setWaitlist] = useState(mockWaitlist);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(""), 3000);
  };

  const today = "2026-05-24";

  const filtered = useMemo(() => {
    let apts = [...mockAppointments];
    if (dateFilter === "today") apts = apts.filter(a => a.date === today);
    else if (dateFilter === "week") apts = apts.filter(a => a.date >= "2026-05-20" && a.date <= "2026-05-26");
    if (barberFilter !== "all") apts = apts.filter(a => a.barber_id === barberFilter);
    if (statusFilter !== "all") apts = apts.filter(a => (statuses[a.id] || a.status) === statusFilter);
    if (paymentFilter !== "all") apts = apts.filter(a => a.payment_method === paymentFilter);
    if (search) apts = apts.filter(a => a.client_name.toLowerCase().includes(search.toLowerCase()) || a.client_phone.includes(search));
    return apts.sort((a, b) => {
      const av = a[sortField] ?? "";
      const bv = b[sortField] ?? "";
      return sortAsc ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
    });
  }, [search, dateFilter, barberFilter, statusFilter, paymentFilter, sortField, sortAsc, statuses]);

  const todayApts = mockAppointments.filter(a => a.date === today);
  const confirmed = todayApts.filter(a => (statuses[a.id] || a.status) === "confirmed").length;
  const noShows = todayApts.filter(a => (statuses[a.id] || a.status) === "no-show").length;
  const revenue = todayApts.filter(a => (statuses[a.id] || a.status) === "completed").reduce((s, a) => s + a.total_amount, 0);

  const toggleSort = (field: keyof Appointment) => {
    if (sortField === field) setSortAsc(!sortAsc);
    else { setSortField(field); setSortAsc(true); }
  };

  const updateStatus = (id: string, status: string) => {
    setStatuses(prev => ({ ...prev, [id]: status }));
    if (selectedApt?.id === id) setSelectedApt(prev => prev ? { ...prev, status: status as typeof prev.status } : null);
    showToast(`Appointment marked as ${status}`);
  };

  const Th = ({ label, field }: { label: string; field: keyof Appointment }) => (
    <th className="text-left text-xs font-medium text-gray-400 px-4 py-3 cursor-pointer select-none hover:text-gold" onClick={() => toggleSort(field)}>
      {label} {sortField === field ? (sortAsc ? "↑" : "↓") : ""}
    </th>
  );

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
            {t} {t === "waitlist" && <span className="ml-1 text-xs bg-gold/20 text-gold px-1.5 rounded-full">{waitlist.length}</span>}
          </button>
        ))}
      </div>

      {tab === "appointments" ? (
        <>
          {/* Filters */}
          <div className="flex flex-wrap gap-3">
            <Input placeholder="Search client..." value={search} onChange={e => setSearch(e.target.value)} className="w-48" />
            <select value={dateFilter} onChange={e => setDateFilter(e.target.value)}
              className="rounded-xl border border-border bg-surface-raised px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-gold/50">
              <option value="today">Today</option>
              <option value="week">This Week</option>
              <option value="all">All</option>
            </select>
            <select value={barberFilter} onChange={e => setBarberFilter(e.target.value)}
              className="rounded-xl border border-border bg-surface-raised px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-gold/50">
              <option value="all">All Barbers</option>
              {mockBarbers.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
              className="rounded-xl border border-border bg-surface-raised px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-gold/50">
              {["all","confirmed","pending","completed","cancelled","no-show"].map(s => (
                <option key={s} value={s}>{s === "all" ? "All Statuses" : s.charAt(0).toUpperCase() + s.slice(1)}</option>
              ))}
            </select>
            <select value={paymentFilter} onChange={e => setPaymentFilter(e.target.value)}
              className="rounded-xl border border-border bg-surface-raised px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-gold/50">
              <option value="all">All Payments</option>
              <option value="card">Card</option>
              <option value="cash">Cash</option>
              <option value="online">Online</option>
            </select>
          </div>

          {/* Table */}
          <Card className="p-0 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="border-b border-border">
                  <tr>
                    <Th label="Time" field="time_slot" />
                    <Th label="Client" field="client_name" />
                    <Th label="Barber" field="barber_name" />
                    <Th label="Service" field="service_name" />
                    <th className="text-left text-xs font-medium text-gray-400 px-4 py-3">Status</th>
                    <Th label="Amount" field="total_amount" />
                    <th className="text-left text-xs font-medium text-gray-400 px-4 py-3">Payment</th>
                    <th className="text-left text-xs font-medium text-gray-400 px-4 py-3">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 ? (
                    <tr><td colSpan={8} className="text-center py-12 text-gray-400">No appointments found</td></tr>
                  ) : filtered.map(apt => {
                    const status = statuses[apt.id] || apt.status;
                    return (
                      <tr key={apt.id} onClick={() => { setSelectedApt({ ...apt, status: status as typeof apt.status }); setNotes(apt.notes); }}
                        className="border-b border-border/50 hover:bg-surface-raised/50 cursor-pointer transition-colors">
                        <td className="px-4 py-3 text-sm text-white font-medium">{apt.time_slot}</td>
                        <td className="px-4 py-3">
                          <p className="text-sm text-white">{apt.client_name}</p>
                          <p className="text-xs text-gray-400">{apt.client_phone}</p>
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-300">{apt.barber_name}</td>
                        <td className="px-4 py-3 text-sm text-gray-300">{apt.service_name}</td>
                        <td className="px-4 py-3">
                          <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium border", getStatusColor(status))}>
                            {status}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-sm text-white">{formatCurrency(apt.total_amount)}</td>
                        <td className="px-4 py-3 text-sm text-gray-300 capitalize">{apt.payment_method}</td>
                        <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                          <div className="flex gap-1">
                            <button onClick={() => updateStatus(apt.id, "confirmed")}
                              className="text-xs px-2 py-1 rounded-lg bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30">✓</button>
                            <button onClick={() => updateStatus(apt.id, "completed")}
                              className="text-xs px-2 py-1 rounded-lg bg-blue-500/20 text-blue-400 hover:bg-blue-500/30">Done</button>
                            <button onClick={() => updateStatus(apt.id, "cancelled")}
                              className="text-xs px-2 py-1 rounded-lg bg-red-500/20 text-red-400 hover:bg-red-500/30">✕</button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      ) : (
        /* Waitlist */
        <Card>
          <CardHeader><CardTitle>Waitlist ({waitlist.length})</CardTitle></CardHeader>
          <CardContent>
            {waitlist.length === 0 ? (
              <p className="text-center text-gray-400 py-8">No one on the waitlist</p>
            ) : (
              <div className="space-y-3">
                {waitlist.map(wl => (
                  <div key={wl.id} className="flex items-center justify-between p-4 bg-surface-raised rounded-xl border border-border">
                    <div>
                      <p className="text-sm font-medium text-white">{wl.client_name} · {wl.service_name}</p>
                      <p className="text-xs text-gray-400">{wl.client_phone} · Preferred: {wl.barber_name}</p>
                      <p className="text-xs text-gray-500 mt-1">Added: {new Date(wl.added_at).toLocaleTimeString("en-CA", { hour: "2-digit", minute: "2-digit" })}</p>
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" onClick={() => showToast(`Barber assigned to ${wl.client_name}`)}>Assign Barber</Button>
                      <Button size="sm" variant="danger" onClick={() => setWaitlist(prev => prev.filter(w => w.id !== wl.id))}>Remove</Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Side Panel */}
      {selectedApt && (
        <>
          <div className="fixed inset-0 bg-black/50 z-40" onClick={() => setSelectedApt(null)} />
          <div className="fixed right-0 top-0 h-full w-full max-w-md bg-surface border-l border-border z-50 overflow-y-auto p-6 space-y-5 transition-transform">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-white">Appointment Details</h2>
              <button onClick={() => setSelectedApt(null)} className="text-gray-400 hover:text-white text-xl">✕</button>
            </div>
            <div className="space-y-4">
              <div className="p-4 bg-surface-raised rounded-xl border border-border space-y-2">
                <p className="text-xs text-gray-400 uppercase tracking-wide">Client</p>
                <p className="text-white font-semibold">{selectedApt.client_name}</p>
                <p className="text-sm text-gray-300">{selectedApt.client_phone}</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: "Service", value: selectedApt.service_name },
                  { label: "Barber", value: selectedApt.barber_name },
                  { label: "Date", value: selectedApt.date },
                  { label: "Time", value: selectedApt.time_slot },
                  { label: "Amount", value: formatCurrency(selectedApt.total_amount) },
                  { label: "Payment", value: selectedApt.payment_method },
                ].map(item => (
                  <div key={item.label} className="p-3 bg-surface-raised rounded-xl border border-border">
                    <p className="text-xs text-gray-400">{item.label}</p>
                    <p className="text-sm text-white mt-0.5 capitalize">{item.value}</p>
                  </div>
                ))}
              </div>
              <div className="p-3 bg-surface-raised rounded-xl border border-border">
                <p className="text-xs text-gray-400 mb-1">Status</p>
                <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium border", getStatusColor(statuses[selectedApt.id] || selectedApt.status))}>
                  {statuses[selectedApt.id] || selectedApt.status}
                </span>
              </div>
              <Textarea label="Notes" value={notes} onChange={e => setNotes(e.target.value)} rows={3} placeholder="Add notes..." />
              <div className="grid grid-cols-2 gap-2">
                <Button variant="outline" className="border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10" onClick={() => updateStatus(selectedApt.id, "confirmed")}>Confirm</Button>
                <Button variant="outline" className="border-blue-500/30 text-blue-400 hover:bg-blue-500/10" onClick={() => updateStatus(selectedApt.id, "completed")}>Complete</Button>
                <Button variant="danger" onClick={() => updateStatus(selectedApt.id, "cancelled")}>Cancel</Button>
                <Button variant="outline" className="border-orange-500/30 text-orange-400 hover:bg-orange-500/10" onClick={() => updateStatus(selectedApt.id, "no-show")}>No-Show</Button>
              </div>
              <Button variant="outline" className="w-full" onClick={() => showToast("Reschedule feature coming soon!")}>Reschedule</Button>
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
              <Input label="Client Name" placeholder="Enter client name" />
              <Input label="Phone" placeholder="(506) 555-0000" />
              <Select label="Barber">
                {mockBarbers.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
              </Select>
              <Select label="Service">
                {mockServices.map(s => <option key={s.id} value={s.id}>{s.name} — {formatCurrency(s.price)}</option>)}
              </Select>
              <Input label="Date" type="date" defaultValue={today} />
              <Select label="Time">
                {["9:00 AM","9:30 AM","10:00 AM","10:30 AM","11:00 AM","12:00 PM","1:00 PM","2:00 PM","3:00 PM","4:00 PM","5:00 PM"].map(t => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </Select>
              <div className="flex gap-3 pt-2">
                <Button variant="outline" className="flex-1" onClick={() => setShowAddModal(false)}>Cancel</Button>
                <Button className="flex-1" onClick={() => { setShowAddModal(false); showToast("Appointment added!"); }}>Save Appointment</Button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
