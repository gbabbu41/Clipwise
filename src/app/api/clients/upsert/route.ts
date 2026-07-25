import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { enforceRateLimit } from "@/lib/rate-limit";

// Upsert a client for a shop, deduped by email → phone (case-insensitive email).
// Runs with the service role so it works from the anonymous customer booking
// flow. Idempotent: returns the existing client if one already matches.
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

  const e = (email ?? "").trim().slice(0, 120);
  const p = (phone ?? "").trim().slice(0, 30);
  const nm = name.trim().slice(0, 80);

  try {
    // Dedupe: match an existing client by email first, then phone.
    let existing: { id: string } | null = null;
    if (e) {
      const { data } = await supabaseAdmin
        .from("clients").select("id").eq("shop_id", shop_id).ilike("email", e).maybeSingle();
      existing = data;
    }
    if (!existing && p) {
      const { data } = await supabaseAdmin
        .from("clients").select("id").eq("shop_id", shop_id).eq("phone", p).maybeSingle();
      existing = data;
    }
    if (existing) return NextResponse.json({ ok: true, id: existing.id, created: false });

    const { data, error } = await supabaseAdmin.from("clients").insert({
      shop_id, name: nm, email: e, phone: p,
      total_visits: 0, total_spent: 0, loyalty_points: 0, tag: "New",
    }).select("id").single();
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, id: data.id, created: true });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : "error" }, { status: 500 });
  }
}
