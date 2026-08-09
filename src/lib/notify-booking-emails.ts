// Server-only — send the owner + assigned-barber "new booking" emails for an
// appointment, resolved from the DB with the service role. The public booking
// page CAN'T send these: it never loads the owner's / barber's email (those
// aren't exposed to an anonymous page), so its client-side attempt silently
// skipped both. Do it here instead, mirroring the online path.
//
// Recipients fall back to the account (users.email) when the shop/barber
// contact columns are blank (they usually are). Awaited + best-effort; the
// barber send is skipped when it's the owner's own address (owner-as-barber).
import { supabaseAdmin } from "@/lib/supabase-admin";
import { sendAppEmail } from "@/lib/emailer";

/**
 * The reliable email for a user account. Tries the public `users` mirror first,
 * then falls back to Supabase AUTH (the real login email) — the mirror column is
 * sometimes null for barber/owner accounts, which is why the alert emails were
 * resolving empty and getting skipped. Returns "" only when there's genuinely
 * no address anywhere.
 */
export async function resolveAccountEmail(userId: string | null | undefined): Promise<string> {
  if (!userId) return "";
  const { data: u } = await supabaseAdmin.from("users").select("email").eq("id", userId).maybeSingle();
  if (u?.email) return u.email;
  try {
    const { data: authU } = await supabaseAdmin.auth.admin.getUserById(userId);
    return authU?.user?.email ?? "";
  } catch { return ""; }
}

const maskEmail = (e: string) => (e ? e.replace(/^(.).*(@.*)$/, "$1***$2") : "");

export async function sendNewBookingStaffEmails(appointmentId: string): Promise<void> {
  try {
    const { data: appt } = await supabaseAdmin
      .from("appointments")
      .select("id, shop_id, barber_id, client_name, client_email, client_phone, date, time_slot, total_amount, tip_amount, services(name)")
      .eq("id", appointmentId).maybeSingle();
    if (!appt) return;

    const { data: shop } = await supabaseAdmin
      .from("shops").select("name, email, slug, owner_id").eq("id", appt.shop_id).maybeSingle();
    if (!shop) return;

    // Owner recipient: contact column → account (login/auth) email fallback.
    let ownerEmail = shop.email || "";
    if (!ownerEmail) ownerEmail = await resolveAccountEmail(shop.owner_id);

    // Barber recipient + name: contact column → account email fallback.
    let barberName = "Any Available";
    let barberEmail = "";
    if (appt.barber_id) {
      const { data: barber } = await supabaseAdmin
        .from("barbers").select("name, email, user_id").eq("id", appt.barber_id).maybeSingle();
      barberName = barber?.name || "Any Available";
      barberEmail = barber?.email || "";
      if (!barberEmail) barberEmail = await resolveAccountEmail(barber?.user_id);
    }

    console.log("[booking-email] in-person recipients:", JSON.stringify({
      appt: appt.id.slice(0, 8), barberId: appt.barber_id || null,
      owner: maskEmail(ownerEmail) || null, barber: maskEmail(barberEmail) || null,
    }));

    const serviceName = Array.isArray(appt.services)
      ? (appt.services[0]?.name ?? "Service")
      : ((appt.services as { name?: string } | null)?.name ?? "Service");

    const data: Record<string, string> = {
      clientName: appt.client_name ?? "A client",
      clientEmail: appt.client_email ?? "—",
      clientPhone: appt.client_phone ?? "—",
      shopId: appt.shop_id,
      shopName: shop.name ?? "",
      shopEmail: shop.email ?? "",
      shopSlug: shop.slug ?? "",
      barberName,
      serviceName,
      date: appt.date,
      time: appt.time_slot,
      total: `$${(Number(appt.total_amount ?? 0) + Number(appt.tip_amount ?? 0)).toFixed(2)}`,
      bookingId: appt.id.slice(0, 8).toUpperCase(),
      appointmentId: appt.id,
    };

    const jobs: Promise<void>[] = [];
    if (ownerEmail) {
      jobs.push(sendAppEmail("new_booking_owner", { ...data, ownerEmail })
        .then(r => { if ("error" in r) console.warn("[booking-email] new_booking_owner → not sent:", r.error); })
        .catch(e => console.warn("[booking-email] new_booking_owner threw:", e)));
    }
    // Don't double-email a solo owner-barber (same address).
    if (barberEmail && barberEmail !== ownerEmail) {
      jobs.push(sendAppEmail("new_booking_barber", { ...data, barberEmail, barberName })
        .then(r => { if ("error" in r) console.warn("[booking-email] new_booking_barber → not sent:", r.error); })
        .catch(e => console.warn("[booking-email] new_booking_barber threw:", e)));
    }
    await Promise.all(jobs);
  } catch (e) {
    console.warn("[booking-email] staff emails threw:", e);
  }
}

/**
 * Send the CUSTOMER their booking email for an in-person / portal booking.
 *
 * The online (Stripe) path emails the customer a confirmation, but the in-person
 * route never did — a staff-added (portal) booking sent the customer nothing, and
 * a self-booking got only an SMS (paid plans only). So on Starter (email-only) a
 * customer booked from the portal received nothing. This closes that gap: whenever
 * there's an email on file, confirm by email — server-side (service role), works
 * on every plan, for both staff-added and self-bookings.
 *
 * Confirmed → "Booking Confirmed"; still pending (needs approval) → "Request
 * received". Never fires for cancelled/completed/no-show. Best-effort.
 */
export async function sendCustomerBookingEmail(appointmentId: string): Promise<void> {
  try {
    const { data: appt } = await supabaseAdmin
      .from("appointments")
      .select("id, shop_id, barber_id, client_name, client_email, status, date, time_slot, total_amount, tip_amount, services(name)")
      .eq("id", appointmentId).maybeSingle();
    if (!appt || !appt.client_email) return;
    if (appt.status !== "confirmed" && appt.status !== "pending") return;

    const { data: shop } = await supabaseAdmin
      .from("shops").select("name, email, slug").eq("id", appt.shop_id).maybeSingle();
    if (!shop) return;

    let barberName = "Any Available";
    if (appt.barber_id) {
      const { data: barber } = await supabaseAdmin.from("barbers").select("name").eq("id", appt.barber_id).maybeSingle();
      barberName = barber?.name || "Any Available";
    }
    const serviceName = Array.isArray(appt.services)
      ? (appt.services[0]?.name ?? "Service")
      : ((appt.services as { name?: string } | null)?.name ?? "Service");

    const data: Record<string, string> = {
      clientName: appt.client_name ?? "there",
      clientEmail: appt.client_email,
      shopId: appt.shop_id,
      shopName: shop.name ?? "",
      shopEmail: shop.email ?? "",
      shopSlug: shop.slug ?? "",
      barberName,
      serviceName,
      date: appt.date,
      time: appt.time_slot,
      total: `$${(Number(appt.total_amount ?? 0) + Number(appt.tip_amount ?? 0)).toFixed(2)}`,
      bookingId: appt.id.slice(0, 8).toUpperCase(),
      appointmentId: appt.id,
    };

    const type = appt.status === "pending" ? "booking_request_received" : "booking_confirmation";
    const r = await sendAppEmail(type, data);
    if ("error" in r) console.warn(`[booking-email] ${type} → not sent:`, r.error);
  } catch (e) {
    console.warn("[booking-email] customer email threw:", e);
  }
}
