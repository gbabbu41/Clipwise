import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { insertNotifications } from "@/lib/notify-server";

// Notify the assigned barber that one of their appointments changed state
// (cancelled by the customer, rejected by the shop, or marked no-show). The
// barber's email is looked up server-side so it's never exposed to the client
// callers (booking page, my-bookings, dashboard). Fire-and-forget — callers
// don't block on it, and a missing barber/email is a silent no-op.
export async function POST(req: NextRequest) {
  const { appointment_id, statusLabel } = await req.json() as {
    appointment_id?: string;
    statusLabel?: string;
  };
  if (!appointment_id) return NextResponse.json({ ok: false, error: "Missing appointment_id" }, { status: 400 });

  const { data: appt } = await supabaseAdmin
    .from("appointments")
    .select("id, shop_id, barber_id, client_name, service_id, date, time_slot")
    .eq("id", appointment_id).maybeSingle();
  if (!appt || !appt.barber_id) return NextResponse.json({ ok: true, skipped: "no barber" });

  const [{ data: barber }, { data: shop }, { data: svc }] = await Promise.all([
    supabaseAdmin.from("barbers").select("name, email, user_id").eq("id", appt.barber_id).maybeSingle(),
    supabaseAdmin.from("shops").select("name, email").eq("id", appt.shop_id).maybeSingle(),
    appt.service_id
      ? supabaseAdmin.from("services").select("name").eq("id", appt.service_id).maybeSingle()
      : Promise.resolve({ data: null as { name: string } | null }),
  ]);

  // In-app pop-up/chime for the assigned barber — previously they only got an
  // email here, so a reject/no-show/customer-cancel never surfaced in their
  // portal (the owner side always did). "No-show" is a valid notification type;
  // everything else here maps to "cancellation".
  const isNoShow = /no.?show/i.test(statusLabel || "");
  if (barber?.user_id) {
    insertNotifications({
      user_id: barber.user_id,
      shop_id: appt.shop_id,
      title: isNoShow ? "Marked No-Show" : "Appointment Cancelled",
      message: `${appt.client_name}'s ${svc?.name ?? "appointment"} on ${appt.date} at ${appt.time_slot} was ${(statusLabel || "cancelled").toLowerCase()}.`,
      type: isNoShow ? "no-show" : "cancellation",
    });
  }

  if (!barber?.email) return NextResponse.json({ ok: true, skipped: "no barber email" });

  const base = req.headers.get("origin") || process.env.NEXT_PUBLIC_APP_URL || "https://clipwise.ca";
  await fetch(`${base}/api/send-email`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      type: "barber_appointment_change",
      data: {
        barberEmail: barber.email,
        barberName: barber.name,
        shopName: shop?.name ?? "",
        shopEmail: shop?.email ?? "",
        clientName: appt.client_name,
        serviceName: svc?.name ?? "Service",
        date: appt.date,
        time: appt.time_slot,
        statusLabel: statusLabel || "Cancelled",
      },
    }),
  }).catch(() => null);

  return NextResponse.json({ ok: true });
}
