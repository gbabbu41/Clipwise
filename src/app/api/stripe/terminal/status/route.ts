import { NextRequest, NextResponse } from "next/server";
import { authorizeShop } from "@/lib/api-auth";
import { ensurePlansHydrated } from "@/lib/plans-server";
import { effectivePlan, planHasFeature } from "@/lib/validation";
import { cardPaymentsActive, ensureTerminalLocation } from "@/lib/terminal";

/**
 * Terminal readiness gate — the native app calls this BEFORE showing any reader
 * UI. It answers one question: can this shop actually take money on a reader
 * right now? If not, the app should send them to finish Stripe onboarding rather
 * than let them pair a reader that will fail at payment time.
 *
 * `ready` is true only when: the plan includes payments, Connect is done, AND the
 * connected account's `card_payments` capability is ACTIVE (charges_enabled alone
 * isn't enough — a reader specifically needs card_payments). `reason` tells the
 * app what to show; `location_id` is returned when ready (needed for Tap to Pay,
 * optional for a Bluetooth WisePad 3).
 *
 * Auth: shop owner OR an active barber (same gate as the other terminal routes).
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
    return NextResponse.json({ ready: false, reason: "plan" });
  }
  if (!shop.stripe_account_id || !shop.stripe_connected) {
    return NextResponse.json({ ready: false, reason: "connect_incomplete" });
  }
  if (!(await cardPaymentsActive(shop.stripe_account_id))) {
    return NextResponse.json({ ready: false, reason: "card_payments_pending" });
  }

  // Ready — make sure the Location exists so the app can connect Tap to Pay.
  const locationId = await ensureTerminalLocation(auth.shop as Parameters<typeof ensureTerminalLocation>[0]);
  return NextResponse.json({ ready: true, location_id: locationId });
}
