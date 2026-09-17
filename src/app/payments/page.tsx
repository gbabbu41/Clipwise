import type { Metadata } from "next";
import { ProductDetail } from "@/components/marketing/product-detail";
export const metadata: Metadata = { title: "Barbershop payments — ClipWise", description: "Cash, card and online payments with tips and tax tracked alongside the appointment.", alternates: { canonical: "https://clipwise.ca/payments" } };
export default function PaymentsPage() { return <ProductDetail page="payments" />; }
