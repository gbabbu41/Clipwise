import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireSuperAdmin } from "@/lib/admin-auth";
import { logAdminAction } from "@/lib/admin-audit";

// Admin-only CRUD for comp coupons (super_admin = gbabbu41). A coupon grants
// `days` free days of `plan` when redeemed by a shop (via /api/coupons/redeem).
const PAID = new Set(["pro", "premium", "business"]);

const genCode = () => "GIFT-" + crypto.randomBytes(4).toString("hex").toUpperCase(); // e.g. GIFT-9F3A1C22 (customer-facing — reads like a gift, not "comp")

// GET — list coupons (newest first) with usage.
export async function GET(req: NextRequest) {
  if (!(await requireSuperAdmin(req))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { data, error } = await supabaseAdmin
    .from("plan_coupons").select("*").order("created_at", { ascending: false }).limit(200);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ coupons: data ?? [] });
}

// POST — create a coupon. { plan, days, max_uses?, expires_at?, note?, code? }
export async function POST(req: NextRequest) {
  const admin = await requireSuperAdmin(req);
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const body = await req.json().catch(() => ({})) as {
    plan?: string; days?: number; max_uses?: number; expires_at?: string; note?: string; code?: string;
  };

  const plan = (body.plan ?? "pro").toLowerCase();
  if (!PAID.has(plan)) return NextResponse.json({ error: "Plan must be Pro or Premium." }, { status: 400 });
  const days = Math.round(Number(body.days));
  if (!Number.isFinite(days) || days <= 0 || days > 365) return NextResponse.json({ error: "Days must be 1–365." }, { status: 400 });
  const max_uses = body.max_uses == null ? 1 : Math.round(Number(body.max_uses));
  if (!Number.isFinite(max_uses) || max_uses < 1 || max_uses > 100000) return NextResponse.json({ error: "Max uses must be ≥ 1." }, { status: 400 });

  let expires_at: string | null = null;
  if (body.expires_at) {
    const t = new Date(body.expires_at).getTime();
    if (Number.isNaN(t)) return NextResponse.json({ error: "Invalid expiry date." }, { status: 400 });
    expires_at = new Date(t).toISOString();
  }

  const code = (body.code?.trim().toUpperCase() || genCode()).slice(0, 40);
  const note = body.note ? String(body.note).slice(0, 200) : null;

  const { data, error } = await supabaseAdmin
    .from("plan_coupons").insert({ code, plan, days, max_uses, expires_at, note, is_active: true }).select().single();
  if (error) {
    if ((error as { code?: string }).code === "23505") return NextResponse.json({ error: "That code already exists — pick another." }, { status: 409 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  await logAdminAction(admin, { action: "coupon.create", target_type: "coupon", target_id: data.id, target_label: code, meta: { plan, days, max_uses } });
  return NextResponse.json({ ok: true, coupon: data });
}

// PATCH — activate/deactivate a coupon. { id, is_active }
export async function PATCH(req: NextRequest) {
  const admin = await requireSuperAdmin(req);
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id, is_active } = await req.json().catch(() => ({})) as { id?: string; is_active?: boolean };
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });
  const { data, error } = await supabaseAdmin
    .from("plan_coupons").update({ is_active: !!is_active }).eq("id", id).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await logAdminAction(admin, { action: "coupon.toggle", target_type: "coupon", target_id: id, target_label: data?.code ?? id, meta: { is_active: !!is_active } });
  return NextResponse.json({ ok: true, coupon: data });
}
