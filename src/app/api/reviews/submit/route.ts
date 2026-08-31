import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { insertNotifications } from "@/lib/notify-server";
import { enforceRateLimit } from "@/lib/rate-limit";

// Public review submission. The review page is anonymous and RLS blocks anon
// INSERT on `reviews`, so we insert with the service role here (no RLS change).
// Validates the appointment, dedupes, records the review, recomputes the
// barber's rating, and notifies the shop owner.
export async function POST(request: NextRequest) {
  const limited = enforceRateLimit(request, "reviews-submit", 5, 60_000);
  if (limited) return limited;

  const { booking_id, shopslug, rating, comment } = await request.json() as {
    booking_id?: string; shopslug?: string; rating?: number; comment?: string;
  };
  if (!booking_id || !rating || rating < 1 || rating > 5) {
    return NextResponse.json({ ok: false, error: "Invalid review" }, { status: 400 });
  }

  const { data: appt } = await supabaseAdmin
    .from("appointments")
    .select("id, shop_id, barber_id, status, client_name, client_email, client_phone, shops(slug)")
    .eq("id", booking_id).single();
  if (!appt) return NextResponse.json({ ok: false, error: "Appointment not found" }, { status: 404 });

  const slug = Array.isArray(appt.shops)
    ? (appt.shops[0] as { slug?: string } | undefined)?.slug
    : (appt.shops as { slug?: string } | null)?.slug;
  if (shopslug && slug && slug !== shopslug) {
    return NextResponse.json({ ok: false, error: "Shop mismatch" }, { status: 400 });
  }

  // A review must reflect a REAL, completed visit. The review link is sent on
  // completion, so enforce it server-side: possession of a booking id must not let
  // anyone review a future, pending, cancelled, or no-show booking (a visit that
  // never actually happened). Without this, a booking that merely EXISTS could be
  // rated — how a review landed 3 days before its own appointment.
  if (appt.status !== "completed") {
    return NextResponse.json({ ok: false, error: "You can leave a review once your visit is complete." }, { status: 400 });
  }

  // reviews.client_id is a FK to clients.id — resolve the appointment's
  // customer by email then phone (null if they're not on file).
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

  // Dedupe — one review per client per shop (stops re-submitting the link).
  if (clientId) {
    const { data: existing } = await supabaseAdmin
      .from("reviews").select("id").eq("shop_id", appt.shop_id).eq("client_id", clientId).maybeSingle();
    if (existing) return NextResponse.json({ ok: true, alreadyReviewed: true });
  } else if (appt.client_name) {
    // No client on file — dedupe by shop + name so the review link can't be
    // replayed for unlimited rating-boosting reviews.
    const { data: dupes } = await supabaseAdmin
      .from("reviews").select("id").eq("shop_id", appt.shop_id).eq("client_name", appt.client_name).limit(1);
    if (dupes && dupes.length) return NextResponse.json({ ok: true, alreadyReviewed: true });
  }

  // Public route — bound the comment length so a caller can't store a giant
  // payload (the DB has a matching backstop constraint).
  const trimmed = (comment ?? "").trim().slice(0, 1000);
  const { error } = await supabaseAdmin.from("reviews").insert({
    shop_id: appt.shop_id,
    barber_id: appt.barber_id ?? null,
    client_id: clientId,
    client_name: appt.client_name,
    rating,
    comment: trimmed || null,
  });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  // Recompute the barber's rating + review count from all their reviews.
  if (appt.barber_id) {
    const { data: brevs } = await supabaseAdmin
      .from("reviews").select("rating").eq("barber_id", appt.barber_id);
    if (brevs && brevs.length) {
      const avg = Math.round((brevs.reduce((s, r) => s + r.rating, 0) / brevs.length) * 10) / 10;
      await supabaseAdmin.from("barbers")
        .update({ rating: avg, total_reviews: brevs.length })
        .eq("id", appt.barber_id).then(null, () => null);
    }
  }

  // Notify the shop owner AND the barber whose work was reviewed (fire-and-forget).
  // The barber used to be left out even though the review is about them.
  const [{ data: shopRow }, { data: revBarber }] = await Promise.all([
    supabaseAdmin.from("shops").select("owner_id").eq("id", appt.shop_id).single(),
    appt.barber_id
      ? supabaseAdmin.from("barbers").select("user_id").eq("id", appt.barber_id).maybeSingle()
      : Promise.resolve({ data: null as { user_id: string | null } | null }),
  ]);
  const title = `New ${rating}-Star Review`;
  const message = `${appt.client_name} left a ${rating}-star review${trimmed ? `: "${trimmed.slice(0, 60)}"` : ""}`;
  const recipients = Array.from(new Set([shopRow?.owner_id, revBarber?.user_id].filter(Boolean))) as string[];
  for (const uid of recipients) {
    insertNotifications({ user_id: uid, shop_id: appt.shop_id, title, message, type: "review" });
  }

  return NextResponse.json({ ok: true });
}
