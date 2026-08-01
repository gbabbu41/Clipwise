import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { authorizeShop } from "@/lib/api-auth";
import { effectivePlan, planHasFeature } from "@/lib/validation";
import { ensurePlansHydrated } from "@/lib/plans-server";
import { sendAppEmail } from "@/lib/emailer";
import { createGiftCheckoutSession, generateGiftCode } from "@/lib/gift-card-server";

// Owner "send payment link": create a real Stripe gift-card checkout and email
// the link to the customer, so they pay from their own phone. The card is minted
// + emailed on payment via /gift-finalize. Owner/staff-auth (it sends email +
// moves money, so never public).
export async function POST(request: NextRequest) {
  const b = await request.json() as {
    shop_id: string; amount: number; send_to: string;
    purchaser_name?: string; recipient_name?: string; recipient_email?: string; note?: string;
  };
  if (!b.shop_id || !b.send_to?.trim()) return NextResponse.json({ error: "Missing recipient email" }, { status: 400 });
  const auth = await authorizeShop(request, b.shop_id);
  if ("error" in auth) return auth.error;

  const amount = Number(b.amount);
  if (!amount || amount <= 0 || amount > 1000) return NextResponse.json({ error: "Invalid amount" }, { status: 400 });

  const { data: shop } = await supabaseAdmin
    .from("shops").select("id, name, slug, email, stripe_account_id, stripe_connected, subscription_plan, subscription_status").eq("id", b.shop_id).maybeSingle();
  if (!shop) return NextResponse.json({ error: "Shop not found" }, { status: 404 });

  await ensurePlansHydrated();
  const plan = effectivePlan(shop.subscription_plan, shop.subscription_status);
  if (!planHasFeature(plan, "loyalty")) return NextResponse.json({ error: "Gift cards require a paid plan." }, { status: 403 });
  if (!(shop.stripe_account_id && shop.stripe_connected)) {
    return NextResponse.json({ error: "Finish Stripe setup to charge cards — you can still issue a cash gift card." }, { status: 409 });
  }

  const sendTo = b.send_to.trim();
  const origin = request.headers.get("origin") || process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  try {
    const url = await createGiftCheckoutSession({
      shop, origin,
      meta: {
        code: generateGiftCode(), amount,
        recipient_name: b.recipient_name, recipient_email: b.recipient_email?.trim() || sendTo,
        purchaser_name: b.purchaser_name, purchaser_email: sendTo, note: b.note,
      },
    });
    if (!url) return NextResponse.json({ error: "Couldn't create the payment link." }, { status: 500 });
    await sendAppEmail("marketing_campaign", {
      to: sendTo,
      subject: `Complete your $${amount.toFixed(2)} gift card — ${shop.name}`,
      htmlBody: `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px;">
        <h2 style="color:#111;">Your gift card is one tap away 🎁</h2>
        <p style="color:#444;line-height:1.6;">${shop.name} set up a $${amount.toFixed(2)} gift card for you. Tap below to pay securely — your code arrives by email right after.</p>
        <a href="${url}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;padding:12px 22px;border-radius:10px;font-weight:700;margin:12px 0;">Pay $${amount.toFixed(2)} →</a>
        <p style="font-size:12px;color:#999;">Secure payment by Stripe.</p>
      </div>`,
      shopEmail: shop.email ?? "",
    }).catch(() => null);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Stripe error" }, { status: 500 });
  }
}
