import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getLocationLimit } from "@/lib/validation";
import { reconcileLocationAddon } from "@/lib/stripe-addons";
import { cleanupOrphanedBarberAccounts } from "@/lib/barber-cleanup";
import { deleteBarberPhotoFile, deleteShopLogoFile } from "@/lib/storage-cleanup";

// Permanent shop deletion. The owner can delete their own shop, which
// cascades to all dependent rows (barbers, services, appointments, etc.
// via the FK constraints in the schema). If this was their last shop the
// role is downgraded to "customer" so the email is reusable by another
// shop as a barber.

export async function POST(request: NextRequest) {
  const token = request.headers.get("Authorization")?.replace("Bearer ", "");
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(token);
  if (authErr || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { shop_id, confirm } = await request.json() as { shop_id: string; confirm: string };
  if (confirm !== "DELETE") {
    return NextResponse.json(
      { error: "Confirmation text must be exactly 'DELETE'." },
      { status: 400 }
    );
  }

  const { data: shop } = await supabaseAdmin
    .from("shops")
    .select("id, name, owner_id, stripe_subscription_id, subscription_plan")
    .eq("id", shop_id)
    .single();
  if (!shop || shop.owner_id !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Capture the barbers linked to this shop BEFORE the delete — the cascade
  // wipes these rows, so we can't look them up afterwards. We use them below to
  // remove the logins of barbers left with no shop at all.
  const { data: shopBarbers } = await supabaseAdmin
    .from("barbers").select("id, user_id").eq("shop_id", shop_id).not("user_id", "is", null);

  // Delete — cascades via FK constraints.
  const { error: delErr } = await supabaseAdmin
    .from("shops")
    .delete()
    .eq("id", shop_id);
  if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });

  // Erase the shop's uploaded files (public buckets → orphans stay fetchable).
  await deleteShopLogoFile(shop_id);
  for (const b of shopBarbers ?? []) if (b.id) await deleteBarberPhotoFile(b.id);

  // A barber whose ONLY shop was this one should lose their login too. One who
  // also works at another shop (same login) keeps their account — only this
  // shop's barber row went (via cascade above). Never touches the owner.
  await cleanupOrphanedBarberAccounts((shopBarbers ?? []).map(b => b.user_id), user.id);

  // If this was the user's last owned shop, downgrade their role to
  // "customer" so the email can be used as a barber on another shop later.
  const { data: remaining } = await supabaseAdmin
    .from("shops")
    .select("id")
    .eq("owner_id", user.id);
  if (!remaining || remaining.length === 0) {
    await supabaseAdmin
      .from("users")
      .update({ role: "customer" })
      .eq("id", user.id);
  }

  // Keep the $30/location add-on in sync: after removing a shop the owner may
  // drop below (or further below) their included count, so recompute the extra-
  // location quantity on their subscription. Best-effort — the delete already
  // succeeded; a billing hiccup shouldn't fail it.
  if (shop.stripe_subscription_id) {
    const included = getLocationLimit(shop.subscription_plan ?? undefined);
    const remainingCount = remaining?.length ?? 0;
    await reconcileLocationAddon(shop.stripe_subscription_id, Math.max(0, remainingCount - included)).catch(() => {});
  }

  return NextResponse.json({ ok: true });
}
