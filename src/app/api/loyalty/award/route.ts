import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { effectivePlan, planHasFeature } from "@/lib/validation";
import { ensurePlansHydrated } from "@/lib/plans-server";

// Awards loyalty points for a completed appointment. Idempotent via the
// appointments.loyalty_awarded flag. Called fire-and-forget when an
// appointment transitions to "completed". Silently no-ops (returns ok) when
// the shop is off-plan, loyalty is disabled, or no matching client exists.
const DEFAULT_PER_VISIT = 10;
const DEFAULT_PER_DOLLAR = 1;

export async function POST(request: NextRequest) {
  const token = request.headers.get("Authorization")?.replace("Bearer ", "");
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(token);
  if (authErr || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { appointment_id } = await request.json() as { appointment_id: string };
  if (!appointment_id) return NextResponse.json({ error: "Missing appointment_id" }, { status: 400 });

  const { data: appt } = await supabaseAdmin
    .from("appointments")
    .select("id, shop_id, client_email, client_phone, total_amount, loyalty_awarded, status")
    .eq("id", appointment_id).maybeSingle();
  if (!appt) return NextResponse.json({ error: "Appointment not found" }, { status: 404 });
  if (appt.loyalty_awarded) return NextResponse.json({ ok: true, already: true });
  if (appt.status !== "completed") return NextResponse.json({ ok: false, skipped: "not_completed" });

  const { data: shop } = await supabaseAdmin
    .from("shops").select("id, owner_id, subscription_plan, subscription_status, booking_settings")
    .eq("id", appt.shop_id).maybeSingle();
  if (!shop) return NextResponse.json({ error: "Shop not found" }, { status: 404 });

  // Authorize: owner OR an active barber with manage_appointments (mirrors capture-appointment)
  let allowed = shop.owner_id === user.id;
  if (!allowed) {
    const { data: barber } = await supabaseAdmin
      .from("barbers").select("is_active, permissions").eq("shop_id", appt.shop_id).eq("user_id", user.id).maybeSingle();
    const perms = barber?.permissions as { manage_appointments?: boolean } | null;
    allowed = !!barber?.is_active && perms?.manage_appointments === true;
  }
  if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // Plan gate — loyalty is a paid feature (per the admin-editable plans table)
  await ensurePlansHydrated();
  const plan = effectivePlan(shop.subscription_plan, shop.subscription_status);
  if (!planHasFeature(plan, "loyalty")) return NextResponse.json({ ok: true, skipped: "plan" });

  const ls = (shop.booking_settings as { loyalty?: { enabled?: boolean; points_per_visit?: number; points_per_dollar?: number } } | null)?.loyalty;
  if (ls?.enabled === false) return NextResponse.json({ ok: true, skipped: "disabled" });
  const perVisit = ls?.points_per_visit ?? DEFAULT_PER_VISIT;
  const perDollar = ls?.points_per_dollar ?? DEFAULT_PER_DOLLAR;
  const points = Math.round(perVisit + perDollar * (appt.total_amount ?? 0));

  // Atomically claim the award so a double-fire can't double-credit.
  // .select() returns the updated rows; an empty array means another call
  // already claimed it (loyalty_awarded was no longer false).
  const { data: claimed } = await supabaseAdmin.from("appointments")
    .update({ loyalty_awarded: true })
    .eq("id", appt.id).eq("loyalty_awarded", false)
    .select("id");
  if (!claimed || claimed.length === 0) return NextResponse.json({ ok: true, already: true });

  if (points <= 0) return NextResponse.json({ ok: true, points: 0 });

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
  if (!client) return NextResponse.json({ ok: true, points: 0, note: "no_client" });

  const newTotal = (client.loyalty_points ?? 0) + points;
  await supabaseAdmin.from("clients").update({ loyalty_points: newTotal }).eq("id", client.id);
  await supabaseAdmin.from("loyalty_rewards").insert({
    shop_id: shop.id, client_id: client.id, points, action: "earned",
  }).then(null, () => null);

  return NextResponse.json({ ok: true, points, loyalty_points: newTotal });
}
