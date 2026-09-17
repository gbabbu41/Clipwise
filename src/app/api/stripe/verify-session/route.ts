import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { supabaseAdmin } from "@/lib/supabase-admin";

export async function GET(request: NextRequest) {
  const sessionId = new URL(request.url).searchParams.get("session_id");
  if (!sessionId || sessionId.length > 255) return NextResponse.json({ error: "Missing or invalid session_id" }, { status: 400 });

  // Require the caller to be signed in, and only reveal a session's billing IDs
  // to the user who created it — previously anyone with a session_id could read
  // its subscription/customer IDs.
  const token = request.headers.get("Authorization")?.replace("Bearer ", "");
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
  if (authError || !user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if (!session.metadata?.user_id || session.metadata.user_id !== user.id) {
      return NextResponse.json({ paid: false }, { status: 403 });
    }
    const subscriptionId = typeof session.subscription === "string" ? session.subscription : null;
    const customerId = typeof session.customer === "string" ? session.customer : null;
    if (session.mode !== "subscription" || session.status !== "complete" ||
      !["paid", "no_payment_required"].includes(session.payment_status) || !subscriptionId || !customerId) {
      return NextResponse.json({ paid: false });
    }
    const sub = await stripe.subscriptions.retrieve(subscriptionId);
    const subCustomer = typeof sub.customer === "string" ? sub.customer : sub.customer?.id;
    if (sub.metadata?.user_id !== user.id || subCustomer !== customerId) {
      return NextResponse.json({ paid: false }, { status: 403 });
    }
    if (!["active", "trialing"].includes(sub.status) || !sub.metadata?.plan) {
      return NextResponse.json({ paid: false });
    }
    return NextResponse.json({
      paid: true,
      plan: sub.metadata.plan,
      subscriptionId,
      customerId,
    });
  } catch {
    return NextResponse.json({ paid: false }, { status: 200 });
  }
}
