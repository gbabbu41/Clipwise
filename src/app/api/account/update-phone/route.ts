import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

// Update the signed-in user's OWN account phone (users.phone) — the personal
// number used for their booking SMS alerts. Runs with the service role but scopes
// the update to the caller's own id (from their verified token), so no one can
// change another user's number. Only the `phone` column is ever written here —
// role/email/etc. are never touched, so this can't be used to self-escalate.
export async function POST(request: NextRequest) {
  const token = request.headers.get("Authorization")?.replace("Bearer ", "");
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(token);
  if (authErr || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { phone } = await request.json().catch(() => ({})) as { phone?: string };
  // Bound the length (never trust the client) — a phone is short; this also keeps
  // it under the DB backstop. Empty string clears the number.
  const clean = typeof phone === "string" ? phone.trim().slice(0, 30) : "";

  const { error } = await supabaseAdmin
    .from("users").update({ phone: clean || null }).eq("id", user.id);
  if (error) return NextResponse.json({ error: "Couldn't update your phone. Please try again." }, { status: 500 });

  return NextResponse.json({ ok: true, phone: clean || null });
}
