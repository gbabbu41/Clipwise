import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

// Step 2: the ONLY place a real account is created. It happens strictly AFTER the
// emailed code is verified, so nothing lands in auth.users (no account, no
// profile) until the email is proven. The password arrives here over HTTPS and is
// used immediately to create the account — it is never stored in signup_codes.
export const runtime = "nodejs";

const MAX_ATTEMPTS = 6;
const VALID_ROLES = new Set(["shop_owner", "barber", "customer"]);

export async function POST(req: NextRequest) {
  let body: { email?: string; code?: string; password?: string; name?: string; phone?: string; role?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Bad request" }, { status: 400 }); }

  const email = (body.email || "").trim().toLowerCase();
  const code = (body.code || "").trim();
  const password = body.password || "";
  const name = (body.name || "").trim();
  const phone = (body.phone || "").trim();
  const role = VALID_ROLES.has(body.role || "") ? body.role! : "customer";

  if (!email || !code) return NextResponse.json({ error: "Missing email or code." }, { status: 400 });
  if (password.length < 8) return NextResponse.json({ error: "Password must be at least 8 characters." }, { status: 400 });

  // Look up the pending code.
  const { data: row } = await supabaseAdmin
    .from("signup_codes")
    .select("code, expires_at, attempts")
    .eq("email", email)
    .maybeSingle();

  if (!row) return NextResponse.json({ error: "This code has expired. Request a new one." }, { status: 400 });

  if (new Date(row.expires_at).getTime() < Date.now()) {
    await supabaseAdmin.from("signup_codes").delete().eq("email", email);
    return NextResponse.json({ error: "This code has expired. Request a new one." }, { status: 400 });
  }
  if ((row.attempts ?? 0) >= MAX_ATTEMPTS) {
    await supabaseAdmin.from("signup_codes").delete().eq("email", email);
    return NextResponse.json({ error: "Too many wrong tries. Request a new code." }, { status: 429 });
  }
  if (row.code !== code) {
    await supabaseAdmin.from("signup_codes").update({ attempts: (row.attempts ?? 0) + 1 }).eq("email", email);
    return NextResponse.json({ error: "Incorrect code. Please check and try again." }, { status: 400 });
  }

  // Code verified → create the REAL account, already email-confirmed.
  const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { name, phone, role },
  });

  if (createErr || !created?.user) {
    const msg = (createErr?.message || "").toLowerCase();
    if (msg.includes("already") || msg.includes("registered") || msg.includes("exists")) {
      await supabaseAdmin.from("signup_codes").delete().eq("email", email);
      return NextResponse.json({ error: "already_registered" }, { status: 409 });
    }
    console.error("[verify-code] createUser failed:", createErr?.message);
    return NextResponse.json({ error: "Couldn't create your account. Please try again." }, { status: 500 });
  }

  // Backfill the profile row (the handle_new_user trigger reads metadata, but this
  // guarantees role/name/phone even if the trigger's role rules differ).
  await supabaseAdmin.from("users")
    .update({ role, name, phone })
    .eq("id", created.user.id)
    .then(null, () => null);

  // Burn the code so it can't be reused.
  await supabaseAdmin.from("signup_codes").delete().eq("email", email);

  return NextResponse.json({ ok: true, role });
}
