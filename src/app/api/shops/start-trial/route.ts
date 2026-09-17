import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { isNativeRequest } from "@/lib/native-app";

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
  // Apple IAP: trials/plans are a ClipWise-subscription surface — never in the app.
  if (isNativeRequest(request)) {
    return NextResponse.json({ error: "Not available in the app." }, { status: 403 });
  }
  const token = request.headers.get("Authorization")?.replace("Bearer ", "");
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(token);
  if (authErr || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Choose a valid plan and shop." }, { status: 400 });
  }
  const { plan: rawPlan, shop_id } = body as { plan?: string; shop_id?: string };
  if (typeof rawPlan !== "string" || (shop_id !== undefined && typeof shop_id !== "string")) {
    return NextResponse.json({ error: "Choose a valid plan and shop." }, { status: 400 });
  }
  const plan = rawPlan.toLowerCase();
  if (!PAID_PLANS.has(plan)) {
    return NextResponse.json({ error: "Pick a Pro or Premium plan to start a trial." }, { status: 400 });
  }

  // Owner-scoped: a shop_id the caller doesn't own resolves to nothing → 404.
  let q = supabaseAdmin
    .from("shops")
    .select("id, subscription_plan, subscription_status, trial_ends_at, trial_used, trial_ended_at, stripe_subscription_id, status")
    .eq("owner_id", user.id);
  if (shop_id) q = q.eq("id", shop_id);
  const { data: rows, error: readError } = await q.order("created_at", { ascending: true }).limit(1);
  if (readError) return NextResponse.json({ error: "Couldn't check trial eligibility. Please try again." }, { status: 503 });
  const shop = rows?.[0];
  if (!shop) return NextResponse.json({ error: "No shop found" }, { status: 404 });

  // One free trial EVER, and never while a real subscription is in place.
  // `trial_used` is a permanent flag (set below on first trial, never cleared) —
  // the old `trial_ends_at` guard was defeatable because that field gets wiped
  // when a trial ends or is cancelled, letting a shop loop trials forever.
  if (shop.stripe_subscription_id) {
    return NextResponse.json({ error: "You already have a paid subscription." }, { status: 409 });
  }
  if ((shop as { trial_used?: boolean }).trial_used || shop.trial_ends_at || shop.trial_ended_at) {
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
    trial_used: true,   // permanent — blocks any future trial restart
  };
  // A pending shop becomes usable immediately on trial (matches onboarding);
  // never reactivate a suspended/rejected shop this way.
  if (shop.status === "pending") upd.status = "approved";

  // Claim eligibility in the write itself: two tabs cannot both grant a trial,
  // and a concurrent paid activation or shop suspension cannot be overwritten.
  const r = await supabaseAdmin
    .from("shops").update(upd).eq("id", shop.id).eq("owner_id", user.id)
    .eq("trial_used", false).is("trial_ends_at", null).is("trial_ended_at", null)
    .is("stripe_subscription_id", null).eq("status", shop.status)
    .select("id, subscription_plan, subscription_status, trial_ends_at, status").maybeSingle();
  if (r.error) return NextResponse.json({ error: "Couldn't start your trial. Please try again." }, { status: 500 });
  if (!r.data) return NextResponse.json({ error: "Your trial eligibility changed. Refresh Billing before trying again." }, { status: 409 });

  return NextResponse.json({ ok: true, shop: r.data, trialEndsAt });
}
