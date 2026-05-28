import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

export async function POST(request: NextRequest) {
  const token = request.headers.get("Authorization")?.replace("Bearer ", "");
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
  if (authError || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { barber_id } = await request.json() as { barber_id?: string };

  let barberId = barber_id;

  // Fallback: find barber by email if no ID in metadata
  if (!barberId) {
    const { data: found } = await supabaseAdmin
      .from("barbers")
      .select("id")
      .eq("email", user.email ?? "")
      .is("user_id", null)
      .maybeSingle();
    barberId = found?.id;
  }

  if (!barberId) {
    return NextResponse.json({ error: "No pending invite found for your email address" }, { status: 404 });
  }

  // Link the auth user to the barber record
  const { error: linkError } = await supabaseAdmin
    .from("barbers")
    .update({ user_id: user.id })
    .eq("id", barberId)
    .is("user_id", null);

  if (linkError) return NextResponse.json({ error: linkError.message }, { status: 500 });

  // Set role to barber in the users table (the trigger creates them as 'customer')
  await supabaseAdmin
    .from("users")
    .update({ role: "barber" })
    .eq("id", user.id);

  return NextResponse.json({ ok: true });
}
