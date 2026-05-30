"use client";
import { useEffect, useState } from "react";
import { Save, Clock } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { useBarber } from "@/lib/barber-context";
import { cn } from "@/lib/utils";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const TIME_OPTIONS = [
  "06:00", "06:30", "07:00", "07:30", "08:00", "08:30", "09:00", "09:30",
  "10:00", "10:30", "11:00", "11:30", "12:00", "12:30", "13:00", "13:30",
  "14:00", "14:30", "15:00", "15:30", "16:00", "16:30", "17:00", "17:30",
  "18:00", "18:30", "19:00", "19:30", "20:00", "20:30", "21:00",
];

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
  const { shop } = useBarber();
  const [slots, setSlots] = useState<DaySlot[]>(DEFAULT_SLOTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!accessToken) return;
    const shopParam = shop?.id ? `?shop_id=${shop.id}` : "";
    fetch(`/api/barber/availability${shopParam}`, { headers: { Authorization: `Bearer ${accessToken}` } })
      .then(r => r.json())
      .then(({ slots: s }) => {
        if (!s || s.length === 0) return;
        setSlots(prev => prev.map(d => {
          const found = s.find((x: DaySlot) => x.day_of_week === d.day_of_week);
          return found ? { ...d, ...found } : d;
        }));
      })
      .finally(() => setLoading(false));
  }, [accessToken, shop?.id]);

  function update(day: number, field: keyof DaySlot, value: string | boolean) {
    setSlots(prev => prev.map(s => s.day_of_week === day ? { ...s, [field]: value } : s));
    setSaved(false);
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
    setTimeout(() => setSaved(false), 3000);
  }

  if (loading) return (
    <div className="p-6 flex items-center justify-center min-h-64">
      <div className="w-8 h-8 border-2 border-gold/30 border-t-gold rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Availability</h1>
          <p className="text-gray-500 text-sm mt-0.5">Set the hours you're available each day</p>
        </div>
        <button
          onClick={save}
          disabled={saving}
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
                <button
                  onClick={() => update(slot.day_of_week, "is_available", !slot.is_available)}
                  className={cn(
                    "relative w-10 h-5 rounded-full transition-colors",
                    slot.is_available ? "bg-gold" : "bg-gray-700"
                  )}
                >
                  <span className={cn(
                    "absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform shadow-sm",
                    slot.is_available ? "translate-x-5" : "translate-x-0"
                  )} />
                </button>
                <span className="font-semibold text-white">{DAYS[slot.day_of_week]}</span>
              </div>
              {!slot.is_available && (
                <span className="text-xs text-gray-500 bg-surface-raised px-3 py-1 rounded-full">Closed</span>
              )}
            </div>

            {slot.is_available && (
              <div className="flex items-center gap-3 mt-2">
                <Clock size={14} className="text-gold flex-shrink-0" />
                <select
                  value={slot.start_time}
                  onChange={e => update(slot.day_of_week, "start_time", e.target.value)}
                  className="bg-surface-raised border border-border rounded-xl px-3 py-1.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-gold/50"
                >
                  {TIME_OPTIONS.map(t => <option key={t} value={t}>{fmt(t)}</option>)}
                </select>
                <span className="text-gray-500 text-sm">to</span>
                <select
                  value={slot.end_time}
                  onChange={e => update(slot.day_of_week, "end_time", e.target.value)}
                  className="bg-surface-raised border border-border rounded-xl px-3 py-1.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-gold/50"
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
