import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { isNativeRequest } from "@/lib/native-app";

// Creates a Stripe **Account Session** for the owner's connected account with the
// Terminal hardware-shop + hardware-orders embedded components enabled. The web
// Card Reader page uses the returned client_secret to render the in-page store,
// where the barber buys a WisePad 3 DIRECTLY from Stripe (they pay + own it + get
// the tax invoice). Web only — this is a purchase surface (Apple IAP), so a native
// request is refused. Requires the shop to have a connected account first.
//
// Prereqs (owner, one-time): enable "Terminal hardware shop" in the Stripe
// Dashboard Connect settings, and set NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY.
export async function POST(request: NextRequest) {
  if (isNativeRequest(request)) {
    return NextResponse.json({ error: "Not available in the app." }, { status: 403 });
  }
  const token = request.headers.get("Authorization")?.replace("Bearer ", "");
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(token);
  if (authErr || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { shop_id } = await request.json().catch(() => ({})) as { shop_id?: string };

  // Owner-scoped: a shop_id the caller doesn't own resolves to nothing.
  let q = supabaseAdmin.from("shops").select("id, stripe_account_id").eq("owner_id", user.id);
  if (shop_id) q = q.eq("id", shop_id);
  const { data: rows } = await q.order("created_at", { ascending: false }).limit(1);
  const shop = rows?.[0];
  if (!shop) return NextResponse.json({ error: "No shop found" }, { status: 404 });
  if (!shop.stripe_account_id) {
    return NextResponse.json({ error: "Connect your Stripe account first." }, { status: 400 });
  }

  try {
    const session = await stripe.accountSessions.create({
      account: shop.stripe_account_id,
      // The Stripe Node SDK's types lag these preview Terminal components (the API
      // accepts them), so the components block is cast.
      components: {
        terminal_hardware_shop: { enabled: true },
        terminal_hardware_orders: { enabled: true },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
    });
    return NextResponse.json({ client_secret: session.client_secret });
  } catch (err) {
    // Most likely: the hardware-shop component isn't enabled in the platform's
    // Connect settings yet. Log the detail; return a generic message.
    console.error("[hardware-session] account session failed:", err);
    return NextResponse.json({ error: "Couldn't open the reader shop — please try again." }, { status: 500 });
  }
}
