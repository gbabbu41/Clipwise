import type { Metadata } from "next";
import { ProductDetail } from "@/components/marketing/product-detail";
export const metadata: Metadata = { title: "Barbershop tools — ClipWise", description: "Bookings, checkout and your team, connected in ClipWise.", alternates: { canonical: "https://clipwise.ca/features" } };
export default function FeaturesPage() { return <ProductDetail page="features" />; }
