"use client";
import { useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import {
  cn, generate24hSlots, dbTimeToDisplay, displayTimeToDb, formatDateForDb,
  formatFriendlyDate, formatFriendlyTime, prettyDate,
} from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { KeyRound, Trash2, Copy, Check, Shield, X, Camera } from "lucide-react";
import { AvatarImage } from "@/components/ui/avatar-image";
import { uploadBarberPhoto, removeBarberPhoto } from "@/lib/upload-barber-photo";
import { DEFAULT_BARBER_PERMISSIONS, type BarberPermissions } from "@/lib/database.types";
import { getPlanLimit, validateEmail } from "@/lib/validation";
import { Tooltip } from "@/components/ui/tooltip";
import type { Barber, TimeSlot, DaySchedule } from "@/lib/database.types";

// ─── Constants ────────────────────────────────────────────────────────────────
const DAYS_FULL = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// Booking-window granularity (minutes between schedule + offered slot times).
// Quarter-hour (15) lets a barber start at e.g. 9:45 AM. Stored shop-wide in
// booking_settings.slot_interval_minutes; drives both the schedule pickers here
// and the customer booking grid.
function slotIntervalOf(shop: { booking_settings?: unknown } | null | undefined): number {
  const v = (shop?.booking_settings as { slot_interval_minutes?: number } | null)?.slot_interval_minutes;
  return v === 15 ? 15 : 30;
}

// ─── Types ────────────────────────────────────────────────────────────────────
interface StaffHourRow {
  id: string;
  barber_id: string;
  shop_id: string;
  date: string;
  clock_in: string;
  clock_out: string | null;
  hours_worked: number | null;
  barbers?: { name: string };
}

interface TimeOffRow {
  id: string;
  barber_id: string;
  type: "day_off" | "vacation" | "blocked_hours" | "sick";
  start_date: string;
  end_date: string;
  start_time?: string | null;
  end_time?: string | null;
}

interface BarberWithSchedule extends Barber {
  apptCount?: number;
  schedule: DaySchedule[];
  upcomingTimeOff?: TimeOffRow[];
}

// ─── Reset link copy ──────────────────────────────────────────────────────────
function ResetLinkCopy({ link }: { link: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div className="flex items-center gap-2 bg-[#141414] border border-[#2a2a2a] rounded-xl p-3">
      <p className="flex-1 text-xs text-[#8f8f8f] truncate">{link}</p>
      <button onClick={copy} className={cn("flex-shrink-0 p-1.5 rounded-lg transition-colors", copied ? "text-green-400" : "text-[#8f8f8f] hover:text-white")}>
        {copied ? <Check size={15} /> : <Copy size={15} />}
      </button>
    </div>
  );
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────
function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse bg-[#141414] rounded-xl", className)} />;
}

// ─── Toast ────────────────────────────────────────────────────────────────────
function Toast({ message, onClose }: { message: string; onClose: () => void }) {
  return (
    <div className="fixed bottom-6 right-6 z-[100] bg-[#141414] border border-[#2a2a2a] rounded-xl px-5 py-3 text-sm text-white shadow-xl flex items-center gap-3">
      <span className="text-white">✓</span>{message}
      <button onClick={onClose} className="text-[#8f8f8f] hover:text-white ml-2">✕</button>
    </div>
  );
}

// ─── Default schedule ─────────────────────────────────────────────────────────
function defaultSchedule(): DaySchedule[] {
  return DAYS_FULL.map((_, i) => ({ isOpen: i >= 1 && i <= 5, startTime: "9:00 AM", endTime: "7:00 PM" }));
}

export default function StaffPage() {
  const { shop, accessToken, user, profile, refreshShop } = useAuth();

  // ── Data state ──────────────────────────────────────────────────────────────
  const [barbers, setBarbers] = useState<BarberWithSchedule[]>([]);
  const [staffHours, setStaffHours] = useState<StaffHourRow[]>([]);
  const [loading, setLoading] = useState(true);

  // ── UI state ────────────────────────────────────────────────────────────────
  const [toast, setToast] = useState("");
  const [scheduleBarber, setScheduleBarber] = useState<BarberWithSchedule | null>(null);
  const [editSchedule, setEditSchedule] = useState<DaySchedule[]>(defaultSchedule());
  // Quarter-hour vs half-hour increments for the schedule pickers (and the
  // customer booking grid). Shop-wide, persisted to booking_settings.
  const [scheduleInterval, setScheduleInterval] = useState(30);
  const scheduleSlotOptions = useMemo(() => generate24hSlots(scheduleInterval), [scheduleInterval]);
  const [showAddModal, setShowAddModal] = useState(false);
  const [addTab, setAddTab] = useState<"manual" | "invite">("invite");
  const [addForm, setAddForm] = useState({ name: "", email: "", commission_percent: "50" });
  const [inviteSent, setInviteSent] = useState(false);

  // Permissions modal state
  const [permBarber, setPermBarber] = useState<BarberWithSchedule | null>(null);
  const [permDraft, setPermDraft] = useState<BarberPermissions>(DEFAULT_BARBER_PERMISSIONS);
  const [savingPerms, setSavingPerms] = useState(false);

  // Is the owner already on the team as a barber? (matched by their linked
  // user_id, or by their account email — covers an onboarding self-add.)
  const alreadyOwnerBarber = barbers.some(b =>
    (!!b.user_id && b.user_id === user?.id) ||
    (!!user?.email && b.email?.toLowerCase() === user.email!.toLowerCase())
  );
  const [savingSchedule, setSavingSchedule] = useState(false);
  // Approved upcoming time-off for the barber whose Schedule modal is open
  const [scheduleTimeOff, setScheduleTimeOff] = useState<TimeOffRow[]>([]);
  const [cancellingTimeOffId, setCancellingTimeOffId] = useState<string | null>(null);
  const [savingAdd, setSavingAdd] = useState(false);
  const [savingCommission, setSavingCommission] = useState<string | null>(null);
  const [commissions, setCommissions] = useState<Record<string, number>>({});
  const [activeMap, setActiveMap] = useState<Record<string, boolean>>({});
  const [resetModal, setResetModal] = useState<{ email: string; name: string; emailed?: boolean } | null>(null);
  const [inviteLinkModal, setInviteLinkModal] = useState<{ link: string; email: string; name: string; existingAccount: boolean } | null>(null);
  const [resettingId, setResettingId] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<BarberWithSchedule | null>(null);
  const [resendingInviteId, setResendingInviteId] = useState<string | null>(null);

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(""), 3000); };

  // Owner uploads a barber's profile photo (shown on their booking card).
  const [photoBusyId, setPhotoBusyId] = useState<string | null>(null);
  const uploadPhoto = async (barberId: string, file: File) => {
    if (!accessToken) return;
    setPhotoBusyId(barberId);
    try {
      const url = await uploadBarberPhoto(file, barberId, accessToken);
      setBarbers(prev => prev.map(b => b.id === barberId ? { ...b, photo: url } : b));
      showToast("Photo updated");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Photo upload failed");
    } finally {
      setPhotoBusyId(null);
    }
  };
  const removePhoto = async (barberId: string) => {
    if (!accessToken) return;
    setPhotoBusyId(barberId);
    try {
      await removeBarberPhoto(barberId, accessToken);
      setBarbers(prev => prev.map(b => b.id === barberId ? { ...b, photo: undefined } : b));
      showToast("Photo removed");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Remove failed");
    } finally {
      setPhotoBusyId(null);
    }
  };

  // ── Load barbers + their schedules + appt counts + upcoming time-off ─────────
  const loadBarbers = useCallback(async () => {
    if (!shop) { setLoading(false); return; }
    setLoading(true);
    const now = new Date();
    const todayStr = formatDateForDb(now);
    const monthStart = formatDateForDb(new Date(now.getFullYear(), now.getMonth(), 1));
    const monthEnd = formatDateForDb(new Date(now.getFullYear(), now.getMonth() + 1, 0));

    const { data: bData } = await supabase.from("barbers").select("*").eq("shop_id", shop.id).order("created_at", { ascending: true });
    const barberList = (bData ?? []) as Barber[];

    const [{ data: tsData }, { data: apptData }, { data: timeOffData }] = await Promise.all([
      supabase.from("time_slots").select("*").in("barber_id", barberList.map((b) => b.id)),
      supabase.from("appointments").select("barber_id, date").eq("shop_id", shop.id).gte("date", monthStart).lte("date", monthEnd),
      supabase.from("time_off_requests").select("*").eq("shop_id", shop.id).eq("status", "approved").gte("end_date", todayStr).order("start_date", { ascending: true }),
    ]);

    const tsRows = (tsData ?? []) as TimeSlot[];
    const apptRows = (apptData ?? []) as { barber_id: string; date: string }[];
    const timeOffRows = (timeOffData ?? []) as TimeOffRow[];
    const apptCounts: Record<string, number> = {};
    apptRows.forEach((a) => { apptCounts[a.barber_id] = (apptCounts[a.barber_id] ?? 0) + 1; });

    const enriched: BarberWithSchedule[] = barberList.map((b) => {
      const bSlots = tsRows.filter((t) => t.barber_id === b.id);
      const schedule: DaySchedule[] = DAYS_FULL.map((_, dow) => {
        const ts = bSlots.find((t) => t.day_of_week === dow);
        if (ts) return { isOpen: ts.is_available, startTime: dbTimeToDisplay(ts.start_time), endTime: dbTimeToDisplay(ts.end_time) };
        return { isOpen: false, startTime: "9:00 AM", endTime: "7:00 PM" };
      });
      const upcomingTimeOff = timeOffRows.filter(t => t.barber_id === b.id).slice(0, 3);
      return { ...b, apptCount: apptCounts[b.id] ?? 0, schedule, upcomingTimeOff };
    });

    setBarbers(enriched);
    setCommissions(Object.fromEntries(enriched.map((b) => [b.id, b.commission_percent])));
    setActiveMap(Object.fromEntries(enriched.map((b) => [b.id, b.is_active])));

    // Load staff hours
    const { data: shData } = await supabase
      .from("staff_hours")
      .select("*, barbers(name)")
      .eq("shop_id", shop.id)
      .order("date", { ascending: false })
      .limit(50);
    setStaffHours((shData ?? []) as StaffHourRow[]);
    setLoading(false);
  }, [shop]);

  useEffect(() => { loadBarbers(); }, [loadBarbers]);

  // Real-time sync: when a barber edits their own availability from their
  // portal, push the change here without requiring a staff-page reload.
  useEffect(() => {
    if (!shop?.id) return;
    const channel = supabase
      .channel(`staff_time_slots:${shop.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "time_slots" },
        () => { loadBarbers(); }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "time_off_requests", filter: `shop_id=eq.${shop.id}` },
        () => { loadBarbers(); }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [shop?.id, loadBarbers]);


  // Change the shop-wide booking increment (30 ↔ 15 min). Persisted into the
  // existing booking_settings JSON (merged so other settings aren't clobbered),
  // then refreshed so the customer grid + this picker reflect it immediately.
  const changeInterval = async (min: number) => {
    setScheduleInterval(min);
    if (!shop) return;
    const merged = { ...((shop.booking_settings as Record<string, unknown>) ?? {}), slot_interval_minutes: min };
    const { error } = await supabase.from("shops").update({ booking_settings: merged }).eq("id", shop.id);
    if (error) { showToast("Couldn't save time increments"); return; }
    refreshShop?.();
  };

  // ── Save schedule ───────────────────────────────────────────────────────────
  const saveSchedule = async () => {
    if (!scheduleBarber) return;
    setSavingSchedule(true);
    // Delete existing
    const { error: delErr } = await supabase.from("time_slots").delete().eq("barber_id", scheduleBarber.id);
    // Insert new
    const inserts = editSchedule
      .map((day, dow) => day.isOpen ? { barber_id: scheduleBarber.id, day_of_week: dow, start_time: displayTimeToDb(day.startTime), end_time: displayTimeToDb(day.endTime), is_available: true } : null)
      .filter((x): x is NonNullable<typeof x> => x !== null);
    const { error: insErr } = inserts.length > 0
      ? await supabase.from("time_slots").insert(inserts)
      : { error: null };
    setSavingSchedule(false);
    // Surface failures instead of silently reporting success (a blocked save
    // would otherwise leave the OLD hours in place — e.g. customers still see 9 AM).
    if (delErr || insErr) {
      showToast(`Couldn't save schedule: ${(delErr || insErr)?.message ?? "try again"}`);
      return;
    }
    setScheduleBarber(null);
    showToast(`Schedule saved for ${scheduleBarber.name}`);
    loadBarbers();
  };

  // ── Toggle barber active ────────────────────────────────────────────────────
  const toggleActive = async (barberId: string) => {
    const newVal = !activeMap[barberId];
    setActiveMap((prev) => ({ ...prev, [barberId]: newVal }));
    await supabase.from("barbers").update({ is_active: newVal }).eq("id", barberId);
    showToast(newVal ? "Barber reactivated" : "Barber deactivated");
  };

  // ── Save commission ─────────────────────────────────────────────────────────
  const saveCommission = async (barberId: string) => {
    setSavingCommission(barberId);
    await supabase.from("barbers").update({ commission_percent: commissions[barberId] }).eq("id", barberId);
    setSavingCommission(null);
    showToast("Commission updated!");
  };

  // ── Add or invite a barber (single API path) ────────────────────────────────
  // Email is mandatory in both tabs — it's the only unique identifier we have
  // to differentiate owner-self adds (instant) from external invites.
  const submitNewBarber = async (skipInvite = false) => {
    if (!shop) return;
    if (!addForm.name.trim()) { showToast("Full name is required"); return; }
    const emailErr = validateEmail(addForm.email.trim());
    if (emailErr) { showToast(emailErr); return; }
    // Don't re-add someone already on the team (covers the owner adding their own
    // email when they're already a barber).
    if (barbers.some(b => b.email?.toLowerCase() === addForm.email.trim().toLowerCase())) {
      showToast("That email is already on your team.");
      return;
    }

    const limit = getPlanLimit(shop.subscription_plan);
    if (barbers.length >= limit) {
      showToast(`${shop.subscription_plan} plan allows max ${limit} barber${limit > 1 ? "s" : ""}. Upgrade to add more.`);
      return;
    }
    if (!accessToken) return;

    setSavingAdd(true);
    const res = await fetch("/api/admin/barber/invite", {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        name: addForm.name.trim(),
        email: addForm.email.trim(),
        commission_percent: parseInt(addForm.commission_percent) || 50,
        skip_invite: skipInvite,
        shop_id: shop.id,
      }),
    });
    const data = await res.json();
    setSavingAdd(false);
    if (!res.ok) { showToast(`Error: ${data.error}`); return; }

    // Owner self-add → no invite link, just confirm and refresh
    if (data.ownerSelf) {
      setShowAddModal(false);
      setAddForm({ name: "", email: "", commission_percent: "50" });
      showToast("You have been added as a barber! Open 'My Barber View' from the sidebar.");
      loadBarbers();
      return;
    }

    // Manual add (no app invite) → just create the record and refresh.
    if (data.manual) {
      setShowAddModal(false);
      setAddForm({ name: "", email: "", commission_percent: "50" });
      showToast("Barber added");
      loadBarbers();
      return;
    }

    // Normal external invite — show the link modal so the owner can also
    // copy/paste it to the barber if email doesn't arrive
    setInviteSent(true);
    if (data.inviteLink) {
      setInviteLinkModal({
        link: data.inviteLink,
        email: addForm.email.trim(),
        name: addForm.name.trim(),
        existingAccount: !!data.existingAccount,
      });
    } else if (data.existingAccount) {
      // Existing account: no login link is issued (security). They sign in and accept.
      showToast(`${addForm.name.trim()} already has a ClipWise account — we emailed them to sign in and accept.`);
    }
    loadBarbers();
  };

  // Both tabs (Invite / Add Manually) run the same API path; the "manual" tab
  // skips the invite email so it can't hang on a slow email send.
  const inviteBarber = () => submitNewBarber(false);
  const addBarber = () => submitNewBarber(true);

  // ── Owner self-add (one tap) ────────────────────────────────────────────────
  // Reuses the invite route: when the email matches the caller's, it links the
  // new barber to their user_id immediately (no invite email). Shown only when
  // the owner isn't already on the team (e.g. they skipped it during onboarding).
  const addSelfAsBarber = async () => {
    if (!shop || !accessToken || !user?.email) return;
    const limit = getPlanLimit(shop.subscription_plan);
    if (barbers.length >= limit) {
      showToast(`${shop.subscription_plan} plan allows max ${limit} barber${limit > 1 ? "s" : ""}. Upgrade to add more.`);
      return;
    }
    setSavingAdd(true);
    const res = await fetch("/api/admin/barber/invite", {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: profile?.name || user.email.split("@")[0], email: user.email, commission_percent: 50, shop_id: shop.id }),
    });
    const data = await res.json();
    setSavingAdd(false);
    if (!res.ok) { showToast(`Error: ${data.error}`); return; }
    showToast("You've been added as a barber! Open 'My Barber View' from the sidebar.");
    loadBarbers();
  };

  // ── Password reset ──────────────────────────────────────────────────────────
  const resetPassword = async (barber: BarberWithSchedule) => {
    if (!accessToken) return;
    setResettingId(barber.id);
    const res = await fetch("/api/admin/barber/reset-password", {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ barber_id: barber.id }),
    });
    const data = await res.json();
    setResettingId(null);
    if (!res.ok) { showToast(`Error: ${data.error}`); return; }
    setResetModal(data);
  };

  // ── Resend invite ───────────────────────────────────────────────────────────
  const resendInvite = async (barber: BarberWithSchedule) => {
    if (!accessToken) return;
    setResendingInviteId(barber.id);
    const res = await fetch("/api/admin/barber/resend-invite", {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ barber_id: barber.id }),
    });
    const data = await res.json();
    setResendingInviteId(null);
    if (!res.ok) { showToast(`Error: ${data.error}`); return; }
    if (data.inviteLink && barber.email) {
      setInviteLinkModal({
        link: data.inviteLink,
        email: barber.email,
        name: barber.name,
        existingAccount: !!data.existingAccount,
      });
    } else {
      showToast(`Invite resent to ${barber.email}`);
    }
  };

  // ── Remove barber ───────────────────────────────────────────────────────────
  const removeBarber = async (barber: BarberWithSchedule) => {
    setRemovingId(barber.id);
    await supabase.from("barbers").delete().eq("id", barber.id);
    setRemovingId(null);
    setConfirmRemove(null);
    showToast(`${barber.name} removed from staff`);
    loadBarbers();
  };

  // ── Open permissions modal ─────────────────────────────────────────────────
  const openPermissions = (b: BarberWithSchedule) => {
    setPermDraft({ ...DEFAULT_BARBER_PERMISSIONS, ...(b.permissions ?? {}) });
    setPermBarber(b);
  };
  const savePermissions = async () => {
    if (!permBarber) return;
    setSavingPerms(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase.from("barbers").update({ permissions: permDraft } as any).eq("id", permBarber.id));
    setSavingPerms(false);
    if (error) { showToast(`Failed: ${error.message}`); return; }
    showToast(`Permissions saved for ${permBarber.name}`);
    setPermBarber(null);
    loadBarbers();
  };

  // ── Open schedule modal ─────────────────────────────────────────────────────
  // Always refetch the barber's current time_slots from the DB before populating
  // the editor — the cached `b.schedule` may be stale if the barber updated
  // their own availability since the last full staff-page load.
  const openSchedule = async (b: BarberWithSchedule) => {
    setEditSchedule(b.schedule.map((d) => ({ ...d }))); // optimistic from cache
    setScheduleBarber(b);
    setScheduleInterval(slotIntervalOf(shop));
    setScheduleTimeOff(b.upcomingTimeOff ?? []);
    const todayStr = formatDateForDb(new Date());
    const [{ data: fresh }, { data: timeOff }] = await Promise.all([
      supabase
        .from("time_slots")
        .select("day_of_week, start_time, end_time, is_available")
        .eq("barber_id", b.id)
        .order("day_of_week"),
      supabase
        .from("time_off_requests")
        .select("id, barber_id, type, start_date, end_date, start_time, end_time")
        .eq("barber_id", b.id)
        .eq("status", "approved")
        .gte("end_date", todayStr)
        .order("start_date", { ascending: true }),
    ]);
    if (fresh) {
      const next: DaySchedule[] = DAYS_FULL.map((_, dow) => {
        const ts = fresh.find((t) => t.day_of_week === dow);
        if (ts) return { isOpen: ts.is_available, startTime: dbTimeToDisplay(ts.start_time), endTime: dbTimeToDisplay(ts.end_time) };
        return { isOpen: false, startTime: "9:00 AM", endTime: "7:00 PM" };
      });
      setEditSchedule(next);
    }
    setScheduleTimeOff((timeOff ?? []) as TimeOffRow[]);
  };

  // ── Cancel an approved time-off from inside the Schedule modal ─────────────
  // Goes through the admin-only server route so the barber notification +
  // email fire reliably (cross-user notification insert otherwise blocked).
  const cancelTimeOff = async (id: string) => {
    if (!accessToken) return;
    setCancellingTimeOffId(id);
    const res = await fetch("/api/time-off/cancel", {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ request_id: id }),
    });
    setCancellingTimeOffId(null);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      showToast(`Couldn't cancel: ${j.error ?? res.statusText}`);
      return;
    }
    setScheduleTimeOff(prev => prev.filter(t => t.id !== id));
    showToast("Time-off cancelled. Barber notified.");
    loadBarbers();
  };

  // ── Surgically remove ONE date from a multi-day approved time-off ─────────
  // Used by the per-day toggle: turning Tuesday "back on" inside a vacation
  // Mon-Fri should exclude only Tuesday, not nuke the whole vacation.
  const excludeTimeOffDate = async (requestId: string, excludeDate: string) => {
    if (!accessToken) return;
    setCancellingTimeOffId(requestId);
    const res = await fetch("/api/time-off/exclude-date", {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ request_id: requestId, exclude_date: excludeDate }),
    });
    setCancellingTimeOffId(null);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      showToast(`Couldn't reopen day: ${j.error ?? res.statusText}`);
      return;
    }
    showToast(`${formatFriendlyDate(excludeDate)} reopened. Barber notified.`);
    // Refresh the modal's time-off list + the cards
    if (scheduleBarber) {
      const todayStr = formatDateForDb(new Date());
      const { data: refreshed } = await supabase
        .from("time_off_requests")
        .select("id, barber_id, type, start_date, end_date, start_time, end_time")
        .eq("barber_id", scheduleBarber.id)
        .eq("status", "approved")
        .gte("end_date", todayStr)
        .order("start_date", { ascending: true });
      setScheduleTimeOff((refreshed ?? []) as TimeOffRow[]);
    }
    loadBarbers();
  };

  const updateScheduleDay = (dow: number, field: keyof DaySchedule, value: string | boolean) => {
    setEditSchedule((prev) => prev.map((d, i) => i === dow ? { ...d, [field]: value } : d));
  };

  if (loading) {
    return (
      <div className="p-6 space-y-6">
        <Skeleton className="h-12 w-48" />
        <div className="grid md:grid-cols-3 gap-6">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-64" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {toast && <Toast message={toast} onClose={() => setToast("")} />}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white uppercase tracking-wide">Staff</h1>
          <p className="text-sm text-[#8f8f8f] mt-0.5">Manage barbers, schedules and commissions</p>
        </div>
        <div className="flex items-center gap-2">
          {!alreadyOwnerBarber && shop && barbers.length < getPlanLimit(shop.subscription_plan) && (
            <Button variant="outline" loading={savingAdd} onClick={addSelfAsBarber}>+ Add myself as a barber</Button>
          )}
          {shop && barbers.length >= getPlanLimit(shop.subscription_plan) ? (
            <Tooltip content={`${shop.subscription_plan} plan: max ${getPlanLimit(shop.subscription_plan)} barber${getPlanLimit(shop.subscription_plan) > 1 ? "s" : ""}. Upgrade to add more.`}>
              <Button disabled>+ Add Barber</Button>
            </Tooltip>
          ) : (
            <Button onClick={() => setShowAddModal(true)}>+ Add Barber</Button>
          )}
        </div>
      </div>

      {/* Barber Cards */}
      {barbers.length === 0 ? (
        <Card>
          <div className="py-16 text-center">
            <p className="text-4xl mb-3">💈</p>
            <p className="font-medium text-white mb-1">No barbers yet</p>
            <p className="text-sm text-[#8f8f8f] mb-4 max-w-xs mx-auto">Invite your barbers by email — they&apos;ll get access to their own portal to manage their schedule and clients.</p>
            <Button onClick={() => setShowAddModal(true)}>+ Add Barber</Button>
          </div>
        </Card>
      ) : (
        <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-6">
          {barbers.map((barber) => {
            // The owner's OWN barber card — they manage their own login/permissions
            // as the shop owner, so the staff-level Reset Password + Permissions
            // tools don't apply to them.
            const isOwnerBarber = (!!barber.user_id && barber.user_id === user?.id) || (!!user?.email && barber.email?.toLowerCase() === user.email!.toLowerCase());
            return (
            <Card key={barber.id} className={cn(!activeMap[barber.id] && "opacity-60")}>
              {/* Card Header */}
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="relative flex-shrink-0">
                    <label className={cn("relative w-12 h-12 rounded-full cursor-pointer group block", photoBusyId === barber.id && "pointer-events-none opacity-70")}
                      title="Upload photo">
                      <AvatarImage src={barber.photo} alt={barber.name} className="w-12 h-12 rounded-full object-cover border border-[#2a2a2a]"
                        fallback={<div className="w-12 h-12 rounded-full bg-black/10 border border-black flex items-center justify-center text-white font-bold text-xl">{barber.name[0]}</div>} />
                      <span className="absolute inset-0 rounded-full bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                        <Camera size={14} className="text-white" />
                      </span>
                      {photoBusyId === barber.id && <span className="absolute inset-0 rounded-full bg-black/60 flex items-center justify-center text-[8px] text-white">…</span>}
                      <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden"
                        onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadPhoto(barber.id, f); }} />
                    </label>
                    {barber.photo && photoBusyId !== barber.id && (
                      <button type="button" onClick={() => removePhoto(barber.id)} title="Remove photo"
                        className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-red-500 text-white flex items-center justify-center border-2 border-black hover:bg-red-600 transition-colors">
                        <X size={10} />
                      </button>
                    )}
                  </div>
                  <div>
                    <h3 className="text-white font-semibold">{barber.name}</h3>
                    {barber.email && <p className="text-xs text-[#8f8f8f]">{barber.email}</p>}
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      {isOwnerBarber && (
                        <span className="text-xs bg-gold/15 border border-gold/30 text-gold rounded-full px-2 py-0.5">Owner</span>
                      )}
                      {barber.user_id ? (
                        <span className="text-xs bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 rounded-full px-2 py-0.5">✓ Portal active</span>
                      ) : barber.email ? (
                        <span className="text-xs bg-orange-500/15 border border-orange-500/30 text-orange-400 rounded-full px-2 py-0.5">⏳ Invite pending</span>
                      ) : (
                        <span className="text-xs bg-[#141414] border border-[#2a2a2a] text-[#8f8f8f] rounded-full px-2 py-0.5">Manual</span>
                      )}
                      <span className="text-white text-xs">★ {barber.rating}</span>
                    </div>
                  </div>
                </div>
                {/* Active toggle */}
                <Switch checked={!!activeMap[barber.id]} onChange={() => toggleActive(barber.id)} />
              </div>

              {/* Stats */}
              <div className="grid grid-cols-2 gap-2 mb-4">
                <div className="text-center p-2.5 bg-[#141414] rounded-xl">
                  <p className="text-lg font-bold text-white">{barber.apptCount ?? 0}</p>
                  <p className="text-xs text-[#8f8f8f]">Appts (mo.)</p>
                </div>
                <div className="text-center p-2.5 bg-[#141414] rounded-xl">
                  <p className="text-lg font-bold text-white">{commissions[barber.id] ?? barber.commission_percent}%</p>
                  <p className="text-xs text-[#8f8f8f]">Commission</p>
                </div>
              </div>

              {/* Commission Slider */}
              <div className="mb-4">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs text-[#8f8f8f]">Commission Rate</p>
                  <p className="text-sm font-bold text-white">{commissions[barber.id]}%</p>
                </div>
                <input
                  type="range" min={20} max={70} step={5}
                  value={commissions[barber.id]}
                  onChange={(e) => setCommissions((prev) => ({ ...prev, [barber.id]: Number(e.target.value) }))}
                  className="w-full accent-[#F5F0E6] h-1.5 rounded-full cursor-pointer"
                />
                <div className="flex justify-between text-xs text-[#8f8f8f] mt-0.5"><span>20%</span><span>70%</span></div>
                <Button variant="outline" size="sm" className="w-full mt-2" loading={savingCommission === barber.id} onClick={() => saveCommission(barber.id)}>
                  Save Commission
                </Button>
              </div>

              {/* Actions */}
              <div className="flex gap-2">
                <Button variant="outline" size="sm" className="flex-1" onClick={() => openSchedule(barber)}>Set Schedule</Button>
                {!isOwnerBarber && (
                  <Button variant="outline" size="sm" className="flex-1" onClick={() => openPermissions(barber)}>
                    <Shield size={13} className="mr-1.5" /> Permissions
                  </Button>
                )}
              </div>
              <div className="mt-2">
                <Button variant="secondary" size="sm" className="w-full" onClick={() => document.getElementById("clock-history")?.scrollIntoView({ behavior: "smooth" })}>
                  Clock History
                </Button>
              </div>

              {/* Admin controls */}
              <div className="flex gap-2 mt-2">
                {!isOwnerBarber && (!barber.user_id && barber.email ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1 text-orange-400 border-orange-500/30 hover:bg-orange-500/10"
                    loading={resendingInviteId === barber.id}
                    onClick={() => resendInvite(barber)}
                  >
                    ✉️ Resend Invite
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1 text-blue-400 border-blue-400/30 hover:bg-blue-400/10"
                    loading={resettingId === barber.id}
                    onClick={() => resetPassword(barber)}
                  >
                    <KeyRound size={13} className="mr-1.5" />
                    Reset Password
                  </Button>
                ))}
                <Button
                  variant="outline"
                  size="sm"
                  className="text-red-400 border-red-400/30 hover:bg-red-400/10 px-3"
                  onClick={() => setConfirmRemove(barber)}
                >
                  <Trash2 size={13} />
                </Button>
              </div>

              {/* Schedule Preview */}
              <div className="mt-3 flex gap-1 flex-wrap">
                {barber.schedule.map((day, i) => (
                  <span key={i} className={cn("text-xs px-1.5 py-0.5 rounded", day.isOpen ? "bg-black/10 text-white" : "bg-[#141414] text-[#8f8f8f]")}>
                    {DAYS_SHORT[i]}
                  </span>
                ))}
              </div>

              {/* Approved upcoming time-off */}
              {barber.upcomingTimeOff && barber.upcomingTimeOff.length > 0 && (
                <div className="mt-3 pt-3 border-t border-[#2a2a2a]/50 space-y-1">
                  <p className="text-[10px] uppercase tracking-wider text-[#8f8f8f]">Upcoming time off</p>
                  {barber.upcomingTimeOff.map(t => {
                    const dateLabel = t.start_date === t.end_date
                      ? formatFriendlyDate(t.start_date)
                      : `${formatFriendlyDate(t.start_date)} → ${formatFriendlyDate(t.end_date)}`;
                    const typeLabel = t.type === "blocked_hours" ? "Blocked" :
                      t.type === "day_off" ? "Day Off" :
                      t.type === "vacation" ? "Vacation" : "Sick";
                    return (
                      <div key={t.id} className="text-xs flex items-center gap-2 text-[#8f8f8f]">
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-orange-500/10 text-orange-300 border border-orange-500/20">
                          {typeLabel}
                        </span>
                        <span className="truncate">
                          {dateLabel}
                          {t.type === "blocked_hours" && t.start_time && t.end_time && (
                            <span className="text-[#8f8f8f]"> · {formatFriendlyTime(t.start_time)}–{formatFriendlyTime(t.end_time)}</span>
                          )}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>
            );
          })}
        </div>
      )}

      {/* Clock History */}
      <Card id="clock-history">
        <CardHeader>
          <CardTitle>Clock In / Out History</CardTitle>
          <Badge variant="outline">{staffHours.length} records</Badge>
        </CardHeader>
        <CardContent>
          {staffHours.length === 0 ? (
            <div className="py-8 text-center text-[#8f8f8f]">
              <p>No clock records found</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-[#2a2a2a]">
                    {["Barber", "Date", "Clock In", "Clock Out", "Hours", "Status"].map((h) => (
                      <th key={h} className="text-left text-xs font-medium text-[#8f8f8f] px-3 py-2">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {staffHours.map((sh) => (
                    <tr key={sh.id} className="border-b border-[#2a2a2a]/50 hover:bg-[#141414]/30">
                      <td className="px-3 py-3 text-sm text-white">{sh.barbers?.name ?? "—"}</td>
                      <td className="px-3 py-3 text-sm text-[#8f8f8f]">{prettyDate(sh.date)}</td>
                      <td className="px-3 py-3 text-sm text-emerald-400">{sh.clock_in}</td>
                      <td className="px-3 py-3 text-sm text-red-400">{sh.clock_out ?? "—"}</td>
                      <td className="px-3 py-3 text-sm text-white">{sh.hours_worked != null ? `${sh.hours_worked}h` : "—"}</td>
                      <td className="px-3 py-3">
                        <Badge variant={sh.clock_out ? "success" : "warning"}>{sh.clock_out ? "Done" : "Clocked In"}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Permissions Modal */}
      {permBarber && (
        <>
          <div className="fixed inset-0 bg-black/70 z-40" onClick={() => setPermBarber(null)} />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 overflow-y-auto overscroll-contain [&>*]:my-auto">
            <div className="bg-black shadow-sm border border-[#2a2a2a] rounded-2xl p-6 w-full max-w-md space-y-3 max-h-[90vh] overflow-y-auto">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-bold text-white">Permissions — {permBarber.name}</h2>
                  <p className="text-xs text-[#8f8f8f] mt-0.5">Choose what {permBarber.name.split(" ")[0]} can do from the barber portal.</p>
                </div>
                <button onClick={() => setPermBarber(null)} className="text-[#8f8f8f] hover:text-white"><X size={18} /></button>
              </div>
              <div className="space-y-2 pt-1">
                {([
                  { key: "edit_schedule",       label: "Edit own schedule",     description: "Change working hours from their Availability page." },
                  { key: "request_time_off",    label: "Request time off",      description: "Submit time-off requests for your approval." },
                  { key: "block_hours",         label: "Block hours mid-day",   description: "Mark a window unavailable on the fly." },
                  { key: "view_earnings",       label: "View earnings",         description: "See their commission totals and payouts." },
                  { key: "view_clients",        label: "View clients",          description: "Access their client list with appointment history." },
                  { key: "manage_appointments", label: "Manage appointments",   description: "Approve, complete, reject, and take payment on appointments assigned to them. Refunds stay owner-only." },
                ] as { key: keyof BarberPermissions; label: string; description: string }[]).map(({ key, label, description }) => (
                  <div key={key} className="flex items-start gap-4 p-3 bg-[#141414] rounded-xl border border-[#2a2a2a]">
                    <div className="flex-1">
                      <p className="text-sm font-medium text-white">{label}</p>
                      <p className="text-xs text-[#8f8f8f] mt-0.5">{description}</p>
                    </div>
                    <Switch checked={!!permDraft[key]} onChange={v => setPermDraft(prev => ({ ...prev, [key]: v }))} />
                  </div>
                ))}
              </div>
              <div className="flex gap-3 pt-2">
                <Button variant="outline" className="flex-1" onClick={() => setPermBarber(null)}>Cancel</Button>
                <Button className="flex-1" loading={savingPerms} onClick={savePermissions}>Save</Button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Schedule Modal */}
      {scheduleBarber && (
        <>
          <div className="fixed inset-0 bg-black/70 z-40" onClick={() => setScheduleBarber(null)} />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 overflow-y-auto overscroll-contain [&>*]:my-auto">
            <div className="bg-black shadow-sm border border-[#2a2a2a] rounded-2xl p-6 w-full max-w-lg space-y-4 max-h-[90vh] overflow-y-auto">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold text-white">Schedule — {scheduleBarber.name}</h2>
                <button onClick={() => setScheduleBarber(null)} className="text-[#8f8f8f] hover:text-white text-xl leading-none">✕</button>
              </div>

              {/* Time increments — quarter-hour lets a barber start at e.g.
                  9:45 AM. Shop-wide; the customer booking page offers the same
                  start-time spacing. */}
              <div className="flex items-center justify-between p-3 bg-[#141414] rounded-xl border border-[#2a2a2a]">
                <div className="pr-3">
                  <p className="text-sm font-medium text-white">Time increments</p>
                  <p className="text-xs text-[#8f8f8f]">Start/end + customer slots step by this. 15 min allows 9:45, 10:15…</p>
                </div>
                <div className="flex bg-black border border-[#2a2a2a] rounded-lg p-1 gap-1 flex-shrink-0">
                  {[30, 15].map(min => (
                    <button
                      key={min}
                      type="button"
                      onClick={() => changeInterval(min)}
                      className={cn(
                        "px-3 py-1.5 text-xs font-medium rounded-md transition-colors",
                        scheduleInterval === min ? "bg-gold text-black" : "text-[#8f8f8f] hover:text-white",
                      )}
                    >
                      {min} min
                    </button>
                  ))}
                </div>
              </div>
              <div className="space-y-2">
                {DAYS_FULL.map((day, dow) => {
                  // Find any approved time-off that touches this day-of-week
                  // (we walk each date in the request's range to check dow).
                  const timeOffOnThisDay = scheduleTimeOff.filter(t => {
                    const start = new Date(t.start_date + "T00:00:00");
                    const end = new Date(t.end_date + "T00:00:00");
                    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
                      if (d.getDay() === dow) return true;
                    }
                    return false;
                  });
                  // Full-day time-off (day_off / vacation / sick) overrides the
                  // weekly toggle. Blocked-hours don't — they're a partial window.
                  const fullDayTimeOff = timeOffOnThisDay.filter(t => t.type !== "blocked_hours");
                  const hasFullDayOff = fullDayTimeOff.length > 0;
                  const effectiveIsOpen = editSchedule[dow].isOpen && !hasFullDayOff;
                  const isCancellingForThisDay = fullDayTimeOff.some(t => cancellingTimeOffId === t.id);

                  const onToggleClick = async () => {
                    if (hasFullDayOff) {
                      // Toggle ON inside an approved full-day time-off means
                      // "reopen just this one day" — surgically exclude the
                      // nearest matching weekday from each request's range,
                      // never the whole request.
                      for (const t of fullDayTimeOff) {
                        const start = new Date(t.start_date + "T00:00:00");
                        const end = new Date(t.end_date + "T00:00:00");
                        let targetDate: Date | null = null;
                        for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
                          if (d.getDay() === dow) { targetDate = new Date(d); break; }
                        }
                        if (targetDate) {
                          // eslint-disable-next-line no-await-in-loop
                          await excludeTimeOffDate(t.id, formatDateForDb(targetDate));
                        }
                      }
                    } else {
                      updateScheduleDay(dow, "isOpen", !editSchedule[dow].isOpen);
                    }
                  };

                  return (
                    <div key={day} className="p-3 bg-[#141414] rounded-xl border border-[#2a2a2a] space-y-2">
                      {/* On a phone the time pickers wrap to their own full-width line
                          under the day (so they don't overflow or truncate); on sm+
                          they sit inline on one row. */}
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
                        <div className="flex items-center gap-3 sm:flex-shrink-0">
                          {/* Open/Close toggle — reflects the effective state.
                              If a full-day time-off is active, this toggle is
                              forced OFF and clicking it cancels the time-off. */}
                          <Switch
                            checked={effectiveIsOpen}
                            disabled={isCancellingForThisDay}
                            onChange={() => onToggleClick()}
                          />
                          <span className="text-sm text-white w-10 flex-shrink-0">{DAYS_SHORT[dow]}</span>
                          {!effectiveIsOpen && <span className="text-xs text-[#8f8f8f]">Closed</span>}
                        </div>
                        {effectiveIsOpen && (
                          <div className="flex items-center gap-2 sm:gap-3 pl-[52px] sm:pl-0 sm:flex-1">
                            <select
                              value={editSchedule[dow].startTime}
                              onChange={(e) => updateScheduleDay(dow, "startTime", e.target.value)}
                              className="flex-1 min-w-0 rounded-lg border border-[#2a2a2a] bg-black px-2 py-1.5 text-xs text-white focus:outline-none focus:border-black"
                            >
                              {scheduleSlotOptions.map((t) => <option key={t} value={t}>{t}</option>)}
                            </select>
                            <span className="text-[#8f8f8f] text-xs flex-shrink-0">to</span>
                            <select
                              value={editSchedule[dow].endTime}
                              onChange={(e) => updateScheduleDay(dow, "endTime", e.target.value)}
                              className="flex-1 min-w-0 rounded-lg border border-[#2a2a2a] bg-black px-2 py-1.5 text-xs text-white focus:outline-none focus:border-black"
                            >
                              {scheduleSlotOptions.map((t) => <option key={t} value={t}>{t}</option>)}
                            </select>
                          </div>
                        )}
                      </div>
                      {/* Approved time-off chips for this day */}
                      {timeOffOnThisDay.map(t => {
                        const isFullDay = t.type !== "blocked_hours";
                        const typeLabel = isFullDay
                          ? (t.type === "day_off" ? "Day Off" : t.type === "vacation" ? "Vacation" : "Sick")
                          : "Blocked";
                        const dateLabel = t.start_date === t.end_date
                          ? formatFriendlyDate(t.start_date)
                          : `${formatFriendlyDate(t.start_date)} → ${formatFriendlyDate(t.end_date)}`;
                        return (
                          <div key={t.id} className="flex items-center gap-2 text-xs pl-12">
                            <span className={cn(
                              "px-1.5 py-0.5 rounded text-[10px] font-medium border",
                              isFullDay ? "bg-orange-500/10 text-orange-300 border-orange-500/20" : "bg-purple-500/10 text-purple-300 border-purple-500/20",
                            )}>{typeLabel}</span>
                            <span className="text-[#8f8f8f] flex-1 truncate">
                              {dateLabel}
                              {t.type === "blocked_hours" && t.start_time && t.end_time && (
                                <span className="text-[#8f8f8f]"> · {formatFriendlyTime(t.start_time)}–{formatFriendlyTime(t.end_time)}</span>
                              )}
                            </span>
                            <button
                              type="button"
                              disabled={cancellingTimeOffId === t.id}
                              onClick={() => cancelTimeOff(t.id)}
                              className="text-xs text-red-400 hover:text-red-300 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
                            >
                              <X size={12} /> {cancellingTimeOffId === t.id ? "Cancelling…" : "Cancel"}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
              <div className="flex gap-3">
                <Button variant="outline" className="flex-1" onClick={() => setScheduleBarber(null)}>Cancel</Button>
                <Button className="flex-1" loading={savingSchedule} onClick={saveSchedule}>Save Schedule</Button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Invite Link Modal — shown after invite/resend so the owner can
          copy/paste it directly (email delivery isn't always reliable) */}
      {inviteLinkModal && (
        <>
          <div className="fixed inset-0 bg-black/70 z-40" onClick={() => setInviteLinkModal(null)} />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 overflow-y-auto overscroll-contain [&>*]:my-auto">
            <div className="bg-black shadow-sm border border-[#2a2a2a] rounded-2xl p-6 w-full max-w-md space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold text-white">✉️ Invite Link Ready</h2>
                <button onClick={() => setInviteLinkModal(null)} className="text-[#8f8f8f] hover:text-white text-xl leading-none">✕</button>
              </div>
              <p className="text-sm text-[#8f8f8f]">
                An email was sent to <span className="text-white font-medium">{inviteLinkModal.email}</span>. If it doesn&apos;t arrive (spam, sandbox limits, etc.), copy this link and send it to <span className="text-white font-medium">{inviteLinkModal.name}</span> directly.
              </p>
              <ResetLinkCopy link={inviteLinkModal.link} />
              <div className="p-3 bg-orange-500/10 border border-orange-500/30 rounded-xl text-xs text-orange-300">
                <p className="font-semibold mb-1">⚠ Link expires in ~1 hour</p>
                <p className="text-orange-200/80">
                  {inviteLinkModal.existingAccount
                    ? "This email already has a ClipWise account. The link signs them in instantly — no password needed."
                    : "When they open the link they'll be asked to set their password."}
                </p>
              </div>
              <Button className="w-full" onClick={() => setInviteLinkModal(null)}>Done</Button>
            </div>
          </div>
        </>
      )}

      {/* Password Reset Modal */}
      {resetModal && (
        <>
          <div className="fixed inset-0 bg-black/70 z-40" onClick={() => setResetModal(null)} />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 overflow-y-auto overscroll-contain [&>*]:my-auto">
            <div className="bg-black shadow-sm border border-[#2a2a2a] rounded-2xl p-6 w-full max-w-md space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold text-white">Password reset sent</h2>
                <button onClick={() => setResetModal(null)} className="text-[#8f8f8f] hover:text-white text-xl leading-none">✕</button>
              </div>
              <p className="text-sm text-[#8f8f8f]">
                {resetModal.emailed
                  ? <>A password-reset link was emailed to <span className="text-white font-medium">{resetModal.name}</span> ({resetModal.email}). It expires in 1 hour.</>
                  : <>We couldn&apos;t send the email to <span className="text-white font-medium">{resetModal.email}</span> right now. Ask them to use <span className="text-white">Forgot password</span> on the login page instead.</>}
              </p>
              <p className="text-xs text-[#8f8f8f]">For their security, the reset link goes only to the barber&apos;s own inbox — it isn&apos;t shown here.</p>
              <Button className="w-full" onClick={() => setResetModal(null)}>Done</Button>
            </div>
          </div>
        </>
      )}

      {/* Confirm Remove Modal */}
      {confirmRemove && (
        <>
          <div className="fixed inset-0 bg-black/70 z-40" onClick={() => setConfirmRemove(null)} />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 overflow-y-auto overscroll-contain [&>*]:my-auto">
            <div className="bg-black shadow-sm border border-[#2a2a2a] rounded-2xl p-6 w-full max-w-sm space-y-4">
              <div className="text-center">
                <div className="w-12 h-12 rounded-full bg-red-500/15 border border-red-500/30 flex items-center justify-center mx-auto mb-3">
                  <Trash2 size={20} className="text-red-400" />
                </div>
                <h2 className="text-lg font-bold text-white">Remove Barber?</h2>
                <p className="text-sm text-[#8f8f8f] mt-1">
                  This will remove <span className="text-white font-medium">{confirmRemove.name}</span> from your staff. Their appointments and history will remain. Their login account is not deleted.
                </p>
              </div>
              <div className="flex gap-3">
                <Button variant="outline" className="flex-1" onClick={() => setConfirmRemove(null)}>Cancel</Button>
                <Button
                  className="flex-1 bg-red-500 hover:bg-red-600 text-white"
                  loading={removingId === confirmRemove.id}
                  onClick={() => removeBarber(confirmRemove)}
                >
                  Remove
                </Button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Add / Invite Barber Modal */}
      {showAddModal && (
        <>
          <div className="fixed inset-0 bg-black/70 z-40" onClick={() => { setShowAddModal(false); setInviteSent(false); setAddForm({ name: "", email: "", commission_percent: "50" }); }} />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 overflow-y-auto overscroll-contain [&>*]:my-auto">
            <div className="bg-black shadow-sm border border-[#2a2a2a] rounded-2xl p-6 w-full max-w-md space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold text-white">Add Barber</h2>
                <button onClick={() => { setShowAddModal(false); setInviteSent(false); setAddForm({ name: "", email: "", commission_percent: "50" }); }} className="text-[#8f8f8f] hover:text-white text-xl leading-none">✕</button>
              </div>

              {/* Tabs */}
              <div className="flex gap-1 bg-[#141414] border border-[#2a2a2a] rounded-xl p-1">
                {(["invite", "manual"] as const).map(tab => (
                  <button
                    key={tab}
                    onClick={() => { setAddTab(tab); setInviteSent(false); }}
                    className={cn("flex-1 py-1.5 text-sm rounded-lg transition-all capitalize", addTab === tab ? "bg-black/10 text-white border border-[#2a2a2a]" : "text-[#8f8f8f] hover:text-white")}
                  >
                    {tab === "invite" ? "✉️ Invite by Email" : "➕ Add Manually"}
                  </button>
                ))}
              </div>

              {inviteSent ? (
                <div className="py-6 text-center">
                  <div className="text-4xl mb-3">✉️</div>
                  <p className="font-semibold text-white">Invite sent!</p>
                  <p className="text-sm text-[#8f8f8f] mt-1">{addForm.name} will get an email with a link to set up their account.</p>
                  <Button className="w-full mt-5" onClick={() => { setShowAddModal(false); setInviteSent(false); setAddForm({ name: "", email: "", commission_percent: "50" }); }}>Done</Button>
                </div>
              ) : (
                <>
                  {addTab === "invite" && (
                    <p className="text-xs text-[#8f8f8f] bg-[#141414] border border-[#2a2a2a] rounded-xl px-3 py-2">
                      An invite email will be sent. The barber clicks the link to create their account and gets access to their barber portal automatically.
                    </p>
                  )}
                  {addTab === "manual" && (
                    <div className="text-xs text-[#8f8f8f] bg-[#141414] border border-[#2a2a2a] rounded-xl px-3 py-2.5 space-y-2">
                      {alreadyOwnerBarber ? (
                        <p>You&apos;re already on the team as a barber. Enter someone else&apos;s email to add them — they&apos;ll get an invite link.</p>
                      ) : (
                        <>
                          <p>
                            Use <span className="text-white font-mono">{user?.email ?? "your account email"}</span> to add yourself as a barber instantly. Any other email sends an invite link.
                          </p>
                          {user?.email && (
                            <button
                              type="button"
                              onClick={() => setAddForm({
                                name: profile?.name || (user.email?.split("@")[0] ?? ""),
                                email: user.email!,
                                commission_percent: addForm.commission_percent,
                              })}
                              className="text-white hover:text-white/80 font-medium underline-offset-2 hover:underline"
                            >
                              + Add me as a barber
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  )}

                  {[
                    { key: "name" as const, label: "Full Name *", placeholder: "John Doe", type: "text", required: true, maxLength: 60 },
                    { key: "email" as const, label: "Email *", placeholder: "john@barbershop.com", type: "email", required: true, maxLength: 120 },
                    { key: "commission_percent" as const, label: "Commission %", placeholder: "50", type: "number", required: false, maxLength: 5 },
                  ].map(({ key, label, placeholder, type, required, maxLength }) => (
                    <div key={key} className="space-y-1.5">
                      <label className="text-sm text-[#8f8f8f]">{label}</label>
                      <input
                        type={type}
                        value={addForm[key]}
                        onChange={(e) => setAddForm((prev) => ({ ...prev, [key]: e.target.value }))}
                        placeholder={placeholder}
                        required={required}
                        maxLength={maxLength}
                        className="w-full bg-[#141414] border border-[#2a2a2a] rounded-xl px-4 py-2.5 text-sm text-white placeholder:text-[#8f8f8f] focus:outline-none focus:border-black"
                      />
                    </div>
                  ))}

                  <div className="flex gap-3 pt-2">
                    <Button variant="outline" className="flex-1" onClick={() => { setShowAddModal(false); setAddForm({ name: "", email: "", commission_percent: "50" }); }}>Cancel</Button>
                    <Button className="flex-1" loading={savingAdd} onClick={addTab === "invite" ? inviteBarber : addBarber}>
                      {addTab === "invite" ? "Send Invite" : "Add Barber"}
                    </Button>
                  </div>
                </>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
