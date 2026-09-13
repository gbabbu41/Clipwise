import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { isNativeRequest } from "@/lib/native-app";

// REQUEST the one-time card-reader credit (interim manual flow).
//
// The barber buys a WisePad 3 directly from Stripe, then hits this route to ask
// ClipWise to apply their subscription credit. This route ONLY records the
// request (owner-scoped) — it never grants. An admin (super_admin) reviews and
// approves via /api/admin/hardware-credit, which is what actually applies the
// Stripe balance credit. That split is deliberate: an owner can only REQUEST, so
// nobody can self-credit without an admin approving (Stripe gives platforms no
// reliable way to verify a self-placed hardware order, so a human confirms it).
//
// Web only (money-adjacent → Apple IAP): a native request is refused.
export async function POST(request: NextRequest) {
  if (isNativeRequest(request)) {
    return NextResponse.json({ error: "Not available in the app." }, { status: 403 });
  }
  const token = request.headers.get("Authorization")?.replace("Bearer ", "");
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(token);
  if (authErr || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { shop_id } = await request.json().catch(() => ({})) as { shop_id?: string };

  // Owner-scoped: only the shop's owner can request its credit.
  let q = supabaseAdmin
    .from("shops")
    .select("id, hardware_credit_granted, hardware_credit_requested_at")
    .eq("owner_id", user.id);
  if (shop_id) q = q.eq("id", shop_id);
  const { data: rows } = await q.order("created_at", { ascending: false }).limit(1);
  const shop = rows?.[0];
  if (!shop) return NextResponse.json({ error: "No shop found" }, { status: 404 });

  if (shop.hardware_credit_granted) {
    return NextResponse.json({ ok: true, status: "granted" });
  }
  if (shop.hardware_credit_requested_at) {
    return NextResponse.json({ ok: true, status: "pending" });
  }

  // Record the request; clear any prior rejection so it's back in the queue.
  const { error } = await supabaseAdmin
    .from("shops")
    .update({ hardware_credit_requested_at: new Date().toISOString(), hardware_credit_rejected_at: null, hardware_credit_note: null })
    .eq("id", shop.id);
  if (error) {
    console.error("[hardware-credit request] update failed:", error.message);
    return NextResponse.json({ error: "Couldn't submit your request — please try again." }, { status: 500 });
  }

  return NextResponse.json({ ok: true, status: "pending" });
}
