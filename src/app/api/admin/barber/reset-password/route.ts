import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

export async function POST(request: NextRequest) {
  const token = request.headers.get("Authorization")?.replace("Bearer ", "");
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
  if (authError || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: callerProfile } = await supabaseAdmin.from("users").select("role").eq("id", user.id).single();
  if (!callerProfile || !["shop_owner", "super_admin"].includes(callerProfile.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { barber_id } = await request.json();

  const { data: barber } = await supabaseAdmin
    .from("barbers")
    .select("user_id, name, email, shop_id")
    .eq("id", barber_id)
    .single();

  if (!barber) return NextResponse.json({ error: "Barber not found" }, { status: 404 });

  // Verify caller owns this shop
  if (callerProfile.role === "shop_owner") {
    const { data: shop } = await supabaseAdmin.from("shops").select("owner_id").eq("id", barber.shop_id).single();
    if (shop?.owner_id !== user.id) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!barber.user_id) {
    return NextResponse.json({ error: "This barber hasn't linked a ClipWise account yet" }, { status: 400 });
  }

  const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(barber.user_id);
  const email = authUser?.user?.email;
  if (!email) return NextResponse.json({ error: "No login email found for this barber" }, { status: 400 });

  const { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
    type: "recovery",
    email,
    options: { redirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/barber-dashboard` },
  });

  if (linkError) return NextResponse.json({ error: linkError.message }, { status: 500 });

  return NextResponse.json({
    link: (linkData as { properties?: { action_link?: string } })?.properties?.action_link,
    email,
    name: barber.name,
  });
}
