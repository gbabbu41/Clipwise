"use client";
import { useState, useEffect, useCallback, useRef, useMemo, Fragment, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence, MotionConfig } from "framer-motion";
import { ChevronDown, ChevronLeft, ChevronRight, X, Plus, Users, Ban } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/lib/supabase";
import {
  cn, formatDateForDb, friendlyDate, timeAgo, paymentTag,
  occupiedSlots, dbTimeToDisplay, timeToMinutes,
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
import type { AppointmentWithDetails, Barber, Shop } from "@/lib/database.types";

type ServiceLite = { id: string; name: string; price: number; duration_minutes: number };

// Overlays (modals / side sheet) render through the document body so their
// position:fixed always resolves to the viewport — when this calendar is
// embedded (e.g. on the dashboard) an ancestor with a transform/animation would
// otherwise trap fixed positioning and break their layout + dismissal.
export function Portal({ children }: { children: ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  return mounted && typeof document !== "undefined" ? createPortal(children, document.body) : null;
}

// ── Time helpers ─────────────────────────────────────────────────────────────
const ROW_PX = 62;                     // height of one hour row (~10% taller)

// Apple-style view transitions. dir > 0 = forward (next), dir < 0 = back, dir 0
// = a zoom/cross-fade (used when drilling month→day or switching view type).
const calVariants = {
  enter: (dir: number) => (dir === 0 ? { opacity: 0, scale: 0.97 } : { opacity: 0, x: dir > 0 ? 30 : -30 }),
  center: { opacity: 1, x: 0, scale: 1 },
  exit:  (dir: number) => (dir === 0 ? { opacity: 0, scale: 1.03 } : { opacity: 0, x: dir > 0 ? -30 : 30 }),
};
const calTransition = { duration: 0.22, ease: [0.32, 0.72, 0, 1] as [number, number, number, number] };

// Bound a timeline to business hours (+ any early/late bookings) instead of
// rendering a full 12 AM→12 AM day. Never starts later than 8 AM or ends before
// 8 PM, and always widens to cover the day's earliest/latest events.
function hourWindow(starts: number[], ends: number[]): { winStart: number; winEnd: number; hours: number[] } {
  const winStart = Math.min(8, Math.max(0, starts.length ? Math.floor(Math.min(...starts)) : 8));
  const winEnd = Math.min(24, Math.max(20, ends.length ? Math.ceil(Math.max(...ends)) : 20));
  const hours: number[] = [];
  for (let h = winStart; h < winEnd; h++) hours.push(h);
  return { winStart, winEnd, hours };
}

// Block length (minutes) for an appointment. Multi-service bookings carry their
// combined length on the row (duration_minutes); single-service rows fall back
// to the linked service's duration.
function apptDuration(a: AppointmentWithDetails): number {
  if (a.duration_minutes && a.duration_minutes > 0) return a.duration_minutes;
  return (a.services as { duration_minutes?: number } | null)?.duration_minutes ?? 30;
}

function parseTime(timeStr: string): number {
  if (!timeStr) return 0;
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

// ── Dark palettes (ACTIVE theme) ──────────────────────────────────────────────
// The calendar canvas is now DARK. Appointment blocks use a #1a1a1a fill + a
// status-colored 3px left edge + light text. The LIGHT palettes above are kept
// intact for the planned white-theme toggle — DO NOT delete them.
const STATUS_BLOCK_DARK: Record<string, string> = {
  pending:   "bg-[#1a1a1a] text-white border-l-[3px] border-amber-400",
  confirmed: "bg-[#1a1a1a] text-white border-l-[3px] border-[#00e5a0]",
  completed: "bg-[#1a1a1a] text-white border-l-[3px] border-sky-400",
  cancelled: "bg-[#141414] text-[#888] border-l-[3px] border-rose-500/70",
  "no-show": "bg-[#141414] text-[#888] border-l-[3px] border-zinc-500",
};
const STATUS_CHIP_DARK: Record<string, string> = {
  pending:   "bg-amber-500/15 text-amber-300",
  confirmed: "bg-[#00e5a0]/15 text-[#00e5a0]",
  completed: "bg-sky-500/15 text-sky-300",
  cancelled: "bg-rose-500/15 text-rose-300",
  "no-show": "bg-zinc-500/15 text-zinc-300",
};
const statusBlockDark = (s: string) => STATUS_BLOCK_DARK[s] ?? "bg-[#1a1a1a] text-white border-l-[3px] border-[#00e5a0]";
const statusChipDark = (s: string) => STATUS_CHIP_DARK[s] ?? "bg-[#00e5a0]/15 text-[#00e5a0]";

// Shared action handlers, wired up by CalendarPage. Mirrors the Appointments
// page so Approve / Complete / Reject behave identically from either surface.
export type ApptActions = {
  approve: (a: AppointmentWithDetails) => void;
  complete: (a: AppointmentWithDetails) => void;        // paid / zero-amount / skip-unpaid
  captureComplete: (a: AppointmentWithDetails) => void; // held / saved card → auto-charge
  cashComplete: (a: AppointmentWithDetails) => void;    // record cash + complete
  sendLink: (a: AppointmentWithDetails, email: string) => void;
  reject: (a: AppointmentWithDetails) => void;
};

// Shared factory for the appointment actions (Approve / Complete / Charge / cash /
// send-link / Reject) so the calendar AND the dashboard's Today's Schedule run the
// exact same logic. Wrap in useMemo at the call site.
export function makeApptActions(opts: {
  shop: Shop | null;
  accessToken: string | null;
  patch: (id: string, p: Partial<AppointmentWithDetails>) => void; // update local row(s) + open detail
  setBusy: (key: string) => void;                                  // "" when idle
  toast: (msg: string) => void;
  onDone: () => void;                                              // close the detail card after a terminal action
}): ApptActions {
  const { shop, accessToken, patch, setBusy, toast, onDone } = opts;
  return {
    approve: async (appt) => {
      if (!shop) return;
      setBusy("approve");
      const { error } = await supabase.from("appointments").update({ status: "confirmed" }).eq("id", appt.id);
      setBusy("");
      if (error) { toast(`Update failed: ${error.message}`); return; }
      patch(appt.id, { status: "confirmed" });
      sendApprovalNotifications(appt, shop);
      toast("Approved · Customer notified");
    },
    complete: async (appt) => {
      if (!shop) return;
      setBusy("complete");
      const { error } = await supabase.from("appointments").update({ status: "completed" }).eq("id", appt.id);
      if (error) { setBusy(""); toast(`Update failed: ${error.message}`); return; }
      patch(appt.id, { status: "completed" });
      await runCompletionEffects(supabase, appt, shop, accessToken);
      setBusy("");
      onDone();
      toast("Marked complete");
    },
    captureComplete: async (appt) => {
      if (!shop || !accessToken) return;
      setBusy("capture");
      toast(appt.payment_status === "saved" ? "Charging saved card…" : "Charging held card…");
      const res = await fetch("/api/stripe/capture-appointment", {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ appointment_id: appt.id, reason: "completed" }),
      });
      const data = await res.json().catch(() => ({ ok: false, error: "Network error" }));
      if (!data.ok) { setBusy(""); toast(`Charge failed: ${data.error ?? "try again"}`); return; }
      await supabase.from("appointments").update({ status: "completed" }).eq("id", appt.id);
      patch(appt.id, { status: "completed", payment_status: "captured", paid_at: new Date().toISOString() });
      await runCompletionEffects(supabase, { ...appt, payment_status: "captured" }, shop, accessToken);
      setBusy("");
      onDone();
      toast("Charged · Completed");
    },
    cashComplete: async (appt) => {
      if (!shop) return;
      setBusy("cash");
      const p = { payment_status: "paid" as const, payment_method: "cash" as const, status: "completed" as const, paid_at: new Date().toISOString() };
      const { error } = await supabase.from("appointments").update(p).eq("id", appt.id);
      if (error) { setBusy(""); toast(`Failed: ${error.message}`); return; }
      patch(appt.id, p);
      // Settled by cash → expire any open payment link so it can't be paid too,
      // and ledger the cash sale so it shows in the barber Payments view.
      if (accessToken) {
        fetch("/api/stripe/cancel-payment-link", {
          method: "POST", headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
          body: JSON.stringify({ appointment_id: appt.id }),
        }).catch(() => {});
        fetch("/api/calendar/record-cash", {
          method: "POST", headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
          body: JSON.stringify({ appointment_id: appt.id }),
        }).catch(() => {});
      }
      await runCompletionEffects(supabase, appt, shop, accessToken);
      setBusy("");
      onDone();
      toast("Cash recorded · Completed");
    },
    sendLink: async (appt, email) => {
      if (!shop || !accessToken) return;
      setBusy("link");
      const willEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
      const willSms = !!appt.client_phone;
      if (willEmail && email !== (appt.client_email ?? "")) patch(appt.id, { client_email: email });
      const res = await fetch("/api/stripe/payment-link", {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        // complete_on_paid: this is a checkout link — once the customer pays it,
        // the appointment auto-flips to completed (status handled server-side).
        body: JSON.stringify({
          appointment_id: appt.id,
          send_email: willEmail,
          email: willEmail ? email : undefined,
          send_sms: willSms,
          phone: willSms ? appt.client_phone : undefined,
          complete_on_paid: true,
        }),
      });
      const data = await res.json().catch(() => ({}));
      setBusy("");
      if (!res.ok) { toast(`Failed: ${data.error ?? "try again"}`); return; }
      // Reflect that we're now waiting on the customer to pay (keeps the Check out
      // button visible; tag shows "Awaiting payment" until the webhook flips it).
      // Placeholder id is replaced by the real one via the realtime subscription.
      if (!appt.stripe_checkout_session_id) patch(appt.id, { stripe_checkout_session_id: "pending" });
      if (data.emailed && data.texted) { toast("Payment link sent · email + text"); }
      else if (data.emailed) { toast("Payment link emailed to customer"); }
      else if (data.texted) { toast("Payment link texted to customer"); }
      else if (data.url) {
        try { await navigator.clipboard.writeText(data.url); toast("Payment link copied to clipboard"); }
        catch { toast("Payment link ready"); }
      } else { toast("Payment link ready"); }
    },
    reject: async (appt) => {
      if (!shop) return;
      const wasPaid = !!(appt.payment_intent_id && appt.payment_status === "captured");
      if (typeof window !== "undefined" && !window.confirm(`Reject this appointment? The customer will be notified${wasPaid ? " and refunded." : "."}`)) return;
      setBusy("reject");
      if (wasPaid && accessToken) {
        const refundRes = await fetch("/api/stripe/refund", {
          method: "POST",
          headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
          body: JSON.stringify({ appointment_id: appt.id }),
        }).catch(() => null);
        if (refundRes?.ok) {
          patch(appt.id, { status: "cancelled", payment_status: "refunded" });
          notifyFreedSlot(appt, shop, "Cancelled");
          setBusy(""); onDone();
          toast("Rejected · Refund issued");
          return;
        }
      }
      const { error } = await supabase.from("appointments").update({ status: "cancelled" }).eq("id", appt.id);
      setBusy("");
      if (error) { toast(`Failed: ${error.message}`); return; }
      patch(appt.id, { status: "cancelled" });
      sendRejectionEmail(appt, shop, "");
      notifyFreedSlot(appt, shop, "Cancelled");
      onDone();
      toast("Rejected" + (appt.client_email ? " · Email sent" : ""));
    },
  };
}

// ── Appointment detail modal (DARK overlay — intentional over the light canvas) ─
export function ApptDetail({ appt, barbers, onClose, actions, busy, readOnly = false }: {
  appt: AppointmentWithDetails;
  barbers: Barber[];
  onClose: () => void;
  actions: ApptActions;
  busy: string;
  readOnly?: boolean;   // hide all action buttons (e.g. barber without manage_appointments)
}) {
  const barber = barbers.find(b => b.id === appt.barber_id);
  const [payChoice, setPayChoice] = useState(false);
  const [payEmail, setPayEmail] = useState(appt.client_email ?? "");
  const duration = apptDuration(appt);
  const paid = appt.payment_status === "paid" || appt.payment_status === "captured";
  const heldOrSaved = appt.payment_status === "held" || appt.payment_status === "saved";
  // Outstanding = a real balance not yet settled and not on a held/saved card
  // (those auto-charge on Complete). Drives the standalone "Take Payment" button.
  const outstanding = (appt.total_amount ?? 0) > 0
    && appt.payment_status !== "paid" && appt.payment_status !== "captured"
    && appt.payment_status !== "refunded" && !heldOrSaved;

  const amt = Number(appt.total_amount ?? 0);
  // A checkout link is out and the customer hasn't paid yet — keep the Check out
  // button but surface that we're waiting (paying the link auto-completes).
  const awaiting = !paid && !!appt.stripe_checkout_session_id;

  return (
    <>
      <div className="fixed inset-0 bg-black/60 z-[70]" onClick={onClose} />
      <div className="fixed inset-0 z-[80] flex items-center justify-center p-4 pb-24 lg:pb-4 overflow-y-auto overscroll-contain [&>*]:my-auto">
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
                <span className="font-medium">
                  <span className="text-[#00e5a0]">Paid</span>
                  <span className="text-[#555]"> · </span>
                  <span className={appt.payment_method === "cash" ? "text-[#bbb]" : "text-[#00e5a0]"}>
                    {appt.payment_method === "cash" ? "Cash" : appt.payment_method === "online" ? "Online" : "Card"}
                  </span>
                  {appt.paid_at ? <span className="text-[#777]"> · {timeAgo(appt.paid_at)}</span> : null}
                </span>
              </div>
            )}
          </div>
          {appt.notes && (
            <div className="bg-[#141414] rounded-xl p-3 text-xs text-[#777]">{appt.notes}</div>
          )}

          {/* Actions. The "Check out" button (confirmed appts) opens the checkout
              sheet — it is NOT the same as the completed status: a prepaid online
              booking stays "confirmed" until the barber checks it out here.
              Hidden entirely in read-only mode (barber w/o manage_appointments). */}
          {readOnly ? null : payChoice ? (
            <div className="space-y-2 pt-1 border-t border-[#1e1e1e]">
              <p className="text-xs text-[#777]">Check out{amt > 0 ? ` · $${amt.toFixed(2)}` : ""}</p>
              {paid ? (
                /* Already paid (e.g. prepaid at booking) — just finish the visit. */
                <Button size="sm" className="w-full" disabled={!!busy} onClick={() => actions.complete(appt)}>
                  {busy === "complete" ? "Completing…" : "Mark complete · already paid"}
                </Button>
              ) : (
                <>
                  {/* 1 · Charge a card already on file (held at booking / saved). */}
                  {heldOrSaved && (
                    <Button size="sm" className="w-full bg-[#00e5a0] hover:bg-[#00cf90] text-black" disabled={!!busy} onClick={() => actions.captureComplete(appt)}>
                      {busy === "capture" ? "Charging…" : `Charge card on file${amt > 0 ? ` · $${amt.toFixed(2)}` : ""}`}
                    </Button>
                  )}
                  {/* 2 · Tap to Pay — native, not shipped yet. */}
                  <Button size="sm" variant="outline" className="w-full opacity-50 cursor-not-allowed" disabled>
                    Pay here (Tap) · Coming soon
                  </Button>
                  {/* 3 · Send a checkout link by email/text — paying it auto-completes. */}
                  <input
                    type="email"
                    value={payEmail}
                    onChange={e => setPayEmail(e.target.value)}
                    placeholder="Customer email (for the link)"
                    className="w-full bg-[#141414] border border-[#1e1e1e] rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-gold/50"
                  />
                  <Button size="sm" variant="outline" className="w-full" disabled={!!busy} onClick={() => { actions.sendLink(appt, payEmail.trim()); setPayChoice(false); }}>
                    {busy === "link" ? "Sending…" : `Send payment link${appt.client_phone ? " · email/text" : ""}`}
                  </Button>
                  {/* 4 · Pay cash + complete.  5 · Complete now, leave unpaid. */}
                  <div className="grid grid-cols-2 gap-2">
                    <Button size="sm" variant="outline" disabled={!!busy} onClick={() => actions.cashComplete(appt)}>
                      {busy === "cash" ? "…" : "Pay cash · Complete"}
                    </Button>
                    {appt.status !== "completed" && (
                      <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => actions.complete(appt)}>
                        {busy === "complete" ? "…" : "Complete unpaid"}
                      </Button>
                    )}
                  </div>
                </>
              )}
              <button className="w-full text-xs text-[#777] hover:text-white pt-1" onClick={() => setPayChoice(false)}>Cancel</button>
            </div>
          ) : (
            <div className="space-y-2 pt-1 border-t border-[#1e1e1e]">
              {awaiting && (
                <p className="text-xs text-sky-400">Awaiting payment — checkout link sent. Paying it completes the visit.</p>
              )}
              {(appt.status === "pending" || appt.status === "confirmed") && (
                <div className="flex gap-2">
                  {appt.status === "pending" && (
                    <Button size="sm" className="flex-1" disabled={!!busy} onClick={() => actions.approve(appt)}>
                      {busy === "approve" ? "…" : "Approve"}
                    </Button>
                  )}
                  {appt.status === "confirmed" && (
                    <Button size="sm" className="flex-1" disabled={!!busy} onClick={() => setPayChoice(true)}>
                      Check out
                    </Button>
                  )}
                  <Button size="sm" variant="outline" className="flex-1" disabled={!!busy} onClick={() => actions.reject(appt)}>
                    {busy === "reject" ? "…" : "Reject"}
                  </Button>
                </div>
              )}
              {/* Take Payment — only when there's no Check out / Approve button
                  above (e.g. a completed-but-unpaid, manually-added booking).
                  For pending/confirmed, Check out already takes payment, so this
                  would be redundant. Opens the same checkout sheet. */}
              {outstanding && appt.status !== "pending" && appt.status !== "confirmed" && (
                <Button size="sm" className="w-full bg-[#00e5a0] hover:bg-[#00cf90] text-black" disabled={!!busy} onClick={() => setPayChoice(true)}>
                  💳 Take Payment · ${amt.toFixed(0)}
                </Button>
              )}
            </div>
          )}
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
        <div className="px-5 pb-5 pt-[calc(env(safe-area-inset-top)+1.25rem)] border-b border-[#1e1e1e] flex items-center justify-between">
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
        <div className="px-4 pt-4 pb-[calc(env(safe-area-inset-bottom)+5.25rem)] lg:pb-4 border-t border-[#1e1e1e]">
          <button onClick={onDrillToDay}
            className="w-full py-2.5 rounded-xl bg-white/10 hover:bg-white/15 text-white text-sm font-medium transition-colors">
            Open day view
          </button>
        </div>
      </div>
    </>
  );
}

