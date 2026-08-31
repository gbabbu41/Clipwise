"use client";
import { useState, useEffect, useCallback, useRef, useMemo, Fragment, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence, MotionConfig } from "framer-motion";
import { ChevronDown, ChevronLeft, ChevronRight, X, Plus, Users, Ban, LayoutGrid, Clock, Phone, Mail, MessageSquare, Search, Check, Scissors } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/lib/supabase";
import { DashboardHeader } from "@/components/dashboard/page-header";
import { useConfirm } from "@/components/ui/confirm-dialog";
import {
  cn, formatCurrency, formatDateForDb, friendlyDate, timeAgo, paymentTag,
  occupiedSlots, dbTimeToDisplay, timeToMinutes, generate24hSlots,
  isCheckoutAllowed, CHECKOUT_LEAD_HOURS,
} from "@/lib/utils";
import { freesSlot, apptDuration } from "@/lib/availability";
import { clientMatchesQuery } from "@/lib/client-search";
import { safeTz, todayInTz, nowMinutesInTz } from "@/lib/timezone";
import { clampNoShowPct, NO_SHOW_LEAD_MINUTES, formatPhone } from "@/lib/validation";

// 15-minute slot grid (display strings) for the appointment-edit time picker —
// keeps edited times on the slot windows instead of a free-form "5:03 PM".
const EDIT_TIME_SLOTS = generate24hSlots(15);
// Round any time to the nearest 15-min slot (so an off-grid booking snaps onto
// the grid), returned as a display string that matches EDIT_TIME_SLOTS.
function snapToSlot(slot: string): string {
  const snapped = Math.min(Math.round(timeToMinutes(slot) / 15) * 15, 23 * 60 + 45);
  const hh = String(Math.floor(snapped / 60)).padStart(2, "0");
  const mm = String(snapped % 60).padStart(2, "0");
  return dbTimeToDisplay(`${hh}:${mm}`);
}
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { useSheetDrag } from "@/hooks/use-sheet-drag";
import {
  sendApprovalNotifications,
  runCompletionEffects,
  notifyFreedSlot,
  sendRejectionEmail,
  sendNoShowFollowup,
} from "@/lib/appointment-actions";
import type { AppointmentWithDetails, Barber, Shop } from "@/lib/database.types";

type ServiceLite = { id: string; name: string; price: number; duration_minutes: number };
type ClientLite = { id: string; name: string; phone: string | null; email: string | null; total_visits: number | null };

// Shared field/label look for the quick-add sheet — matches the global add modal
// (quiet sentence-case labels; fields sit on bg-card against the raised sheet).
const ADD_FIELD = "w-full h-12 bg-card border border-border rounded-xl px-3 text-sm text-foreground placeholder:text-grey focus:outline-none focus:border-foreground/40 transition-colors";
const ADD_LABEL = "block text-xs font-medium text-grey mb-1.5";


// Overlays (modals / side sheet) render through the document body so their
// position:fixed always resolves to the viewport — when this calendar is
// embedded (e.g. on the dashboard) an ancestor with a transform/animation would
// otherwise trap fixed positioning and break their layout + dismissal.
export function Portal({ children }: { children: ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  // Wrap in a `.portal` element so these modals inherit the owner/barber theme
  // tokens. Portaling to <body> escapes the `.portal` wrapper in the layout, and
  // the light-theme overrides are scoped to `html[data-theme="light"] .portal` —
  // so without this the modal always renders with the dark defaults even in light
  // theme. `display:contents` = no box, so it can't affect the modal's layout.
  return mounted && typeof document !== "undefined"
    ? createPortal(<div className="portal" style={{ display: "contents" }}>{children}</div>, document.body)
    : null;
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
  pending:   "bg-amber-500/85 text-foreground",
  confirmed: "bg-emerald-500/85 text-foreground",
  completed: "bg-sky-500/85 text-foreground",
  cancelled: "bg-red-500/70 text-foreground",
  "no-show": "bg-zinc-500/70 text-foreground",
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
const statusFill = (s: string) => STATUS_FILL[s] ?? "bg-sky-500/85 text-foreground";
const statusDot = (s: string) => STATUS_DOT[s] ?? "bg-sky-400";
const statusLabel = (s: string) => STATUS_LABEL[s] ?? s;
// VISUAL dimming only (strike-through cancelled / no-show rows). The occupancy
// rule — does a booking still hold its slot — is `freesSlot`/`holdsSlot`, imported
// from @/lib/availability (the ONE source of truth, shared with the server + DB).
const isDimmed = (s: string) => s === "cancelled" || s === "no-show";

// ── Dark palettes (ACTIVE theme) ──────────────────────────────────────────────
// The calendar canvas is now DARK. Appointment blocks use a #1a1a1a fill + a
// status-colored 3px left edge + light text. The LIGHT palettes above are kept
// intact for the planned white-theme toggle — DO NOT delete them.
const STATUS_BLOCK_DARK: Record<string, string> = {
  pending:   "bg-surface-overlay text-foreground border-l-[3px] border-amber-400",
  confirmed: "bg-surface-overlay text-foreground border-l-[3px] border-[#00e5a0]",
  completed: "bg-surface-overlay text-foreground border-l-[3px] border-sky-400",
  cancelled: "bg-card-raised text-grey border-l-[3px] border-rose-500/70",
  "no-show": "bg-card-raised text-grey border-l-[3px] border-zinc-500",
};
const STATUS_CHIP_DARK: Record<string, string> = {
  pending:   "bg-amber-500/15 text-amber-300",
  confirmed: "bg-[#00e5a0]/15 text-[#00e5a0]",
  completed: "bg-sky-500/15 text-sky-300",
  cancelled: "bg-rose-500/15 text-rose-300",
  "no-show": "bg-zinc-500/15 text-zinc-300",
};
const statusBlockDark = (s: string) => STATUS_BLOCK_DARK[s] ?? "bg-surface-overlay text-foreground border-l-[3px] border-[#00e5a0]";
const statusChipDark = (s: string) => STATUS_CHIP_DARK[s] ?? "bg-[#00e5a0]/15 text-[#00e5a0]";

// Appointment "box" style — surface + a 3px left accent, coloured by STATUS:
// pending → yellow, no-show → red, cancelled/refunded → muted, completed → blue,
// everything else active (booked/confirmed) → green. Blue means COMPLETED only —
// a booking stays green even after it's paid or a card is held; payment shows in
// the separate "Paid / Card held" tag, not the block colour.
const apptBlock = (a: { status?: string | null; payment_status?: string | null }) => {
  // Refunded (or cancelled) → muted grey + faded, regardless of prior status.
  const inactive = a.payment_status === "refunded" || a.status === "cancelled";
  const border = inactive ? "border-border-strong"
    : a.status === "no-show" ? "border-[#ff6b6b]"
    : a.status === "pending" ? "border-[#f5c542]"
    : a.status === "completed" ? "border-[#4a9eff]"
    : "border-[#00e5a0]";
  return cn("cw-apptblock bg-card-raised border-l-[3px] text-foreground", border, inactive && "opacity-60");
};

// Shared action handlers, wired up by CalendarPage. Mirrors the Appointments
// page so Approve / Complete / Reject behave identically from either surface.
export type ApptEditFields = {
  client_name?: string;
  client_phone?: string | null;
  client_email?: string | null;
  date?: string;          // YYYY-MM-DD
  time_slot?: string;     // display, e.g. "9:00 AM"
  barber_id?: string | null;
  service_id?: string | null;       // primary service of the (possibly combined) booking
  total_amount?: number;            // combined price
  duration_minutes?: number;        // combined block length
  notes?: string | null;            // carries "Services: A + B" for multi-service
};
export type ApptActions = {
  approve: (a: AppointmentWithDetails) => void;
  complete: (a: AppointmentWithDetails) => void;        // paid / zero-amount / skip-unpaid
  captureComplete: (a: AppointmentWithDetails) => void; // held / saved card → auto-charge
  cashComplete: (a: AppointmentWithDetails) => void;    // record cash + complete
  sendLink: (a: AppointmentWithDetails, email: string) => void;
  reject: (a: AppointmentWithDetails) => void;
  noShow: (a: AppointmentWithDetails, amountCents: number) => void; // mark no-show (+ charge fee when amountCents > 0 and a card is on file)
  edit: (a: AppointmentWithDetails, fields: ApptEditFields) => void; // change time/day/client/barber
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
  confirm?: (msg: string) => Promise<boolean>;                     // in-app yes/no (falls back to window.confirm)
}): ApptActions {
  const { shop, accessToken, patch, setBusy, toast, onDone } = opts;
  // Prefer the in-app dialog when provided; otherwise fall back to the native
  // browser confirm so this factory still works outside a ConfirmProvider.
  const ask = opts.confirm ?? (async (m: string) => (typeof window !== "undefined" ? window.confirm(m) : false));
  // Check-out / completion is only allowed from CHECKOUT_LEAD_HOURS before the
  // appointment starts (and any time after) — no completing/charging days early.
  // Computed in the shop's timezone; returns true (and toasts) when too early.
  const checkoutBlocked = (appt: AppointmentWithDetails): boolean => {
    const tz = safeTz((shop as { timezone?: string } | null)?.timezone);
    if (isCheckoutAllowed(appt.date, appt.time_slot, todayInTz(tz), nowMinutesInTz(tz))) return false;
    toast(`Too early — you can check out from ${CHECKOUT_LEAD_HOURS}h before the appointment.`);
    return true;
  };
  // Once a pending booking is resolved (approve/reject) from the calendar, delete
  // the caller's own linked booking notification so the stale "Approve" action
  // clears from the bell + notifications page and syncs live (the notifications
  // realtime channel fires on the delete). Mirrors the popover's inline-approve.
  // RLS scopes it to the caller's rows; best-effort — never blocks the action.
  const clearBookingNotif = (appointmentId: string) =>
    supabase.from("notifications").delete().eq("entity_id", appointmentId).eq("type", "booking").then(null, () => null);
  return {
    approve: async (appt) => {
      if (!shop) return;
      setBusy("approve");
      const { error } = await supabase.from("appointments").update({ status: "confirmed" }).eq("id", appt.id);
      setBusy("");
      if (error) { toast(`Update failed: ${error.message}`); return; }
      patch(appt.id, { status: "confirmed" });
      clearBookingNotif(appt.id);
      sendApprovalNotifications(appt, shop, accessToken);
      toast("Approved · Customer notified");
    },
    edit: async (appt, fields) => {
      if (!shop || !accessToken) return;
      // Only send columns that actually changed.
      const clean: Record<string, unknown> = {};
      const current = appt as unknown as Record<string, unknown>;
      (Object.keys(fields) as (keyof ApptEditFields)[]).forEach((k) => {
        const v = fields[k];
        if (v !== undefined && v !== current[k]) {
          clean[k] = v === "" ? null : v;
        }
      });
      if (Object.keys(clean).length === 0) { toast("No changes"); return; }
      // Save THROUGH the server route: it runs the authoritative double-booking
      // check (service role, sees every booking, can't be skipped) before writing.
      const send = (overrideBlock: boolean) => fetch("/api/appointments/update", {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ appointment_id: appt.id, fields: clean, override_block: overrideBlock || undefined }),
      }).catch(() => null);
      setBusy("edit");
      let res = await send(false);
      let data = res ? await res.json().catch(() => ({ error: "Network error" })) : { error: "Network error" };
      // Moving onto a deliberate break / time-off is respected with a warning the
      // staff can accept (a double-booking has no `blocked` flag → hard stop).
      if (res && !res.ok && data.blocked) {
        setBusy("");
        const ok = await ask("The barber has time off or a break during that slot. Move the appointment there anyway?");
        if (!ok) return;
        setBusy("edit");
        res = await send(true);
        data = res ? await res.json().catch(() => ({ error: "Network error" })) : { error: "Network error" };
      }
      setBusy("");
      if (!res || !res.ok || data.error) {
        toast(data.error || "Update failed — please try again.");
        return;
      }
      patch(appt.id, clean as Partial<AppointmentWithDetails>);
      toast("Appointment updated");
    },
    complete: async (appt) => {
      if (!shop) return;
      if (checkoutBlocked(appt)) return;
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
      if (checkoutBlocked(appt)) return;
      setBusy("capture");
      toast(appt.payment_status === "held" ? "Charging held card…" : "Charging card on file…");
      let data: { ok?: boolean; error?: string };
      try {
        const res = await fetch("/api/stripe/capture-appointment", {
          method: "POST",
          headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
          body: JSON.stringify({ appointment_id: appt.id, reason: "completed" }),
        });
        data = await res.json().catch(() => ({ ok: false, error: "Network error" }));
      } catch {
        // Response never came back (dropped mobile connection). The charge may
        // have gone through; the server is idempotent, so guide a refresh instead
        // of a raw "Load failed" that invites a blind retry.
        setBusy("");
        toast("Network dropped — the charge may have gone through. Refresh to check before charging again.");
        return;
      }
      if (!data.ok) { setBusy(""); toast(`Charge failed: ${data.error ?? "try again"}`); return; }
      await supabase.from("appointments").update({ status: "completed" }).eq("id", appt.id);
      // Expire any open checkout link so the customer can't ALSO pay it after the
      // card was just captured (double-charge path). Matches cashComplete.
      if (appt.stripe_checkout_session_id) {
        fetch("/api/stripe/cancel-payment-link", {
          method: "POST", headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
          body: JSON.stringify({ appointment_id: appt.id }),
        }).catch(() => {});
      }
      patch(appt.id, { status: "completed", payment_status: "captured", paid_at: new Date().toISOString() });
      await runCompletionEffects(supabase, { ...appt, payment_status: "captured" }, shop, accessToken);
      setBusy("");
      onDone();
      toast("Charged · Completed");
    },
    cashComplete: async (appt) => {
      if (!shop) return;
      if (checkoutBlocked(appt)) return;
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
      // A settled charge (immediate online "paid" OR a captured hold) gets
      // refunded; an UNCAPTURED hold gets released (can't refund what wasn't
      // captured). Both undo the money — the old check only caught "captured",
      // so rejecting a paid-online booking kept the customer's money and a held
      // card stayed authorized ~7 days.
      const hasCharge = !!(appt.payment_intent_id && (appt.payment_status === "paid" || appt.payment_status === "captured"));
      const hasHold = !!(appt.payment_intent_id && appt.payment_status === "held");
      if (!(await ask(`Reject this appointment? The customer will be notified${hasCharge ? " and refunded." : "."}`))) return;
      setBusy("reject");
      if (hasCharge && accessToken) {
        const refundRes = await fetch("/api/stripe/refund", {
          method: "POST",
          headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
          body: JSON.stringify({ appointment_id: appt.id }),
        }).catch(() => null);
        if (refundRes?.ok) {
          patch(appt.id, { status: "cancelled", payment_status: "refunded" });
          clearBookingNotif(appt.id);
          // The refund route already cancelled the booking + pinged the waitlist;
          // just tell the barber the slot freed (no second waitlist ping).
          fetch("/api/appointments/notify-cancellation", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ appointment_id: appt.id, statusLabel: "Cancelled", notifyCustomer: true }),
          }).catch(() => null);
          setBusy(""); onDone();
          toast("Rejected · Refund issued");
          return;
        }
        // fall through to a plain cancel if the refund call failed
      }
      // Uncaptured hold → release the authorization before cancelling.
      if (hasHold && accessToken) {
        await fetch("/api/stripe/release-hold", {
          method: "POST",
          headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
          body: JSON.stringify({ appointment_id: appt.id }),
        }).catch(() => null);
      }
      // Persist the voided state to the DB too (a held card being cancelled) — the
      // old write set only `status`, leaving the row `held + cancelled` forever
      // (it read as a frozen hold in reconciliation). Match the local patch below.
      const { error } = await supabase.from("appointments")
        .update(hasHold ? { status: "cancelled", payment_status: "voided" } : { status: "cancelled" })
        .eq("id", appt.id);
      setBusy("");
      if (error) { toast(`Failed: ${error.message}`); return; }
      patch(appt.id, hasHold ? { status: "cancelled", payment_status: "voided" } : { status: "cancelled" });
      clearBookingNotif(appt.id);
      sendRejectionEmail(appt, shop, "");
      notifyFreedSlot(appt, shop, "Cancelled");
      onDone();
      toast("Rejected" + (appt.client_email ? " · Email sent" : ""));
    },
    // Manual no-show. amountCents > 0 AND a card on file → charge the no-show fee
    // (capture-appointment handles the money + receipt + owner alert); otherwise
    // just flag it. Always marks the appointment "no-show" (frees the slot).
    noShow: async (appt, amountCents) => {
      if (!shop) return;
      // A card can be charged for a no-show when it's held/saved OR when it's a
      // "pay at the shop" booking that kept a card on file (unpaid + saved PM).
      // capture-appointment treats a stored PM with no held intent as chargeable.
      const hasCard = appt.payment_status === "held" || appt.payment_status === "saved" || !!appt.stripe_payment_method_id;
      setBusy("noshow");
      let charged = false;
      let holdExpired = false;
      if (hasCard && accessToken && amountCents > 0) {
        let data: { ok?: boolean; error?: string; amount?: number; holdExpired?: boolean };
        try {
          const res = await fetch("/api/stripe/capture-appointment", {
            method: "POST",
            headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
            body: JSON.stringify({ appointment_id: appt.id, reason: "no_show", amount_cents: amountCents }),
          });
          data = await res.json().catch(() => ({ ok: false, error: "Network error" }));
        } catch {
          // The request left the phone but the response never came back (flaky
          // mobile connection — Safari reports this as "Load failed"). The charge
          // may well have gone through; the server is idempotent, so don't panic-
          // retry blindly — tell the owner to refresh and check first.
          setBusy("");
          toast("Network dropped — the charge may have gone through. Refresh to check before charging again.");
          return;
        }
        if (!data.ok) { setBusy(""); toast(`Charge failed: ${data.error ?? "try again"}`); return; }
        // Hold expired → the server recorded no charge but the no-show should
        // still be marked. Otherwise a real fee was captured.
        holdExpired = !!data.holdExpired;
        charged = (data.amount ?? 0) > 0;
      }
      const { error } = await supabase.from("appointments").update({ status: "no-show" }).eq("id", appt.id);
      if (error) { setBusy(""); toast(`Failed: ${error.message}`); return; }
      patch(appt.id, charged
        ? { status: "no-show", payment_status: "captured", paid_at: new Date().toISOString() }
        : { status: "no-show" });
      // Free the slot / ping the waitlist. For the customer email: when we CHARGED
      // a fee, the receipt already leads with a warm "we missed you" note + rebook
      // link (one combined email), so only send the standalone "we missed you"
      // follow-up when there was NO charge. Never the review email on a no-show.
      if (!charged) sendNoShowFollowup(appt, shop, accessToken);
      notifyFreedSlot(appt, shop, "No-show");
      setBusy("");
      onDone();
      toast(charged ? "No-show fee charged · receipt emailed" : holdExpired ? "Marked no-show — card hold had expired, nothing charged" : "Marked no-show");
    },
  };
}

