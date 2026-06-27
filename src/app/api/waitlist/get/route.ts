import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

/**
 * Fetch one smart-waitlist row for the assign sheet. The appointment_waitlist
 * RLS is owner-only, so a barber can't read it client-side — this returns the
 * row (service-role) after verifying the caller owns the shop OR is an active
 * barber of it. No customer PII beyond what the assign UI needs.
 */
export async function POST(request: NextRequest) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { data: { user } } = await supabaseAdmin.auth.getUser(token);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await request.json() as { id?: string };
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const { data: wl } = await supabaseAdmin
    .from("appointment_waitlist")
    .select("id, shop_id, barber_id, service_id, client_name, desired_date, status")
    .eq("id", id).maybeSingle();
  if (!wl) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { data: shop } = await supabaseAdmin.from("shops").select("owner_id").eq("id", wl.shop_id).maybeSingle();
  let allowed = shop?.owner_id === user.id;
  if (!allowed) {
    const { data: b } = await supabaseAdmin
      .from("barbers").select("id").eq("shop_id", wl.shop_id).eq("user_id", user.id).eq("is_active", true).maybeSingle();
    allowed = !!b;
  }
  if (!allowed) return NextResponse.json({ error: "Not allowed" }, { status: 403 });

  return NextResponse.json({ request: wl });
}
