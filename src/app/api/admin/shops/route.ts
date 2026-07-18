import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireSuperAdmin } from "@/lib/admin-auth";
import { logAdminAction } from "@/lib/admin-audit";

const VALID_STATUS = new Set(["pending", "approved", "rejected", "suspended"]);

export async function GET(req: NextRequest) {
  const admin = await requireSuperAdmin(req);
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const [{ data: shops }, { data: transactions }, { data: appointments }, { count: userCount }] = await Promise.all([
    supabaseAdmin.from("shops").select("*, users(name, email)").order("created_at", { ascending: false }),
    supabaseAdmin.from("transactions").select("amount"),
    supabaseAdmin.from("appointments").select("id"),
    supabaseAdmin.from("users").select("id", { count: "exact", head: true }),
  ]);

  return NextResponse.json({ shops: shops ?? [], transactions: transactions ?? [], appointments: appointments ?? [], userCount: userCount ?? 0 });
}

export async function PATCH(req: NextRequest) {
  const admin = await requireSuperAdmin(req);
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id, status, rejection_reason } = await req.json();
  if (!id || !status) return NextResponse.json({ error: "Missing id or status" }, { status: 400 });
  if (!VALID_STATUS.has(status)) return NextResponse.json({ error: "Invalid status" }, { status: 400 });

  // Grab the prior status/name so the audit entry is meaningful.
  const { data: prior } = await supabaseAdmin.from("shops").select("name, status").eq("id", id).maybeSingle();

  const update: Record<string, string> = { status };
  if (rejection_reason) update.rejection_reason = rejection_reason;

  const { error } = await supabaseAdmin.from("shops").update(update).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await logAdminAction(admin, {
    action: `shop.${status}`, target_type: "shop", target_id: id, target_label: prior?.name ?? null,
    meta: { from: prior?.status ?? null, to: status, ...(rejection_reason ? { reason: rejection_reason } : {}) },
  });

  return NextResponse.json({ ok: true });
}
