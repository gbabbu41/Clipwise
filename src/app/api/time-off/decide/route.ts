import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { insertNotifications } from "@/lib/notify-server";
import { prettyDate } from "@/lib/utils";

// Owner-side approve/deny. Uses the service role so the in-app notification
// to the barber goes through despite the notifications RLS (which only lets
// each user insert into their own row).

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

  const { request_id, decision } = await request.json() as {
    request_id: string;
    decision: "approved" | "denied";
  };
  if (decision !== "approved" && decision !== "denied") {
    return NextResponse.json({ error: "Invalid decision" }, { status: 400 });
  }

  // Pull the request + the shop so we can verify the caller owns the shop.
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

  // 1) Update status
  const { error: updErr } = await supabaseAdmin
    .from("time_off_requests")
    .update({ status: decision, decided_by: user.id, decided_at: new Date().toISOString() })
    .eq("id", request_id);
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

  const dateRange = prettyDate(req.start_date) + (req.end_date !== req.start_date ? ` → ${prettyDate(req.end_date)}` : "");
  const timeRange = req.type === "blocked_hours" && req.start_time && req.end_time
    ? `${req.start_time}–${req.end_time}` : "";

  // 2) Barber's in-app notification — only if the barber has linked an account
  if (barber?.user_id) {
    await insertNotifications({
      user_id: barber.user_id,
      shop_id: shop?.id ?? null,
      title: decision === "approved" ? "Time-Off Approved" : "Time-Off Denied",
      message: `Your ${TYPE_LABELS[req.type]} request for ${dateRange} was ${decision} by the shop owner.`,
      type: "system",
    });
  }

  // 3) Email the barber
  if (barber?.email) {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3001";
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
          decision,
          requestType: TYPE_LABELS[req.type],
          dateRange,
          timeRange,
        },
      }),
    }).catch(() => null);
  }

  return NextResponse.json({ ok: true });
}
