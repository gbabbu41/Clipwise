import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getPlatformSettings } from "@/lib/platform-settings";
import { clampLen, FIELD_CAPS } from "@/lib/validation";
import { DEFAULT_BOOKING_SETTINGS } from "@/lib/booking-defaults";
import { tzForProvince, DEFAULT_TZ } from "@/lib/timezone";
import { sendAppEmail } from "@/lib/emailer";
import { prettyDate } from "@/lib/utils";

// Fire the welcome email to the new owner + a heads-up to the admin the moment a
// shop is created. Server-side and best-effort: a Resend hiccup must NEVER block
// or fail account creation, so everything is wrapped and awaited-then-ignored.
// (This used to live in the /onboarding page; the frictionless signup skips that
// page, so it now lives here — the one path EVERY new shop funnels through.)
async function sendNewShopEmails(opts: {
  ownerEmail: string; ownerName: string; shopName: string; slug: string;
  plan: string; subscriptionStatus: string; trialEndsAt: string | null; autoApproved: boolean;
  city: string; province: string; ownerPhone: string;
}) {
  const { ownerEmail, ownerName, shopName, slug, plan, subscriptionStatus, trialEndsAt, autoApproved, city, province, ownerPhone } = opts;
  const planLabel = plan.charAt(0).toUpperCase() + plan.slice(1);
  const statusKind = trialEndsAt ? "trial" : (subscriptionStatus === "active" && plan !== "starter" ? "paid" : "free");
  try {
    if (ownerEmail) {
      // Live shop → the full welcome (booking page is up). Still-pending shop
      // (auto-approve off) → the "we got you, under review" note instead, so we
      // never tell someone their page is live when it isn't.
      const ownerType = autoApproved ? "shop_welcome" : "shop_submitted_confirmation";
      await sendAppEmail(ownerType, {
        ownerEmail, ownerName, shopName, slug,
        planLabel, statusKind,
        trialEndsOn: trialEndsAt ? prettyDate(trialEndsAt.slice(0, 10)) : "",
      });
    }
  } catch { /* logged inside sendAppEmail; never block signup */ }
  try {
    await sendAppEmail("new_shop_application", {
      shopName, ownerName, ownerEmail, slug, ownerPhone,
      city: city || "—", province: province || "—", services: "—",
      plan: planLabel, autoApproved: autoApproved ? "true" : "false",
    });
  } catch { /* best-effort admin heads-up */ }
}

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

  // One-shop guard + idempotency. This route creates the owner's FIRST shop, and
  // it mints a fresh random slug on EVERY call — so a second call (double-submit,
  // resumed/abandoned onboarding, browser back) would create a DUPLICATE shop
  // (the Starter "two shops, one email" bug). If the owner already has a shop,
  // return it instead of creating another. Additional locations go through
  // /api/shops/add-location, which enforces the multi-location (Premium) gate.
  {
    const { data: existing } = await supabaseAdmin
      .from("shops").select("id, slug, status, subscription_plan")
      .eq("owner_id", user.id).order("created_at", { ascending: true }).limit(1);
    if (existing && existing.length > 0) {
      return NextResponse.json({ ok: true, shop: existing[0], existing: true });
    }
  }

  const body = await request.json() as {
    name?: string; address?: string; city?: string; province?: string; postal_code?: string;
    phone?: string; email?: string; description?: string; logo?: string;
    subscription_id?: string;
    trial_plan?: string;   // pro/premium → start a no-card 21-day trial
  };
  if (!body.name?.trim()) return NextResponse.json({ error: "Shop name is required" }, { status: 400 });

  // ── Verify payment SERVER-SIDE — never trust a client-claimed plan/status ──
  let plan = "starter";
  let subscriptionStatus = "inactive";
  let status = "pending";                 // free/unpaid → admin review
  let stripeSubscriptionId: string | null = null;
  let stripeCustomerId: string | null = null;
  let trialEndsAt: string | null = null;

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

  // No-card trial: owner picked Pro/Premium without paying. Grant that plan for
  // 21 days (subscription_status active + trial_ends_at, NO Stripe sub / card),
  // and approve so the trial is usable immediately. The daily cron downgrades it
  // to starter if they don't add a card before it ends. Only applies when no
  // verified paid subscription was found above.
  const TRIAL_DAYS = 21;
  const trialPlan = (body.trial_plan ?? "").toLowerCase();
  if (plan === "starter" && !stripeSubscriptionId && KNOWN_PLANS.has(trialPlan) && trialPlan !== "starter") {
    plan = trialPlan;
    subscriptionStatus = "active";
    status = "approved";
    trialEndsAt = new Date(Date.now() + TRIAL_DAYS * 86_400_000).toISOString();
  }

  // Admin lever: when auto-approve is on, a free/unpaid shop skips the review
  // queue too. Paid+verified shops are already approved above; this only lifts
  // the still-pending ones. (Plan/subscription remain untouched — free stays free.)
  if (status === "pending") {
    const platform = await getPlatformSettings();
    if (platform.auto_approve_shops) status = "approved";
  }

  // Normalize the province (2-letter codes to upper-case) and derive the shop's
  // timezone from it, so every past-slot / cancellation-window / reminder decision
  // runs in the shop's real local time. Falls back to the market default only when
  // no province is given. (An owner can still override the tz later in Settings.)
  const rawProvince = (body.province ?? "").trim();
  const province = rawProvince ? (rawProvince.length === 2 ? rawProvince.toUpperCase() : rawProvince) : null;
  const timezone = tzForProvince(province) ?? DEFAULT_TZ;

  // Whitelist the fields the client may set — everything privileged is derived
  // above, so a crafted body can't inject status/plan/subscription_*.
  const baseRow = {
    owner_id: user.id,
    name: body.name.trim(),
    address: body.address ?? null,
    city: body.city ?? null,
    province,
    timezone,
    postal_code: body.postal_code ?? null,
    phone: body.phone ?? null,
    email: body.email ?? null,
    description: clampLen(body.description ?? null, FIELD_CAPS.shop_description),
    ...(body.logo ? { logo: body.logo } : {}),
    // Persist the FULL default booking policy (not just loyalty + reminders) so the
    // DB matches what Settings → Booking shows. Writing only a partial object used
    // to leave no_show_protection absent → the booking page read it as OFF → paid
    // shops silently couldn't take online payments even though the toggle showed
    // ON. See lib/booking-defaults for the full rationale + per-key notes.
    booking_settings: DEFAULT_BOOKING_SETTINGS,
    status,
    subscription_plan: plan,
    subscription_status: subscriptionStatus,
    stripe_subscription_id: stripeSubscriptionId,
    stripe_customer_id: stripeCustomerId,
    trial_ends_at: trialEndsAt,
  };

  // Unique slug — retry once with a fresh suffix on collision.
  const base = slugify(body.name);
  for (let attempt = 0; attempt < 3; attempt++) {
    const slug = `${base}-${Math.random().toString(36).slice(2, 6)}`;
    let ins = await supabaseAdmin
      .from("shops").insert({ ...baseRow, slug }).select("id, slug, status, subscription_plan").single();
    // Resilient to the phase34 migration not being run yet: if trial_ends_at
    // doesn't exist, retry without it so shop creation never breaks.
    if (ins.error && /trial_ends_at/.test(ins.error.message) && /column|does not exist|schema cache/i.test(ins.error.message)) {
      const { trial_ends_at: _t, ...noTrial } = baseRow;
      ins = await supabaseAdmin.from("shops").insert({ ...noTrial, slug }).select("id, slug, status, subscription_plan").single();
    }
    if (!ins.error && ins.data) {
      // Welcome the new owner + notify admin — best-effort, never blocks signup.
      const { data: prof } = await supabaseAdmin.from("users").select("name").eq("id", user.id).maybeSingle();
      await sendNewShopEmails({
        ownerEmail: user.email ?? body.email ?? "",
        ownerName: (prof?.name ?? "").trim(),
        shopName: baseRow.name,
        slug,
        plan,
        subscriptionStatus,
        trialEndsAt,
        autoApproved: status === "approved",
        city: body.city ?? "",
        province: province ?? "",
        ownerPhone: body.phone ?? "",
      });
      return NextResponse.json({ ok: true, shop: ins.data });
    }
    if (ins.error && !/slug|unique|duplicate|23505/i.test(ins.error.message)) {
      return NextResponse.json({ error: "Couldn't create the shop. Please try again." }, { status: 500 });
    }
  }
  return NextResponse.json({ error: "Couldn't generate a unique shop URL. Please try again." }, { status: 500 });
}
