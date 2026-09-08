import { supabaseAdmin } from "@/lib/supabase-admin";
import { sendSmsBestEffort } from "@/lib/twilio";
import { prettyDateWithContext } from "@/lib/utils";
import { insertNotifications } from "@/lib/notify-server";

/**
 * New-booking staff alert — in-app notifications for the owner and/or the
 * assigned barber, plus SMS to both. Call this DIRECTLY from any booking path
 * (server-side).
 *
 * Why direct, not a fetch to /api/appointments/notify-staff: that self-hop built
 * its URL from the request's `Origin` header with an empty-string fallback, so
 * when a booking request had no Origin AND NEXT_PUBLIC_APP_URL was unset the
 * alert was silently skipped — leaving in-person bookings with NO owner
 * notification in the bell. A direct call has no such dependency.
 *
 * `notifyOwner` defaults true; pass false when the caller already created a
 * richer owner notification (e.g. the online path's "New Booking · card held").
 * Best-effort: never throws.
 */
export async function notifyNewBookingStaff(
  appointmentId: string,
  opts: { notifyOwner?: boolean } = {},
): Promise<void> {
  const notifyOwner = opts.notifyOwner !== false;
  try {
    const { data: appt } = await supabaseAdmin
      .from("appointments")
      .select("id, shop_id, barber_id, client_name, date, time_slot, status, payment_status, services(name)")
      .eq("id", appointmentId)
      .maybeSingle();
    if (!appt) return;

    const { data: shop } = await supabaseAdmin
      .from("shops").select("id, name, phone, owner_id").eq("id", appt.shop_id).maybeSingle();
    if (!shop) return;

    const serviceName = Array.isArray(appt.services)
      ? (appt.services[0]?.name ?? "a service")
      : ((appt.services as { name?: string } | null)?.name ?? "a service");
    const friendly = prettyDateWithContext(appt.date);

    // A booking needs approval only while still 'pending' (auto-confirm / online-
    // paid bookings are created 'confirmed'). Fall back to the payment heuristic
    // only if status is somehow missing.
    const needsApproval = appt.status
      ? appt.status === "pending"
      : (!appt.payment_status || appt.payment_status === "unpaid");
    const title = needsApproval ? "New booking — needs approval" : "New booking";
    const message = `${appt.client_name} — ${serviceName} on ${friendly} at ${appt.time_slot}${needsApproval ? " · tap to approve" : ""}`;

    // Assigned barber's linked user (for the in-app notif) + phone (for SMS).
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

    // In-app notifications (service role — the anon booking page can't insert).
    // Dedupe when the barber IS the owner; drop the owner when a richer owner
    // notification was already created (notifyOwner=false).
    const notifyUserIds = new Set<string>();
    if (notifyOwner && shop.owner_id) notifyUserIds.add(shop.owner_id);
    if (barberUserId) notifyUserIds.add(barberUserId);
    if (!notifyOwner && shop.owner_id) notifyUserIds.delete(shop.owner_id);
    if (notifyUserIds.size > 0) {
      await insertNotifications(Array.from(notifyUserIds).map(uid => ({
        user_id: uid, shop_id: appt.shop_id, title, message, type: "booking",
        entity_type: "appointment", entity_id: appointmentId,
      })));
    }

    // SMS — best-effort, never throws.
    await sendSmsBestEffort(ownerPhone, message, shop.name);
    if (barberPhone && barberPhone !== ownerPhone) {
      await sendSmsBestEffort(barberPhone, message, shop.name);
    }
  } catch { /* best-effort — a failed alert must never break the booking */ }
}
