import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { supabaseAdmin } from "@/lib/supabase-admin";

export async function GET(request: NextRequest) {
  const sessionId = new URL(request.url).searchParams.get("session_id");
  if (!sessionId) return NextResponse.json({ error: "Missing session_id" }, { status: 400 });

  // Require the caller to be signed in, and only reveal a session's billing IDs
  // to the user who created it — previously anyone with a session_id could read
  // its subscription/customer IDs.
  const token = request.headers.get("Authorization")?.replace("Bearer ", "");
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { data: { user } } = await supabaseAdmin.auth.getUser(token);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if (session.metadata?.user_id && session.metadata.user_id !== user.id) {
      return NextResponse.json({ paid: false }, { status: 403 });
    }
    return NextResponse.json({
      paid: session.payment_status === "paid",
      plan: session.metadata?.plan ?? null,
      subscriptionId: typeof session.subscription === "string" ? session.subscription : null,
      customerId: typeof session.customer === "string" ? session.customer : null,
    });
  } catch {
    return NextResponse.json({ paid: false }, { status: 200 });
  }
}
