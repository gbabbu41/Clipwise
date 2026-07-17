import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

export async function POST(request: NextRequest) {
  const token = request.headers.get("Authorization")?.replace("Bearer ", "");
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
  if (authError || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { barber_id } = await request.json() as { barber_id?: string };
  const lookupEmail = (user.email ?? "").trim().toLowerCase();

  // Resolve the target barber row (by id or by email), then VERIFY it was
  // invited to THIS user's email before linking. Without this check a client
  // could pass any unclaimed barber_id (public on the booking page) and hijack
  // that barber's shop access. Case-insensitive: Supabase lowercases auth
  // emails, but rows may predate that.
  let barber: { id: string; email: string | null; user_id: string | null } | null = null;
  if (barber_id) {
    const { data } = await supabaseAdmin
      .from("barbers").select("id, email, user_id").eq("id", barber_id).maybeSingle();
    barber = data;
  } else if (lookupEmail) {
    const { data } = await supabaseAdmin
      .from("barbers").select("id, email, user_id")
      .ilike("email", lookupEmail).is("user_id", null)
      .order("created_at", { ascending: false }).limit(1);
    barber = data?.[0] ?? null;
  }

  if (!barber) {
    return NextResponse.json({
      error: `No pending invite found for ${user.email ?? "this email"}. Ask your shop owner to resend the invite to the exact same email address.`,
    }, { status: 404 });
  }
  if (barber.user_id) {
    return NextResponse.json({ error: "This invite has already been accepted." }, { status: 409 });
  }
  // The core guard: the caller must own the email the invite was sent to.
  if (!lookupEmail || (barber.email ?? "").trim().toLowerCase() !== lookupEmail) {
    return NextResponse.json({ error: "This invite isn't for your account. Ask your shop owner to invite the email you're signed in with." }, { status: 403 });
  }

  // Link the auth user to the barber record (still gated on user_id null to
  // backstop a race).
  const { error: linkError } = await supabaseAdmin
    .from("barbers")
    .update({ user_id: user.id })
    .eq("id", barber.id)
    .is("user_id", null);

  if (linkError) return NextResponse.json({ error: linkError.message }, { status: 500 });

  // Only upgrade role to 'barber' if they were a plain customer. Don't downgrade
  // a shop_owner or super_admin — many owner-operators cut hair too and need
  // both their owner dashboard AND a barber profile under the same login.
  const { data: profile } = await supabaseAdmin
    .from("users").select("role").eq("id", user.id).single();
  if (profile?.role !== "shop_owner" && profile?.role !== "super_admin") {
    await supabaseAdmin
      .from("users")
      .update({ role: "barber" })
      .eq("id", user.id);
  }

  return NextResponse.json({ ok: true, role: profile?.role ?? "barber" });
}
