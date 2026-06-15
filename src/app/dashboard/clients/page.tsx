"use client";
import { useState, useMemo, useEffect, useCallback } from "react";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/lib/supabase";
import { cn, formatCurrency, getTagColor, prettyDate } from "@/lib/utils";
import { formatPhone } from "@/lib/validation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Textarea } from "@/components/ui/input";
import type { Client, Appointment } from "@/lib/database.types";

function Toast({ message, onClose }: { message: string; onClose: () => void }) {
  return (
    <div className="fixed bottom-6 right-6 z-[100] bg-[#141414] border border-[#1e1e1e] rounded-xl px-5 py-3 text-sm text-white shadow-xl flex items-center gap-3">
      <span className="text-white">✓</span>{message}
      <button onClick={onClose} className="text-[#777] hover:text-white ml-2">✕</button>
    </div>
  );
}

type AppointmentRow = Pick<Appointment, "id" | "date" | "time_slot" | "total_amount" | "status"> & {
  barbers?: { name: string } | null;
  services?: { name: string } | null;
};

type NewClient = { name: string; phone: string; email: string; notes: string; birthday: string };
const BLANK_CLIENT: NewClient = { name: "", phone: "", email: "", notes: "", birthday: "" };

interface HairProfile {
  topGuard: string;
  sidesGuard: string;
  fadeType: string;
  beardStyle: string;
  styleNotes: string;
  productsUsed: string;
  barberNotes: string;
}
const BLANK_HAIR: HairProfile = { topGuard: "", sidesGuard: "", fadeType: "", beardStyle: "", styleNotes: "", productsUsed: "", barberNotes: "" };

