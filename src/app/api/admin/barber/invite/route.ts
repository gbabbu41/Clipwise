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
    .select("id, name, email")
    .eq("owner_id", user.id)
    .single();

  if (!shop) return NextResponse.json({ error: "No shop found" }, { status: 404 });

  const { name, email: rawEmail, commission_percent = 50, skip_invite = false } = await request.json() as {
    name: string; email: string; commission_percent?: number; skip_invite?: boolean;
  };

  if (!name || !rawEmail) return NextResponse.json({ error: "Name and email are required" }, { status: 400 });

  // Normalize email to match how Supabase auth stores it (lowercase + trimmed)
  const email = rawEmail.trim().toLowerCase();

  // Owner self-add: if the email matches the caller's auth email, they're
  // adding themselves. Skip the whole invite-link + email flow and just
  // link the new barber row to their existing user_id immediately.
  const isOwnerSelf = (user.email ?? "").toLowerCase() === email;

  // Shop owners can only act as a barber under their own shop. If the
  // submitted email already belongs to a different shop_owner / super_admin
  // account, refuse — owning a shop is a separate identity from being a
  // barber elsewhere. (Self-add is fine: that's the owner-as-barber path.)
  if (!isOwnerSelf) {
    const { data: existingUser } = await supabaseAdmin
      .from("users")
      .select("id, role")
      .ilike("email", email)
      .maybeSingle();
    if (existingUser && (existingUser.role === "shop_owner" || existingUser.role === "super_admin") && existingUser.id !== user.id) {
      return NextResponse.json(
        {
          error: "This email is already registered as a shop owner. Shop owners can only work as a barber under their own shop. They must delete their existing shop from Settings → Danger Zone before they can be added as a barber here.",
        },
        { status: 409 }
      );
    }
  }

  // Check if a barber with this email is already on the team (case-insensitive)
  const { data: existing } = await supabaseAdmin
    .from("barbers")
    .select("id")
    .eq("shop_id", shop.id)
    .ilike("email", email)
    .maybeSingle();

  if (existing) return NextResponse.json({ error: "A barber with this email is already on your team" }, { status: 409 });

  // Create the barber record. For owner self-add, link user_id immediately so
  // they can hop into the barber view right away — no invite acceptance needed.
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
      ...(isOwnerSelf ? { user_id: user.id } : {}),
    })
    .select()
    .single();

  if (barberError) {
    // 23505 = Postgres unique-violation. Surface a friendly message if the
    // DB unique constraint catches a race that slipped past the pre-check.
    if ((barberError as { code?: string }).code === "23505") {
      return NextResponse.json({ error: "A barber with this email is already on your team" }, { status: 409 });
    }
    return NextResponse.json({ error: barberError.message }, { status: 500 });
  }

  // Owner self-add — short-circuit. No invite link, no email, just a confirmation.
  if (isOwnerSelf) {
    return NextResponse.json({
      ok: true, barber, ownerSelf: true,
      message: "You have been added as a barber. Switch to 'My Barber View' from the sidebar.",
    });
  }

  // Manual add — the owner just wants the barber on the roster, no app invite.
  // Skip the link generation + email entirely so the request can't hang.
  if (skip_invite) {
    return NextResponse.json({ ok: true, barber, manual: true });
  }

  const redirectTo = `${process.env.NEXT_PUBLIC_APP_URL}/accept-invite`;

  // Try invite link (new user); fall back to magic link (existing user)
  let inviteLink: string | null = null;
  let existingAccount = false;

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
    existingAccount = true;
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

  // Send branded invite email via Resend — best-effort and time-bounded so a
  // slow/blocked email provider can never hang the request (the owner also gets
  // the link back in the UI to copy/paste).
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3001";
  const emailCtrl = new AbortController();
  const emailTimeout = setTimeout(() => emailCtrl.abort(), 6000);
  await fetch(`${baseUrl}/api/send-email`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: emailCtrl.signal,
    body: JSON.stringify({
      type: "barber_invite",
      data: {
        barberName: name,
        barberEmail: email,
        shopName: shop.name,
        shopEmail: shop.email ?? "",
        inviteLink,
        existingAccount: existingAccount ? "true" : "false",
      },
    }),
  }).catch(() => null);
  clearTimeout(emailTimeout);

  // Return the link too — the owner can copy/paste it manually if the
  // email doesn't arrive (Resend sandbox restrictions, spam filter, etc.)
  return NextResponse.json({ ok: true, barber, inviteLink, existingAccount });
}
