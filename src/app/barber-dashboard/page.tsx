"use client";
import { useEffect, useState, useCallback, useMemo } from "react";
import { Calendar, Bell } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { useBarber } from "@/lib/barber-context";
import { supabase } from "@/lib/supabase";
import { cn, formatCurrency, formatDateForDb, timeToMinutes, plural } from "@/lib/utils";
import { PaymentTag } from "@/components/payment-tag";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { ApptDetail, Portal, makeApptActions } from "@/components/calendar-view";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { ProfileMenu, barberMenuItems } from "@/components/profile-menu";
import { UnreadBadge } from "@/components/notification-badge";
import { useShopUnreadCount } from "@/hooks/use-unread-count";
import { shareLink } from "@/lib/share";
import type { AppointmentWithDetails } from "@/lib/database.types";
import Link from "next/link";

// Same duration helper the owner dashboard uses for its schedule rows.
const apptMins = (a: AppointmentWithDetails): number =>
  (a.duration_minutes && a.duration_minutes > 0)
    ? a.duration_minutes
    : ((a.services as { duration_minutes?: number } | null)?.duration_minutes ?? 30);

// The 7 days (Sun→Sat) of the current week + the hour-gutter label — the same
// compact week calendar the owner dashboard uses.
function currentWeekDays(): Date[] {
  const t = new Date(); t.setHours(0, 0, 0, 0);
  const start = new Date(t); start.setDate(t.getDate() - t.getDay());
  return Array.from({ length: 7 }, (_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return d; });
}
const hourLabel = (h: number) => h === 0 ? "12a" : h < 12 ? `${h}a` : h === 12 ? "12p" : `${h - 12}p`;

