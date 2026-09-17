import type { Metadata } from "next";
import { ProductDetail } from "@/components/marketing/product-detail";
export const metadata: Metadata = { title: "Online booking for barbershops — ClipWise", description: "Your shop’s booking page. No client app download or ClipWise booking surcharge.", alternates: { canonical: "https://clipwise.ca/online-booking" } };
export default function OnlineBookingPage() { return <ProductDetail page="online-booking" />; }
