import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireSuperAdmin } from "@/lib/admin-auth";

// GET — most-recent runtime errors (super-admin only). ?limit (default 100, max 500).
export async function GET(req: NextRequest) {
  if (!(await requireSuperAdmin(req))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const url = new URL(req.url);
  const limit = Math.min(500, Math.max(1, Number(url.searchParams.get("limit") ?? 100) || 100));

  const { data, error } = await supabaseAdmin
    .from("error_logs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    // Pre-migration — return empty + a flag so the UI shows a "run migration" note.
    return NextResponse.json({ entries: [], unavailable: true });
  }

  // Resolve shop_id → shop name so the panel shows WHICH shop broke (shop_id is a
  // plain text column, not a FK, so this is a separate lookup rather than a join).
  const rows = data ?? [];
  const shopIds = Array.from(new Set(rows.map((r) => r.shop_id).filter(Boolean))) as string[];
  let names: Record<string, string> = {};
  if (shopIds.length) {
    const { data: shops } = await supabaseAdmin.from("shops").select("id, name").in("id", shopIds);
    names = Object.fromEntries((shops ?? []).map((s) => [s.id, s.name]));
  }
  const entries = rows.map((r) => ({ ...r, shop_name: r.shop_id ? (names[r.shop_id] ?? null) : null }));

  return NextResponse.json({ entries });
}
