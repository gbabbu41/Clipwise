import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { authorizeShop } from "@/lib/api-auth";
import { ensureTerminalLocation } from "@/lib/terminal";
import { ensurePlansHydrated } from "@/lib/plans-server";
import { effectivePlan, planHasFeature } from "@/lib/validation";

/**
 * Mint a Stripe Terminal connection token on the shop's CONNECTED account.
 *
 * The native app calls this first to initialize the Terminal SDK before pairing
 * a WisePad 3 (Bluetooth) or connecting Tap to Pay. Also returns the shop's
 * Terminal Location id (needed to connect Tap to Pay; optional for Bluetooth).
 *
 * Auth: shop owner OR an active barber (same gate as POS). Requires the payments
 * plan feature + completed Stripe Connect (charges run on the connected account).
 * Dormant on the web — only the native app ever calls it.
 */
export async function POST(req: NextRequest) {
  const { shop_id } = (await req.json().catch(() => ({}))) as { shop_id?: string };

  const auth = await authorizeShop(req, shop_id);
  if ("error" in auth) return auth.error;
  const shop = auth.shop as {
    id: string; stripe_account_id?: string | null; stripe_connected?: boolean;
    subscription_plan?: string | null; subscription_status?: string | null;
  };

  await ensurePlansHydrated();
  if (!planHasFeature(effectivePlan(shop.subscription_plan ?? undefined, shop.subscription_status ?? undefined), "payments")) {
    return NextResponse.json({ error: "Card payments aren't included on this plan." }, { status: 403 });
  }
  if (!shop.stripe_account_id || !shop.stripe_connected) {
    return NextResponse.json({ error: "Finish Stripe setup before using a card reader." }, { status: 400 });
  }

  try {
    const token = await stripe.terminal.connectionTokens.create({}, { stripeAccount: shop.stripe_account_id });
    // Best-effort — a missing shop address just yields null (Bluetooth still pairs).
    const locationId = await ensureTerminalLocation(shop);
    return NextResponse.json({ secret: token.secret, location_id: locationId });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Terminal error" }, { status: 500 });
  }
}
