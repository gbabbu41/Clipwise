import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { enforceRateLimit } from "@/lib/rate-limit";

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

  const row = {
    level: cap(body.level, 20) ?? "error",
    source: cap(body.source, 40) ?? "client",
    message,
    stack: cap(body.stack, 6000),
    path: cap(body.path, 300),            // pathname only (client strips query)
    user_agent: cap(req.headers.get("user-agent"), 300),
  };

  // Engineering channel: queryable in Vercel logs.
  console.error("[client-error]", JSON.stringify({ ...row, stack: row.stack ? row.stack.split("\n").slice(0, 3).join(" | ") : null }));

  // CEO panel channel: the error_logs table (best-effort).
  await supabaseAdmin.from("error_logs").insert(row).then(null, () => null);

  return NextResponse.json({ ok: true });
}
