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
    // client_email/phone are read to resolve the reviewer for the dedupe check
    // below, but are NEVER returned to the browser (curated object at the end).
    .select("id, client_name, client_email, client_phone, date, time_slot, status, shop_id, barber_id, service_id, barbers(name), services(name), shops(name, slug)")
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

  // Already-reviewed: reviews.client_id is a FK to clients.id, so resolve the
  // reviewer by the appointment's email then phone (same as the submit route)
  // and check by that — the old `.eq("client_id", bookingId)` compared a client
  // id to an APPOINTMENT id and so never matched.
  let clientId: string | null = null;
  const email = (appt.client_email ?? "").trim();
  const phone = (appt.client_phone ?? "").trim();
  if (email) {
    const { data } = await supabaseAdmin.from("clients").select("id").eq("shop_id", appt.shop_id).ilike("email", email).maybeSingle();
    clientId = data?.id ?? null;
  }
  if (!clientId && phone) {
    const { data } = await supabaseAdmin.from("clients").select("id").eq("shop_id", appt.shop_id).eq("phone", phone).maybeSingle();
    clientId = data?.id ?? null;
  }
  let alreadyReviewed = false;
  if (clientId) {
    const { data: existingReview } = await supabaseAdmin
      .from("reviews").select("id").eq("shop_id", appt.shop_id).eq("client_id", clientId).maybeSingle();
    alreadyReviewed = !!existingReview;
  }

  // Curated response — display fields only, no PII (email/phone stripped).
  return NextResponse.json({
    appointment: {
      id: appt.id,
      client_name: appt.client_name,
      date: appt.date,
      time_slot: appt.time_slot,
      status: appt.status,
      shop_id: appt.shop_id,
      barber_id: appt.barber_id,
      service_id: appt.service_id,
      barbers: appt.barbers,
      services: appt.services,
      shops: appt.shops,
    },
    alreadyReviewed,
  });
}
