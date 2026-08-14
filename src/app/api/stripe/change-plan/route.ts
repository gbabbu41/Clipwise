import { NextRequest, NextResponse } from "next/server";
import { stripe, PLAN_PRICING } from "@/lib/stripe";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { ensurePlansHydrated, getPlanById } from "@/lib/plans-server";
import { getLocationLimit } from "@/lib/validation";
import { changePlanPrice, reconcileLocationAddon } from "@/lib/stripe-addons";

// Switch an EXISTING paid subscription to a different plan, WITH PRORATION and
// no new checkout — the fix for two audit findings:
//   • no more "brand-new subscription per change" (which could leave a ghost
//     second subscription billing forever), and
//   • the owner is credited for unused days instead of paying a fresh full month.
//
// Account-level by design: all of an owner's locations share ONE subscription,
// so the plan is applied to every shop they own. If there's no existing paid
// subscription (Starter / no-card trial / cancelled), we return 409 so the
// client falls back to Checkout (which collects a card).
export async function POST(request: NextRequest) {
  const token = request.headers.get("Authorization")?.replace("Bearer ", "");
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(token);
  if (authErr || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { plan } = await request.json().catch(() => ({})) as { plan?: string };
  if (!plan) return NextResponse.json({ error: "Missing plan" }, { status: 400 });

  // Price + name are server-authoritative (admin-editable DB plan, hardcoded
  // fallback pre-migration). A purchasable plan is active with a price > 0.
  const planRows = await ensurePlansHydrated();
  const dbPlan = getPlanById(planRows, plan);
  let amount: number;
  let planName: string;
  if (dbPlan && dbPlan.is_active && dbPlan.price_cents > 0) {
    amount = dbPlan.price_cents;
    planName = dbPlan.name;
  } else {
    const fallback = PLAN_PRICING[plan];
    if (!fallback) return NextResponse.json({ error: "Invalid plan" }, { status: 400 });
    amount = fallback.amount;
    planName = fallback.name;
  }

  // Find the owner's shared subscription (any owned shop carries the id).
  const { data: shops } = await supabaseAdmin
    .from("shops").select("id, stripe_subscription_id, subscription_status")
    .eq("owner_id", user.id);
  const subId = (shops ?? []).map((s) => s.stripe_subscription_id).find(Boolean) as string | undefined;
  const status = shops?.find((s) => s.stripe_subscription_id)?.subscription_status;

  // No live paid subscription to modify → caller collects a card via Checkout.
  if (!subId || (status !== "active" && status !== "past_due")) {
    return NextResponse.json({ error: "no_subscription" }, { status: 409 });
  }

  // Switch the plan line item with proration (add-ons untouched).
  try {
    await changePlanPrice(subId, amount, planName, plan);
  } catch (err) {
    console.error("[change-plan] Stripe update failed", err);
    return NextResponse.json({ error: "Couldn't change your plan — please try again." }, { status: 502 });
  }

  // Apply the new plan to ALL of the owner's shops (they share the subscription).
  const { error: upErr } = await supabaseAdmin.from("shops")
    .update({ subscription_plan: plan, subscription_status: "active" })
    .eq("owner_id", user.id);
  if (upErr) {
    console.error("[change-plan] DB update failed", upErr);
    return NextResponse.json({ error: "Plan changed with Stripe, but we couldn't update your account — refresh in a moment." }, { status: 500 });
  }

  // Re-derive the extra-location add-on for the NEW plan's included count, so a
  // plan whose included-location allowance changed keeps billing correctly.
  try {
    const { count } = await supabaseAdmin.from("shops")
      .select("id", { count: "exact", head: true }).eq("owner_id", user.id);
    const extra = Math.max(0, (count ?? 0) - getLocationLimit(plan));
    await reconcileLocationAddon(subId, extra);
  } catch (err) {
    // Non-fatal: the plan changed; the add-on reconciles again on the next
    // location add/remove or the daily reconciliation. Log and move on.
    console.error("[change-plan] location add-on reconcile failed (non-fatal)", err);
  }

  return NextResponse.json({ ok: true, plan });
}
