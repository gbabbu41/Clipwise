import type { Metadata } from "next";
import { MarketingLightProductPage } from "@/components/marketing/light/MarketingLightProductPage";
export const metadata: Metadata = { title: "Online booking for barbershops — ClipWise", description: "Your shop’s booking page. No client app download or ClipWise booking surcharge.", alternates: { canonical: "https://clipwise.ca/online-booking" } };
export default function OnlineBookingPage() { return <MarketingLightProductPage page="online-booking" />; }
