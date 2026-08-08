import { notFound } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase-admin";
import BookingClient from "./booking-client";

// Server gate in front of the (client) booking page. An unknown slug must return
// a real HTTP 404 — a client component always renders 200 (its fetch runs after
// hydration), so crawlers indexed /book/anything as a live page. We check the
// slug exists server-side FIRST; a genuinely invalid link 404s, everything else
// (coming-soon, paused bookings, etc.) is still handled inside BookingClient.
export const dynamic = "force-dynamic";

export default async function BookingPage({ params }: { params: { shopslug: string } }) {
  const { data, error } = await supabaseAdmin
    .from("shops")
    .select("id")
    .eq("slug", params.shopslug)
    .maybeSingle();

  // Only 404 on a confirmed miss. A transient DB/network error must NOT nuke a
  // real shop's booking page — fall through and let the client render (it has its
  // own retry screen).
  if (!error && !data) notFound();

  return <BookingClient />;
}
