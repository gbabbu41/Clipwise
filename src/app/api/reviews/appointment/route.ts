import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

// Load the appointment behind a review link (from the review-request email),
// keyed by the unguessable appointment UUID. appointments RLS is stakeholder-
// only, so the anon browser can't read it directly — the review page was dead
// for every customer until this service-role read. Returns ONLY display fields
// (no client email/phone) + whether a review already exists.
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const bookingId = searchParams.get("booking");
  const shopslug = searchParams.get("shopslug");
  if (!bookingId) return NextResponse.json({ error: "Missing booking" }, { status: 400 });

  const { data: appt, error } = await supabaseAdmin
    .from("appointments")
    .select("id, client_name, date, time_slot, shop_id, barber_id, service_id, barbers(name), services(name), shops(name, slug)")
    .eq("id", bookingId)
    .maybeSingle();

  // Distinguish a real DB error (retryable) from a genuine 0-row miss.
  if (error) return NextResponse.json({ error: "Load failed" }, { status: 500 });
  if (!appt) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const shop = Array.isArray(appt.shops) ? appt.shops[0] : appt.shops;
  // Verify the slug in the URL matches this booking's shop (mirrors the old check).
  if (shopslug && shop?.slug !== shopslug) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { data: existingReview } = await supabaseAdmin
    .from("reviews").select("id").eq("shop_id", appt.shop_id).eq("client_id", bookingId).maybeSingle();

  return NextResponse.json({ appointment: appt, alreadyReviewed: !!existingReview });
}
