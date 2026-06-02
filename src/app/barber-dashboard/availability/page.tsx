"use client";
import { useEffect, useState, useCallback, useRef } from "react";
import { Save, Clock, Lock } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { useBarber } from "@/lib/barber-context";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { Switch } from "@/components/ui/switch";
import { DEFAULT_BARBER_PERMISSIONS } from "@/lib/database.types";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// 15-min increments across the full 24-hour day (00:00 → 23:45)
const TIME_OPTIONS = Array.from({ length: (24 * 60) / 15 }, (_, i) => {
  const total = i * 15;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
});

function fmt(t: string) {
  const [h, m] = t.split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${ampm}`;
}

interface DaySlot { day_of_week: number; start_time: string; end_time: string; is_available: boolean }

const DEFAULT_SLOTS: DaySlot[] = DAYS.map((_, i) => ({
  day_of_week: i,
  start_time: "09:00",
  end_time: "19:00",
  is_available: i !== 0, // closed Sunday by default
}));

export default function BarberAvailabilityPage() {
  const { accessToken } = useAuth();
  const { barber, shop } = useBarber();
  const [slots, setSlots] = useState<DaySlot[]>(DEFAULT_SLOTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [syncedFromOwner, setSyncedFromOwner] = useState(false);
  // Track whether the barber has unsaved local edits so a realtime push from
  // the owner doesn't quietly stomp on work-in-progress the barber hasn't saved.
  const dirty = useRef(false);

  const loadSlots = useCallback(async () => {
    if (!accessToken) return;
    const shopParam = shop?.id ? `?shop_id=${shop.id}` : "";
    const res = await fetch(`/api/barber/availability${shopParam}`, { headers: { Authorization: `Bearer ${accessToken}` } });
    const { slots: s } = await res.json();
    if (!s) return;
    // The DB stores time as "HH:MM:SS" — strip the seconds so the value matches
    // an entry in TIME_OPTIONS ("HH:MM"). Without this, the select falls back
    // to displaying the first option (00:00 / 12 AM).
    const normalizeTime = (t: string) => (t ?? "").slice(0, 5);
    setSlots(prev => prev.map(d => {
      const found = s.find((x: DaySlot) => x.day_of_week === d.day_of_week);
      if (!found) return { ...d, is_available: false };
      return {
        ...d,
        ...found,
        start_time: normalizeTime(found.start_time),
        end_time: normalizeTime(found.end_time),
      };
    }));
  }, [accessToken, shop?.id]);

  // Initial load
  useEffect(() => {
    loadSlots().finally(() => setLoading(false));
  }, [loadSlots]);

  // Realtime subscription: when the shop owner edits this barber's schedule
  // from /dashboard/staff, push the change here without requiring a refresh.
  useEffect(() => {
    if (!barber?.id) return;
    const channel = supabase
      .channel(`time_slots:${barber.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "time_slots", filter: `barber_id=eq.${barber.id}` },
        () => {
          if (dirty.current) return;
          loadSlots();
          setSyncedFromOwner(true);
          setTimeout(() => setSyncedFromOwner(false), 3000);
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [barber?.id, loadSlots]);


  // Refetch when the tab regains focus — covers the case where the owner
  // edited while the barber's tab was in the background.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible" && !dirty.current) loadSlots();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [loadSlots]);

  function update(day: number, field: keyof DaySlot, value: string | boolean) {
    setSlots(prev => prev.map(s => s.day_of_week === day ? { ...s, [field]: value } : s));
    setSaved(false);
    dirty.current = true;
  }

  async function save() {
    if (!accessToken) return;
    // Validate: end time after start time for each active day
    for (const slot of slots) {
      if (slot.is_available && slot.start_time >= slot.end_time) {
        setSaved(false);
        alert(`${["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"][slot.day_of_week]}: closing time must be after opening time`);
        return;
      }
    }
    setSaving(true);
    const shopParam = shop?.id ? `?shop_id=${shop.id}` : "";
    await fetch(`/api/barber/availability${shopParam}`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ slots }),
    });
    setSaving(false);
    setSaved(true);
    dirty.current = false;
    setTimeout(() => setSaved(false), 3000);
  }

  if (loading) return (
    <div className="p-6 flex items-center justify-center min-h-64">
      <div className="w-8 h-8 border-2 border-gold/30 border-t-gold rounded-full animate-spin" />
    </div>
  );

  // Owner-controlled per-barber permission: when off, this page is read-only.
  const canEditSchedule = (barber?.permissions ?? DEFAULT_BARBER_PERMISSIONS).edit_schedule;

  return (
    <div className="p-6 max-w-2xl mx-auto">
      {syncedFromOwner && (
        <div className="mb-4 px-4 py-2.5 rounded-xl bg-blue-500/10 border border-blue-500/30 flex items-center gap-2 text-xs text-blue-200">
          <Clock size={14} className="text-blue-400" />
          Your shop owner just updated your schedule — these are the latest hours.
        </div>
      )}
      {!canEditSchedule && (
        <div className="mb-4 px-4 py-2.5 rounded-xl bg-orange-500/10 border border-orange-500/30 flex items-center gap-2 text-xs text-orange-200">
          <Lock size={14} className="text-orange-400" />
          Your shop owner manages your schedule. Contact them for any changes.
        </div>
      )}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Availability</h1>
          <p className="text-[#777] text-sm mt-0.5">
            {canEditSchedule ? "Set the hours you're available each day" : "View your current hours (read-only)"}
          </p>
        </div>
        <button
          onClick={save}
          disabled={saving || !canEditSchedule}
          className={cn(
            "flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all",
            saved
              ? "bg-green-500/20 text-green-400 border border-green-500/30"
              : "bg-gold text-black hover:bg-gold/90"
          )}
        >
          <Save size={15} />
          {saving ? "Saving..." : saved ? "Saved!" : "Save"}
        </button>
      </div>

      <div className="space-y-3">
        {slots.map(slot => (
          <div
            key={slot.day_of_week}
            className={cn(
              "bg-surface border rounded-2xl p-4 transition-all",
              slot.is_available ? "border-border" : "border-border opacity-60"
            )}
          >
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-3">
                <Switch
                  checked={!!slot.is_available}
                  disabled={!canEditSchedule}
                  onChange={v => canEditSchedule && update(slot.day_of_week, "is_available", v)}
                />
                <span className="font-semibold text-white">{DAYS[slot.day_of_week]}</span>
              </div>
              {!slot.is_available && (
                <span className="text-xs text-[#777] bg-surface-raised px-3 py-1 rounded-full">Closed</span>
              )}
            </div>

            {slot.is_available && (
              <div className="flex items-center gap-3 mt-2">
                <Clock size={14} className="text-gold flex-shrink-0" />
                <select
                  value={slot.start_time}
                  disabled={!canEditSchedule}
                  onChange={e => update(slot.day_of_week, "start_time", e.target.value)}
                  className="bg-surface-raised border border-border rounded-xl px-3 py-1.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-gold/50 disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {TIME_OPTIONS.map(t => <option key={t} value={t}>{fmt(t)}</option>)}
                </select>
                <span className="text-[#777] text-sm">to</span>
                <select
                  value={slot.end_time}
                  disabled={!canEditSchedule}
                  onChange={e => update(slot.day_of_week, "end_time", e.target.value)}
                  className="bg-surface-raised border border-border rounded-xl px-3 py-1.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-gold/50 disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {TIME_OPTIONS.filter(t => t > slot.start_time).map(t => <option key={t} value={t}>{fmt(t)}</option>)}
                </select>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
