import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { sendAppEmail } from "@/lib/emailer";
import { verifyTurnstile } from "@/lib/turnstile";

// Step 1 of the "verify-first, create-after" signup: no account, password, or
// profile is written anywhere until the emailed code is verified. This route only
// stores {email, code} in signup_codes and emails the code. Bots are stopped by
// Turnstile (when configured) + a per-email cooldown, and duplicate accounts are
// short-circuited to "sign in" — so a flood can't create real accounts or data.
export const runtime = "nodejs";

const CODE_TTL_MIN = 10;
const RESEND_COOLDOWN_MS = 30_000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(req: NextRequest) {
  let body: { email?: string; role?: string; captchaToken?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Bad request" }, { status: 400 }); }

  const email = (body.email || "").trim().toLowerCase();
  const role = body.role === "shop_owner" || body.role === "barber" ? body.role : "customer";
  if (!EMAIL_RE.test(email) || email.length > 254) return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });

  // Bot gate — skipped until TURNSTILE_SECRET_KEY is set, enforced once it is.
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null;
  if (!(await verifyTurnstile(body.captchaToken, ip))) {
    return NextResponse.json({ error: "Couldn't verify you're human. Please try again." }, { status: 400 });
  }

  // Already a real account → never create a code; send them to sign in.
  const { data: existing } = await supabaseAdmin.from("users").select("id").eq("email", email).maybeSingle();
  if (existing) return NextResponse.json({ error: "already_registered" }, { status: 409 });

  // Per-email resend cooldown.
  const { data: prev } = await supabaseAdmin.from("signup_codes").select("last_sent_at").eq("email", email).maybeSingle();
  if (prev?.last_sent_at && Date.now() - new Date(prev.last_sent_at).getTime() < RESEND_COOLDOWN_MS) {
    return NextResponse.json({ error: "Please wait a few seconds before requesting another code." }, { status: 429 });
  }

  // Generate + store a fresh 6-digit code (one pending code per email).
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
  const now = new Date();
  const { error: upErr } = await supabaseAdmin.from("signup_codes").upsert({
    email,
    code,
    role,
    expires_at: new Date(now.getTime() + CODE_TTL_MIN * 60_000).toISOString(),
    attempts: 0,
    last_sent_at: now.toISOString(),
  }, { onConflict: "email" });
  if (upErr) {
    console.error("[request-code] store failed:", upErr.message);
    return NextResponse.json({ error: "Couldn't send a code. Please try again." }, { status: 500 });
  }

  // Email the code via the app's Resend sender.
  const sent = await sendAppEmail("signup_code", { email, code, expiryMinutes: String(CODE_TTL_MIN) });
  if ("error" in sent && sent.error) {
    const msg = typeof sent.error === "string" ? sent.error : JSON.stringify(sent.error);
    console.error("[request-code] email failed:", msg);
    return NextResponse.json({ error: "We couldn't send the code email. Please try again shortly." }, { status: 502 });
  }

  return NextResponse.json({ ok: true });
}
