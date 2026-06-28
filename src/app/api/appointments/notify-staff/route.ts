import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { sendSmsBestEffort } from "@/lib/twilio";
import { prettyDateWithContext } from "@/lib/utils";

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
    const { appointment_id, notify_owner = true } = await request.json() as { appointment_id?: string; notify_owner?: boolean };
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
    const friendly = prettyDateWithContext(appt.date);

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

    // In-app notifications for the owner AND the assigned barber. These are
    // created here (service-role) because the customer booking page is anonymous
    // — an anon insert into notifications fails RLS, so the owner's pop-up never
    // fired before. Dedupe when the barber IS the owner (owner-as-barber).
    // notify_owner=false when the caller already created a richer owner
    // notification (e.g. booking-finalize's "New Paid Booking · $X").
    const notifyUserIds = new Set<string>();
    if (notify_owner && shop.owner_id) notifyUserIds.add(shop.owner_id);
    if (barberUserId) notifyUserIds.add(barberUserId);
    if (notifyUserIds.size > 0) {
      // Entity-link each notification to the appointment so the bell/sheet can
      // render inline Approve/Decline buttons (phase16 columns). If those
      // columns don't exist yet, retry the plain insert so the notif still lands.
      const base = Array.from(notifyUserIds).map(uid => ({
        user_id: uid, title, message, type: "booking", is_read: false,
      }));
      const ins = await supabaseAdmin.from("notifications").insert(
        base.map(r => ({ ...r, entity_type: "appointment", entity_id: appointment_id })),
      );
      if (ins.error && /entity_(type|id)/.test(ins.error.message)) {
        await supabaseAdmin.from("notifications").insert(base).then(null, () => null);
      }
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
