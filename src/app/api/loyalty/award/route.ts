import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { awardLoyaltyForAppointment } from "@/lib/completion-server";

// Awards loyalty points for a completed appointment. Idempotent via the
// appointments.loyalty_awarded flag. Called fire-and-forget when an
// appointment transitions to "completed". Silently no-ops (returns ok) when
// the shop is off-plan, loyalty is disabled, or no matching client exists.
//
// The actual award math lives in lib/completion-server (awardLoyaltyForAppointment)
// so this route and the Stripe webhook (paying a checkout link → completed) award
// points identically. This route only adds the caller authorization on top.
export async function POST(request: NextRequest) {
  const token = request.headers.get("Authorization")?.replace("Bearer ", "");
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(token);
  if (authErr || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { appointment_id } = await request.json() as { appointment_id: string };
  if (!appointment_id) return NextResponse.json({ error: "Missing appointment_id" }, { status: 400 });

  const { data: appt } = await supabaseAdmin
    .from("appointments").select("id, shop_id").eq("id", appointment_id).maybeSingle();
  if (!appt) return NextResponse.json({ error: "Appointment not found" }, { status: 404 });

  const { data: shop } = await supabaseAdmin
    .from("shops").select("id, owner_id").eq("id", appt.shop_id).maybeSingle();
  if (!shop) return NextResponse.json({ error: "Shop not found" }, { status: 404 });

  // Authorize: owner OR an active barber with manage_appointments (mirrors capture-appointment).
  let allowed = shop.owner_id === user.id;
  if (!allowed) {
    const { data: barber } = await supabaseAdmin
      .from("barbers").select("is_active, permissions").eq("shop_id", appt.shop_id).eq("user_id", user.id).maybeSingle();
    const perms = barber?.permissions as { manage_appointments?: boolean } | null;
    allowed = !!barber?.is_active && perms?.manage_appointments === true;
  }
  if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const result = await awardLoyaltyForAppointment(appointment_id);
  return NextResponse.json(result);
}
