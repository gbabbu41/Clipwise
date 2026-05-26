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
  const { shop } = useAuth();

  // ── Data state ──────────────────────────────────────────────────────────────
  const [barbers, setBarbers] = useState<BarberWithSchedule[]>([]);
  const [staffHours, setStaffHours] = useState<StaffHourRow[]>([]);
  const [loading, setLoading] = useState(true);

  // ── UI state ────────────────────────────────────────────────────────────────
  const [toast, setToast] = useState("");
  const [scheduleBarber, setScheduleBarber] = useState<BarberWithSchedule | null>(null);
  const [editSchedule, setEditSchedule] = useState<DaySchedule[]>(defaultSchedule());
  const [showAddModal, setShowAddModal] = useState(false);
  const [addForm, setAddForm] = useState({ name: "", email: "", commission_percent: "50" });
  const [savingSchedule, setSavingSchedule] = useState(false);
  const [savingAdd, setSavingAdd] = useState(false);
  const [savingCommission, setSavingCommission] = useState<string | null>(null);
  const [commissions, setCommissions] = useState<Record<string, number>>({});
  const [activeMap, setActiveMap] = useState<Record<string, boolean>>({});

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(""), 3000); };

  // ── Load barbers + their schedules + appt counts ────────────────────────────
  const loadBarbers = useCallback(async () => {
    if (!shop) return;
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

  // ── Add barber ──────────────────────────────────────────────────────────────
  const addBarber = async () => {
    if (!shop || !addForm.name.trim()) return;
    setSavingAdd(true);
    const { error } = await supabase.from("barbers").insert({
      shop_id: shop.id,
      name: addForm.name.trim(),
      email: addForm.email.trim() || null,
      commission_percent: parseInt(addForm.commission_percent) || 50,
      is_active: true,
      rating: 5,
      total_reviews: 0,
    });
    setSavingAdd(false);
    if (error) { showToast("Error adding barber"); return; }
    setShowAddModal(false);
    setAddForm({ name: "", email: "", commission_percent: "50" });
    showToast("Barber added successfully!");
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
        <Button onClick={() => setShowAddModal(true)}>+ Add Barber</Button>
      </div>

      {/* Barber Cards */}
      {barbers.length === 0 ? (
        <Card>
          <div className="py-16 text-center text-gray-500">
            <p className="text-4xl mb-3">💈</p>
            <p className="font-medium text-white">No barbers yet</p>
            <p className="text-sm mt-1">Add your first barber to get started</p>
            <Button className="mt-4" onClick={() => setShowAddModal(true)}>+ Add Barber</Button>
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
                    <div className="flex items-center gap-1 mt-0.5">
                      <span className="text-gold text-xs">★</span>
                      <span className="text-xs text-gray-300">{barber.rating}</span>
                      <span className="text-xs text-gray-500">({barber.total_reviews})</span>
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

      {/* Add Barber Modal */}
      {showAddModal && (
        <>
          <div className="fixed inset-0 bg-black/70 z-40" onClick={() => setShowAddModal(false)} />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="bg-surface border border-border rounded-2xl p-6 w-full max-w-md space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold text-white">Add Barber</h2>
                <button onClick={() => setShowAddModal(false)} className="text-gray-400 hover:text-white text-xl leading-none">✕</button>
              </div>
              {[
                { key: "name" as const, label: "Full Name", placeholder: "John Doe", type: "text" },
                { key: "email" as const, label: "Email (optional)", placeholder: "john@barbershop.com", type: "email" },
                { key: "commission_percent" as const, label: "Commission %", placeholder: "50", type: "number" },
              ].map(({ key, label, placeholder, type }) => (
                <div key={key} className="space-y-1.5">
                  <label className="text-sm text-gray-400">{label}</label>
                  <input
                    type={type}
                    value={addForm[key]}
                    onChange={(e) => setAddForm((prev) => ({ ...prev, [key]: e.target.value }))}
                    placeholder={placeholder}
                    className="w-full bg-surface-raised border border-border rounded-xl px-4 py-2.5 text-sm text-white placeholder:text-gray-500 focus:outline-none focus:border-gold/50"
                  />
                </div>
              ))}
              <div className="flex gap-3 pt-2">
                <Button variant="outline" className="flex-1" onClick={() => setShowAddModal(false)}>Cancel</Button>
                <Button className="flex-1" loading={savingAdd} onClick={addBarber}>Add Barber</Button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