export default function ClientsPage() {
  const { shop } = useAuth();
  const [tagFilter, setTagFilter] = useState("All");
  const [search, setSearch] = useState("");
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [clientAppointments, setClientAppointments] = useState<AppointmentRow[]>([]);
  const [notes, setNotes] = useState("");
  const [toast, setToast] = useState("");
  const [showAddModal, setShowAddModal] = useState(false);
  const [addPointsClient, setAddPointsClient] = useState<Client | null>(null);
  const [pointsToAdd, setPointsToAdd] = useState("10");
  const [saving, setSaving] = useState(false);
  const [newClient, setNewClient] = useState<NewClient>(BLANK_CLIENT);
  const [noShowCounts, setNoShowCounts] = useState<Record<string, number>>({});
  const [activeTab, setActiveTab] = useState<"overview" | "hair" | "history">("overview");
  const [hairProfile, setHairProfile] = useState<HairProfile>(BLANK_HAIR);
  const [savingHair, setSavingHair] = useState(false);
  const [birthday, setBirthday] = useState("");
  const [savingBirthday, setSavingBirthday] = useState(false);
  const [sendingBirthday, setSendingBirthday] = useState(false);

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(""), 3000); };

  // Builds the client list from BOTH the `clients` table (people the owner
  // manually added or whose stats have been touched by a completed appt)
  // AND distinct customers harvested from `appointments` (the booking flow
  // doesn't write to `clients`, so a shop with only bookings would have an
  // empty `clients` table). Dedupe by email > phone > name (same pattern
  // as the messages picker). Synthetic rows get a `synthetic:` id prefix
  // so write ops (notes, points, etc.) can detect and skip them.
  const loadClients = useCallback(async () => {
    if (!shop) { setLoading(false); return; }
    setLoading(true);
    const [{ data: clientRows }, { data: apptRows }, { data: nsData }] = await Promise.all([
      supabase.from("clients").select("*").eq("shop_id", shop.id).order("total_visits", { ascending: false }),
      supabase
        .from("appointments")
        .select("client_name, client_email, client_phone, date, status, total_amount")
        .eq("shop_id", shop.id)
        .order("date", { ascending: false }),
      supabase.from("appointments").select("client_name").eq("shop_id", shop.id).eq("status", "no-show"),
    ]);

    const keyOf = (c: { id?: string; email?: string | null; phone?: string | null; name?: string | null }) =>
      (c.email && `e:${c.email.toLowerCase()}`)
      || (c.phone && `p:${c.phone.replace(/\D/g, "")}`)
      || (c.name && `n:${c.name.toLowerCase()}`)
      || (c.id ?? "");

    const merged = new Map<string, Client>();
    for (const row of (clientRows ?? []) as Client[]) merged.set(keyOf(row), row);

    // Aggregate per-customer stats from appointments for synthetic rows
    const apptAgg: Record<string, { visits: number; spent: number; last: string; tag: string }> = {};
    for (const a of (apptRows ?? [])) {
      if (!a.client_name) continue;
      const k = keyOf({ name: a.client_name, email: a.client_email, phone: a.client_phone });
      if (merged.has(k)) continue;
      const agg = apptAgg[k] ?? { visits: 0, spent: 0, last: "", tag: "New" };
      if (a.status === "completed") {
        agg.visits++;
        agg.spent += a.total_amount ?? 0;
      }
      if (a.date > agg.last) agg.last = a.date;
      apptAgg[k] = agg;
    }
    for (const a of (apptRows ?? []) as { client_name: string; client_email?: string | null; client_phone?: string | null }[]) {
      if (!a.client_name) continue;
      const k = keyOf({ name: a.client_name, email: a.client_email, phone: a.client_phone });
      if (merged.has(k)) continue;
      const agg = apptAgg[k] ?? { visits: 0, spent: 0, last: "", tag: "New" };
      merged.set(k, {
        id: `synthetic:${k}`,
        shop_id: shop.id,
        name: a.client_name,
        email: a.client_email ?? undefined,
        phone: a.client_phone ?? undefined,
        total_visits: agg.visits,
        total_spent: agg.spent,
        last_visit: agg.last || undefined,
        tag: agg.visits >= 3 ? "Returning" : "New",
      } as unknown as Client);
    }

    const list = Array.from(merged.values()).sort(
      (a, b) => (b.total_visits ?? 0) - (a.total_visits ?? 0)
    );
    setClients(list);

    if (nsData) {
      const counts: Record<string, number> = {};
      for (const r of nsData) counts[r.client_name] = (counts[r.client_name] ?? 0) + 1;
      setNoShowCounts(counts);
    }
    setLoading(false);
  }, [shop]);

  useEffect(() => { loadClients(); }, [loadClients]);

  // Keyboard: Escape closes panel
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") setSelectedClient(null); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const openClient = async (client: Client) => {
    setSelectedClient(client);
    setNotes(client.notes ?? "");
    setActiveTab("overview");
    const hp = (client as Client & { hair_profile?: HairProfile }).hair_profile;
    setHairProfile(hp ?? BLANK_HAIR);
    setBirthday(client.birthday ?? "");
    const { data } = await supabase
      .from("appointments")
      .select("id, date, time_slot, total_amount, status, barbers(name), services(name)")
      .eq("shop_id", shop!.id)
      .eq("client_name", client.name)
      .order("date", { ascending: false })
      .limit(10);
    setClientAppointments((data as unknown as AppointmentRow[]) ?? []);
  };

  const saveNotes = async () => {
    if (!selectedClient) return;
    setSaving(true);
    const { error } = await supabase.from("clients").update({ notes }).eq("id", selectedClient.id);
    if (!error) {
      setClients(prev => prev.map(c => c.id === selectedClient.id ? { ...c, notes } : c));
      showToast("Notes saved!");
    } else showToast("Error saving notes");
    setSaving(false);
  };

  const saveHairProfile = async () => {
    if (!selectedClient) return;
    setSavingHair(true);
    const { error } = await supabase.from("clients").update({ hair_profile: hairProfile }).eq("id", selectedClient.id);
    setSavingHair(false);
    showToast(error ? "Error saving hair profile" : "Hair profile saved!");
  };

  const saveBirthday = async () => {
    if (!selectedClient) return;
    setSavingBirthday(true);
    await supabase.from("clients").update({ birthday }).eq("id", selectedClient.id);
    setClients(prev => prev.map(c => c.id === selectedClient.id ? { ...c, birthday } : c));
    setSavingBirthday(false);
    showToast("Birthday saved!");
  };

  const sendBirthdayEmail = async () => {
    if (!selectedClient?.email || !shop) { showToast("No email on file for this client"); return; }
    setSendingBirthday(true);
    const res = await fetch("/api/send-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "birthday_wish",
        data: {
          clientName: selectedClient.name,
          clientEmail: selectedClient.email,
          shopName: shop.name,
          shopEmail: shop.email ?? "",
          shopSlug: shop.slug,
        },
      }),
    });
    setSendingBirthday(false);
    showToast(res.ok ? "Birthday email sent! 🎂" : "Failed to send email");
  };

  const addPoints = async () => {
    if (!addPointsClient) return;
    const pts = Number(pointsToAdd);
    const newTotal = addPointsClient.loyalty_points + pts;
    const { error } = await supabase.from("clients").update({ loyalty_points: newTotal }).eq("id", addPointsClient.id);
    if (!error) {
      setClients(prev => prev.map(c => c.id === addPointsClient.id ? { ...c, loyalty_points: newTotal } : c));
      if (selectedClient?.id === addPointsClient.id) setSelectedClient(c => c ? { ...c, loyalty_points: newTotal } : c);
      showToast(`${pts} points added!`);
    }
    setAddPointsClient(null);
  };

  const addClient = async () => {
    if (!shop || !newClient.name.trim()) return;
    setSaving(true);
    const { error } = await supabase.from("clients").insert({
      shop_id: shop.id,
      name: newClient.name.trim(),
      phone: newClient.phone,
      email: newClient.email,
      notes: newClient.notes,
      birthday: newClient.birthday || null,
      total_visits: 0,
      total_spent: 0,
      loyalty_points: 0,
      tag: "New",
    });
    if (!error) { showToast("Client added!"); loadClients(); setShowAddModal(false); setNewClient(BLANK_CLIENT); }
    else showToast("Error: " + error.message);
    setSaving(false);
  };

  const stats = {
    total: clients.length,
    vip: clients.filter(c => c.tag === "VIP").length,
    atRisk: clients.filter(c => c.tag === "At Risk").length,
    newThisMonth: clients.filter(c => c.tag === "New").length,
  };

  const filtered = useMemo(() => {
    let list = [...clients];
    if (tagFilter !== "All") list = list.filter(c => c.tag === tagFilter);
    if (search) list = list.filter(c =>
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      (c.phone ?? "").includes(search)
    );
    return list;
  }, [clients, tagFilter, search]);

  if (!shop) {
    return (
      <div className="p-8 flex flex-col items-center justify-center min-h-[60vh] text-center">
        <p className="text-2xl mb-2">👥</p>
        <h2 className="text-lg font-bold text-white mb-1">No shop linked</h2>
        <p className="text-sm text-[#777]">Client profiles will appear here once your shop is active.</p>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {toast && <Toast message={toast} onClose={() => setToast("")} />}

      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">Clients</h1>
          <p className="text-sm text-[#777] mt-0.5">Manage your client base</p>
        </div>
        <div className="flex gap-3">
          {stats.atRisk > 0 && (
            <Button variant="outline" size="sm" onClick={async () => {
              if (!shop) return;
              const atRiskWithEmail = clients.filter(c => c.tag === "At Risk" && c.email);
              if (atRiskWithEmail.length === 0) { showToast("No at-risk clients have email addresses on file"); return; }
              let sent = 0;
              for (const c of atRiskWithEmail) {
                const res = await fetch("/api/send-email", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    type: "rebooking_reminder",
                    data: {
                      clientName: c.name,
                      clientEmail: c.email,
                      shopName: shop.name,
                      shopEmail: shop.email ?? "",
                      bookingUrl: `${window.location.origin}/book/${shop.slug}`,
                    },
                  }),
                });
                if (res.ok) sent++;
              }
              showToast(`Re-engagement emails sent to ${sent} at-risk clients`);
            }}>
              Re-engage {stats.atRisk} At-Risk
            </Button>
          )}
          <Button onClick={() => setShowAddModal(true)}>+ Add Client</Button>
        </div>
      </div>

      {/* Stats — v2 reference treatment */}
      {(() => {
        type Tone = "muted" | "up" | "down";
        const tiles: { label: string; value: string; sub: string; tone: Tone }[] = [
          {
            label: "Total Clients",
            value: String(stats.total),
            sub: stats.total > 0 ? `${stats.total} on file` : "No clients yet",
            tone: "muted",
          },
          {
            label: "VIP",
            value: String(stats.vip),
            sub: stats.vip > 0 ? "↑ Top spenders" : "None yet",
            tone: stats.vip > 0 ? "up" : "muted",
          },
          {
            label: "At Risk",
            value: String(stats.atRisk),
            sub: stats.atRisk > 0 ? "Follow up" : "↑ All healthy",
            tone: stats.atRisk > 0 ? "down" : "up",
          },
          {
            label: "New",
            value: String(stats.newThisMonth),
            sub: stats.newThisMonth > 0 ? "↑ Fresh faces" : "None yet",
            tone: stats.newThisMonth > 0 ? "up" : "muted",
          },
        ];
        return (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {tiles.map(s => (
              <div key={s.label} className="bg-[#0c0c0c] border border-[#1e1e1e] rounded-2xl p-4">
                <p className="text-[10px] text-[#777] font-semibold uppercase tracking-wider">{s.label}</p>
                <p className="text-[28px] font-extrabold text-white mt-2 font-mono tracking-tighter leading-none">{s.value}</p>
                <p className={cn(
                  "text-[11px] mt-2 font-medium",
                  s.tone === "up"    && "text-emerald-400",
                  s.tone === "down"  && "text-red-400",
                  s.tone === "muted" && "text-[#777]",
                )}>{s.sub}</p>
              </div>
            ))}
          </div>
        );
      })()}

      {/* Filter & Search */}
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex rounded-xl border border-[#1e1e1e] overflow-hidden">
          {["All","VIP","New","Returning","At Risk"].map(t => (
            <button key={t} onClick={() => setTagFilter(t)}
              className={cn("px-4 py-2 text-sm font-medium transition-colors", tagFilter === t ? "bg-gold text-black" : "text-[#777] hover:text-white bg-[#141414]")}>
              {t}
            </button>
          ))}
        </div>
        <Input placeholder="Search clients..." value={search} onChange={e => setSearch(e.target.value)} className="w-56" />
        <div className="flex gap-1 ml-auto">
          <button onClick={() => setViewMode("grid")} className={cn("p-2 rounded-lg border", viewMode === "grid" ? "border-black text-white" : "border-[#1e1e1e] text-[#777]")}>⊞</button>
          <button onClick={() => setViewMode("list")} className={cn("p-2 rounded-lg border", viewMode === "list" ? "border-black text-white" : "border-[#1e1e1e] text-[#777]")}>☰</button>
        </div>
      </div>

      {loading ? (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="bg-black shadow-sm border border-[#1e1e1e] rounded-2xl p-5 space-y-3 animate-pulse">
              <div className="flex items-start justify-between">
                <div className="w-10 h-10 rounded-full bg-[#141414]" />
                <div className="h-5 w-16 rounded-full bg-[#141414]" />
              </div>
              <div className="space-y-1.5">
                <div className="h-4 w-32 bg-[#141414] rounded" />
                <div className="h-3 w-24 bg-[#141414] rounded" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                {[1,2,3,4].map(j => <div key={j} className="h-10 bg-[#141414] rounded-xl" />)}
              </div>
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-4xl mb-3">👥</p>
          <p className="text-white font-medium mb-1">{clients.length === 0 ? "Your client list is empty" : "No clients match your filters"}</p>
          <p className="text-sm text-[#777]">{clients.length === 0 ? "Clients are added automatically when they book, or you can add them manually above." : "Try a different search or filter."}</p>
        </div>
      ) : viewMode === "grid" ? (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map(client => (
            <Card key={client.id} className="hover:border-black transition-all cursor-pointer card-hover" onClick={() => openClient(client)}>
              <div className="flex items-start justify-between mb-3">
                <div className="w-10 h-10 rounded-full bg-black/10 flex items-center justify-center text-white font-bold text-sm">
                  {client.name.split(" ").map(n => n[0]).join("").slice(0, 2)}
                </div>
                <div className="flex items-center gap-1.5">
                  {noShowCounts[client.name] > 0 && (
                    <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium bg-red-500/15 border border-red-500/30 text-red-400">
                      ⚠ {noShowCounts[client.name]} no-show{noShowCounts[client.name] > 1 ? "s" : ""}
                    </span>
                  )}
                  <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium border", getTagColor(client.tag))}>
                    {client.tag}
                  </span>
                </div>
              </div>
              <h3 className="text-white font-semibold">{client.name}</h3>
              <p className="text-sm text-[#777]">{client.phone}</p>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <div><p className="text-xs text-[#777]">Visits</p><p className="text-sm font-semibold text-white">{client.total_visits}</p></div>
                <div><p className="text-xs text-[#777]">Spent</p><p className="text-sm font-semibold text-white">{formatCurrency(client.total_spent)}</p></div>
                <div><p className="text-xs text-[#777]">Points</p><p className="text-sm font-semibold text-white">{client.loyalty_points}</p></div>
                <div><p className="text-xs text-[#777]">Last Visit</p><p className="text-sm font-semibold text-white">{client.last_visit ?? "—"}</p></div>
              </div>
              <Button variant="outline" size="sm" className="w-full mt-3">View Profile</Button>
            </Card>
          ))}
        </div>
      ) : (
        <Card className="p-0 overflow-hidden">
          <table className="w-full">
            <thead className="border-b border-[#1e1e1e]">
              <tr>
                {["Client","Phone","Tag","Visits","Spent","Points","Last Visit"].map(h => (
                  <th key={h} className="text-left text-xs font-medium text-[#777] px-4 py-3">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(client => (
                <tr key={client.id} onClick={() => openClient(client)}
                  className="border-b border-[#1e1e1e]/50 hover:bg-[#141414]/50 cursor-pointer">
                  <td className="px-4 py-3 text-sm font-medium text-white">{client.name}</td>
                  <td className="px-4 py-3 text-sm text-[#777]">{client.phone}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium border", getTagColor(client.tag))}>{client.tag}</span>
                      {noShowCounts[client.name] > 0 && (
                        <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium bg-red-500/15 border border-red-500/30 text-red-400">
                          ⚠ {noShowCounts[client.name]}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm text-white">{client.total_visits}</td>
                  <td className="px-4 py-3 text-sm text-white">{formatCurrency(client.total_spent)}</td>
                  <td className="px-4 py-3 text-sm text-white">{client.loyalty_points}</td>
                  <td className="px-4 py-3 text-sm text-[#777]">{client.last_visit ?? "—"}</td>
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
          <div className="fixed right-0 top-0 h-full w-full max-w-md bg-black shadow-sm border-l border-[#1e1e1e] z-50 overflow-y-auto p-6 space-y-5">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-white">Client Profile</h2>
              <button onClick={() => setSelectedClient(null)} className="text-[#777] hover:text-white text-xl">✕</button>
            </div>
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 rounded-full bg-black/10 flex items-center justify-center text-white font-bold text-lg">
                {selectedClient.name.split(" ").map(n => n[0]).join("").slice(0, 2)}
              </div>
              <div>
                <h3 className="text-white font-bold text-lg">{selectedClient.name}</h3>
                <div className="flex items-center gap-2 mt-1">
                  <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium border", getTagColor(selectedClient.tag))}>
                    {selectedClient.tag}
                  </span>
                  {noShowCounts[selectedClient.name] > 0 && (
                    <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium bg-red-500/15 border border-red-500/30 text-red-400">
                      ⚠ {noShowCounts[selectedClient.name]} no-show{noShowCounts[selectedClient.name] > 1 ? "s" : ""}
                    </span>
                  )}
                </div>
              </div>
            </div>
            {/* Tabs */}
            <div className="flex gap-1 bg-[#141414] border border-[#1e1e1e] rounded-xl p-1">
              {(["overview", "hair", "history"] as const).map(tab => (
                <button key={tab} onClick={() => setActiveTab(tab)}
                  className={cn("flex-1 py-1.5 text-xs font-medium rounded-lg transition-all capitalize",
                    activeTab === tab ? "bg-black/10 text-white border border-[#1e1e1e]" : "text-[#777] hover:text-white")}>
                  {tab === "hair" ? "✂️ Hair Profile" : tab === "history" ? "History" : "Overview"}
                </button>
              ))}
            </div>

            {/* Overview tab */}
            {activeTab === "overview" && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { label: "Phone", value: selectedClient.phone ?? "—" },
                    { label: "Email", value: selectedClient.email ?? "—" },
                    { label: "Total Visits", value: String(selectedClient.total_visits) },
                    { label: "Total Spent", value: formatCurrency(selectedClient.total_spent) },
                    { label: "Loyalty Points", value: String(selectedClient.loyalty_points) },
                    { label: "Last Visit", value: selectedClient.last_visit ?? "—" },
                  ].map(item => (
                    <div key={item.label} className="p-3 bg-[#141414] rounded-xl border border-[#1e1e1e]">
                      <p className="text-xs text-[#777]">{item.label}</p>
                      <p className="text-sm text-white mt-0.5 break-all">{item.value}</p>
                    </div>
                  ))}
                </div>
                {/* Birthday */}
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-[#777]">Birthday</label>
                  <div className="flex gap-2">
                    <input type="date" value={birthday} onChange={e => setBirthday(e.target.value)}
                      className="flex-1 bg-[#141414] border border-[#1e1e1e] rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-black/20" />
                    <Button size="sm" variant="outline" loading={savingBirthday} onClick={saveBirthday}>Save</Button>
                  </div>
                  {selectedClient.email && birthday && (
                    <Button size="sm" variant="outline" className="w-full text-white border-black hover:bg-black/5" loading={sendingBirthday} onClick={sendBirthdayEmail}>
                      🎂 Send Birthday Email
                    </Button>
                  )}
                </div>

                <Textarea label="Notes" value={notes} onChange={e => setNotes(e.target.value)} rows={3} placeholder="Add client notes..." />
                <div className="flex gap-2">
                  <Button className="flex-1" size="sm" loading={saving} onClick={saveNotes}>Save Notes</Button>
                  <Button variant="outline" size="sm" className="flex-1" onClick={async () => {
                    if (!selectedClient.email || !shop) { showToast("No email on file for this client"); return; }
                    const res = await fetch("/api/send-email", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        type: "rebooking_reminder",
                        data: {
                          clientName: selectedClient.name,
                          clientEmail: selectedClient.email,
                          shopName: shop.name,
                          shopEmail: shop.email ?? "",
                          bookingUrl: `${window.location.origin}/book/${shop.slug}`,
                        },
                      }),
                    });
                    showToast(res.ok ? "Re-engagement email sent!" : "Failed to send email");
                  }}>
                    {selectedClient.email ? "Send Re-engagement" : "No Email on File"}
                  </Button>
                </div>
                <div className="p-4 bg-[#141414] rounded-xl border border-[#1e1e1e]">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-sm font-medium text-white">Loyalty Points</p>
                    <p className="text-xl font-bold text-white">{selectedClient.loyalty_points} pts</p>
                  </div>
                  <div className="w-full h-2 bg-black shadow-sm rounded-full overflow-hidden mb-3">
                    <div className="h-full bg-gold rounded-full" style={{ width: `${Math.min(100, (selectedClient.loyalty_points / 500) * 100)}%` }} />
                  </div>
                  <Button variant="outline" size="sm" className="w-full" onClick={() => setAddPointsClient(selectedClient)}>+ Add Points</Button>
                </div>
              </>
            )}

            {/* Hair Profile tab */}
            {activeTab === "hair" && (
              <div className="space-y-4">
                <p className="text-xs text-[#777]">Saved per client — visible to all barbers at your shop.</p>

                <div className="grid grid-cols-2 gap-3">
                  {[
                    { key: "topGuard" as keyof HairProfile, label: "Top — Guard #", placeholder: "e.g. 4" },
                    { key: "sidesGuard" as keyof HairProfile, label: "Sides — Guard #", placeholder: "e.g. 1.5" },
                  ].map(({ key, label, placeholder }) => (
                    <div key={key} className="space-y-1.5">
                      <label className="text-xs font-medium text-[#777]">{label}</label>
                      <input
                        value={hairProfile[key]}
                        onChange={e => setHairProfile(p => ({ ...p, [key]: e.target.value }))}
                        placeholder={placeholder}
                        className="w-full bg-[#141414] border border-[#1e1e1e] rounded-xl px-3 py-2 text-sm text-white placeholder:text-[#777] focus:outline-none focus:ring-1 focus:ring-black/20"
                      />
                    </div>
                  ))}
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-[#777]">Fade Type</label>
                    <select
                      value={hairProfile.fadeType}
                      onChange={e => setHairProfile(p => ({ ...p, fadeType: e.target.value }))}
                      className="w-full bg-[#141414] border border-[#1e1e1e] rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-black/20"
                    >
                      <option value="">— select —</option>
                      {["None", "Low Fade", "Mid Fade", "High Fade", "Skin Fade", "Taper"].map(o => <option key={o} value={o}>{o}</option>)}
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-[#777]">Beard</label>
                    <select
                      value={hairProfile.beardStyle}
                      onChange={e => setHairProfile(p => ({ ...p, beardStyle: e.target.value }))}
                      className="w-full bg-[#141414] border border-[#1e1e1e] rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:ring-1 focus:ring-black/20"
                    >
                      <option value="">— select —</option>
                      {["None", "Shape Up", "Light Trim", "Full Trim", "Full Beard", "Shave"].map(o => <option key={o} value={o}>{o}</option>)}
                    </select>
                  </div>
                </div>

                {[
                  { key: "styleNotes" as keyof HairProfile, label: "Style Notes", placeholder: "e.g. Deep part on left side, leave length on top, textured finish…" },
                  { key: "productsUsed" as keyof HairProfile, label: "Products Used", placeholder: "e.g. Matte pomade, edge control…" },
                  { key: "barberNotes" as keyof HairProfile, label: "Barber Notes (internal)", placeholder: "e.g. Comes in every 3 weeks, sensitive around ears…" },
                ].map(({ key, label, placeholder }) => (
                  <div key={key} className="space-y-1.5">
                    <label className="text-xs font-medium text-[#777]">{label}</label>
                    <textarea
                      value={hairProfile[key]}
                      onChange={e => setHairProfile(p => ({ ...p, [key]: e.target.value }))}
                      placeholder={placeholder}
                      rows={2}
                      className="w-full bg-[#141414] border border-[#1e1e1e] rounded-xl px-3 py-2 text-sm text-white placeholder:text-[#777] focus:outline-none focus:ring-1 focus:ring-black/20 resize-none"
                    />
                  </div>
                ))}

                <Button className="w-full" loading={savingHair} onClick={saveHairProfile}>Save Hair Profile</Button>
              </div>
            )}

            {/* History tab */}
            {activeTab === "history" && (
              <div>
                {clientAppointments.length === 0 ? (
                  <p className="text-sm text-[#777] text-center py-8">No appointments found</p>
                ) : (
                  <div className="space-y-2">
                    {clientAppointments.map(apt => (
                      <div key={apt.id} className="flex items-center justify-between p-3 bg-[#141414] rounded-xl border border-[#1e1e1e]">
                        <div>
                          <p className="text-sm text-white">{apt.services?.name ?? "—"} · {apt.barbers?.name ?? "—"}</p>
                          <p className="text-xs text-[#777]">{prettyDate(apt.date)} {apt.time_slot}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-semibold text-white">{formatCurrency(apt.total_amount)}</p>
                          <span className={cn("text-xs", apt.status === "no-show" ? "text-red-400" : apt.status === "completed" ? "text-blue-400" : "text-[#777]")}>
                            {apt.status}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </>
      )}

      {/* Add Points Modal */}
      {addPointsClient && (
        <>
          <div className="fixed inset-0 bg-black/70 z-[60]" onClick={() => setAddPointsClient(null)} />
          <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
            <div className="bg-black shadow-sm border border-[#1e1e1e] rounded-2xl p-6 w-full max-w-xs space-y-4">
              <h3 className="text-white font-bold">Add Points for {addPointsClient.name}</h3>
              <Input label="Points to add" type="number" value={pointsToAdd} onChange={e => setPointsToAdd(e.target.value)} />
              <div className="flex gap-2">
                <Button variant="outline" size="sm" className="flex-1" onClick={() => setAddPointsClient(null)}>Cancel</Button>
                <Button size="sm" className="flex-1" onClick={addPoints}>Add Points</Button>
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
            <div className="bg-black shadow-sm border border-[#1e1e1e] rounded-2xl p-6 w-full max-w-md space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold text-white">Add New Client</h2>
                <button onClick={() => setShowAddModal(false)} className="text-[#777] hover:text-white">✕</button>
              </div>
              <Input label="Full Name" placeholder="John Doe" value={newClient.name} onChange={e => setNewClient(p => ({ ...p, name: e.target.value }))} />
              <Input label="Phone" placeholder="506-555-0000" value={newClient.phone} onChange={e => setNewClient(p => ({ ...p, phone: formatPhone(e.target.value) }))} />
              <Input label="Email" placeholder="john@email.com" value={newClient.email} onChange={e => setNewClient(p => ({ ...p, email: e.target.value }))} />
              <Textarea label="Notes" placeholder="Any notes about this client..." rows={2} value={newClient.notes} onChange={e => setNewClient(p => ({ ...p, notes: e.target.value }))} />
              <div className="space-y-1.5">
                <label className="text-sm text-[#777]">Birthday (optional)</label>
                <input type="date" value={newClient.birthday} onChange={e => setNewClient(p => ({ ...p, birthday: e.target.value }))}
                  className="w-full bg-[#141414] border border-[#1e1e1e] rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-black" />
              </div>
              <div className="flex gap-3 pt-2">
                <Button variant="outline" className="flex-1" onClick={() => setShowAddModal(false)}>Cancel</Button>
                <Button className="flex-1" loading={saving} onClick={addClient}>Add Client</Button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
