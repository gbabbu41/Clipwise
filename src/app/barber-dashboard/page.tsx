"use client";
import { useEffect, useState } from "react";
import { Calendar, Clock, DollarSign, Star, ChevronRight, User } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { useBarber } from "@/lib/barber-context";
import Link from "next/link";

interface Appointment {
  id: string;
  client_name: string;
  client_phone: string;
  time_slot: string;
  status: string;
  total_amount: number;
  notes?: string;
  services?: { name: string; duration_minutes: number };
}

const STATUS_STYLES: Record<string, string> = {
  confirmed: "bg-green-500/15 text-green-400 border-green-500/30",
  pending: "bg-yellow-500/15 text-yellow-400 border-yellow-500/30",
  completed: "bg-gray-500/15 text-gray-400 border-gray-500/30",
  cancelled: "bg-red-500/15 text-red-400 border-red-500/30",
  "no-show": "bg-red-500/15 text-red-400 border-red-500/30",
};

export default function BarberOverviewPage() {
  const { accessToken } = useAuth();
  const { barber, loading: barberLoading } = useBarber();
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);

  const today = new Date();
  const todayStr = today.toISOString().split("T")[0];
  const greeting = today.getHours() < 12 ? "Good morning" : today.getHours() < 17 ? "Good afternoon" : "Good evening";
  const dayLabel = today.toLocaleDateString("en-CA", { weekday: "long", year: "numeric", month: "long", day: "numeric" });

  useEffect(() => {
    if (!accessToken) return;
    fetch(`/api/barber/appointments?date=${todayStr}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
      .then(r => r.json())
      .then(({ appointments: a }) => setAppointments(a ?? []))
      .finally(() => setLoading(false));
  }, [accessToken, todayStr]);

  const upcoming = appointments.filter(a => a.status !== "completed" && a.status !== "cancelled" && a.status !== "no-show");
  const completed = appointments.filter(a => a.status === "completed");
  const todayEarnings = completed.reduce((s, a) => s + (a.total_amount ?? 0), 0);
  const nextAppt = upcoming[0] ?? null;

  if (barberLoading) return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-gold/30 border-t-gold rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="p-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white">{greeting}, {barber?.name?.split(" ")[0] ?? "there"} ✂️</h1>
        <p className="text-gray-500 text-sm mt-1">{dayLabel}</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {[
          { label: "Today's Appts", value: appointments.length, icon: Calendar, sub: `${upcoming.length} upcoming` },
          { label: "Completed", value: completed.length, icon: Clock, sub: "today" },
          { label: "Today's Earnings", value: `$${todayEarnings.toFixed(0)}`, icon: DollarSign, sub: "from completed" },
          { label: "Rating", value: barber?.rating ? barber.rating.toFixed(1) : "—", icon: Star, sub: `${barber?.total_reviews ?? 0} reviews` },
        ].map(stat => (
          <div key={stat.label} className="bg-surface border border-border rounded-2xl p-4">
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs text-gray-500">{stat.label}</p>
              <stat.icon size={16} className="text-gold" />
            </div>
            <p className="text-2xl font-bold text-white">{stat.value}</p>
            <p className="text-xs text-gray-600 mt-1">{stat.sub}</p>
          </div>
        ))}
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Next appointment */}
        <div className="lg:col-span-1">
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">Next Up</h2>
          {nextAppt ? (
            <div className="bg-surface border border-gold/20 rounded-2xl p-5">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-full bg-gold/20 border border-gold/30 flex items-center justify-center text-gold font-semibold">
                  {nextAppt.client_name.charAt(0)}
                </div>
                <div>
                  <p className="font-semibold text-white">{nextAppt.client_name}</p>
                  <p className="text-xs text-gray-500">{nextAppt.client_phone}</p>
                </div>
              </div>
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm text-gray-300">
                  <Clock size={14} className="text-gold" />
                  <span>{nextAppt.time_slot}</span>
                </div>
                {nextAppt.services && (
                  <div className="flex items-center gap-2 text-sm text-gray-300">
                    <User size={14} className="text-gold" />
                    <span>{nextAppt.services.name} · {nextAppt.services.duration_minutes}min</span>
                  </div>
                )}
                <div className="flex items-center gap-2 text-sm text-gray-300">
                  <DollarSign size={14} className="text-gold" />
                  <span>${nextAppt.total_amount}</span>
                </div>
              </div>
              {nextAppt.notes && (
                <p className="mt-3 text-xs text-gray-500 bg-surface-raised rounded-lg px-3 py-2">{nextAppt.notes}</p>
              )}
            </div>
          ) : (
            <div className="bg-surface border border-border rounded-2xl p-5 text-center">
              <Calendar size={32} className="text-gray-700 mx-auto mb-3" />
              <p className="text-sm text-gray-400">No more appointments today</p>
              <p className="text-xs text-gray-600 mt-1">All clear! ✓</p>
            </div>
          )}

          <Link
            href="/barber-dashboard/schedule"
            className="flex items-center justify-between mt-3 px-4 py-3 bg-surface border border-border rounded-xl text-sm text-gray-400 hover:text-white hover:border-gold/30 transition-all"
          >
            <span>View full schedule</span>
            <ChevronRight size={16} />
          </Link>
        </div>

        {/* Today's schedule */}
        <div className="lg:col-span-2">
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">Today's Schedule</h2>
          {loading ? (
            <div className="space-y-3">
              {[1,2,3].map(i => <div key={i} className="bg-surface border border-border rounded-xl h-16 animate-pulse" />)}
            </div>
          ) : appointments.length === 0 ? (
            <div className="bg-surface border border-border rounded-2xl p-8 text-center">
              <Calendar size={40} className="text-gray-700 mx-auto mb-3" />
              <p className="text-gray-400">No appointments today</p>
              <p className="text-xs text-gray-600 mt-1">Enjoy your day off!</p>
            </div>
          ) : (
            <div className="space-y-2">
              {appointments.map(appt => (
                <div key={appt.id} className="bg-surface border border-border rounded-xl px-4 py-3 flex items-center gap-4">
                  <div className="text-center min-w-[52px]">
                    <p className="text-sm font-semibold text-white">{appt.time_slot.split(" ")[0]}</p>
                    <p className="text-xs text-gray-500">{appt.time_slot.split(" ")[1]}</p>
                  </div>
                  <div className="w-px h-8 bg-border" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-white">{appt.client_name}</p>
                    <p className="text-xs text-gray-500">{appt.services?.name ?? "Service"}</p>
                  </div>
                  <span className={`text-xs px-2 py-1 rounded-full border capitalize ${STATUS_STYLES[appt.status] ?? STATUS_STYLES.pending}`}>
                    {appt.status}
                  </span>
                  <p className="text-sm font-medium text-gold">${appt.total_amount}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
