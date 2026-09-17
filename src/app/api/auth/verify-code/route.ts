import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { enforceRateLimit } from "@/lib/rate-limit";
import { publicSignupGate } from "@/lib/public-signup-gate";

// Step 2: the ONLY place a real account is created. It happens strictly AFTER the
// emailed code is verified, so nothing lands in auth.users (no account, no
// profile) until the email is proven. The password arrives here over HTTPS and is
// used immediately to create the account — it is never stored in signup_codes.
export const runtime = "nodejs";

const MAX_ATTEMPTS = 6;
const VALID_ROLES = new Set(["shop_owner", "barber", "customer"]);

export async function POST(req: NextRequest) {
  const limited = enforceRateLimit(req, "signup-verify", 15, 60_000);
  if (limited) return limited;
  const gate = await publicSignupGate();
  if (gate) return gate;
  let body: { email?: string; code?: string; password?: string; name?: string; phone?: string; role?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Bad request" }, { status: 400 }); }
  if (!body || [body.email, body.code, body.password, body.name].some(v => typeof v !== "string") || (body.phone !== undefined && typeof body.phone !== "string")) return NextResponse.json({ error: "Bad request" }, { status: 400 });

  const email = (body.email || "").trim().toLowerCase();
  const code = (body.code || "").trim();
  const password = body.password || "";
  const name = (body.name || "").trim();
  const phone = (body.phone || "").trim();
  const role = VALID_ROLES.has(body.role || "") ? body.role! : "customer";

  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !/^\d{6}$/.test(code) || name.length > 160 || phone.length > 32 || password.length > 256) return NextResponse.json({ error: "Check your signup details." }, { status: 400 });
  if (password.length < 8) return NextResponse.json({ error: "Password must be at least 8 characters." }, { status: 400 });

  // Look up the pending code.
  const { data: row, error: readError } = await supabaseAdmin
    .from("signup_codes")
    .select("code, expires_at, attempts, role")
    .eq("email", email)
    .maybeSingle();

  if (readError) return NextResponse.json({ error: "Please try again shortly." }, { status: 503 });
  if (!row) return NextResponse.json({ error: "This code has expired. Request a new one." }, { status: 400 });
  if (row.role !== role) return NextResponse.json({ error: "Request a new code for this signup." }, { status: 400 });
  const deleteThisCode = () => supabaseAdmin.from("signup_codes").delete().eq("email", email).eq("code", row.code).eq("expires_at", row.expires_at);

  if (new Date(row.expires_at).getTime() < Date.now()) {
    await deleteThisCode();
    return NextResponse.json({ error: "This code has expired. Request a new one." }, { status: 400 });
  }
  if ((row.attempts ?? 0) >= MAX_ATTEMPTS) {
    await deleteThisCode();
    return NextResponse.json({ error: "Too many wrong tries. Request a new code." }, { status: 429 });
  }
  // Compare-and-swap consumes an attempt atomically. Parallel guesses cannot all
  // reuse the same count; matching expires_at/code also excludes a replaced code.
  const attemptQuery = supabaseAdmin.from("signup_codes")
    .update({ attempts: row.code === code ? MAX_ATTEMPTS : (row.attempts ?? 0) + 1 })
    .eq("email", email).eq("code", row.code).eq("expires_at", row.expires_at);
  const { data: claimed, error: claimError } = await (row.attempts == null ? attemptQuery.is("attempts", null) : attemptQuery.eq("attempts", row.attempts)).select("email");
  if (claimError) return NextResponse.json({ error: "Please try again shortly." }, { status: 503 });
  if (!claimed?.length) return NextResponse.json({ error: "Another verification is in progress. Please try again." }, { status: 429 });
  if (row.code !== code) {
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
      await deleteThisCode();
      return NextResponse.json({ error: "already_registered" }, { status: 409 });
    }
    console.error("[verify-code] account creation failed");
    return NextResponse.json({ error: "We couldn’t finish creating your account. Go back and request a new code before trying again." }, { status: 500 });
  }

  // Backfill the profile row (the handle_new_user trigger reads metadata, but this
  // guarantees role/name/phone even if the trigger's role rules differ).
  await supabaseAdmin.from("users")
    .update({ role, name, phone })
    .eq("id", created.user.id)
    .then(null, () => null);

  // Burn the code so it can't be reused.
  await deleteThisCode();

  return NextResponse.json({ ok: true, role });
}
