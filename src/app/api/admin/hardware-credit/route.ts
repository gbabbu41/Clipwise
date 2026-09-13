import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { requireSuperAdmin } from "@/lib/admin-auth";
import { logAdminAction } from "@/lib/admin-audit";
import { grantHardwareCredit } from "@/lib/hardware-credit";

// Admin review queue for the card-reader credit (interim manual flow).
//   GET  — list every shop with credit activity (requested / granted / rejected).
//   POST — { shop_id, action: "approve" | "reject", note? }
//          approve → applies the Stripe balance credit (grantHardwareCredit);
//          reject  → records the rejection so the barber can re-request.
// super_admin only. This is the gate that actually moves money, so it's the ONE
// place the credit can be granted — an owner can only REQUEST it.

export async function GET(req: NextRequest) {
  const admin = await requireSuperAdmin(req);
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { data: shops } = await supabaseAdmin
    .from("shops")
    .select("id, name, slug, email, stripe_customer_id, hardware_credit_granted, hardware_credit_amount_cents, hardware_credit_at, hardware_credit_requested_at, hardware_credit_rejected_at, hardware_credit_note, users(name, email)")
    .or("hardware_credit_requested_at.not.is.null,hardware_credit_granted.eq.true,hardware_credit_rejected_at.not.is.null")
    .order("hardware_credit_requested_at", { ascending: false, nullsFirst: false });

  return NextResponse.json({ shops: shops ?? [] });
}

export async function POST(req: NextRequest) {
  const admin = await requireSuperAdmin(req);
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { shop_id, action, note } = await req.json().catch(() => ({})) as {
    shop_id?: string; action?: string; note?: string;
  };
  if (!shop_id) return NextResponse.json({ error: "Missing shop_id" }, { status: 400 });
  if (action !== "approve" && action !== "reject") {
    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  }

  const { data: shop } = await supabaseAdmin
    .from("shops")
    .select("id, name, hardware_credit_granted")
    .eq("id", shop_id)
    .maybeSingle();
  if (!shop) return NextResponse.json({ error: "Shop not found" }, { status: 404 });

  if (action === "reject") {
    if (shop.hardware_credit_granted) {
      return NextResponse.json({ error: "Credit already applied — can't reject." }, { status: 400 });
    }
    const { error } = await supabaseAdmin
      .from("shops")
      .update({ hardware_credit_rejected_at: new Date().toISOString(), hardware_credit_requested_at: null, hardware_credit_note: note ?? null })
      .eq("id", shop_id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    await logAdminAction(admin, {
      action: "hardware_credit.reject", target_type: "shop", target_id: shop_id, target_label: shop.name,
      meta: note ? { note } : {},
    });
    return NextResponse.json({ ok: true, status: "rejected" });
  }

  // approve → apply the credit (idempotent, guarded inside grantHardwareCredit).
  const result = await grantHardwareCredit(shop_id);
  if (!result.ok) {
    const msg = result.reason === "no_subscription"
      ? "This shop has no Stripe subscription yet, so a credit can't be applied."
      : result.reason === "already_granted"
        ? "Credit was already applied to this shop."
        : "Couldn't apply the credit — please try again.";
    // already_granted is not really an error — reconcile the flags and report ok.
    if (result.reason === "already_granted") {
      await supabaseAdmin.from("shops").update({ hardware_credit_requested_at: null, hardware_credit_rejected_at: null }).eq("id", shop_id);
      return NextResponse.json({ ok: true, status: "granted", note: msg });
    }
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  // Leave the pending queue once granted.
  await supabaseAdmin.from("shops").update({ hardware_credit_requested_at: null, hardware_credit_rejected_at: null }).eq("id", shop_id);
  await logAdminAction(admin, {
    action: "hardware_credit.approve", target_type: "shop", target_id: shop_id, target_label: shop.name,
    meta: { amount_cents: result.amountCents },
  });
  return NextResponse.json({ ok: true, status: "granted", amountCents: result.amountCents });
}
