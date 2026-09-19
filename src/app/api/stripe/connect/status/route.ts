import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { insertNotifications } from "@/lib/notify-server";

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
    // No account yet → they genuinely need to start setup.
    return NextResponse.json({ connected: false, status: "pending", needsAction: true, detailsSubmitted: false, chargesEnabled: false, payoutsEnabled: false });
  }

  try {
    const account = await stripe.accounts.retrieve(shop.stripe_account_id);
    const active = account.charges_enabled && account.payouts_enabled;
    const status = active ? "active" : "pending";
    const detailsSubmitted = !!account.details_submitted;
    // Distinguish "the owner must DO something" from "Stripe is just reviewing":
    //   • needsAction  → they never finished the form, OR Stripe is blocking on
    //     info it still needs (currently_due / past_due). Re-prompt onboarding.
    //   • !needsAction & !active → details are in and nothing is due; Stripe is
    //     verifying. Show an "under review" status — do NOT re-prompt (that was
    //     the loop: an owner who'd finished kept seeing "Finish setup").
    const req = account.requirements;
    const currentlyDue = req?.currently_due ?? [];
    const pastDue = req?.past_due ?? [];
    const needsAction = !active && (!detailsSubmitted || currentlyDue.length > 0 || pastDue.length > 0);

    // Keep the DB in sync (unchanged shape: active | pending).
    await supabaseAdmin.from("shops")
      .update({ stripe_connected: !!active, stripe_connect_status: status })
      .eq("id", shop.id);

    // Only nudge when they actually need to act — not while Stripe is verifying.
    await syncConnectNudge(user.id, !!active || !needsAction, shop.id);

    return NextResponse.json({
      connected: !!active,
      status,
      needsAction,
      chargesEnabled: account.charges_enabled,
      payoutsEnabled: account.payouts_enabled,
      detailsSubmitted,
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Stripe error" }, { status: 500 });
  }
}
