import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

/**
 * Set a barber's commission percent — owner-only, server-verified. Previously the
 * Staff page updated the barbers row directly from the client (RLS-gated). This
 * moves it behind an explicit ownership check + a hard 0–100 clamp so commission
 * (which drives real payouts) can only ever be changed by the shop's owner.
 *
 * Body: { barber_id, commission_percent }
 */
export async function POST(request: NextRequest) {
  const token = request.headers.get("Authorization")?.replace("Bearer ", "");
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
  if (authError || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { barber_id, commission_percent } = await request.json() as {
    barber_id?: string; commission_percent?: number;
  };
  if (!barber_id) return NextResponse.json({ error: "Missing barber_id" }, { status: 400 });

  // Commission is a percentage — never trust the client; clamp 0–100.
  const pct = Math.min(100, Math.max(0, Math.round(Number(commission_percent) || 0)));

  // IDOR guard: the barber must belong to a shop THIS user owns.
  const { data: barber } = await supabaseAdmin
    .from("barbers").select("id, shop_id").eq("id", barber_id).maybeSingle();
  if (!barber) return NextResponse.json({ error: "Barber not found" }, { status: 404 });
  const { data: shop } = await supabaseAdmin
    .from("shops").select("owner_id").eq("id", barber.shop_id).maybeSingle();
  if (!shop || shop.owner_id !== user.id) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { error } = await supabaseAdmin
    .from("barbers").update({ commission_percent: pct }).eq("id", barber_id);
  if (error) return NextResponse.json({ error: "Couldn't update commission" }, { status: 500 });

  return NextResponse.json({ ok: true, commission_percent: pct });
}
