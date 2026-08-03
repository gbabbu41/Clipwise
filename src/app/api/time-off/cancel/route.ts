import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { insertNotifications } from "@/lib/notify-server";
import { prettyDate } from "@/lib/utils";

// Owner-side cancellation of an already-approved time-off. Same server-side
// pattern as the approve/deny route: admin client + notification + email,
// so RLS doesn't block the cross-user notification insert.

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

  const { request_id } = await request.json() as { request_id: string };

  const { data: req } = await supabaseAdmin
    .from("time_off_requests")
    .select("*, barbers(id, name, email, user_id), shops(id, name, owner_id, email)")
    .eq("id", request_id)
    .single();
  if (!req) return NextResponse.json({ error: "Request not found" }, { status: 404 });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const shop = (req as any).shops as { id: string; name: string; owner_id: string; email?: string | null } | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const barber = (req as any).barbers as { id: string; name: string; email?: string | null; user_id?: string | null } | null;
  if (!shop || shop.owner_id !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Delete the request
  const { error: delErr } = await supabaseAdmin
    .from("time_off_requests")
    .delete()
    .eq("id", request_id);
  if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });

  const dateRange = prettyDate(req.start_date) + (req.end_date !== req.start_date ? ` → ${prettyDate(req.end_date)}` : "");
  const timeRange = req.type === "blocked_hours" && req.start_time && req.end_time
    ? `${req.start_time}–${req.end_time}` : "";

  // Barber notification
  if (barber?.user_id) {
    await insertNotifications({
      user_id: barber.user_id,
      shop_id: shop?.id ?? null,
      title: "Time-Off Cancelled",
      message: `Your ${TYPE_LABELS[req.type]} for ${dateRange} was cancelled by the shop owner.`,
      type: "system",
    });
  }

  // Email the barber
  if (barber?.email) {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://clipwise.ca";
    await fetch(`${baseUrl}/api/send-email`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "time_off_decision",
        data: {
          barberEmail: barber.email,
          barberName: barber.name,
          shopName: shop.name,
          shopEmail: shop.email ?? "",
          decision: "cancelled",
          requestType: TYPE_LABELS[req.type],
          dateRange,
          timeRange,
        },
      }),
    }).catch(() => null);
  }

  return NextResponse.json({ ok: true });
}
