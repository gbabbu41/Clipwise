import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { authorizeSchedule, validId, validSchedule } from "@/lib/schedule-access";
import { sendAppEmail } from "@/lib/emailer";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

type DayIn = { day_of_week: number; is_open: boolean; start_time: string; end_time: string };
type BreakIn = { day_of_week: number; start_time: string; end_time: string; label?: string | null };

// Authorize: the caller must be the shop owner OR the barber themselves.
async function authorize(token: string | undefined, barberId: string) {
  return authorizeSchedule(token, barberId);
}

// ── Load a barber's weekly schedule (working hours + recurring breaks) ──────────
export async function GET(request: NextRequest) {
  const token = request.headers.get("Authorization")?.replace("Bearer ", "");
  const barberId = request.nextUrl.searchParams.get("barber_id") ?? "";
  if (!validId(barberId)) return NextResponse.json({ error: "Invalid barber_id" }, { status: 400 });

  const today = new Date().toISOString().slice(0, 10);
  // Fire the data queries immediately (they only need barberId) and run the
  // auth check concurrently — overlapping instead of waterfalling. Data is only
  // returned after auth passes, so nothing leaks on a failed check.
  const dataP = Promise.all([
    supabaseAdmin.from("time_slots").select("day_of_week, start_time, end_time, is_available").eq("barber_id", barberId),
    supabaseAdmin.from("barber_breaks").select("day_of_week, start_time, end_time, label").eq("barber_id", barberId),
    supabaseAdmin.from("time_off_requests").select("id, type, start_date, end_date, reason, status")
      .eq("barber_id", barberId).gte("end_date", today).order("start_date"),
  ]);
  const auth = await authorize(token, barberId);
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const results = await dataP;
  if (results.some(r => r.error)) return NextResponse.json({ error: "Unable to load schedule" }, { status: 503 });
  const [{ data: slots }, { data: breaks }, { data: timeOff }] = results;
  return NextResponse.json({ slots: slots ?? [], breaks: breaks ?? [], timeOff: timeOff ?? [],
    canRequestTimeOff: auth.isOwner || auth.barber.permissions?.request_time_off !== false,
    canBlockHours: auth.isOwner || auth.barber.permissions?.block_hours !== false,
  });
}

// ── Save the weekly schedule + email the barber their new schedule ──────────────
export async function POST(request: NextRequest) {
  const token = request.headers.get("Authorization")?.replace("Bearer ", "");
  const body = await request.json().catch(() => null) as { barber_id: string; days: DayIn[]; breaks: BreakIn[] } | null;
  if (!body || !validId(body.barber_id) || !validSchedule(body.days, body.breaks)) return NextResponse.json({ error: "Invalid schedule: check days, hours and breaks" }, { status: 400 });
  const auth = await authorizeSchedule(token, body.barber_id, "edit_schedule");
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { barber, shop, isOwner } = auth;

  // Enforce the owner's "edit schedule" permission — a barber whose toggle is off
  // can't rewrite their hours server-side (the owner always can). Matches the
  // barber/availability route. Undefined = allowed.
  if (!isOwner && (barber!.permissions as { edit_schedule?: boolean } | null)?.edit_schedule === false) {
    return NextResponse.json({ error: "Editing your schedule is turned off for your account." }, { status: 403 });
  }

  // Replace working hours (time_slots) — open days only.
  const slotRows = (body.days ?? [])
    .filter(d => d.is_open && d.start_time && d.end_time)
    .map(d => ({ barber_id: barber!.id, day_of_week: d.day_of_week, start_time: d.start_time, end_time: d.end_time, is_available: true }));

  // Replace recurring breaks (only on open days). Surface failures (e.g. the
  // barber_breaks table not migrated yet) instead of silently dropping them.
  const openDays = new Set(slotRows.map(s => s.day_of_week));
  const breakRows = (body.breaks ?? [])
    .filter(b => openDays.has(b.day_of_week) && b.start_time && b.end_time)
    .map(b => ({ barber_id: barber!.id, shop_id: barber!.shop_id, day_of_week: b.day_of_week, start_time: b.start_time, end_time: b.end_time, label: b.label || "Break" }));
  const { error: saveError } = await supabaseAdmin.rpc("replace_barber_schedule", {
    p_actor_id: auth.user.id, p_barber_id: barber.id, p_slots: slotRows, p_breaks: breakRows,
  });
  if (saveError) return NextResponse.json({ error: saveError.code === "PGRST202"
    ? "Schedule saving is temporarily unavailable. The schedule database update must be applied. Your existing schedule is unchanged."
    : "Unable to save schedule. Your existing schedule is unchanged." }, { status: 503 });

  // Email the barber their new weekly schedule (best-effort).
  if (barber!.email) {
    const scheduleHtml = buildScheduleRows(body.days, body.breaks);
    await sendAppEmail("schedule_updated", { barberEmail: barber.email, barberName: barber.name ?? "there", shopName: shop.name ?? "your shop", scheduleHtml }).catch(() => null);
  }

  return NextResponse.json({ ok: true });
}

// Render schedule rows as HTML for the email.
function buildScheduleRows(days: DayIn[], breaks: BreakIn[]): string {
  const to12 = (t: string) => {
    const [h, m] = t.split(":").map(Number);
    const p = h >= 12 ? "PM" : "AM"; const hh = h % 12 === 0 ? 12 : h % 12;
    return `${hh}:${String(m).padStart(2, "0")} ${p}`;
  };
  return [1, 2, 3, 4, 5, 6, 0].map(dow => {
    const d = days.find(x => x.day_of_week === dow);
    const open = d?.is_open && d.start_time && d.end_time;
    const bks = breaks.filter(b => b.day_of_week === dow && (!d || d.is_open));
    const right = open
      ? `${to12(d!.start_time)} – ${to12(d!.end_time)}${bks.length ? ` · ${bks.map(b => `${(b.label || "Break").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!)} ${to12(b.start_time)}–${to12(b.end_time)}`).join(", ")}` : ""}`
      : "Closed";
    return `<div class="row"><span class="label">${DAYS[dow]}</span><span class="val">${right}</span></div>`;
  }).join("");
}
