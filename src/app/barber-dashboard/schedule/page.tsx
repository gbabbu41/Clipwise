"use client";
import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Calendar } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { useBarber } from "@/lib/barber-context";
import { cn } from "@/lib/utils";

interface Appointment {
  id: string;
  client_name: string;
  time_slot: string;
  status: string;
  total_amount: number;
  date: string;
  services?: { name: string; duration_minutes: number };
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const STATUS_STYLES: Record<string, string> = {
  confirmed: "bg-green-500/15 text-green-400 border-green-500/30",
  pending: "bg-yellow-500/15 text-yellow-400 border-yellow-500/30",
  completed: "bg-gray-500/15 text-gray-400 border-gray-500/30",
  cancelled: "bg-red-500/15 text-red-400 border-red-500/30",
  "no-show": "bg-red-500/15 text-red-400 border-red-500/30",
};

function getWeekDates(offset = 0) {
  const now = new Date();
  const day = now.getDay();
  const start = new Date(now);
  start.setDate(now.getDate() - day + offset * 7);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });
}

export default function BarberSchedulePage() {
  const { accessToken } = useAuth();
  const { shop } = useBarber();
  const [weekOffset, setWeekOffset] = useState(0);
  const [selectedDay, setSelectedDay] = useState(new Date().getDay());
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);

  const weekDates = getWeekDates(weekOffset);
  const from = weekDates[0].toISOString().split("T")[0];
  const to = weekDates[6].toISOString().split("T")[0];

  useEffect(() => {
    if (!accessToken) return;
    setLoading(true);
    const shopParam = shop?.id ? `&shop_id=${shop.id}` : "";
    fetch(`/api/barber/appointments?from=${from}&to=${to}${shopParam}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
      .then(r => r.json())
      .then(({ appointments: a }) => setAppointments(a ?? []))
      .finally(() => setLoading(false));
  }, [accessToken, from, to, shop?.id]);

  const selectedDate = weekDates[selectedDay];
  const selectedDateStr = selectedDate.toISOString().split("T")[0];
  const dayAppts = appointments.filter(a => a.date === selectedDateStr);

  const monthLabel = weekDates[0].toLocaleDateString("en-CA", { month: "long", year: "numeric" });

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">My Schedule</h1>
          <p className="text-gray-500 text-sm mt-0.5">{monthLabel}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setWeekOffset(w => w - 1)}
            className="p-2 rounded-xl bg-surface border border-border hover:border-gold/30 text-gray-400 hover:text-white transition-all"
          >
            <ChevronLeft size={18} />
          </button>
          <button
            onClick={() => { setWeekOffset(0); setSelectedDay(new Date().getDay()); }}
            className="px-3 py-1.5 text-sm text-gold border border-gold/30 rounded-xl hover:bg-gold/10 transition-all"
          >
            Today
          </button>
          <button
            onClick={() => setWeekOffset(w => w + 1)}
            className="p-2 rounded-xl bg-surface border border-border hover:border-gold/30 text-gray-400 hover:text-white transition-all"
          >
            <ChevronRight size={18} />
          </button>
        </div>
      </div>

      {/* Week day tabs */}
      <div className="grid grid-cols-7 gap-1 mb-6 bg-surface border border-border rounded-2xl p-2">
        {weekDates.map((date, i) => {
          const dateStr = date.toISOString().split("T")[0];
          const count = appointments.filter(a => a.date === dateStr).length;
          const isToday = dateStr === new Date().toISOString().split("T")[0];
          const isSelected = i === selectedDay;
          return (
            <button
              key={i}
              onClick={() => setSelectedDay(i)}
              className={cn(
                "flex flex-col items-center py-2.5 rounded-xl transition-all",
                isSelected ? "bg-gold/15 border border-gold/20" : "hover:bg-surface-raised"
              )}
            >
              <span className={cn("text-xs font-medium", isSelected ? "text-gold" : "text-gray-500")}>{DAYS[i]}</span>
              <span className={cn("text-lg font-bold mt-0.5", isSelected ? "text-gold" : isToday ? "text-white" : "text-gray-300")}>
                {date.getDate()}
              </span>
              {count > 0 && (
                <span className={cn("w-1.5 h-1.5 rounded-full mt-1", isSelected ? "bg-gold" : "bg-gray-600")} />
              )}
            </button>
          );
        })}
      </div>

      {/* Day appointments */}
      <div>
        <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">
          {selectedDate.toLocaleDateString("en-CA", { weekday: "long", month: "long", day: "numeric" })}
          <span className="ml-2 text-gray-600 normal-case">({dayAppts.length} appointment{dayAppts.length !== 1 ? "s" : ""})</span>
        </h2>

        {loading ? (
          <div className="space-y-3">
            {[1,2,3].map(i => <div key={i} className="bg-surface border border-border rounded-xl h-20 animate-pulse" />)}
          </div>
        ) : dayAppts.length === 0 ? (
          <div className="bg-surface border border-border rounded-2xl p-10 text-center">
            <Calendar size={40} className="text-gray-700 mx-auto mb-3" />
            <p className="text-gray-400">No appointments this day</p>
          </div>
        ) : (
          <div className="space-y-3">
            {dayAppts.map(appt => (
              <div key={appt.id} className="bg-surface border border-border rounded-xl p-4 flex items-center gap-4">
                <div className="text-center min-w-[56px]">
                  <p className="text-sm font-bold text-white">{appt.time_slot.split(" ")[0]}</p>
                  <p className="text-xs text-gray-500">{appt.time_slot.split(" ")[1]}</p>
                </div>
                <div className="w-px h-10 bg-border" />
                <div className="w-9 h-9 rounded-full bg-gold/15 border border-gold/20 flex items-center justify-center text-gold font-semibold text-sm flex-shrink-0">
                  {appt.client_name.charAt(0)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-white">{appt.client_name}</p>
                  <p className="text-sm text-gray-500">
                    {appt.services?.name ?? "Service"}
                    {appt.services?.duration_minutes ? ` · ${appt.services.duration_minutes}min` : ""}
                  </p>
                </div>
                <div className="text-right">
                  <span className={`text-xs px-2 py-1 rounded-full border capitalize block mb-1 ${STATUS_STYLES[appt.status] ?? STATUS_STYLES.pending}`}>
                    {appt.status}
                  </span>
                  <p className="text-sm font-medium text-gold">${appt.total_amount}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
