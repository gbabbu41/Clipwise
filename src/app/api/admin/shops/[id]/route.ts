import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireSuperAdmin } from "@/lib/admin-auth";
import { logAdminAction } from "@/lib/admin-audit";
import { getPlans } from "@/lib/plans-server";

const VALID_STATUS = new Set(["pending", "approved", "rejected", "suspended"]);

// GET — full drill-down for one shop: profile, owner, barbers, subscription +
// Stripe Connect health, revenue (GMV through this shop), appointment count,
// recent transactions, and the private admin note.
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  if (!(await requireSuperAdmin(req))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = params;

  const { data: shop, error } = await supabaseAdmin
    .from("shops").select("*, users(id, name, email, phone)").eq("id", id).maybeSingle();
  if (error || !shop) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const [{ data: barbers }, { data: txAll }, { count: apptCount }, { data: recentTx }, { data: meta }, plans] = await Promise.all([
    supabaseAdmin.from("barbers").select("id, name, is_active, rating, total_reviews").eq("shop_id", id).order("created_at", { ascending: true }),
    supabaseAdmin.from("transactions").select("amount").eq("shop_id", id),
    supabaseAdmin.from("appointments").select("id", { count: "exact", head: true }).eq("shop_id", id),
    supabaseAdmin.from("transactions").select("id, amount, tip, payment_method, type, client_name, service_name, created_at").eq("shop_id", id).order("created_at", { ascending: false }).limit(10),
    supabaseAdmin.from("shop_admin_meta").select("note, updated_at").eq("shop_id", id).maybeSingle(),
    getPlans(),
  ]);

  const gmv = (txAll ?? []).reduce((s: number, t: { amount: number }) => s + (Number(t.amount) || 0), 0);

  return NextResponse.json({
    shop,
    barbers: barbers ?? [],
    stats: { gmv, txCount: (txAll ?? []).length, apptCount: apptCount ?? 0 },
    recentTransactions: recentTx ?? [],
    adminNote: meta?.note ?? "",
    plans: (plans ?? []).map(p => ({ id: p.id, name: p.name, price_cents: p.price_cents, is_active: p.is_active })),
  });
}

// PATCH — CEO actions on one shop: status, plan override, private note.
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const admin = await requireSuperAdmin(req);
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = params;

  const body = await req.json().catch(() => ({})) as {
    status?: string; rejection_reason?: string; subscription_plan?: string; admin_note?: string;
  };

  const { data: shop } = await supabaseAdmin.from("shops").select("name, status, subscription_plan").eq("id", id).maybeSingle();
  if (!shop) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // ── Status change ──
  if (body.status !== undefined) {
    if (!VALID_STATUS.has(body.status)) return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    const update: Record<string, string | null> = { status: body.status };
    if (body.status === "rejected") update.rejection_reason = body.rejection_reason ?? null;
    const { error } = await supabaseAdmin.from("shops").update(update).eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    await logAdminAction(admin, {
      action: `shop.${body.status}`, target_type: "shop", target_id: id, target_label: shop.name,
      meta: { from: shop.status, to: body.status, ...(body.rejection_reason ? { reason: body.rejection_reason } : {}) },
    });
  }

  // ── Manual plan override (comp / upgrade / downgrade) ──
  if (body.subscription_plan !== undefined && body.subscription_plan !== shop.subscription_plan) {
    const plans = await getPlans();
    if (!plans.some(p => p.id === body.subscription_plan)) {
      return NextResponse.json({ error: "Unknown plan" }, { status: 400 });
    }
    const { error } = await supabaseAdmin.from("shops").update({ subscription_plan: body.subscription_plan }).eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    await logAdminAction(admin, {
      action: "shop.plan_change", target_type: "shop", target_id: id, target_label: shop.name,
      meta: { from: shop.subscription_plan, to: body.subscription_plan },
    });
  }

  // ── Private admin note ──
  if (body.admin_note !== undefined) {
    const { error } = await supabaseAdmin.from("shop_admin_meta").upsert(
      { shop_id: id, note: body.admin_note.slice(0, 5000), updated_at: new Date().toISOString(), updated_by: admin.id },
      { onConflict: "shop_id" },
    );
    if (error) return NextResponse.json({ error: "Couldn't save the note — run the phase27 migration first." }, { status: 500 });
    await logAdminAction(admin, { action: "shop.note", target_type: "shop", target_id: id, target_label: shop.name });
  }

  return NextResponse.json({ ok: true });
}
