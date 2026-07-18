import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireSuperAdmin } from "@/lib/admin-auth";

// GET — most-recent admin actions (super-admin only). Supports ?target_type &
// ?target_id to scope to one shop/plan, and ?limit (default 200, max 500).
export async function GET(req: NextRequest) {
  if (!(await requireSuperAdmin(req))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const url = new URL(req.url);
  const targetType = url.searchParams.get("target_type");
  const targetId = url.searchParams.get("target_id");
  const limit = Math.min(500, Math.max(1, Number(url.searchParams.get("limit") ?? 200) || 200));

  let q = supabaseAdmin.from("admin_audit_log").select("*").order("created_at", { ascending: false }).limit(limit);
  if (targetType) q = q.eq("target_type", targetType);
  if (targetId) q = q.eq("target_id", targetId);

  const { data, error } = await q;
  if (error) {
    // Pre-migration — return empty + a flag so the UI shows a "run migration" note.
    return NextResponse.json({ entries: [], unavailable: true });
  }
  return NextResponse.json({ entries: data ?? [] });
}
