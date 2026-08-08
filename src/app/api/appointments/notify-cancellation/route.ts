import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { insertNotifications } from "@/lib/notify-server";
import { sendSmsBestEffort } from "@/lib/twilio";
import { effectivePlan, isPaidPlan } from "@/lib/validation";

// Notify the assigned barber that one of their appointments changed state
// (cancelled by the customer, rejected by the shop, or marked no-show). The
// barber's email is looked up server-side so it's never exposed to the client
// callers (booking page, my-bookings, dashboard). Fire-and-forget — callers
// don't block on it, and a missing barber/email is a silent no-op.
export async function POST(req: NextRequest) {
  const { appointment_id, statusLabel, notifyCustomer } = await req.json() as {
    appointment_id?: string;
    statusLabel?: string;
    notifyCustomer?: boolean;   // true when the SHOP cancelled — text the customer
  };
  if (!appointment_id) return NextResponse.json({ ok: false, error: "Missing appointment_id" }, { status: 400 });

  const { data: appt } = await supabaseAdmin
    .from("appointments")
    .select("id, shop_id, barber_id, client_name, client_phone, service_id, date, time_slot")
    .eq("id", appointment_id).maybeSingle();
  if (!appt) return NextResponse.json({ ok: false, error: "Appointment not found" }, { status: 404 });

  const [{ data: barber }, { data: shop }, { data: svc }] = await Promise.all([
    appt.barber_id
      ? supabaseAdmin.from("barbers").select("name, email, user_id").eq("id", appt.barber_id).maybeSingle()
      : Promise.resolve({ data: null as { name: string; email: string | null; user_id: string | null } | null }),
    supabaseAdmin.from("shops").select("name, email, subscription_plan, subscription_status").eq("id", appt.shop_id).maybeSingle(),
    appt.service_id
      ? supabaseAdmin.from("services").select("name").eq("id", appt.service_id).maybeSingle()
      : Promise.resolve({ data: null as { name: string } | null }),
  ]);

  const isNoShow = /no.?show/i.test(statusLabel || "");

  // Text the CUSTOMER when the SHOP cancelled (notifyCustomer) — a real
  // cancellation they didn't initiate. Skipped for no-show and for customer
  // self-cancels (those don't pass notifyCustomer). Short + GSM-7 (one segment);
  // awaited so a serverless freeze can't drop it. This was the missing text.
  if (notifyCustomer && !isNoShow && appt.client_phone && isPaidPlan(effectivePlan(shop?.subscription_plan, shop?.subscription_status))) {
    await sendSmsBestEffort(
      appt.client_phone,
      `Your appointment on ${appt.date} at ${appt.time_slot} has been cancelled. Please contact us to rebook.`,
      shop?.name,
    );
  }

  // In-app pop-up/chime for the assigned barber — previously they only got an
  // email here, so a reject/no-show/customer-cancel never surfaced in their
  // portal (the owner side always did). "No-show" is a valid notification type;
  // everything else here maps to "cancellation".
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
