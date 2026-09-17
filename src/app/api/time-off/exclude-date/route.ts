import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { insertNotifications } from "@/lib/notify-server";
import { prettyDate } from "@/lib/utils";
import { sendAppEmail } from "@/lib/emailer";
import { validDate, validId } from "@/lib/schedule-access";

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

export async function POST(request: NextRequest) {
  const token = request.headers.get("Authorization")?.replace("Bearer ", "");
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(token);
  if (authErr || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null);
  if (!validId(body?.request_id) || !validDate(body?.exclude_date)) {
    return NextResponse.json({ error: "A valid request_id and exclude_date are required" }, { status: 400 });
  }
  const { request_id, exclude_date } = body;

  const { data: req, error: readError } = await supabaseAdmin
    .from("time_off_requests")
    .select("*, barbers(id, name, email, user_id), shops(id, name, owner_id, email)")
    .eq("id", request_id)
    .maybeSingle();
  if (readError) return NextResponse.json({ error: "Unable to load time off" }, { status: 503 });
  if (!req) return NextResponse.json({ error: "Request not found" }, { status: 404 });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const shop = (req as any).shops as { id: string; name: string; owner_id: string; email?: string | null } | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const barber = (req as any).barbers as { id: string; name: string; email?: string | null; user_id?: string | null } | null;
  if (!shop || shop.owner_id !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (req.status !== "approved") return NextResponse.json({ error: "Only approved time off can be modified" }, { status: 400 });
  if (exclude_date < req.start_date || exclude_date > req.end_date) {
    return NextResponse.json({ error: "exclude_date is outside the request's range" }, { status: 400 });
  }
  // Only full-day types are eligible — blocked_hours is a single-date window
  // and gets cancelled entirely via the existing /cancel endpoint.
  if (req.type === "blocked_hours") {
    return NextResponse.json({ error: "Use /cancel for blocked hours" }, { status: 400 });
  }

  // Database locks recheck ownership/status and make every split atomic.
  const { error: writeError } = await supabaseAdmin.rpc("exclude_time_off_date", {
    p_actor_id: user.id, p_request_id: request_id, p_exclude_date: exclude_date,
  });
  if (writeError) return NextResponse.json({ error: writeError.code === "PGRST202"
    ? "Time-off changes are temporarily unavailable until the database update is applied. Existing time off is unchanged."
    : "Unable to change time off. Reload and try again." }, { status: writeError.code === "42501" ? 403 : 503 });

  // Notify barber: in-app + email. Use prettyDate for consistency with the
  // approve/deny/cancel routes (which all format dates the same way).
  const niceDate = prettyDate(exclude_date);

  if (barber?.user_id) {
    await insertNotifications({
      user_id: barber.user_id,
      shop_id: req.shop_id,
      title: "Time-Off Modified",
      message: `Your ${TYPE_LABELS[req.type]} no longer covers ${niceDate}. The shop owner removed that day from your approved request.`,
      type: "system",
    });
  }

  if (barber?.email) {
    await sendAppEmail("time_off_decision", {
          barberEmail: barber.email,
          barberName: barber.name,
          shopName: shop.name,
          shopEmail: shop.email ?? "",
          decision: "modified",
          requestType: TYPE_LABELS[req.type],
          dateRange: niceDate,
          timeRange: "",
    }).catch(() => null);
  }

  return NextResponse.json({ ok: true });
}
