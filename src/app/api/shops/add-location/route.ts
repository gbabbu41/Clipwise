import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { ensurePlansHydrated } from "@/lib/plans-server";
import { planHasFeature, effectivePlan, getLocationLimit } from "@/lib/validation";

// Add ANOTHER location for an existing owner.
//
// This is the trusted, service-role path (like /api/shops/create). It exists
// because the old client-side insert always landed in the approval queue: the
// anon insert is force-clamped to status='pending' by the phase24/phase31
// triggers, and the auto-approval logic only lived in the create route. A
// second location for a VERIFIED paying owner should skip approval entirely.
//
// What it guarantees:
//   • Auto-approved (status='approved') — no admin review for a paying owner.
//   • Reuses the owner's account email — never prompts for a new one / login.
//   • Shares the owner's ONE subscription (copies stripe_subscription_id /
//     customer_id) — no second $79 charge.
//   • Does NOT copy the Stripe Connect account — the new location gets its OWN
//     account on first "Connect Stripe", so each location's money stays fully
//     separate (its own balance + payouts). No cross-location leakage.

const slugify = (s: string) =>
  (s || "shop").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "shop";

export async function POST(request: NextRequest) {
  const token = request.headers.get("Authorization")?.replace("Bearer ", "");
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(token);
  if (authErr || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({})) as {
    name?: string; address?: string; city?: string; province?: string; postal_code?: string; phone?: string;
  };
  if (!body.name?.trim()) return NextResponse.json({ error: "Location name is required" }, { status: 400 });

  // The owner's existing shops carry the shared subscription + entitlement.
  const { data: existingShops } = await supabaseAdmin
    .from("shops")
    .select("id, email, subscription_plan, subscription_status, stripe_subscription_id, stripe_customer_id, booking_settings, created_at")
    .eq("owner_id", user.id)
    .order("created_at", { ascending: true });

  if (!existingShops || existingShops.length === 0) {
    return NextResponse.json({ error: "Create your first shop before adding a location." }, { status: 400 });
  }

  // ── Verify the multi-location entitlement (same check as the client gate) ──
  // The entitlement lives on the owner's ACTIVE subscription, shared across
  // their shops. Hydrate the live plan config first so this matches the
  // admin-editable plans exactly.
  await ensurePlansHydrated();
  const paid = existingShops.find(s =>
    s.subscription_status === "active" &&
    planHasFeature(effectivePlan(s.subscription_plan ?? undefined, s.subscription_status ?? undefined), "multi_location"),
  );
  if (!paid) {
    return NextResponse.json(
      { error: "Multiple locations are a Premium feature. Upgrade your plan to add another location." },
      { status: 403 },
    );
  }

  // Enforce the plan's location cap (Premium = 2). Beyond that is a paid add-on
  // we don't bill for yet, so block it cleanly rather than giving it away free.
  const limit = getLocationLimit(paid.subscription_plan ?? undefined);
  if (existingShops.length >= limit) {
    return NextResponse.json(
      { error: `Your plan includes ${limit} location${limit === 1 ? "" : "s"}. Contact us to add more.` },
      { status: 403 },
    );
  }

  // Inherit the first shop's booking policy (no-show, slot interval, tax, etc.)
  // so the new location works out of the box — but never inherit a paused state.
  const primaryBooking = existingShops[0].booking_settings as Record<string, unknown> | null;
  const inheritedBooking = primaryBooking ? { ...primaryBooking, bookings_paused: false } : null;

  const baseRow = {
    owner_id: user.id,
    name: body.name.trim(),
    address: body.address ?? null,
    city: body.city ?? null,
    province: body.province ?? null,
    postal_code: body.postal_code ?? null,
    phone: body.phone ?? null,
    // Reuse the owner's account email — no new email / login for a location.
    email: user.email ?? paid.email ?? null,
    is_active: true,
    // Auto-approved: verified paying owner, not a brand-new unknown shop.
    status: "approved",
    // Share the owner's one subscription — no second charge.
    subscription_plan: paid.subscription_plan,
    subscription_status: "active",
    stripe_subscription_id: paid.stripe_subscription_id ?? null,
    stripe_customer_id: paid.stripe_customer_id ?? null,
    // stripe_account_id intentionally omitted → NULL → its OWN Connect account,
    // so each location's balance/payouts stay separate. No cross-shop leakage.
    ...(inheritedBooking ? { booking_settings: inheritedBooking } : {}),
  };

  // Unique slug — retry with a fresh suffix on collision.
  const base = slugify(body.name);
  for (let attempt = 0; attempt < 3; attempt++) {
    const slug = `${base}-${Math.random().toString(36).slice(2, 6)}`;
    const { data, error } = await supabaseAdmin
      .from("shops").insert({ ...baseRow, slug }).select("*").single();
    if (!error && data) return NextResponse.json({ ok: true, shop: data });
    if (error && !/slug|unique|duplicate|23505/i.test(error.message)) {
      return NextResponse.json({ error: "Couldn't create the location. Please try again." }, { status: 500 });
    }
  }
  return NextResponse.json({ error: "Couldn't generate a unique location URL. Please try again." }, { status: 500 });
}
