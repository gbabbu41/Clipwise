import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { enforceRateLimit } from "@/lib/rate-limit";
import { ensureClientRow } from "@/lib/ensure-client";

// Upsert a client for a shop, deduped by email → phone → name. Runs with the
// service role so it works from the anonymous customer booking flow AND from the
// barber portal (where RLS gives barbers no INSERT on clients). Idempotent:
// returns the existing client if one already matches. The dedupe/create logic is
// the shared ensureClientRow, so EVERY client-adding gate behaves identically —
// including logging a name-only guest (deduped by name so no duplicates).
export async function POST(request: NextRequest) {
  // Public (anon booking flow calls this) — rate-limit to blunt bulk PII
  // injection into a shop's client book.
  const limited = enforceRateLimit(request, "clients-upsert", 20, 60_000);
  if (limited) return limited;

  const { shop_id, name, email, phone } = await request.json() as {
    shop_id?: string; name?: string; email?: string; phone?: string;
  };
  if (!shop_id || !name?.trim()) {
    return NextResponse.json({ ok: false, error: "Missing shop_id or name" }, { status: 400 });
  }

  // Only register clients for a real, approved shop (light abuse guard).
  const { data: shop } = await supabaseAdmin
    .from("shops").select("id").eq("id", shop_id).eq("status", "approved").maybeSingle();
  if (!shop) return NextResponse.json({ ok: false, error: "Shop not found" }, { status: 404 });

  const id = await ensureClientRow(shop_id, { name, email, phone });
  if (!id) return NextResponse.json({ ok: false, error: "Could not save client" }, { status: 500 });
  return NextResponse.json({ ok: true, id });
}
