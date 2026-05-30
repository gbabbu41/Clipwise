"use client";
import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import {
  cn, generate24hSlots, dbTimeToDisplay, displayTimeToDb, formatDateForDb,
} from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { KeyRound, Trash2, Copy, Check } from "lucide-react";
import { getPlanLimit } from "@/lib/validation";
import { Tooltip } from "@/components/ui/tooltip";
import type { Barber, TimeSlot, DaySchedule } from "@/lib/database.types";

// ─── Constants ────────────────────────────────────────────────────────────────
const DAYS_FULL = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const ALL_SLOTS = generate24hSlots();

// ─── Types ────────────────────────────────────────────────────────────────────
interface StaffHourRow {
  id: string;
  barber_id: string;
  shop_id: string;
  date: string;
  clock_in: string;
  clock_out: string | null;
  hours_worked: number | null;
  barbers?: { name: string };
}

interface BarberWithSchedule extends Barber {
  apptCount?: number;
  schedule: DaySchedule[];
}

// ─── Reset link copy ──────────────────────────────────────────────────────────
function ResetLinkCopy({ link }: { link: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div className="flex items-center gap-2 bg-surface-raised border border-border rounded-xl p-3">
      <p className="flex-1 text-xs text-gray-400 truncate">{link}</p>
      <button onClick={copy} className={cn("flex-shrink-0 p-1.5 rounded-lg transition-colors", copied ? "text-green-400" : "text-gray-400 hover:text-white")}>
        {copied ? <Check size={15} /> : <Copy size={15} />}
      </button>
    </div>
  );
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────
function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse bg-surface-raised rounded-xl", className)} />;
}

// ─── Toast ────────────────────────────────────────────────────────────────────
function Toast({ message, onClose }: { message: string; onClose: () => void }) {
  return (
    <div className="fixed bottom-6 right-6 z-[100] bg-surface-raised border border-border rounded-xl px-5 py-3 text-sm text-white shadow-xl flex items-center gap-3">
      <span className="text-gold">✓</span>{message}
      <button onClick={onClose} className="text-gray-400 hover:text-white ml-2">✕</button>
    </div>
  );
}

// ─── Default schedule ─────────────────────────────────────────────────────────
function defaultSchedule(): DaySchedule[] {
  return DAYS_FULL.map((_, i) => ({ isOpen: i >= 1 && i <= 5, startTime: "9:00 AM", endTime: "7:00 PM" }));
}

