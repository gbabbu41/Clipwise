import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

// Barber-side time-off submission. The barber's own auth context cannot
// insert into notifications.user_id = <owner> (RLS allows only own rows),
// and most shops don't have shop.email set so client-side email sends would
// silently go to "". This route handles all of it using the service role:
//  1) insert the time_off_request scoped to the barber
//  2) insert the owner's in-app notification
//  3) look up the owner's auth email and send the request email

const TYPE_LABELS: Record<string, string> = {
  day_off: "Day Off",
  vacation: "Vacation",
  blocked_hours: "Blocked Hours",
  sick: "Sick Day",
};

export async function POST(request: NextRequest) {
  const token = request.headers.get("Authorization")?.replace("Bearer ", "");
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(token);
  if (authErr || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json() as {
    barber_id: string;
    shop_id: string;
    type: "day_off" | "vacation" | "blocked_hours" | "sick";
    start_date: string;
    end_date: string;
    start_time?: string | null;
    end_time?: string | null;
    reason?: string | null;
  };

  // Verify the caller actually IS this barber (so a malicious barber can't
  // submit time-off as someone else).
  const { data: barber } = await supabaseAdmin
    .from("barbers")
    .select("id, name, shop_id")
    .eq("id", body.barber_id)
    .eq("user_id", user.id)
    .single();
  if (!barber || barber.shop_id !== body.shop_id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // 1) Insert the request
  const { data: inserted, error: insertErr } = await supabaseAdmin
    .from("time_off_requests")
    .insert({
      barber_id: body.barber_id,
      shop_id: body.shop_id,
      type: body.type,
      start_date: body.start_date,
      end_date: body.end_date,
      start_time: body.type === "blocked_hours" ? body.start_time || null : null,
      end_time: body.type === "blocked_hours" ? body.end_time || null : null,
      reason: body.reason || null,
      status: "pending",
    })
    .select()
    .single();
  if (insertErr) return NextResponse.json({ error: insertErr.message }, { status: 500 });

  // 2) Owner's in-app notification + 3) email — both need the shop + owner
  const { data: shop } = await supabaseAdmin
    .from("shops")
    .select("id, name, owner_id, email")
    .eq("id", body.shop_id)
    .single();
  if (shop) {
    const dateRange = body.start_date + (body.end_date !== body.start_date ? ` → ${body.end_date}` : "");
    const timeRange = body.type === "blocked_hours" && body.start_time && body.end_time
      ? ` (${body.start_time}–${body.end_time})` : "";
    const summary = `${TYPE_LABELS[body.type]} · ${dateRange}${timeRange}`;

    // Notification — service role bypasses the user_id=auth.uid() restriction
    await supabaseAdmin.from("notifications").insert({
      user_id: shop.owner_id,
      title: "New Time-Off Request",
      message: `${barber.name}: ${summary}${body.reason ? ` — "${body.reason}"` : ""}`,
      type: "system",
      is_read: false,
    });

    // Resolve owner's email — auth email is always set, shop.email often isn't
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
            requestType: TYPE_LABELS[body.type],
            dateRange,
            timeRange: body.type === "blocked_hours" && body.start_time && body.end_time
              ? `${body.start_time}–${body.end_time}` : "",
            reason: body.reason ?? "",
          },
        }),
      }).catch(() => null);
    }
  }

  return NextResponse.json({ ok: true, request: inserted });
}
