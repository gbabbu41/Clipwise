"use client";
import { useEffect, useState, useCallback, useMemo } from "react";
import { Calendar, LogIn, LogOut } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { useBarber } from "@/lib/barber-context";
import { supabase } from "@/lib/supabase";
import { cn, formatCurrency, formatDateForDb, friendlyDate, timeToMinutes } from "@/lib/utils";
import { PaymentTag } from "@/components/payment-tag";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { CalendarView, ApptDetail, Portal, makeApptActions } from "@/components/calendar-view";
import type { AppointmentWithDetails } from "@/lib/database.types";
import Link from "next/link";

// Same duration helper the owner dashboard uses for its schedule rows.
const apptMins = (a: AppointmentWithDetails): number =>
  (a.duration_minutes && a.duration_minutes > 0)
    ? a.duration_minutes
    : ((a.services as { duration_minutes?: number } | null)?.duration_minutes ?? 30);

export default function BarberOverviewPage() {
  const { accessToken, profile } = useAuth();
  const { barber, shop, loading: barberLoading } = useBarber();
  // The owner (also a barber) gets every permission by default; a staff barber
  // gets only what the owner granted. Without manage_appointments the embedded
  // calendar + the schedule modal are read-only (view, no actions).
  const isOwner = profile?.role === "shop_owner";
  const canManage = isOwner || barber?.permissions?.manage_appointments === true;

  const [appointments, setAppointments] = useState<AppointmentWithDetails[]>([]);
  const [loading, setLoading] = useState(true);
  const [clockedIn, setClockedIn] = useState<{ id: string; clock_in: string } | null>(null);
  const [clockLoading, setClockLoading] = useState(false);
  const [toast, setToast] = useState("");
  const [selectedAppt, setSelectedAppt] = useState<AppointmentWithDetails | null>(null);
  const [detailBusy, setDetailBusy] = useState("");

  const showToast = useCallback((m: string) => { setToast(m); setTimeout(() => setToast(""), 3000); }, []);

  const today = new Date();
  const todayStr = formatDateForDb(today);
  const dayLabel = friendlyDate(today);

  // Check if already clocked in today
  useEffect(() => {
    if (!barber?.id || !shop?.id) return;
    supabase.from("staff_hours").select("id, clock_in")
      .eq("barber_id", barber.id).eq("date", todayStr).is("clock_out", null).maybeSingle()
      .then(({ data }) => { if (data) setClockedIn({ id: data.id, clock_in: data.clock_in }); });
  }, [barber?.id, shop?.id, todayStr]);

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

  // Today's appointments for THIS barber, in the full shape the shared
  // appointment modal needs (services + barber relations, payment fields).
  const loadAppointments = useCallback(async () => {
    if (!shop?.id || !barber?.id) { setLoading(false); return; }
    const { data } = await supabase
      .from("appointments")
      .select("*, services(name, duration_minutes), barbers(name)")
      .eq("shop_id", shop.id).eq("barber_id", barber.id).eq("date", todayStr)
      .order("time_slot");
    setAppointments((data ?? []) as AppointmentWithDetails[]);
    setLoading(false);
  }, [shop?.id, barber?.id, todayStr]);
  useEffect(() => { loadAppointments(); }, [loadAppointments]);

  const upcoming = appointments.filter(a => a.status !== "completed" && a.status !== "cancelled" && a.status !== "no-show");
  const completed = appointments.filter(a => a.status === "completed");
  const todayEarnings = completed.reduce((s, a) => s + (a.total_amount ?? 0), 0);

  // Shared appointment actions (approve / complete / charge / cash / send-link /
  // reject) — the exact same logic the owner dashboard + calendar run.
  const patchAppt = useCallback((id: string, p: Partial<AppointmentWithDetails>) => {
    setAppointments(prev => prev.map(a => (a.id === id ? { ...a, ...p } as AppointmentWithDetails : a)));
    setSelectedAppt(prev => (prev && prev.id === id ? { ...prev, ...p } as AppointmentWithDetails : prev));
  }, []);
  const apptActions = useMemo(
    () => makeApptActions({ shop: shop ?? null, accessToken, patch: patchAppt, setBusy: setDetailBusy, toast: showToast, onDone: () => { setSelectedAppt(null); loadAppointments(); } }),
    [shop, accessToken, patchAppt, showToast, loadAppointments],
  );

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
          {/* Desktop bell + avatar — shown only at lg+ where the mobile top
              bar (which carries its own avatar) is hidden, so they never double. */}
          <Link
            href="/barber-dashboard/profile"
            aria-label="Account"
            className="hidden lg:inline-flex w-9 h-9 rounded-full bg-white text-black font-extrabold text-[11px] items-center justify-center hover:opacity-90 transition-opacity ml-1"
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
      <div className="mb-6">
        <h2 className="text-sm font-semibold text-[#777] uppercase tracking-wider mb-3">My Calendar</h2>
        <div className="h-[70vh] min-h-[520px] rounded-2xl overflow-hidden border border-[#1e1e1e]">
          <CalendarView embedded canManage={canManage} forceBarberId={barber?.id} canBlock={isOwner || barber?.permissions?.block_hours !== false} />
        </div>
      </div>

      {/* Today's Schedule — exact replica of the owner dashboard's card
          (clickable rows → the shared appointment modal with actions), scoped
          to this barber's appointments. */}
      <Card className="!bg-[#141414]">
        <CardHeader>
          <CardTitle>Today&apos;s Schedule</CardTitle>
          <Link href="/barber-dashboard/calendar" className="text-xs text-white hover:underline">View all</Link>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-3">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="animate-pulse bg-[#141414] rounded-xl h-14" />)}</div>
          ) : appointments.length === 0 ? (
            <div className="py-8 text-center text-[#777]">
              <Calendar size={32} className="mx-auto mb-2 opacity-30" />
              <p>No appointments today</p>
            </div>
          ) : (
            [...appointments]
              .sort((x, y) => timeToMinutes(x.time_slot ?? "") - timeToMinutes(y.time_slot ?? ""))
              .map((apt) => {
                const dimmed = apt.status === "cancelled" || apt.status === "no-show";
                const mins = apptMins(apt);
                const [hh, mer] = (apt.time_slot ?? "").split(" ");
                return (
                  <button key={apt.id} onClick={() => setSelectedAppt(apt)}
                    className="w-full text-left flex items-center gap-3 py-3 border-b border-[#1e1e1e] last:border-0 hover:bg-white/[0.02] transition-colors">
                    <div className="text-center min-w-[52px]">
                      <p className="text-xs text-white font-medium">{hh}</p>
                      <p className="text-[10px] text-[#777]">{mer}</p>
                    </div>
                    <div className="w-px h-10 bg-[#1e1e1e]" />
                    <div className="flex-1 min-w-0">
                      <p className={cn("text-sm font-medium text-white truncate", dimmed && "line-through opacity-60")}>{apt.client_name}</p>
                      <p className="text-xs text-[#777] truncate">
                        {(apt.services as { name?: string } | null)?.name ?? "Service"}{mins ? ` · ${mins} min` : ""}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-1 flex-shrink-0">
                      <span className="text-sm font-semibold text-white">{formatCurrency(apt.total_amount)}</span>
                      <PaymentTag appt={apt} />
                    </div>
                  </button>
                );
              })
          )}
        </CardContent>
      </Card>

      {/* Shared appointment detail + actions (read-only without manage_appointments) */}
      {selectedAppt && (
        <Portal>
          <ApptDetail
            appt={selectedAppt}
            barbers={[]}
            onClose={() => setSelectedAppt(null)}
            actions={apptActions}
            busy={detailBusy}
            readOnly={!canManage}
          />
        </Portal>
      )}
    </div>
  );
}
