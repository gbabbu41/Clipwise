import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { insertNotifications } from "@/lib/notify-server";
import { prettyDate } from "@/lib/utils";

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3001";

const TYPE_LABELS: Record<string, string> = {
  day_off: "Day Off",
  vacation: "Vacation",
  blocked_hours: "Blocked Hours",
  sick: "Sick Day",
};

// Authorize: caller must be the shop owner OR the barber themselves.
// Returns isOwner so the handler can decide approved-vs-pending.
async function authorize(token: string | undefined, barberId: string) {
  if (!token) return { error: "Unauthorized", status: 401 as const };
  const { data: { user } } = await supabaseAdmin.auth.getUser(token);
  if (!user) return { error: "Unauthorized", status: 401 as const };
  const { data: barber } = await supabaseAdmin
    .from("barbers").select("id, shop_id, user_id, name").eq("id", barberId).maybeSingle();
  if (!barber) return { error: "Barber not found", status: 404 as const };
  const { data: shop } = await supabaseAdmin
    .from("shops").select("id, owner_id, name, email").eq("id", barber.shop_id).maybeSingle();
  const isOwner = !!shop && shop.owner_id === user.id;
  const isSelf = barber.user_id === user.id;
  if (!isOwner && !isSelf) return { error: "Forbidden", status: 403 as const };
  return { barber, shop, isOwner };
}

// ── Add / request time off ──────────────────────────────────────────────────
// Owner → instantly approved. Barber → pending + owner notification + email.
export async function POST(request: NextRequest) {
  const token = request.headers.get("Authorization")?.replace("Bearer ", "");
  const body = await request.json() as {
    barber_id: string;
    type?: "day_off" | "vacation" | "blocked_hours" | "sick";
    start_date: string;
    end_date: string;
    start_time?: string | null;
    end_time?: string | null;
    reason?: string | null;
  };
  if (!body.barber_id || !body.start_date || !body.end_date) {
    return NextResponse.json({ error: "Missing dates" }, { status: 400 });
  }
  const auth = await authorize(token, body.barber_id);
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { barber, shop, isOwner } = auth;

  const type = body.type ?? "day_off";
  const status = isOwner ? "approved" : "pending";
  let startDate = body.start_date;
  let endDate = body.end_date;

  // ── Overlap handling (so a duplicate/overlapping entry never stacks
  //    confusingly or silently no-ops). For the same barber, same type and
  //    same status we either:
  //      • duplicate  → an existing row already covers these dates → no-op
  //      • merged     → overlapping rows → consolidate into ONE union range
  //      • added      → no overlap → plain insert
  //    Blocked-hours overlap also requires the same times (intra-day blocks
  //    can legitimately stack on different times).
  const { data: existing } = await supabaseAdmin
    .from("time_off_requests")
    .select("id, type, start_date, end_date, start_time, end_time, status")
    .eq("barber_id", barber!.id).eq("type", type).eq("status", status);

  const newStart = type === "blocked_hours" ? (body.start_time || null) : null;
  const newEnd = type === "blocked_hours" ? (body.end_time || null) : null;
  const dateOverlap = (s: string, e: string) => s <= endDate && e >= startDate;
  const overlaps = (existing ?? []).filter(r => {
    if (!dateOverlap(r.start_date as string, r.end_date as string)) return false;
    if (type === "blocked_hours") return r.start_time === newStart && r.end_time === newEnd;
    return true;
  });

  let action: "added" | "merged" | "duplicate" = "added";
  let resultId: string | null = null;

  const covers = overlaps.find(r => (r.start_date as string) <= startDate && (r.end_date as string) >= endDate);
  if (covers) {
    action = "duplicate";
    resultId = covers.id as string;
  } else if (overlaps.length) {
    // Merge: union range across all overlapping rows + the new one.
    startDate = overlaps.reduce((m, r) => ((r.start_date as string) < m ? (r.start_date as string) : m), startDate);
    endDate = overlaps.reduce((m, r) => ((r.end_date as string) > m ? (r.end_date as string) : m), endDate);
    const [keep, ...rest] = overlaps;
    if (rest.length) await supabaseAdmin.from("time_off_requests").delete().in("id", rest.map(r => r.id as string));
    const { error: upErr } = await supabaseAdmin.from("time_off_requests")
      .update({ start_date: startDate, end_date: endDate, reason: body.reason || null })
      .eq("id", keep.id as string);
    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });
    action = "merged";
    resultId = keep.id as string;
  } else {
    const { data: inserted, error: insertErr } = await supabaseAdmin
      .from("time_off_requests")
      .insert({
        barber_id: barber!.id,
        shop_id: barber!.shop_id,
        type,
        start_date: startDate,
        end_date: endDate,
        start_time: newStart,
        end_time: newEnd,
        reason: body.reason || null,
        status,
      })
      .select("id")
      .single();
    if (insertErr) return NextResponse.json({ error: insertErr.message }, { status: 500 });
    resultId = inserted?.id as string ?? null;
  }

  // Notify + email the owner when a barber requests (not the owner), and only
  // when something actually changed (added/merged, not a no-op duplicate).
  if (!isOwner && shop && action !== "duplicate") {
    const dateRange = prettyDate(startDate) + (endDate !== startDate ? ` → ${prettyDate(endDate)}` : "");
    const timeRange = type === "blocked_hours" && newStart && newEnd ? ` (${newStart}–${newEnd})` : "";
    const summary = `${TYPE_LABELS[type]} · ${dateRange}${timeRange}`;

    await insertNotifications({
      user_id: shop.owner_id,
      shop_id: barber!.shop_id,
      title: "New Time-Off Request",
      message: `${barber!.name}: ${summary}${body.reason ? ` — "${body.reason}"` : ""}`,
      type: "system",
    });

    const { data: ownerUser } = await supabaseAdmin.auth.admin.getUserById(shop.owner_id);
    const ownerEmail = ownerUser?.user?.email ?? shop.email ?? "";
    if (ownerEmail) {
      fetch(`${BASE_URL}/api/send-email`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "time_off_request",
          data: {
            shopName: shop.name, shopEmail: shop.email ?? "", ownerEmail,
            barberName: barber!.name, requestType: TYPE_LABELS[type], dateRange,
            timeRange: type === "blocked_hours" && newStart && newEnd ? `${newStart}–${newEnd}` : "",
            reason: body.reason ?? "",
          },
        }),
      }).catch(() => {});
    }
  }

  // Always return the fresh authoritative upcoming list so the client never
  // drifts from the DB (this is what fixes "the second one didn't show").
  const today = new Date().toISOString().slice(0, 10);
  const { data: timeOff } = await supabaseAdmin
    .from("time_off_requests").select("id, type, start_date, end_date, reason, status")
    .eq("barber_id", barber!.id).gte("end_date", today).order("start_date");
  const current = (timeOff ?? []).find(r => r.id === resultId) ?? null;

  return NextResponse.json({ ok: true, action, request: current, timeOff: timeOff ?? [] });
}

// ── Cancel / delete a time-off entry ────────────────────────────────────────
export async function DELETE(request: NextRequest) {
  const token = request.headers.get("Authorization")?.replace("Bearer ", "");
  const id = request.nextUrl.searchParams.get("id") ?? "";
  const barberId = request.nextUrl.searchParams.get("barber_id") ?? "";
  if (!id || !barberId) return NextResponse.json({ error: "Missing id" }, { status: 400 });
  const auth = await authorize(token, barberId);
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { error } = await supabaseAdmin
    .from("time_off_requests").delete().eq("id", id).eq("barber_id", barberId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
