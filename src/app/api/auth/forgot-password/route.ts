import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { sendAppEmail } from "@/lib/emailer";
import { enforceRateLimit, rateLimit } from "@/lib/rate-limit";

// Self-service "Forgot password". We generate the recovery link server-side and
// send it through our OWN branded Resend email (from clipwise.ca) instead of
// Supabase's built-in mail — which is unbranded, rate-limited by Supabase's
// shared SMTP, and prone to spam folders.
//
// Security: public by design, but never an open relay — the email only ever goes
// to the address of a REAL account (its own inbox), the body is fixed, and we
// always answer the same way so the endpoint can't be used to probe which emails
// have accounts. Rate-limited per IP and per email.
export async function POST(request: NextRequest) {
  // Per-IP flood protection — honest users get a clear 429.
  const limited = enforceRateLimit(request, "forgot-password", 6, 15 * 60_000);
  if (limited) return limited;

  const { email: rawEmail } = (await request.json().catch(() => ({}))) as { email?: string };
  const email = (rawEmail ?? "").trim().toLowerCase();

  // Always respond identically — never reveal whether an account exists.
  const genericOk = NextResponse.json({ ok: true });
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return genericOk;

  // Per-email cap so no one can flood a single inbox with reset mail. On
  // exceed, silently return ok (don't reveal the throttle either).
  const perEmail = rateLimit(`forgot-password-email:${email}`, 4, 15 * 60_000);
  if (!perEmail.ok) return genericOk;

  // Origin-first so the link uses the real live domain even if NEXT_PUBLIC_APP_URL
  // is unset/stale in prod.
  const baseUrl = request.headers.get("origin") || process.env.NEXT_PUBLIC_APP_URL || "https://clipwise.ca";

  try {
    const { data, error } = await supabaseAdmin.auth.admin.generateLink({
      type: "recovery",
      email,
      options: { redirectTo: `${baseUrl}/reset-password` },
    });
    const link = (data as { properties?: { action_link?: string } })?.properties?.action_link;
    // generateLink errors when the email has no account — swallow it (privacy).
    if (!error && link) {
      await sendAppEmail("password_reset", { email, resetLink: link });
    }
  } catch {
    /* never surface failures to the caller */
  }

  return genericOk;
}
