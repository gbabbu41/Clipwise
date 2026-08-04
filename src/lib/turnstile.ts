// Server-side Cloudflare Turnstile (CAPTCHA) verification.
//
// If TURNSTILE_SECRET_KEY is NOT set, verification is SKIPPED (returns true) so
// the signup flow keeps working before the owner adds keys — CAPTCHA enforcement
// switches ON automatically the moment the secret is present in the environment.
// When a secret IS configured, this fails CLOSED (a missing/invalid token or any
// network error → rejected), so bots can't slip through.
export async function verifyTurnstile(token: string | null | undefined, ip?: string | null): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) return true;      // not configured yet → don't block real users
  if (!token) return false;      // configured but no token → reject
  try {
    const body = new URLSearchParams({ secret, response: token });
    if (ip) body.set("remoteip", ip);
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    const data = (await res.json().catch(() => ({ success: false }))) as { success?: boolean };
    return data.success === true;
  } catch {
    return false;                // fail closed when a secret is configured
  }
}
