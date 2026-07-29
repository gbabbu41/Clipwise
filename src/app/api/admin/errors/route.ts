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
  return NextResponse.json({ entries: data ?? [] });
}