// One stacked action row in the appointment drawer (the demo's ".daction" look).
function DAction({ icon, label, onClick, disabled, tone = "default" }: {
  icon: string; label: string; onClick?: () => void; disabled?: boolean;
  tone?: "default" | "primary" | "danger" | "muted";
}) {
  return (
    <button type="button" onClick={onClick} disabled={disabled || tone === "muted"}
      className={cn(
        // `cwd-act cwd-act--<tone>` markers let the light theme restyle these into
        // solid/outlined buttons (see globals.css) — DARK theme keeps the tints below.
        "cwd-act", `cwd-act--${tone}`,
        "flex items-center gap-3 w-full px-3.5 py-3 rounded-xl border text-sm font-medium text-left transition-colors disabled:opacity-50",
        tone === "primary" ? "bg-[#00e5a0]/10 border-[#00e5a0]/20 text-[#00e5a0] hover:bg-[#00e5a0]/15"
          : tone === "danger" ? "bg-[#ff6b6b]/[0.08] border-[#ff6b6b]/15 text-[#ff6b6b] hover:bg-[#ff6b6b]/[0.12]"
          : tone === "muted" ? "bg-surface-overlay border-border text-grey-muted cursor-not-allowed"
          : "bg-surface-overlay border-border text-foreground hover:bg-[#1e1e1e]",
      )}>
      <span className="text-base leading-none flex-shrink-0">{icon}</span>
      <span className="truncate">{label}</span>
    </button>
  );
}

