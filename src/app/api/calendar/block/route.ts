import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { prettyDate } from "@/lib/utils";

// Calendar "block hours" — a thin wrapper over the time_off_requests engine
// (type "blocked_hours"). Two flows:
//   · Owner blocks  → auto-APPROVED instantly, owner gets an in-app
//     confirmation, the assigned barber (if different) is notified. No email.
//   · Barber blocks → a PENDING request; the owner gets an in-app notification
//     + an email to approve (same as a time-off request). Requires the
//     block_hours permission.
// DELETE-style "remove" (action: "remove") clears a block — owner, or the
// barber who owns it.

export async function POST(request: NextRequest) {
  const token = request.headers.get("Authorization")?.replace("Bearer ", "");
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(token);
  if (authErr || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json() as {
    action?: "create" | "remove";
    request_id?: string;
    barber_id?: string;
    shop_id?: string;
    date?: string;
    start_time?: string;
    end_time?: string;
    reason?: string | null;
  };

  // ── Resolve the shop + whether the caller owns it ─────────────────────────
  const shopId = body.shop_id;
  if (!shopId) return NextResponse.json({ error: "Missing shop_id" }, { status: 400 });
  const { data: shop } = await supabaseAdmin
    .from("shops").select("id, name, owner_id, email").eq("id", shopId).single();
  if (!shop) return NextResponse.json({ error: "Shop not found" }, { status: 404 });
  const isOwner = shop.owner_id === user.id;

  // ── Remove an existing block ──────────────────────────────────────────────
  if (body.action === "remove") {
    if (!body.request_id) return NextResponse.json({ error: "Missing request_id" }, { status: 400 });
    const { data: blk } = await supabaseAdmin
      .from("time_off_requests").select("id, barber_id, shop_id, barbers(user_id)").eq("id", body.request_id).single();
    if (!blk || blk.shop_id !== shopId) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const ownsIt = isOwner || (blk as { barbers?: { user_id?: string } | null }).barbers?.user_id === user.id;
    if (!ownsIt) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    await supabaseAdmin.from("time_off_requests").delete().eq("id", body.request_id);
    return NextResponse.json({ ok: true, removed: true });
  }

  // ── Create a block ────────────────────────────────────────────────────────
  if (!body.barber_id || !body.date || !body.start_time || !body.end_time) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }

  // The barber being blocked (and the caller's relationship to them).
  const { data: barber } = await supabaseAdmin
    .from("barbers").select("id, name, user_id, shop_id, permissions").eq("id", body.barber_id).single();
  if (!barber || barber.shop_id !== shopId) return NextResponse.json({ error: "Barber not found" }, { status: 404 });

  if (!isOwner) {
    // A staff barber may only block their OWN column, and only with permission.
    if (barber.user_id !== user.id) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    const perms = barber.permissions as { block_hours?: boolean } | null;
    if (perms?.block_hours === false) return NextResponse.json({ error: "No permission to block hours" }, { status: 403 });
  }

  const status = isOwner ? "approved" : "pending";
  const { data: inserted, error: insErr } = await supabaseAdmin
    .from("time_off_requests")
    .insert({
      barber_id: body.barber_id,
      shop_id: shopId,
      type: "blocked_hours",
      start_date: body.date,
      end_date: body.date,
      start_time: body.start_time,
      end_time: body.end_time,
      reason: body.reason || null,
      status,
      ...(isOwner ? { decided_by: user.id, decided_at: new Date().toISOString() } : {}),
    })
    .select()
    .single();
  if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });

  const niceDate = prettyDate(body.date);
  const timeRange = `${body.start_time}–${body.end_time}`;

  if (isOwner) {
    // Confirmation to the owner; notify the barber if it's not the owner's own column.
    const recipients = new Set<string>([shop.owner_id]);
    if (barber.user_id && barber.user_id !== shop.owner_id) recipients.add(barber.user_id);
    await supabaseAdmin.from("notifications").insert(
      Array.from(recipients).map(uid => ({
        user_id: uid,
        title: "Hours blocked",
        message: uid === barber.user_id && uid !== shop.owner_id
          ? `${barber.name}'s ${niceDate} ${timeRange} was blocked by the shop owner.`
          : `Blocked ${barber.name} · ${niceDate} ${timeRange}${body.reason ? ` — "${body.reason}"` : ""}.`,
        type: "system",
        is_read: false,
      })),
    ).then(null, () => null);
  } else {
    // Pending request → owner gets a notification + an email to approve.
    await supabaseAdmin.from("notifications").insert({
      user_id: shop.owner_id,
      title: "New Block Request",
      message: `${barber.name} requested to block ${niceDate} ${timeRange}${body.reason ? ` — "${body.reason}"` : ""}.`,
      type: "system",
      is_read: false,
    }).then(null, () => null);

    const { data: ownerUser } = await supabaseAdmin.auth.admin.getUserById(shop.owner_id);
    const ownerEmail = ownerUser?.user?.email ?? shop.email ?? "";
    if (ownerEmail) {
      const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3001";
      await fetch(`${baseUrl}/api/send-email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "time_off_request",
          data: {
            shopName: shop.name,
            shopEmail: shop.email ?? "",
            ownerEmail,
            barberName: barber.name,
            requestType: "Blocked Hours",
            dateRange: niceDate,
            timeRange,
            reason: body.reason ?? "",
          },
        }),
      }).catch(() => null);
    }
  }

  return NextResponse.json({ ok: true, status, block: inserted });
}
