import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { clientIp, enforceRateLimit } from "@/lib/rate-limit";
import { DRAFT_COOKIE, draftCookieOptions, draftHash, privateIpHash, sameOrigin } from "@/lib/marketing-start";
import { isNativeRequest } from "@/lib/native-app";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const json = (body: object, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(req: NextRequest) {
  if (!sameOrigin(req) || isNativeRequest(req)) return json({ error: "Please start from the ClipWise website." }, 403);
  const limited = enforceRateLimit(req, "marketing-start", 12, 60_000);
  if (limited) return limited;
  if (!req.headers.get("content-type")?.includes("application/json")) return json({ error: "Invalid request." }, 415);
  // Bound the stream itself, not only an attacker-controlled Content-Length.
  const reader = req.body?.getReader();
  if (!reader) return json({ error: "Enter your email address." }, 400);
  let text = ""; let bytes = 0; const decoder = new TextDecoder();
  try {
    while (true) { const { done, value } = await reader.read(); if (done) break; bytes += value.byteLength; if (bytes > 2048) { await reader.cancel(); return json({ error: "Request too large." }, 413); } text += decoder.decode(value, { stream: true }); }
    text += decoder.decode();
    const body = JSON.parse(text);
    if (!body || typeof body !== "object" || typeof body.email !== "string" || (body.website && typeof body.website !== "string")) return json({ error: "Enter a valid email address." }, 400);
    if (body.website) return json({ error: "Please try again." }, 400);
    const email = body.email.trim().toLowerCase();
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: "Enter a valid email address." }, 400);
    const plan = ["starter", "pro", "premium"].includes(body.plan) ? body.plan : "starter";
    // Fail closed on a settings read error; don't ignore a signup pause.
    const { data: settings, error: settingsError } = await supabaseAdmin.from("platform_settings").select("data").eq("id", 1).maybeSingle();
    if (settingsError) return json({ error: "Signup is temporarily unavailable. Please try again shortly." }, 503);
    if (settings?.data?.signups_enabled === false) return json({ error: "New signups are paused. Please check back soon." }, 503);
    const token = randomBytes(32).toString("hex");
    const { data, error } = await supabaseAdmin.rpc("capture_marketing_lead", { p_email: email, p_plan: plan, p_token_hash: draftHash(token), p_ip_hash: privateIpHash(clientIp(req)) });
    if (error) return json({ error: "We couldn’t save your email. Try again, or continue directly to signup." }, 503);
    if (data === "limited") return json({ error: "Please wait before trying again, or continue directly to signup." }, 429);
    if (data !== "saved") return json({ error: "Please try again shortly." }, 503);
    const response = json({ ok: true, next: `/signup?plan=${plan}` });
    response.cookies.set(DRAFT_COOKIE, token, draftCookieOptions);
    return response;
  } catch { return json({ error: "We couldn’t continue. Please try again." }, 400); }
}

export async function GET(req: NextRequest) {
  const limited = enforceRateLimit(req, "marketing-draft", 30, 60_000);
  if (limited) return limited;
  const token = req.cookies.get(DRAFT_COOKIE)?.value;
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return json({ draft: null });
  const { data, error } = await supabaseAdmin.from("marketing_signup_drafts").select("email,plan").eq("token_hash", draftHash(token)).gt("expires_at", new Date().toISOString()).maybeSingle();
  if (error) return json({ draft: null }, 503);
  return json({ draft: data ?? null });
}

export async function DELETE(req: NextRequest) {
  if (!sameOrigin(req)) return json({ error: "Invalid request." }, 403);
  // Clear the browser capability, retain short-lived DB rows for flood limits.
  const response = json({ ok: true });
  response.cookies.set(DRAFT_COOKIE, "", { ...draftCookieOptions, maxAge: 0 });
  return response;
}
