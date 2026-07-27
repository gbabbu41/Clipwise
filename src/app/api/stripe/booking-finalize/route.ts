import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { finalizeBookingFromSession } from "@/lib/finalize-booking-session";

// Called when the customer returns from a paid booking checkout. Verifies
// payment on the connected account, then creates the appointment (idempotent).
// The heavy lifting lives in finalizeBookingFromSession so the webhook fallback
// (checkout.session.completed) can create the SAME booking with identical side
// effects when the customer closes the tab before returning here.
export async function POST(request: NextRequest) {
  const { session_id, shop_id } = await request.json() as { session_id: string; shop_id: string };
  if (!session_id || !shop_id) return NextResponse.json({ error: "Missing params" }, { status: 400 });

  const { data: shop } = await supabaseAdmin
    .from("shops").select("stripe_account_id, stripe_connected").eq("id", shop_id).single();
  if (!shop) return NextResponse.json({ error: "Shop not found" }, { status: 404 });

  const useConnect = !!(shop.stripe_account_id && shop.stripe_connected);

  try {
    const session = await stripe.checkout.sessions.retrieve(
      session_id,
      undefined,
      useConnect ? { stripeAccount: shop.stripe_account_id! } : undefined,
    );
    const baseUrl = request.headers.get("origin") || process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
    const result = await finalizeBookingFromSession({
      session, useConnect, stripeAccountId: shop.stripe_account_id ?? null, baseUrl,
    });

    switch (result.status) {
      case "not_ready":
        return NextResponse.json({ paid: false }, { status: 200 });
      case "exists":
        return NextResponse.json({ paid: true, appointmentId: result.appointmentId, summary: result.summary ?? undefined });
      case "conflict":
        return NextResponse.json({ error: result.message }, { status: 409 });
      case "error":
        return NextResponse.json({ error: result.message }, { status: 500 });
      case "created":
        return NextResponse.json({ paid: true, appointmentId: result.appointmentId, summary: result.summary });
    }
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Stripe error" }, { status: 500 });
  }
}
