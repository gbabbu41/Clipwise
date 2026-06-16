"use client";
import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, X, Plus, Users } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/lib/supabase";
import {
  cn, formatDateForDb, friendlyDate, timeAgo,
  getSlotsInRange, occupiedSlots, dbTimeToDisplay, timeToMinutes, generate24hSlots,
} from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import {
  sendApprovalNotifications,
  runCompletionEffects,
  notifyFreedSlot,
  sendRejectionEmail,
} from "@/lib/appointment-actions";
import type { AppointmentWithDetails, Barber } from "@/lib/database.types";

type ServiceLite = { id: string; name: string; price: number; duration_minutes: number };

// ── Time helpers ─────────────────────────────────────────────────────────────
const HOURS_24 = Array.from({ length: 24 }, (_, i) => i);
const ROW_PX = 56;                     // height of one hour row
const DEFAULT_SCROLL_HOUR = 8;         // where week/day views land on open

// Block length (minutes) for an appointment. Multi-service bookings carry their
// combined length on the row (duration_minutes); single-service rows fall back
// to the linked service's duration.
function apptDuration(a: AppointmentWithDetails): number {
  if (a.duration_minutes && a.duration_minutes > 0) return a.duration_minutes;
  return (a.services as { duration_minutes?: number } | null)?.duration_minutes ?? 30;
}

function parseTime(timeStr: string): number {
  const [time, period] = timeStr.split(" ");
  const [h, m] = time.split(":").map(Number);
  let hour = h;
  if (period === "PM" && h !== 12) hour += 12;
  if (period === "AM" && h === 12) hour = 0;
  return hour + m / 60;
}

// DB time "09:00:00" → decimal hours (9.0). Used to bound the day grid.
function hourOfDb(db: string): number {
  const [h, m] = db.split(":").map(Number);
  return (h || 0) + (m || 0) / 60;
}

function addDays(date: Date, n: number) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

function addMonths(date: Date, n: number) {
  const d = new Date(date);
  d.setMonth(d.getMonth() + n);
  return d;
}

function startOfWeek(date: Date) {
  const d = new Date(date);
  d.setDate(d.getDate() - d.getDay());
  return d;
}

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function endOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0);
}

const isToday = (date: Date) => formatDateForDb(date) === formatDateForDb(new Date());
const isSameMonth = (a: Date, b: Date) => a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear();

// Up-to-two-letter initials for the day-view column avatars.
const initials = (name?: string | null) =>
  (name ?? "?").trim().split(/\s+/).map(w => w[0]).slice(0, 2).join("").toUpperCase() || "?";

// ── Barber palette ───────────────────────────────────────────────────────────
// Colored avatar/dot per barber so "who is doing what" reads at a glance.
const BARBER_DOT_PALETTE = [
  "bg-sky-400", "bg-emerald-400", "bg-violet-400", "bg-rose-400",
  "bg-orange-400", "bg-cyan-400", "bg-fuchsia-400", "bg-lime-400",
];

// ── Status palettes ──────────────────────────────────────────────────────────
// The calendar canvas is LIGHT (Fresha-style), so appointment blocks use a pale
// fill + a colored left edge + dark text. Identity by status: booked / pending /
// completed / cancelled read at a glance.
const STATUS_BLOCK: Record<string, string> = {
  pending:   "bg-amber-50 text-amber-900 border-l-4 border-amber-400",
  confirmed: "bg-emerald-50 text-emerald-900 border-l-4 border-emerald-400",
  completed: "bg-sky-50 text-sky-900 border-l-4 border-sky-400",
  cancelled: "bg-rose-50 text-rose-800 border-l-4 border-rose-300",
  "no-show": "bg-zinc-100 text-zinc-600 border-l-4 border-zinc-400",
};
// Compact month-view chips (no left edge — too chunky in a small cell).
const STATUS_CHIP: Record<string, string> = {
  pending:   "bg-amber-100 text-amber-800",
  confirmed: "bg-emerald-100 text-emerald-800",
  completed: "bg-sky-100 text-sky-800",
  cancelled: "bg-rose-100 text-rose-700",
  "no-show": "bg-zinc-100 text-zinc-600",
};
// Saturated fill — used only by the DARK agenda side-sheet chip below.
const STATUS_FILL: Record<string, string> = {
  pending:   "bg-amber-500/85 text-white",
  confirmed: "bg-emerald-500/85 text-white",
  completed: "bg-sky-500/85 text-white",
  cancelled: "bg-red-500/70 text-white",
  "no-show": "bg-zinc-500/70 text-white",
};
const STATUS_DOT: Record<string, string> = {
  pending: "bg-amber-400", confirmed: "bg-emerald-400", completed: "bg-sky-400",
  cancelled: "bg-red-400", "no-show": "bg-zinc-400",
};
const STATUS_LABEL: Record<string, string> = {
  pending: "Pending", confirmed: "Booked", completed: "Completed",
  cancelled: "Cancelled", "no-show": "No-show",
};
const statusBlock = (s: string) => STATUS_BLOCK[s] ?? "bg-sky-50 text-sky-900 border-l-4 border-sky-400";
const statusChip = (s: string) => STATUS_CHIP[s] ?? "bg-sky-100 text-sky-800";
const statusFill = (s: string) => STATUS_FILL[s] ?? "bg-sky-500/85 text-white";
const statusDot = (s: string) => STATUS_DOT[s] ?? "bg-sky-400";
const statusLabel = (s: string) => STATUS_LABEL[s] ?? s;
const isDimmed = (s: string) => s === "cancelled" || s === "no-show";

// Shared action handlers, wired up by CalendarPage. Mirrors the Appointments
// page so Approve / Complete / Reject behave identically from either surface.
type ApptActions = {
  approve: (a: AppointmentWithDetails) => void;
  complete: (a: AppointmentWithDetails) => void;        // paid / zero-amount / skip-unpaid
  captureComplete: (a: AppointmentWithDetails) => void; // held / saved card → auto-charge
  cashComplete: (a: AppointmentWithDetails) => void;    // record cash + complete
  sendLink: (a: AppointmentWithDetails, email: string) => void;
  reject: (a: AppointmentWithDetails) => void;
};

