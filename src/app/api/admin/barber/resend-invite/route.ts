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

  const { barber_id } = await request.json() as { barber_id: string };

  const { data: barber } = await supabaseAdmin
    .from("barbers")
    .select("id, name, email, shop_id, user_id")
    .eq("id", barber_id)
    .single();

  if (!barber) return NextResponse.json({ error: "Barber not found" }, { status: 404 });
  if (!barber.email) return NextResponse.json({ error: "Barber has no email address" }, { status: 400 });
  if (barber.user_id) return NextResponse.json({ error: "Barber already accepted their invite" }, { status: 400 });

  const { data: shop } = await supabaseAdmin.from("shops").select("name, owner_id").eq("id", barber.shop_id).single();
  if (callerProfile.role === "shop_owner" && shop?.owner_id !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const redirectTo = `${process.env.NEXT_PUBLIC_APP_URL}/accept-invite`;

  const { data: inviteData, error: inviteError } = await supabaseAdmin.auth.admin.generateLink({
    type: "invite",
    email: barber.email,
    options: { redirectTo, data: { invite_barber_id: barber.id, role: "barber" } },
  });

  let inviteLink = (inviteData as { properties?: { action_link?: string } })?.properties?.action_link ?? null;
  let existingAccount = false;

  if (inviteError) {
    // User exists — generate magic link instead
    existingAccount = true;
    const { data: magicData } = await supabaseAdmin.auth.admin.generateLink({
      type: "magiclink",
      email: barber.email,
      options: { redirectTo },
    });
    inviteLink = (magicData as { properties?: { action_link?: string } })?.properties?.action_link ?? null;
  }

  if (!inviteLink) return NextResponse.json({ error: "Failed to generate invite link" }, { status: 500 });

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3001";
  await fetch(`${baseUrl}/api/send-email`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      type: "barber_invite",
      data: {
        barberName: barber.name, barberEmail: barber.email,
        shopName: shop?.name ?? "your shop", inviteLink,
        existingAccount: existingAccount ? "true" : "false",
      },
    }),
  });

  return NextResponse.json({ ok: true, inviteLink, existingAccount });
}
