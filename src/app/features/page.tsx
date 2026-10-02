import type { Metadata } from "next";
import { MarketingLightProductPage } from "@/components/marketing/light/MarketingLightProductPage";
export const metadata: Metadata = { title: "Barbershop tools — ClipWise", description: "Bookings, checkout and your team, connected in ClipWise.", alternates: { canonical: "https://clipwise.ca/features" } };
export default function FeaturesPage() { return <MarketingLightProductPage page="features" />; }
