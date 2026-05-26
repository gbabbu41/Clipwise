"use client";
import { useState, useMemo } from "react";
import { mockClients, mockAppointments, mockBarbers } from "@/lib/mock-data";
import { cn, formatCurrency, getTagColor } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Textarea } from "@/components/ui/input";

type Client = typeof mockClients[0];

function Toast({ message, onClose }: { message: string; onClose: () => void }) {
  return (
    <div className="fixed bottom-6 right-6 z-[100] bg-surface-raised border border-border rounded-xl px-5 py-3 text-sm text-white shadow-xl flex items-center gap-3">
      <span className="text-gold">✓</span>{message}
      <button onClick={onClose} className="text-gray-400 hover:text-white ml-2">✕</button>
    </div>
  );
}

export default function ClientsPage() {
  const [tagFilter, setTagFilter] = useState("All");
  const [search, setSearch] = useState("");
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [notes, setNotes] = useState("");
  const [toast, setToast] = useState("");
  const [showAddModal, setShowAddModal] = useState(false);
  const [addPointsClient, setAddPointsClient] = useState<Client | null>(null);
  const [pointsToAdd, setPointsToAdd] = useState("10");

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(""), 3000); };

  const stats = {
    total: mockClients.length,
    vip: mockClients.filter(c => c.tag === "VIP").length,
    atRisk: mockClients.filter(c => c.tag === "At Risk").length,
    newThisMonth: mockClients.filter(c => c.tag === "New").length,
  };

  const filtered = useMemo(() => {
    let clients = [...mockClients];
    if (tagFilter !== "All") clients = clients.filter(c => c.tag === tagFilter);
    if (search) clients = clients.filter(c => c.name.toLowerCase().includes(search.toLowerCase()) || c.phone.includes(search));
    return clients;
  }, [tagFilter, search]);

  const clientAppointments = selectedClient
    ? mockAppointments.filter(a => a.customer_id === selectedClient.id)
    : [];

  const getBarberName = (id: string | null) => mockBarbers.find(b => b.id === id)?.name ?? "Any Barber";

  return (
    <div className="p-6 space-y-6">
      {toast && <Toast message={toast} onClose={() => setToast("")} />}

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Clients</h1>
          <p className="text-sm text-gray-400 mt-0.5">Manage your client base</p>
        </div>
        <Button onClick={() => setShowAddModal(true)}>+ Add Client</Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "Total Clients", value: stats.total, color: "text-white" },
          { label: "VIP Clients", value: stats.vip, color: "text-yellow-400" },
          { label: "At Risk", value: stats.atRisk, color: "text-red-400" },
          { label: "New This Month", value: stats.newThisMonth, color: "text-emerald-400" },
        ].map(s => (
          <Card key={s.label} className="py-4 px-5">
            <p className="text-xs text-gray-400">{s.label}</p>
            <p className={cn("text-2xl font-bold mt-1", s.color)}>{s.value}</p>
          </Card>
        ))}
      </div>

      {/* Filter & Search */}
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex rounded-xl border border-border overflow-hidden">
          {["All","VIP","New","Returning","At Risk"].map(t => (
            <button key={t} onClick={() => setTagFilter(t)}
              className={cn("px-4 py-2 text-sm font-medium transition-colors", tagFilter === t ? "bg-gold text-black" : "text-gray-400 hover:text-white bg-surface-raised")}>
              {t}
            </button>
          ))}
        </div>
        <Input placeholder="Search clients..." value={search} onChange={e => setSearch(e.target.value)} className="w-56" />
        <div className="flex gap-1 ml-auto">
          <button onClick={() => setViewMode("grid")} className={cn("p-2 rounded-lg border", viewMode === "grid" ? "border-gold text-gold" : "border-border text-gray-400")}>⊞</button>
          <button onClick={() => setViewMode("list")} className={cn("p-2 rounded-lg border", viewMode === "list" ? "border-gold text-gold" : "border-border text-gray-400")}>☰</button>
        </div>
      </div>

      {/* Grid/List */}
      {viewMode === "grid" ? (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map(client => (
            <Card key={client.id} className="hover:border-gold/30 transition-colors cursor-pointer" onClick={() => { setSelectedClient(client); setNotes(client.notes); }}>
              <div className="flex items-start justify-between mb-3">
                <div className="w-10 h-10 rounded-full bg-gold/20 flex items-center justify-center text-gold font-bold text-sm">
                  {client.name.split(" ").map(n => n[0]).join("")}
                </div>
                <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium border", getTagColor(client.tag))}>
                  {client.tag}
                </span>
              </div>
              <h3 className="text-white font-semibold">{client.name}</h3>
              <p className="text-sm text-gray-400">{client.phone}</p>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <div>
                  <p className="text-xs text-gray-500">Visits</p>
                  <p className="text-sm font-semibold text-white">{client.total_visits}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">Spent</p>
                  <p className="text-sm font-semibold text-gold">{formatCurrency(client.total_spent)}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">Points</p>
                  <p className="text-sm font-semibold text-white">{client.loyalty_points}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">Last Visit</p>
                  <p className="text-sm font-semibold text-white">{client.last_visit}</p>
                </div>
              </div>
              <p className="text-xs text-gray-500 mt-2">Preferred: {getBarberName(client.preferred_barber_id)}</p>
              <Button variant="outline" size="sm" className="w-full mt-3">View Profile</Button>
            </Card>
          ))}
        </div>
      ) : (
        <Card className="p-0 overflow-hidden">
          <table className="w-full">
            <thead className="border-b border-border">
              <tr>
                {["Client","Phone","Tag","Visits","Spent","Points","Last Visit"].map(h => (
                  <th key={h} className="text-left text-xs font-medium text-gray-400 px-4 py-3">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(client => (
                <tr key={client.id} onClick={() => { setSelectedClient(client); setNotes(client.notes); }}
                  className="border-b border-border/50 hover:bg-surface-raised/50 cursor-pointer">
                  <td className="px-4 py-3 text-sm font-medium text-white">{client.name}</td>
                  <td className="px-4 py-3 text-sm text-gray-400">{client.phone}</td>
                  <td className="px-4 py-3">
                    <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium border", getTagColor(client.tag))}>{client.tag}</span>
                  </td>
                  <td className="px-4 py-3 text-sm text-white">{client.total_visits}</td>
                  <td className="px-4 py-3 text-sm text-gold">{formatCurrency(client.total_spent)}</td>
                  <td className="px-4 py-3 text-sm text-white">{client.loyalty_points}</td>
                  <td className="px-4 py-3 text-sm text-gray-400">{client.last_visit}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {/* Client Profile Panel */}
      {selectedClient && (
        <>
          <div className="fixed inset-0 bg-black/50 z-40" onClick={() => setSelectedClient(null)} />
          <div className="fixed right-0 top-0 h-full w-full max-w-md bg-surface border-l border-border z-50 overflow-y-auto p-6 space-y-5">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-white">Client Profile</h2>
              <button onClick={() => setSelectedClient(null)} className="text-gray-400 hover:text-white text-xl">✕</button>
            </div>
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 rounded-full bg-gold/20 flex items-center justify-center text-gold font-bold text-lg">
                {selectedClient.name.split(" ").map(n => n[0]).join("")}
              </div>
              <div>
                <h3 className="text-white font-bold text-lg">{selectedClient.name}</h3>
                <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium border", getTagColor(selectedClient.tag))}>
                  {selectedClient.tag}
                </span>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {[
                { label: "Phone", value: selectedClient.phone },
                { label: "Email", value: selectedClient.email },
                { label: "Total Visits", value: String(selectedClient.total_visits) },
                { label: "Total Spent", value: formatCurrency(selectedClient.total_spent) },
                { label: "Loyalty Points", value: String(selectedClient.loyalty_points) },
                { label: "Last Visit", value: selectedClient.last_visit },
                { label: "Preferred Barber", value: getBarberName(selectedClient.preferred_barber_id) },
              ].map(item => (
                <div key={item.label} className="p-3 bg-surface-raised rounded-xl border border-border">
                  <p className="text-xs text-gray-400">{item.label}</p>
                  <p className="text-sm text-white mt-0.5 break-all">{item.value}</p>
                </div>
              ))}
            </div>
            <div>
              <p className="text-sm font-medium text-gray-300 mb-2">Appointment History</p>
              {clientAppointments.length === 0 ? (
                <p className="text-sm text-gray-500">No appointments found</p>
              ) : (
                <div className="space-y-2">
                  {clientAppointments.map(apt => (
                    <div key={apt.id} className="flex items-center justify-between p-3 bg-surface-raised rounded-xl border border-border">
                      <div>
                        <p className="text-sm text-white">{apt.service_name} · {apt.barber_name}</p>
                        <p className="text-xs text-gray-400">{apt.date} {apt.time_slot}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-semibold text-gold">{formatCurrency(apt.total_amount)}</p>
                        <span className={cn("text-xs", apt.status === "completed" ? "text-blue-400" : "text-gray-400")}>{apt.status}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <Textarea label="Notes" value={notes} onChange={e => setNotes(e.target.value)} rows={3} placeholder="Add client notes..." />
            <div className="flex gap-2">
              <Button className="flex-1" size="sm" onClick={() => showToast("Notes saved!")}>Save Notes</Button>
              <Button variant="outline" size="sm" className="flex-1" onClick={() => showToast("SMS reminder sent!")}>Send Reminder</Button>
            </div>
            <div className="p-4 bg-surface-raised rounded-xl border border-border">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-medium text-white">Loyalty Points</p>
                <p className="text-xl font-bold text-gold">{selectedClient.loyalty_points} pts</p>
              </div>
              <div className="w-full h-2 bg-surface rounded-full overflow-hidden mb-3">
                <div className="h-full bg-gold rounded-full" style={{ width: `${Math.min(100, (selectedClient.loyalty_points / 500) * 100)}%` }} />
              </div>
              <Button variant="outline" size="sm" className="w-full" onClick={() => setAddPointsClient(selectedClient)}>+ Add Points</Button>
            </div>
          </div>
        </>
      )}

      {/* Add Points Modal */}
      {addPointsClient && (
        <>
          <div className="fixed inset-0 bg-black/70 z-[60]" onClick={() => setAddPointsClient(null)} />
          <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
            <div className="bg-surface border border-border rounded-2xl p-6 w-full max-w-xs space-y-4">
              <h3 className="text-white font-bold">Add Points for {addPointsClient.name}</h3>
              <Input label="Points to add" type="number" value={pointsToAdd} onChange={e => setPointsToAdd(e.target.value)} />
              <div className="flex gap-2">
                <Button variant="outline" size="sm" className="flex-1" onClick={() => setAddPointsClient(null)}>Cancel</Button>
                <Button size="sm" className="flex-1" onClick={() => { setAddPointsClient(null); showToast(`${pointsToAdd} points added!`); }}>Add Points</Button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Add Client Modal */}
      {showAddModal && (
        <>
          <div className="fixed inset-0 bg-black/70 z-40" onClick={() => setShowAddModal(false)} />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="bg-surface border border-border rounded-2xl p-6 w-full max-w-md space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold text-white">Add New Client</h2>
                <button onClick={() => setShowAddModal(false)} className="text-gray-400 hover:text-white">✕</button>
              </div>
              <Input label="Full Name" placeholder="John Doe" />
              <Input label="Phone" placeholder="(506) 555-0000" />
              <Input label="Email" placeholder="john@email.com" />
              <Textarea label="Notes" placeholder="Any notes about this client..." rows={2} />
              <div className="flex gap-3 pt-2">
                <Button variant="outline" className="flex-1" onClick={() => setShowAddModal(false)}>Cancel</Button>
                <Button className="flex-1" onClick={() => { setShowAddModal(false); showToast("Client added!"); }}>Add Client</Button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
