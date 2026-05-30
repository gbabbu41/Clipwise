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

  // Get caller's shop
  const { data: shop } = await supabaseAdmin
    .from("shops")
    .select("id, name")
    .eq("owner_id", user.id)
    .single();

  if (!shop) return NextResponse.json({ error: "No shop found" }, { status: 404 });

  const { name, email: rawEmail, commission_percent = 50 } = await request.json() as {
    name: string; email: string; commission_percent?: number;
  };

  if (!name || !rawEmail) return NextResponse.json({ error: "Name and email are required" }, { status: 400 });

  // Normalize email to match how Supabase auth stores it (lowercase + trimmed)
  const email = rawEmail.trim().toLowerCase();

  // Check if a barber with this email is already on the team (case-insensitive)
  const { data: existing } = await supabaseAdmin
    .from("barbers")
    .select("id")
    .eq("shop_id", shop.id)
    .ilike("email", email)
    .maybeSingle();

  if (existing) return NextResponse.json({ error: "A barber with this email is already on your team" }, { status: 409 });

  // Create the barber record (no user_id yet — set after they accept)
  const { data: barber, error: barberError } = await supabaseAdmin
    .from("barbers")
    .insert({
      shop_id: shop.id,
      name,
      email,
      commission_percent,
      is_active: true,
      rating: 0,
      total_reviews: 0,
    })
    .select()
    .single();

  if (barberError) return NextResponse.json({ error: barberError.message }, { status: 500 });

  const redirectTo = `${process.env.NEXT_PUBLIC_APP_URL}/accept-invite`;

  // Try invite link (new user); fall back to magic link (existing user)
  let inviteLink: string | null = null;

  const { data: inviteData, error: inviteError } = await supabaseAdmin.auth.admin.generateLink({
    type: "invite",
    email,
    options: {
      redirectTo,
      data: { invite_barber_id: barber.id, role: "barber" },
    },
  });

  if (!inviteError) {
    inviteLink = (inviteData as { properties?: { action_link?: string } })?.properties?.action_link ?? null;
  } else {
    // User already exists — generate a magic link instead
    const { data: magicData } = await supabaseAdmin.auth.admin.generateLink({
      type: "magiclink",
      email,
      options: { redirectTo },
    });
    inviteLink = (magicData as { properties?: { action_link?: string } })?.properties?.action_link ?? null;
  }

  if (!inviteLink) {
    // Clean up the barber record if we couldn't generate a link
    await supabaseAdmin.from("barbers").delete().eq("id", barber.id);
    return NextResponse.json({ error: "Failed to generate invite link" }, { status: 500 });
  }

  // Send branded invite email via Resend
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3001";
  await fetch(`${baseUrl}/api/send-email`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      type: "barber_invite",
      data: {
        barberName: name,
        barberEmail: email,
        shopName: shop.name,
        inviteLink,
      },
    }),
  });

  return NextResponse.json({ ok: true, barber });
}
