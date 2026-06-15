import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { prettyDate } from "@/lib/utils";

// Owner removes a single date from an approved multi-day time-off (e.g. a
// vacation Mon-Fri stays in place, but Tuesday is excluded so the barber
// works that day). Splits, shrinks, or deletes the row depending on where
// the excluded date sits in the original range.

const TYPE_LABELS: Record<string, string> = {
  day_off: "Day Off",
  vacation: "Vacation",
  blocked_hours: "Blocked Hours",
  sick: "Sick Day",
};

function addDays(d: string, n: number): string {
  const date = new Date(d + "T00:00:00");
  date.setDate(date.getDate() + n);
  return date.toISOString().slice(0, 10);
}

export async function POST(request: NextRequest) {
  const token = request.headers.get("Authorization")?.replace("Bearer ", "");
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(token);
  if (authErr || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { request_id, exclude_date } = await request.json() as {
    request_id: string;
    exclude_date: string; // "YYYY-MM-DD"
  };
  if (!request_id || !exclude_date) {
    return NextResponse.json({ error: "request_id and exclude_date are required" }, { status: 400 });
  }

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

  if (exclude_date < req.start_date || exclude_date > req.end_date) {
    return NextResponse.json({ error: "exclude_date is outside the request's range" }, { status: 400 });
  }
  // Only full-day types are eligible — blocked_hours is a single-date window
  // and gets cancelled entirely via the existing /cancel endpoint.
  if (req.type === "blocked_hours") {
    return NextResponse.json({ error: "Use /cancel for blocked hours" }, { status: 400 });
  }

  // Four cases based on where exclude_date sits:
  if (req.start_date === req.end_date && req.start_date === exclude_date) {
    // Whole request is just this one day — delete it.
    await supabaseAdmin.from("time_off_requests").delete().eq("id", request_id);
  } else if (exclude_date === req.start_date) {
    // Trim the start.
    await supabaseAdmin
      .from("time_off_requests")
      .update({ start_date: addDays(req.start_date, 1) })
      .eq("id", request_id);
  } else if (exclude_date === req.end_date) {
    // Trim the end.
    await supabaseAdmin
      .from("time_off_requests")
      .update({ end_date: addDays(req.end_date, -1) })
      .eq("id", request_id);
  } else {
    // Middle date — shrink the existing range to end the day before, then
    // insert a new approved request for the days after.
    const newAfterStart = addDays(exclude_date, 1);
    const originalEnd = req.end_date;
    await supabaseAdmin
      .from("time_off_requests")
      .update({ end_date: addDays(exclude_date, -1) })
      .eq("id", request_id);
    await supabaseAdmin.from("time_off_requests").insert({
      barber_id: req.barber_id,
      shop_id: req.shop_id,
      type: req.type,
      start_date: newAfterStart,
      end_date: originalEnd,
      start_time: null,
      end_time: null,
      reason: req.reason,
      status: "approved",
      decided_by: user.id,
      decided_at: new Date().toISOString(),
    });
  }

  // Notify barber: in-app + email. Use prettyDate for consistency with the
  // approve/deny/cancel routes (which all format dates the same way).
  const niceDate = prettyDate(exclude_date);

  if (barber?.user_id) {
    await supabaseAdmin.from("notifications").insert({
      user_id: barber.user_id,
      title: "Time-Off Modified",
      message: `Your ${TYPE_LABELS[req.type]} no longer covers ${niceDate}. The shop owner removed that day from your approved request.`,
      type: "system",
      is_read: false,
    });
  }

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
          decision: "modified",
          requestType: TYPE_LABELS[req.type],
          dateRange: niceDate,
          timeRange: "",
        },
      }),
    }).catch(() => null);
  }

  return NextResponse.json({ ok: true });
}
