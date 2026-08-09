import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

// Start a no-card 21-day Pro/Premium trial for an EXISTING shop (the in-dashboard
// equivalent of picking a trial at onboarding). Mirrors the trial grant in
// /api/shops/create: sets the plan + subscription_status active + trial_ends_at,
// no Stripe sub / card. The daily cron downgrades it to Starter if no card is
// added before it ends.
//
// Guards against abuse (never trust the client): owner-scoped, one free trial
// EVER (trial_ends_at must be null), and never while a paid subscription exists.
const TRIAL_DAYS = 21;
const PAID_PLANS = new Set(["pro", "premium", "business"]);

export async function POST(request: NextRequest) {
  const token = request.headers.get("Authorization")?.replace("Bearer ", "");
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(token);
  if (authErr || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { plan: rawPlan, shop_id } = await request.json().catch(() => ({})) as { plan?: string; shop_id?: string };
  const plan = (rawPlan ?? "").toLowerCase();
  if (!PAID_PLANS.has(plan)) {
    return NextResponse.json({ error: "Pick a Pro or Premium plan to start a trial." }, { status: 400 });
  }

  // Owner-scoped: a shop_id the caller doesn't own resolves to nothing → 404.
  let q = supabaseAdmin
    .from("shops")
    .select("id, subscription_plan, subscription_status, trial_ends_at, stripe_subscription_id, status")
    .eq("owner_id", user.id);
  if (shop_id) q = q.eq("id", shop_id);
  const { data: rows } = await q.order("created_at", { ascending: true }).limit(1);
  const shop = rows?.[0];
  if (!shop) return NextResponse.json({ error: "No shop found" }, { status: 404 });

  // One free trial ever, and never while a real subscription is in place.
  if (shop.stripe_subscription_id) {
    return NextResponse.json({ error: "You already have a paid subscription." }, { status: 409 });
  }
  if (shop.trial_ends_at) {
    return NextResponse.json(
      { error: "You've already used your free trial. Add a card from Billing to upgrade." },
      { status: 409 },
    );
  }

  const trialEndsAt = new Date(Date.now() + TRIAL_DAYS * 86_400_000).toISOString();
  const upd: Record<string, unknown> = {
    subscription_plan: plan,
    subscription_status: "active",
    trial_ends_at: trialEndsAt,
  };
  // A pending shop becomes usable immediately on trial (matches onboarding);
  // never reactivate a suspended/rejected shop this way.
  if (shop.status === "pending") upd.status = "approved";

  let r = await supabaseAdmin
    .from("shops").update(upd).eq("id", shop.id).eq("owner_id", user.id)
    .select("id, subscription_plan, subscription_status, trial_ends_at, status").single();
  // Resilient to phase34 not being run yet: retry without trial_ends_at.
  if (r.error && /trial_ends_at/.test(r.error.message) && /column|does not exist|schema cache/i.test(r.error.message)) {
    const { trial_ends_at: _t, ...noTrial } = upd;
    r = await supabaseAdmin
      .from("shops").update(noTrial).eq("id", shop.id).eq("owner_id", user.id)
      .select("id, subscription_plan, subscription_status, status").single();
  }
  if (r.error) return NextResponse.json({ error: "Couldn't start your trial. Please try again." }, { status: 500 });

  return NextResponse.json({ ok: true, shop: r.data, trialEndsAt });
}