// A "blocked hours" row (time_off_requests, type blocked_hours). start_time /
// end_time are 24h "HH:MM"; pending = awaiting owner approval, approved = firm.
type BlockRow = { id: string; barber_id: string; start_date: string; start_time: string | null; end_time: string | null; status: string; reason: string | null };

export function CalendarView({ embedded = false, canManage = true, forceBarberId, defaultView, canBlock = false }: { embedded?: boolean; canManage?: boolean; forceBarberId?: string | null; defaultView?: "year" | "month" | "day"; canBlock?: boolean }) {
  const { shop, profile, accessToken, user } = useAuth();
  // Apple-style hierarchy: Year ⇄ Month ⇄ Day. Opens on today's Day view; the
  // back arrow walks up a level (Day → Month → Year). No manual view switcher.
  const [view, setView] = useState<"year" | "month" | "day">(defaultView ?? "day");
  // Barber portal (forceBarberId) isolates the calendar to that one barber —
  // even for an owner who also cuts: no other-barber chrome (selector/pager).
  const isolated = !!forceBarberId;
  const [barberFilter, setBarberFilter] = useState<string>("all"); // owner: filter calendar to one barber
  const [currentDate, setCurrentDate] = useState(new Date());
  const [appointments, setAppointments] = useState<AppointmentWithDetails[]>([]);
  const [barbers, setBarbers] = useState<Barber[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedAppt, setSelectedAppt] = useState<AppointmentWithDetails | null>(null);
  // Direction of the last navigation, fed to the view-transition variants:
  // +1 next, -1 previous, 0 = zoom/cross-fade (drill into a day / switch view).
  const [navDir, setNavDir] = useState(0);
  const [myBarberId, setMyBarberId] = useState<string | null>(null);
  const [isMobile, setIsMobile] = useState(false);
  const [actionBusy, setActionBusy] = useState("");
  const [toast, setToast] = useState("");
  // Day view hides barbers who aren't scheduled today; a chip reveals them.
  const [showUnscheduled, setShowUnscheduled] = useState(false);
  // Appointment ids to briefly flash (e.g. just flipped to paid via realtime).
  const [flashIds, setFlashIds] = useState<Set<string>>(() => new Set());
  // Day-view working hours (per barber, for the current weekday) + services for
  // the quick-add modal, and the "+" empty-slot add context/form.
  const [schedules, setSchedules] = useState<Map<string, { start: string; end: string }>>(new Map());
  const [services, setServices] = useState<ServiceLite[]>([]);
  const [addCtx, setAddCtx] = useState<{ barberId: string; barberName: string; time: string; boxMinutes?: number } | null>(null);
  const [addForm, setAddForm] = useState({ client_name: "", client_phone: "", service_ids: [] as string[], time: "" });
  const [savingAdd, setSavingAdd] = useState(false);
  // Blocked-hours state. The tap modal carries an Appointment/Block toggle
  // (addMode); blockForm holds the block's time range + reason.
  const [blocks, setBlocks] = useState<BlockRow[]>([]);
  const [addMode, setAddMode] = useState<"appt" | "block">("appt");
  const [blockForm, setBlockForm] = useState({ start: "", end: "", reason: "" });
  const [blockBusy, setBlockBusy] = useState(false);
  const [dateMenu, setDateMenu] = useState(false);
  const [viewMenu, setViewMenu] = useState(false);
  // Barber-column pagination for the all-barbers day view (arrows / swipe).
  const [colPage, setColPage] = useState(0);
  const [colWrapW, setColWrapW] = useState(0);
  const colWrapRef = useRef<HTMLDivElement>(null);
  // Swipe origin for the calendar-wide gesture (next/prev period).
  const swipeRef = useRef<{ x: number; y: number } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 639px)");
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  // Identify the current user's own barber row — for BOTH barbers and owners who
  // also cut hair. Match by user_id, falling back to account email (covers a
  // barber row that was never linked to the account).
  useEffect(() => {
    if (!profile || !shop) return;
    supabase.from("barbers").select("id, user_id, email").eq("shop_id", shop.id)
      .then(({ data }) => {
        if (!data) return;
        const mine = data.find(b => b.user_id === profile.id)
          ?? data.find(b => !!user?.email && b.email?.toLowerCase() === user.email!.toLowerCase());
        if (mine) setMyBarberId(mine.id);
      });
  }, [profile, shop, user]);

  const load = useCallback(async () => {
    if (!shop) { setLoading(false); return; }
    setLoading(true);

    let rangeStart: Date, rangeEnd: Date;
    if (view === "year") {
      rangeStart = new Date(currentDate.getFullYear(), 0, 1);
      rangeEnd = new Date(currentDate.getFullYear(), 11, 31);
    } else if (view === "month") {
      const monthStart = startOfMonth(currentDate);
      rangeStart = addDays(monthStart, -monthStart.getDay()); // back to Sunday
      rangeEnd = addDays(rangeStart, 41);                     // 6 weeks
    } else {
      // Day view: load the surrounding weeks so the week strip has dots and
      // swiping to nearby days shows data instantly (a refetch follows).
      rangeStart = addDays(startOfWeek(currentDate), -7);
      rangeEnd = addDays(startOfWeek(currentDate), 13);
    }

    let q = supabase
      .from("appointments")
      .select("*, barbers(id, name), services(id, name, price, duration_minutes, category)")
      .eq("shop_id", shop.id)
      .gte("date", formatDateForDb(rangeStart))
      .lte("date", formatDateForDb(rangeEnd))
      .order("time_slot");

    // forceBarberId (barber portal) isolates to that barber regardless of role;
    // otherwise a barber-role user sees only their own, an owner sees the shop.
    const scopeId = forceBarberId ?? (profile?.role === "barber" ? myBarberId : null);
    if (scopeId) {
      q = q.eq("barber_id", scopeId);
    } else if (barberFilter !== "all") {
      // Owner filtered the calendar to a single barber
      q = q.eq("barber_id", barberFilter);
    }

    // Blocked-hours overlapping the visible range (pending + approved). Scoped
    // to the one barber in the barber portal; shop-wide otherwise.
    let blocksQ = supabase
      .from("time_off_requests")
      .select("id, barber_id, start_date, start_time, end_time, status, reason")
      .eq("shop_id", shop.id).eq("type", "blocked_hours")
      .in("status", ["pending", "approved"])
      .gte("start_date", formatDateForDb(rangeStart))
      .lte("start_date", formatDateForDb(rangeEnd));
    if (scopeId) blocksQ = blocksQ.eq("barber_id", scopeId);
    else if (barberFilter !== "all") blocksQ = blocksQ.eq("barber_id", barberFilter);

    const [{ data: appts }, { data: bs }, { data: blk }] = await Promise.all([
      q,
      supabase.from("barbers").select("*").eq("shop_id", shop.id).eq("is_active", true).order("name"),
      blocksQ,
    ]);

    setAppointments((appts ?? []) as AppointmentWithDetails[]);
    setBarbers((bs ?? []) as Barber[]);
    setBlocks((blk ?? []) as BlockRow[]);
    setLoading(false);
  }, [shop, currentDate, view, profile, myBarberId, barberFilter, forceBarberId]);

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

  // Live updates — a payment collected (or a block / new booking) flips the
  // calendar without a manual refresh. Subscribe once per shop; a ref always
  // calls the latest load() so we don't re-subscribe on every date/view change.
  // When an appointment flips to paid, flash its card briefly.
  const loadRef = useRef(load);
  useEffect(() => { loadRef.current = load; }, [load]);
  useEffect(() => {
    if (!shop) return;
    const ch = supabase
      .channel(`calendar:${shop.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "appointments", filter: `shop_id=eq.${shop.id}` }, (payload) => {
        if (payload.eventType === "UPDATE") {
          const n = payload.new as { id?: string; payment_status?: string };
          if (n?.id && (n.payment_status === "paid" || n.payment_status === "captured")) {
            const id = n.id;
            setFlashIds(prev => { const s = new Set(prev); s.add(id); return s; });
            setTimeout(() => setFlashIds(prev => { const s = new Set(prev); s.delete(id); return s; }), 3000);
          }
        }
        loadRef.current();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "time_off_requests", filter: `shop_id=eq.${shop.id}` }, () => loadRef.current())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [shop]);

  // Both the week and day grids are now bounded to business hours, so they
  // start at the top of their visible window (no midnight scroll-past).
  useEffect(() => {
    if (!scrollRef.current) return;
    if (view === "day") scrollRef.current.scrollTop = 0;
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

  // Appointment actions — shared factory (same behavior as the Appointments page),
  // so the calendar detail card and the dashboard board stay in sync.
  const apptActions: ApptActions = useMemo(
    () => makeApptActions({ shop, accessToken, patch: applyLocal, setBusy: setActionBusy, toast: showToast, onDone: () => setSelectedAppt(null) }),
    [shop, accessToken, applyLocal, showToast],
  );

  // Empty "+" slots are shown every 30 min; a booking can still be added on a
  // 15-min offset via the add modal's time picker.
  const EMPTY_STEP = 30;   // base granularity for detecting free time
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

  // minutes-from-midnight → "10:20 AM" display slot.
  const minsToSlot = (m: number) =>
    dbTimeToDisplay(`${String(Math.floor(m / 60)).padStart(2, "0")}:${String(Math.round(m % 60)).padStart(2, "0")}:00`);

  // Free time in a barber's window as bookable "+" boxes. We subtract the real
  // booked intervals (active appts) and tile each free GAP on the hour: a fully
  // free hour → one 60-min box, but a gap that starts mid-hour (right after a
  // 10/20-min appointment) gets a box anchored at the EXACT end time — so staff
  // can book any available time and nothing slips through a fixed grid. Does NOT
  // drop past times (the owner still wants to see/log into empty boxes).
  const windowEmpties = useCallback((barberId: string, dateStr: string, win: { start: string; end: string }) => {
    const startMins = timeToMinutes(dbTimeToDisplay(win.start));
    const endMins = timeToMinutes(dbTimeToDisplay(win.end));
    if (Number.isNaN(startMins) || Number.isNaN(endMins) || endMins <= startMins) return [] as { slot: string; minutes: number }[];
    const intervals = appointments
      .filter(a => a.date === dateStr && a.barber_id === barberId && !isDimmed(a.status))
      .map(a => { const s = timeToMinutes(a.time_slot); return [s, s + apptDuration(a)] as [number, number]; })
      .filter(([s, e]) => e > startMins && s < endMins)
      .sort((x, y) => x[0] - y[0]);
    const out: { slot: string; minutes: number }[] = [];
    const tile = (from: number, to: number) => {
      let c = from;
      while (c < to - 0.5) {
        const boundary = c % 60 === 0 ? c + 60 : Math.ceil(c / 60) * 60;
        const end = Math.min(boundary, to);
        out.push({ slot: minsToSlot(c), minutes: Math.round(end - c) });
        c = end;
      }
    };
    let cursor = startMins;
    for (const [s, e] of intervals) {
      const gapStart = Math.max(s, startMins);
      if (gapStart > cursor) tile(cursor, gapStart);
      cursor = Math.max(cursor, Math.min(e, endMins));
    }
    if (cursor < endMins) tile(cursor, endMins);
    return out;
  }, [appointments]);

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
  const BarberAvatar = ({ b, i, sm }: { b: Barber; i: number; sm?: boolean }) => {
    const dim = sm ? "w-7 h-7 text-[11px]" : "w-11 h-11 text-sm";
    if (b.photo) return <img src={b.photo} alt={b.name} className={cn(dim, "rounded-full object-cover")} />;
    return (
      <span className={cn(dim, "rounded-full flex items-center justify-center font-bold text-white", BARBER_DOT_PALETTE[i % BARBER_DOT_PALETTE.length])}>
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

  // Open the tap modal for a slot. Carries both flows: add an appointment
  // (needs manage_appointments) and block the time (needs block_hours). Opens
  // as long as the user can do at least one; defaults to whichever they can.
  const openAdd = (barberId: string, barberName: string, time: string, boxMinutes?: number) => {
    if (!canManage && !canBlock) return;
    setAddForm({ client_name: "", client_phone: "", service_ids: [], time });
    const startMin = timeToMinutes(time);
    setBlockForm({ start: minsTo24h(startMin), end: minsTo24h(startMin + (boxMinutes && boxMinutes > 0 ? boxMinutes : 60)), reason: "" });
    setAddMode(canManage ? "appt" : "block");
    setAddCtx({ barberId, barberName, time, boxMinutes });
  };

  // ── Blocked hours ──────────────────────────────────────────────────────────
  // Minutes → 24h "HH:MM" (the format time_off_requests + availability use).
  const minsTo24h = (min: number) => `${String(Math.floor(min / 60) % 24).padStart(2, "0")}:${String(Math.round(min) % 60).padStart(2, "0")}`;
  // Blocks for one barber on one day (sorted), with start/end minutes resolved.
  const blocksFor = useCallback((barberId: string, dateStr: string) =>
    blocks
      .filter(b => b.barber_id === barberId && b.start_date === dateStr && b.start_time && b.end_time)
      .map(b => ({ ...b, startMin: timeToMinutes(dbTimeToDisplay(b.start_time!)), endMin: timeToMinutes(dbTimeToDisplay(b.end_time!)) }))
      .sort((x, y) => x.startMin - y.startMin),
  [blocks]);

  // Submit a block (from the tap modal's Block tab). Uses the addCtx slot.
  const submitBlock = async () => {
    if (!shop || !addCtx || !accessToken) return;
    if (!blockForm.start || !blockForm.end || blockForm.end <= blockForm.start) return;
    setBlockBusy(true);
    const res = await fetch("/api/calendar/block", {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "create", shop_id: shop.id, barber_id: addCtx.barberId,
        date: formatDateForDb(currentDate), start_time: blockForm.start, end_time: blockForm.end,
        reason: blockForm.reason || null,
      }),
    });
    const data = await res.json().catch(() => ({ ok: false }));
    setBlockBusy(false);
    if (!res.ok || !data.ok) return;
    setAddCtx(null);
    load();
  };

  const removeBlock = async (b: BlockRow) => {
    if (!shop || !accessToken) return;
    if (typeof window !== "undefined" && !window.confirm("Remove this block?")) return;
    await fetch("/api/calendar/block", {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ action: "remove", shop_id: shop.id, request_id: b.id }),
    }).catch(() => null);
    load();
  };

  // Quick-add an in-person appointment from a "+" empty slot (server-side route
  // runs the conflict check + creates the booking). Owner-booked → confirmed
  // ("Booked"), never the approval queue. The time can be a 15-min offset chosen
  // in the modal; booking outside the barber's hours tags an "outside hours" note.
  const createAppointment = async () => {
    if (!shop || !addCtx) return;
    const time = addForm.time || addCtx.time;
    const chosenIds = addForm.service_ids.filter(Boolean);
    if (!addForm.client_name.trim() || chosenIds.length === 0) { showToast("Add a name and pick a service"); return; }
    const svcs = chosenIds.map(id => services.find(s => s.id === id)).filter(Boolean) as ServiceLite[];
    const duration = svcs.reduce((n, s) => n + (s.duration_minutes || 0), 0);
    const price = svcs.reduce((n, s) => n + Number(s.price || 0), 0);
    // Must fit before the next booked appointment.
    if (addWindow && timeToMinutes(time) + duration > addWindow.freeUntil) {
      showToast("Not enough time before the next appointment — shorten the service or start earlier");
      return;
    }
    const outside = isOutsideSchedule(addCtx.barberId, time);
    setSavingAdd(true);
    const res = await fetch("/api/book/in-person", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        shop_id: shop.id, barber_id: addCtx.barberId, service_id: svcs[0].id,
        service_names: svcs.length > 1 ? svcs.map(s => s.name).join(" + ") : undefined,
        client_name: addForm.client_name.trim(), client_phone: addForm.client_phone.trim() || undefined,
        date: formatDateForDb(currentDate), time_slot: time,
        total_amount: price, duration_minutes: duration, pay_in_person: true,
        confirmed: true,
        note: outside ? "⚠️ Booked outside the barber's working hours" : undefined,
      }),
    });
    const data = await res.json().catch(() => ({}));
    setSavingAdd(false);
    if (!res.ok) { showToast(data.error ?? "Couldn't add the appointment"); return; }
    setAddCtx(null);
    setAddForm({ client_name: "", client_phone: "", service_ids: [], time: "" });
    showToast(outside ? "Booked · outside working hours" : "Booked");
    load();
  };

  // Free 15-min start times for the add modal (within the barber's window,
  // excluding times already booked), so a 15-min offset can be picked.
  // Free runway from the tapped box start up to the next booked appointment
  // (open-ended if none after it). Drives the service/time fit checks.
  const addWindow = useMemo(() => {
    if (!addCtx) return null;
    const boxStart = timeToMinutes(addCtx.time);
    const dateStr = formatDateForDb(currentDate);
    const nexts = appointments
      .filter(a => a.date === dateStr && a.barber_id === addCtx.barberId && !isDimmed(a.status))
      .map(a => timeToMinutes(a.time_slot))
      .filter(m => m > boxStart);
    return { boxStart, freeUntil: nexts.length ? Math.min(...nexts) : 24 * 60 };
  }, [addCtx, appointments, currentDate]);

  // Combined totals — sum over the chosen rows (counts duplicates, ignores "").
  const svcById = useCallback((id: string) => services.find(s => s.id === id), [services]);
  const addTotalDuration = addForm.service_ids.reduce((n, id) => n + (svcById(id)?.duration_minutes || 0), 0);
  const addTotalPrice = addForm.service_ids.reduce((n, id) => n + Number(svcById(id)?.price || 0), 0);

  // Keep the start valid: if the new combined total no longer fits at the chosen
  // start, snap the start back to the box start (always valid for a fitting combo).
  const reflowTime = (service_ids: string[]) => {
    const total = service_ids.reduce((n, id) => n + (svcById(id)?.duration_minutes || 0), 0);
    setAddForm(p => {
      let time = p.time;
      if (addCtx && addWindow && total > 0 && timeToMinutes(time) + total > addWindow.freeUntil) time = addCtx.time;
      return { ...p, service_ids, time };
    });
  };
  // Service "rows": each is a dropdown. Set/append/remove a row.
  const setServiceAt = (idx: number, id: string) => {
    const next = [...addForm.service_ids];
    if (idx >= next.length) next.push(id); else next[idx] = id;
    reflowTime(next);
  };
  const addServiceRow = () => setAddForm(p => ({ ...p, service_ids: [...p.service_ids, ""] }));
  const removeServiceRow = (idx: number) => reflowTime(addForm.service_ids.filter((_, i) => i !== idx));

  const addTimeOptions = useMemo(() => {
    if (!addCtx) return [] as string[];
    const booked = bookedSlotsFor(addCtx.barberId, formatDateForDb(currentDate), ADD_STEP);
    const startM = timeToMinutes(addCtx.time);
    const endM = startM + (addCtx.boxMinutes ?? 60);
    // Build the picker straight from the tapped box: the exact start, then every
    // 15-min mark inside that box (11 AM box → 11:00 / 11:15 / 11:30 / 11:45),
    // never spilling into the next box. Skip marks that are already booked; past
    // times are fine (the owner may log a walk-in after the fact).
    const opts: string[] = [addCtx.time];
    for (let m = Math.ceil(startM / ADD_STEP) * ADD_STEP; m < endM; m += ADD_STEP) {
      if (m === startM) continue;
      const slot = minsToSlot(m);
      if (!booked.has(slot)) opts.push(slot);
    }
    return opts;
  }, [addCtx, currentDate, bookedSlotsFor]);

  const titleText = useMemo(() => {
    if (view === "year") return String(currentDate.getFullYear());
    if (view === "month") return currentDate.toLocaleDateString("en-CA", { month: isMobile ? "short" : "long", year: "numeric" });
    return isMobile
      ? currentDate.toLocaleDateString("en-CA", { weekday: "short", month: "short", day: "numeric" })
      : currentDate.toLocaleDateString("en-CA", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  }, [view, currentDate, isMobile]);

  // Parent level the back arrow walks up to (null at the top = Year).
  const backLabel = view === "day"
    ? currentDate.toLocaleDateString("en-CA", { month: "long" })
    : view === "month"
      ? String(currentDate.getFullYear())
      : null;

  // ── WEEK STRIP (sits atop the Day view) ─────────────────────────────────────
  // The 7 days of the current week as tappable chips with appt dots — tap or
  // swipe to change the day, exactly like Apple's day-view header.
  const renderWeekStrip = () => {
    const weekStart = startOfWeek(currentDate);
    const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
    const selectedStr = formatDateForDb(currentDate);
    return (
      <div className="grid grid-cols-7 border-b border-[#1a1a1a] bg-[#0c0c0c] flex-shrink-0">
        {weekDays.map(day => {
          const dateStr = formatDateForDb(day);
          const isSel = dateStr === selectedStr;
          const today = isToday(day);
          const count = appointments.filter(a => a.date === dateStr && a.status !== "cancelled" && a.status !== "no-show").length;
          return (
            <button key={dateStr} onClick={() => { setNavDir(dateStr >= selectedStr ? 1 : -1); setCurrentDate(day); }}
              className="py-1.5 text-center hover:bg-[#141414] transition-colors">
              <p className={cn("text-[10px] uppercase tracking-wider", today ? "text-amber-400" : "text-[#666]")}>
                {day.toLocaleDateString("en-CA", { weekday: "narrow" })}
              </p>
              <p className={cn(
                "text-sm font-bold mt-0.5 inline-flex items-center justify-center w-8 h-8 rounded-full transition-colors",
                isSel ? "bg-amber-500 text-white" : today ? "text-amber-400" : "text-white",
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
    );
  };

  // ── YEAR VIEW ───────────────────────────────────────────────────────────────
  // 12 mini-months; tap one to drop into that Month. Days with appointments are
  // brightened, today is the amber pill — the same language as Apple's year grid.
  const renderYearView = () => {
    const year = currentDate.getFullYear();
    const todayStr = formatDateForDb(new Date());
    const apptDays = new Set(
      appointments.filter(a => a.status !== "cancelled" && a.date.startsWith(`${year}-`)).map(a => a.date),
    );
    return (
      <div className="overflow-auto h-full px-4 py-4">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-4 gap-y-6">
          {Array.from({ length: 12 }, (_, m) => {
            const first = new Date(year, m, 1);
            const gridStart = addDays(first, -first.getDay());
            const monthEnd = new Date(year, m + 1, 0);
            const weeks = Math.ceil((monthEnd.getDate() + first.getDay()) / 7);
            const cells = Array.from({ length: weeks * 7 }, (_, i) => addDays(gridStart, i));
            return (
              <button key={m} onClick={() => openMonth(first)}
                className="text-left rounded-xl p-1.5 hover:bg-[#0f0f0f] transition-colors">
                <p className="text-sm font-bold text-amber-400 mb-1 px-0.5">
                  {first.toLocaleDateString("en-CA", { month: "long" })}
                </p>
                <div className="grid grid-cols-7 gap-y-0.5">
                  {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
                    <span key={`h${i}`} className="text-[8px] text-[#555] text-center">{d}</span>
                  ))}
                  {cells.map((d, i) => {
                    const inMonth = d.getMonth() === m;
                    const ds = formatDateForDb(d);
                    const isTodayCell = ds === todayStr;
                    const has = apptDays.has(ds);
                    return (
                      <span key={`d${i}`} className={cn(
                        "text-[9px] leading-[15px] h-[15px] w-[15px] mx-auto text-center rounded-full",
                        !inMonth ? "text-transparent"
                          : isTodayCell ? "bg-amber-500 text-white font-bold"
                          : has ? "text-white font-semibold"
                          : "text-[#777]",
                      )}>
                        {d.getDate()}
                      </span>
                    );
                  })}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    );
  };

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
        <div className="grid grid-cols-7 border-b border-[#1a1a1a] bg-[#0c0c0c]">
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(d => (
            <div key={d} className="px-2 py-2 text-xs font-medium text-[#666] text-center">{d}</div>
          ))}
        </div>
        <div className="grid grid-cols-7 flex-1 auto-rows-fr">
          {visibleDays.map((day) => {
            const inMonth = isSameMonth(day, currentDate);
            const dayStr = formatDateForDb(day);
            const dayAppts = apptsByDate.get(dayStr) ?? [];
            const visible = dayAppts.slice(0, 4);
            const overflow = dayAppts.length - visible.length;
            return (
              <button
                key={dayStr}
                onClick={() => openDay(day)}
                className={cn(
                  "border-r border-b border-[#161616] p-1 sm:p-1.5 text-left flex flex-col gap-1 transition-colors",
                  embedded ? "min-h-[58px] sm:min-h-[88px]" : "min-h-[96px] sm:min-h-[132px]",
                  "hover:bg-[#141414]",
                  !inMonth && "bg-[#070707]",
                )}
              >
                <div className="flex items-center justify-between">
                  <span className={cn(
                    "text-xs font-medium w-6 h-6 rounded-full flex items-center justify-center",
                    isToday(day) ? "bg-amber-500 text-white font-bold" :
                    inMonth ? "text-white" : "text-[#444]",
                  )}>
                    {day.getDate()}
                  </span>
                </div>
                {isToday(day) && <span className="text-[9px] font-bold uppercase tracking-wide text-amber-400 leading-none">Today</span>}
                {isMobile ? (
                  // Phones: just colored dots per booking; cell is too narrow for chip text
                  <div className="flex flex-wrap gap-0.5 overflow-hidden">
                    {dayAppts.slice(0, 10).map(a => (
                      <span key={a.id} className={cn("w-1.5 h-1.5 rounded-full", statusDot(a.status))} />
                    ))}
                    {dayAppts.length > 10 && (
                      <span className="text-[9px] text-[#666] leading-none">+{dayAppts.length - 10}</span>
                    )}
                  </div>
                ) : (
                  <div className="flex flex-col gap-0.5 overflow-hidden">
                    {visible.map(a => (
                      <span key={a.id}
                        className={cn(
                          "truncate text-[10px] leading-4 px-1.5 rounded-sm font-medium",
                          statusChipDark(a.status),
                          isDimmed(a.status) && "line-through opacity-70",
                        )}
                      >
                        {a.time_slot ? `${a.time_slot.replace(/:00 /, " ")} ` : ""}{a.client_name}
                      </span>
                    ))}
                    {overflow > 0 && (
                      <span className="text-[10px] text-[#666] pl-1.5">+{overflow} more</span>
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
    const dayBlocks = blocksFor(barber.id, dateStr);
    // Drop any free slot that falls inside a block window (so it can't be booked
    // over, and the grid shows the block instead).
    const emptySlots = windowEmpties(barber.id, dateStr, { start: startDb, end: endDb })
      .filter(e => { const s = timeToMinutes(e.slot); return !dayBlocks.some(b => s < b.endMin && s + e.minutes > b.startMin); });

    type Cell =
      | { k: "appt"; a: AppointmentWithDetails }
      | { k: "empty"; s: string; minutes: number }
      | { k: "block"; b: (typeof dayBlocks)[number] };
    const cells: Cell[] = [
      ...emptySlots.map(e => ({ k: "empty", s: e.slot, minutes: e.minutes } as Cell)),
      ...dayAppts.map(a => ({ k: "appt", a } as Cell)),
      ...dayBlocks.map(b => ({ k: "block", b } as Cell)),
    ];
    const cellStart = (c: Cell) => c.k === "appt" ? timeToMinutes(c.a.time_slot) : c.k === "empty" ? timeToMinutes(c.s) : c.b.startMin;
    cells.sort((x, y) => cellStart(x) - cellStart(y));

    return (
      <div className="p-4 sm:p-5">
        {!sched && (
          <p className="text-xs text-[#666] mb-3">No schedule set for this day — showing a default 9 AM–10 PM window.</p>
        )}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {cells.map((c, ci) => c.k === "empty" ? (
            <button key={`e${ci}`} onClick={() => openAdd(barber.id, barber.name, c.s, c.minutes)}
              className="rounded-xl bg-[#0f0f0f] hover:bg-[#141414] transition-colors p-3 text-left min-h-[88px] flex flex-col justify-between">
              <span className="text-xs text-[#555]">{rangeLabel(c.s, c.minutes)}</span>
              <span className="text-[10px] text-[#444]">Free</span>
            </button>
          ) : c.k === "block" ? (
            <button key={`b${c.b.id}`} onClick={() => canBlock && removeBlock(c.b)} disabled={!canBlock}
              style={{ backgroundImage: "repeating-linear-gradient(45deg, #151515, #151515 6px, #1c1c1c 6px, #1c1c1c 12px)" }}
              className={cn("rounded-xl p-3 text-left min-h-[88px] flex flex-col justify-between border border-dashed border-[#3a3a3a] transition-colors",
                canBlock ? "hover:border-[#4a4a4a]" : "cursor-default")}>
              <span className="text-xs font-medium text-[#bdbdbd]">{rangeLabel(dbTimeToDisplay(c.b.start_time!), c.b.endMin - c.b.startMin)}</span>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-[#dcdcdc] flex items-center gap-1"><Ban size={12} /> Blocked</p>
                {c.b.reason && <p className="text-[11px] text-[#888] truncate">{c.b.reason}</p>}
              </div>
              <span className={cn("text-[10px] font-semibold", c.b.status === "pending" ? "text-amber-400" : "text-[#888]")}>
                {c.b.status === "pending" ? "Pending approval" : canBlock ? "Tap to remove" : "Blocked"}
              </span>
            </button>
          ) : (
            <button key={c.a.id} onClick={() => setSelectedAppt(c.a)}
              className={cn(
                "rounded-xl p-3 text-left min-h-[88px] flex flex-col justify-between transition-all hover:brightness-125",
                statusBlockDark(c.a.status), isDimmed(c.a.status) && "opacity-60 line-through",
                flashIds.has(c.a.id) && "ring-2 ring-[#00e5a0] animate-pulse",
              )}>
              <span className="text-xs font-medium text-[#999]">{rangeLabel(c.a.time_slot, apptDuration(c.a))}</span>
              <div className="min-w-0">
                <p className="text-sm font-semibold truncate">{c.a.client_name}</p>
                <p className="text-[11px] text-[#999] truncate">
                  {(c.a.services as { name: string } | null)?.name ?? "—"}
                  {(c.a.total_amount ?? 0) > 0 ? ` · $${Number(c.a.total_amount).toFixed(0)}` : ""}
                </p>
              </div>
              {(c.a.payment_status === "paid" || c.a.payment_status === "captured") ? (
                <span className="text-[10px] font-semibold">
                  <span className="text-[#00e5a0]">Paid</span>
                  <span className="text-[#555]"> · </span>
                  <span className={c.a.payment_method === "cash" ? "text-[#bbb]" : "text-[#00e5a0]"}>
                    {c.a.payment_method === "cash" ? "Cash" : c.a.payment_method === "online" ? "Online" : "Card"}
                  </span>
                </span>
              ) : c.a.status === "completed" ? (
                <span className="text-[10px] font-semibold text-[#bbb]">Unpaid</span>
              ) : (
                <span className="text-[10px] font-semibold text-[#888]">{statusLabel(c.a.status)}</span>
              )}
            </button>
          ))}
          {cells.length === 0 && (
            <p className="col-span-full text-center text-sm text-[#666] py-10">Nothing scheduled.</p>
          )}
        </div>
      </div>
    );
  };

  const renderDayView = () => {
    const dateStr = formatDateForDb(currentDate);
    const dayAppts = appointments.filter(a => a.date === dateStr && a.status !== "cancelled");

    // Columns: barber portal / a picked barber / phone → a single column (the
    // header dropdown chooses which); big-screen all-barbers → every scheduled
    // barber (paged if there are a lot). Both render the same vertical timeline.
    const single = !!forceBarberId || barberFilter !== "all" || profile?.role === "barber" || isMobile;
    const soloBarber = barbers.find(b => b.id === dayBarberId) ?? null;
    const allCols = dayAllCols;
    const cols: Barber[] = single
      ? (soloBarber ? [soloBarber] : [])
      : allCols.slice(dayPage * dayPerPage, dayPage * dayPerPage + dayPerPage);

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

    return (
      <div ref={colWrapRef} className="flex flex-col h-full">
        {renderWeekStrip()}
        {!single && unscheduledCount > 0 && (
          <button type="button" onClick={() => setShowUnscheduled(v => !v)}
            className="self-start mx-3 my-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium bg-[#141414] border border-[#1e1e1e] text-[#999] hover:text-white transition-colors flex-shrink-0">
            {showUnscheduled ? `Hide ${unscheduledCount} off today` : `+${unscheduledCount} off today · show`}
          </button>
        )}
        <div ref={scrollRef} className="overflow-y-auto overflow-x-hidden flex-1">
          <div>
            {!single && (
            <div className="grid sticky top-0 z-10 bg-[#0a0a0a] border-b border-[#1a1a1a]" style={{ gridTemplateColumns: `56px repeat(${cols.length}, 1fr)` }}>
              {/* "All barbers" — focused here since we're in the all-barbers view */}
              <button type="button" onClick={() => setBarberFilter("all")}
                className="flex items-center justify-center py-1.5 transition-colors hover:bg-[#141414]">
                <span className={cn("w-7 h-7 rounded-full flex items-center justify-center bg-[#1a1a1a] text-[#aaa]", barberFilter === "all" && "ring-2 ring-[#00e5a0] ring-offset-1 ring-offset-[#0a0a0a]")}>
                  <Users size={14} />
                </span>
              </button>
              {cols.map((b) => {
                const gi = barbers.indexOf(b);
                const n = dayAppts.filter(a => barbers.length === 0 || a.barber_id === b.id).length;
                return (
                  <button key={b.id} type="button" onClick={() => setBarberFilter(b.id)}
                    className="px-2 py-1.5 border-l border-[#161616] hover:bg-[#141414] transition-colors min-w-0">
                    <div className="flex items-center justify-center gap-1.5 min-w-0">
                      <BarberAvatar b={b} i={gi >= 0 ? gi : 0} sm />
                      <span className="text-xs text-white font-medium truncate">{b.name}</span>
                      {!schedules.has(b.id) && <span className="text-[9px] text-[#666] flex-shrink-0" title="No schedule set for today">off</span>}
                    </div>
                    <p className="text-[10px] text-[#666] leading-none mt-0.5 text-center">{n} appt{n === 1 ? "" : "s"}</p>
                  </button>
                );
              })}
            </div>
            )}

          <div className="relative">
            {hours.map(hour => (
              <div key={hour} className="grid border-b border-[#161616] relative" style={{ gridTemplateColumns: `56px repeat(${cols.length}, 1fr)`, height: `${ROW_PX}px` }}>
                <div className="relative text-right pr-2">
                  <span className="text-[10px] text-[#777]">
                    {hour === 0 ? "12 AM" : hour < 12 ? `${hour} AM` : hour === 12 ? "12 PM" : `${hour - 12} PM`}
                  </span>
                </div>
                {cols.map(b => (
                  <div key={b.id} className="border-l border-[#141414]" />
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
                const colBlocks = blocksFor(b.id, dateStr);
                const empties = windowEmpties(b.id, dateStr, gridWin)
                  .filter(e => { const s = timeToMinutes(e.slot); return !colBlocks.some(bl => s < bl.endMin && s + e.minutes > bl.startMin); });
                return (
                  <div key={b.id} className="relative">
                    {/* Free slots — quiet dark space (tap to add; no "+" chrome).
                        In-hours = subtle #141414 fill; outside-hours = bare. */}
                    {empties.map(({ slot, minutes }) => {
                      const top = (parseTime(slot) - winStart) * ROW_PX;
                      const height = Math.max(16, (minutes / 60) * ROW_PX - 4);
                      const outside = isOutsideSchedule(b.id, slot);
                      return (
                        <button key={`e${slot}`}
                          title={outside ? "Outside working hours — tap to add" : "Add appointment"}
                          style={{ top: `${top + 2}px`, height: `${height}px`, left: "4px", right: "4px", position: "absolute" }}
                          className={cn(
                            "rounded-lg transition-colors pointer-events-auto overflow-hidden",
                            outside ? "bg-transparent hover:bg-[#141414]" : "bg-[#141414] hover:bg-[#1c1c1c]",
                          )}
                          onClick={() => openAdd(b.id, b.name, slot, minutes)} />
                      );
                    })}
                    {/* Blocked-hours bands — hatched; tap to remove (if allowed) */}
                    {colBlocks.map(bl => {
                      const top = (bl.startMin / 60 - winStart) * ROW_PX;
                      const height = Math.max(16, ((bl.endMin - bl.startMin) / 60) * ROW_PX - 4);
                      return (
                        <button key={`blk${bl.id}`}
                          title={bl.status === "pending" ? "Block (pending approval)" : "Blocked — tap to remove"}
                          onClick={() => canBlock && removeBlock(bl)} disabled={!canBlock}
                          style={{ top: `${top + 2}px`, height: `${height}px`, left: "4px", right: "4px", position: "absolute",
                            backgroundImage: "repeating-linear-gradient(45deg, #151515, #151515 6px, #1c1c1c 6px, #1c1c1c 12px)" }}
                          className={cn("rounded-lg border border-dashed pointer-events-auto overflow-hidden px-1.5 py-0.5 text-left",
                            bl.status === "pending" ? "border-amber-500/50" : "border-[#3a3a3a]")}>
                          <p className="text-[9px] font-semibold text-[#cfcfcf] flex items-center gap-0.5 leading-tight"><Ban size={9} /> Blocked</p>
                          {height > 28 && <p className="text-[8px] text-[#999] truncate leading-tight">{dbTimeToDisplay(bl.start_time!)}–{dbTimeToDisplay(bl.end_time!)}</p>}
                          {bl.reason && height > 44 && <p className="text-[8px] text-[#888] truncate leading-tight">{bl.reason}</p>}
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
                            "rounded-r-lg rounded-l-sm px-1.5 py-0.5 text-left overflow-hidden pointer-events-auto transition-all hover:z-10 hover:brightness-125",
                            statusBlockDark(appt.status),
                            dimmed && "opacity-60 line-through",
                            flashIds.has(appt.id) && "ring-2 ring-[#00e5a0] animate-pulse z-10",
                          )}
                          onClick={() => setSelectedAppt(appt)}
                        >
                          <p className="text-[11px] font-semibold truncate leading-tight">{appt.client_name}</p>
                          {height > 24 && (
                            <div className="flex items-baseline justify-between gap-1.5 leading-tight">
                              <span className="text-[9px] text-[#bbb] truncate">{rangeLabel(appt.time_slot, duration)}</span>
                              <span className="text-[8px] font-normal flex-shrink-0 whitespace-nowrap opacity-90">
                                {paymentTag(appt).segments.map((s, i) => (
                                  <Fragment key={i}>
                                    {i > 0 && <span className="text-[#555]">·</span>}
                                    <span className={s.className}>{s.text}</span>
                                  </Fragment>
                                ))}
                              </span>
                            </div>
                          )}
                          {height > 64 && (
                            <p className="text-[9px] text-[#999] truncate leading-tight">
                              {(appt.services as { name: string } | null)?.name ?? "—"}
                              {(appt.total_amount ?? 0) > 0 ? ` · $${Number(appt.total_amount).toFixed(0)}` : ""}
                            </p>
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
      // Visible hour window — start at business hours, not 12 AM.
      const mwStarts: number[] = [], mwEnds: number[] = [];
      dayAppts.forEach(a => { const s = parseTime(a.time_slot); mwStarts.push(s); mwEnds.push(s + apptDuration(a) / 60); });
      blocks.filter(b => b.start_date === selectedStr && b.start_time && b.end_time).forEach(b => {
        mwStarts.push(timeToMinutes(dbTimeToDisplay(b.start_time!)) / 60);
        mwEnds.push(timeToMinutes(dbTimeToDisplay(b.end_time!)) / 60);
      });
      const { winStart, hours } = hourWindow(mwStarts, mwEnds);
      return (
        <div className="flex flex-col h-full">
          {/* Date strip — tap to switch day */}
          <div className="grid grid-cols-7 border-b border-[#1a1a1a] bg-[#0c0c0c] flex-shrink-0">
            {weekDays.map(day => {
              const dateStr = formatDateForDb(day);
              const isSelected = dateStr === selectedStr;
              const today = isToday(day);
              const count = appointments.filter(a => a.date === dateStr && a.status !== "cancelled" && a.status !== "no-show").length;
              return (
                <button key={dateStr} onClick={() => { setNavDir(formatDateForDb(day) >= formatDateForDb(currentDate) ? 1 : -1); setCurrentDate(day); }}
                  className="py-2 text-center hover:bg-[#141414] transition-colors">
                  <p className={cn("text-[10px] uppercase tracking-wider", today ? "text-white" : "text-[#666]")}>
                    {day.toLocaleDateString("en-CA", { weekday: "narrow" })}
                  </p>
                  <p className={cn(
                    "text-base font-bold mt-0.5 inline-flex items-center justify-center w-8 h-8 rounded-full",
                    isSelected ? "bg-amber-500 text-white" : "text-white",
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
              {hours.map(hour => (
                <div key={hour} className="grid border-b border-[#161616]" style={{ gridTemplateColumns: `48px 1fr`, height: `${ROW_PX}px` }}>
                  <div className="text-[10px] text-[#777] text-right pr-2 pt-1">
                    {hour === 0 ? "12 AM" : hour < 12 ? `${hour} AM` : hour === 12 ? "12 PM" : `${hour - 12} PM`}
                  </div>
                  <div className="border-l border-[#141414]" />
                </div>
              ))}
              <div className="absolute inset-0 pointer-events-none" style={{ display: "grid", gridTemplateColumns: `48px 1fr` }}>
                <div />
                <div className="relative">
                  {dayAppts.map(appt => {
                    const startH = parseTime(appt.time_slot);
                    const duration = apptDuration(appt);
                    const top = (startH - winStart) * ROW_PX;
                    const height = Math.max(36, (duration / 60) * ROW_PX - 4);
                    const barber = barbers.find(b => b.id === appt.barber_id);
                    const dimmed = isDimmed(appt.status);
                    return (
                      <button
                        key={appt.id}
                        style={{ top: `${top + 2}px`, height: `${height}px`, left: "6px", right: "6px", position: "absolute" }}
                        className={cn(
                          "rounded-r-lg rounded-l-sm px-2.5 py-1.5 text-left overflow-hidden pointer-events-auto",
                          statusBlockDark(appt.status),
                          dimmed && "opacity-60 line-through",
                        )}
                        onClick={() => setSelectedAppt(appt)}
                      >
                        <p className="text-xs font-semibold truncate leading-tight">{appt.time_slot} · {appt.client_name}</p>
                        {height > 44 && (
                          <p className="text-[11px] text-[#999] truncate">
                            {(appt.services as { name: string } | null)?.name} · {barber?.name ?? "Any"}
                          </p>
                        )}
                      </button>
                    );
                  })}
                  {blocks.filter(b => b.start_date === selectedStr && b.start_time && b.end_time).map(b => {
                    const sMin = timeToMinutes(dbTimeToDisplay(b.start_time!));
                    const eMin = timeToMinutes(dbTimeToDisplay(b.end_time!));
                    const top = (sMin / 60 - winStart) * ROW_PX;
                    const height = Math.max(16, ((eMin - sMin) / 60) * ROW_PX - 4);
                    return (
                      <button key={`wmb${b.id}`} title={b.status === "pending" ? "Block (pending approval)" : "Blocked — tap to remove"}
                        onClick={() => canBlock && removeBlock(b)} disabled={!canBlock}
                        style={{ top: `${top + 2}px`, height: `${height}px`, left: "6px", right: "6px", position: "absolute",
                          backgroundImage: "repeating-linear-gradient(45deg, #151515, #151515 6px, #1c1c1c 6px, #1c1c1c 12px)" }}
                        className={cn("rounded-lg border border-dashed pointer-events-auto overflow-hidden px-2 py-1 text-left", b.status === "pending" ? "border-amber-500/50" : "border-[#3a3a3a]")}>
                        <p className="text-xs font-semibold text-[#cfcfcf] truncate leading-tight flex items-center gap-1"><Ban size={11} /> Blocked</p>
                        {height > 30 && <p className="text-[11px] text-[#999] truncate leading-tight">{dbTimeToDisplay(b.start_time!)} – {dbTimeToDisplay(b.end_time!)}{b.reason ? ` · ${b.reason}` : ""}</p>}
                      </button>
                    );
                  })}
                </div>
              </div>
              {isToday(currentDate) && (() => {
                const now = new Date();
                const currentH = now.getHours() + now.getMinutes() / 60;
                const top = (currentH - winStart) * ROW_PX;
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

    // Visible hour window across the whole week — start at business hours.
    const weekStrs = new Set(weekDays.map(formatDateForDb));
    const weekAppts = appointments.filter(a => weekStrs.has(a.date) && a.status !== "cancelled");
    const wwStarts: number[] = [], wwEnds: number[] = [];
    weekAppts.forEach(a => { const s = parseTime(a.time_slot); wwStarts.push(s); wwEnds.push(s + apptDuration(a) / 60); });
    blocks.filter(b => weekStrs.has(b.start_date) && b.start_time && b.end_time).forEach(b => {
      wwStarts.push(timeToMinutes(dbTimeToDisplay(b.start_time!)) / 60);
      wwEnds.push(timeToMinutes(dbTimeToDisplay(b.end_time!)) / 60);
    });
    const { winStart, hours } = hourWindow(wwStarts, wwEnds);

    return (
      <div ref={scrollRef} className="overflow-auto h-full">
        <div className="min-w-[700px]">
          <div className="grid sticky top-0 z-10 bg-[#0a0a0a] border-b border-[#1a1a1a]" style={{ gridTemplateColumns: `56px repeat(7, 1fr)` }}>
            <div />
            {weekDays.map(day => {
              const dateStr = formatDateForDb(day);
              const dayAppts = appointments.filter(a => a.date === dateStr && a.status !== "cancelled");
              const today = isToday(day);
              return (
                <button key={dateStr} onClick={() => openDay(day)}
                  className={cn("py-2 text-center border-l border-[#161616] hover:bg-[#141414] transition-colors", today && "bg-amber-500/10")}>
                  <p className={cn("text-[10px] uppercase tracking-wider", today ? "text-white" : "text-[#666]")}>
                    {day.toLocaleDateString("en-CA", { weekday: "short" })}
                  </p>
                  <p className={cn(
                    "text-lg font-bold mt-0.5 inline-flex items-center justify-center w-8 h-8 rounded-full",
                    today ? "bg-amber-500 text-white" : "text-white",
                  )}>
                    {day.getDate()}
                  </p>
                  {dayAppts.length > 0 && (
                    <p className="text-[10px] text-[#666] mt-0.5">{dayAppts.length}</p>
                  )}
                </button>
              );
            })}
          </div>

          <div className="relative">
            {hours.map(hour => (
              <div key={hour} className="grid border-b border-[#161616]" style={{ gridTemplateColumns: `56px repeat(7, 1fr)`, height: `${ROW_PX}px` }}>
                <div className="text-[10px] text-[#777] text-right pr-2 pt-1">
                  {hour === 0 ? "12 AM" : hour < 12 ? `${hour} AM` : hour === 12 ? "12 PM" : `${hour - 12} PM`}
                </div>
                {weekDays.map(day => (
                  <div key={formatDateForDb(day)} className={cn("border-l border-[#141414]", isToday(day) && "bg-amber-500/10")} />
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
                      const top = (startH - winStart) * ROW_PX;
                      const height = Math.max(22, (duration / 60) * ROW_PX - 3);
                      const dimmed = appt.status === "cancelled" || appt.status === "no-show";
                      return (
                        <button
                          key={appt.id}
                          style={{ top: `${top + 2}px`, height: `${height}px`, left: "2px", right: "2px", position: "absolute" }}
                          className={cn(
                            "rounded-r rounded-l-sm px-1.5 py-0.5 text-left overflow-hidden pointer-events-auto transition-all hover:z-10 hover:brightness-125",
                            statusBlockDark(appt.status),
                            dimmed && "opacity-60 line-through",
                          )}
                          onClick={() => setSelectedAppt(appt)}
                        >
                          <p className="text-[11px] font-semibold leading-tight truncate">{appt.client_name}</p>
                          {height > 36 && (
                            <p className="text-[10px] text-[#999] truncate">{appt.time_slot}</p>
                          )}
                        </button>
                      );
                    })}
                    {blocks.filter(b => b.start_date === dateStr && b.start_time && b.end_time).map(b => {
                      const sMin = timeToMinutes(dbTimeToDisplay(b.start_time!));
                      const eMin = timeToMinutes(dbTimeToDisplay(b.end_time!));
                      const top = (sMin / 60 - winStart) * ROW_PX;
                      const height = Math.max(14, ((eMin - sMin) / 60) * ROW_PX - 3);
                      return (
                        <button key={`wb${b.id}`} title={b.status === "pending" ? "Block (pending approval)" : "Blocked — tap to remove"}
                          onClick={() => canBlock && removeBlock(b)} disabled={!canBlock}
                          style={{ top: `${top + 2}px`, height: `${height}px`, left: "2px", right: "2px", position: "absolute",
                            backgroundImage: "repeating-linear-gradient(45deg, #151515, #151515 6px, #1c1c1c 6px, #1c1c1c 12px)" }}
                          className={cn("rounded border border-dashed pointer-events-auto overflow-hidden px-1", b.status === "pending" ? "border-amber-500/50" : "border-[#3a3a3a]")}>
                          <p className="text-[10px] font-semibold text-[#cfcfcf] truncate leading-tight flex items-center gap-0.5"><Ban size={9} /> Blocked</p>
                          {height > 32 && <p className="text-[9px] text-[#999] truncate leading-tight">{dbTimeToDisplay(b.start_time!)}–{dbTimeToDisplay(b.end_time!)}</p>}
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
              const top = (currentH - winStart) * ROW_PX;
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

  // ── Layout — dark calendar canvas inside the app's dark chrome ───────────────
  // Day-view barber pager, lifted to component scope so it can live in the top
  // toolbar (one compact row instead of its own band).
  // Owner's own barber leads; the rest keep their fetched (alphabetical) order.
  // BOTH the selector chips and the day columns use this exact order, so
  // switching all-barbers ↔ single-barber never reshuffles positions.
  const orderedBarbers = isolated
    ? barbers.filter(b => b.id === forceBarberId)
    : barbers.length > 0
      ? [...barbers].sort((a, b) => Number(b.id === myBarberId) - Number(a.id === myBarberId))
      : [];
  // Day view: hide barbers with no hours today by default; the "off today" chip
  // reveals them. If NOBODY is scheduled, fall back to everyone (never blank).
  const scheduledBarbers = orderedBarbers.filter(b => schedules.has(b.id));
  const unscheduledCount = orderedBarbers.length - scheduledBarbers.length;
  const dayCols = (showUnscheduled || scheduledBarbers.length === 0) ? orderedBarbers : scheduledBarbers;
  const dayAllCols = dayCols.length > 0
    ? dayCols
    : [{ id: "none", name: "All Barbers" } as Barber];
  // Phone: exactly one barber column per page (swipe to the next). Tablet /
  // desktop: fit as many columns as the width allows (all barbers for a typical
  // shop; only paginates if there are a lot).
  const dayPerPage = isMobile
    ? 1
    : (colWrapW > 0 ? Math.max(1, Math.floor((colWrapW - 56) / 150)) : 6);
  const dayPages = Math.max(1, Math.ceil(dayAllCols.length / dayPerPage));
  const dayPage = Math.max(0, Math.min(colPage, dayPages - 1));
  // Big-screen-only barber pager (phone uses the header dropdown instead).
  const dayPagerVisible = !isolated && !isMobile && view === "day" && barberFilter === "all" && profile?.role !== "barber" && dayPages > 1;
  // The single barber a phone / filtered day view shows (header dropdown value).
  const dayBarberId = forceBarberId ?? (barberFilter !== "all" ? barberFilter : (myBarberId ?? scheduledBarbers[0]?.id ?? orderedBarbers[0]?.id ?? null));

  // ── Navigation: within-level (swipe / arrows) moves by the view's unit;
  // drilling down / the back arrow walk the Year ⇄ Month ⇄ Day hierarchy. ─────
  const goPeriod = (dir: number) => {
    setNavDir(dir);
    if (view === "year") setCurrentDate(d => addMonths(d, dir * 12));
    else if (view === "month") setCurrentDate(d => addMonths(d, dir));
    else setCurrentDate(d => addDays(d, dir));
  };
  const openMonth = (day: Date) => { setNavDir(0); setCurrentDate(day); setView("month"); };
  const openDay = (day: Date) => { setNavDir(0); setCurrentDate(day); setView("day"); };
  // Back arrow → up one level (Day → Month → Year).
  const goBack = () => {
    setNavDir(0);
    if (view === "day") setView("month");
    else if (view === "month") setView("year");
  };
  // Key that re-triggers the transition whenever the visible period changes.
  const periodKey = view === "year"
    ? `y${currentDate.getFullYear()}`
    : view === "month"
      ? `m${currentDate.getFullYear()}-${currentDate.getMonth()}`
      : `d${formatDateForDb(currentDate)}`;
  const transitionKey = `${view}:${periodKey}`;

  // Calendar-wide horizontal swipe → previous/next period. Vertical drags fall
  // through to the timeline's normal scroll (we only act on mostly-horizontal).
  const onSwipeStart = (e: React.TouchEvent) => {
    const t = e.touches[0];
    swipeRef.current = { x: t.clientX, y: t.clientY };
  };
  const onSwipeEnd = (e: React.TouchEvent) => {
    const s = swipeRef.current; swipeRef.current = null;
    if (!s) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - s.x, dy = t.clientY - s.y;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.4) goPeriod(dx < 0 ? 1 : -1);
  };

  return (
    <div className={cn("flex flex-col h-full bg-[#0a0a0a] text-white overflow-x-clip", !embedded && "min-h-[100dvh]")}>
      {/* Header — back arrow (up a level) + title (left) · barber + Today (right) */}
      <div className="px-4 sm:px-6 py-2 border-b border-[#1a1a1a] flex items-center justify-between gap-3">
        <div className="flex items-center gap-1.5 min-w-0">
          {backLabel && (
            <button onClick={goBack} aria-label={`Back to ${backLabel}`}
              className="flex items-center gap-0.5 text-sm font-medium text-[#9a9a9a] hover:text-white transition-colors flex-shrink-0 -ml-1">
              <ChevronLeft size={18} /> {backLabel}
            </button>
          )}
          <h2 className="text-base sm:text-lg font-bold text-white truncate">{titleText}</h2>
          {loading && <span className="text-xs text-[#666] animate-pulse flex-shrink-0">…</span>}
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          {/* Phone day view: pick which barber's column shows */}
          {view === "day" && isMobile && !forceBarberId && profile?.role !== "barber" && barbers.length > 1 && (
            <select value={dayBarberId ?? ""} onChange={e => setBarberFilter(e.target.value)} aria-label="Choose barber"
              className="max-w-[8.5rem] truncate bg-[#141414] border border-[#1e1e1e] rounded-lg px-2 py-1.5 text-xs text-white focus:outline-none focus:border-white">
              {orderedBarbers.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          )}
          {/* Big-screen day: page barber columns when there are a lot */}
          {dayPagerVisible && (
            <div className="flex items-center gap-0.5 text-[#888]">
              <button onClick={() => setColPage(p => Math.max(0, p - 1))} disabled={dayPage === 0} aria-label="Previous barbers"
                className="p-1 rounded hover:bg-[#141414] disabled:opacity-30 disabled:hover:bg-transparent"><ChevronLeft size={16} /></button>
              <button onClick={() => setColPage(p => Math.min(dayPages - 1, p + 1))} disabled={dayPage >= dayPages - 1} aria-label="More barbers"
                className="p-1 rounded hover:bg-[#141414] disabled:opacity-30 disabled:hover:bg-transparent"><ChevronRight size={16} /></button>
            </div>
          )}
          <button onClick={() => { setNavDir(0); setCurrentDate(new Date()); }}
            className="px-2.5 py-1.5 text-xs font-medium text-[#ccc] border border-[#1e1e1e] bg-[#141414] rounded-lg hover:bg-[#1a1a1a] hover:text-white transition-colors">
            Today
          </button>
        </div>
      </div>

      {/* Barber selector row — profile-pic chips incl. an "All barbers" chip.
          Shown on the month/year overviews to filter; the day view has its own
          selection (columns on desktop, a dropdown on phone). */}
      {!isolated && profile?.role !== "barber" && barbers.length > 0 && view !== "day" && (
        <div className="flex gap-3 overflow-x-auto px-4 sm:px-6 py-3 border-b border-[#1a1a1a] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <button onClick={() => setBarberFilter("all")}
            className={cn("flex flex-col items-center gap-1 flex-shrink-0 w-16 py-1.5 transition-opacity", barberFilter === "all" ? "opacity-100" : "opacity-60 hover:opacity-100")}>
            <span className={cn("w-11 h-11 rounded-full flex items-center justify-center bg-[#1a1a1a] text-[#aaa]", barberFilter === "all" && "ring-2 ring-[#00e5a0] ring-offset-2 ring-offset-[#0a0a0a]")}>
              <Users size={18} />
            </span>
            <span className={cn("text-[10px] truncate w-full text-center", barberFilter === "all" ? "text-[#00e5a0] font-semibold" : "text-[#888]")}>All barbers</span>
          </button>
          {orderedBarbers.map((b) => (
            <button key={b.id} onClick={() => setBarberFilter(b.id)}
              className={cn("flex flex-col items-center gap-1 flex-shrink-0 w-16 py-1.5 transition-opacity", barberFilter === b.id ? "opacity-100" : "opacity-60 hover:opacity-100")}>
              <span className={cn("rounded-full", barberFilter === b.id && "ring-2 ring-[#00e5a0] ring-offset-2 ring-offset-[#0a0a0a]")}>
                <BarberAvatar b={b} i={barbers.indexOf(b)} />
              </span>
              <span className={cn("text-[10px] truncate w-full text-center", barberFilter === b.id ? "text-[#00e5a0] font-semibold" : "text-[#888]")}>{b.name}</span>
            </button>
          ))}
        </div>
      )}

      <div
        className={cn("relative flex-1 bg-[#0a0a0a]", embedded ? "overflow-y-auto" : "overflow-hidden")}
        onTouchStart={onSwipeStart}
        onTouchEnd={onSwipeEnd}
      >
        <MotionConfig reducedMotion="user">
          <AnimatePresence mode="popLayout" custom={navDir} initial={false}>
            <motion.div
              key={transitionKey}
              custom={navDir}
              variants={calVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={calTransition}
              className="h-full w-full"
              style={{ willChange: "transform, opacity" }}
            >
              {view === "year" ? renderYearView() : view === "month" ? renderMonthView() : renderDayView()}
            </motion.div>
          </AnimatePresence>
        </MotionConfig>
      </div>

      {selectedAppt && (
        <Portal>
          <ApptDetail
            appt={selectedAppt}
            barbers={barbers}
            onClose={() => setSelectedAppt(null)}
            actions={apptActions}
            busy={actionBusy}
            readOnly={!canManage}
          />
        </Portal>
      )}

      {toast && (
        <Portal>
          <div className="fixed bottom-6 right-6 z-[100] bg-[#141414] border border-[#1e1e1e] rounded-xl px-5 py-3 text-sm text-white shadow-xl flex items-center gap-3">
            <span className="text-white">✓</span>{toast}
            <button onClick={() => setToast("")} className="text-[#777] hover:text-white ml-2">✕</button>
          </div>
        </Portal>
      )}

      {/* Quick-add appointment (DARK overlay) — opened from a "+" empty slot.
          Barber, date and time are fixed by the slot; the owner just picks a
          client + service. */}
      {addCtx && (
        <Portal>
          <div className="fixed inset-0 bg-black/60 z-[70]" onClick={() => !savingAdd && setAddCtx(null)} />
          <div className="fixed inset-0 z-[80] flex items-center justify-center p-4 overflow-y-auto overscroll-contain [&>*]:my-auto">
            <div className="bg-black shadow-sm border border-[#1e1e1e] rounded-2xl p-6 w-full max-w-sm space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-bold text-white">{addMode === "block" ? "Block time" : "New appointment"}</h3>
                <button onClick={() => !savingAdd && !blockBusy && setAddCtx(null)} className="text-[#777] hover:text-white"><X size={18} /></button>
              </div>
              {/* Appointment / Block toggle — only when the user can do both */}
              {canManage && canBlock && (
                <div className="grid grid-cols-2 gap-1 p-1 bg-[#141414] rounded-xl">
                  <button type="button" onClick={() => setAddMode("appt")}
                    className={cn("py-1.5 rounded-lg text-sm font-medium transition-colors", addMode === "appt" ? "bg-white text-black" : "text-[#888] hover:text-white")}>Appointment</button>
                  <button type="button" onClick={() => setAddMode("block")}
                    className={cn("py-1.5 rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-1.5", addMode === "block" ? "bg-white text-black" : "text-[#888] hover:text-white")}><Ban size={14} /> Block</button>
                </div>
              )}
              <div className="bg-[#141414] rounded-xl p-3 text-xs text-[#aaa] space-y-0.5">
                <p><span className="text-[#777]">Barber:</span> {addCtx.barberName}</p>
                <p><span className="text-[#777]">When:</span> {friendlyDate(currentDate)}</p>
              </div>
              {addMode === "block" ? (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="text-[10px] uppercase tracking-wide text-[#777]">From</label>
                      <input type="time" value={blockForm.start} max={blockForm.end || undefined}
                        onChange={e => setBlockForm(f => ({ ...f, start: e.target.value }))}
                        className="w-full bg-[#141414] border border-[#1e1e1e] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-white [color-scheme:dark]" />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] uppercase tracking-wide text-[#777]">To</label>
                      <input type="time" value={blockForm.end} min={blockForm.start || undefined}
                        onChange={e => setBlockForm(f => ({ ...f, end: e.target.value }))}
                        className="w-full bg-[#141414] border border-[#1e1e1e] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-white [color-scheme:dark]" />
                    </div>
                  </div>
                  <input type="text" value={blockForm.reason} onChange={e => setBlockForm(f => ({ ...f, reason: e.target.value }))}
                    placeholder="Reason (optional) — e.g. Lunch"
                    className="w-full bg-[#141414] border border-[#1e1e1e] rounded-lg px-3 py-2 text-sm text-white placeholder:text-[#666] focus:outline-none focus:border-white" />
                  <p className="text-[11px] text-[#888] flex items-start gap-1.5">
                    <span className="text-amber-400 mt-0.5">ⓘ</span>
                    {profile?.role === "shop_owner" ? "Blocks this time immediately." : "Sends your shop owner a request to approve."}
                  </p>
                  <div className="flex gap-2 pt-1">
                    <Button variant="outline" className="flex-1" disabled={blockBusy} onClick={() => setAddCtx(null)}>Cancel</Button>
                    <Button className="flex-1" loading={blockBusy}
                      disabled={!blockForm.start || !blockForm.end || blockForm.end <= blockForm.start}
                      onClick={submitBlock}>
                      {profile?.role === "shop_owner" ? "Block" : "Request block"}
                    </Button>
                  </div>
                </>
              ) : (
              <>
              <Input label="Client name *" value={addForm.client_name}
                onChange={e => setAddForm(p => ({ ...p, client_name: e.target.value }))} placeholder="Marcus Johnson" />
              <Input label="Phone" value={addForm.client_phone}
                onChange={e => setAddForm(p => ({ ...p, client_phone: e.target.value }))} placeholder="506-555-0000" />
              {/* Services first — dropdown rows; "+" adds another for a combined appointment */}
              <div>
                <label className="block text-xs font-medium text-[#aaa] mb-1">Services * <span className="text-[#666] font-normal">(add one or more)</span></label>
                <div className="space-y-2">
                  {(addForm.service_ids.length ? addForm.service_ids : [""]).map((sid, idx) => {
                    const windowLen = addWindow ? addWindow.freeUntil - addWindow.boxStart : Infinity;
                    const otherDur = addForm.service_ids.reduce((n, id, i) => i === idx ? n : n + (svcById(id)?.duration_minutes || 0), 0);
                    return (
                      <div key={idx} className="flex gap-2 items-center">
                        <Select value={sid} className="flex-1" onChange={e => setServiceAt(idx, e.target.value)}>
                          <option value="">Select a service</option>
                          {services.map(s => {
                            const wontFit = s.id !== sid && otherDur + s.duration_minutes > windowLen;
                            return <option key={s.id} value={s.id} disabled={wontFit}>{s.name} · ${Number(s.price).toFixed(0)} · {s.duration_minutes}m{wontFit ? " — won't fit" : ""}</option>;
                          })}
                        </Select>
                        {(addForm.service_ids.length > 1 || !!sid) && (
                          <button type="button" onClick={() => removeServiceRow(idx)} aria-label="Remove service"
                            className="w-9 h-9 flex-shrink-0 rounded-xl border border-[#1e1e1e] text-[#777] hover:text-white hover:border-white flex items-center justify-center">
                            <X size={15} />
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
                <button type="button" onClick={addServiceRow}
                  className="mt-2 inline-flex items-center gap-1.5 text-sm font-medium text-amber-400 hover:text-amber-300">
                  <Plus size={15} /> Add another service
                </button>
                {addForm.service_ids.filter(Boolean).length > 0 && (
                  <p className="text-xs text-[#aaa] mt-1.5">Total: {addTotalDuration} min · ${addTotalPrice.toFixed(0)}</p>
                )}
              </div>
              <Select label="Time" value={addForm.time}
                onChange={e => setAddForm(p => ({ ...p, time: e.target.value }))}>
                {addTimeOptions.map(t => {
                  const tooLong = !!addWindow && addTotalDuration > 0 && timeToMinutes(t) + addTotalDuration > addWindow.freeUntil;
                  return <option key={t} value={t} disabled={tooLong}>{t}{tooLong ? " — won't fit" : ""}</option>;
                })}
              </Select>
              {isOutsideSchedule(addCtx.barberId, addForm.time) && (
                <p className="text-xs text-amber-400">
                  ⚠️ {schedules.has(addCtx.barberId)
                    ? `Outside ${addCtx.barberName}'s working hours.`
                    : `${addCtx.barberName} has no schedule set for this day.`}
                </p>
              )}
              <div className="flex gap-2 pt-1">
                <Button variant="outline" className="flex-1" disabled={savingAdd} onClick={() => setAddCtx(null)}>Cancel</Button>
                <Button className="flex-1" loading={savingAdd} onClick={createAppointment}>Add</Button>
              </div>
              </>
              )}
            </div>
          </div>
        </Portal>
      )}
    </div>
  );
}
