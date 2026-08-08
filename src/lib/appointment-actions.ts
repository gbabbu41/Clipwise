import type { SupabaseClient } from "@supabase/supabase-js";
import type { AppointmentWithDetails, Shop } from "@/lib/database.types";
import { prettyDate } from "@/lib/utils";

/**
 * Shared appointment-action side effects (emails / SMS / loyalty / waitlist).
 *
 * The Appointments page has the canonical inline implementation; the Calendar
 * detail card calls these so completing / approving / rejecting from either
 * surface behaves identically. Keeping the notification + loyalty logic here
 * means a fix in one place fixes both.
 */

const origin = () => (typeof window !== "undefined" ? window.location.origin : "");

/** Customer "your booking is confirmed" email + SMS — fired when a pending
 *  booking is approved (pending → confirmed). Fire-and-forget. */
export function sendApprovalNotifications(appt: AppointmentWithDetails, shop: Shop, accessToken?: string | null) {
  const id = appt.id;
  if (appt.client_email) {
    fetch("/api/send-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "booking_confirmation",
        data: {
          clientName: appt.client_name,
          clientEmail: appt.client_email,
          shopId: shop.id,
          shopName: shop.name,
          shopEmail: shop.email ?? "",
          shopSlug: shop.slug,
          barberName: (appt.barbers as { name: string } | null)?.name ?? "Your barber",
          serviceName: (appt.services as { name: string } | null)?.name ?? "Your service",
          date: appt.date,
          time: appt.time_slot,
          total: `$${Number(appt.total_amount ?? 0).toFixed(2)}`,
          paymentNote: "Pay in person at the shop",
          bookingId: id.slice(0, 8).toUpperCase(),
          appointmentId: id,
        },
      }),
    }).catch(() => null);
  }
  if (appt.client_phone) {
    fetch("/api/twilio/send-sms", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) },
      body: JSON.stringify({
        to: appt.client_phone,
        shop_id: shop.id,
        shopName: shop.name,
        body: `Good news! Your appointment at ${shop.name} on ${prettyDate(appt.date)} at ${appt.time_slot} is confirmed. Booking #${id.slice(0, 8).toUpperCase()}.${origin() ? ` Manage: ${origin()}/my-booking/${id}` : ""}`,
      }),
    }).catch(() => null);
  }
}

/** Side effects when an appointment is marked completed: bump client stats,
 *  award loyalty (plan-gated + idempotent server-side), send the review email.
 *  Mirrors the Appointments page so completing from the Calendar matches. */
export async function runCompletionEffects(
  supabase: SupabaseClient,
  appt: AppointmentWithDetails,
  shop: Shop,
  accessToken: string | null,
) {
  if (appt.client_email || appt.client_phone) {
    const matchField = appt.client_email ? "email" : "phone";
    const matchVal = (appt.client_email || appt.client_phone) as string;
    const { data: clientRow } = await supabase
      .from("clients")
      .select("id, total_visits, total_spent")
      .eq("shop_id", shop.id)
      .eq(matchField, matchVal)
      .maybeSingle();
    if (clientRow) {
      await supabase.from("clients").update({
        total_visits: (clientRow.total_visits ?? 0) + 1,
        total_spent: (clientRow.total_spent ?? 0) + (appt.total_amount ?? 0),
        last_visit: appt.date,
      }).eq("id", clientRow.id);
    }
  }
  if (accessToken) {
    fetch("/api/loyalty/award", {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ appointment_id: appt.id }),
    }).catch(() => null);
  }
  if (appt.client_email) {
    fetch("/api/send-email", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) },
      body: JSON.stringify({
        type: "review_request",
        data: {
          clientName: appt.client_name,
          clientEmail: appt.client_email,
          shopName: shop.name,
          shopEmail: shop.email ?? "",
          barberName: (appt.barbers as { name: string } | null)?.name ?? "Your barber",
          serviceName: (appt.services as { name: string } | null)?.name ?? "Your service",
          reviewUrl: `${origin()}/book/${shop.slug}/review?booking=${appt.id}`,
          appointmentId: appt.id,
          googlePlaceId: shop.google_place_id ?? "",
        },
      }),
    }).catch(() => null);
  }
}

/** Notify the assigned barber a slot freed + ping the waitlist. Used on
 *  reject / cancel / no-show. Fire-and-forget. */
export function notifyFreedSlot(appt: AppointmentWithDetails, shop: Shop, statusLabel: string) {
  fetch("/api/appointments/notify-cancellation", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    // notifyCustomer: the SHOP freed this slot (reject/cancel), so text the
    // customer. The route ignores it for no-show, so it's safe to always send.
    body: JSON.stringify({ appointment_id: appt.id, statusLabel, notifyCustomer: true }),
  }).catch(() => null);
  fetch("/api/waitlist/slot-opened", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ shop_id: shop.id, date: appt.date, barber_id: appt.barber_id }),
  }).catch(() => null);
}

/** Customer "we missed you — book again" email, fired when an appointment is
 *  marked no-show. Fire-and-forget. Kept here so every surface (calendar, barber
 *  portal, appointments page) sends the same follow-up. */
export function sendNoShowFollowup(appt: AppointmentWithDetails, shop: Shop) {
  if (!appt.client_email) return;
  fetch("/api/send-email", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      type: "no_show_followup",
      data: {
        clientName: appt.client_name,
        clientEmail: appt.client_email,
        shopId: shop.id,
        shopName: shop.name,
        shopEmail: shop.email ?? "",
        bookingUrl: `${origin()}/book/${shop.slug}`,
      },
    }),
  }).catch(() => null);
}

/** Customer "appointment rejected" email. Fire-and-forget. */
export function sendRejectionEmail(appt: AppointmentWithDetails, shop: Shop, reason: string) {
  if (!appt.client_email) return;
  fetch("/api/send-email", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      type: "appointment_rejected",
      data: {
        shopId: shop.id,
        clientName: appt.client_name,
        clientEmail: appt.client_email,
        shopName: shop.name,
        shopEmail: shop.email ?? "",
        shopSlug: shop.slug,
        serviceName: (appt.services as { name: string } | null)?.name ?? "Your service",
        date: appt.date,
        time: appt.time_slot,
        reason: reason || "",
      },
    }),
  }).catch(() => null);
}
