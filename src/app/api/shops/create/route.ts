import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { supabaseAdmin } from "@/lib/supabase-admin";

// Server-authoritative shop creation for onboarding.
//
// Previously the shop row was INSERTed from the browser, letting anyone set
// status='approved' / subscription_plan='premium' / subscription_status='active'
// and mint a free, self-approved premium shop (the shops_insert_owner RLS only
// checks owner_id, and the escalation trigger is BEFORE UPDATE — it never fires
// on INSERT). This route is the only trusted path: it forces safe defaults and
// only grants a paid plan + auto-approval when it can VERIFY, against Stripe,
// that this user actually holds an active subscription for that plan.

const KNOWN_PLANS = new Set(["starter", "pro", "premium", "business"]);

const slugify = (s: string) =>
  (s || "shop").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "shop";

export async function POST(request: NextRequest) {
  const token = request.headers.get("Authorization")?.replace("Bearer ", "");
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(token);
  if (authErr || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json() as {
    name?: string; address?: string; city?: string; province?: string; postal_code?: string;
    phone?: string; email?: string; description?: string; logo?: string;
    subscription_id?: string;
  };
  if (!body.name?.trim()) return NextResponse.json({ error: "Shop name is required" }, { status: 400 });

  // ── Verify payment SERVER-SIDE — never trust a client-claimed plan/status ──
  let plan = "starter";
  let subscriptionStatus = "inactive";
  let status = "pending";                 // free/unpaid → admin review
  let stripeSubscriptionId: string | null = null;
  let stripeCustomerId: string | null = null;

  if (body.subscription_id) {
    try {
      const sub = await stripe.subscriptions.retrieve(body.subscription_id);
      const active = sub.status === "active" || sub.status === "trialing";
      const ownsIt = sub.metadata?.user_id === user.id;      // set by /api/stripe/checkout
      const subPlan = (sub.metadata?.plan ?? "").toLowerCase();
      if (active && ownsIt && KNOWN_PLANS.has(subPlan) && subPlan !== "starter") {
        plan = subPlan;
        subscriptionStatus = "active";
        status = "approved";               // paid + verified → skip the approval queue
        stripeSubscriptionId = sub.id;
        stripeCustomerId = typeof sub.customer === "string" ? sub.customer : sub.customer?.id ?? null;
      }
      // Anything not verified silently falls back to the safe defaults above.
    } catch {
      // Bad/foreign subscription id → treat as unpaid. No error to the client.
    }
  }

  // Whitelist the fields the client may set — everything privileged is derived
  // above, so a crafted body can't inject status/plan/subscription_*.
  const baseRow = {
    owner_id: user.id,
    name: body.name.trim(),
    address: body.address ?? null,
    city: body.city ?? null,
    province: body.province ?? null,
    postal_code: body.postal_code ?? null,
    phone: body.phone ?? null,
    email: body.email ?? null,
    description: body.description ?? null,
    ...(body.logo ? { logo: body.logo } : {}),
    status,
    subscription_plan: plan,
    subscription_status: subscriptionStatus,
    stripe_subscription_id: stripeSubscriptionId,
    stripe_customer_id: stripeCustomerId,
  };

  // Unique slug — retry once with a fresh suffix on collision.
  const base = slugify(body.name);
  for (let attempt = 0; attempt < 3; attempt++) {
    const slug = `${base}-${Math.random().toString(36).slice(2, 6)}`;
    const { data, error } = await supabaseAdmin
      .from("shops").insert({ ...baseRow, slug }).select("id, slug, status, subscription_plan").single();
    if (!error && data) return NextResponse.json({ ok: true, shop: data });
    if (error && !/slug|unique|duplicate|23505/i.test(error.message)) {
      return NextResponse.json({ error: "Couldn't create the shop. Please try again." }, { status: 500 });
    }
  }
  return NextResponse.json({ error: "Couldn't generate a unique shop URL. Please try again." }, { status: 500 });
}
