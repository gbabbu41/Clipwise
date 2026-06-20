import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
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

  const { data: inserted, error: insertErr } = await supabaseAdmin
    .from("time_off_requests")
    .insert({
      barber_id: barber!.id,
      shop_id: barber!.shop_id,
      type,
      start_date: body.start_date,
      end_date: body.end_date,
      start_time: type === "blocked_hours" ? body.start_time || null : null,
      end_time: type === "blocked_hours" ? body.end_time || null : null,
      reason: body.reason || null,
      status,
    })
    .select("id, type, start_date, end_date, reason, status")
    .single();
  if (insertErr) return NextResponse.json({ error: insertErr.message }, { status: 500 });

  // When a barber requests (not the owner), notify + email the owner.
  if (!isOwner && shop) {
    const dateRange = prettyDate(body.start_date) + (body.end_date !== body.start_date ? ` → ${prettyDate(body.end_date)}` : "");
    const timeRange = type === "blocked_hours" && body.start_time && body.end_time ? ` (${body.start_time}–${body.end_time})` : "";
    const summary = `${TYPE_LABELS[type]} · ${dateRange}${timeRange}`;

    await supabaseAdmin.from("notifications").insert({
      user_id: shop.owner_id,
      title: "New Time-Off Request",
      message: `${barber!.name}: ${summary}${body.reason ? ` — "${body.reason}"` : ""}`,
      type: "system",
      is_read: false,
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
            timeRange: type === "blocked_hours" && body.start_time && body.end_time ? `${body.start_time}–${body.end_time}` : "",
            reason: body.reason ?? "",
          },
        }),
      }).catch(() => {});
    }
  }

  return NextResponse.json({ ok: true, request: inserted });
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
