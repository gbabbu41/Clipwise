import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { sendAppEmail } from "@/lib/emailer";

export async function POST(request: NextRequest) {
  const token = request.headers.get("Authorization")?.replace("Bearer ", "");
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
  if (authError || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: callerProfile } = await supabaseAdmin.from("users").select("role, avatar").eq("id", user.id).single();
  if (!callerProfile || !["shop_owner", "super_admin"].includes(callerProfile.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { name, email: rawEmail, commission_percent: rawCommission = 50, skip_invite = false, shop_id } = await request.json() as {
    name: string; email: string; commission_percent?: number; skip_invite?: boolean; shop_id?: string;
  };
  // Commission is a percentage — never allow < 0 or > 100 (never trust the client).
  const commission_percent = Math.min(100, Math.max(0, Math.round(Number(rawCommission) || 0)));

  if (!name || !rawEmail) return NextResponse.json({ error: "Name and email are required" }, { status: 400 });

  // Resolve the target location (multi-location aware). Always owner-scoped, so a
  // shop_id the caller doesn't own resolves to nothing → 404. With no shop_id we
  // fall back to the owner's first shop. (Previously `.single()` here threw for
  // any owner with more than one shop — the multi-location bug.)
  let shopQuery = supabaseAdmin.from("shops").select("id, name, email").eq("owner_id", user.id);
  if (shop_id) shopQuery = shopQuery.eq("id", shop_id);
  const { data: shopRows } = await shopQuery.order("created_at", { ascending: true }).limit(1);
  const shop = shopRows?.[0];
  if (!shop) return NextResponse.json({ error: "No shop found" }, { status: 404 });

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
    .select("id, user_id")
    .eq("shop_id", shop.id)
    .ilike("email", email)
    .maybeSingle();

  if (existing) {
    // Owner claiming their own row: never 409 them out of it. If the row exists
    // but isn't linked to their account yet (e.g. a stale onboarding row), link
    // it now; if it's already linked, just return it. Makes self-add idempotent
    // so the in-dashboard "Add yourself" prompt always succeeds.
    if (isOwnerSelf) {
      if (!existing.user_id) {
        const { data: linked } = await supabaseAdmin
          .from("barbers")
          .update({ user_id: user.id, is_active: true, ...(callerProfile.avatar ? { photo: callerProfile.avatar } : {}) })
          .eq("id", existing.id)
          .select()
          .single();
        return NextResponse.json({ ok: true, barber: linked ?? existing, ownerSelf: true, linked: true });
      }
      return NextResponse.json({ ok: true, barber: existing, ownerSelf: true, already: true });
    }
    return NextResponse.json({ error: "A barber with this email is already on your team" }, { status: 409 });
  }

  // Create the barber record. For owner self-add, link user_id immediately so
  // they can hop into the barber view right away — no invite acceptance needed.
  const { data: barber, error: barberError } = await supabaseAdmin
    .from("barbers")
    .insert({
      shop_id: shop.id,
      name: name.trim().slice(0, 40), // cap length server-side (defense in depth)
      email,
      commission_percent,
      is_active: true,
      rating: 0,
      total_reviews: 0,
      // Owner adding themselves → seed the barber photo from their account photo
      // so a new location's barber card matches their universal avatar out of the box.
      ...(isOwnerSelf ? { user_id: user.id, ...(callerProfile.avatar ? { photo: callerProfile.avatar } : {}) } : {}),
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

  // Prefer the request's origin (the real domain the owner is on, e.g.
  // https://clipwise.ca) over NEXT_PUBLIC_APP_URL, which can be unset/stale in
  // prod — in which case every emailed link would point at localhost and die on
  // the barber's device. Same origin-first pattern the Stripe routes use.
  const baseUrl = request.headers.get("origin") || process.env.NEXT_PUBLIC_APP_URL || "https://clipwise.ca";
  const redirectTo = `${baseUrl}/accept-invite`;

  // New user → an invite link (sets their password + links this barber row).
  // Existing user → NO login/magic link: that would be a "log in as that
  // person" link we'd hand to the owner (account takeover). They sign in with
  // their existing account and accept from their signed-in session instead
  // (accept-invite verifies the email matches).
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
    if (!inviteLink) {
      await supabaseAdmin.from("barbers").delete().eq("id", barber.id);
      return NextResponse.json({ error: "Failed to generate invite link" }, { status: 500 });
    }
  } else {
    // generateLink(type:"invite") errors when the email already has an account.
    existingAccount = true;
  }

  // The email CTA: new account → the invite link; existing account → a plain
  // /login link (safe, non-authenticating) that says "sign in to accept".
  const emailCtaLink = existingAccount ? `${baseUrl}/login` : (inviteLink ?? `${baseUrl}/login`);

  // Send the invite email IN-PROCESS (no self-fetch → no network hop, no auth
  // gate, no cold-start timeout that could abort it) and capture the REAL
  // result, so the owner is told the truth instead of a silent "sent". The
  // copy/paste link modal is always the reliable fallback when delivery fails.
  let emailed = false;
  let emailError: string | null = null;
  try {
    const r = await sendAppEmail("barber_invite", {
      barberName: name,
      barberEmail: email,
      shopName: shop.name,
      shopEmail: shop.email ?? "",
      inviteLink: emailCtaLink,
      existingAccount: existingAccount ? "true" : "false",
    });
    if ("error" in r) {
      const e = r.error as unknown;
      emailError = typeof e === "string" ? e : ((e as { message?: string })?.message ?? JSON.stringify(e));
    } else {
      emailed = true;
    }
  } catch (e) {
    emailError = e instanceof Error ? e.message : String(e);
  }

  // Only ever return the copy/paste link for a BRAND-NEW account (owner is
  // provisioning it). Never return a link that logs in as an existing user.
  return NextResponse.json({ ok: true, barber, inviteLink: existingAccount ? null : inviteLink, existingAccount, emailed, emailError });
}
