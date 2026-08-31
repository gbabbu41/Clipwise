import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase-admin";
import BookingClient from "./booking-client";

// Server gate in front of the (client) booking page. An unknown slug must return
// a real HTTP 404 — a client component always renders 200 (its fetch runs after
// hydration), so crawlers indexed /book/anything as a live page. We check the
// slug exists server-side FIRST; a genuinely invalid link 404s, everything else
// (coming-soon, paused bookings, etc.) is still handled inside BookingClient.
export const dynamic = "force-dynamic";

// Per-shop metadata so a shared booking link shows the SHOP's name/logo — not the
// generic platform title. This page is made to be pasted into Instagram/DMs, so the
// tab title, browser history, and link preview are part of the product.
export async function generateMetadata({ params }: { params: { shopslug: string } }): Promise<Metadata> {
  const { data: shop } = await supabaseAdmin
    .from("shops")
    .select("name, description, logo, city, province")
    .eq("slug", params.shopslug)
    .maybeSingle();
  if (!shop) return { title: "Book an appointment — ClipWise" };
  const name = (shop.name ?? "").trim() || "This shop";
  const loc = [shop.city, shop.province].filter(Boolean).join(", ");
  const title = `${name} — Book Online`;
  const description = (shop.description ?? "").trim()
    || `Book your next appointment at ${name}${loc ? ` in ${loc}` : ""}.`;
  const images = shop.logo ? [{ url: shop.logo }] : undefined;
  return {
    title,
    description,
    openGraph: { title, description, images, type: "website" },
    twitter: { card: "summary", title, description },
  };
}

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
