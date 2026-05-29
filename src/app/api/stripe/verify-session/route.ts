import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";

export async function GET(request: NextRequest) {
  const sessionId = new URL(request.url).searchParams.get("session_id");
  if (!sessionId) return NextResponse.json({ error: "Missing session_id" }, { status: 400 });

  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId);
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
