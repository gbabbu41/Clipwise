import { supabaseAdmin } from "@/lib/supabase-admin";
import { effectivePlan, planHasFeature } from "@/lib/validation";
import { ensurePlansHydrated } from "@/lib/plans-server";
import { sendAppEmail } from "@/lib/emailer";
import { logLoyaltyFailure } from "@/lib/loyalty-redeem";
import { findAppointmentClient } from "@/lib/appointment-client";

// Server-side completion effects — the same side-effects a manual "Complete"
// runs client-side (loyalty award, client-stat bump, review-request email), but
// runnable from a server path with no user token (Stripe webhook, finalize
// routes). Keeping the loyalty math here means the /api/loyalty/award route and
// the webhook award points the exact same way — one source of truth.

const DEFAULT_PER_VISIT = 10;
const DEFAULT_PER_DOLLAR = 1;

type AwardResult = { ok: boolean; points?: number; loyalty_points?: number; skipped?: string };

/** Award loyalty points for a completed appointment, idempotent via the
 *  appointments.loyalty_awarded flag. Returns a small status object; never
 *  throws. Callable with service-role privileges (no auth check here — callers
 *  that face the public must authorize first). */
export async function awardLoyaltyForAppointment(appointmentId: string): Promise<AwardResult> {
  const { data: appt } = await supabaseAdmin
    .from("appointments")
    .select("id, shop_id, client_id, client_email, client_phone, total_amount, loyalty_awarded, status, payment_status")
    .eq("id", appointmentId).maybeSingle();
  if (!appt) return { ok: false, skipped: "not_found" };
  if (appt.loyalty_awarded) return { ok: true, skipped: "already" };
  if (appt.status !== "completed") return { ok: false, skipped: "not_completed" };
  // A refunded visit earns nothing (phase73 takes back points earned before a refund).
  if (appt.payment_status === "refunded") return { ok: true, skipped: "refunded" };

  const { data: shop } = await supabaseAdmin
    .from("shops").select("id, subscription_plan, subscription_status, booking_settings")
    .eq("id", appt.shop_id).maybeSingle();
  if (!shop) return { ok: false, skipped: "no_shop" };

  // Plan gate — loyalty is a paid feature (admin-editable plans table).
  await ensurePlansHydrated();
  const plan = effectivePlan(shop.subscription_plan, shop.subscription_status);
  if (!planHasFeature(plan, "loyalty")) return { ok: true, skipped: "plan" };

  const ls = (shop.booking_settings as { loyalty?: { enabled?: boolean; points_per_visit?: number; points_per_dollar?: number } } | null)?.loyalty;
  if (ls?.enabled === false) return { ok: true, skipped: "disabled" };
  const perVisit = ls?.points_per_visit ?? DEFAULT_PER_VISIT;
  const perDollar = ls?.points_per_dollar ?? DEFAULT_PER_DOLLAR;
  const points = Math.round(perVisit + perDollar * (appt.total_amount ?? 0));

  // Find the client first (saved link → email → phone) so a booking with no
  // matching client is left unclaimed rather than marked "awarded" with nothing given.
  if (points <= 0) return { ok: true, points: 0 };
  const client = await findAppointmentClient<{ id: string }>(supabaseAdmin, shop.id, appt, "id");
  if (!client) return { ok: true, points: 0, skipped: "no_client" };

  // Atomically claim the award so a double-fire can't double-credit.
  const { data: claimed } = await supabaseAdmin.from("appointments")
    .update({ loyalty_awarded: true })
    .eq("id", appt.id).eq("loyalty_awarded", false)
    .select("id");
  if (!claimed || claimed.length === 0) return { ok: true, skipped: "already" };

  // Balance + ledger row in one locked step (phase68), tagged with the booking so
  // it can only ever be earned once. On failure, release the claim so a retry can
  // award it, and log it — points never silently go missing.
  const ids = { shopId: shop.id, clientId: client.id, appointmentId: appt.id };
  const { data, error } = await supabaseAdmin.rpc("loyalty_adjust", {
    p_shop_id: shop.id, p_client_id: client.id, p_delta: points, p_action: "earned", p_appointment_id: appt.id,
  }).then(r => r, (e: unknown) => ({ data: null, error: e }));
  if (error) {
    await supabaseAdmin.from("appointments").update({ loyalty_awarded: false }).eq("id", appt.id).then(null, () => null);
    await logLoyaltyFailure("awardLoyaltyForAppointment", ids, error);
    return { ok: false, skipped: "save_failed" };
  }
  const row = (Array.isArray(data) ? data[0] : data) as { applied?: number; balance?: number } | null;
  return { ok: true, points: Number(row?.applied ?? 0), loyalty_points: Number(row?.balance ?? 0) };
}