export default function BarberOverviewPage() {
  const { accessToken, profile } = useAuth();
  const { barber, shop, loading: barberLoading } = useBarber();
  const unreadCount = useShopUnreadCount(profile?.id, shop?.id);
  // The owner (also a barber) gets every permission by default; a staff barber
  // gets only what the owner granted. Without manage_appointments the embedded
  // calendar + the schedule modal are read-only (view, no actions).
  const isOwner = profile?.role === "shop_owner";
  const canManage = isOwner || barber?.permissions?.manage_appointments === true;

  const [appointments, setAppointments] = useState<AppointmentWithDetails[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState("");
  const [selectedAppt, setSelectedAppt] = useState<AppointmentWithDetails | null>(null);
  const [detailBusy, setDetailBusy] = useState("");

  const showToast = useCallback((m: string) => { setToast(m); setTimeout(() => setToast(""), 3000); }, []);

  // Share this barber's PERSONAL booking link (books only them). Reused by the
  // big button below and the account-menu "Share my link" item.
  const shareMyLink = useCallback(() => {
    if (!shop?.slug || !barber?.id) return;
    void shareLink(
      `${window.location.origin}/book/${shop.slug}?barber=${barber.id}`,
      `Book with ${barber.name ?? "me"}`,
      (r) => { if (r === "copied") showToast("Booking link copied — share it anywhere!"); else if (r === "failed") showToast("Couldn't copy the link."); },
    );
  }, [shop?.slug, barber?.id, barber?.name, showToast]);

  const today = new Date();
  const todayStr = formatDateForDb(today);

  // Clock-in/out moved to the shop's check-in station (owner side) — barbers no
  // longer self-clock from their phone. (Biometric check-in lands there next.)

  // Today's appointments for THIS barber, in the full shape the shared
  // appointment modal needs (services + barber relations, payment fields).
  const loadAppointments = useCallback(async () => {
    if (!shop?.id || !barber?.id) { setLoading(false); return; }
    const { data, error } = await supabase
      .from("appointments")
      .select("*, services(name, duration_minutes), barbers(name)")
      .eq("shop_id", shop.id).eq("barber_id", barber.id).eq("date", todayStr)
      .order("time_slot");
    if (error) showToast("Couldn't load today's schedule — please refresh.");
    setAppointments((data ?? []) as AppointmentWithDetails[]);
    setLoading(false);
  }, [shop?.id, barber?.id, todayStr, showToast]);
  useEffect(() => { loadAppointments(); }, [loadAppointments]);

  // The whole current week's appointments (this barber) — for the compact
  // week calendar, independent of the "today" schedule below.
  const [weekAppts, setWeekAppts] = useState<AppointmentWithDetails[]>([]);
  useEffect(() => {
    if (!shop?.id || !barber?.id) return;
    const days = currentWeekDays();
    (async () => {
      const { data } = await supabase
        .from("appointments")
        .select("*, services(name, duration_minutes), barbers(name)")
        .eq("shop_id", shop.id).eq("barber_id", barber.id)
        .gte("date", formatDateForDb(days[0])).lte("date", formatDateForDb(days[6]))
        .order("time_slot");
      setWeekAppts((data ?? []) as AppointmentWithDetails[]);
    })();
  }, [shop?.id, barber?.id]);

  const upcoming = appointments.filter(a => a.status !== "completed" && a.status !== "cancelled" && a.status !== "no-show");
  const completed = appointments.filter(a => a.status === "completed");
  const todayEarnings = completed.reduce((s, a) => s + (a.total_amount ?? 0), 0);

  // Shared appointment actions (approve / complete / charge / cash / send-link /
  // reject) — the exact same logic the owner dashboard + calendar run.
  const patchAppt = useCallback((id: string, p: Partial<AppointmentWithDetails>) => {
    setAppointments(prev => prev.map(a => (a.id === id ? { ...a, ...p } as AppointmentWithDetails : a)));
    setSelectedAppt(prev => (prev && prev.id === id ? { ...prev, ...p } as AppointmentWithDetails : prev));
  }, []);
  const { confirm } = useConfirm();
  const apptActions = useMemo(
    () => makeApptActions({ shop: shop ?? null, accessToken, patch: patchAppt, setBusy: setDetailBusy, toast: showToast, onDone: () => { setSelectedAppt(null); loadAppointments(); }, confirm: (m) => confirm({ message: m }) }),
    [shop, accessToken, patchAppt, showToast, loadAppointments, confirm],
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
        <div className="fixed bottom-6 right-6 z-[100] bg-surface-raised border border-border rounded-xl px-5 py-3 text-sm text-foreground shadow-xl">
          <span className="text-gold">✓</span> {toast}
        </div>
      )}

      {/* Header — greeting + context line + desktop bell + avatar (matches the
          owner dashboard). */}
      <div className="mb-6 flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          {/* Greeting sits under the bar's "HOME" title on mobile, so it's a
              touch smaller there; stays prominent on desktop (no top bar). */}
          <h1 className="text-xl lg:text-2xl font-bold text-foreground tracking-tight truncate">
            {barber?.name ? `Hi, ${barber.name.split(" ")[0]}` : "Hi"}
          </h1>
          <p className="text-grey text-sm mt-1 truncate">
            {new Date().toLocaleDateString("en-CA", { weekday: "long", month: "short", day: "numeric" })} · {appointments.length} appointment{appointments.length !== 1 ? "s" : ""} today
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0 pt-1">
          {/* Desktop bell + avatar — only at lg+ where the mobile top bar
              (which carries its own avatar) is hidden, so they never double. */}
          <Link
            href="/barber-dashboard/notifications"
            aria-label="Notifications"
            className="relative hidden lg:inline-flex w-[38px] h-[38px] rounded-full items-center justify-center bg-card border border-border text-foreground hover:border-white/30 transition-colors"
          >
            <Bell size={15} />
            <UnreadBadge count={unreadCount} />
          </Link>
          <ProfileMenu
            name={barber?.name ?? "Account"}
            photo={barber?.photo}
            roleLabel={isOwner ? "Owner · Barber" : "Barber"}
            items={barberMenuItems(barber?.permissions?.view_earnings === true, shop?.slug && barber?.id ? shareMyLink : undefined)}
            className="hidden lg:block"
            triggerClassName="w-[38px] h-[38px] rounded-full bg-white text-black font-extrabold text-[11px] inline-flex items-center justify-center hover:opacity-90 transition-opacity overflow-hidden"
          />
        </div>
      </div>

      {/* Share my personal booking link — books ONLY me (customers see only me). */}
      {shop?.slug && barber?.id && (
        <button
          type="button"
          onClick={shareMyLink}
          className="w-full mb-6 flex items-center justify-center gap-2 py-3 rounded-2xl border border-border bg-card text-foreground text-sm font-semibold hover:border-gray-500 transition-colors"
        >
          🔗 Share my booking link
        </button>
      )}

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
              sub: plural(barber?.total_reviews ?? 0, "review"),
              tone: "muted",
            },
          ];
          return stats.map(stat => (
            <div key={stat.label} className="bg-card border border-border rounded-2xl p-4">
              <p className="text-[10px] text-grey font-semibold uppercase tracking-wider">{stat.label}</p>
              <p className="text-[28px] font-extrabold text-foreground mt-2 font-mono tracking-tighter leading-none">{stat.value}</p>
              <p className={cn(
                "text-[11px] mt-2 font-medium",
                stat.tone === "up"    && "text-emerald-400",
                stat.tone === "down"  && "text-red-400",
                stat.tone === "muted" && "text-grey",
              )}>{stat.sub}</p>
            </div>
          ));
        })()}
      </div>

      {/* Compact week calendar — the week at a glance, scoped to you; tap to
          open the full Calendar tab. Same block as the owner dashboard. */}
      <div className="mb-6">
        {(() => {
          const weekDays = currentWeekDays();
          const todayKey = formatDateForDb(new Date());
          const hrs = weekAppts
            .map(a => { const m = timeToMinutes(a.time_slot ?? ""); return m > 0 ? Math.floor(m / 60) : -1; })
            .filter(h => h >= 0);
          const minH = hrs.length ? Math.min(...hrs) : 9;
          const maxH = hrs.length ? Math.max(...hrs) : 17;
          const calHours = Array.from({ length: Math.max(1, maxH - minH + 1) }, (_, i) => minH + i);
          const cols = { gridTemplateColumns: "44px repeat(7, 1fr)" };
          return (
            <Link href="/barber-dashboard/calendar" className="block bg-card border border-border rounded-2xl overflow-hidden hover:border-white/15 transition-colors">
              <div className="flex items-center justify-between px-3.5 py-3 border-b border-border">
                <p className="text-sm font-bold text-foreground">{new Date().toLocaleDateString("en-CA", { month: "long", year: "numeric" })}</p>
                {/* The whole card links to the full calendar — an honest hint,
                    not a fake Day/Week/Month switcher that did nothing. */}
                <span className="text-[11px] font-medium text-grey">Open calendar →</span>
              </div>
              <div className="overflow-x-auto">
                <div className="min-w-[620px]">
                  <div className="grid" style={cols}>
                    <div className="border-b border-border" />
                    {weekDays.map(d => {
                      const isToday = formatDateForDb(d) === todayKey;
                      return (
                        <div key={formatDateForDb(d)} className="text-center py-2 border-b border-border">
                          <p className={cn("text-[10px] uppercase tracking-wide", isToday ? "text-accent-soft font-bold" : "text-grey-muted")}>{d.toLocaleDateString("en-CA", { weekday: "short" })}</p>
                          <span className={cn("inline-flex items-center justify-center text-sm mt-0.5", isToday ? "w-6 h-6 rounded-full bg-accent text-foreground font-bold" : "text-foreground")}>{d.getDate()}</span>
                        </div>
                      );
                    })}
                  </div>
                  {calHours.map(h => (
                    <div key={h} className="grid" style={cols}>
                      <div className="text-[9.5px] text-grey-muted text-right pr-1.5 pt-1 border-r border-border">{hourLabel(h)}</div>
                      {weekDays.map(d => {
                        const dk = formatDateForDb(d);
                        const isToday = dk === todayKey;
                        const evs = weekAppts.filter(a => a.date === dk && a.status !== "cancelled" && Math.floor(timeToMinutes(a.time_slot ?? "") / 60) === h);
                        return (
                          <div key={dk} className={cn("border-r border-b border-border min-h-[34px] p-0.5 space-y-0.5", isToday && "bg-accent-muted")}>
                            {evs.map(a => {
                              const pend = a.status === "pending";
                              return (
                                <div key={a.id} className={cn("rounded text-[9.5px] px-1.5 py-0.5 leading-tight truncate border-l-2", pend ? "border-amber-500 bg-amber-500/[0.12] text-amber-200" : "border-[#00e5a0] bg-emerald-500/[0.12] text-emerald-100")}>
                                  {((a.services as { name?: string } | null)?.name ?? "Service")} · {(a.client_name ?? "—").split(" ")[0]}
                                </div>
                              );
                            })}
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </div>
              </div>
            </Link>
          );
        })()}
      </div>

      {/* Today's Schedule — exact replica of the owner dashboard's card
          (clickable rows → the shared appointment modal with actions), scoped
          to this barber's appointments. */}
      <Card>
        <CardHeader>
          <CardTitle>Today&apos;s Schedule</CardTitle>
          <Link href="/barber-dashboard/calendar" className="text-xs text-foreground hover:underline">View all</Link>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-3">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="animate-pulse bg-card-raised rounded-xl h-14" />)}</div>
          ) : appointments.length === 0 ? (
            <div className="py-8 text-center text-grey">
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
                    className="w-full text-left flex items-center gap-3 py-3 border-b border-border last:border-0 hover:bg-white/[0.02] transition-colors">
                    <div className="text-center min-w-[52px]">
                      <p className="text-xs text-foreground font-medium">{hh}</p>
                      <p className="text-[10px] text-grey">{mer}</p>
                    </div>
                    <div className="w-px h-10 bg-[#1e1e1e]" />
                    <div className="flex-1 min-w-0">
                      <p className={cn("text-sm font-medium text-foreground truncate", dimmed && "line-through opacity-60")}>{apt.client_name}</p>
                      <p className="text-xs text-grey truncate">
                        {(apt.services as { name?: string } | null)?.name ?? "Service"}{mins ? ` · ${mins} min` : ""}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-1 flex-shrink-0">
                      <span className="text-sm font-semibold text-foreground">{formatCurrency(apt.total_amount)}</span>
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
            tz={(shop as { timezone?: string } | null)?.timezone}
            noShowFeePercent={(shop?.booking_settings as { no_show_fee_percent?: number } | null)?.no_show_fee_percent}
          />
        </Portal>
      )}
    </div>
  );
}
