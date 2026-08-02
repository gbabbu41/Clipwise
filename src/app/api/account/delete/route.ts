import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { stripe } from "@/lib/stripe";
import { cleanupOrphanedBarberAccounts } from "@/lib/barber-cleanup";

/**
 * Permanent, self-service account + data deletion (privacy / right-to-erasure).
 *
 * Deletes EVERY shop the caller owns — which cascades to barbers, services,
 * appointments, clients, transactions, etc. via the schema's FK constraints —
 * cancels any Stripe subscription, unlinks any barber rows the user still holds
 * on other shops, removes the profile row, and finally deletes the auth user.
 * Irreversible. Requires an exact "DELETE" confirmation from the client.
 */
export async function POST(request: NextRequest) {
  const token = request.headers.get("Authorization")?.replace("Bearer ", "");
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(token);
  if (authErr || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { confirm } = (await request.json().catch(() => ({}))) as { confirm?: string };
  if (confirm !== "DELETE") {
    return NextResponse.json({ error: "Confirmation text must be exactly 'DELETE'." }, { status: 400 });
  }

  // Cancel any Stripe subscription tied to the user's shops (best-effort — a
  // billing hiccup must never block a privacy erasure request). Subscriptions
  // live on the platform account, so no connected-account opts.
  const { data: shops } = await supabaseAdmin
    .from("shops").select("id, stripe_subscription_id").eq("owner_id", user.id);
  const subIds = Array.from(
    new Set((shops ?? []).map(s => s.stripe_subscription_id).filter(Boolean)),
  ) as string[];
  for (const sub of subIds) {
    await stripe.subscriptions.cancel(sub).catch(() => {});
  }

  // Capture the barbers across all of this owner's shops BEFORE the delete —
  // the cascade wipes their rows. Used below to remove the logins of barbers
  // left with no shop at all (unless they also work at someone else's shop).
  const shopIds = (shops ?? []).map(s => s.id);
  const { data: shopBarbers } = shopIds.length
    ? await supabaseAdmin.from("barbers").select("user_id").in("shop_id", shopIds).not("user_id", "is", null)
    : { data: [] as { user_id: string | null }[] };

  // Delete all owned shops — cascades to every shop-scoped row via FK.
  const { error: delErr } = await supabaseAdmin.from("shops").delete().eq("owner_id", user.id);
  if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });

  // Remove the logins of barbers whose only shop(s) just vanished. excludeUserId
  // is the owner — already handled by the explicit teardown below.
  await cleanupOrphanedBarberAccounts((shopBarbers ?? []).map(b => b.user_id), user.id);

  // Unlink any barber rows this user still holds on OTHER shops so the auth-user
  // delete isn't blocked by an FK reference.
  await supabaseAdmin.from("barbers")
    .update({ user_id: null, is_active: false }).eq("user_id", user.id).then(null, () => null);

  // Remove the profile row, then the auth user itself.
  await supabaseAdmin.from("users").delete().eq("id", user.id).then(null, () => null);
  const { error: userErr } = await supabaseAdmin.auth.admin.deleteUser(user.id);
  if (userErr) return NextResponse.json({ error: userErr.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
