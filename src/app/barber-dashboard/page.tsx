"use client";
import { useEffect, useState } from "react";
import { Calendar, Clock, DollarSign, Star, ChevronRight, User, LogIn, LogOut } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { useBarber } from "@/lib/barber-context";
import { supabase } from "@/lib/supabase";
import { cn, formatDateForDb, friendlyDate } from "@/lib/utils";
import { PaymentTag } from "@/components/payment-tag";
import { Button } from "@/components/ui/button";
import { CalendarView } from "@/components/calendar-view";
import Link from "next/link";

interface Appointment {
  id: string;
  client_name: string;
  client_phone: string;
  time_slot: string;
  status: string;
  total_amount: number;
  payment_status?: string;
  payment_method?: string;
  stripe_checkout_session_id?: string | null;
  notes?: string;
  services?: { name: string; duration_minutes: number };
}

export default function BarberOverviewPage() {
  const { accessToken, profile } = useAuth();
  const { barber, shop, loading: barberLoading } = useBarber();
  // The owner (also a barber) gets every permission by default; a staff barber
  // gets only what the owner granted. Without manage_appointments the embedded
  // calendar is read-only.
  const isOwner = profile?.role === "shop_owner";
  const canManage = isOwner || barber?.permissions?.manage_appointments === true;
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [clockedIn, setClockedIn] = useState<{ id: string; clock_in: string } | null>(null);
  const [clockLoading, setClockLoading] = useState(false);
  const [toast, setToast] = useState("");

  const showToast = (m: string) => { setToast(m); setTimeout(() => setToast(""), 3000); };

  // Check if already clocked in today
  useEffect(() => {
    if (!barber?.id || !shop?.id) return;
    const today = formatDateForDb(new Date());
    supabase.from("staff_hours").select("id, clock_in")
      .eq("barber_id", barber.id).eq("date", today).is("clock_out", null).maybeSingle()
      .then(({ data }) => { if (data) setClockedIn({ id: data.id, clock_in: data.clock_in }); });
  }, [barber?.id, shop?.id]);

  const handleClockIn = async () => {
    if (!barber?.id || !shop?.id) return;
    setClockLoading(true);
    const now = new Date();
    const { data } = await supabase.from("staff_hours").insert({
      barber_id: barber.id,
      shop_id: shop.id,
      date: formatDateForDb(now),
      clock_in: now.toTimeString().slice(0, 5),
    }).select("id, clock_in").single();
    if (data) { setClockedIn({ id: data.id, clock_in: data.clock_in }); showToast("Clocked in!"); }
    setClockLoading(false);
  };

  const handleClockOut = async () => {
    if (!clockedIn) return;
    setClockLoading(true);
    const now = new Date();
    const outStr = now.toTimeString().slice(0, 5);
    const [inH, inM] = clockedIn.clock_in.split(":").map(Number);
    const hours = Math.round(((now.getHours() * 60 + now.getMinutes()) - (inH * 60 + inM)) / 60 * 100) / 100;
    await supabase.from("staff_hours").update({ clock_out: outStr, hours_worked: hours }).eq("id", clockedIn.id);
    setClockedIn(null);
    showToast(`Clocked out · ${hours}h worked today`);
    setClockLoading(false);
  };

  const today = new Date();
  const todayStr = today.toISOString().split("T")[0];
  const greeting = today.getHours() < 12 ? "Good morning" : today.getHours() < 17 ? "Good afternoon" : "Good evening";
  const dayLabel = friendlyDate(today);

  useEffect(() => {
    if (!accessToken) return;
    const shopParam = shop?.id ? `&shop_id=${shop.id}` : "";
    fetch(`/api/barber/appointments?date=${todayStr}${shopParam}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
      .then(r => r.json())
      .then(({ appointments: a }) => setAppointments(a ?? []))
      .finally(() => setLoading(false));
  }, [accessToken, todayStr, shop?.id]);

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
      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-[100] bg-surface-raised border border-border rounded-xl px-5 py-3 text-sm text-white shadow-xl">
          <span className="text-gold">✓</span> {toast}
        </div>
      )}

      {/* Header — muted greeting + clock chip + desktop bell + avatar */}
      <div className="mb-6 flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-bold text-white tracking-tight truncate">My Day</h1>
          <p className="text-[#777] text-sm mt-1">{dayLabel}</p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0 pt-1">
          {clockedIn && (
            <span className="text-xs text-emerald-400 font-medium hidden sm:flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              Clocked in {clockedIn.clock_in}
            </span>
          )}
          {clockedIn ? (
            <Button variant="danger" size="sm" loading={clockLoading} onClick={handleClockOut}>
              <LogOut size={14} /> Clock Out
            </Button>
          ) : (
            <Button size="sm" loading={clockLoading} onClick={handleClockIn}>
              <LogIn size={14} /> Clock In
            </Button>
          )}
          {/* Desktop bell + avatar — mobile has them in the barber top bar */}
          <Link
            href="/barber-dashboard/profile"
            aria-label="Account"
            className="hidden md:inline-flex w-9 h-9 rounded-full bg-white text-black font-extrabold text-[11px] items-center justify-center hover:opacity-90 transition-opacity ml-1"
          >
            {(barber?.name ?? "U").charAt(0).toUpperCase()}
          </Link>
        </div>
      </div>

      {/* Stats — same v2 treatment as the owner dashboard:
            uppercase grey label, 28px DM Mono value, colored sub indicator
            (green = up / positive, red = down / warning, grey = neutral). */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
        {(() => {
          type Tone = "muted" | "up" | "down";
          const stats: { label: string; value: string; sub: string; tone: Tone }[] = [
            {
              label: "Today's Appts",
              value: String(appointments.length),
              sub: `${upcoming.length} upcoming`,
              tone: "muted",
            },
            {
              label: "Completed",
              value: String(completed.length),
              sub: completed.length > 0 ? "↑ Today" : "today",
              tone: completed.length > 0 ? "up" : "muted",
            },
            {
              label: "Today's Earnings",
              value: `$${todayEarnings.toFixed(0)}`,
              sub: todayEarnings > 0 ? "↑ From completed" : "From completed",
              tone: todayEarnings > 0 ? "up" : "muted",
            },
            {
              label: "Rating",
              value: barber?.rating ? barber.rating.toFixed(1) : "—",
              sub: `${barber?.total_reviews ?? 0} reviews`,
              tone: "muted",
            },
          ];
          return stats.map(stat => (
            <div key={stat.label} className="bg-[#0c0c0c] border border-[#1e1e1e] rounded-2xl p-4">
              <p className="text-[10px] text-[#777] font-semibold uppercase tracking-wider">{stat.label}</p>
              <p className="text-[28px] font-extrabold text-white mt-2 font-mono tracking-tighter leading-none">{stat.value}</p>
              <p className={cn(
                "text-[11px] mt-2 font-medium",
                stat.tone === "up"    && "text-emerald-400",
                stat.tone === "down"  && "text-red-400",
                stat.tone === "muted" && "text-[#777]",
              )}>{stat.sub}</p>
            </div>
          ));
        })()}
      </div>

      {/* Calendar — the same embedded calendar as the owner portal, scoped to
          you. Read-only unless the owner granted "manage appointments". */}
      <div className="mb-8">
        <h2 className="text-sm font-semibold text-[#777] uppercase tracking-wider mb-3">My Calendar</h2>
        <div className="h-[70vh] min-h-[520px] rounded-2xl overflow-hidden border border-[#1e1e1e]">
          <CalendarView embedded canManage={canManage} forceBarberId={barber?.id} />
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Next appointment */}
        <div className="lg:col-span-1">
          <h2 className="text-sm font-semibold text-[#777] uppercase tracking-wider mb-3">Next Up</h2>
          {nextAppt ? (
            <div className="bg-surface border border-gold/20 rounded-2xl p-5">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-full bg-gold/20 border border-gold/30 flex items-center justify-center text-gold font-semibold">
                  {nextAppt.client_name.charAt(0)}
                </div>
                <div>
                  <p className="font-semibold text-white">{nextAppt.client_name}</p>
                  <p className="text-xs text-[#777]">{nextAppt.client_phone}</p>
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
                <p className="mt-3 text-xs text-[#777] bg-surface-raised rounded-lg px-3 py-2">{nextAppt.notes}</p>
              )}
            </div>
          ) : (
            <div className="bg-surface border border-border rounded-2xl p-5 text-center">
              <Calendar size={32} className="text-[#777] mx-auto mb-3" />
              <p className="text-sm text-[#777]">No more appointments today</p>
              <p className="text-xs text-[#777] mt-1">All clear! ✓</p>
            </div>
          )}

          <Link
            href="/barber-dashboard/schedule"
            className="flex items-center justify-between mt-3 px-4 py-3 bg-surface border border-border rounded-xl text-sm text-[#777] hover:text-white hover:border-gold/30 transition-all"
          >
            <span>View full schedule</span>
            <ChevronRight size={16} />
          </Link>
        </div>

        {/* Today's schedule */}
        <div className="lg:col-span-2">
          <h2 className="text-sm font-semibold text-[#777] uppercase tracking-wider mb-3">Today's Schedule</h2>
          {loading ? (
            <div className="space-y-3">
              {[1,2,3].map(i => <div key={i} className="bg-surface border border-border rounded-xl h-16 animate-pulse" />)}
            </div>
          ) : appointments.length === 0 ? (
            <div className="bg-surface border border-border rounded-2xl p-8 text-center">
              <Calendar size={40} className="text-[#777] mx-auto mb-3" />
              <p className="text-[#777]">No appointments today</p>
              <p className="text-xs text-[#777] mt-1">Enjoy your day off!</p>
            </div>
          ) : (
            <div className="space-y-2">
              {appointments.map(appt => {
                const dimmed = appt.status === "cancelled" || appt.status === "no-show";
                const mins = appt.services?.duration_minutes;
                return (
                  <div key={appt.id} className="bg-surface border border-border rounded-xl px-4 py-3 flex items-center gap-3">
                    <div className="text-center min-w-[52px]">
                      <p className="text-sm font-semibold text-white">{appt.time_slot.split(" ")[0]}</p>
                      <p className="text-xs text-[#777]">{appt.time_slot.split(" ")[1]}</p>
                    </div>
                    <div className="w-px h-10 bg-border" />
                    <div className="flex-1 min-w-0">
                      <p className={cn("text-sm font-medium text-white truncate", dimmed && "line-through opacity-60")}>{appt.client_name}</p>
                      <p className="text-xs text-[#777] truncate">{appt.services?.name ?? "Service"}{mins ? ` · ${mins} min` : ""}</p>
                    </div>
                    <div className="flex flex-col items-end gap-1 flex-shrink-0">
                      <span className="text-sm font-semibold text-white">${appt.total_amount}</span>
                      <PaymentTag appt={appt} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
