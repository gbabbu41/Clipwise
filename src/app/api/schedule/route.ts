import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const BASE_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://clipwise.ca";

type DayIn = { day_of_week: number; is_open: boolean; start_time: string; end_time: string };
type BreakIn = { day_of_week: number; start_time: string; end_time: string; label?: string | null };

// Authorize: the caller must be the shop owner OR the barber themselves.
async function authorize(token: string | undefined, barberId: string) {
  if (!token) return { error: "Unauthorized", status: 401 as const };
  // getUser and the barber lookup don't depend on each other — run them together.
  const [{ data: { user } }, { data: barber }] = await Promise.all([
    supabaseAdmin.auth.getUser(token),
    supabaseAdmin.from("barbers").select("id, shop_id, user_id, name, email").eq("id", barberId).maybeSingle(),
  ]);
  if (!user) return { error: "Unauthorized", status: 401 as const };
  if (!barber) return { error: "Barber not found", status: 404 as const };
  const { data: shop } = await supabaseAdmin
    .from("shops").select("id, owner_id, name").eq("id", barber.shop_id).maybeSingle();
  const allowed = barber.user_id === user.id || (!!shop && shop.owner_id === user.id);
  if (!allowed) return { error: "Forbidden", status: 403 as const };
  return { barber, shop };
}

// ── Load a barber's weekly schedule (working hours + recurring breaks) ──────────
export async function GET(request: NextRequest) {
  const token = request.headers.get("Authorization")?.replace("Bearer ", "");
  const barberId = request.nextUrl.searchParams.get("barber_id") ?? "";
  if (!barberId) return NextResponse.json({ error: "Missing barber_id" }, { status: 400 });

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

  const [{ data: slots }, { data: breaks }, { data: timeOff }] = await dataP;
  return NextResponse.json({ slots: slots ?? [], breaks: breaks ?? [], timeOff: timeOff ?? [] });
}

// ── Save the weekly schedule + email the barber their new schedule ──────────────
export async function POST(request: NextRequest) {
  const token = request.headers.get("Authorization")?.replace("Bearer ", "");
  const body = await request.json() as { barber_id: string; days: DayIn[]; breaks: BreakIn[] };
  if (!body.barber_id) return NextResponse.json({ error: "Missing barber_id" }, { status: 400 });
  const auth = await authorize(token, body.barber_id);
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { barber, shop } = auth;

  // Replace working hours (time_slots) — open days only.
  const slotRows = (body.days ?? [])
    .filter(d => d.is_open && d.start_time && d.end_time)
    .map(d => ({ barber_id: barber!.id, day_of_week: d.day_of_week, start_time: d.start_time, end_time: d.end_time, is_available: true }));
  await supabaseAdmin.from("time_slots").delete().eq("barber_id", barber!.id);
  if (slotRows.length) {
    const ins = await supabaseAdmin.from("time_slots").insert(slotRows);
    if (ins.error) return NextResponse.json({ error: ins.error.message }, { status: 500 });
  }

  // Replace recurring breaks (only on open days). Surface failures (e.g. the
  // barber_breaks table not migrated yet) instead of silently dropping them.
  const openDays = new Set(slotRows.map(s => s.day_of_week));
  const breakRows = (body.breaks ?? [])
    .filter(b => openDays.has(b.day_of_week) && b.start_time && b.end_time)
    .map(b => ({ barber_id: barber!.id, shop_id: barber!.shop_id, day_of_week: b.day_of_week, start_time: b.start_time, end_time: b.end_time, label: b.label || "Break" }));
  let breaksError: string | null = null;
  const del = await supabaseAdmin.from("barber_breaks").delete().eq("barber_id", barber!.id);
  if (del.error) breaksError = del.error.message;
  if (!breaksError && breakRows.length) {
    const ins = await supabaseAdmin.from("barber_breaks").insert(breakRows);
    if (ins.error) breaksError = ins.error.message;
  }

  // Email the barber their new weekly schedule (best-effort).
  if (barber!.email) {
    const scheduleHtml = buildScheduleRows(body.days, body.breaks);
    fetch(`${BASE_URL}/api/send-email`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "schedule_updated",
        data: { barberEmail: barber!.email, barberName: barber!.name ?? "there", shopName: shop?.name ?? "your shop", scheduleHtml },
      }),
    }).catch(() => {});
  }

  return NextResponse.json({ ok: true, breaksError });
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
      ? `${to12(d!.start_time)} – ${to12(d!.end_time)}${bks.length ? ` · ${bks.map(b => `${b.label || "Break"} ${to12(b.start_time)}–${to12(b.end_time)}`).join(", ")}` : ""}`
      : "Closed";
    return `<div class="row"><span class="label">${DAYS[dow]}</span><span class="val">${right}</span></div>`;
  }).join("");
}