// ── Appointment detail — a bottom sheet / drawer that slides up on tap ──────────
export function ApptDetail({ appt, barbers, services, onClose, actions, busy, readOnly = false, tz, noShowFeePercent }: {
  appt: AppointmentWithDetails;
  barbers: Barber[];
  tz?: string;                    // shop timezone → decides when a no-show can be marked
  noShowFeePercent?: number;      // shop's no-show fee % → the amount charged
  // Optional — when given, the edit form lets you change / add services, and the
  // time list only offers slots where the combined duration actually fits.
  services?: { id: string; name: string; price: number; duration_minutes: number }[];
  onClose: () => void;
  actions: ApptActions;
  busy: string;
  readOnly?: boolean;   // hide all action buttons (e.g. barber without manage_appointments)
}) {
  const barber = barbers.find(b => b.id === appt.barber_id);
  const [payChoice, setPayChoice] = useState(false);
  const [payEmail, setPayEmail] = useState(appt.client_email ?? "");
  // The email field only appears after tapping "Send payment link".
  const [showEmail, setShowEmail] = useState(false);
  const [noShowMode, setNoShowMode] = useState(false);

  // No-show can be marked from NO_SHOW_LEAD_MINUTES before the start time onward
  // (owner asked for a 1-hour lead), judged in the SHOP's timezone. Charging a
  // fee needs a card on file.
  // TEMP (testing): the no-show option is available ANYTIME, not just after the
  // slot's start (+ grace). Flip NO_SHOW_TIME_GATE back to true to restore the
  // gate (the original logic below is kept intact).
  const NO_SHOW_TIME_GATE = false as boolean;
  const startedForNoShow = !NO_SHOW_TIME_GATE || (() => {
    const t = safeTz(tz);
    if (!appt.date) return false;
    const today = todayInTz(t);
    if (appt.date < today) return true;
    if (appt.date > today) return false;
    return timeToMinutes(appt.time_slot ?? "12:00 AM") - NO_SHOW_LEAD_MINUTES <= nowMinutesInTz(t);
  })();
  // A card is on file (chargeable for a no-show) when held/saved OR when a "pay at
  // the shop" booking stored one (unpaid + saved PM).
  const hasCardOnFile = appt.payment_status === "held" || appt.payment_status === "saved" || !!appt.stripe_payment_method_id;
  // No-show charge is chosen at the moment of marking via a 0–100% slider,
  // defaulting to the shop's configured percentage.
  const [noShowPct, setNoShowPct] = useState(() => clampNoShowPct(noShowFeePercent));
  const noShowFee = ((appt.total_amount ?? 0) * clampNoShowPct(noShowPct)) / 100;
  const noShowFeeCents = Math.round((appt.total_amount ?? 0) * clampNoShowPct(noShowPct));

  // Inline edit — change the time / day / client info / barber / service(s)
  // before checking out. Time comes from the 15-min slot grid (never free-form);
  // when `services` is supplied, the grid is filtered to slots that fit.
  const [editMode, setEditMode] = useState(false);
  const svcById = useCallback((id: string) => services?.find(s => s.id === id), [services]);
  const makeEditForm = () => ({
    client_name: appt.client_name ?? "",
    client_phone: appt.client_phone ?? "",
    client_email: appt.client_email ?? "",
    date: appt.date ?? "",
    time: snapToSlot(appt.time_slot ?? "12:00 AM"),
    barber_id: appt.barber_id ?? "",
    service_ids: appt.service_id ? [appt.service_id] : [] as string[],
  });
  const [editForm, setEditForm] = useState(makeEditForm);
  const openEdit = () => { setEditForm(makeEditForm()); setEditMode(true); };

  const editTotalDuration = editForm.service_ids.reduce((n, id) => n + (svcById(id)?.duration_minutes || 0), 0);
  const editTotalPrice = editForm.service_ids.reduce((n, id) => n + Number(svcById(id)?.price || 0), 0);

  // Availability for the chosen barber + day (only while editing services), so we
  // can offer just the start times where the combined service block fits.
  type EditAvail = { start_time: string | null; end_time: string | null; fullDayOff: boolean; busy: { time_slot: string; duration: number }[]; blocked: { start_time: string; end_time: string }[] };
  const [editAvail, setEditAvail] = useState<EditAvail | null>(null);
  useEffect(() => {
    if (!editMode || !services || !editForm.barber_id || !editForm.date) { setEditAvail(null); return; }
    let alive = true;
    fetch("/api/availability", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ shop_id: appt.shop_id, date: editForm.date, barber_id: editForm.barber_id }),
    }).then(r => (r.ok ? r.json() : { barbers: [] }))
      .then(d => { if (alive) setEditAvail(((d.barbers ?? [])[0] as EditAvail) ?? null); })
      .catch(() => { if (alive) setEditAvail(null); });
    return () => { alive = false; };
  }, [editMode, services, editForm.barber_id, editForm.date, appt.shop_id]);

  const minToDisplay = (m: number) => dbTimeToDisplay(`${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`);
  // Keep the appointment's own slot pickable (don't let it block itself) when the
  // barber + day are unchanged.
  const ownSlot = (appt.date === editForm.date && appt.barber_id === editForm.barber_id) ? appt.time_slot : null;
  const curSnapped = snapToSlot(appt.time_slot ?? "12:00 AM");
  const editSlots = useMemo<string[]>(() => {
    // Without a services list we don't fit-check — offer the whole 15-min grid.
    if (!services) return EDIT_TIME_SLOTS;
    // Availability still loading — keep just the current time until we know the
    // barber's real bookings (never offer a slot we can't conflict-check yet).
    if (!editAvail) return [curSnapped];
    // Staff can reschedule to ANY time of day — the full 24h grid, not just the
    // barber's working hours (mirrors the add flow). Blocks / time-off / breaks
    // stay PICKABLE; the save warns and lets staff confirm. Only slots that would
    // DOUBLE-BOOK are dropped (already busy, or a service overrunning the next
    // appointment) plus past times today.
    const otherBusy = editAvail.busy.filter(x => !(ownSlot && x.time_slot === ownSlot));
    const occupied = new Set<string>(otherBusy.flatMap(a => occupiedSlots(a.time_slot, a.duration, 15)));
    const starts = otherBusy.map(a => timeToMinutes(a.time_slot));
    const nextAfter = (m: number) => { const after = starts.filter(s => s > m); return after.length ? Math.min(...after) : 24 * 60; };
    const dur = editTotalDuration > 0 ? editTotalDuration : 15;
    const isToday = editForm.date === formatDateForDb(new Date());
    const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
    const opts: string[] = [];
    for (let m = 0; m + dur <= 24 * 60; m += 15) {
      const slot = minToDisplay(m);
      if (isToday && m < nowMin) continue;
      if (occupied.has(slot)) continue;
      if (m + dur > nextAfter(m)) continue;
      opts.push(slot);
    }
    // Keep the current time selectable, inserted in chronological order so the
    // native picker opens scrolled to it (not pinned to the top).
    if (!opts.includes(curSnapped)) {
      const cMin = timeToMinutes(curSnapped);
      const idx = opts.findIndex(s => timeToMinutes(s) > cMin);
      if (idx === -1) opts.push(curSnapped); else opts.splice(idx, 0, curSnapped);
    }
    return opts;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [services, editAvail, editTotalDuration, editForm.date, ownSlot, curSnapped]);

  // If the chosen time stops fitting (e.g. a longer service was added), snap it to
  // the first slot that does — but NEVER silently bounce a deliberate new pick
  // back to the original. Skip only while availability is still loading (editSlots
  // is just [curSnapped] then, so snapping would revert a rescheduled time); once
  // loaded, keep the selection valid on any day (off-days included, since the list
  // no longer collapses). The server conflict check is the final guard.
  useEffect(() => {
    if (!editMode || !services || !editAvail) return;
    if (editSlots.includes(editForm.time)) return;
    const target = editSlots.find(s => s !== curSnapped) ?? editSlots[0];
    if (target) setEditForm(f => ({ ...f, time: target }));
  }, [editMode, services, editAvail, editSlots, editForm.time, curSnapped]);

  const setServiceAt = (idx: number, id: string) => setEditForm(f => { const next = [...f.service_ids]; if (idx >= next.length) next.push(id); else next[idx] = id; return { ...f, service_ids: next }; });
  const addServiceRow = () => setEditForm(f => ({ ...f, service_ids: [...f.service_ids, ""] }));
  const removeServiceRow = (idx: number) => setEditForm(f => ({ ...f, service_ids: f.service_ids.filter((_, i) => i !== idx) }));

  const saveEdit = () => {
    if (!editForm.client_name.trim() || !editForm.date || !editForm.time) return;
    const fields: ApptEditFields = {
      client_name: editForm.client_name.trim(),
      client_phone: editForm.client_phone.trim() || null,
      client_email: editForm.client_email.trim() || null,
      date: editForm.date,
      time_slot: editForm.time,
      barber_id: editForm.barber_id || null,
    };
    const ids = editForm.service_ids.filter(Boolean);
    // Only touch the service / price / duration when the owner ACTUALLY changed
    // the service selection. Moving the date, time, or barber must NOT silently
    // recompute the amount — that would clobber the booked price (tips, a
    // multi-service combo the form only shows the primary of, or a since-changed
    // list price). Preserve the original unless the services were edited.
    const origIds = appt.service_id ? [appt.service_id] : [];
    const servicesChanged = !!services && (ids.length !== origIds.length || ids.some((id, i) => id !== origIds[i]));
    if (services && servicesChanged && ids.length > 0) {
      const svcs = ids.map(id => svcById(id)).filter(Boolean) as { name: string; price: number; duration_minutes: number }[];
      fields.service_id = ids[0];
      fields.total_amount = svcs.reduce((n, s) => n + Number(s.price || 0), 0);
      fields.duration_minutes = svcs.reduce((n, s) => n + (s.duration_minutes || 0), 0);
      // Record the combined list in notes — but don't clobber a non-service note.
      const existing = (appt.notes ?? "").trim();
      if (ids.length > 1 && (!existing || /^services:/i.test(existing))) {
        fields.notes = `Services: ${svcs.map(s => s.name).join(" + ")}`;
      }
    }
    actions.edit(appt, fields);
    setEditMode(false);
  };
  const duration = apptDuration(appt);
  const paid = appt.payment_status === "paid" || appt.payment_status === "captured";
  const heldOrSaved = appt.payment_status === "held" || appt.payment_status === "saved";
  const refunded = appt.payment_status === "refunded";
  // A card is on file but nothing is held/settled yet — the customer chose "pay
  // at the shop" at a card-required shop, so it lands unpaid · cash with the card
  // saved. The owner can charge it off-session at checkout (or take cash / leave
  // it); it's also the card a no-show charge would hit.
  const cardOnFile = !paid && !refunded && !heldOrSaved && !!appt.stripe_payment_method_id;
  // Outstanding = a real balance not yet settled and not on a held/saved card
  // (those auto-charge on Complete). Drives the standalone "Take Payment" button.
  const outstanding = (appt.total_amount ?? 0) > 0
    && appt.payment_status !== "paid" && appt.payment_status !== "captured"
    && appt.payment_status !== "refunded" && !heldOrSaved;

  const amt = Number(appt.total_amount ?? 0);
  // Tip is stored separately (total_amount = service + tax only). For anything
  // that shows the money the customer actually paid / will be charged, add it in
  // — a held card captures total + tip, and a paid booking already took it.
  const tipAmt = Number(appt.tip_amount ?? 0);
  const taxAmt = Number(appt.tax_amount ?? 0);
  const amtPaid = amt + tipAmt;
  // A checkout link is out and the customer hasn't paid yet — keep the Check out
  // button but surface that we're waiting (paying the link auto-completes).
  const awaiting = !paid && !refunded && !!appt.stripe_checkout_session_id;

  // Slide the drawer up on mount; on close, slide down then unmount.
  const [shown, setShown] = useState(false);
  useEffect(() => { const t = setTimeout(() => setShown(true), 10); return () => clearTimeout(t); }, []);
  const close = () => { setShown(false); setTimeout(onClose, 280); };
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const { dragY, dragging } = useSheetDrag(sheetRef, close);

  // Header bits — one meta line + a single status/payment badge (demo look).
  const serviceName = (appt.services as { name: string } | null)?.name ?? "—";
  const pm = appt.payment_method as string | null | undefined;
  const methodWord = pm === "cash" ? "Cash" : pm === "online" ? "Online" : pm === "gift_card" ? "Gift card" : "Card";
  const badge = paid
    ? { text: `Paid · ${methodWord}`, cls: "bg-[#00e5a0]/10 text-[#00e5a0]" }
    : refunded
      ? { text: "Refunded", cls: "bg-white/5 text-grey" }
    : heldOrSaved
      ? { text: `Card ${appt.payment_status === "saved" ? "on file" : "held"}${amtPaid > 0 ? ` · ${formatCurrency(amtPaid)}` : ""}`, cls: "bg-[#4a9eff]/10 text-[#4a9eff]" }
      : cardOnFile
        ? { text: `Pay at shop · card on file${amtPaid > 0 ? ` · ${formatCurrency(amtPaid)}` : ""}`, cls: "bg-[#f5c542]/10 text-[#f5c542]" }
      : awaiting
        ? { text: "Awaiting payment", cls: "bg-sky-400/10 text-sky-400" }
        : appt.status === "pending"
          ? { text: "Pending confirmation", cls: "bg-[#f5c542]/10 text-[#f5c542]" }
          : appt.status === "completed"
            ? { text: "Completed · Unpaid", cls: "bg-white/5 text-[#bbb]" }
            : appt.status === "cancelled"
              ? { text: "Cancelled", cls: "bg-white/5 text-grey" }
              : appt.status === "no-show"
                ? { text: "No-show", cls: "bg-white/5 text-grey" }
                : appt.payment_method === "cash"
                  ? { text: "Pay at shop", cls: "bg-white/5 text-[#bbb]" }
                  : { text: "Booked", cls: "bg-[#00e5a0]/10 text-[#00e5a0]" };
  const metaLine = [serviceName, barber?.name ?? "Any", appt.time_slot, amtPaid > 0 ? formatCurrency(amtPaid) : null].filter(Boolean).join(" · ");

  return (
    <>
      <div
        className={cn("fixed inset-0 bg-black/60 backdrop-blur-sm z-[70] transition-opacity duration-300", shown ? "opacity-100" : "opacity-0")}
        onClick={close}
      />
      <div className="fixed inset-x-0 bottom-0 sm:inset-0 z-[80] flex justify-center sm:items-center pointer-events-none sm:p-4">
        <div
          ref={sheetRef}
          style={{
            transform: shown ? `translate3d(0,${dragY}px,0)` : "translate3d(0,100%,0)",
            transition: dragging ? "none" : "transform 0.28s cubic-bezier(.32,.72,0,1)",
          }}
          className={cn(
            "pointer-events-auto w-full sm:max-w-md bg-card-raised border-t sm:border border-border rounded-t-2xl sm:rounded-2xl shadow-2xl",
            "pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:pb-5 max-h-[88vh] overflow-y-auto overscroll-contain",
          )}
        >
          {/* Grab handle — pull down anywhere to dismiss, or tap the handle */}
          <div onClick={close} className="flex justify-center pt-3 pb-3 cursor-grab active:cursor-grabbing">
            <div className="w-10 h-1.5 rounded-full bg-[#3a3a3a]" />
          </div>

          {/* Header — name · meta line · single status/payment badge */}
          <div className="px-[18px] pb-3.5 border-b border-border">
            <div className="flex items-start justify-between gap-2">
              <h3 className="text-base font-bold text-foreground truncate">{appt.client_name}</h3>
              <button onClick={close} className="text-grey hover:text-foreground flex-shrink-0 -mr-1"><X size={18} /></button>
            </div>
            <p className="text-xs text-grey mt-1 truncate">{metaLine}</p>
            <span className={cn("inline-flex items-center mt-2.5 text-[11px] font-semibold px-2.5 py-1 rounded-full", badge.cls)}>{badge.text}</span>
          </div>

          {/* Customer contact — tap the phone to call, or email/text directly. */}
          {(appt.client_phone || appt.client_email) && (
            <div className="px-[18px] py-3 border-b border-border flex flex-col gap-2">
              {appt.client_phone && (
                <div className="flex items-center gap-2.5">
                  <a href={`tel:${appt.client_phone}`} aria-label={`Call ${appt.client_name}`}
                    className="w-9 h-9 flex-shrink-0 rounded-full bg-[#00e5a0]/12 text-[#00e5a0] flex items-center justify-center hover:bg-[#00e5a0]/20 active:opacity-70 transition-colors">
                    <Phone size={16} />
                  </a>
                  <a href={`tel:${appt.client_phone}`} className="text-sm font-medium text-foreground hover:underline truncate">{formatPhone(appt.client_phone)}</a>
                  <a href={`sms:${appt.client_phone}`} aria-label={`Text ${appt.client_name}`}
                    className="ml-auto w-9 h-9 flex-shrink-0 rounded-full bg-surface-overlay text-grey hover:text-foreground active:opacity-70 flex items-center justify-center transition-colors">
                    <MessageSquare size={15} />
                  </a>
                </div>
              )}
              {appt.client_email && (
                <div className="flex items-center gap-2.5">
                  <a href={`mailto:${appt.client_email}`} aria-label={`Email ${appt.client_name}`}
                    className="w-9 h-9 flex-shrink-0 rounded-full bg-surface-overlay text-grey hover:text-foreground active:opacity-70 flex items-center justify-center transition-colors">
                    <Mail size={15} />
                  </a>
                  <a href={`mailto:${appt.client_email}`} className="text-sm text-foreground hover:underline truncate">{appt.client_email}</a>
                </div>
              )}
            </div>
          )}

          {/* Money breakdown — itemize the tip so the owner sees service vs tip,
              not one lump. Only shown once a tip exists (tips are added at
              payment/completion). */}
          {tipAmt > 0 && (
            <div className="px-[18px] py-3 border-b border-border">
              <div className="flex items-center justify-between text-xs mb-1.5">
                <span className="text-grey">Service{taxAmt > 0 ? " + tax" : ""}</span>
                <span className="text-foreground font-medium tabular-nums">{formatCurrency(amt)}</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-grey">Tip</span>
                <span className="text-foreground font-medium tabular-nums">{formatCurrency(tipAmt)}</span>
              </div>
              <div className="flex items-center justify-between text-sm mt-2 pt-2 border-t border-border">
                <span className="font-semibold text-foreground">Total</span>
                <span className="font-bold text-foreground tabular-nums">{formatCurrency(amtPaid)}</span>
              </div>
            </div>
          )}

          {appt.notes && (
            <div className="mx-[18px] mt-3 bg-surface-overlay rounded-xl p-3 text-xs text-grey">{appt.notes}</div>
          )}

          {/* Actions — same logic/handlers as before, restyled as stacked rows. */}
          {editMode ? (
            <div className="px-[18px] pt-3.5 flex flex-col gap-3">
              <Input label="Client name *" value={editForm.client_name}
                onChange={e => setEditForm(f => ({ ...f, client_name: e.target.value }))} placeholder="Client name" />
              <Input label="Phone" value={editForm.client_phone}
                onChange={e => setEditForm(f => ({ ...f, client_phone: e.target.value }))} placeholder="506-555-0000" />
              <Input label="Email" type="email" value={editForm.client_email}
                onChange={e => setEditForm(f => ({ ...f, client_email: e.target.value }))} placeholder="name@email.com" />
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-[10px] uppercase tracking-wide text-grey">Day</label>
                  <input type="date" value={editForm.date}
                    onChange={e => setEditForm(f => ({ ...f, date: e.target.value }))}
                    className="w-full bg-card-raised border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:border-white [color-scheme:dark]" />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] uppercase tracking-wide text-grey">Time</label>
                  <select value={editForm.time}
                    onChange={e => setEditForm(f => ({ ...f, time: e.target.value }))}
                    className="w-full bg-card-raised border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:border-white [color-scheme:dark]">
                    {editSlots.length === 0 && <option value="">No open times</option>}
                    {editSlots.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              </div>
              <Select label="Barber" value={editForm.barber_id}
                onChange={e => setEditForm(f => ({ ...f, barber_id: e.target.value }))}>
                <option value="">Any barber</option>
                {barbers.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
              </Select>
              {services && (
                <div className="space-y-1.5">
                  <label className="text-[10px] uppercase tracking-wide text-grey">Service(s)</label>
                  {(editForm.service_ids.length ? editForm.service_ids : [""]).map((sid, idx) => (
                    <div key={idx} className="flex gap-2 items-center">
                      <select value={sid} onChange={e => setServiceAt(idx, e.target.value)}
                        className="flex-1 bg-card-raised border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:border-white [color-scheme:dark]">
                        <option value="">Select a service</option>
                        {services.map(s => <option key={s.id} value={s.id}>{s.name} · {formatCurrency(Number(s.price))} · {s.duration_minutes}m</option>)}
                      </select>
                      {(editForm.service_ids.length > 1 || !!sid) && (
                        <button type="button" onClick={() => removeServiceRow(idx)} aria-label="Remove service"
                          className="w-9 h-9 flex-shrink-0 rounded-lg border border-border text-grey hover:text-foreground hover:border-white flex items-center justify-center">
                          <X size={15} />
                        </button>
                      )}
                    </div>
                  ))}
                  <button type="button" onClick={addServiceRow}
                    className="inline-flex items-center gap-1.5 text-sm font-medium text-accent-soft hover:text-foreground">
                    <Plus size={15} /> Add another service
                  </button>
                  {editForm.service_ids.filter(Boolean).length > 0 && (
                    <p className="text-xs text-grey">Total: {editTotalDuration} min · {formatCurrency(editTotalPrice)}</p>
                  )}
                </div>
              )}
              <div className="flex gap-2 pt-1">
                <button type="button" onClick={() => setEditMode(false)}
                  className="flex-1 py-2.5 rounded-xl border border-border bg-surface-overlay text-sm font-medium text-[#ccc] hover:bg-[#1e1e1e] transition-colors">Cancel</button>
                <button type="button" disabled={!!busy || !editForm.client_name.trim() || !editForm.date || !editForm.time}
                  onClick={saveEdit}
                  className="flex-1 py-2.5 rounded-xl bg-[#00e5a0] text-black text-sm font-bold disabled:opacity-40 transition-opacity">
                  {busy === "edit" ? "Saving…" : "Save changes"}
                </button>
              </div>
            </div>
          ) : readOnly ? (
            <p className="px-[18px] pt-4 text-center text-xs text-grey-muted">View only</p>
          ) : payChoice ? (
            <div className="px-[18px] pt-3.5 flex flex-col gap-2">
              {paid ? (
                <DAction tone="primary" icon="✓" label={busy === "complete" ? "Completing…" : "Mark complete · already paid"} disabled={!!busy} onClick={() => actions.complete(appt)} />
              ) : (
                <>
                  {(heldOrSaved || cardOnFile) && (
                    <DAction tone="primary" icon="✓" label={busy === "capture" ? "Charging…" : cardOnFile ? `Charge card on file${amtPaid > 0 ? ` · ${formatCurrency(amtPaid)}` : ""}` : `Complete + Capture${amtPaid > 0 ? ` · ${formatCurrency(amtPaid)}` : ""}`} disabled={!!busy} onClick={() => actions.captureComplete(appt)} />
                  )}
                  {!showEmail ? (
                    <DAction icon="↗" label="Send payment link" onClick={() => setShowEmail(true)} />
                  ) : (
                    <>
                      <input
                        type="email"
                        value={payEmail}
                        onChange={e => setPayEmail(e.target.value)}
                        placeholder="Customer email (for the link)"
                        autoFocus
                        className="w-full bg-surface-overlay border border-border rounded-xl px-3.5 py-3 text-sm text-foreground placeholder:text-grey-muted focus:outline-none focus:border-border"
                      />
                      <DAction tone="primary" icon="↗" label={busy === "link" ? "Sending…" : `Send link${appt.client_phone ? " · email/text" : " · email"}`} disabled={!!busy} onClick={() => { actions.sendLink(appt, payEmail.trim()); setPayChoice(false); setShowEmail(false); }} />
                    </>
                  )}
                  <DAction icon="💵" label={busy === "cash" ? "Saving…" : "Pay cash · Complete"} disabled={!!busy} onClick={() => actions.cashComplete(appt)} />
                  {appt.status !== "completed" && (
                    <DAction icon="○" label={busy === "complete" ? "Completing…" : "Complete · leave unpaid"} disabled={!!busy} onClick={() => actions.complete(appt)} />
                  )}
                </>
              )}
              <button className="text-xs text-grey hover:text-foreground pt-1 pb-0.5" onClick={() => { setPayChoice(false); setShowEmail(false); }}>Cancel</button>
            </div>
          ) : noShowMode ? (
            <div className="px-[18px] pt-3.5 flex flex-col gap-2">
              {hasCardOnFile ? (
                <>
                  <p className="text-sm text-grey px-0.5">Slide to set the no-show fee, then charge the card on file. Set it to 0% to mark the no-show without charging.</p>
                  <div className="px-0.5 pt-0.5 pb-1">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-xs text-grey">No-show fee</span>
                      <span className="text-sm font-semibold text-foreground">{clampNoShowPct(noShowPct)}% · {formatCurrency(noShowFee)}</span>
                    </div>
                    <input
                      type="range" min={0} max={100} step={5} value={noShowPct}
                      onChange={e => setNoShowPct(Number(e.target.value))}
                      disabled={!!busy}
                      className="w-full accent-[#ff6b6b] cursor-pointer"
                      aria-label="No-show fee percentage"
                    />
                    <div className="flex justify-between text-[10px] text-grey-muted mt-0.5"><span>0%</span><span>50%</span><span>100%</span></div>
                  </div>
                  <DAction
                    tone="danger" icon="⚠️"
                    label={busy === "noshow"
                      ? (noShowFeeCents > 0 ? "Charging…" : "Marking…")
                      : (noShowFeeCents > 0 ? `Charge ${formatCurrency(noShowFee)} · mark no-show` : "Mark no-show · no charge")}
                    disabled={!!busy}
                    onClick={() => actions.noShow(appt, noShowFeeCents)}
                  />
                </>
              ) : (
                <>
                  <p className="text-sm text-grey px-0.5">No card on file — you can mark this as a no-show (no fee can be charged).</p>
                  <DAction tone="danger" icon="⚠️" label={busy === "noshow" ? "Marking…" : "Mark no-show"} disabled={!!busy} onClick={() => actions.noShow(appt, 0)} />
                </>
              )}
              <button className="text-xs text-grey hover:text-foreground pt-1 pb-0.5" onClick={() => setNoShowMode(false)}>Cancel</button>
            </div>
          ) : (
            <div className="px-[18px] pt-3.5 flex flex-col gap-2">
              {/* Edit — change the time / day / client / barber before checkout. */}
              {appt.status !== "completed" && appt.status !== "cancelled" && (
                <DAction icon="✏️" label="Edit appointment" disabled={!!busy} onClick={openEdit} />
              )}
              {appt.status === "pending" && (
                <DAction tone="primary" icon="✓" label={busy === "approve" ? "Approving…" : "Approve"} disabled={!!busy} onClick={() => actions.approve(appt)} />
              )}
              {appt.status === "confirmed" && (
                <DAction tone="primary" icon="💳" label="Check out" disabled={!!busy} onClick={() => { setPayChoice(true); setShowEmail(false); }} />
              )}
              {/* No-show — only once the slot's start time (+ grace) has passed. */}
              {appt.status === "confirmed" && startedForNoShow && (
                <DAction icon="⚠️" label="Charge no-show" disabled={!!busy} onClick={() => setNoShowMode(true)} />
              )}
              {outstanding && appt.status !== "pending" && appt.status !== "confirmed" && (
                <DAction tone="primary" icon="💳" label={`Take Payment · ${formatCurrency(amt)}`} disabled={!!busy} onClick={() => { setPayChoice(true); setShowEmail(false); }} />
              )}
              {(appt.status === "pending" || appt.status === "confirmed") && (
                <DAction tone="danger" icon="✗" label={busy === "reject" ? "Rejecting…" : "Reject"} disabled={!!busy} onClick={() => actions.reject(appt)} />
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
      <div className="fixed right-0 top-0 bottom-0 w-full sm:w-[420px] bg-card shadow-sm border-l border-border z-50 flex flex-col animate-fade-in">
        <div className="px-5 pb-5 pt-[calc(env(safe-area-inset-top)+1.25rem)] border-b border-border flex items-center justify-between">
          <div>
            <p className="text-xs text-grey">{date.toLocaleDateString("en-CA", { year: "numeric" })}</p>
            <h3 className="text-lg font-bold text-foreground">{dayLabel}</h3>
            <p className="text-xs text-grey mt-0.5">{appts.length} {appts.length === 1 ? "appointment" : "appointments"}</p>
          </div>
          <button onClick={onClose} className="text-grey hover:text-foreground"><X size={20} /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {appts.length === 0 && (
            <div className="text-center py-12 text-grey text-sm">No bookings on this day.</div>
          )}
          {appts.map(appt => {
            const barber = barbers.find(b => b.id === appt.barber_id);
            return (
              <button key={appt.id} onClick={() => onOpenAppt(appt)}
                className="w-full text-left p-3 rounded-xl bg-card-raised hover:bg-card-raised/80 transition-colors flex items-start gap-3">
                <span className={cn("w-2 h-2 rounded-full mt-1.5 flex-shrink-0", statusDot(appt.status))} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className={cn("text-sm font-semibold text-foreground truncate", isDimmed(appt.status) && "line-through opacity-60")}>
                      {appt.client_name}
                    </p>
                    <span className="text-xs text-grey flex-shrink-0">{appt.time_slot}</span>
                  </div>
                  <p className="text-xs text-grey truncate">
                    {(appt.services as { name: string } | null)?.name ?? "—"} · {barber?.name ?? "Any"}
                  </p>
                  {appt.client_email && (
                    <p className="text-xs text-grey truncate">{appt.client_email}</p>
                  )}
                  <span className={cn("inline-block mt-1 text-[10px] font-medium px-1.5 py-0.5 rounded text-foreground", statusFill(appt.status).split(" ")[0])}>
                    {statusLabel(appt.status)}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
        <div className="px-4 pt-4 pb-[calc(env(safe-area-inset-bottom)+5.25rem)] lg:pb-4 border-t border-border">
          <button onClick={onDrillToDay}
            className="w-full py-2.5 rounded-xl bg-white/10 hover:bg-white/15 text-foreground text-sm font-medium transition-colors">
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

export function CalendarView({ embedded = false, canManage = true, forceBarberId, defaultView, canBlock = false, pageTitle, initialDate, initialApptId, shopOverride }: { embedded?: boolean; canManage?: boolean; forceBarberId?: string | null; defaultView?: "year" | "month" | "day"; canBlock?: boolean; pageTitle?: string; initialDate?: string; initialApptId?: string; shopOverride?: Shop | null }) {
  const { shop: authShop, profile, accessToken, user } = useAuth();
  // The barber portal drives its OWN active shop (a multi-shop owner-barber can be
  // viewing a different shop here than their owner dashboard). When given, use that
  // shop for every shop-scoped query so the calendar's data and its forced barber
  // always come from the SAME shop — never the owner context's stale one.
  const shop = shopOverride ?? authShop;
  const { confirm } = useConfirm();
  // Apple-style hierarchy: Year ⇄ Month ⇄ Day. Opens on today's Day view; the
  // back arrow walks up a level (Day → Month → Year). No manual view switcher.
  const [view, setView] = useState<"year" | "month" | "day">(defaultView ?? "day");
  // Barber portal (forceBarberId) isolates the calendar to that one barber —
  // even for an owner who also cuts: no other-barber chrome (selector/pager).
  const isolated = !!forceBarberId;
  const [barberFilter, setBarberFilter] = useState<string>("all"); // owner: filter calendar to one barber
  // Deep-linked from the dashboard? Open on that appointment's day (parse the
  // YYYY-MM-DD in local time so it doesn't shift a day via UTC).
  const [currentDate, setCurrentDate] = useState(() =>
    initialDate ? new Date(`${initialDate}T00:00:00`) : new Date(),
  );
  const [appointments, setAppointments] = useState<AppointmentWithDetails[]>([]);
  const [barbers, setBarbers] = useState<Barber[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedAppt, setSelectedAppt] = useState<AppointmentWithDetails | null>(null);
  // Direction of the last navigation, fed to the view-transition variants:
  // +1 next, -1 previous, 0 = zoom/cross-fade (drill into a day / switch view).
  const [navDir, setNavDir] = useState(0);
  // Day view layout: the vertical timeline, or the card/"box" grid of slots.
  const [dayLayout, setDayLayout] = useState<"timeline" | "grid">("timeline");
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
  const [addCtx, setAddCtx] = useState<{ barberId: string; barberName: string; time: string; boxMinutes?: number; general?: boolean } | null>(null);
  const [addShown, setAddShown] = useState(false); // drives the add sheet slide-up
  const addSheetRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!addCtx) { setAddShown(false); return; }
    const t = setTimeout(() => setAddShown(true), 10);
    return () => clearTimeout(t);
  }, [addCtx]);
  const closeAdd = () => { setAddShown(false); setTimeout(() => setAddCtx(null), 260); };
  const [addForm, setAddForm] = useState({ client_name: "", client_phone: "", client_email: "", service_ids: [] as string[], time: "", date: "" });
  // Client search for the quick-add sheet: the name field doubles as the query;
  // clientMode = search (typing) | existing (picked from the book) | new (adding).
  const [addClients, setAddClients] = useState<ClientLite[]>([]);
  const [clientMode, setClientMode] = useState<"search" | "existing" | "new">("search");
  const [savingAdd, setSavingAdd] = useState(false);
  // Loyalty redemption for a staff-booked client: look the client up by the
  // email/phone entered; if they have a redeemable balance, offer "use points".
  // The /api/book/in-person route does the server-authoritative math + deduction
  // (we only send the `redeem` intent) — same as the customer booking flow.
  const [addLoyalty, setAddLoyalty] = useState<{ eligible: boolean; points: number; value: number } | null>(null);
  const [addRedeem, setAddRedeem] = useState(false);
  // Blocked-hours state. The tap modal carries an Appointment/Block toggle
  // (addMode); blockForm holds the block's time range + reason.
  const [blocks, setBlocks] = useState<BlockRow[]>([]);
  const [addMode, setAddMode] = useState<"appt" | "block">("appt");
  const [blockForm, setBlockForm] = useState({ start: "", end: "", reason: "" });
  const [blockBusy, setBlockBusy] = useState(false);
  // Drag-to-dismiss for the add sheet (disabled mid-save).
  const { dragY: addDragY, dragging: addDragging } = useSheetDrag(
    addSheetRef, () => closeAdd(), { enabled: !!addCtx && !savingAdd && !blockBusy },
  );
  const [dateMenu, setDateMenu] = useState(false);
  const [viewMenu, setViewMenu] = useState(false);
  // Barber-column pagination for the all-barbers day view (arrows / swipe).
  const [colPage, setColPage] = useState(0);
  const [colWrapW, setColWrapW] = useState(0);
  // Visible height of the day-timeline scroll area — the hour rows stretch to
  // fill it so there's never a dark void below the grid on tall desktops.
  const [dayColH, setDayColH] = useState(0);
  const colWrapRef = useRef<HTMLDivElement>(null);
  // Cancelled / no-show appointments linger on the timeline as faded "open to
  // book again" markers until the owner taps ✕ to clear them. Dismissals are
  // remembered per-device (localStorage) so a cleared slot looks empty again.
  const [dismissedFreed, setDismissedFreed] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    try { const raw = localStorage.getItem("cw_dismissed_freed"); if (raw) setDismissedFreed(new Set(JSON.parse(raw))); } catch { /* ignore */ }
  }, []);
  const dismissFreed = useCallback((id: string) => {
    setDismissedFreed(prev => {
      const next = new Set(prev); next.add(id);
      try { localStorage.setItem("cw_dismissed_freed", JSON.stringify(Array.from(next))); } catch { /* ignore */ }
      return next;
    });
  }, []);
  // Bring dismissed no-show/cancelled markers back (the ✕ was one-way before, so a
  // no-show you cleared to declutter — and its no-show fee — became impossible to
  // review). Un-dismisses the given ids.
  const revealFreed = useCallback((ids: string[]) => {
    setDismissedFreed(prev => {
      const next = new Set(prev); ids.forEach(id => next.delete(id));
      try { localStorage.setItem("cw_dismissed_freed", JSON.stringify(Array.from(next))); } catch { /* ignore */ }
      return next;
    });
  }, []);
  // Swipe origin for the calendar-wide gesture (next/prev period).
  const swipeRef = useRef<{ x: number; y: number } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  // The day-view date rail (horizontally scrollable, browse without selecting).
  // Centering runs via a callback ref (not a state-keyed effect): with
  // AnimatePresence mode="wait" the new day's rail mounts AFTER the exit
  // animation, decoupled from the currentDate change — so a state effect would
  // fire before the new node exists. The callback fires exactly when the fresh
  // node attaches, which is the reliable moment to scroll the selected day to
  // the middle. Free-swipe browsing keeps the same node, so scroll is preserved.
  const stripRef = useRef<HTMLDivElement | null>(null);
  const setStripRef = useCallback((node: HTMLDivElement | null) => {
    stripRef.current = node;
    if (!node) return;
    const center = () => {
      const sel = node.querySelector<HTMLElement>('[data-sel="1"]');
      if (sel) node.scrollLeft = Math.max(0, sel.offsetLeft - (node.clientWidth - sel.offsetWidth) / 2);
    };
    center();                     // immediate (forces reflow → correct metrics)
    requestAnimationFrame(center); // re-center after the entry animation settles
  }, []);

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
      supabase.from("barbers").select("id, shop_id, user_id, name, bio, photo, is_active, rating, total_reviews, created_at").eq("shop_id", shop.id).eq("is_active", true).order("name"),
      blocksQ,
    ]);

    setAppointments((appts ?? []) as AppointmentWithDetails[]);
    setBarbers((bs ?? []) as Barber[]);
    setBlocks((blk ?? []) as BlockRow[]);
    setLoading(false);
  }, [shop, currentDate, view, profile, myBarberId, barberFilter, forceBarberId]);

  useEffect(() => { load(); }, [load]);

  // Deep link from the dashboard mini-calendar (?appt=<id>): once that day's
  // appointments have loaded, open the exact appointment's detail — once, so it
  // doesn't reopen on later reloads/navigation.
  const openedInitialAppt = useRef(false);
  useEffect(() => {
    if (openedInitialAppt.current || !initialApptId) return;
    const found = appointments.find(a => a.id === initialApptId);
    if (found) { setSelectedAppt(found); openedInitialAppt.current = true; }
  }, [appointments, initialApptId]);

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

  // Services + clients for the quick-add sheet (rarely change → fetch once per
  // shop). Clients power the searchable name field; RLS scopes the rows (owner
  // sees the whole book, a barber only clients they've served — phase43).
  useEffect(() => {
    if (!shop) return;
    supabase.from("services").select("id, name, price, duration_minutes")
      .eq("shop_id", shop.id).eq("is_active", true).order("name")
      .then(({ data }) => setServices((data ?? []) as ServiceLite[]));
    supabase.from("clients").select("id, name, phone, email, total_visits")
      .eq("shop_id", shop.id).order("total_visits", { ascending: false }).limit(500)
      .then(({ data }) => setAddClients((data ?? []) as ClientLite[]));
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
  const reloadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!shop) return;
    // Coalesce reload storms: a busy period (several appointments settling, a POS
    // burst) fires many row changes, and each reload is a full 3-query load. The
    // paid-flash still fires immediately below; only the reload is debounced.
    const debouncedReload = () => {
      if (reloadTimer.current) clearTimeout(reloadTimer.current);
      reloadTimer.current = setTimeout(() => loadRef.current(), 600);
    };
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
        debouncedReload();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "time_off_requests", filter: `shop_id=eq.${shop.id}` }, () => debouncedReload())
      .subscribe();
    return () => { if (reloadTimer.current) clearTimeout(reloadTimer.current); supabase.removeChannel(ch); };
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

  // Measure the day-timeline scroll viewport's height. The hour rows stretch to
  // fill it (see rowH in renderDayView) so a short day never leaves a dark band
  // below the grid on a tall desktop monitor. clientHeight is set by the flex
  // layout, not the content, so measuring it can't feed back into itself.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(entries => setDayColH(entries[0].contentRect.height));
    ro.observe(el);
    setDayColH(el.clientHeight);
    return () => ro.disconnect();
  }, [view, dayLayout, barberFilter, isMobile, showUnscheduled]);


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
    () => makeApptActions({ shop, accessToken, patch: applyLocal, setBusy: setActionBusy, toast: showToast, onDone: () => setSelectedAppt(null), confirm: (m) => confirm({ message: m }) }),
    [shop, accessToken, applyLocal, showToast, confirm],
  );

  // Empty "+" slots are shown every 30 min; a booking can still be added on a
  // 15-min offset via the add modal's time picker.
  const EMPTY_STEP = 30;   // base granularity for detecting free time
  const ADD_STEP = 15;

  // Shortest bookable service — a free gap smaller than this can't fit ANY
  // appointment, so we don't draw it as an empty "+" slot (those slivers just
  // chop the day up). Falls back to 30 min when no services are loaded.
  const minServiceMin = useMemo(() => {
    const ds = services.map(s => s.duration_minutes).filter((d): d is number => !!d && d > 0);
    return ds.length ? Math.min(...ds) : EMPTY_STEP;
  }, [services]);

  // Display-slots a barber's live appointments cover on the given day, at the
  // requested step. Cancelled/no-show are ignored so their times read as free.
  const bookedSlotsFor = useCallback((barberId: string, dateStr: string, step: number = EMPTY_STEP) => {
    const set = new Set<string>();
    appointments.forEach(a => {
      if (a.date === dateStr && a.barber_id === barberId && !freesSlot(a)) {
        occupiedSlots(a.time_slot, apptDuration(a), step).forEach(s => set.add(s));
      }
    });
    return set;
  }, [appointments]);

  // minutes-from-midnight → "10:20 AM" display slot.
  const minsToSlot = (m: number) =>
    dbTimeToDisplay(`${String(Math.floor(m / 60)).padStart(2, "0")}:${String(Math.round(m % 60)).padStart(2, "0")}:00`);

  // Free time in a barber's window as bookable "+" boxes. We subtract the real
  // booked intervals (active appts) AND blocked-hours, then emit ONE clean block
  // per contiguous free gap — no hour-by-hour chopping. Tapping a block opens the
  // add sheet where you pick the exact time + service, so any time is still
  // bookable. Gaps shorter than the shortest service are dropped (can't fit
  // anything). Does NOT drop past times (the owner still logs into empty boxes).
  const windowEmpties = useCallback((barberId: string, dateStr: string, win: { start: string; end: string }) => {
    const startMins = timeToMinutes(dbTimeToDisplay(win.start));
    const endMins = timeToMinutes(dbTimeToDisplay(win.end));
    if (Number.isNaN(startMins) || Number.isNaN(endMins) || endMins <= startMins) return [] as { slot: string; minutes: number }[];
    // Occupied = active appointments + blocked-hours for this barber/day, clipped
    // to the window and merged so adjacent/overlapping ones don't split a gap.
    const apptIntervals = appointments
      .filter(a => a.date === dateStr && a.barber_id === barberId && !freesSlot(a))
      .map(a => { const s = timeToMinutes(a.time_slot); return [s, s + apptDuration(a)] as [number, number]; });
    const blockIntervals = blocks
      .filter(b => b.barber_id === barberId && b.start_date === dateStr && b.start_time && b.end_time)
      .map(b => [timeToMinutes(dbTimeToDisplay(b.start_time!)), timeToMinutes(dbTimeToDisplay(b.end_time!))] as [number, number]);
    const occupied = [...apptIntervals, ...blockIntervals]
      .filter(([s, e]) => e > startMins && s < endMins)
      .sort((x, y) => x[0] - y[0]);
    const out: { slot: string; minutes: number }[] = [];
    // One block per free gap (drop gaps too small for the shortest service).
    const emit = (from: number, to: number) => {
      if (to - from >= minServiceMin) out.push({ slot: minsToSlot(from), minutes: Math.round(to - from) });
    };
    let cursor = startMins;
    for (const [s, e] of occupied) {
      const gapStart = Math.max(s, startMins);
      if (gapStart > cursor) emit(cursor, gapStart);
      cursor = Math.max(cursor, Math.min(e, endMins));
    }
    if (cursor < endMins) emit(cursor, endMins);
    return out;
  }, [appointments, blocks, minServiceMin]);

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
      <span className={cn(dim, "rounded-full flex items-center justify-center font-bold text-foreground", BARBER_DOT_PALETTE[i % BARBER_DOT_PALETTE.length])}>
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
  const openAdd = (barberId: string, barberName: string, time: string, boxMinutes?: number, general = false) => {
    if (!canManage && !canBlock) return;
    setAddForm({ client_name: "", client_phone: "", client_email: "", service_ids: [], time, date: formatDateForDb(currentDate) });
    setClientMode("search");
    const startMin = timeToMinutes(time);
    setBlockForm({ start: minsTo24h(startMin), end: minsTo24h(startMin + (boxMinutes && boxMinutes > 0 ? boxMinutes : 60)), reason: "" });
    setAddMode(canManage ? "appt" : "block");
    setAddCtx({ barberId, barberName, time, boxMinutes, general });
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
    if (!res.ok || !data.ok) {
      // Surface the failure — a silent return left the owner thinking time was
      // blocked (e.g. lunch) when it never saved, risking a booking over it.
      showToast(`Couldn't block that time: ${data.error ?? "please try again"}`);
      return;
    }
    setAddCtx(null);
    showToast("Time blocked");
    load();
  };

  const removeBlock = async (b: BlockRow) => {
    if (!shop || !accessToken) return;
    if (!(await confirm({ message: "Remove this block?", confirmText: "Remove", tone: "danger" }))) return;
    const res = await fetch("/api/calendar/block", {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ action: "remove", shop_id: shop.id, request_id: b.id }),
    }).catch(() => null);
    const data = res ? await res.json().catch(() => ({ ok: false })) : { ok: false };
    if (!res || !res.ok || !data.ok) { showToast(`Couldn't remove the block: ${data.error ?? "please try again"}`); return; }
    showToast("Block removed");
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
    // Must fit before the next booked appointment (the only hard stop — staff may
    // otherwise book over blocks / off-hours / off-days; the server enforces the
    // same double-booking guard authoritatively).
    if (addWindow && timeToMinutes(time) + duration > addWindow.freeUntil) {
      showToast("Not enough time before the next appointment — shorten the service or start earlier");
      return;
    }
    const outside = isOutsideSchedule(addCtx.barberId, time);
    const send = (overrideBlock: boolean) => fetch("/api/book/in-person", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) },
      body: JSON.stringify({
        shop_id: shop.id, barber_id: addCtx.barberId, service_id: svcs[0].id,
        service_ids: chosenIds,
        service_names: svcs.length > 1 ? svcs.map(s => s.name).join(" + ") : undefined,
        client_name: addForm.client_name.trim(), client_phone: addForm.client_phone.trim() || undefined,
        client_email: addForm.client_email.trim() || undefined,
        date: addForm.date || formatDateForDb(currentDate), time_slot: time,
        total_amount: price, duration_minutes: duration, pay_in_person: true,
        confirmed: true,
        redeem: addRedeem && !!addLoyalty?.eligible,   // spend loyalty points (server computes + deducts)
        override_block: overrideBlock || undefined,
        note: outside ? "⚠️ Booked outside the barber's working hours" : undefined,
      }),
    });

    setSavingAdd(true);
    let res = await send(false);
    let data = await res.json().catch(() => ({}));
    // A DELIBERATE break / lunch / time-off is respected with a warning: the
    // staff can confirm to book over it. (A regular off-day isn't flagged and
    // books straight through.) A double-booking has no `blocked` flag → hard stop.
    if (!res.ok && data.blocked) {
      setSavingAdd(false);
      const ok = await confirm({ message: `${addCtx.barberName} has time off or a break during this slot. Book them in anyway?`, confirmText: "Book anyway" });
      if (!ok) return;
      setSavingAdd(true);
      res = await send(true);
      data = await res.json().catch(() => ({}));
    }
    setSavingAdd(false);
    if (!res.ok) { showToast(data.error ?? "Couldn't add the appointment"); return; }
    setAddCtx(null);
    setAddForm({ client_name: "", client_phone: "", client_email: "", service_ids: [], time: "", date: "" });
    showToast(outside ? "Booked · outside working hours" : "Booked");
    load();
  };

  // Authoritative busy list for the add modal's chosen barber + date. The
  // calendar only loads a ~3–6 week window, but the add modal's date can jump
  // anywhere — so for an off-range day the in-memory `appointments` would look
  // empty and every slot would read free (a double-book waiting to happen). This
  // service-role fetch (same endpoint the booking page uses) is the source of
  // truth for that exact day and is merged into the runway + time list below.
  const [addBusy, setAddBusy] = useState<{ time_slot: string; duration: number }[] | null>(null);
  const addAvailReq = useRef(0);
  useEffect(() => {
    const bid = addCtx?.barberId;
    if (!addCtx || !shop || !bid) { setAddBusy(null); return; }
    const dateStr = addForm.date || formatDateForDb(currentDate);
    const reqId = ++addAvailReq.current;
    fetch("/api/availability", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ shop_id: shop.id, date: dateStr, barber_id: bid }),
    })
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        if (reqId !== addAvailReq.current) return; // a newer date/barber superseded this
        const b = ((d?.barbers ?? []) as { id: string; busy?: { time_slot: string; duration: number }[] }[]).find(x => x.id === bid);
        setAddBusy(b?.busy ?? []);
      })
      .catch(() => { if (reqId === addAvailReq.current) setAddBusy(null); });
  }, [addCtx, shop?.id, addForm.date, currentDate]);

  // Free 15-min start times for the add modal (within the barber's window,
  // excluding times already booked), so a 15-min offset can be picked.
  // Free runway from the tapped box start up to the next booked appointment
  // (open-ended if none after it). Drives the service/time fit checks.
  const addWindow = useMemo(() => {
    if (!addCtx) return null;
    // Runway from the SELECTED start (not the seeded box) to the next booking.
    const boxStart = timeToMinutes(addForm.time || addCtx.time);
    const dateStr = addForm.date || formatDateForDb(currentDate);
    const nexts = [
      ...appointments
        .filter(a => a.date === dateStr && a.barber_id === addCtx.barberId && !freesSlot(a))
        .map(a => timeToMinutes(a.time_slot)),
      ...(addBusy ?? []).map(b => timeToMinutes(b.time_slot)),
    ].filter(m => m > boxStart);
    return { boxStart, freeUntil: nexts.length ? Math.min(...nexts) : 24 * 60 };
  }, [addCtx, appointments, currentDate, addForm.time, addForm.date, addBusy]);

  // Recognize a returning client by the email/phone entered and surface their
  // redeemable loyalty balance (server decides eligibility: on-plan + enabled +
  // worth ≥ $5). Debounced; resets when the sheet closes, switches to Block, or
  // the contact clears.
  useEffect(() => {
    if (!addCtx || addMode !== "appt" || !shop) { setAddLoyalty(null); setAddRedeem(false); return; }
    const email = addForm.client_email.trim();
    const phone = addForm.client_phone.trim();
    if (!email.includes("@") && phone.replace(/\D/g, "").length < 7) {
      setAddLoyalty(null); setAddRedeem(false); return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const res = await fetch("/api/loyalty/lookup", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ shop_id: shop.id, email, phone }),
        });
        const data = await res.json();
        if (cancelled) return;
        if (data?.eligible) setAddLoyalty(data);
        else { setAddLoyalty(null); setAddRedeem(false); }
      } catch { if (!cancelled) setAddLoyalty(null); }
    }, 400);
    return () => { cancelled = true; clearTimeout(t); };
  }, [addCtx, addMode, shop, addForm.client_email, addForm.client_phone]);

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

  // Client search (the name field doubles as the query). Matches the global add
  // modal: pick an existing client to fill their contact, or add a new one.
  const addClientMatches = useMemo(() => {
    if (!addForm.client_name.trim()) return [] as ClientLite[];
    return addClients.filter(c => clientMatchesQuery(c, addForm.client_name)).slice(0, 6);
  }, [addClients, addForm.client_name]);
  const onAddNameChange = (v: string) => { setAddForm(p => ({ ...p, client_name: v })); setClientMode("search"); };
  const pickAddClient = (c: ClientLite) => {
    setAddForm(p => ({ ...p, client_name: c.name ?? "", client_phone: c.phone ?? "", client_email: c.email ?? "" }));
    setClientMode("existing");
  };
  const addNewClient = () => { setAddForm(p => ({ ...p, client_phone: "", client_email: "" })); setClientMode("new"); };

  // Only genuinely-AVAILABLE start times: inside the barber's working hours for
  // the day, not already booked, not in a blocked range, and not in the past
  // (today). The header "+" (general) lists the whole working window; a tapped
  // empty box also keeps that exact slot selectable even if it's overtime.
  const addTimeOptions = useMemo(() => {
    if (!addCtx) return [] as string[];
    const dateStr = addForm.date || formatDateForDb(currentDate);
    // In-memory booked slots (loaded range) UNIONed with the authoritative
    // server busy list for this exact day — so an off-range date can't read free.
    const booked = new Set(bookedSlotsFor(addCtx.barberId, dateStr, ADD_STEP));
    (addBusy ?? []).forEach(b => occupiedSlots(b.time_slot, b.duration || 30, ADD_STEP).forEach(s => booked.add(s)));
    const isToday = dateStr === formatDateForDb(new Date());
    const now = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes();
    // Start times of the day's other bookings → so a slot whose chosen service
    // would overrun into the next appointment is DROPPED from the list entirely
    // (not just shown disabled "won't fit"). Same in-memory + server union.
    const bookingStarts = [
      ...appointments
        .filter(a => a.date === dateStr && a.barber_id === addCtx.barberId && !freesSlot(a))
        .map(a => timeToMinutes(a.time_slot)),
      ...(addBusy ?? []).map(b => timeToMinutes(b.time_slot)),
    ];
    const nextBookingAfter = (m: number) => {
      const after = bookingStarts.filter(s => s > m);
      return after.length ? Math.min(...after) : 24 * 60;
    };
    const opts: string[] = [];
    // Staff can write a client in at ANY time of day — the in-app calendar add is
    // deliberately NOT bound to the barber's working hours or off-days (that
    // schedule still governs the customer-facing booking page). The only starts we
    // drop are ones that would DOUBLE-BOOK: a slot already taken, a past time
    // today, or a start whose service would overrun into the next appointment.
    // Blocks / time-off are intentionally NOT filtered out — staff may squeeze
    // someone in over a break (the server allows it for staff too).
    for (let m = 0; m < 24 * 60; m += ADD_STEP) {
      if (isToday && m < nowMin) continue;
      const slot = minsToSlot(m);
      if (booked.has(slot)) continue;
      if (addTotalDuration > 0 && m + addTotalDuration > nextBookingAfter(m)) continue;
      opts.push(slot);
    }
    // A deliberately-tapped empty box (an off-grid time like 9:35) stays pickable
    // — inserted in CHRONOLOGICAL order, not pinned to the top, so the list reads
    // 9:15 → 9:30 → 9:35 → 9:45 and the native picker opens scrolled to it (with
    // earlier times scrollable above and later ones below). Never re-add a slot
    // already in the PAST today (you can't book earlier than now).
    if (!addCtx.general && addCtx.time && !opts.includes(addCtx.time)
        && !(isToday && timeToMinutes(addCtx.time) < nowMin)) {
      const tMin = timeToMinutes(addCtx.time);
      const idx = opts.findIndex(s => timeToMinutes(s) > tMin);
      if (idx === -1) opts.push(addCtx.time); else opts.splice(idx, 0, addCtx.time);
    }
    return opts;
  }, [addCtx, currentDate, addForm.date, bookedSlotsFor, appointments, addTotalDuration, addBusy]);

  // Keep the selected time valid — default to the first available slot when the
  // seeded time isn't bookable (e.g. the header "+" landed before opening hours).
  useEffect(() => {
    if (!addCtx) return;
    setAddForm(f => (addTimeOptions.length && !addTimeOptions.includes(f.time) ? { ...f, time: addTimeOptions[0] } : f));
  }, [addCtx, addTimeOptions]);

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
  // Independent, horizontally-scrollable date rail. Swiping it browses days
  // WITHOUT switching the selected day — only a tap selects (and loads that
  // day's schedule below). It renders a wide window centered on the selected
  // day and is auto-centered by an effect; touch events stopPropagation so the
  // calendar-wide period swipe never fires from a rail scroll.
  const STRIP_RANGE = 28; // days rendered each side of the selected day
  const renderWeekStrip = () => {
    const selectedStr = formatDateForDb(currentDate);
    const days = Array.from({ length: STRIP_RANGE * 2 + 1 }, (_, i) => addDays(currentDate, i - STRIP_RANGE));
    return (
      <div
        ref={setStripRef}
        onTouchStart={(e) => e.stopPropagation()}
        onTouchMove={(e) => e.stopPropagation()}
        onTouchEnd={(e) => e.stopPropagation()}
        className="flex overflow-x-auto overscroll-x-contain border-b border-border bg-card flex-shrink-0 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
      >
        {days.map(day => {
          const dateStr = formatDateForDb(day);
          const isSel = dateStr === selectedStr;
          const today = isToday(day);
          const count = appointments.filter(a => a.date === dateStr && !freesSlot(a)).length;
          return (
            <button key={dateStr} data-sel={isSel ? "1" : undefined}
              onClick={() => { setNavDir(dateStr >= selectedStr ? 1 : -1); setCurrentDate(day); }}
              className="flex-shrink-0 basis-[14.2857%] min-w-[3rem] py-1.5 text-center hover:bg-card-raised transition-colors">
              <p className={cn("text-[10px] uppercase tracking-wider", today ? "text-accent-soft" : "text-grey-muted")}>
                {day.toLocaleDateString("en-CA", { weekday: "narrow" })}
              </p>
              <p className={cn(
                "text-sm font-bold mt-0.5 inline-flex items-center justify-center w-8 h-8 rounded-full transition-colors",
                isSel ? "bg-accent text-foreground" : today ? "text-accent-soft" : "text-foreground",
              )}>
                {day.getDate()}
              </p>
              <div className="flex justify-center gap-0.5 mt-0.5 h-1">
                {count > 0 && <span className="w-1 h-1 rounded-full bg-accent-soft" />}
                {count > 3 && <span className="w-1 h-1 rounded-full bg-accent-soft" />}
                {count > 6 && <span className="w-1 h-1 rounded-full bg-accent-soft" />}
              </div>
            </button>
          );
        })}
      </div>
    );
  };

  // ── YEAR VIEW ───────────────────────────────────────────────────────────────
  // 12 mini-months; tap one to drop into that Month. Days with appointments are
  // brightened, today is the accent pill — the same language as Apple's year grid.
  const renderYearView = () => {
    const year = currentDate.getFullYear();
    const todayStr = formatDateForDb(new Date());
    const apptDays = new Set(
      appointments.filter(a => !freesSlot(a) && a.date.startsWith(`${year}-`)).map(a => a.date),
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
                className="text-left rounded-xl p-1.5 hover:bg-card transition-colors">
                <p className="text-sm font-bold text-accent-soft mb-1 px-0.5">
                  {first.toLocaleDateString("en-CA", { month: "long" })}
                </p>
                <div className="grid grid-cols-7 gap-y-0.5">
                  {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
                    <span key={`h${i}`} className="text-[8px] text-grey-muted text-center">{d}</span>
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
                          : isTodayCell ? "bg-accent text-foreground font-bold"
                          : has ? "text-foreground font-semibold"
                          : "text-grey",
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
        <div className="grid grid-cols-7 border-b border-border bg-card">
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(d => (
            <div key={d} className="px-2 py-2 text-xs font-medium text-grey-muted text-center">{d}</div>
          ))}
        </div>
        <div className="grid grid-cols-7 flex-1 auto-rows-min overflow-y-auto bg-card">
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
                  "border-r border-b border-border p-1 sm:p-1.5 text-left flex flex-col gap-1 transition-colors",
                  embedded ? "min-h-[58px] sm:min-h-[88px]" : "min-h-[96px] sm:min-h-[132px]",
                  "hover:bg-card-raised",
                  !inMonth && "bg-background",
                )}
              >
                <div className="flex items-center justify-between">
                  <span className={cn(
                    "text-xs font-medium w-6 h-6 rounded-full flex items-center justify-center",
                    isToday(day) ? "bg-accent text-foreground font-bold" :
                    inMonth ? "text-foreground" : "text-[#444]",
                  )}>
                    {day.getDate()}
                  </span>
                </div>
                {isToday(day) && <span className="text-[9px] font-bold uppercase tracking-wide text-accent-soft leading-none">Today</span>}
                {isMobile ? (
                  // Phones: just colored dots per booking; cell is too narrow for chip text
                  <div className="flex flex-wrap gap-0.5 overflow-hidden">
                    {dayAppts.slice(0, 10).map(a => (
                      <span key={a.id} className={cn("w-1.5 h-1.5 rounded-full", statusDot(a.status))} />
                    ))}
                    {dayAppts.length > 10 && (
                      <span className="text-[9px] text-grey-muted leading-none">+{dayAppts.length - 10}</span>
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
                      <span className="text-[10px] text-grey-muted pl-1.5">+{overflow} more</span>
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
    const dayAppts = appointments.filter(a => a.date === dateStr && a.barber_id === barber.id && !freesSlot(a));
    const dayBlocks = blocksFor(barber.id, dateStr);
    // Cancelled / no-show whose slot is free again — shown as faded, dismissible
    // "book again" cards (matches the timeline). Hidden once the slot is rebooked
    // (an active booking overlaps) or the owner taps ✕.
    const freedCells = appointments.filter(a => a.date === dateStr && a.barber_id === barber.id
      && (a.status === "cancelled" || a.status === "no-show") && !dismissedFreed.has(a.id))
      .filter(fa => { const s = timeToMinutes(fa.time_slot), e = s + apptDuration(fa);
        return !dayAppts.some(act => { const as = timeToMinutes(act.time_slot); return as < e && as + apptDuration(act) > s; }); });
    // Drop any free slot that falls inside a block window (so it can't be booked
    // over, and the grid shows the block instead).
    const emptySlots = windowEmpties(barber.id, dateStr, { start: startDb, end: endDb })
      .filter(e => { const s = timeToMinutes(e.slot); return !dayBlocks.some(b => s < b.endMin && s + e.minutes > b.startMin); });

    type Cell =
      | { k: "appt"; a: AppointmentWithDetails }
      | { k: "empty"; s: string; minutes: number }
      | { k: "block"; b: (typeof dayBlocks)[number] }
      | { k: "freed"; a: AppointmentWithDetails };
    const cells: Cell[] = [
      ...emptySlots.map(e => ({ k: "empty", s: e.slot, minutes: e.minutes } as Cell)),
      ...dayAppts.map(a => ({ k: "appt", a } as Cell)),
      ...dayBlocks.map(b => ({ k: "block", b } as Cell)),
      ...freedCells.map(a => ({ k: "freed", a } as Cell)),
    ];
    const cellStart = (c: Cell) => (c.k === "appt" || c.k === "freed") ? timeToMinutes(c.a.time_slot) : c.k === "empty" ? timeToMinutes(c.s) : c.b.startMin;
    cells.sort((x, y) => cellStart(x) - cellStart(y));

    return (
      <div className="p-4 sm:p-5">
        {!sched && (
          <p className="text-xs text-grey-muted mb-3">No schedule set for this day — showing a default 9 AM–10 PM window.</p>
        )}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {cells.map((c, ci) => c.k === "empty" ? (
            <button key={`e${ci}`} onClick={() => openAdd(barber.id, barber.name, c.s, c.minutes)}
              className="rounded-xl bg-card hover:bg-card-raised transition-colors p-3 text-left min-h-[88px] flex flex-col justify-between">
              <span className="text-xs text-grey-muted">{rangeLabel(c.s, c.minutes)}</span>
              <span className="text-[10px] text-[#444]">Free</span>
            </button>
          ) : c.k === "block" ? (
            <button key={`b${c.b.id}`} onClick={() => canBlock && removeBlock(c.b)} disabled={!canBlock}
              style={{ backgroundImage: "repeating-linear-gradient(45deg, var(--surface-overlay), var(--surface-overlay) 6px, var(--border-strong) 6px, var(--border-strong) 12px)" }}
              className={cn("rounded-xl p-3 text-left min-h-[88px] flex flex-col justify-between border border-dashed border-border-strong transition-colors",
                canBlock ? "hover:border-[#4a4a4a]" : "cursor-default")}>
              <span className="text-xs font-medium text-[#bdbdbd]">{rangeLabel(dbTimeToDisplay(c.b.start_time!), c.b.endMin - c.b.startMin)}</span>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-[#dcdcdc] flex items-center gap-1"><Ban size={12} /> Blocked</p>
                {c.b.reason && <p className="text-[11px] text-grey truncate">{c.b.reason}</p>}
              </div>
              <span className={cn("text-[10px] font-semibold", c.b.status === "pending" ? "text-amber-400" : "text-grey")}>
                {c.b.status === "pending" ? "Pending approval" : canBlock ? "Tap to remove" : "Blocked"}
              </span>
            </button>
          ) : c.k === "freed" ? (
            <button key={`freed-${c.a.id}`} onClick={() => openAdd(barber.id, barber.name, c.a.time_slot, apptDuration(c.a))}
              className="relative rounded-xl p-3 text-left min-h-[88px] flex flex-col justify-between border border-dashed border-[#ff6b6b]/50 bg-[#ff6b6b]/[0.06] hover:bg-[#ff6b6b]/10 transition-colors">
              <span className="text-xs font-medium text-grey">{rangeLabel(c.a.time_slot, apptDuration(c.a))}</span>
              <div className="min-w-0">
                <p className={cn("text-sm font-semibold truncate text-[#ff8a8a]", c.a.status !== "no-show" && "line-through")}>{c.a.status === "no-show" ? "No-show" : "Cancelled"}</p>
                <p className="text-[11px] text-grey-muted truncate">{c.a.client_name}</p>
              </div>
              <span className="text-[10px] font-semibold text-grey-muted">Open — tap to book again</span>
              <span role="button" tabIndex={0} aria-label="Dismiss"
                onClick={(e) => { e.stopPropagation(); dismissFreed(c.a.id); }}
                className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full flex items-center justify-center text-grey-muted hover:text-foreground hover:bg-white/10">
                <X size={13} />
              </span>
            </button>
          ) : (
            <button key={c.a.id} onClick={() => setSelectedAppt(c.a)}
              className={cn(
                "rounded-xl p-3 text-left min-h-[88px] flex flex-col justify-between transition-all hover:brightness-125",
                apptBlock(c.a), isDimmed(c.a.status) && "opacity-60 line-through",
                flashIds.has(c.a.id) && "ring-2 ring-[#00e5a0] animate-pulse",
              )}>
              <span className="text-xs font-medium text-grey">{rangeLabel(c.a.time_slot, apptDuration(c.a))}</span>
              <div className="min-w-0">
                <p className="text-sm font-semibold truncate">{c.a.client_name}</p>
                <p className="text-[11px] text-grey truncate">
                  {(c.a.services as { name: string } | null)?.name ?? "—"}
                  {(Number(c.a.total_amount ?? 0) + Number(c.a.tip_amount ?? 0)) > 0 ? ` · ${formatCurrency(Number(c.a.total_amount ?? 0) + Number(c.a.tip_amount ?? 0))}` : ""}
                </p>
              </div>
              {(c.a.payment_status === "paid" || c.a.payment_status === "captured") ? (
                <span className="text-[10px] font-semibold">
                  <span className="text-[#00e5a0]">Paid</span>
                  <span className="text-grey-muted"> · </span>
                  <span className={c.a.payment_method === "cash" ? "text-[#bbb]" : "text-[#00e5a0]"}>
                    {c.a.payment_method === "cash" ? "Cash" : c.a.payment_method === "online" ? "Online" : "Card"}
                  </span>
                </span>
              ) : c.a.status === "completed" ? (
                <span className="text-[10px] font-semibold text-[#bbb]">Unpaid</span>
              ) : c.a.stripe_payment_method_id ? (
                <span className="text-[10px] font-semibold text-[#4a9eff]">
                  {c.a.payment_status === "held" ? "Card held" : c.a.payment_status === "saved" ? "Card saved" : "Card on file"}
                </span>
              ) : c.a.payment_method === "cash" ? (
                <span className="text-[10px] font-semibold text-[#bbb]">Pay at shop</span>
              ) : (
                <span className="text-[10px] font-semibold text-grey">{statusLabel(c.a.status)}</span>
              )}
            </button>
          ))}
          {cells.length === 0 && (
            <p className="col-span-full text-center text-sm text-grey-muted py-10">Nothing scheduled.</p>
          )}
        </div>
      </div>
    );
  };

  const renderDayView = () => {
    const dateStr = formatDateForDb(currentDate);
    const dayAppts = appointments.filter(a => a.date === dateStr && !freesSlot(a));

    // Columns: barber portal / a picked barber / phone → a single column (the
    // header dropdown chooses which); big-screen all-barbers → every scheduled
    // barber (paged if there are a lot). Both render the same vertical timeline.
    const single = !!forceBarberId || barberFilter !== "all" || profile?.role === "barber" || isMobile;
    const soloBarber = barbers.find(b => b.id === dayBarberId) ?? null;
    const allCols = dayAllCols;
    const cols: Barber[] = single
      ? (soloBarber ? [soloBarber] : [])
      : allCols.slice(dayPage * dayPerPage, dayPage * dayPerPage + dayPerPage);

    // "Box" layout — the card grid of slots for the active barber (reuses the
    // existing renderBarberGrid). Toggled from the header.
    if (dayLayout === "grid") {
      return (
        <div className="flex flex-col h-full">
          {renderWeekStrip()}
          <div className="overflow-auto flex-1">
            {soloBarber
              ? renderBarberGrid(soloBarber)
              : <p className="text-center text-sm text-grey-muted py-12">No barbers yet.</p>}
          </div>
        </div>
      );
    }

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

    // Stretch the hour rows so the grid always fills the visible scroll area —
    // on a tall desktop a short day would otherwise end mid-screen and leave a
    // dark void below. On laptops/phones the natural 62px wins (no change). One
    // shared rowH drives the gridlines AND the absolute-positioned cards, so
    // everything stays aligned.
    const rowH = dayColH > 0 && hours.length > 0
      ? Math.max(ROW_PX, Math.ceil(dayColH / hours.length))
      : ROW_PX;

    return (
      <div ref={colWrapRef} className="flex flex-col h-full">
        {renderWeekStrip()}
        {/* Only when some barbers ARE scheduled (so the off ones are actually
            hidden). If nobody's scheduled we already show everyone as a
            fallback, so there's nothing to reveal — no button. */}
        {!single && scheduledBarbers.length > 0 && unscheduledCount > 0 && (
          <button type="button" onClick={() => setShowUnscheduled(v => !v)}
            className="self-start mx-3 my-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium bg-card-raised border border-border text-grey hover:text-foreground transition-colors flex-shrink-0">
            {showUnscheduled ? `Hide ${unscheduledCount} off today` : `+${unscheduledCount} off today · show`}
          </button>
        )}
        {/* Bring back no-shows the owner dismissed (✕) — they carry a charged fee,
            so hiding them permanently made "why was this billed?" unanswerable. */}
        {(() => {
          const dn = appointments.filter(a => a.date === dateStr && a.status === "no-show" && dismissedFreed.has(a.id));
          if (dn.length === 0) return null;
          return (
            <button type="button" onClick={() => revealFreed(dn.map(a => a.id))}
              className="self-start mx-3 my-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium bg-zinc-500/15 border border-zinc-500/30 text-zinc-300 hover:text-foreground transition-colors flex-shrink-0">
              {dn.length} no-show{dn.length === 1 ? "" : "s"} · show
            </button>
          );
        })()}
        <div ref={scrollRef} className="overflow-y-auto overflow-x-hidden flex-1">
          <div>
            {!single && (
            <div className="grid sticky top-0 z-10 bg-background border-b border-border" style={{ gridTemplateColumns: `56px repeat(${cols.length}, minmax(0, 1fr))` }}>
              {/* "All barbers" — focused here since we're in the all-barbers view */}
              <button type="button" onClick={() => setBarberFilter("all")}
                className="flex items-center justify-center py-1.5 transition-colors hover:bg-card-raised">
                <span className={cn("w-7 h-7 rounded-full flex items-center justify-center bg-surface-overlay text-grey", barberFilter === "all" && "ring-2 ring-[#00e5a0] ring-offset-1 ring-offset-[#0a0a0a]")}>
                  <Users size={14} />
                </span>
              </button>
              {cols.map((b) => {
                const gi = barbers.indexOf(b);
                const n = dayAppts.filter(a => barbers.length === 0 || a.barber_id === b.id).length;
                return (
                  <button key={b.id} type="button" onClick={() => setBarberFilter(b.id)}
                    className="px-2 py-1.5 border-l border-border hover:bg-card-raised transition-colors min-w-0">
                    <div className="flex items-center justify-center gap-1.5 min-w-0">
                      <BarberAvatar b={b} i={gi >= 0 ? gi : 0} sm />
                      <span className="text-xs text-foreground font-medium truncate">{b.name}</span>
                      {!schedules.has(b.id) && <span className="text-[9px] text-grey-muted flex-shrink-0" title="No schedule set for today">off</span>}
                    </div>
                    <p className="text-[10px] text-grey-muted leading-none mt-0.5 text-center">{n} appt{n === 1 ? "" : "s"}</p>
                  </button>
                );
              })}
            </div>
            )}

          <div className="relative">
            {hours.map(hour => (
              <div key={hour} className="grid border-b border-border relative" style={{ gridTemplateColumns: `56px repeat(${cols.length}, minmax(0, 1fr))`, height: `${rowH}px` }}>
                <div className="relative text-right pr-2">
                  <span className="text-[10px] text-grey">
                    {hour === 0 ? "12 AM" : hour < 12 ? `${hour} AM` : hour === 12 ? "12 PM" : `${hour - 12} PM`}
                  </span>
                </div>
                {cols.map(b => (
                  <div key={b.id} className="border-l border-border" />
                ))}
              </div>
            ))}

            <div className="absolute inset-0 pointer-events-none" style={{ display: "grid", gridTemplateColumns: `56px repeat(${cols.length}, minmax(0, 1fr))` }}>
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
                      const top = (parseTime(slot) - winStart) * rowH;
                      const height = Math.max(16, (minutes / 60) * rowH - 4);
                      const outside = isOutsideSchedule(b.id, slot);
                      return (
                        <button key={`e${slot}`}
                          title={outside ? "Outside working hours — tap to add" : "Add appointment"}
                          style={{ top: `${top + 2}px`, height: `${height}px`, left: "4px", right: "4px", position: "absolute" }}
                          // Every slot gets the same fill so all barber columns read
                          // consistently, regardless of schedule (no more half-shaded
                          // columns). The tooltip still notes outside-hours.
                          className="rounded-lg transition-colors pointer-events-auto overflow-hidden bg-card-raised hover:bg-surface-overlay"
                          onClick={() => openAdd(b.id, b.name, slot, minutes)} />
                      );
                    })}
                    {/* Blocked-hours bands — hatched; tap to remove (if allowed) */}
                    {colBlocks.map(bl => {
                      const top = (bl.startMin / 60 - winStart) * rowH;
                      const height = Math.max(16, ((bl.endMin - bl.startMin) / 60) * rowH - 4);
                      return (
                        <button key={`blk${bl.id}`}
                          title={bl.status === "pending" ? "Block (pending approval)" : "Blocked — tap to remove"}
                          onClick={() => canBlock && removeBlock(bl)} disabled={!canBlock}
                          style={{ top: `${top + 2}px`, height: `${height}px`, left: "4px", right: "4px", position: "absolute",
                            backgroundImage: "repeating-linear-gradient(45deg, var(--surface-overlay), var(--surface-overlay) 6px, var(--border-strong) 6px, var(--border-strong) 12px)" }}
                          className={cn("rounded-lg border border-dashed pointer-events-auto overflow-hidden px-1.5 py-0.5 text-left",
                            bl.status === "pending" ? "border-amber-500/50" : "border-border-strong")}>
                          <p className="text-[9px] font-semibold text-[#cfcfcf] flex items-center gap-0.5 leading-tight"><Ban size={9} /> Blocked</p>
                          {height > 28 && <p className="text-[8px] text-grey truncate leading-tight">{dbTimeToDisplay(bl.start_time!)}–{dbTimeToDisplay(bl.end_time!)}</p>}
                          {bl.reason && height > 44 && <p className="text-[8px] text-grey truncate leading-tight">{bl.reason}</p>}
                        </button>
                      );
                    })}
                    {/* Booked blocks — height ∝ duration; overlaps sit side-by-side */}
                    {laid.map(({ a: appt, lane, lanes }) => {
                      const top = (parseTime(appt.time_slot) - winStart) * rowH;
                      const duration = apptDuration(appt);
                      const height = Math.max(28, (duration / 60) * rowH - 4);
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
                            "rounded-[10px] px-1.5 py-0.5 text-left overflow-hidden pointer-events-auto transition-all hover:z-10 hover:brightness-125",
                            apptBlock(appt),
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
                                    {i > 0 && <span className="text-grey-muted">·</span>}
                                    <span className={s.className}>{s.text}</span>
                                  </Fragment>
                                ))}
                              </span>
                            </div>
                          )}
                          {height > 64 && (
                            <p className="text-[9px] text-grey truncate leading-tight">
                              {(appt.services as { name: string } | null)?.name ?? "—"}
                              {(Number(appt.total_amount ?? 0) + Number(appt.tip_amount ?? 0)) > 0 ? ` · ${formatCurrency(Number(appt.total_amount ?? 0) + Number(appt.tip_amount ?? 0))}` : ""}
                            </p>
                          )}
                        </button>
                      );
                    })}

                    {/* Cancelled / no-show markers — the slot is already free to
                        book again; they linger as a faded, dismissible reminder
                        of what happened. No-show is tinted red, a customer
                        cancel is blurred grey. Hidden once the slot is rebooked
                        (an active booking overlaps) or the owner taps ✕. */}
                    {appointments
                      .filter(fa => fa.date === dateStr
                        && (barbers.length === 0 || fa.barber_id === b.id)
                        && (fa.status === "cancelled" || fa.status === "no-show")
                        && !dismissedFreed.has(fa.id))
                      .filter(fa => {
                        const s = timeToMinutes(fa.time_slot), e = s + apptDuration(fa);
                        return !colAppts.some(act => { const as = timeToMinutes(act.time_slot); return as < e && as + apptDuration(act) > s; });
                      })
                      .map(fa => {
                        const top = (parseTime(fa.time_slot) - winStart) * rowH;
                        const height = Math.max(22, (apptDuration(fa) / 60) * rowH - 4);
                        const noShow = fa.status === "no-show";
                        return (
                          <button key={`freed-${fa.id}`}
                            title={`${noShow ? "No-show" : "Cancelled"} — tap to book this slot again`}
                            style={{ top: `${top + 2}px`, height: `${height}px`, left: "4px", right: "4px", position: "absolute" }}
                            onClick={() => openAdd(b.id, b.name, fa.time_slot, apptDuration(fa))}
                            className="rounded-lg border border-dashed border-[#ff6b6b]/50 bg-[#ff6b6b]/[0.06] hover:bg-[#ff6b6b]/10 px-1.5 py-0.5 text-left overflow-hidden pointer-events-auto transition-colors">
                            <p className={cn("text-[10px] font-semibold leading-tight truncate text-[#ff8a8a]", !noShow && "line-through")}>
                              {noShow ? "No-show" : "Cancelled"}<span className="text-grey-muted font-normal no-underline"> · {fa.client_name}</span>
                            </p>
                            {height > 30 && <p className="text-[8px] text-grey-muted leading-tight no-underline">Open — tap to book again</p>}
                            <span role="button" tabIndex={0} aria-label="Dismiss"
                              onClick={(e) => { e.stopPropagation(); dismissFreed(fa.id); }}
                              className="absolute top-0.5 right-0.5 w-5 h-5 rounded-full flex items-center justify-center text-grey-muted hover:text-foreground hover:bg-white/10">
                              <X size={11} />
                            </span>
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
              const top = (currentH - winStart) * rowH;
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
      const dayAppts = appointments.filter(a => a.date === selectedStr && !freesSlot(a));
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
          <div className="grid grid-cols-7 border-b border-border bg-card flex-shrink-0">
            {weekDays.map(day => {
              const dateStr = formatDateForDb(day);
              const isSelected = dateStr === selectedStr;
              const today = isToday(day);
              const count = appointments.filter(a => a.date === dateStr && !freesSlot(a)).length;
              return (
                <button key={dateStr} onClick={() => { setNavDir(formatDateForDb(day) >= formatDateForDb(currentDate) ? 1 : -1); setCurrentDate(day); }}
                  className="py-2 text-center hover:bg-card-raised transition-colors">
                  <p className={cn("text-[10px] uppercase tracking-wider", today ? "text-foreground" : "text-grey-muted")}>
                    {day.toLocaleDateString("en-CA", { weekday: "narrow" })}
                  </p>
                  <p className={cn(
                    "text-base font-bold mt-0.5 inline-flex items-center justify-center w-8 h-8 rounded-full",
                    isSelected ? "bg-accent text-foreground" : "text-foreground",
                  )}>
                    {day.getDate()}
                  </p>
                  <div className="flex justify-center gap-0.5 mt-0.5 h-1">
                    {count > 0 && <span className="w-1 h-1 rounded-full bg-accent-soft" />}
                    {count > 3 && <span className="w-1 h-1 rounded-full bg-accent-soft" />}
                    {count > 6 && <span className="w-1 h-1 rounded-full bg-accent-soft" />}
                  </div>
                </button>
              );
            })}
          </div>
          {/* Single-day timeline for the selected day */}
          <div ref={scrollRef} className="overflow-auto flex-1">
            <div className="relative">
              {hours.map(hour => (
                <div key={hour} className="grid border-b border-border" style={{ gridTemplateColumns: `48px 1fr`, height: `${ROW_PX}px` }}>
                  <div className="text-[10px] text-grey text-right pr-2 pt-1">
                    {hour === 0 ? "12 AM" : hour < 12 ? `${hour} AM` : hour === 12 ? "12 PM" : `${hour - 12} PM`}
                  </div>
                  <div className="border-l border-border" />
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
                          <p className="text-[11px] text-grey truncate">
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
                          backgroundImage: "repeating-linear-gradient(45deg, var(--surface-overlay), var(--surface-overlay) 6px, var(--border-strong) 6px, var(--border-strong) 12px)" }}
                        className={cn("rounded-lg border border-dashed pointer-events-auto overflow-hidden px-2 py-1 text-left", b.status === "pending" ? "border-amber-500/50" : "border-border-strong")}>
                        <p className="text-xs font-semibold text-[#cfcfcf] truncate leading-tight flex items-center gap-1"><Ban size={11} /> Blocked</p>
                        {height > 30 && <p className="text-[11px] text-grey truncate leading-tight">{dbTimeToDisplay(b.start_time!)} – {dbTimeToDisplay(b.end_time!)}{b.reason ? ` · ${b.reason}` : ""}</p>}
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
    const weekAppts = appointments.filter(a => weekStrs.has(a.date) && !freesSlot(a));
    const wwStarts: number[] = [], wwEnds: number[] = [];
    weekAppts.forEach(a => { const s = parseTime(a.time_slot); wwStarts.push(s); wwEnds.push(s + apptDuration(a) / 60); });
    blocks.filter(b => weekStrs.has(b.start_date) && b.start_time && b.end_time).forEach(b => {
      wwStarts.push(timeToMinutes(dbTimeToDisplay(b.start_time!)) / 60);
      wwEnds.push(timeToMinutes(dbTimeToDisplay(b.end_time!)) / 60);
    });
    const { winStart, hours } = hourWindow(wwStarts, wwEnds);

    return (
      <div ref={scrollRef} className="overflow-auto h-full">
        {/* Fluid (min-w-0) so all 7 day columns shrink to fit any screen —
            phone/tablet/iPad — instead of a fixed 700px grid that scrolled + clipped. */}
        <div className="min-w-0">
          <div className="grid sticky top-0 z-10 bg-background border-b border-border" style={{ gridTemplateColumns: `48px repeat(7, minmax(0, 1fr))` }}>
            <div />
            {weekDays.map(day => {
              const dateStr = formatDateForDb(day);
              const dayAppts = appointments.filter(a => a.date === dateStr && !freesSlot(a));
              const today = isToday(day);
              return (
                <button key={dateStr} onClick={() => openDay(day)}
                  className={cn("py-2 text-center border-l border-border hover:bg-card-raised transition-colors", today && "bg-accent-muted")}>
                  <p className={cn("text-[10px] uppercase tracking-wider", today ? "text-foreground" : "text-grey-muted")}>
                    {day.toLocaleDateString("en-CA", { weekday: "short" })}
                  </p>
                  <p className={cn(
                    "text-lg font-bold mt-0.5 inline-flex items-center justify-center w-8 h-8 rounded-full",
                    today ? "bg-accent text-foreground" : "text-foreground",
                  )}>
                    {day.getDate()}
                  </p>
                  {dayAppts.length > 0 && (
                    <p className="text-[10px] text-grey-muted mt-0.5">{dayAppts.length}</p>
                  )}
                </button>
              );
            })}
          </div>

          <div className="relative">
            {hours.map(hour => (
              <div key={hour} className="grid border-b border-border" style={{ gridTemplateColumns: `48px repeat(7, minmax(0, 1fr))`, height: `${ROW_PX}px` }}>
                <div className="text-[10px] text-grey text-right pr-2 pt-1">
                  {hour === 0 ? "12 AM" : hour < 12 ? `${hour} AM` : hour === 12 ? "12 PM" : `${hour - 12} PM`}
                </div>
                {weekDays.map(day => (
                  <div key={formatDateForDb(day)} className={cn("border-l border-border", isToday(day) && "bg-accent-muted")} />
                ))}
              </div>
            ))}

            <div className="absolute inset-0 pointer-events-none" style={{ display: "grid", gridTemplateColumns: `48px repeat(7, minmax(0, 1fr))` }}>
              <div />
              {weekDays.map(day => {
                const dateStr = formatDateForDb(day);
                const dayAppts = appointments.filter(a => a.date === dateStr && !freesSlot(a));
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
                            <p className="text-[10px] text-grey truncate">{appt.time_slot}</p>
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
                            backgroundImage: "repeating-linear-gradient(45deg, var(--surface-overlay), var(--surface-overlay) 6px, var(--border-strong) 6px, var(--border-strong) 12px)" }}
                          className={cn("rounded border border-dashed pointer-events-auto overflow-hidden px-1", b.status === "pending" ? "border-amber-500/50" : "border-border-strong")}>
                          <p className="text-[10px] font-semibold text-[#cfcfcf] truncate leading-tight flex items-center gap-0.5"><Ban size={9} /> Blocked</p>
                          {height > 32 && <p className="text-[9px] text-grey truncate leading-tight">{dbTimeToDisplay(b.start_time!)}–{dbTimeToDisplay(b.end_time!)}</p>}
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
  // Header "+" → reuse the slot add-appointment modal, seeded with the day's
  // current barber and a full-day time picker (no slot tap needed).
  const openAddGeneral = () => {
    const bId = dayBarberId ?? orderedBarbers[0]?.id;
    if (!bId) return;
    const bName = barbers.find(b => b.id === bId)?.name ?? "";
    openAdd(bId, bName, "9:00 AM", 13 * 60, true);
  };
  // The bottom-nav "+" now opens the GLOBAL add-appointment modal (mounted in the
  // dashboard layout) — it no longer navigates here. That modal posts to the same
  // /api/book/in-person this calendar uses, so when it books while the calendar is
  // open, refresh so the new appointment shows immediately.
  useEffect(() => {
    const refresh = () => load();
    window.addEventListener("cw-appt-created", refresh);
    return () => window.removeEventListener("cw-appt-created", refresh);
  }, [load]);
  // Key that re-triggers the transition whenever the visible period changes.
  const periodKey = view === "year"
    ? `y${currentDate.getFullYear()}`
    : view === "month"
      ? `m${currentDate.getFullYear()}-${currentDate.getMonth()}`
      : `d${formatDateForDb(currentDate)}`;
  const transitionKey = `${view}:${periodKey}`;

  // "Today" only matters once you've navigated away from the current period —
  // hidden otherwise so the header stays uncluttered.
  const todayNow = new Date();
  const onToday = view === "day"
    ? formatDateForDb(currentDate) === formatDateForDb(todayNow)
    : view === "month"
      ? (currentDate.getFullYear() === todayNow.getFullYear() && currentDate.getMonth() === todayNow.getMonth())
      : currentDate.getFullYear() === todayNow.getFullYear();

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
    // data-no-swipe: the calendar owns horizontal gestures (day/month/year
    // swipe), so the app-level page swipe-navigator must not fire inside it.
    <div data-no-swipe className={cn("flex flex-col h-full bg-background text-foreground overflow-x-clip", embedded && "min-h-[100dvh]")}>
      {/* Page title (owner standalone only) — the universal top header, so the
          calendar's top matches every other page. The date-nav toolbar below
          stays as-is. Grid area (flex-1) absorbs the header height. */}
      {pageTitle && (
        <div className="shrink-0 px-4 sm:px-6">
          <DashboardHeader title={pageTitle} />
        </div>
      )}
      {/* Header — one row: date hero (left) · controls (right). The barber
          filter is a compact avatar+caret so it all fits on a single line. */}
      <div className="border-b border-border px-4 sm:px-6 py-2 flex items-center justify-between gap-3">
        <div className="flex items-center gap-1.5 min-w-0">
          {backLabel && (
            <button onClick={goBack} aria-label={`Back to ${backLabel}`}
              className="flex items-center gap-0.5 text-sm font-medium text-[#9a9a9a] hover:text-foreground transition-colors flex-shrink-0 -ml-1">
              <ChevronLeft size={18} /> {backLabel}
            </button>
          )}
          <h2 className="text-base sm:text-lg font-bold text-foreground truncate">{titleText}</h2>
          {loading && <span className="text-xs text-grey-muted animate-pulse flex-shrink-0">…</span>}
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          {/* Day · phone: barber filter as an avatar + caret (tap → menu) */}
          {view === "day" && isMobile && !forceBarberId && profile?.role !== "barber" && barbers.length > 1 && (
            <div className="relative">
              <button onClick={() => setViewMenu(o => !o)} aria-label="Choose barber"
                className="flex items-center gap-0.5 rounded-full border border-border bg-card-raised p-0.5 pr-1 hover:border-border transition-colors">
                {(() => { const db = barbers.find(b => b.id === dayBarberId); return db
                  ? <BarberAvatar b={db} i={barbers.indexOf(db)} sm />
                  : <span className="w-7 h-7 rounded-full bg-surface-overlay flex items-center justify-center text-grey"><Users size={14} /></span>; })()}
                <ChevronDown size={13} className="text-grey" />
              </button>
              {viewMenu && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setViewMenu(false)} />
                  <div className="absolute right-0 mt-1.5 z-50 w-44 max-h-72 overflow-auto bg-card border border-border rounded-xl shadow-lg py-1">
                    {orderedBarbers.map(b => (
                      <button key={b.id} onClick={() => { setBarberFilter(b.id); setViewMenu(false); }}
                        className={cn("w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-card-raised", dayBarberId === b.id ? "text-foreground font-semibold" : "text-grey")}>
                        <BarberAvatar b={b} i={barbers.indexOf(b)} sm />
                        <span className="truncate">{b.name}</span>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
          {/* Big-screen day: page barber columns when there are a lot */}
          {dayPagerVisible && (
            <div className="flex items-center gap-0.5 text-grey">
              <button onClick={() => setColPage(p => Math.max(0, p - 1))} disabled={dayPage === 0} aria-label="Previous barbers"
                className="p-1 rounded hover:bg-card-raised disabled:opacity-30 disabled:hover:bg-transparent"><ChevronLeft size={16} /></button>
              <button onClick={() => setColPage(p => Math.min(dayPages - 1, p + 1))} disabled={dayPage >= dayPages - 1} aria-label="More barbers"
                className="p-1 rounded hover:bg-card-raised disabled:opacity-30 disabled:hover:bg-transparent"><ChevronRight size={16} /></button>
            </div>
          )}
          {/* Day: timeline ⇄ box (card) layout toggle */}
          {view === "day" && (
            <button onClick={() => setDayLayout(l => l === "timeline" ? "grid" : "timeline")}
              aria-label={dayLayout === "timeline" ? "Box view" : "Timeline view"}
              title={dayLayout === "timeline" ? "Box view" : "Timeline view"}
              className="p-1.5 rounded-lg border border-border bg-card-raised text-[#ccc] hover:bg-surface-overlay hover:text-foreground transition-colors">
              {dayLayout === "timeline" ? <LayoutGrid size={16} /> : <Clock size={16} />}
            </button>
          )}
          {/* Day: add an appointment */}
          {view === "day" && canManage && (
            <button onClick={openAddGeneral} aria-label="Add appointment" title="Add appointment"
              className="p-1.5 rounded-lg border border-border bg-card-raised text-[#ccc] hover:bg-surface-overlay hover:text-foreground transition-colors">
              <Plus size={16} />
            </button>
          )}
          {!onToday && (
            <button onClick={() => { setNavDir(0); setCurrentDate(new Date()); }}
              className="px-2.5 py-1.5 text-xs font-medium text-[#ccc] border border-border bg-card-raised rounded-lg hover:bg-surface-overlay hover:text-foreground transition-colors">
              Today
            </button>
          )}
        </div>
      </div>

      {/* Barber selector row — profile-pic chips incl. an "All barbers" chip.
          Shown on the month/year overviews to filter; the day view has its own
          selection (columns on desktop, a dropdown on phone). */}
      {!isolated && profile?.role !== "barber" && barbers.length > 0 && view !== "day" && (
        <div className="flex gap-3 overflow-x-auto px-4 sm:px-6 py-3 border-b border-border [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <button onClick={() => setBarberFilter("all")}
            className={cn("flex flex-col items-center gap-1 flex-shrink-0 w-16 py-1.5 transition-opacity", barberFilter === "all" ? "opacity-100" : "opacity-60 hover:opacity-100")}>
            <span className={cn("w-11 h-11 rounded-full flex items-center justify-center bg-surface-overlay text-grey", barberFilter === "all" && "ring-2 ring-[#00e5a0] ring-offset-2 ring-offset-[#0a0a0a]")}>
              <Users size={18} />
            </span>
            <span className={cn("text-[10px] truncate w-full text-center", barberFilter === "all" ? "text-[#00e5a0] font-semibold" : "text-grey")}>All barbers</span>
          </button>
          {orderedBarbers.map((b) => (
            <button key={b.id} onClick={() => setBarberFilter(b.id)}
              className={cn("flex flex-col items-center gap-1 flex-shrink-0 w-16 py-1.5 transition-opacity", barberFilter === b.id ? "opacity-100" : "opacity-60 hover:opacity-100")}>
              <span className={cn("rounded-full", barberFilter === b.id && "ring-2 ring-[#00e5a0] ring-offset-2 ring-offset-[#0a0a0a]")}>
                <BarberAvatar b={b} i={barbers.indexOf(b)} />
              </span>
              <span className={cn("text-[10px] truncate w-full text-center", barberFilter === b.id ? "text-[#00e5a0] font-semibold" : "text-grey")}>{b.name}</span>
            </button>
          ))}
        </div>
      )}

      <div
        className={cn("relative flex-1 bg-background", embedded ? "overflow-y-auto" : "overflow-hidden")}
        onTouchStart={onSwipeStart}
        onTouchEnd={onSwipeEnd}
      >
        <MotionConfig reducedMotion="user">
          <AnimatePresence mode="wait" custom={navDir} initial={false}>
            <motion.div
              key={transitionKey}
              custom={navDir}
              variants={calVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={calTransition}
              className="h-full w-full"
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
            services={services}
            onClose={() => setSelectedAppt(null)}
            actions={apptActions}
            busy={actionBusy}
            readOnly={!canManage}
            tz={safeTz((shop as { timezone?: string } | null)?.timezone)}
            noShowFeePercent={(shop?.booking_settings as { no_show_fee_percent?: number } | null)?.no_show_fee_percent}
          />
        </Portal>
      )}

      {toast && (
        <Portal>
          <div className="fixed bottom-6 right-6 z-[100] bg-card-raised border border-border rounded-xl px-5 py-3 text-sm text-foreground shadow-xl flex items-center gap-3">
            <span className="text-foreground">✓</span>{toast}
            <button onClick={() => setToast("")} className="text-grey hover:text-foreground ml-2">✕</button>
          </div>
        </Portal>
      )}

      {/* Quick-add appointment (DARK overlay) — opened from a "+" empty slot.
          Barber, date and time are fixed by the slot; the owner just picks a
          client + service. */}
      {addCtx && (
        <Portal>
          <div className={cn("fixed inset-0 bg-black/60 backdrop-blur-sm z-[70] transition-opacity duration-300", addShown ? "opacity-100" : "opacity-0")} onClick={() => !savingAdd && !blockBusy && closeAdd()} />
          <div className="fixed inset-x-0 bottom-0 sm:inset-0 z-[80] flex justify-center sm:items-center pointer-events-none sm:p-4">
            <div
              ref={addSheetRef}
              style={{
                transform: addShown ? `translate3d(0,${addDragY}px,0)` : "translate3d(0,100%,0)",
                transition: addDragging ? "none" : "transform 0.26s cubic-bezier(.32,.72,0,1)",
              }}
              className={cn(
                "pointer-events-auto w-full sm:max-w-md bg-card-raised border-t sm:border border-border rounded-t-2xl sm:rounded-2xl shadow-2xl",
                // No bottom padding here — the sticky action bar below owns the
                // home-indicator (safe-area) inset, so Cancel/Add never clip.
                "pb-0 max-h-[90vh] overflow-y-auto overscroll-contain px-6 pt-0 space-y-2 cw-modal-compact",
              )}>
              {/* Grab handle — pull down anywhere to dismiss, or tap the handle */}
              <div
                onClick={() => !savingAdd && !blockBusy && closeAdd()}
                className="flex justify-center pt-2.5 pb-1.5 -mx-6 cursor-grab active:cursor-grabbing"
              >
                <div className="w-10 h-1.5 rounded-full bg-[#3a3a3a]" />
              </div>
              <div className="flex items-center justify-between">
                <h3 className="text-xl font-extrabold tracking-tight text-foreground">{addMode === "block" ? "Block time" : "New appointment"}</h3>
                <button onClick={() => !savingAdd && !blockBusy && closeAdd()} className="text-grey hover:text-foreground"><X size={18} /></button>
              </div>
              {/* Appointment / Block toggle — only when the user can do both */}
              {canManage && canBlock && (
                <div className="grid grid-cols-2 gap-1 p-1 bg-card-raised rounded-xl">
                  <button type="button" onClick={() => setAddMode("appt")}
                    className={cn("py-1.5 rounded-lg text-sm font-medium transition-colors", addMode === "appt" ? "bg-white text-black" : "text-grey hover:text-foreground")}>Appointment</button>
                  <button type="button" onClick={() => setAddMode("block")}
                    className={cn("py-1.5 rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-1.5", addMode === "block" ? "bg-white text-black" : "text-grey hover:text-foreground")}><Ban size={14} /> Block</button>
                </div>
              )}
              <div>
                <span className="inline-flex items-center gap-1.5 bg-card border border-border text-grey text-xs font-semibold px-2.5 py-1 rounded-full">
                  <Scissors size={12} /> {addCtx.barberName}
                </span>
              </div>
              {addMode === "block" ? (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="text-[10px] uppercase tracking-wide text-grey">From</label>
                      <input type="time" value={blockForm.start} max={blockForm.end || undefined}
                        onChange={e => setBlockForm(f => ({ ...f, start: e.target.value }))}
                        className="w-full bg-card-raised border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:border-white [color-scheme:dark]" />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] uppercase tracking-wide text-grey">To</label>
                      <input type="time" value={blockForm.end} min={blockForm.start || undefined}
                        onChange={e => setBlockForm(f => ({ ...f, end: e.target.value }))}
                        className="w-full bg-card-raised border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:border-white [color-scheme:dark]" />
                    </div>
                  </div>
                  <input type="text" value={blockForm.reason} onChange={e => setBlockForm(f => ({ ...f, reason: e.target.value }))}
                    placeholder="Reason (optional) — e.g. Lunch"
                    className="w-full bg-card-raised border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-grey-muted focus:outline-none focus:border-white" />
                  <p className="text-[11px] text-grey flex items-start gap-1.5">
                    <span className="text-accent-soft mt-0.5">ⓘ</span>
                    {profile?.role === "shop_owner" ? "Blocks this time immediately." : "Sends your shop owner a request to approve."}
                  </p>
                  <div className="sticky bottom-0 -mx-6 px-6 pt-3 pb-[max(1.25rem,env(safe-area-inset-bottom))] bg-card-raised border-t border-border flex gap-2">
                    <Button variant="outline" className="flex-1" disabled={blockBusy} onClick={() => closeAdd()}>Cancel</Button>
                    <Button className="flex-1" loading={blockBusy}
                      disabled={!blockForm.start || !blockForm.end || blockForm.end <= blockForm.start}
                      onClick={submitBlock}>
                      {profile?.role === "shop_owner" ? "Block" : "Request block"}
                    </Button>
                  </div>
                </>
              ) : (
              <>
              {/* Client — searchable: pick an existing client (fills their contact)
                  or add a new one. Same as the global quick-add sheet. */}
              <div>
                <label className={ADD_LABEL}>Client <span className="text-emerald-400">*</span></label>
                <div className="relative">
                  <Search size={17} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-grey" />
                  <input value={addForm.client_name} onChange={e => onAddNameChange(e.target.value)}
                    placeholder="Search or add a client"
                    className={cn(ADD_FIELD, "pl-10", clientMode === "existing" && "pr-9")} />
                  {clientMode === "existing" && <Check size={17} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-emerald-400" />}
                </div>
                {clientMode === "search" && addForm.client_name.trim() && (
                  <div className="mt-1.5 bg-card border border-border rounded-xl overflow-hidden">
                    {addClientMatches.map(c => (
                      <button key={c.id} type="button" onClick={() => pickAddClient(c)}
                        className="w-full flex items-center gap-3 px-3 py-2.5 text-left border-t border-border first:border-t-0 hover:bg-surface-overlay transition-colors">
                        <span className="w-7 h-7 rounded-full bg-surface-overlay text-foreground text-xs font-bold flex items-center justify-center flex-shrink-0">{(c.name ?? "?").charAt(0).toUpperCase()}</span>
                        <span className="min-w-0">
                          <span className="block text-sm font-semibold text-foreground truncate">{c.name}</span>
                          <span className="block text-xs text-grey truncate">{[c.phone, `${c.total_visits ?? 0} visit${(c.total_visits ?? 0) === 1 ? "" : "s"}`].filter(Boolean).join(" · ")}</span>
                        </span>
                      </button>
                    ))}
                    <button type="button" onClick={addNewClient}
                      className="w-full flex items-center gap-2 px-3 py-2.5 text-left border-t border-border text-sm font-semibold text-emerald-400 hover:bg-surface-overlay transition-colors">
                      <Plus size={15} /> Add &ldquo;{addForm.client_name.trim()}&rdquo; as a new client
                    </button>
                  </div>
                )}
              </div>

              {/* Phone + email — only when adding a NEW client (an existing one
                  already has theirs), so the sheet starts short. */}
              {clientMode === "new" && (
                <div className="space-y-2.5">
                  <input value={addForm.client_phone} onChange={e => setAddForm(p => ({ ...p, client_phone: e.target.value }))} placeholder="Phone (optional)" inputMode="tel" className={ADD_FIELD} />
                  <input value={addForm.client_email} onChange={e => setAddForm(p => ({ ...p, client_email: e.target.value }))} placeholder="Email (optional)" inputMode="email" className={ADD_FIELD} />
                  <p className="text-xs text-grey">Optional — for their booking confirmation.</p>
                </div>
              )}

              {/* Services — dropdown rows; "+" adds another for a combined appointment */}
              <div>
                <label className={ADD_LABEL}>Service <span className="text-emerald-400">*</span> <span className="text-grey-muted font-normal">(add one or more)</span></label>
                <div className="space-y-2">
                  {(addForm.service_ids.length ? addForm.service_ids : [""]).map((sid, idx) => {
                    const windowLen = addWindow ? addWindow.freeUntil - addWindow.boxStart : Infinity;
                    const otherDur = addForm.service_ids.reduce((n, id, i) => i === idx ? n : n + (svcById(id)?.duration_minutes || 0), 0);
                    return (
                      <div key={idx} className="flex gap-2 items-center">
                        <div className="relative flex-1">
                          <select value={sid} onChange={e => setServiceAt(idx, e.target.value)} className={cn(ADD_FIELD, "appearance-none pr-9")}>
                            <option value="">Select a service</option>
                            {services.map(s => {
                              const wontFit = s.id !== sid && otherDur + s.duration_minutes > windowLen;
                              return <option key={s.id} value={s.id} disabled={wontFit}>{s.name} · {formatCurrency(Number(s.price))} · {s.duration_minutes}m{wontFit ? " — won't fit" : ""}</option>;
                            })}
                          </select>
                          <ChevronDown size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-grey" />
                        </div>
                        {(addForm.service_ids.length > 1 || !!sid) && (
                          <button type="button" onClick={() => removeServiceRow(idx)} aria-label="Remove service"
                            className="w-12 h-12 flex-shrink-0 rounded-xl border border-border text-grey hover:text-foreground flex items-center justify-center">
                            <X size={15} />
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
                <button type="button" onClick={addServiceRow}
                  className="mt-2 inline-flex items-center gap-1.5 text-sm font-semibold text-emerald-400">
                  <Plus size={15} /> Add another service
                </button>
                {addForm.service_ids.filter(Boolean).length > 0 && (
                  <p className="text-xs text-grey mt-2">Total: {addTotalDuration} min · {formatCurrency(addTotalPrice)}</p>
                )}
              </div>
              {/* Loyalty — offer to spend the client's points (only when they have
                  a redeemable balance). Server computes the discount + deducts. */}
              {addLoyalty?.eligible && (
                <button type="button" onClick={() => setAddRedeem(v => !v)}
                  className={cn("w-full flex items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors",
                    addRedeem ? "bg-emerald-500/10 border-emerald-500/40" : "bg-card-raised border-border hover:border-white/30")}>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-foreground">⭐ Use loyalty points</p>
                    <p className="text-xs text-grey mt-0.5">{addLoyalty.points} pts · up to {formatCurrency(addLoyalty.value)} off</p>
                  </div>
                  <span className={cn("w-11 h-6 rounded-full relative transition-colors flex-shrink-0", addRedeem ? "bg-emerald-500" : "bg-[#2a2a2a]")}>
                    <span className={cn("absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all", addRedeem ? "left-[22px]" : "left-0.5")} />
                  </span>
                </button>
              )}
              {/* Date + time on one row. Defaults to the tapped day, but staff can
                  change the date here too (e.g. book a client in for next week). */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={ADD_LABEL}>Date</label>
                  <input type="date" value={addForm.date} min={formatDateForDb(new Date())}
                    onChange={e => setAddForm(p => ({ ...p, date: e.target.value }))} className={cn(ADD_FIELD, "text-left [&::-webkit-date-and-time-value]:text-left")} />
                </div>
                <div>
                  <label className={ADD_LABEL}>Available time</label>
                  <div className="relative">
                    <select value={addForm.time} onChange={e => setAddForm(p => ({ ...p, time: e.target.value }))} className={cn(ADD_FIELD, "appearance-none pr-9")}>
                      {addTimeOptions.length === 0 && <option value="">No open times this day</option>}
                      {addTimeOptions.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                    <ChevronDown size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-grey" />
                  </div>
                </div>
              </div>
              {isOutsideSchedule(addCtx.barberId, addForm.time) && (
                <p className="text-xs text-amber-400">
                  ⚠️ {schedules.has(addCtx.barberId)
                    ? `Outside ${addCtx.barberName}'s working hours.`
                    : `${addCtx.barberName} has no schedule set for this day.`}
                </p>
              )}
              {/* Sticky action bar — pinned to the sheet bottom above the home
                  indicator (safe-area inset) so the primary actions are never
                  clipped or scrolled out of reach on an installed PWA. */}
              <div className="sticky bottom-0 -mx-6 px-6 pt-3 pb-[max(1.25rem,env(safe-area-inset-bottom))] bg-card-raised border-t border-border flex gap-2">
                <Button variant="outline" className="flex-1" disabled={savingAdd} onClick={() => closeAdd()}>Cancel</Button>
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