// ── Appointment detail modal (DARK overlay — intentional over the light canvas) ─
function ApptDetail({ appt, barbers, onClose, actions, busy }: {
  appt: AppointmentWithDetails;
  barbers: Barber[];
  onClose: () => void;
  actions: ApptActions;
  busy: string;
}) {
  const barber = barbers.find(b => b.id === appt.barber_id);
  const [payChoice, setPayChoice] = useState(false);
  const [payEmail, setPayEmail] = useState(appt.client_email ?? "");
  const duration = apptDuration(appt);
  const paid = appt.payment_status === "paid" || appt.payment_status === "captured";
  const heldOrSaved = appt.payment_status === "held" || appt.payment_status === "saved";

  // "Complete" is context-aware: held/saved cards auto-charge; already-paid /
  // zero-amount complete straight through; otherwise we reveal payment choices.
  const onComplete = () => {
    if (heldOrSaved) { actions.captureComplete(appt); return; }
    if (paid || (appt.total_amount ?? 0) <= 0) { actions.complete(appt); return; }
    setPayChoice(true);
  };

  return (
    <>
      <div className="fixed inset-0 bg-black/60 z-40" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="bg-black shadow-sm border border-[#1e1e1e] rounded-2xl p-6 w-full max-w-sm space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-bold text-white">{appt.client_name}</h3>
            <button onClick={onClose} className="text-[#777] hover:text-white"><X size={18} /></button>
          </div>
          <Badge variant={
            appt.status === "confirmed" ? "success" :
            appt.status === "completed" ? "info" :
            appt.status === "cancelled" ? "danger" : "warning"
          } className="capitalize">{appt.status}</Badge>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between py-1.5 border-b border-[#1e1e1e]/50">
              <span className="text-[#777]">Service</span>
              <span className="text-white">{(appt.services as { name: string } | null)?.name ?? "—"}</span>
            </div>
            <div className="flex justify-between py-1.5 border-b border-[#1e1e1e]/50">
              <span className="text-[#777]">Barber</span>
              <span className="text-white">{barber?.name ?? "Any"}</span>
            </div>
            <div className="flex justify-between py-1.5 border-b border-[#1e1e1e]/50">
              <span className="text-[#777]">Time</span>
              <span className="text-white">{appt.time_slot}{duration ? ` · ${duration} min` : ""}</span>
            </div>
            <div className="flex justify-between gap-3 py-1.5 border-b border-[#1e1e1e]/50">
              <span className="text-[#777] flex-shrink-0">Email</span>
              <span className="text-white truncate text-right">{appt.client_email || "—"}</span>
            </div>
            <div className="flex justify-between py-1.5 border-b border-[#1e1e1e]/50">
              <span className="text-[#777]">Phone</span>
              <span className="text-white">{appt.client_phone || "—"}</span>
            </div>
            <div className="flex justify-between py-1.5">
              <span className="text-[#777]">Total</span>
              <span className="text-white font-semibold">${Number(appt.total_amount).toFixed(2)}</span>
            </div>
            {paid && (
              <div className="flex justify-between py-1.5 border-t border-[#1e1e1e]/50">
                <span className="text-[#777]">Payment</span>
                <span className="text-[#00e5a0] font-medium">
                  Paid{appt.paid_at ? ` · ${timeAgo(appt.paid_at)}` : ""}
                </span>
              </div>
            )}
          </div>
          {appt.notes && (
            <div className="bg-[#141414] rounded-xl p-3 text-xs text-[#777]">{appt.notes}</div>
          )}

          {/* Actions — same set as the Appointments page, kept compact. */}
          {payChoice ? (
            <div className="space-y-2 pt-1 border-t border-[#1e1e1e]">
              <p className="text-xs text-[#777]">How was this paid?</p>
              <input
                type="email"
                value={payEmail}
                onChange={e => setPayEmail(e.target.value)}
                placeholder="Customer email (for the link)"
                className="w-full bg-[#141414] border border-[#1e1e1e] rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-gold/50"
              />
              <div className="grid grid-cols-2 gap-2">
                <Button size="sm" variant="outline" disabled={!!busy} onClick={() => actions.cashComplete(appt)}>
                  {busy === "cash" ? "…" : "Cash · Complete"}
                </Button>
                <Button size="sm" variant="outline" disabled={!!busy} onClick={() => actions.sendLink(appt, payEmail.trim())}>
                  {busy === "link" ? "…" : "Send link"}
                </Button>
              </div>
              <Button size="sm" variant="ghost" className="w-full" disabled={!!busy} onClick={() => actions.complete(appt)}>
                {busy === "complete" ? "Completing…" : "Skip · Complete unpaid"}
              </Button>
            </div>
          ) : (appt.status === "pending" || appt.status === "confirmed") ? (
            <div className="flex gap-2 pt-1 border-t border-[#1e1e1e]">
              {appt.status === "pending" && (
                <Button size="sm" className="flex-1" disabled={!!busy} onClick={() => actions.approve(appt)}>
                  {busy === "approve" ? "…" : "Approve"}
                </Button>
              )}
              {appt.status === "confirmed" && (
                <Button size="sm" className="flex-1" disabled={!!busy} onClick={onComplete}>
                  {busy === "complete" || busy === "capture" ? "…" : "Complete"}
                </Button>
              )}
              <Button size="sm" variant="outline" className="flex-1" disabled={!!busy} onClick={() => actions.reject(appt)}>
                {busy === "reject" ? "…" : "Reject"}
              </Button>
            </div>
          ) : null}
        </div>
      </div>
    </>
  );
}

// ── Day agenda side sheet (DARK overlay — intentional over the light canvas) ──
function AgendaSheet({
  date,
  appts,
  barbers,
  onClose,
  onOpenAppt,
  onDrillToDay,
}: {
  date: Date;
  appts: AppointmentWithDetails[];
  barbers: Barber[];
  onClose: () => void;
  onOpenAppt: (a: AppointmentWithDetails) => void;
  onDrillToDay: () => void;
}) {
  const dayLabel = friendlyDate(date);
  return (
    <>
      <div className="fixed inset-0 bg-black/60 z-40" onClick={onClose} />
      <div className="fixed right-0 top-0 bottom-0 w-full sm:w-[420px] bg-black shadow-sm border-l border-[#1e1e1e] z-50 flex flex-col animate-fade-in">
        <div className="p-5 border-b border-[#1e1e1e] flex items-center justify-between">
          <div>
            <p className="text-xs text-[#777]">{date.toLocaleDateString("en-CA", { year: "numeric" })}</p>
            <h3 className="text-lg font-bold text-white">{dayLabel}</h3>
            <p className="text-xs text-[#777] mt-0.5">{appts.length} {appts.length === 1 ? "appointment" : "appointments"}</p>
          </div>
          <button onClick={onClose} className="text-[#777] hover:text-white"><X size={20} /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {appts.length === 0 && (
            <div className="text-center py-12 text-[#777] text-sm">No bookings on this day.</div>
          )}
          {appts.map(appt => {
            const barber = barbers.find(b => b.id === appt.barber_id);
            return (
              <button key={appt.id} onClick={() => onOpenAppt(appt)}
                className="w-full text-left p-3 rounded-xl bg-[#141414] hover:bg-[#141414]/80 transition-colors flex items-start gap-3">
                <span className={cn("w-2 h-2 rounded-full mt-1.5 flex-shrink-0", statusDot(appt.status))} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className={cn("text-sm font-semibold text-white truncate", isDimmed(appt.status) && "line-through opacity-60")}>
                      {appt.client_name}
                    </p>
                    <span className="text-xs text-[#777] flex-shrink-0">{appt.time_slot}</span>
                  </div>
                  <p className="text-xs text-[#777] truncate">
                    {(appt.services as { name: string } | null)?.name ?? "—"} · {barber?.name ?? "Any"}
                  </p>
                  {appt.client_email && (
                    <p className="text-xs text-[#777] truncate">{appt.client_email}</p>
                  )}
                  <span className={cn("inline-block mt-1 text-[10px] font-medium px-1.5 py-0.5 rounded text-white", statusFill(appt.status).split(" ")[0])}>
                    {statusLabel(appt.status)}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
        <div className="p-4 border-t border-[#1e1e1e]">
          <button onClick={onDrillToDay}
            className="w-full py-2.5 rounded-xl bg-white/10 hover:bg-white/15 text-white text-sm font-medium transition-colors">
            Open day view
          </button>
        </div>
      </div>
    </>
  );
}

export default function CalendarPage() {
  const { shop, profile, accessToken } = useAuth();
  const [view, setView] = useState<"month" | "week" | "day">("day");
  const [barberFilter, setBarberFilter] = useState<string>("all"); // owner: filter calendar to one barber
  const [currentDate, setCurrentDate] = useState(new Date());
  const [appointments, setAppointments] = useState<AppointmentWithDetails[]>([]);
  const [barbers, setBarbers] = useState<Barber[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedAppt, setSelectedAppt] = useState<AppointmentWithDetails | null>(null);
  const [agendaDate, setAgendaDate] = useState<Date | null>(null);
  const [myBarberId, setMyBarberId] = useState<string | null>(null);
  const [isMobile, setIsMobile] = useState(false);
  const [actionBusy, setActionBusy] = useState("");
  const [toast, setToast] = useState("");
  // Day-view working hours (per barber, for the current weekday) + services for
  // the quick-add modal, and the "+" empty-slot add context/form.
  const [schedules, setSchedules] = useState<Map<string, { start: string; end: string }>>(new Map());
  const [services, setServices] = useState<ServiceLite[]>([]);
  const [addCtx, setAddCtx] = useState<{ barberId: string; barberName: string; time: string } | null>(null);
  const [addForm, setAddForm] = useState({ client_name: "", client_phone: "", service_id: "", time: "" });
  const [savingAdd, setSavingAdd] = useState(false);
  const [dateMenu, setDateMenu] = useState(false);
  const [viewMenu, setViewMenu] = useState(false);
  // Barber-column pagination for the all-barbers day view (arrows / swipe).
  const [colPage, setColPage] = useState(0);
  const [colWrapW, setColWrapW] = useState(0);
  const colWrapRef = useRef<HTMLDivElement>(null);
  const touchStartX = useRef<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 639px)");
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (!profile || profile.role !== "barber" || !shop) return;
    supabase.from("barbers").select("id").eq("user_id", profile.id).eq("shop_id", shop.id).maybeSingle()
      .then(({ data }) => { if (data) setMyBarberId(data.id); });
  }, [profile, shop]);

  const load = useCallback(async () => {
    if (!shop) { setLoading(false); return; }
    setLoading(true);

    let rangeStart: Date, rangeEnd: Date;
    if (view === "month") {
      const monthStart = startOfMonth(currentDate);
      rangeStart = addDays(monthStart, -monthStart.getDay()); // back to Sunday
      rangeEnd = addDays(rangeStart, 41);                     // 6 weeks
    } else if (view === "week") {
      rangeStart = startOfWeek(currentDate);
      rangeEnd = addDays(rangeStart, 6);
    } else {
      rangeStart = currentDate;
      rangeEnd = currentDate;
    }

    let q = supabase
      .from("appointments")
      .select("*, barbers(id, name), services(id, name, price, duration_minutes, category)")
      .eq("shop_id", shop.id)
      .gte("date", formatDateForDb(rangeStart))
      .lte("date", formatDateForDb(rangeEnd))
      .order("time_slot");

    if (profile?.role === "barber" && myBarberId) {
      q = q.eq("barber_id", myBarberId);
    } else if (barberFilter !== "all") {
      // Owner filtered the calendar to a single barber
      q = q.eq("barber_id", barberFilter);
    }

    const [{ data: appts }, { data: bs }] = await Promise.all([
      q,
      supabase.from("barbers").select("*").eq("shop_id", shop.id).eq("is_active", true).order("name"),
    ]);

    setAppointments((appts ?? []) as AppointmentWithDetails[]);
    setBarbers((bs ?? []) as Barber[]);
    setLoading(false);
  }, [shop, currentDate, view, profile, myBarberId, barberFilter]);

  useEffect(() => { load(); }, [load]);

  // Working hours for the current day's weekday, per barber — drives the day
  // view's working-window bounds + empty-slot generation. Authenticated owner /
  // barber can read time_slots under RLS; barbers with no row fall back to 9–6.
  useEffect(() => {
    if (!shop || barbers.length === 0) { setSchedules(new Map()); return; }
    const dow = currentDate.getDay();
    const ids = barbers.map(b => b.id);
    let active = true;
    supabase.from("time_slots").select("barber_id, start_time, end_time")
      .in("barber_id", ids).eq("day_of_week", dow).eq("is_available", true)
      .then(({ data }) => {
        if (!active) return;
        const m = new Map<string, { start: string; end: string }>();
        (data ?? []).forEach(s => m.set(s.barber_id as string, { start: s.start_time as string, end: s.end_time as string }));
        setSchedules(m);
      });
    return () => { active = false; };
  }, [shop, barbers, currentDate]);

  // Services for the quick-add modal (rarely change → fetch once per shop).
  useEffect(() => {
    if (!shop) return;
    supabase.from("services").select("id, name, price, duration_minutes")
      .eq("shop_id", shop.id).eq("is_active", true).order("name")
      .then(({ data }) => setServices((data ?? []) as ServiceLite[]));
  }, [shop]);

  // Catch up on payment-link payments (status may flip pending→confirmed too),
  // so the calendar reflects paid/confirmed without depending on the webhook.
  useEffect(() => {
    if (!accessToken) return;
    let active = true;
    fetch("/api/stripe/reconcile-payments", { method: "POST", headers: { Authorization: `Bearer ${accessToken}` } })
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (active && d?.updated > 0) load(); })
      .catch(() => {});
    return () => { active = false; };
  }, [accessToken, load]);

  // Week view starts at 8 AM; the day view is now bounded to working hours so
  // it starts at the top.
  useEffect(() => {
    if (!scrollRef.current) return;
    if (view === "week") scrollRef.current.scrollTop = DEFAULT_SCROLL_HOUR * ROW_PX;
    else if (view === "day") scrollRef.current.scrollTop = 0;
  }, [view]);

  // Measure the day-columns area so we can page however many barber columns fit.
  useEffect(() => {
    const el = colWrapRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(entries => setColWrapW(entries[0].contentRect.width));
    ro.observe(el);
    setColWrapW(el.getBoundingClientRect().width);
    return () => ro.disconnect();
  }, [view, barberFilter, isMobile]);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(""), 3500);
  }, []);

  // Patch one appointment in both the grid list and the open detail card.
  const applyLocal = useCallback((id: string, patch: Partial<AppointmentWithDetails>) => {
    setAppointments(prev => prev.map(a => (a.id === id ? { ...a, ...patch } as AppointmentWithDetails : a)));
    setSelectedAppt(prev => (prev && prev.id === id ? { ...prev, ...patch } as AppointmentWithDetails : prev));
  }, []);

  // Appointment actions — same behavior as the Appointments page (Approve /
  // Complete / Reject), so the calendar detail card stays in sync.
  const apptActions: ApptActions = useMemo(() => ({
    approve: async (appt) => {
      if (!shop) return;
      setActionBusy("approve");
      const { error } = await supabase.from("appointments").update({ status: "confirmed" }).eq("id", appt.id);
      setActionBusy("");
      if (error) { showToast(`Update failed: ${error.message}`); return; }
      applyLocal(appt.id, { status: "confirmed" });
      sendApprovalNotifications(appt, shop);
      showToast("Approved · Customer notified");
    },
    complete: async (appt) => {
      if (!shop) return;
      setActionBusy("complete");
      const { error } = await supabase.from("appointments").update({ status: "completed" }).eq("id", appt.id);
      if (error) { setActionBusy(""); showToast(`Update failed: ${error.message}`); return; }
      applyLocal(appt.id, { status: "completed" });
      await runCompletionEffects(supabase, appt, shop, accessToken);
      setActionBusy("");
      setSelectedAppt(null);
      showToast("Marked complete");
    },
    captureComplete: async (appt) => {
      if (!shop || !accessToken) return;
      setActionBusy("capture");
      showToast(appt.payment_status === "saved" ? "Charging saved card…" : "Charging held card…");
      const res = await fetch("/api/stripe/capture-appointment", {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ appointment_id: appt.id, reason: "completed" }),
      });
      const data = await res.json().catch(() => ({ ok: false, error: "Network error" }));
      if (!data.ok) { setActionBusy(""); showToast(`Charge failed: ${data.error ?? "try again"}`); return; }
      await supabase.from("appointments").update({ status: "completed" }).eq("id", appt.id);
      applyLocal(appt.id, { status: "completed", payment_status: "captured", paid_at: new Date().toISOString() });
      await runCompletionEffects(supabase, { ...appt, payment_status: "captured" }, shop, accessToken);
      setActionBusy("");
      setSelectedAppt(null);
      showToast(`Charged · Completed`);
    },
    cashComplete: async (appt) => {
      if (!shop) return;
      setActionBusy("cash");
      const patch = { payment_status: "paid" as const, payment_method: "cash" as const, status: "completed" as const, paid_at: new Date().toISOString() };
      const { error } = await supabase.from("appointments").update(patch).eq("id", appt.id);
      if (error) { setActionBusy(""); showToast(`Failed: ${error.message}`); return; }
      applyLocal(appt.id, patch);
      await runCompletionEffects(supabase, appt, shop, accessToken);
      setActionBusy("");
      setSelectedAppt(null);
      showToast("Cash recorded · Completed");
    },
    sendLink: async (appt, email) => {
      if (!shop || !accessToken) return;
      setActionBusy("link");
      const willEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
      // The route persists the email via the service-role client + sends it,
      // so we don't risk an RLS-blocked client update swallowing the link.
      if (willEmail && email !== (appt.client_email ?? "")) applyLocal(appt.id, { client_email: email });
      const res = await fetch("/api/stripe/payment-link", {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ appointment_id: appt.id, send_email: willEmail, email: willEmail ? email : undefined }),
      });
      const data = await res.json().catch(() => ({}));
      setActionBusy("");
      if (!res.ok) { showToast(`Failed: ${data.error ?? "try again"}`); return; }
      if (data.emailed) { showToast("Payment link emailed to customer"); }
      else if (data.url) {
        try { await navigator.clipboard.writeText(data.url); showToast("Payment link copied to clipboard"); }
        catch { showToast("Payment link ready"); }
      } else { showToast("Payment link ready"); }
    },
    reject: async (appt) => {
      if (!shop) return;
      const wasPaid = !!(appt.payment_intent_id && appt.payment_status === "captured");
      if (typeof window !== "undefined" && !window.confirm(`Reject this appointment? The customer will be notified${wasPaid ? " and refunded." : "."}`)) return;
      setActionBusy("reject");
      if (wasPaid && accessToken) {
        const refundRes = await fetch("/api/stripe/refund", {
          method: "POST",
          headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
          body: JSON.stringify({ appointment_id: appt.id }),
        }).catch(() => null);
        if (refundRes?.ok) {
          applyLocal(appt.id, { status: "cancelled", payment_status: "refunded" });
          notifyFreedSlot(appt, shop, "Cancelled");
          setActionBusy(""); setSelectedAppt(null);
          showToast("Rejected · Refund issued");
          return;
        }
      }
      const { error } = await supabase.from("appointments").update({ status: "cancelled" }).eq("id", appt.id);
      setActionBusy("");
      if (error) { showToast(`Failed: ${error.message}`); return; }
      applyLocal(appt.id, { status: "cancelled" });
      sendRejectionEmail(appt, shop, "");
      notifyFreedSlot(appt, shop, "Cancelled");
      setSelectedAppt(null);
      showToast("Rejected" + (appt.client_email ? " · Email sent" : ""));
    },
  }), [shop, accessToken, applyLocal, showToast]);

  // Empty "+" slots are shown every 30 min; a booking can still be added on a
  // 15-min offset via the add modal's time picker.
  const EMPTY_STEP = 30;
  const ADD_STEP = 15;

  // Display-slots a barber's live appointments cover on the given day, at the
  // requested step. Cancelled/no-show are ignored so their times read as free.
  const bookedSlotsFor = useCallback((barberId: string, dateStr: string, step: number = EMPTY_STEP) => {
    const set = new Set<string>();
    appointments.forEach(a => {
      if (a.date === dateStr && a.barber_id === barberId && !isDimmed(a.status)) {
        occupiedSlots(a.time_slot, apptDuration(a), step).forEach(s => set.add(s));
      }
    });
    return set;
  }, [appointments]);

  // Open 30-min slots in a barber's window (not booked). Unlike getSlotsInRange
  // this does NOT drop past times — the owner still wants to SEE the empty boxes
  // (and can log a walk-in into one). Window-bounded only.
  const windowEmpties = useCallback((barberId: string, dateStr: string, win: { start: string; end: string }) => {
    const startMins = timeToMinutes(dbTimeToDisplay(win.start));
    const endMins = timeToMinutes(dbTimeToDisplay(win.end));
    if (Number.isNaN(startMins) || Number.isNaN(endMins) || endMins <= startMins) return [] as string[];
    const booked = bookedSlotsFor(barberId, dateStr);
    return generate24hSlots(EMPTY_STEP).filter(slot => {
      const m = timeToMinutes(slot);
      return m >= startMins && m + EMPTY_STEP <= endMins && !booked.has(slot);
    });
  }, [bookedSlotsFor]);

  // "9:00 AM" + 45 → "9:00 AM – 9:45 AM"
  const rangeLabel = (start: string, mins: number) => {
    const endMin = timeToMinutes(start) + (mins > 0 ? mins : EMPTY_STEP);
    const h = Math.floor(endMin / 60) % 24, m = endMin % 60;
    const end = dbTimeToDisplay(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00`);
    return `${start} – ${end}`;
  };

  // Lay overlapping appointments side-by-side: each gets a lane index + the
  // number of lanes in its overlap cluster, so widths split evenly.
  const layoutColumn = (appts: AppointmentWithDetails[]) => {
    const items = appts
      .map(a => ({ a, start: parseTime(a.time_slot) * 60, end: parseTime(a.time_slot) * 60 + apptDuration(a), lane: 0, lanes: 1 }))
      .sort((x, y) => x.start - y.start || x.end - y.end);
    const out: typeof items = [];
    let cluster: typeof items = [];
    let clusterEnd = -1;
    const flush = () => {
      const laneEnds: number[] = [];
      cluster.forEach(it => {
        let placed = false;
        for (let l = 0; l < laneEnds.length; l++) {
          if (laneEnds[l] <= it.start) { laneEnds[l] = it.end; it.lane = l; placed = true; break; }
        }
        if (!placed) { it.lane = laneEnds.length; laneEnds.push(it.end); }
      });
      cluster.forEach(it => { it.lanes = laneEnds.length; out.push(it); });
      cluster = [];
    };
    items.forEach(it => {
      if (cluster.length && it.start >= clusterEnd) { flush(); clusterEnd = -1; }
      cluster.push(it);
      clusterEnd = cluster.length === 1 ? it.end : Math.max(clusterEnd, it.end);
    });
    flush();
    return out;
  };

  // Barber profile pic with initials fallback.
  const BarberAvatar = ({ b, i }: { b: Barber; i: number }) => {
    const cls = "w-11 h-11 rounded-full object-cover";
    if (b.photo) return <img src={b.photo} alt={b.name} className={cls} />;
    return (
      <span className={cn("w-11 h-11 rounded-full flex items-center justify-center text-sm font-bold text-white", BARBER_DOT_PALETTE[i % BARBER_DOT_PALETTE.length])}>
        {initials(b.name)}
      </span>
    );
  };

  // True when a time is unavailable for a barber — either they have no schedule
  // set at all (whole day unavailable), or the time is outside their hours.
  const isOutsideSchedule = (barberId: string, time: string) => {
    const s = schedules.get(barberId);
    if (!s) return true;            // no schedule set → unavailable
    if (!time) return false;
    const m = timeToMinutes(time);
    return m < timeToMinutes(dbTimeToDisplay(s.start)) || m >= timeToMinutes(dbTimeToDisplay(s.end));
  };

  // Open the quick-add modal pre-filled for a slot.
  const openAdd = (barberId: string, barberName: string, time: string) => {
    setAddForm({ client_name: "", client_phone: "", service_id: "", time });
    setAddCtx({ barberId, barberName, time });
  };

  // Quick-add an in-person appointment from a "+" empty slot (server-side route
  // runs the conflict check + creates the booking). Owner-booked → confirmed
  // ("Booked"), never the approval queue. The time can be a 15-min offset chosen
  // in the modal; booking outside the barber's hours tags an "outside hours" note.
  const createAppointment = async () => {
    if (!shop || !addCtx) return;
    const time = addForm.time || addCtx.time;
    if (!addForm.client_name.trim() || !addForm.service_id) { showToast("Add a name and pick a service"); return; }
    const svc = services.find(s => s.id === addForm.service_id);
    const outside = isOutsideSchedule(addCtx.barberId, time);
    setSavingAdd(true);
    const res = await fetch("/api/book/in-person", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        shop_id: shop.id, barber_id: addCtx.barberId, service_id: addForm.service_id,
        client_name: addForm.client_name.trim(), client_phone: addForm.client_phone.trim() || undefined,
        date: formatDateForDb(currentDate), time_slot: time,
        total_amount: svc?.price ?? 0, duration_minutes: svc?.duration_minutes, pay_in_person: true,
        confirmed: true,
        note: outside ? "⚠️ Booked outside the barber's working hours" : undefined,
      }),
    });
    const data = await res.json().catch(() => ({}));
    setSavingAdd(false);
    if (!res.ok) { showToast(data.error ?? "Couldn't add the appointment"); return; }
    setAddCtx(null);
    setAddForm({ client_name: "", client_phone: "", service_id: "", time: "" });
    showToast(outside ? "Booked · outside working hours" : "Booked");
    load();
  };

  // Free 15-min start times for the add modal (within the barber's window,
  // excluding times already booked), so a 15-min offset can be picked.
  const addTimeOptions = useMemo(() => {
    if (!addCtx) return [] as string[];
    const sched = schedules.get(addCtx.barberId);
    const win = sched ?? { start: "09:00:00", end: "22:00:00" };
    const booked = bookedSlotsFor(addCtx.barberId, formatDateForDb(currentDate), ADD_STEP);
    const free = getSlotsInRange(win.start, win.end, currentDate, Array.from(booked), ADD_STEP)
      .filter(s => s.available).map(s => s.slot);
    if (!free.includes(addCtx.time)) free.unshift(addCtx.time);
    return free;
  }, [addCtx, schedules, currentDate, bookedSlotsFor]);

  const titleText = useMemo(() => {
    const monthFmt = isMobile ? "short" : "long";
    if (view === "month") return currentDate.toLocaleDateString("en-CA", { month: monthFmt, year: "numeric" });
    if (view === "week") {
      const ws = startOfWeek(currentDate);
      const we = addDays(ws, 6);
      const sameMonth = ws.getMonth() === we.getMonth();
      if (isMobile) {
        return sameMonth
          ? `${ws.toLocaleDateString("en-CA", { month: "short" })} ${ws.getDate()}–${we.getDate()}`
          : `${ws.toLocaleDateString("en-CA", { month: "short", day: "numeric" })} – ${we.toLocaleDateString("en-CA", { month: "short", day: "numeric" })}`;
      }
      return sameMonth
        ? `${ws.toLocaleDateString("en-CA", { month: "long" })} ${ws.getDate()}–${we.getDate()}, ${we.getFullYear()}`
        : `${ws.toLocaleDateString("en-CA", { month: "short", day: "numeric" })} – ${we.toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric" })}`;
    }
    return isMobile
      ? currentDate.toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric" })
      : currentDate.toLocaleDateString("en-CA", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  }, [view, currentDate, isMobile]);

  // Contextual options for the single date dropdown — day/week/month aware.
  const dateOptions = useMemo(() => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const opts: { label: string; sub?: string; date: Date }[] = [];
    if (view === "day") {
      for (let off = -1; off <= 13; off++) {
        const d = addDays(today, off);
        opts.push({ label: friendlyDate(d), sub: d.toLocaleDateString("en-CA", { month: "short", day: "numeric" }), date: d });
      }
    } else if (view === "week") {
      const ws0 = startOfWeek(today);
      for (let off = -1; off <= 5; off++) {
        const ws = addDays(ws0, off * 7);
        const label = off === 0 ? "This week" : off === 1 ? "Next week" : off === -1 ? "Last week"
          : `Week of ${ws.toLocaleDateString("en-CA", { month: "short", day: "numeric" })}`;
        opts.push({ label, sub: ws.toLocaleDateString("en-CA", { month: "short", day: "numeric" }), date: ws });
      }
    } else {
      const ms0 = startOfMonth(today);
      for (let off = -1; off <= 6; off++) {
        const d = addMonths(ms0, off);
        const label = off === 0 ? "This month" : off === 1 ? "Next month" : off === -1 ? "Last month"
          : d.toLocaleDateString("en-CA", { month: "long", year: "numeric" });
        opts.push({ label, sub: d.toLocaleDateString("en-CA", { year: "numeric" }), date: d });
      }
    }
    return opts;
  }, [view]);

  // ── MONTH VIEW ─────────────────────────────────────────────────────────────
  const renderMonthView = () => {
    const monthStart = startOfMonth(currentDate);
    const monthEnd = endOfMonth(currentDate);
    const gridStart = addDays(monthStart, -monthStart.getDay());
    const days = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
    // Trim trailing all-next-month week if not needed
    const lastWithCurrentMonth = days.findLastIndex(d => d.getMonth() === monthStart.getMonth() || d <= monthEnd);
    const rows = Math.ceil((lastWithCurrentMonth + 1) / 7);
    const visibleDays = days.slice(0, rows * 7);

    const apptsByDate = new Map<string, AppointmentWithDetails[]>();
    appointments.forEach(a => {
      if (a.status === "cancelled") return; // cancelled stay on the Appointments page, not the calendar
      const arr = apptsByDate.get(a.date) ?? [];
      arr.push(a);
      apptsByDate.set(a.date, arr);
    });

    return (
      <div className="flex flex-col h-full">
        <div className="grid grid-cols-7 border-b border-gray-200 bg-gray-50">
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(d => (
            <div key={d} className="px-2 py-2 text-xs font-medium text-gray-500 text-center">{d}</div>
          ))}
        </div>
        <div className="flex-1 grid grid-cols-7 auto-rows-fr">
          {visibleDays.map((day) => {
            const inMonth = isSameMonth(day, currentDate);
            const dayStr = formatDateForDb(day);
            const dayAppts = apptsByDate.get(dayStr) ?? [];
            const visible = dayAppts.slice(0, 4);
            const overflow = dayAppts.length - visible.length;
            return (
              <button
                key={dayStr}
                onClick={() => setAgendaDate(day)}
                className={cn(
                  "border-r border-b border-gray-200 p-1 sm:p-1.5 text-left flex flex-col gap-1 min-h-[96px] sm:min-h-[132px] transition-colors",
                  "hover:bg-gray-50",
                  !inMonth && "bg-gray-50/60",
                )}
              >
                <div className="flex items-center justify-between">
                  <span className={cn(
                    "text-xs font-medium w-6 h-6 rounded-full flex items-center justify-center",
                    isToday(day) ? "bg-amber-500 text-white font-bold" :
                    inMonth ? "text-gray-900" : "text-gray-300",
                  )}>
                    {day.getDate()}
                  </span>
                </div>
                {isMobile ? (
                  // Phones: just colored dots per booking; cell is too narrow for chip text
                  <div className="flex flex-wrap gap-0.5 overflow-hidden">
                    {dayAppts.slice(0, 10).map(a => (
                      <span key={a.id} className={cn("w-1.5 h-1.5 rounded-full", statusDot(a.status))} />
                    ))}
                    {dayAppts.length > 10 && (
                      <span className="text-[9px] text-gray-400 leading-none">+{dayAppts.length - 10}</span>
                    )}
                  </div>
                ) : (
                  <div className="flex flex-col gap-0.5 overflow-hidden">
                    {visible.map(a => (
                      <span key={a.id}
                        className={cn(
                          "truncate text-[10px] leading-4 px-1.5 rounded-sm font-medium",
                          statusChip(a.status),
                          isDimmed(a.status) && "line-through opacity-70",
                        )}
                      >
                        {a.time_slot.replace(/:00 /, " ")} {a.client_name}
                      </span>
                    ))}
                    {overflow > 0 && (
                      <span className="text-[10px] text-gray-400 pl-1.5">+{overflow} more</span>
                    )}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  // ── DAY VIEW ───────────────────────────────────────────────────────────────
  // One barber's day as a clean card grid: booked slots are status-colored
  // cards; the barber's free slots (within their working window) are dashed
  // "+ Add" cards. Used for mobile and the single-barber desktop view.
  const renderBarberGrid = (barber: Barber) => {
    const dateStr = formatDateForDb(currentDate);
    const sched = schedules.get(barber.id);
    const startDb = sched?.start ?? "09:00:00";
    const endDb = sched?.end ?? "22:00:00";
    const dayAppts = appointments.filter(a => a.date === dateStr && a.barber_id === barber.id && a.status !== "cancelled");
    const emptySlots = windowEmpties(barber.id, dateStr, { start: startDb, end: endDb });

    type Cell = { k: "appt"; a: AppointmentWithDetails } | { k: "empty"; s: string };
    const cells: Cell[] = [
      ...emptySlots.map(s => ({ k: "empty", s } as Cell)),
      ...dayAppts.map(a => ({ k: "appt", a } as Cell)),
    ];
    cells.sort((x, y) =>
      timeToMinutes(x.k === "appt" ? x.a.time_slot : x.s) - timeToMinutes(y.k === "appt" ? y.a.time_slot : y.s));

    return (
      <div className="p-4 sm:p-5">
        {!sched && (
          <p className="text-xs text-gray-400 mb-3">No schedule set for this day — showing a default 9 AM–10 PM window.</p>
        )}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {cells.map((c, ci) => c.k === "empty" ? (
            <button key={`e${ci}`} onClick={() => openAdd(barber.id, barber.name, c.s)}
              className="group rounded-xl border border-dashed border-gray-300 hover:border-amber-400 hover:bg-amber-50/40 transition-colors p-3 text-left min-h-[88px] flex flex-col justify-between">
              <span className="text-xs text-gray-500">{rangeLabel(c.s, EMPTY_STEP)}</span>
              <span className="inline-flex items-center gap-1 text-xs font-medium text-gray-400 group-hover:text-amber-500">
                <Plus size={14} /> Add
              </span>
            </button>
          ) : (
            <button key={c.a.id} onClick={() => setSelectedAppt(c.a)}
              className={cn(
                "rounded-xl p-3 text-left min-h-[88px] flex flex-col justify-between transition-all hover:shadow-md",
                statusBlock(c.a.status), isDimmed(c.a.status) && "opacity-70 line-through",
              )}>
              <span className="text-xs font-medium opacity-80">{rangeLabel(c.a.time_slot, apptDuration(c.a))}</span>
              <div className="min-w-0">
                <p className="text-sm font-semibold truncate">{c.a.client_name}</p>
                <p className="text-[11px] opacity-80 truncate">{(c.a.services as { name: string } | null)?.name ?? "—"}</p>
              </div>
              <span className="text-[10px] font-semibold opacity-90">
                {c.a.payment_status === "paid" || c.a.payment_status === "captured" ? "Paid" : statusLabel(c.a.status)}
              </span>
            </button>
          ))}
          {cells.length === 0 && (
            <p className="col-span-full text-center text-sm text-gray-400 py-10">Nothing scheduled.</p>
          )}
        </div>
      </div>
    );
  };

  const renderDayView = () => {
    const dateStr = formatDateForDb(currentDate);
    const dayAppts = appointments.filter(a => a.date === dateStr && a.status !== "cancelled");
    const activeBarberId = barberFilter !== "all" ? barberFilter : (myBarberId ?? barbers[0]?.id ?? null);

    // A single barber selected (avatar row), or a barber-role user → clean card
    // grid for that one barber. (A barber only ever sees their own day.)
    if (barberFilter !== "all" || profile?.role === "barber") {
      const activeBarber = barbers.find(b => b.id === activeBarberId);
      return (
        <div className="overflow-auto h-full">
          {activeBarber
            ? renderBarberGrid(activeBarber)
            : <p className="text-center text-sm text-gray-400 py-12">No barbers yet.</p>}
        </div>
      );
    }

    // All barbers → per-barber columns (vertical lists), bounded to working
    // hours. Paginated: show as many columns as fit; arrows / swipe load more.
    const allCols = barbers.length > 0 ? barbers : [{ id: "none", name: "All Barbers" } as Barber];
    const perPage = colWrapW > 0
      ? Math.max(1, Math.floor((colWrapW - 56) / (isMobile ? 78 : 150)))
      : (isMobile ? 4 : 6);
    const pages = Math.max(1, Math.ceil(allCols.length / perPage));
    const page = Math.max(0, Math.min(colPage, pages - 1));
    const cols = allCols.slice(page * perPage, page * perPage + perPage);

    // Working window from ALL barbers + bookings, so the time rail stays put
    // when you page between barber sets.
    const starts: number[] = [], ends: number[] = [];
    allCols.forEach(b => {
      const s = schedules.get(b.id);
      if (s) { starts.push(hourOfDb(s.start)); ends.push(hourOfDb(s.end)); }
    });
    dayAppts.forEach(a => { const sh = parseTime(a.time_slot); starts.push(sh); ends.push(sh + apptDuration(a) / 60); });
    let winStart = starts.length ? Math.floor(Math.min(...starts)) : 9;
    let winEnd = ends.length ? Math.ceil(Math.max(...ends)) : 18;
    winStart = Math.min(9, Math.max(0, winStart));
    // Always run the grid down to at least 10 PM so the canvas fills the
    // viewport (no black gap below) and there's room to book evening slots.
    winEnd = Math.min(24, Math.max(winEnd, 22));
    const hours: number[] = [];
    for (let h = winStart; h < winEnd; h++) hours.push(h);

    const goPrev = () => setColPage(p => Math.max(0, p - 1));
    const goNext = () => setColPage(p => Math.min(pages - 1, p + 1));

    return (
      <div ref={colWrapRef} className="flex flex-col h-full">
        {pages > 1 && (
          <div className="flex items-center justify-between px-3 py-1.5 border-b border-gray-200 text-xs text-gray-500 flex-shrink-0">
            <button onClick={goPrev} disabled={page === 0} aria-label="Previous barbers"
              className="p-1 rounded hover:bg-gray-100 disabled:opacity-30 disabled:hover:bg-transparent"><ChevronLeft size={16} /></button>
            <span>Barbers {page * perPage + 1}–{Math.min(allCols.length, page * perPage + perPage)} of {allCols.length}</span>
            <button onClick={goNext} disabled={page >= pages - 1} aria-label="More barbers"
              className="p-1 rounded hover:bg-gray-100 disabled:opacity-30 disabled:hover:bg-transparent"><ChevronRight size={16} /></button>
          </div>
        )}
        <div ref={scrollRef} className="overflow-y-auto overflow-x-hidden flex-1"
          onTouchStart={e => { touchStartX.current = e.touches[0].clientX; }}
          onTouchEnd={e => {
            if (touchStartX.current == null) return;
            const dx = e.changedTouches[0].clientX - touchStartX.current;
            touchStartX.current = null;
            if (Math.abs(dx) < 50) return;
            if (dx < 0) goNext(); else goPrev();
          }}>
          <div>
            <div className="grid sticky top-0 z-10 bg-white border-b border-gray-200" style={{ gridTemplateColumns: `56px repeat(${cols.length}, 1fr)` }}>
              {/* "All barbers" — focused here since we're in the all-barbers view */}
              <button type="button" onClick={() => setBarberFilter("all")}
                className="flex flex-col items-center justify-center gap-1 py-3 transition-colors hover:bg-gray-50">
                <span className={cn("w-9 h-9 rounded-full flex items-center justify-center bg-gray-200 text-gray-600", barberFilter === "all" && "ring-2 ring-amber-500 ring-offset-2")}>
                  <Users size={16} />
                </span>
                <span className={cn("text-[9px] leading-tight", barberFilter === "all" ? "text-amber-600 font-semibold" : "text-gray-500")}>All</span>
              </button>
              {cols.map((b) => {
                const gi = barbers.indexOf(b);
                return (
                  <button key={b.id} type="button" onClick={() => setBarberFilter(b.id)}
                    className="px-3 py-3 text-center border-l border-gray-100 hover:bg-gray-50 transition-colors">
                    <div className="flex flex-col items-center gap-1">
                      <BarberAvatar b={b} i={gi >= 0 ? gi : 0} />
                      <p className="text-xs text-gray-900 font-medium truncate w-full">{b.name}</p>
                    </div>
                    <p className="text-[10px] text-gray-400 mt-0.5">
                      {dayAppts.filter(a => barbers.length === 0 || a.barber_id === b.id).length} appts
                    </p>
                    {!schedules.has(b.id) && <p className="text-[9px] text-amber-500 mt-0.5">Not scheduled</p>}
                  </button>
                );
              })}
            </div>

          <div className="relative">
            {hours.map(hour => (
              <div key={hour} className="grid border-b border-gray-100 relative" style={{ gridTemplateColumns: `56px repeat(${cols.length}, 1fr)`, height: `${ROW_PX}px` }}>
                {/* half-hour divider line */}
                <div className="absolute left-14 right-0 border-t border-dashed border-gray-100" style={{ top: `${ROW_PX / 2}px` }} />
                <div className="relative text-right pr-2">
                  <span className="text-[10px] text-gray-400">
                    {hour === 0 ? "12 AM" : hour < 12 ? `${hour} AM` : hour === 12 ? "12 PM" : `${hour - 12} PM`}
                  </span>
                  <span className="absolute right-2 text-[9px] text-gray-300" style={{ top: `${ROW_PX / 2 - 6}px` }}>:30</span>
                </div>
                {cols.map(b => (
                  <div key={b.id} className="border-l border-gray-100" />
                ))}
              </div>
            ))}

            <div className="absolute inset-0 pointer-events-none" style={{ display: "grid", gridTemplateColumns: `56px repeat(${cols.length}, 1fr)` }}>
              <div />
              {cols.map((b) => {
                const colAppts = dayAppts.filter(a => barbers.length === 0 || a.barber_id === b.id);
                const laid = layoutColumn(colAppts);
                // Show "+" boxes across the whole visible grid; the ones outside
                // the barber's schedule are greyed (still bookable as overtime).
                const gridWin = { start: `${String(winStart).padStart(2, "0")}:00:00`, end: `${String(winEnd).padStart(2, "0")}:00:00` };
                const empties = windowEmpties(b.id, dateStr, gridWin);
                return (
                  <div key={b.id} className="relative">
                    {/* Free 30-min slots → "+ Add" (greyed when outside hours) */}
                    {empties.map((slot) => {
                      const top = (parseTime(slot) - winStart) * ROW_PX;
                      const height = Math.max(20, (EMPTY_STEP / 60) * ROW_PX - 4);
                      const outside = isOutsideSchedule(b.id, slot);
                      return (
                        <button key={`e${slot}`}
                          title={outside ? "Outside working hours" : undefined}
                          style={{ top: `${top + 2}px`, height: `${height}px`, left: "4px", right: "4px", position: "absolute" }}
                          className={cn(
                            "group rounded-lg border border-dashed transition-colors pointer-events-auto flex items-center justify-center",
                            outside
                              ? "border-gray-200 bg-gray-200/60 hover:border-amber-300 hover:bg-amber-50/40"
                              : "border-gray-300 bg-white hover:border-amber-400 hover:bg-amber-50/60",
                          )}
                          onClick={() => openAdd(b.id, b.name, slot)}>
                          <Plus size={15} className={cn(outside ? "text-gray-300 group-hover:text-amber-400" : "text-gray-400 group-hover:text-amber-500")} />
                        </button>
                      );
                    })}
                    {/* Booked blocks — height ∝ duration; overlaps sit side-by-side */}
                    {laid.map(({ a: appt, lane, lanes }) => {
                      const top = (parseTime(appt.time_slot) - winStart) * ROW_PX;
                      const duration = apptDuration(appt);
                      const height = Math.max(28, (duration / 60) * ROW_PX - 4);
                      const dimmed = isDimmed(appt.status);
                      const widthPct = 100 / lanes;
                      return (
                        <button
                          key={appt.id}
                          style={{
                            top: `${top + 2}px`, height: `${height}px`,
                            left: `calc(${lane * widthPct}% + 2px)`,
                            width: `calc(${widthPct}% - 4px)`,
                            position: "absolute",
                          }}
                          className={cn(
                            "rounded-lg px-1.5 py-1 text-left overflow-hidden pointer-events-auto transition-all hover:z-10 hover:shadow-md shadow-sm",
                            statusBlock(appt.status),
                            dimmed && "opacity-70 line-through",
                          )}
                          onClick={() => setSelectedAppt(appt)}
                        >
                          <p className="text-[11px] font-semibold truncate leading-tight">{appt.client_name}</p>
                          {height > 30 && (
                            <p className="text-[10px] opacity-80 truncate">{rangeLabel(appt.time_slot, duration)}</p>
                          )}
                          {height > 50 && lanes === 1 && (
                            <p className="text-[10px] opacity-70 truncate">{(appt.services as { name: string } | null)?.name}</p>
                          )}
                        </button>
                      );
                    })}
                  </div>
                );
              })}
            </div>

            {isToday(currentDate) && (() => {
              const now = new Date();
              const currentH = now.getHours() + now.getMinutes() / 60;
              if (currentH < winStart || currentH > winEnd) return null;
              const top = (currentH - winStart) * ROW_PX;
              return (
                <div className="absolute left-0 right-0 pointer-events-none z-20" style={{ top: `${top}px` }}>
                  <div className="flex items-center">
                    <div className="w-14 pr-2 text-right">
                      <div className="w-2 h-2 rounded-full bg-red-500 ml-auto" />
                    </div>
                    <div className="flex-1 h-px bg-red-500" />
                  </div>
                </div>
              );
            })()}
          </div>
          </div>
        </div>
      </div>
    );
  };

  // ── WEEK VIEW ──────────────────────────────────────────────────────────────
  const renderWeekView = () => {
    const weekStart = startOfWeek(currentDate);
    const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

    // Mobile: date strip at top, then a single-day timeline for currentDate
    if (isMobile) {
      const selectedStr = formatDateForDb(currentDate);
      const dayAppts = appointments.filter(a => a.date === selectedStr && a.status !== "cancelled");
      return (
        <div className="flex flex-col h-full">
          {/* Date strip — tap to switch day */}
          <div className="grid grid-cols-7 border-b border-gray-200 bg-gray-50 flex-shrink-0">
            {weekDays.map(day => {
              const dateStr = formatDateForDb(day);
              const isSelected = dateStr === selectedStr;
              const today = isToday(day);
              const count = appointments.filter(a => a.date === dateStr && a.status !== "cancelled" && a.status !== "no-show").length;
              return (
                <button key={dateStr} onClick={() => setCurrentDate(day)}
                  className="py-2 text-center hover:bg-gray-100 transition-colors">
                  <p className={cn("text-[10px] uppercase tracking-wider", today ? "text-gray-900" : "text-gray-400")}>
                    {day.toLocaleDateString("en-CA", { weekday: "narrow" })}
                  </p>
                  <p className={cn(
                    "text-base font-bold mt-0.5 inline-flex items-center justify-center w-8 h-8 rounded-full",
                    isSelected ? "bg-amber-500 text-white" : "text-gray-900",
                  )}>
                    {day.getDate()}
                  </p>
                  <div className="flex justify-center gap-0.5 mt-0.5 h-1">
                    {count > 0 && <span className="w-1 h-1 rounded-full bg-amber-400" />}
                    {count > 3 && <span className="w-1 h-1 rounded-full bg-amber-400" />}
                    {count > 6 && <span className="w-1 h-1 rounded-full bg-amber-400" />}
                  </div>
                </button>
              );
            })}
          </div>
          {/* Single-day timeline for the selected day */}
          <div ref={scrollRef} className="overflow-auto flex-1">
            <div className="relative">
              {HOURS_24.map(hour => (
                <div key={hour} className="grid border-b border-gray-100" style={{ gridTemplateColumns: `48px 1fr`, height: `${ROW_PX}px` }}>
                  <div className="text-[10px] text-gray-400 text-right pr-2 pt-1">
                    {hour === 0 ? "12 AM" : hour < 12 ? `${hour} AM` : hour === 12 ? "12 PM" : `${hour - 12} PM`}
                  </div>
                  <div className="border-l border-gray-100" />
                </div>
              ))}
              <div className="absolute inset-0 pointer-events-none" style={{ display: "grid", gridTemplateColumns: `48px 1fr` }}>
                <div />
                <div className="relative">
                  {dayAppts.map(appt => {
                    const startH = parseTime(appt.time_slot);
                    const duration = apptDuration(appt);
                    const top = startH * ROW_PX;
                    const height = Math.max(36, (duration / 60) * ROW_PX - 4);
                    const barber = barbers.find(b => b.id === appt.barber_id);
                    const dimmed = isDimmed(appt.status);
                    return (
                      <button
                        key={appt.id}
                        style={{ top: `${top + 2}px`, height: `${height}px`, left: "6px", right: "6px", position: "absolute" }}
                        className={cn(
                          "rounded-lg px-2.5 py-1.5 text-left overflow-hidden pointer-events-auto shadow-sm",
                          statusBlock(appt.status),
                          dimmed && "opacity-70 line-through",
                        )}
                        onClick={() => setSelectedAppt(appt)}
                      >
                        <p className="text-xs font-semibold truncate leading-tight">{appt.time_slot} · {appt.client_name}</p>
                        {height > 44 && (
                          <p className="text-[11px] opacity-80 truncate">
                            {(appt.services as { name: string } | null)?.name} · {barber?.name ?? "Any"}
                          </p>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
              {isToday(currentDate) && (() => {
                const now = new Date();
                const currentH = now.getHours() + now.getMinutes() / 60;
                const top = currentH * ROW_PX;
                return (
                  <div className="absolute left-0 right-0 pointer-events-none z-20" style={{ top: `${top}px` }}>
                    <div className="flex items-center">
                      <div className="w-12 pr-2 text-right">
                        <div className="w-2 h-2 rounded-full bg-red-500 ml-auto" />
                      </div>
                      <div className="flex-1 h-px bg-red-500" />
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      );
    }

    return (
      <div ref={scrollRef} className="overflow-auto h-full">
        <div className="min-w-[700px]">
          <div className="grid sticky top-0 z-10 bg-white border-b border-gray-200" style={{ gridTemplateColumns: `56px repeat(7, 1fr)` }}>
            <div />
            {weekDays.map(day => {
              const dateStr = formatDateForDb(day);
              const dayAppts = appointments.filter(a => a.date === dateStr && a.status !== "cancelled");
              const today = isToday(day);
              return (
                <button key={dateStr} onClick={() => setAgendaDate(day)}
                  className={cn("py-2 text-center border-l border-gray-100 hover:bg-gray-50 transition-colors", today && "bg-amber-50/60")}>
                  <p className={cn("text-[10px] uppercase tracking-wider", today ? "text-gray-900" : "text-gray-400")}>
                    {day.toLocaleDateString("en-CA", { weekday: "short" })}
                  </p>
                  <p className={cn(
                    "text-lg font-bold mt-0.5 inline-flex items-center justify-center w-8 h-8 rounded-full",
                    today ? "bg-amber-500 text-white" : "text-gray-900",
                  )}>
                    {day.getDate()}
                  </p>
                  {dayAppts.length > 0 && (
                    <p className="text-[10px] text-gray-400 mt-0.5">{dayAppts.length}</p>
                  )}
                </button>
              );
            })}
          </div>

          <div className="relative">
            {HOURS_24.map(hour => (
              <div key={hour} className="grid border-b border-gray-100" style={{ gridTemplateColumns: `56px repeat(7, 1fr)`, height: `${ROW_PX}px` }}>
                <div className="text-[10px] text-gray-400 text-right pr-2 pt-1">
                  {hour === 0 ? "12 AM" : hour < 12 ? `${hour} AM` : hour === 12 ? "12 PM" : `${hour - 12} PM`}
                </div>
                {weekDays.map(day => (
                  <div key={formatDateForDb(day)} className={cn("border-l border-gray-100", isToday(day) && "bg-amber-50/60")} />
                ))}
              </div>
            ))}

            <div className="absolute inset-0 pointer-events-none" style={{ display: "grid", gridTemplateColumns: `56px repeat(7, 1fr)` }}>
              <div />
              {weekDays.map(day => {
                const dateStr = formatDateForDb(day);
                const dayAppts = appointments.filter(a => a.date === dateStr && a.status !== "cancelled");
                return (
                  <div key={dateStr} className="relative">
                    {dayAppts.map(appt => {
                      const startH = parseTime(appt.time_slot);
                      const duration = apptDuration(appt);
                      const top = startH * ROW_PX;
                      const height = Math.max(22, (duration / 60) * ROW_PX - 3);
                      const dimmed = appt.status === "cancelled" || appt.status === "no-show";
                      return (
                        <button
                          key={appt.id}
                          style={{ top: `${top + 2}px`, height: `${height}px`, left: "2px", right: "2px", position: "absolute" }}
                          className={cn(
                            "rounded px-1.5 py-0.5 text-left overflow-hidden pointer-events-auto transition-all hover:z-10 hover:scale-[1.02] hover:shadow-md shadow-sm",
                            statusBlock(appt.status),
                            dimmed && "opacity-70 line-through",
                          )}
                          onClick={() => setSelectedAppt(appt)}
                        >
                          <p className="text-[11px] font-semibold leading-tight truncate">{appt.client_name}</p>
                          {height > 36 && (
                            <p className="text-[10px] opacity-80 truncate">{appt.time_slot}</p>
                          )}
                        </button>
                      );
                    })}
                  </div>
                );
              })}
            </div>

            {weekDays.some(d => isToday(d)) && (() => {
              const now = new Date();
              const currentH = now.getHours() + now.getMinutes() / 60;
              const top = currentH * ROW_PX;
              return (
                <div className="absolute left-0 right-0 pointer-events-none z-20" style={{ top: `${top}px` }}>
                  <div className="flex items-center">
                    <div className="w-14" />
                    <div className="flex-1 h-px bg-red-500" />
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      </div>
    );
  };

  // ── Layout — LIGHT calendar canvas inside the app's dark chrome ──────────────
  return (
    <div className="flex flex-col h-full min-h-[100dvh] bg-white text-gray-900 overflow-x-clip max-lg:-mt-[calc(3.5rem+env(safe-area-inset-top))] max-lg:pt-[calc(3.5rem+env(safe-area-inset-top))]">
      {/* Header bar — ONE date dropdown (left) + ONE view button (right) */}
      <div className="p-4 sm:p-6 pb-3 border-b border-gray-200 flex items-center justify-between gap-4">
        {/* Date dropdown */}
        <div className="relative">
          <button onClick={() => { setDateMenu(o => !o); setViewMenu(false); }}
            className="flex items-center gap-2 text-lg sm:text-xl font-bold text-gray-900 hover:text-gray-600 transition-colors">
            {titleText}
            <ChevronDown size={18} className="text-gray-400" />
          </button>
          {loading && <span className="text-xs text-gray-400 ml-2 animate-pulse">Loading…</span>}
          {dateMenu && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setDateMenu(false)} />
              <div className="absolute left-0 mt-2 z-50 w-56 max-h-80 overflow-auto bg-white border border-gray-200 rounded-xl shadow-lg py-1">
                {dateOptions.map((o, i) => {
                  const active = formatDateForDb(o.date) === formatDateForDb(currentDate);
                  return (
                    <button key={i} onClick={() => { setCurrentDate(o.date); setDateMenu(false); }}
                      className={cn("w-full text-left px-4 py-2 text-sm flex items-center justify-between hover:bg-gray-50", active && "bg-amber-50")}>
                      <span className={cn("font-medium", active ? "text-amber-600" : "text-gray-900")}>{o.label}</span>
                      {o.sub && <span className="text-gray-400 text-xs">{o.sub}</span>}
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>

        {/* View button (one button → month / week / day) */}
        <div className="relative">
          <button onClick={() => { setViewMenu(o => !o); setDateMenu(false); }}
            className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-gray-700 border border-gray-300 rounded-xl hover:bg-gray-100 transition-colors capitalize">
            {view}
            <ChevronDown size={14} className="text-gray-400" />
          </button>
          {viewMenu && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setViewMenu(false)} />
              <div className="absolute right-0 mt-2 z-50 w-32 bg-white border border-gray-200 rounded-xl shadow-lg py-1">
                {(["day", "week", "month"] as const).map(v => (
                  <button key={v} onClick={() => { setView(v); setViewMenu(false); }}
                    className={cn("w-full text-left px-4 py-2 text-sm capitalize hover:bg-gray-50", view === v ? "text-gray-900 font-semibold" : "text-gray-500")}>
                    {v}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Barber selector row — profile-pic chips incl. an "All barbers" chip.
          Hidden in the all-barbers DAY view, where the column headers double as
          the selector (no duplicate row). Shown everywhere else. */}
      {profile?.role !== "barber" && barbers.length > 0 && !(view === "day" && barberFilter === "all") && (
        <div className="flex gap-3 overflow-x-auto px-4 sm:px-6 py-3 border-b border-gray-200">
          <button onClick={() => setBarberFilter("all")}
            className={cn("flex flex-col items-center gap-1 flex-shrink-0 w-16 py-1.5 transition-opacity", barberFilter === "all" ? "opacity-100" : "opacity-60 hover:opacity-100")}>
            <span className={cn("w-11 h-11 rounded-full flex items-center justify-center bg-gray-200 text-gray-600", barberFilter === "all" && "ring-2 ring-amber-500 ring-offset-2")}>
              <Users size={18} />
            </span>
            <span className={cn("text-[10px] truncate w-full text-center", barberFilter === "all" ? "text-amber-600 font-semibold" : "text-gray-600")}>All barbers</span>
          </button>
          {barbers.map((b, i) => (
            <button key={b.id} onClick={() => setBarberFilter(b.id)}
              className={cn("flex flex-col items-center gap-1 flex-shrink-0 w-16 py-1.5 transition-opacity", barberFilter === b.id ? "opacity-100" : "opacity-60 hover:opacity-100")}>
              <span className={cn("rounded-full", barberFilter === b.id && "ring-2 ring-amber-500 ring-offset-2")}>
                <BarberAvatar b={b} i={i} />
              </span>
              <span className={cn("text-[10px] truncate w-full text-center", barberFilter === b.id ? "text-amber-600 font-semibold" : "text-gray-600")}>{b.name}</span>
            </button>
          ))}
        </div>
      )}

      <div className="flex-1 overflow-hidden bg-white">
        {view === "month" ? renderMonthView() : view === "week" ? renderWeekView() : renderDayView()}
      </div>

      {selectedAppt && (
        <ApptDetail
          appt={selectedAppt}
          barbers={barbers}
          onClose={() => setSelectedAppt(null)}
          actions={apptActions}
          busy={actionBusy}
        />
      )}

      {toast && (
        <div className="fixed bottom-6 right-6 z-[100] bg-[#141414] border border-[#1e1e1e] rounded-xl px-5 py-3 text-sm text-white shadow-xl flex items-center gap-3">
          <span className="text-white">✓</span>{toast}
          <button onClick={() => setToast("")} className="text-[#777] hover:text-white ml-2">✕</button>
        </div>
      )}
      {agendaDate && (
        <AgendaSheet
          date={agendaDate}
          appts={appointments.filter(a => a.date === formatDateForDb(agendaDate) && a.status !== "cancelled")}
          barbers={barbers}
          onClose={() => setAgendaDate(null)}
          onOpenAppt={(a) => { setAgendaDate(null); setSelectedAppt(a); }}
          onDrillToDay={() => {
            setCurrentDate(agendaDate);
            setView("day");
            setAgendaDate(null);
          }}
        />
      )}

      {/* Quick-add appointment (DARK overlay) — opened from a "+" empty slot.
          Barber, date and time are fixed by the slot; the owner just picks a
          client + service. */}
      {addCtx && (
        <>
          <div className="fixed inset-0 bg-black/60 z-40" onClick={() => !savingAdd && setAddCtx(null)} />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="bg-black shadow-sm border border-[#1e1e1e] rounded-2xl p-6 w-full max-w-sm space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-bold text-white">New appointment</h3>
                <button onClick={() => !savingAdd && setAddCtx(null)} className="text-[#777] hover:text-white"><X size={18} /></button>
              </div>
              <div className="bg-[#141414] rounded-xl p-3 text-xs text-[#aaa] space-y-0.5">
                <p><span className="text-[#777]">Barber:</span> {addCtx.barberName}</p>
                <p><span className="text-[#777]">When:</span> {friendlyDate(currentDate)}</p>
              </div>
              <Input label="Client name *" value={addForm.client_name}
                onChange={e => setAddForm(p => ({ ...p, client_name: e.target.value }))} placeholder="Marcus Johnson" />
              <Input label="Phone" value={addForm.client_phone}
                onChange={e => setAddForm(p => ({ ...p, client_phone: e.target.value }))} placeholder="506-555-0000" />
              <Select label="Time" value={addForm.time}
                onChange={e => setAddForm(p => ({ ...p, time: e.target.value }))}>
                {addTimeOptions.map(t => <option key={t} value={t}>{t}</option>)}
              </Select>
              {isOutsideSchedule(addCtx.barberId, addForm.time) && (
                <p className="text-xs text-amber-400">
                  ⚠️ {schedules.has(addCtx.barberId)
                    ? `Outside ${addCtx.barberName}'s working hours.`
                    : `${addCtx.barberName} has no schedule set for this day.`}
                </p>
              )}
              <Select label="Service *" value={addForm.service_id}
                onChange={e => setAddForm(p => ({ ...p, service_id: e.target.value }))}>
                <option value="">Select a service</option>
                {services.map(s => (
                  <option key={s.id} value={s.id}>{s.name} · ${Number(s.price).toFixed(0)} · {s.duration_minutes}m</option>
                ))}
              </Select>
              <div className="flex gap-2 pt-1">
                <Button variant="outline" className="flex-1" disabled={savingAdd} onClick={() => setAddCtx(null)}>Cancel</Button>
                <Button className="flex-1" loading={savingAdd} onClick={createAppointment}>Add</Button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
