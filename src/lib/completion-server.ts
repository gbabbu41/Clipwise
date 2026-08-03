import { supabaseAdmin } from "@/lib/supabase-admin";
import { effectivePlan, planHasFeature } from "@/lib/validation";
import { ensurePlansHydrated } from "@/lib/plans-server";

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
    .select("id, shop_id, client_email, client_phone, total_amount, loyalty_awarded, status")
    .eq("id", appointmentId).maybeSingle();
  if (!appt) return { ok: false, skipped: "not_found" };
  if (appt.loyalty_awarded) return { ok: true, skipped: "already" };
  if (appt.status !== "completed") return { ok: false, skipped: "not_completed" };

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

  // Atomically claim the award so a double-fire can't double-credit.
  const { data: claimed } = await supabaseAdmin.from("appointments")
    .update({ loyalty_awarded: true })
    .eq("id", appt.id).eq("loyalty_awarded", false)
    .select("id");
  if (!claimed || claimed.length === 0) return { ok: true, skipped: "already" };
  if (points <= 0) return { ok: true, points: 0 };

  // Find the matching client in this shop (email → phone).
  const email = (appt.client_email ?? "").trim();
  const phone = (appt.client_phone ?? "").trim();
  let client: { id: string; loyalty_points: number } | null = null;
  if (email) {
    const { data } = await supabaseAdmin.from("clients").select("id, loyalty_points").eq("shop_id", shop.id).ilike("email", email).maybeSingle();
    client = data;
  }
  if (!client && phone) {
    const { data } = await supabaseAdmin.from("clients").select("id, loyalty_points").eq("shop_id", shop.id).eq("phone", phone).maybeSingle();
    client = data;
  }
  if (!client) return { ok: true, points: 0, skipped: "no_client" };

  const newTotal = (client.loyalty_points ?? 0) + points;
  await supabaseAdmin.from("clients").update({ loyalty_points: newTotal }).eq("id", client.id);
  await supabaseAdmin.from("loyalty_rewards").insert({
    shop_id: shop.id, client_id: client.id, points, action: "earned",
  }).then(null, () => null);
  return { ok: true, points, loyalty_points: newTotal };
}

/** Full server-side "appointment completed" side-effects: loyalty + client
 *  stats + review-request email. Mirrors the client-side runCompletionEffects so
 *  a visit finished by paying a checkout link earns the same points, stat bump,
 *  and review nudge as one finished by tapping Complete. Never throws. */
export async function runServerCompletionEffects(opts: { appointmentId: string; baseUrl: string }): Promise<void> {
  const { appointmentId, baseUrl } = opts;
  await awardLoyaltyForAppointment(appointmentId).catch(() => null);

  const { data: appt } = await supabaseAdmin
    .from("appointments")
    .select("id, shop_id, client_name, client_email, client_phone, date, total_amount, services(name), barbers(name)")
    .eq("id", appointmentId).maybeSingle();
  if (!appt) return;
  const { data: shop } = await supabaseAdmin
    .from("shops").select("id, name, email, slug, google_place_id").eq("id", appt.shop_id).maybeSingle();
  if (!shop) return;

  // Bump client visit/spend stats (email → phone), mirroring the client path.
  if (appt.client_email || appt.client_phone) {
    const emailMatch = (appt.client_email ?? "").trim();
    const phoneMatch = (appt.client_phone ?? "").trim();
    // Match email case-INSENSITIVELY (ilike) — the SAME way awardLoyaltyForAppointment
    // finds the client. A case-sensitive .eq here meant a client whose stored email
    // differed only in case earned points but never got their visit/spend bumped,
    // skewing VIP/At-Risk tagging. Fall back to phone (exact) when there's no email.
    const { data: clientRow } = emailMatch
      ? await supabaseAdmin
          .from("clients")
          .select("id, total_visits, total_spent")
          .eq("shop_id", shop.id)
          .ilike("email", emailMatch)
          .maybeSingle()
      : await supabaseAdmin
          .from("clients")
          .select("id, total_visits, total_spent")
          .eq("shop_id", shop.id)
          .eq("phone", phoneMatch)
          .maybeSingle();
    if (clientRow) {
      await supabaseAdmin.from("clients").update({
        total_visits: (clientRow.total_visits ?? 0) + 1,
        total_spent: (clientRow.total_spent ?? 0) + (appt.total_amount ?? 0),
        last_visit: appt.date,
      }).eq("id", clientRow.id).then(null, () => null);
    }
  }

  // Review-request email.
  if (appt.client_email) {
    const svcName = Array.isArray(appt.services) ? (appt.services[0]?.name ?? "") : ((appt.services as { name?: string } | null)?.name ?? "");
    const barberName = Array.isArray(appt.barbers) ? (appt.barbers[0]?.name ?? "Your barber") : ((appt.barbers as { name?: string } | null)?.name ?? "Your barber");
    await fetch(`${baseUrl}/api/send-email`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "review_request",
        data: {
          clientName: appt.client_name,
          clientEmail: appt.client_email,
          shopName: shop.name,
          shopEmail: shop.email ?? "",
          barberName,
          serviceName: svcName || "Your service",
          reviewUrl: `${baseUrl}/book/${shop.slug}/review?booking=${appt.id}`,
          googlePlaceId: shop.google_place_id ?? "",
        },
      }),
    }).catch(() => null);
  }
}