/** Full server-side "appointment completed" side-effects: loyalty + client
 *  stats + review-request email. Mirrors the client-side runCompletionEffects so
 *  a visit finished by paying a checkout link earns the same points, stat bump,
 *  and review nudge as one finished by tapping Complete. Never throws. */
export async function runServerCompletionEffects(opts: { appointmentId: string; baseUrl: string }): Promise<void> {
  const { appointmentId } = opts;
  const baseUrl = (process.env.NEXT_PUBLIC_APP_URL || "https://clipwise.ca").replace(/\/+$/, "");
  await awardLoyaltyForAppointment(appointmentId).catch(() => null);

  const { data: appt, error: apptError } = await supabaseAdmin
    .from("appointments")
    .select("id, shop_id, client_id, client_name, client_email, client_phone, date, total_amount, review_request_sent_at, services(name), barbers(name)")
    .eq("id", appointmentId).maybeSingle();
  if (apptError || !appt) return;
  const { data: shop } = await supabaseAdmin
    .from("shops").select("id, name, email, slug, google_place_id").eq("id", appt.shop_id).maybeSingle();
  if (!shop) return;

  // Bump client visit/spend stats — same client rule as the points (saved link →
  // email → phone), mirroring the browser path.
  const clientRow = await findAppointmentClient<{ id: string; total_visits: number | null; total_spent: number | null }>(
    supabaseAdmin, shop.id, appt, "id, total_visits, total_spent");
  if (clientRow) {
    await supabaseAdmin.from("clients").update({
      total_visits: (clientRow.total_visits ?? 0) + 1,
      total_spent: (clientRow.total_spent ?? 0) + (appt.total_amount ?? 0),
      last_visit: appt.date,
    }).eq("id", clientRow.id).then(null, () => null);
  }

  // Review-request email. Skip if one was already sent (the daily cron's
  // morning-after safety-net), and stamp review_request_sent_at so it doesn't
  // fire a second one.
  if (appt.client_email && !(appt as { review_request_sent_at?: string | null }).review_request_sent_at) {
    const svcName = Array.isArray(appt.services) ? (appt.services[0]?.name ?? "") : ((appt.services as { name?: string } | null)?.name ?? "");
    const barberName = Array.isArray(appt.barbers) ? (appt.barbers[0]?.name ?? "Your barber") : ((appt.barbers as { name?: string } | null)?.name ?? "Your barber");
    const sent = await sendAppEmail("review_request", {
      clientName: appt.client_name ?? "",
      clientEmail: appt.client_email,
      shopName: shop.name,
      shopEmail: shop.email ?? "",
      barberName,
      serviceName: svcName || "Your service",
      reviewUrl: `${baseUrl}/book/${shop.slug}/review?booking=${appt.id}`,
      appointmentId: appt.id,
      googlePlaceId: shop.google_place_id ?? "",
    }).catch(() => null);
    // Success means provider acceptance OR the sender's existing already-reviewed
    // suppression, never confirmed inbox delivery. Rejection must not mark sent.
    if (sent && "success" in sent && sent.success) {
      const recorded = await supabaseAdmin.from("appointments")
        .update({ review_request_sent_at: new Date().toISOString() }).eq("id", appt.id).then(null, () => null);
      if (!recorded || recorded.error) console.warn("[completion-review] Could not record handled review request");
    }
  }
}
