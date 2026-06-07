import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { sendSmsBestEffort } from "@/lib/twilio";

/**
 * Fire-and-forget staff alerts for a NEW booking — the pieces the booking
 * flows didn't already cover:
 *   · in-app notification for the assigned BARBER (the owner already gets one
 *     created by the booking path; emails to owner+barber are also already sent)
 *   · SMS to the owner and the assigned barber
 *
 * The barber's in-app notification is what makes the live portal pop-up + sound
 * fire for them (NotificationListener subscribes to the notifications table).
 *
 * Body: { appointment_id }
 * Auth: none — only called server-to-server / from our own booking pages.
 */
export async function POST(request: NextRequest) {
  try {
    const { appointment_id } = await request.json() as { appointment_id?: string };
    if (!appointment_id) return NextResponse.json({ error: "Missing appointment_id" }, { status: 400 });

    const { data: appt } = await supabaseAdmin
      .from("appointments")
      .select("id, shop_id, barber_id, client_name, date, time_slot, payment_status, services(name)")
      .eq("id", appointment_id)
      .maybeSingle();
    if (!appt) return NextResponse.json({ error: "Appointment not found" }, { status: 404 });

    const { data: shop } = await supabaseAdmin
      .from("shops").select("id, name, phone, owner_id").eq("id", appt.shop_id).maybeSingle();
    if (!shop) return NextResponse.json({ error: "Shop not found" }, { status: 404 });

    const serviceName = Array.isArray(appt.services)
      ? (appt.services[0]?.name ?? "a service")
      : ((appt.services as { name?: string } | null)?.name ?? "a service");
    const friendly = new Date(`${appt.date}T00:00:00`).toLocaleDateString("en-CA", { month: "long", day: "numeric" });

    // Unpaid/null = a pay-in-person booking that still needs the owner/barber to Approve.
    const needsApproval = !appt.payment_status || appt.payment_status === "unpaid";
    const title = needsApproval ? "New booking — needs approval" : "New booking";
    const message = `${appt.client_name} — ${serviceName} on ${friendly} at ${appt.time_slot}${needsApproval ? " · tap to approve" : ""}`;

    // Resolve barber's linked user (for the in-app notif) + phone (for SMS).
    let barberUserId: string | null = null;
    let barberPhone: string | null = null;
    if (appt.barber_id) {
      const { data: b } = await supabaseAdmin.from("barbers").select("user_id").eq("id", appt.barber_id).maybeSingle();
      barberUserId = b?.user_id ?? null;
      if (barberUserId) {
        const { data: bu } = await supabaseAdmin.from("users").select("phone").eq("id", barberUserId).maybeSingle();
        barberPhone = bu?.phone ?? null;
      }
    }

    // Owner phone: prefer the owner's user phone, fall back to the shop phone.
    let ownerPhone: string | null = shop.phone ?? null;
    if (shop.owner_id) {
      const { data: ou } = await supabaseAdmin.from("users").select("phone").eq("id", shop.owner_id).maybeSingle();
      if (ou?.phone) ownerPhone = ou.phone;
    }

    // Barber in-app notification (owner's is created by the booking path). Skip
    // if the barber IS the owner (owner-as-barber) to avoid a duplicate.
    if (barberUserId && barberUserId !== shop.owner_id) {
      await supabaseAdmin.from("notifications").insert({
        user_id: barberUserId, title, message, type: "booking", is_read: false,
      }).then(null, () => null);
    }

    // SMS — best-effort, never throws.
    await sendSmsBestEffort(ownerPhone, message, shop.name);
    if (barberPhone && barberPhone !== ownerPhone) {
      await sendSmsBestEffort(barberPhone, message, shop.name);
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Server error" }, { status: 500 });
  }
}
