import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { effectivePlan, planHasFeature } from "@/lib/validation";
import { ensurePlansHydrated } from "@/lib/plans-server";
import { enforceRateLimit } from "@/lib/rate-limit";
import { createGiftCheckoutSession, generateGiftCode } from "@/lib/gift-card-server";

// Buy a gift card online → hosted Stripe Checkout on the shop's connected
// account. The gift_cards row is created on return via /gift-finalize once
// Stripe confirms payment (so an abandoned checkout never mints a card). Used by
// the public gift page AND the owner portal ("Charge card" → return_path back to
// the dashboard). Connect required, so money always lands in the shop's account.
export async function POST(request: NextRequest) {
  const limited = enforceRateLimit(request, "gift-checkout", 12, 60_000);
  if (limited) return limited;

  const b = await request.json() as {
    shop_slug: string; origin: string; amount: number;
    recipient_name?: string; recipient_email?: string;
    purchaser_name?: string; purchaser_email?: string; note?: string;
    return_path?: string; // where Stripe returns the buyer (defaults to /gift/[slug])
  };
  const amount = Number(b.amount);
  if (!b.shop_slug || !amount || amount <= 0) return NextResponse.json({ error: "Invalid amount" }, { status: 400 });
  if (amount > 1000) return NextResponse.json({ error: "Maximum gift card is $1000" }, { status: 400 });

  const { data: shop } = await supabaseAdmin
    .from("shops").select("id, name, slug, status, stripe_account_id, stripe_connected, subscription_plan, subscription_status")
    .eq("slug", b.shop_slug).maybeSingle();
  if (!shop || shop.status !== "approved") return NextResponse.json({ error: "Shop not found" }, { status: 404 });

  await ensurePlansHydrated();
  const plan = effectivePlan(shop.subscription_plan, shop.subscription_status);
  if (!planHasFeature(plan, "loyalty")) return NextResponse.json({ error: "Gift cards aren't available for this shop." }, { status: 403 });

  if (!(shop.stripe_account_id && shop.stripe_connected)) {
    return NextResponse.json({ error: "This shop can't sell gift cards online yet." }, { status: 409 });
  }

  const origin = b.origin || process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  try {
    const url = await createGiftCheckoutSession({
      shop, origin, returnPath: b.return_path,
      meta: {
        code: generateGiftCode(), amount,
        recipient_name: b.recipient_name, recipient_email: b.recipient_email,
        purchaser_name: b.purchaser_name, purchaser_email: b.purchaser_email, note: b.note,
      },
    });
    if (!url) return NextResponse.json({ error: "Couldn't start checkout." }, { status: 500 });
    return NextResponse.json({ url });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Stripe error" }, { status: 500 });
  }
}