export default function StaffPage() {
  const { shop, accessToken } = useAuth();

  // ── Data state ──────────────────────────────────────────────────────────────
  const [barbers, setBarbers] = useState<BarberWithSchedule[]>([]);
  const [staffHours, setStaffHours] = useState<StaffHourRow[]>([]);
  const [loading, setLoading] = useState(true);

  // ── UI state ────────────────────────────────────────────────────────────────
  const [toast, setToast] = useState("");
  const [scheduleBarber, setScheduleBarber] = useState<BarberWithSchedule | null>(null);
  const [editSchedule, setEditSchedule] = useState<DaySchedule[]>(defaultSchedule());
  const [showAddModal, setShowAddModal] = useState(false);
  const [addTab, setAddTab] = useState<"manual" | "invite">("invite");
  const [addForm, setAddForm] = useState({ name: "", email: "", commission_percent: "50" });
  const [inviteSent, setInviteSent] = useState(false);
  const [savingSchedule, setSavingSchedule] = useState(false);
  const [savingAdd, setSavingAdd] = useState(false);
  const [savingCommission, setSavingCommission] = useState<string | null>(null);
  const [commissions, setCommissions] = useState<Record<string, number>>({});
  const [activeMap, setActiveMap] = useState<Record<string, boolean>>({});
  const [resetModal, setResetModal] = useState<{ link: string; email: string; name: string } | null>(null);
  const [resettingId, setResettingId] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<BarberWithSchedule | null>(null);
  const [resendingInviteId, setResendingInviteId] = useState<string | null>(null);

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(""), 3000); };

  // ── Load barbers + their schedules + appt counts ────────────────────────────
  const loadBarbers = useCallback(async () => {
    if (!shop) { setLoading(false); return; }
    setLoading(true);
    const now = new Date();
    const monthStart = formatDateForDb(new Date(now.getFullYear(), now.getMonth(), 1));
    const monthEnd = formatDateForDb(new Date(now.getFullYear(), now.getMonth() + 1, 0));

    const { data: bData } = await supabase.from("barbers").select("*").eq("shop_id", shop.id).order("created_at", { ascending: true });
    const barberList = (bData ?? []) as Barber[];

    const [{ data: tsData }, { data: apptData }] = await Promise.all([
      supabase.from("time_slots").select("*").in("barber_id", barberList.map((b) => b.id)),
      supabase.from("appointments").select("barber_id, date").eq("shop_id", shop.id).gte("date", monthStart).lte("date", monthEnd),
    ]);

    const tsRows = (tsData ?? []) as TimeSlot[];
    const apptRows = (apptData ?? []) as { barber_id: string; date: string }[];
    const apptCounts: Record<string, number> = {};
    apptRows.forEach((a) => { apptCounts[a.barber_id] = (apptCounts[a.barber_id] ?? 0) + 1; });

    const enriched: BarberWithSchedule[] = barberList.map((b) => {
      const bSlots = tsRows.filter((t) => t.barber_id === b.id);
      const schedule: DaySchedule[] = DAYS_FULL.map((_, dow) => {
        const ts = bSlots.find((t) => t.day_of_week === dow);
        if (ts) return { isOpen: ts.is_available, startTime: dbTimeToDisplay(ts.start_time), endTime: dbTimeToDisplay(ts.end_time) };
        return { isOpen: false, startTime: "9:00 AM", endTime: "7:00 PM" };
      });
      return { ...b, apptCount: apptCounts[b.id] ?? 0, schedule };
    });

    setBarbers(enriched);
    setCommissions(Object.fromEntries(enriched.map((b) => [b.id, b.commission_percent])));
    setActiveMap(Object.fromEntries(enriched.map((b) => [b.id, b.is_active])));

    // Load staff hours
    const { data: shData } = await supabase
      .from("staff_hours")
      .select("*, barbers(name)")
      .eq("shop_id", shop.id)
      .order("date", { ascending: false })
      .limit(50);
    setStaffHours((shData ?? []) as StaffHourRow[]);
    setLoading(false);
  }, [shop]);

  useEffect(() => { loadBarbers(); }, [loadBarbers]);

  // ── Save schedule ───────────────────────────────────────────────────────────
  const saveSchedule = async () => {
    if (!scheduleBarber) return;
    setSavingSchedule(true);
    // Delete existing
    await supabase.from("time_slots").delete().eq("barber_id", scheduleBarber.id);
    // Insert new
    const inserts = editSchedule
      .map((day, dow) => day.isOpen ? { barber_id: scheduleBarber.id, day_of_week: dow, start_time: displayTimeToDb(day.startTime), end_time: displayTimeToDb(day.endTime), is_available: true } : null)
      .filter((x): x is NonNullable<typeof x> => x !== null);
    if (inserts.length > 0) await supabase.from("time_slots").insert(inserts);
    setSavingSchedule(false);
    setScheduleBarber(null);
    showToast(`Schedule saved for ${scheduleBarber.name}`);
    loadBarbers();
  };

  // ── Toggle barber active ────────────────────────────────────────────────────
  const toggleActive = async (barberId: string) => {
    const newVal = !activeMap[barberId];
    setActiveMap((prev) => ({ ...prev, [barberId]: newVal }));
    await supabase.from("barbers").update({ is_active: newVal }).eq("id", barberId);
    showToast(newVal ? "Barber reactivated" : "Barber deactivated");
  };

  // ── Save commission ─────────────────────────────────────────────────────────
  const saveCommission = async (barberId: string) => {
    setSavingCommission(barberId);
    await supabase.from("barbers").update({ commission_percent: commissions[barberId] }).eq("id", barberId);
    setSavingCommission(null);
    showToast("Commission updated!");
  };

  // ── Add barber manually ─────────────────────────────────────────────────────
  const addBarber = async () => {
    if (!shop || !addForm.name.trim()) return;
    const limit = getPlanLimit(shop.subscription_plan);
    if (barbers.length >= limit) {
      showToast(`${shop.subscription_plan} plan allows max ${limit} barber${limit > 1 ? "s" : ""}. Upgrade to add more.`);
      return;
    }
    // Normalize email (matches Supabase auth lowercasing) so dupe checks
    // and future DB unique constraint stay consistent.
    const email = addForm.email.trim().toLowerCase() || null;
    // Friendly pre-check before hitting the DB
    if (email) {
      const { data: existing } = await supabase
        .from("barbers")
        .select("id")
        .eq("shop_id", shop.id)
        .ilike("email", email)
        .maybeSingle();
      if (existing) { showToast("A barber with this email is already on your team."); return; }
    }
    setSavingAdd(true);
    const { error } = await supabase.from("barbers").insert({
      shop_id: shop.id,
      name: addForm.name.trim(),
      email,
      commission_percent: parseInt(addForm.commission_percent) || 50,
      is_active: true,
      rating: 0,
      total_reviews: 0,
    });
    setSavingAdd(false);
    if (error) {
      // Postgres unique-violation (code 23505) — friendlier message if the
      // DB constraint catches a race / direct-insert that slipped past the check.
      if (error.code === "23505") {
        showToast("A barber with this email is already on your team.");
      } else {
        showToast(`Error adding barber: ${error.message}`);
      }
      return;
    }
    setShowAddModal(false);
    setAddForm({ name: "", email: "", commission_percent: "50" });
    showToast("Barber added successfully!");
    loadBarbers();
  };

  // ── Invite barber by email ──────────────────────────────────────────────────
  const inviteBarber = async () => {
    if (!addForm.name.trim() || !addForm.email.trim()) return;
    const limit = getPlanLimit(shop?.subscription_plan ?? "starter");
    if (barbers.length >= limit) {
      showToast(`${shop?.subscription_plan} plan allows max ${limit} barber${limit > 1 ? "s" : ""}. Upgrade to add more.`);
      return;
    }
    if (!accessToken) return;
    setSavingAdd(true);
    const res = await fetch("/api/admin/barber/invite", {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        name: addForm.name.trim(),
        email: addForm.email.trim(),
        commission_percent: parseInt(addForm.commission_percent) || 50,
      }),
    });
    const data = await res.json();
    setSavingAdd(false);
    if (!res.ok) { showToast(`Error: ${data.error}`); return; }
    setInviteSent(true);
    loadBarbers();
  };

  // ── Password reset ──────────────────────────────────────────────────────────
  const resetPassword = async (barber: BarberWithSchedule) => {
    if (!accessToken) return;
    setResettingId(barber.id);
    const res = await fetch("/api/admin/barber/reset-password", {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ barber_id: barber.id }),
    });
    const data = await res.json();
    setResettingId(null);
    if (!res.ok) { showToast(`Error: ${data.error}`); return; }
    setResetModal(data);
  };

  // ── Resend invite ───────────────────────────────────────────────────────────
  const resendInvite = async (barber: BarberWithSchedule) => {
    if (!accessToken) return;
    setResendingInviteId(barber.id);
    const res = await fetch("/api/admin/barber/resend-invite", {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ barber_id: barber.id }),
    });
    const data = await res.json();
    setResendingInviteId(null);
    showToast(res.ok ? `Invite resent to ${barber.email}` : `Error: ${data.error}`);
  };

  // ── Remove barber ───────────────────────────────────────────────────────────
  const removeBarber = async (barber: BarberWithSchedule) => {
    setRemovingId(barber.id);
    await supabase.from("barbers").delete().eq("id", barber.id);
    setRemovingId(null);
    setConfirmRemove(null);
    showToast(`${barber.name} removed from staff`);
    loadBarbers();
  };

  // ── Open schedule modal ─────────────────────────────────────────────────────
  const openSchedule = (b: BarberWithSchedule) => {
    setEditSchedule(b.schedule.map((d) => ({ ...d })));
    setScheduleBarber(b);
  };

  const updateScheduleDay = (dow: number, field: keyof DaySchedule, value: string | boolean) => {
    setEditSchedule((prev) => prev.map((d, i) => i === dow ? { ...d, [field]: value } : d));
  };

  if (loading) {
    return (
      <div className="p-6 space-y-6">
        <Skeleton className="h-12 w-48" />
        <div className="grid md:grid-cols-3 gap-6">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-64" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {toast && <Toast message={toast} onClose={() => setToast("")} />}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Staff</h1>
          <p className="text-sm text-gray-400 mt-0.5">Manage barbers, schedules and commissions</p>
        </div>
        {shop && barbers.length >= getPlanLimit(shop.subscription_plan) ? (
          <Tooltip content={`${shop.subscription_plan} plan: max ${getPlanLimit(shop.subscription_plan)} barber${getPlanLimit(shop.subscription_plan) > 1 ? "s" : ""}. Upgrade to add more.`}>
            <Button disabled>+ Add Barber</Button>
          </Tooltip>
        ) : (
          <Button onClick={() => setShowAddModal(true)}>+ Add Barber</Button>
        )}
      </div>

      {/* Barber Cards */}
      {barbers.length === 0 ? (
        <Card>
          <div className="py-16 text-center">
            <p className="text-4xl mb-3">💈</p>
            <p className="font-medium text-white mb-1">No barbers yet</p>
            <p className="text-sm text-gray-500 mb-4 max-w-xs mx-auto">Invite your barbers by email — they&apos;ll get access to their own portal to manage their schedule and clients.</p>
            <Button onClick={() => setShowAddModal(true)}>+ Add Barber</Button>
          </div>
        </Card>
      ) : (
        <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-6">
          {barbers.map((barber) => (
            <Card key={barber.id} className={cn(!activeMap[barber.id] && "opacity-60")}>
              {/* Card Header */}
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                  {barber.photo
                    ? <img src={barber.photo} alt={barber.name} className="w-12 h-12 rounded-full object-cover border border-border" />
                    : <div className="w-12 h-12 rounded-full bg-gold/20 border border-gold/30 flex items-center justify-center text-gold font-bold text-xl">{barber.name[0]}</div>
                  }
                  <div>
                    <h3 className="text-white font-semibold">{barber.name}</h3>
                    {barber.email && <p className="text-xs text-gray-500">{barber.email}</p>}
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      {barber.user_id ? (
                        <span className="text-xs bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 rounded-full px-2 py-0.5">✓ Portal active</span>
                      ) : barber.email ? (
                        <span className="text-xs bg-yellow-500/15 border border-yellow-500/30 text-yellow-400 rounded-full px-2 py-0.5">⏳ Invite pending</span>
                      ) : (
                        <span className="text-xs bg-surface-raised border border-border text-gray-500 rounded-full px-2 py-0.5">Manual</span>
                      )}
                      <span className="text-gold text-xs">★ {barber.rating}</span>
                    </div>
                  </div>
                </div>
                {/* Active toggle */}
                <button
                  onClick={() => toggleActive(barber.id)}
                  className={cn("relative w-11 h-6 rounded-full transition-colors flex-shrink-0", activeMap[barber.id] ? "bg-emerald-500" : "bg-surface-raised border border-border")}
                >
                  <span className={cn("absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all shadow", activeMap[barber.id] ? "left-[22px]" : "left-0.5")} />
                </button>
              </div>

              {/* Stats */}
              <div className="grid grid-cols-2 gap-2 mb-4">
                <div className="text-center p-2.5 bg-surface-raised rounded-xl">
                  <p className="text-lg font-bold text-white">{barber.apptCount ?? 0}</p>
                  <p className="text-xs text-gray-400">Appts (mo.)</p>
                </div>
                <div className="text-center p-2.5 bg-surface-raised rounded-xl">
                  <p className="text-lg font-bold text-gold">{commissions[barber.id] ?? barber.commission_percent}%</p>
                  <p className="text-xs text-gray-400">Commission</p>
                </div>
              </div>

              {/* Commission Slider */}
              <div className="mb-4">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs text-gray-400">Commission Rate</p>
                  <p className="text-sm font-bold text-gold">{commissions[barber.id]}%</p>
                </div>
                <input
                  type="range" min={20} max={70} step={5}
                  value={commissions[barber.id]}
                  onChange={(e) => setCommissions((prev) => ({ ...prev, [barber.id]: Number(e.target.value) }))}
                  className="w-full accent-[#C9A84C] h-1.5 rounded-full cursor-pointer"
                />
                <div className="flex justify-between text-xs text-gray-600 mt-0.5"><span>20%</span><span>70%</span></div>
                <Button variant="outline" size="sm" className="w-full mt-2" loading={savingCommission === barber.id} onClick={() => saveCommission(barber.id)}>
                  Save Commission
                </Button>
              </div>

              {/* Actions */}
              <div className="flex gap-2">
                <Button variant="outline" size="sm" className="flex-1" onClick={() => openSchedule(barber)}>Set Schedule</Button>
                <Button variant="secondary" size="sm" className="flex-1" onClick={() => document.getElementById("clock-history")?.scrollIntoView({ behavior: "smooth" })}>
                  Clock History
                </Button>
              </div>

              {/* Admin controls */}
              <div className="flex gap-2 mt-2">
                {!barber.user_id && barber.email ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1 text-yellow-400 border-yellow-500/30 hover:bg-yellow-500/10"
                    loading={resendingInviteId === barber.id}
                    onClick={() => resendInvite(barber)}
                  >
                    ✉️ Resend Invite
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1 text-blue-400 border-blue-400/30 hover:bg-blue-400/10"
                    loading={resettingId === barber.id}
                    onClick={() => resetPassword(barber)}
                  >
                    <KeyRound size={13} className="mr-1.5" />
                    Reset Password
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  className="text-red-400 border-red-400/30 hover:bg-red-400/10 px-3"
                  onClick={() => setConfirmRemove(barber)}
                >
                  <Trash2 size={13} />
                </Button>
              </div>

              {/* Schedule Preview */}
              <div className="mt-3 flex gap-1 flex-wrap">
                {barber.schedule.map((day, i) => (
                  <span key={i} className={cn("text-xs px-1.5 py-0.5 rounded", day.isOpen ? "bg-gold/15 text-gold" : "bg-surface-raised text-gray-600")}>
                    {DAYS_SHORT[i]}
                  </span>
                ))}
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Clock History */}
      <Card id="clock-history">
        <CardHeader>
          <CardTitle>Clock In / Out History</CardTitle>
          <Badge variant="outline">{staffHours.length} records</Badge>
        </CardHeader>
        <CardContent>
          {staffHours.length === 0 ? (
            <div className="py-8 text-center text-gray-500">
              <p>No clock records found</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border">
                    {["Barber", "Date", "Clock In", "Clock Out", "Hours", "Status"].map((h) => (
                      <th key={h} className="text-left text-xs font-medium text-gray-400 px-3 py-2">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {staffHours.map((sh) => (
                    <tr key={sh.id} className="border-b border-border/50 hover:bg-surface-raised/30">
                      <td className="px-3 py-3 text-sm text-white">{sh.barbers?.name ?? "—"}</td>
                      <td className="px-3 py-3 text-sm text-gray-300">{sh.date}</td>
                      <td className="px-3 py-3 text-sm text-emerald-400">{sh.clock_in}</td>
                      <td className="px-3 py-3 text-sm text-red-400">{sh.clock_out ?? "—"}</td>
                      <td className="px-3 py-3 text-sm text-white">{sh.hours_worked != null ? `${sh.hours_worked}h` : "—"}</td>
                      <td className="px-3 py-3">
                        <Badge variant={sh.clock_out ? "success" : "warning"}>{sh.clock_out ? "Done" : "Clocked In"}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Schedule Modal */}
      {scheduleBarber && (
        <>
          <div className="fixed inset-0 bg-black/70 z-40" onClick={() => setScheduleBarber(null)} />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="bg-surface border border-border rounded-2xl p-6 w-full max-w-lg space-y-4 max-h-[90vh] overflow-y-auto">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold text-white">Schedule — {scheduleBarber.name}</h2>
                <button onClick={() => setScheduleBarber(null)} className="text-gray-400 hover:text-white text-xl leading-none">✕</button>
              </div>
              <div className="space-y-2">
                {DAYS_FULL.map((day, dow) => (
                  <div key={day} className="flex items-center gap-3 p-3 bg-surface-raised rounded-xl border border-border">
                    {/* Open/Close toggle */}
                    <button
                      onClick={() => updateScheduleDay(dow, "isOpen", !editSchedule[dow].isOpen)}
                      className={cn("relative w-10 h-5 rounded-full transition-colors flex-shrink-0", editSchedule[dow].isOpen ? "bg-gold" : "bg-surface border border-border")}
                    >
                      <span className={cn("absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all shadow", editSchedule[dow].isOpen ? "left-[22px]" : "left-0.5")} />
                    </button>
                    <span className="text-sm text-white w-10 flex-shrink-0">{DAYS_SHORT[dow]}</span>
                    {editSchedule[dow].isOpen ? (
                      <>
                        <select
                          value={editSchedule[dow].startTime}
                          onChange={(e) => updateScheduleDay(dow, "startTime", e.target.value)}
                          className="flex-1 rounded-lg border border-border bg-background px-2 py-1.5 text-xs text-white focus:outline-none focus:border-gold/50"
                        >
                          {ALL_SLOTS.map((t) => <option key={t} value={t}>{t}</option>)}
                        </select>
                        <span className="text-gray-500 text-xs flex-shrink-0">to</span>
                        <select
                          value={editSchedule[dow].endTime}
                          onChange={(e) => updateScheduleDay(dow, "endTime", e.target.value)}
                          className="flex-1 rounded-lg border border-border bg-background px-2 py-1.5 text-xs text-white focus:outline-none focus:border-gold/50"
                        >
                          {ALL_SLOTS.map((t) => <option key={t} value={t}>{t}</option>)}
                        </select>
                      </>
                    ) : (
                      <span className="text-xs text-gray-500">Closed</span>
                    )}
                  </div>
                ))}
              </div>
              <div className="flex gap-3">
                <Button variant="outline" className="flex-1" onClick={() => setScheduleBarber(null)}>Cancel</Button>
                <Button className="flex-1" loading={savingSchedule} onClick={saveSchedule}>Save Schedule</Button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Password Reset Modal */}
      {resetModal && (
        <>
          <div className="fixed inset-0 bg-black/70 z-40" onClick={() => setResetModal(null)} />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="bg-surface border border-border rounded-2xl p-6 w-full max-w-md space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold text-white">Password Reset Link</h2>
                <button onClick={() => setResetModal(null)} className="text-gray-400 hover:text-white text-xl leading-none">✕</button>
              </div>
              <p className="text-sm text-gray-400">
                Share this link with <span className="text-white font-medium">{resetModal.name}</span> ({resetModal.email}). It expires in 1 hour.
              </p>
              <ResetLinkCopy link={resetModal.link} />
              <p className="text-xs text-gray-600">The barber will be prompted to set a new password when they open this link.</p>
              <Button className="w-full" onClick={() => setResetModal(null)}>Done</Button>
            </div>
          </div>
        </>
      )}

      {/* Confirm Remove Modal */}
      {confirmRemove && (
        <>
          <div className="fixed inset-0 bg-black/70 z-40" onClick={() => setConfirmRemove(null)} />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="bg-surface border border-border rounded-2xl p-6 w-full max-w-sm space-y-4">
              <div className="text-center">
                <div className="w-12 h-12 rounded-full bg-red-500/15 border border-red-500/30 flex items-center justify-center mx-auto mb-3">
                  <Trash2 size={20} className="text-red-400" />
                </div>
                <h2 className="text-lg font-bold text-white">Remove Barber?</h2>
                <p className="text-sm text-gray-400 mt-1">
                  This will remove <span className="text-white font-medium">{confirmRemove.name}</span> from your staff. Their appointments and history will remain. Their login account is not deleted.
                </p>
              </div>
              <div className="flex gap-3">
                <Button variant="outline" className="flex-1" onClick={() => setConfirmRemove(null)}>Cancel</Button>
                <Button
                  className="flex-1 bg-red-500 hover:bg-red-600 text-white"
                  loading={removingId === confirmRemove.id}
                  onClick={() => removeBarber(confirmRemove)}
                >
                  Remove
                </Button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Add / Invite Barber Modal */}
      {showAddModal && (
        <>
          <div className="fixed inset-0 bg-black/70 z-40" onClick={() => { setShowAddModal(false); setInviteSent(false); setAddForm({ name: "", email: "", commission_percent: "50" }); }} />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="bg-surface border border-border rounded-2xl p-6 w-full max-w-md space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold text-white">Add Barber</h2>
                <button onClick={() => { setShowAddModal(false); setInviteSent(false); setAddForm({ name: "", email: "", commission_percent: "50" }); }} className="text-gray-400 hover:text-white text-xl leading-none">✕</button>
              </div>

              {/* Tabs */}
              <div className="flex gap-1 bg-surface-raised border border-border rounded-xl p-1">
                {(["invite", "manual"] as const).map(tab => (
                  <button
                    key={tab}
                    onClick={() => { setAddTab(tab); setInviteSent(false); }}
                    className={cn("flex-1 py-1.5 text-sm rounded-lg transition-all capitalize", addTab === tab ? "bg-gold/15 text-gold border border-gold/20" : "text-gray-400 hover:text-white")}
                  >
                    {tab === "invite" ? "✉️ Invite by Email" : "➕ Add Manually"}
                  </button>
                ))}
              </div>

              {inviteSent ? (
                <div className="py-6 text-center">
                  <div className="text-4xl mb-3">✉️</div>
                  <p className="font-semibold text-white">Invite sent!</p>
                  <p className="text-sm text-gray-400 mt-1">{addForm.name} will get an email with a link to set up their account.</p>
                  <Button className="w-full mt-5" onClick={() => { setShowAddModal(false); setInviteSent(false); setAddForm({ name: "", email: "", commission_percent: "50" }); }}>Done</Button>
                </div>
              ) : (
                <>
                  {addTab === "invite" && (
                    <p className="text-xs text-gray-500 bg-surface-raised border border-border rounded-xl px-3 py-2">
                      An invite email will be sent. The barber clicks the link to create their account and gets access to their barber portal automatically.
                    </p>
                  )}
                  {addTab === "manual" && (
                    <p className="text-xs text-gray-500 bg-surface-raised border border-border rounded-xl px-3 py-2">
                      Adds the barber to your roster without sending an invite. Useful for barbers who won't use the portal.
                    </p>
                  )}

                  {[
                    { key: "name" as const, label: "Full Name", placeholder: "John Doe", type: "text", required: true },
                    { key: "email" as const, label: addTab === "invite" ? "Email" : "Email (optional)", placeholder: "john@barbershop.com", type: "email", required: addTab === "invite" },
                    { key: "commission_percent" as const, label: "Commission %", placeholder: "50", type: "number", required: false },
                  ].map(({ key, label, placeholder, type, required }) => (
                    <div key={key} className="space-y-1.5">
                      <label className="text-sm text-gray-400">{label}</label>
                      <input
                        type={type}
                        value={addForm[key]}
                        onChange={(e) => setAddForm((prev) => ({ ...prev, [key]: e.target.value }))}
                        placeholder={placeholder}
                        required={required}
                        className="w-full bg-surface-raised border border-border rounded-xl px-4 py-2.5 text-sm text-white placeholder:text-gray-500 focus:outline-none focus:border-gold/50"
                      />
                    </div>
                  ))}

                  <div className="flex gap-3 pt-2">
                    <Button variant="outline" className="flex-1" onClick={() => { setShowAddModal(false); setAddForm({ name: "", email: "", commission_percent: "50" }); }}>Cancel</Button>
                    <Button className="flex-1" loading={savingAdd} onClick={addTab === "invite" ? inviteBarber : addBarber}>
                      {addTab === "invite" ? "Send Invite" : "Add Barber"}
                    </Button>
                  </div>
                </>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
