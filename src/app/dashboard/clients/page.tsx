"use client";
import { useState, useMemo, useEffect, useCallback } from "react";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/lib/supabase";
import { cn, formatCurrency, getTagColor, prettyDate } from "@/lib/utils";
import { formatPhone } from "@/lib/validation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Textarea } from "@/components/ui/input";
import { Phone } from "lucide-react";
import { groupClients, sameIdentity, clientToId, apptToId } from "@/lib/client-identity";
import type { Client, Appointment } from "@/lib/database.types";
import { DashboardHeader } from "@/components/dashboard/page-header";

function Toast({ message, onClose }: { message: string; onClose: () => void }) {
  return (
    <div className="fixed bottom-6 right-6 z-[100] bg-card-raised border border-border rounded-xl px-5 py-3 text-sm text-foreground shadow-xl flex items-center gap-3">
      <span className="text-foreground">✓</span>{message}
      <button onClick={onClose} className="text-grey hover:text-foreground ml-2">✕</button>
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
  const { shop, accessToken } = useAuth();
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
  // Inline add/edit of the profile's phone/email tiles.
  const [editField, setEditField] = useState<null | "phone" | "email">(null);
  const [fieldDraft, setFieldDraft] = useState("");
  const [savingField, setSavingField] = useState(false);

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
    const [{ data: clientRows, error: clientErr }, { data: nsData }] = await Promise.all([
      supabase.from("clients").select("*").eq("shop_id", shop.id).order("total_visits", { ascending: false }),
      supabase.from("appointments").select("client_name, client_email, client_phone").eq("shop_id", shop.id).eq("status", "no-show"),
    ]);
    // Appointments incl. the phase-36 client_id link. Fall back without it if the
    // migration hasn't been run yet, so the page never breaks in that window.
    type ApptLite = { client_id?: string | null; client_name?: string | null; client_email?: string | null; client_phone?: string | null; date?: string | null; status?: string | null; total_amount?: number | null };
    let apptRows: ApptLite[] = [];
    let apptErr: unknown = null;
    const withCid = await supabase
      .from("appointments")
      .select("client_id, client_name, client_email, client_phone, date, status, total_amount")
      .eq("shop_id", shop.id).order("date", { ascending: false });
    if (withCid.error) {
      const noCid = await supabase
        .from("appointments")
        .select("client_name, client_email, client_phone, date, status, total_amount")
        .eq("shop_id", shop.id).order("date", { ascending: false });
      apptRows = (noCid.data as unknown as ApptLite[]) ?? [];
      apptErr = noCid.error;
    } else {
      apptRows = (withCid.data as unknown as ApptLite[]) ?? [];
    }

    if (clientErr || apptErr) showToast("Couldn't load clients — please refresh.");

    // De-dupe + attribute activity by IDENTITY (shared email/phone), not name —
    // so two people named "ABC" stay separate, and the same person with a typo'd
    // name or reformatted number stays as one. See lib/client-identity.ts.
    const list = groupClients({
      shopId: shop.id,
      clientRows: (clientRows ?? []) as Client[],
      apptRows: (apptRows ?? []),
    });
    setClients(list);

    if (nsData) {
      // Attribute each no-show to the right person by IDENTITY, keyed on the
      // grouped client's id — so a same-name stranger isn't blamed for it.
      const counts: Record<string, number> = {};
      for (const r of nsData as { client_name?: string | null; client_email?: string | null; client_phone?: string | null }[]) {
        const match = list.find(c => sameIdentity(c, { email: r.client_email, phone: r.client_phone, name: r.client_name }));
        if (match) counts[match.id] = (counts[match.id] ?? 0) + 1;
      }
      setNoShowCounts(counts);
    }
    setLoading(false);
  }, [shop]);

  useEffect(() => { loadClients(); }, [loadClients]);

  // Real-time: refresh when appointments (new booking / completion → visits &
  // spend) or clients (points/notes edits from another device or barber) change.
  useEffect(() => {
    if (!shop) return;
    const ch = supabase
      .channel(`clients-live:${shop.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "appointments", filter: `shop_id=eq.${shop.id}` }, () => loadClients())
      .on("postgres_changes", { event: "*", schema: "public", table: "clients", filter: `shop_id=eq.${shop.id}` }, () => loadClients())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [shop, loadClients]);

  // Keyboard: Escape closes panel
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") setSelectedClient(null); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // Synthetic clients (harvested from appointments, id "synthetic:…") have no row
  // in the `clients` table, so writes by id silently hit nothing. Materialize into
  // a real row (deduped by email → phone) before any write, and return the real id.
  const ensureRealClient = async (client: Client): Promise<string | null> => {
    if (!client.id.startsWith("synthetic:")) return client.id;
    if (!shop) return null;
    try {
      const res = await fetch("/api/clients/upsert", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) },
        body: JSON.stringify({ shop_id: shop.id, name: client.name, email: client.email ?? "", phone: client.phone ?? "" }),
      });
      const j = await res.json().catch(() => null);
      return j?.ok ? (j.id as string) : null;
    } catch { return null; }
  };

  const openClient = async (client: Client) => {
    setSelectedClient(client);
    setNotes(client.notes ?? "");
    setActiveTab("overview");
    setEditField(null);
    const hp = (client as Client & { hair_profile?: HairProfile }).hair_profile;
    setHairProfile(hp ?? BLANK_HAIR);
    setBirthday(client.birthday ?? "");
    // Pull this person's appointments by ALL of their identifiers (name, email,
    // phone), then keep only the ones that truly share their identity — so the
    // history matches the visit count exactly (and a same-name stranger's
    // appointments never leak in). See lib/client-identity.ts.
    const FIELDS = "id, date, time_slot, total_amount, status, client_email, client_phone, client_name, barbers(name), services(name)";
    const sid = shop!.id;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const queries: any[] = [
      supabase.from("appointments").select(FIELDS).eq("shop_id", sid).ilike("client_name", client.name.trim()).order("date", { ascending: false }).limit(100),
    ];
    if (client.email?.trim())
      queries.push(supabase.from("appointments").select(FIELDS).eq("shop_id", sid).ilike("client_email", client.email.trim()).order("date", { ascending: false }).limit(100));
    if (client.phone?.trim())
      queries.push(supabase.from("appointments").select(FIELDS).eq("shop_id", sid).eq("client_phone", client.phone.trim()).order("date", { ascending: false }).limit(100));
    // Also pull anything hard-linked by the phase-36 client_id (catches a person
    // who later changed BOTH their email and phone). Best-effort — this query
    // just returns nothing if the migration isn't run yet.
    if (!client.id.startsWith("synthetic:"))
      queries.push(supabase.from("appointments").select(`${FIELDS}, client_id`).eq("shop_id", sid).eq("client_id", client.id).order("date", { ascending: false }).limit(100));
    const results = await Promise.all(queries);
    type Row = AppointmentRow & { client_id?: string | null; client_email?: string | null; client_phone?: string | null; client_name?: string | null };
    const seen = new Set<string>();
    const merged: Row[] = [];
    for (const { data } of results) {
      for (const a of ((data as unknown as Row[]) ?? [])) {
        if (!seen.has(a.id)) { seen.add(a.id); merged.push(a); }
      }
    }
    const me = clientToId(client);
    const rows = merged
      .filter(a => sameIdentity(me, apptToId(a)))
      .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""))
      .slice(0, 50);
    setClientAppointments(rows as unknown as AppointmentRow[]);
  };

  const saveNotes = async () => {
    if (!selectedClient) return;
    setSaving(true);
    const realId = await ensureRealClient(selectedClient);
    if (!realId) { setSaving(false); showToast("Couldn't save notes — please try again."); return; }
    const prevId = selectedClient.id;
    const { error } = await supabase.from("clients").update({ notes }).eq("id", realId);
    setSaving(false);
    if (error) { showToast("Error saving notes"); return; }
    setSelectedClient(c => c ? { ...c, id: realId, notes } : c);
    setClients(prev => prev.map(c => c.id === prevId ? { ...c, id: realId, notes } : c));
    showToast("Notes saved!");
  };

  const saveHairProfile = async () => {
    if (!selectedClient) return;
    setSavingHair(true);
    const realId = await ensureRealClient(selectedClient);
    if (!realId) { setSavingHair(false); showToast("Couldn't save hair profile — please try again."); return; }
    const { error } = await supabase.from("clients").update({ hair_profile: hairProfile }).eq("id", realId);
    setSavingHair(false);
    if (error) { showToast("Error saving hair profile"); return; }
    setSelectedClient(c => c ? { ...c, id: realId } : c);
    showToast("Hair profile saved!");
  };

  const saveBirthday = async () => {
    if (!selectedClient) return;
    setSavingBirthday(true);
    const realId = await ensureRealClient(selectedClient);
    if (!realId) { setSavingBirthday(false); showToast("Couldn't save birthday — please try again."); return; }
    const prevId = selectedClient.id;
    const { error } = await supabase.from("clients").update({ birthday }).eq("id", realId);
    setSavingBirthday(false);
    if (error) { showToast("Couldn't save birthday — please try again."); return; }
    setSelectedClient(c => c ? { ...c, id: realId, birthday } : c);
    setClients(prev => prev.map(c => c.id === prevId ? { ...c, id: realId, birthday } : c));
    showToast("Birthday saved!");
  };

  const startEditField = (field: "phone" | "email") => {
    setFieldDraft((field === "phone" ? selectedClient?.phone : selectedClient?.email) ?? "");
    setEditField(field);
  };

  const saveContactField = async () => {
    if (!selectedClient || !editField) return;
    const field = editField;
    const val = field === "phone" ? formatPhone(fieldDraft.trim()) : fieldDraft.trim();
    setSavingField(true);
    const realId = await ensureRealClient(selectedClient);
    if (!realId) { setSavingField(false); showToast("Couldn't save — please try again."); return; }
    const prevId = selectedClient.id;
    const patch = field === "phone" ? { phone: val } : { email: val };
    const { error } = await supabase.from("clients").update(patch).eq("id", realId);
    setSavingField(false);
    if (error) { showToast("Couldn't save — please try again."); return; }
    setSelectedClient(c => c ? { ...c, id: realId, ...patch } : c);
    setClients(prev => prev.map(c => c.id === prevId ? { ...c, id: realId, ...patch } : c));
    setEditField(null);
    showToast(field === "phone" ? "Phone saved!" : "Email saved!");
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
    if (!addPointsClient || !shop) return;
    const pts = Math.round(Number(pointsToAdd));
    if (!Number.isFinite(pts) || pts === 0) { showToast("Enter a valid number of points"); return; }
    setSaving(true);
    // Materialize synthetic clients so the points actually persist to a real row.
    const realId = await ensureRealClient(addPointsClient);
    if (!realId) { setSaving(false); showToast("Couldn't add points — please try again."); return; }
    // Read the current balance from the DB (not stale local state / NaN) then add.
    const { data: row } = await supabase.from("clients").select("loyalty_points").eq("id", realId).maybeSingle();
    const current = Number(row?.loyalty_points ?? 0);
    const newTotal = Math.max(0, current + pts);
    const { error } = await supabase.from("clients").update({ loyalty_points: newTotal }).eq("id", realId);
    setSaving(false);
    if (error) { showToast("Couldn't add points — please try again."); return; }
    if (selectedClient?.id === addPointsClient.id) setSelectedClient(c => c ? { ...c, id: realId, loyalty_points: newTotal } : c);
    showToast(`${pts > 0 ? "+" : ""}${pts} points · now ${newTotal}`);
    setAddPointsClient(null);
    loadClients();
  };

  const addClient = async () => {
    if (!shop) return;
    // A contact needs a name and a phone (this is a call-first contacts list;
    // phone is how you reach them and the key we dedupe on). Email is optional.
    const name = newClient.name.trim();
    const phone = newClient.phone.trim();
    const email = newClient.email.trim();
    if (!name) { showToast("Name is required"); return; }
    if (!phone) { showToast("A phone number is required"); return; }
    setSaving(true);
    // Don't create a duplicate if this phone/email is already on file.
    let dupe: { id: string } | null = null;
    const { data: byPhone } = await supabase.from("clients").select("id").eq("shop_id", shop.id).eq("phone", phone).maybeSingle();
    dupe = byPhone;
    if (!dupe && email) {
      const { data: byEmail } = await supabase.from("clients").select("id").eq("shop_id", shop.id).ilike("email", email).maybeSingle();
      dupe = byEmail;
    }
    if (dupe) { setSaving(false); showToast("A client with that phone or email already exists"); return; }
    const { error } = await supabase.from("clients").insert({
      shop_id: shop.id,
      name,
      phone,
      email,
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
        <h2 className="text-lg font-bold text-foreground mb-1">No shop linked</h2>
        <p className="text-sm text-grey">Client profiles will appear here once your shop is active.</p>
      </div>
    );
  }

  return (
    <div className="px-6 pb-6 space-y-6">
      {toast && <Toast message={toast} onClose={() => setToast("")} />}

      <DashboardHeader title="Clients" subtitle="Manage your client base"
        action={
          <button onClick={() => setShowAddModal(true)} aria-label="Add client"
            className="w-[38px] h-[38px] rounded-full bg-white text-black flex items-center justify-center text-2xl leading-none hover:opacity-90 transition-opacity flex-shrink-0">
            +
          </button>
        } />

      {stats.atRisk > 0 && (
        <div className="flex justify-end">
          <Button variant="outline" size="sm" onClick={async () => {
            if (!shop) return;
            const atRiskWithEmail = clients.filter(c => c.tag === "At Risk" && c.email);
            if (atRiskWithEmail.length === 0) { showToast("No at-risk clients have email addresses on file"); return; }
            let sent = 0;
            for (const c of atRiskWithEmail) {
              const res = await fetch("/api/send-email", {
                method: "POST",
                headers: { "Content-Type": "application/json", ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) },
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
        </div>
      )}

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

      {/* Filter & Search */}
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex rounded-xl border border-border overflow-x-auto max-w-full [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {["All","VIP","New","Returning","At Risk"].map(t => (
            <button key={t} onClick={() => setTagFilter(t)}
              className={cn("px-4 py-2 text-sm font-medium whitespace-nowrap shrink-0 transition-colors", tagFilter === t ? "bg-gold text-black" : "text-grey hover:text-foreground bg-card-raised")}>
              {t}
            </button>
          ))}
        </div>
        <Input placeholder="Search clients..." value={search} onChange={e => setSearch(e.target.value)} className="w-56" />
        <div className="flex gap-1 ml-auto">
          <button onClick={() => setViewMode("grid")} className={cn("p-2 rounded-lg border", viewMode === "grid" ? "border-black text-foreground" : "border-border text-grey")}>⊞</button>
          <button onClick={() => setViewMode("list")} className={cn("p-2 rounded-lg border", viewMode === "list" ? "border-black text-foreground" : "border-border text-grey")}>☰</button>
        </div>
      </div>

      {loading ? (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="bg-card shadow-sm border border-border rounded-2xl p-5 space-y-3 animate-pulse">
              <div className="flex items-start justify-between">
                <div className="w-10 h-10 rounded-full bg-card-raised" />
                <div className="h-5 w-16 rounded-full bg-card-raised" />
              </div>
              <div className="space-y-1.5">
                <div className="h-4 w-32 bg-card-raised rounded" />
                <div className="h-3 w-24 bg-card-raised rounded" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                {[1,2,3,4].map(j => <div key={j} className="h-10 bg-card-raised rounded-xl" />)}
              </div>
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-4xl mb-3">👥</p>
          <p className="text-foreground font-medium mb-1">{clients.length === 0 ? "Your client list is empty" : "No clients match your filters"}</p>
          <p className="text-sm text-grey">{clients.length === 0 ? "Clients are added automatically when they book, or you can add them manually above." : "Try a different search or filter."}</p>
        </div>
      ) : viewMode === "grid" ? (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map(client => (
            <Card key={client.id} className="hover:border-black transition-all cursor-pointer card-hover" onClick={() => openClient(client)}>
              {/* Contact header — tap-to-call button (left), identity, status */}
              <div className="flex items-center gap-3.5 py-1">
                {client.phone ? (
                  <a
                    href={`tel:${client.phone.replace(/\D/g, "")}`}
                    onClick={e => e.stopPropagation()}
                    aria-label={`Call ${client.name}`}
                    className="w-12 h-12 shrink-0 rounded-full flex items-center justify-center bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20 active:scale-95 transition-all"
                  >
                    <Phone size={20} />
                  </a>
                ) : (
                  <div className="w-12 h-12 shrink-0 rounded-full bg-black/10 flex items-center justify-center text-foreground font-bold text-sm">
                    {client.name.split(" ").map(n => n[0]).join("").slice(0, 2)}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <h3 className="text-foreground font-semibold text-[15px] truncate">{client.name}</h3>
                  {client.phone
                    ? <p className="text-sm text-grey truncate">{formatPhone(client.phone)}</p>
                    : <p className="text-sm text-grey-muted">No phone on file</p>}
                </div>
                <div className="flex flex-col items-end gap-1.5 shrink-0">
                  {noShowCounts[client.id] > 0 && (
                    <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium bg-red-500/15 border border-red-500/30 text-red-400">
                      ⚠ {noShowCounts[client.id]}
                    </span>
                  )}
                  <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium border", getTagColor(client.tag))}>
                    {client.tag}
                  </span>
                </div>
              </div>
              {/* Clean glanceable stats — full history lives in View Profile */}
              <div className="mt-4 flex items-stretch text-center">
                <div className="flex-1">
                  <p className="text-sm font-semibold text-foreground">{client.total_visits}</p>
                  <p className="text-[11px] text-grey mt-0.5">Visits</p>
                </div>
                <div className="w-px bg-border mx-1" />
                <div className="flex-1">
                  <p className="text-sm font-semibold text-foreground">{formatCurrency(client.total_spent)}</p>
                  <p className="text-[11px] text-grey mt-0.5">Spent</p>
                </div>
                <div className="w-px bg-border mx-1" />
                <div className="flex-1">
                  <p className="text-sm font-semibold text-foreground truncate">{client.last_visit ?? "—"}</p>
                  <p className="text-[11px] text-grey mt-0.5">Last visit</p>
                </div>
              </div>
              <Button variant="outline" size="sm" className="w-full mt-4">View Profile</Button>
            </Card>
          ))}
        </div>
      ) : (
        <Card className="p-0 overflow-x-auto">
          <table className="w-full">
            <thead className="border-b border-border">
              <tr>
                {["Client","Phone","Tag","Visits","Spent","Points","Last Visit"].map(h => (
                  <th key={h} className="text-left text-xs font-medium text-grey px-4 py-3">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(client => (
                <tr key={client.id} onClick={() => openClient(client)}
                  className="border-b border-[#2a2a2a]/50 hover:bg-card-raised/50 cursor-pointer">
                  <td className="px-4 py-3 text-sm font-medium text-foreground">{client.name}</td>
                  <td className="px-4 py-3 text-sm text-grey">{client.phone}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium border", getTagColor(client.tag))}>{client.tag}</span>
                      {noShowCounts[client.id] > 0 && (
                        <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium bg-red-500/15 border border-red-500/30 text-red-400">
                          ⚠ {noShowCounts[client.id]}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm text-foreground">{client.total_visits}</td>
                  <td className="px-4 py-3 text-sm text-foreground">{formatCurrency(client.total_spent)}</td>
                  <td className="px-4 py-3 text-sm text-foreground">{client.loyalty_points}</td>
                  <td className="px-4 py-3 text-sm text-grey">{client.last_visit ?? "—"}</td>
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
          <div className="fixed right-0 top-0 h-full w-full max-w-md bg-card shadow-sm border-l border-border z-50 overflow-y-auto overscroll-contain px-6 pt-[calc(env(safe-area-inset-top)+1.5rem)] pb-[calc(env(safe-area-inset-bottom)+6rem)] lg:pb-6 space-y-5">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-foreground">Client Profile</h2>
              <button onClick={() => setSelectedClient(null)} className="text-grey hover:text-foreground text-xl">✕</button>
            </div>
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 rounded-full bg-black/10 flex items-center justify-center text-foreground font-bold text-lg">
                {selectedClient.name.split(" ").map(n => n[0]).join("").slice(0, 2)}
              </div>
              <div>
                <h3 className="text-foreground font-bold text-lg">{selectedClient.name}</h3>
                <div className="flex items-center gap-2 mt-1">
                  <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium border", getTagColor(selectedClient.tag))}>
                    {selectedClient.tag}
                  </span>
                  {noShowCounts[selectedClient.id] > 0 && (
                    <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium bg-red-500/15 border border-red-500/30 text-red-400">
                      ⚠ {noShowCounts[selectedClient.id]} no-show{noShowCounts[selectedClient.id] > 1 ? "s" : ""}
                    </span>
                  )}
                </div>
              </div>
            </div>
            {/* Tabs */}
            <div className="flex gap-1 bg-card-raised border border-border rounded-xl p-1">
              {(["overview", "hair", "history"] as const).map(tab => (
                <button key={tab} onClick={() => setActiveTab(tab)}
                  className={cn("flex-1 py-1.5 text-xs font-medium rounded-lg transition-all capitalize",
                    activeTab === tab ? "bg-black/10 text-foreground border border-border" : "text-grey hover:text-foreground")}>
                  {tab === "hair" ? "✂️ Hair Profile" : tab === "history" ? "History" : "Overview"}
                </button>
              ))}
            </div>

            {/* Overview tab */}
            {activeTab === "overview" && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  {(["phone", "email"] as const).map(field => {
                    const label = field === "phone" ? "Phone" : "Email";
                    const val = field === "phone" ? selectedClient.phone : selectedClient.email;
                    const isEditing = editField === field;
                    return (
                      <div key={field} className="p-3 bg-card-raised rounded-xl border border-border">
                        <p className="text-xs text-grey">{label}</p>
                        {isEditing ? (
                          <div className="mt-1 flex items-center gap-1.5">
                            <input
                              autoFocus
                              type={field === "email" ? "email" : "tel"}
                              value={fieldDraft}
                              onChange={e => setFieldDraft(field === "phone" ? formatPhone(e.target.value) : e.target.value)}
                              onKeyDown={e => { if (e.key === "Enter") saveContactField(); if (e.key === "Escape") setEditField(null); }}
                              placeholder={field === "phone" ? "506-555-0000" : "name@email.com"}
                              className="flex-1 min-w-0 bg-card border border-border rounded-lg px-2 py-1 text-sm text-foreground placeholder:text-grey focus:outline-none focus:ring-1 focus:ring-black/20"
                            />
                            <button onClick={saveContactField} disabled={savingField} aria-label="Save"
                              className="shrink-0 text-sm font-bold text-foreground disabled:opacity-50">✓</button>
                            <button onClick={() => setEditField(null)} aria-label="Cancel"
                              className="shrink-0 text-sm text-grey hover:text-foreground">✕</button>
                          </div>
                        ) : val ? (
                          <button onClick={() => startEditField(field)}
                            className="mt-0.5 block w-full text-left text-sm text-foreground break-all hover:underline underline-offset-2">
                            {val}
                          </button>
                        ) : (
                          <button onClick={() => startEditField(field)}
                            className="mt-0.5 text-sm text-accent-soft hover:text-foreground text-left">
                            + Add {label.toLowerCase()}
                          </button>
                        )}
                      </div>
                    );
                  })}
                  {[
                    { label: "Total Visits", value: String(selectedClient.total_visits) },
                    { label: "Total Spent", value: formatCurrency(selectedClient.total_spent) },
                    { label: "Loyalty Points", value: String(selectedClient.loyalty_points) },
                    { label: "Last Visit", value: selectedClient.last_visit ?? "—" },
                  ].map(item => (
                    <div key={item.label} className="p-3 bg-card-raised rounded-xl border border-border">
                      <p className="text-xs text-grey">{item.label}</p>
                      <p className="text-sm text-foreground mt-0.5 break-all">{item.value}</p>
                    </div>
                  ))}
                </div>
                {/* Birthday */}
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-grey">Birthday</label>
                  <div className="flex gap-2">
                    <input type="date" value={birthday} onChange={e => setBirthday(e.target.value)}
                      className="flex-1 bg-card-raised border border-border rounded-xl px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-black/20" />
                    <Button size="sm" variant="outline" loading={savingBirthday} onClick={saveBirthday}>Save</Button>
                  </div>
                  {selectedClient.email && birthday && (
                    <Button size="sm" variant="outline" className="w-full text-foreground border-black hover:bg-black/5" loading={sendingBirthday} onClick={sendBirthdayEmail}>
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
                      headers: { "Content-Type": "application/json", ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) },
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
                <div className="p-4 bg-card-raised rounded-xl border border-border">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-sm font-medium text-foreground">Loyalty Points</p>
                    <p className="text-xl font-bold text-foreground">{selectedClient.loyalty_points} pts</p>
                  </div>
                  <div className="w-full h-2 bg-card shadow-sm rounded-full overflow-hidden mb-3">
                    <div className="h-full bg-gold rounded-full" style={{ width: `${Math.min(100, (selectedClient.loyalty_points / 500) * 100)}%` }} />
                  </div>
                  <Button variant="outline" size="sm" className="w-full" onClick={() => setAddPointsClient(selectedClient)}>+ Add Points</Button>
                </div>
              </>
            )}

            {/* Hair Profile tab */}
            {activeTab === "hair" && (
              <div className="space-y-4">
                <p className="text-xs text-grey">Saved per client — visible to all barbers at your shop.</p>

                <div className="grid grid-cols-2 gap-3">
                  {[
                    { key: "topGuard" as keyof HairProfile, label: "Top — Guard #", placeholder: "e.g. 4" },
                    { key: "sidesGuard" as keyof HairProfile, label: "Sides — Guard #", placeholder: "e.g. 1.5" },
                  ].map(({ key, label, placeholder }) => (
                    <div key={key} className="space-y-1.5">
                      <label className="text-xs font-medium text-grey">{label}</label>
                      <input
                        value={hairProfile[key]}
                        onChange={e => setHairProfile(p => ({ ...p, [key]: e.target.value }))}
                        placeholder={placeholder}
                        className="w-full bg-card-raised border border-border rounded-xl px-3 py-2 text-sm text-foreground placeholder:text-grey focus:outline-none focus:ring-1 focus:ring-black/20"
                      />
                    </div>
                  ))}
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-grey">Fade Type</label>
                    <select
                      value={hairProfile.fadeType}
                      onChange={e => setHairProfile(p => ({ ...p, fadeType: e.target.value }))}
                      className="w-full bg-card-raised border border-border rounded-xl px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-black/20"
                    >
                      <option value="">— select —</option>
                      {["None", "Low Fade", "Mid Fade", "High Fade", "Skin Fade", "Taper"].map(o => <option key={o} value={o}>{o}</option>)}
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-grey">Beard</label>
                    <select
                      value={hairProfile.beardStyle}
                      onChange={e => setHairProfile(p => ({ ...p, beardStyle: e.target.value }))}
                      className="w-full bg-card-raised border border-border rounded-xl px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-black/20"
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
                    <label className="text-xs font-medium text-grey">{label}</label>
                    <textarea
                      value={hairProfile[key]}
                      onChange={e => setHairProfile(p => ({ ...p, [key]: e.target.value }))}
                      placeholder={placeholder}
                      rows={2}
                      className="w-full bg-card-raised border border-border rounded-xl px-3 py-2 text-sm text-foreground placeholder:text-grey focus:outline-none focus:ring-1 focus:ring-black/20 resize-none"
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
                  <p className="text-sm text-grey text-center py-8">No appointments found</p>
                ) : (
                  <div className="space-y-2">
                    {clientAppointments.map(apt => (
                      <div key={apt.id} className="flex items-center justify-between p-3 bg-card-raised rounded-xl border border-border">
                        <div>
                          <p className="text-sm text-foreground">{apt.services?.name ?? "—"} · {apt.barbers?.name ?? "—"}</p>
                          <p className="text-xs text-grey">{prettyDate(apt.date)} {apt.time_slot}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-semibold text-foreground">{formatCurrency(apt.total_amount)}</p>
                          <span className={cn("text-xs", apt.status === "no-show" ? "text-red-400" : apt.status === "completed" ? "text-blue-400" : "text-grey")}>
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
          <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 overflow-y-auto overscroll-contain [&>*]:my-auto">
            <div className="bg-card shadow-sm border border-border rounded-2xl p-6 w-full max-w-xs space-y-4">
              <h3 className="text-foreground font-bold">Add Points for {addPointsClient.name}</h3>
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
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 overflow-y-auto overscroll-contain [&>*]:my-auto">
            <div className="bg-card shadow-sm border border-border rounded-2xl p-6 w-full max-w-md space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold text-foreground">Add New Client</h2>
                <button onClick={() => setShowAddModal(false)} className="text-grey hover:text-foreground">✕</button>
              </div>
              <Input label="Full Name *" placeholder="John Doe" value={newClient.name} onChange={e => setNewClient(p => ({ ...p, name: e.target.value }))} />
              <Input label="Phone *" placeholder="506-555-0000" value={newClient.phone} onChange={e => setNewClient(p => ({ ...p, phone: formatPhone(e.target.value) }))} />
              <Input label="Email (optional)" placeholder="john@email.com" value={newClient.email} onChange={e => setNewClient(p => ({ ...p, email: e.target.value }))} />
              <Textarea label="Notes" placeholder="Any notes about this client..." rows={2} value={newClient.notes} onChange={e => setNewClient(p => ({ ...p, notes: e.target.value }))} />
              <div className="space-y-1.5">
                <label className="text-sm text-grey">Birthday (optional)</label>
                <input type="date" value={newClient.birthday} onChange={e => setNewClient(p => ({ ...p, birthday: e.target.value }))}
                  className="w-full bg-card-raised border border-border rounded-xl px-4 py-2.5 text-sm text-foreground focus:outline-none focus:border-black" />
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
