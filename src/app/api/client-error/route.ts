import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { enforceRateLimit } from "@/lib/rate-limit";

// Best-effort attribution: WHO hit the crash and at WHICH shop, so the CEO panel
// can say "zavier cuts' schedule page broke" instead of just a bare path. Derived
// server-side only — from the trusted session cookie (never a client-supplied id,
// which could be spoofed) and, for logged-out customers, from the /book/<slug>
// path. Never throws: attribution failing must not stop the error from logging.
async function attribute(req: NextRequest, path: string | null): Promise<{ user_id: string | null; shop_id: string | null }> {
  let user_id: string | null = null;
  let shop_id: string | null = null;
  try {
    const supa = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { cookies: { getAll: () => req.cookies.getAll(), setAll: () => {} } },
    );
    const { data: { user } } = await supa.auth.getUser();
    if (user) {
      user_id = user.id;
      // The shop they own, else the shop they work at as a barber.
      const { data: owned } = await supabaseAdmin.from("shops").select("id").eq("owner_id", user.id).limit(1);
      if (owned?.[0]) shop_id = owned[0].id;
      else {
        const { data: barber } = await supabaseAdmin.from("barbers").select("shop_id").eq("user_id", user.id).limit(1);
        if (barber?.[0]) shop_id = barber[0].shop_id;
      }
    }
    // Logged-out customer crashing on a booking page — the slug names the shop.
    if (!shop_id && path) {
      const m = path.match(/^\/book\/([^/?#]+)/);
      if (m) {
        const { data: shop } = await supabaseAdmin.from("shops").select("id").eq("slug", m[1]).limit(1);
        if (shop?.[0]) shop_id = shop[0].id;
      }
    }
  } catch { /* attribution is best-effort — never block logging */ }
  return { user_id, shop_id };
}

/**
 * Ingest for browser + boundary errors. PUBLIC on purpose — crashes happen
 * pre-auth (e.g. the login page) too. Because it's public it is:
 *   · rate-limited hard (can't be used to flood the table or the logs), and
 *   · size-bounded on every field, and
 *   · never trusts a caller-supplied identity for anything privileged.
 *
 * It does two things: console.error (so the error lands in Vercel runtime logs,
 * which engineering can query any time) AND inserts a row into error_logs (which
 * powers the CEO panel at /admin/errors). Insert is best-effort so a missing
 * table (pre-migration) never turns logging itself into a 500.
 */
const cap = (v: unknown, n: number): string | null =>
  typeof v === "string" && v.length > 0 ? v.slice(0, n) : null;

export async function POST(req: NextRequest) {
  const limited = enforceRateLimit(req, "client-error", 30, 60_000);
  if (limited) return limited;

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false }, { status: 400 }); }

  const message = cap(body.message, 1000);
  if (!message) return NextResponse.json({ ok: false }, { status: 400 });

  const path = cap(body.path, 300);       // pathname only (client strips query)
  const { user_id, shop_id } = await attribute(req, path);

  const row = {
    level: cap(body.level, 20) ?? "error",
    source: cap(body.source, 40) ?? "client",
    message,
    stack: cap(body.stack, 6000),
    path,
    user_agent: cap(req.headers.get("user-agent"), 300),
    user_id,   // best-effort, may be null (pre-auth crashes)
    shop_id,   // best-effort, may be null (platform pages)
  };

  // Engineering channel: queryable in Vercel logs.
  console.error("[client-error]", JSON.stringify({ ...row, stack: row.stack ? row.stack.split("\n").slice(0, 3).join(" | ") : null }));

  // CEO panel channel: the error_logs table (best-effort).
  await supabaseAdmin.from("error_logs").insert(row).then(null, () => null);

  return NextResponse.json({ ok: true });
}
