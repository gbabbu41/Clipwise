import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

export async function GET(request: NextRequest) {
  const token = request.headers.get("Authorization")?.replace("Bearer ", "");
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await supabaseAdmin
    .from("users")
    .select("*")
    .eq("id", user.id)
    .single();

  let shop = null;
  let shops: typeof shop[] = [];

  if (profile?.role === "shop_owner" || profile?.role === "super_admin") {
    const { data } = await supabaseAdmin
      .from("shops")
      .select("*")
      .eq("owner_id", user.id)
      .order("created_at", { ascending: false });
    shops = data ?? [];
    shop = shops[0] ?? null;
  } else if (profile?.role === "barber") {
    // Barbers belong to a shop via the barbers table (user_id FK)
    const { data: barberRecord } = await supabaseAdmin
      .from("barbers")
      .select("shop_id")
      .eq("user_id", user.id)
      .limit(1)
      .maybeSingle();
    if (barberRecord?.shop_id) {
      const { data } = await supabaseAdmin
        .from("shops")
        .select("*")
        .eq("id", barberRecord.shop_id)
        .single();
      shop = data;
    }
  }

  return NextResponse.json({ profile, shop, shops });
}
