import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase-admin";
import PreviewClient from "./preview-client";
import "./shopfront.css";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Shopfront preview — ClipWise", robots: { index: false, follow: false } };
export default async function ShopPreview({ params }: { params: { shopslug: string } }) {
  const { data, error } = await supabaseAdmin.from("shops").select("id").eq("slug", params.shopslug).maybeSingle();
  if (!error && !data) notFound();
  return <PreviewClient key={params.shopslug} />;
}
