import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { insertNotifications } from "@/lib/notify";

const CONNECT_NUDGE_TITLE = "Finish Stripe setup to get paid";

// Drop a one-time notification telling the owner to connect Stripe (so they can
// actually receive payments), and clear it once they're set up. Deduped by
// title so repeated status checks don't spam. This route is only hit by shops on
// a payments-capable plan (the warning banner gates the call), so it targets
// exactly the owners who need it.
async function syncConnectNudge(userId: string, connected: boolean, shopId?: string | null): Promise<void> {
  if (connected) {
    await supabaseAdmin.from("notifications")
      .delete().eq("user_id", userId).eq("title", CONNECT_NUDGE_TITLE).then(null, () => null);
    return;
  }
  const { data: existing } = await supabaseAdmin.from("notifications")
    .select("id").eq("user_id", userId).eq("title", CONNECT_NUDGE_TITLE).limit(1).maybeSingle();
  if (!existing) {
    await insertNotifications({
      user_id: userId,
      shop_id: shopId ?? null,
      title: CONNECT_NUDGE_TITLE,
      message: "Your plan can take online payments, but you must connect Stripe to receive the money. Open Billing → Finish Stripe setup (a couple of minutes).",
      type: "system",
    });
  }
}

// Check the Connect account status and sync it to the shop row
export async function GET(request: NextRequest) {
  const token = request.headers.get("Authorization")?.replace("Bearer ", "");
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const shopId = new URL(request.url).searchParams.get("shop_id");
  let query = supabaseAdmin.from("shops").select("*").eq("owner_id", user.id);
  if (shopId) query = query.eq("id", shopId);
  const { data: shops } = await query.order("created_at", { ascending: false }).limit(1);
  const shop = shops?.[0];
  if (!shop) return NextResponse.json({ error: "No shop found" }, { status: 404 });

  if (!shop.stripe_account_id) {
    await syncConnectNudge(user.id, false, shop.id);
    return NextResponse.json({ connected: false, status: "pending", chargesEnabled: false, payoutsEnabled: false });
  }

  try {
    const account = await stripe.accounts.retrieve(shop.stripe_account_id);
    const active = account.charges_enabled && account.payouts_enabled;
    const status = active ? "active" : "pending";

    // Keep the DB in sync
    await supabaseAdmin.from("shops")
      .update({ stripe_connected: !!active, stripe_connect_status: status })
      .eq("id", shop.id);

    await syncConnectNudge(user.id, !!active, shop.id);

    return NextResponse.json({
      connected: !!active,
      status,
      chargesEnabled: account.charges_enabled,
      payoutsEnabled: account.payouts_enabled,
      detailsSubmitted: account.details_submitted,
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Stripe error" }, { status: 500 });
  }
}
