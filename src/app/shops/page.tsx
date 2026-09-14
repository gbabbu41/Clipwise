import type { Metadata } from "next";
import { MarketingShell } from "@/components/marketing/shell";
import { ShopsDirectory } from "./shops-directory";

export const metadata: Metadata = {
  title: "Find a Barber — ClipWise",
  description: "Discover barbershops near you and book online in seconds — no app, no account. Canadian barbershops on ClipWise.",
  alternates: { canonical: "https://clipwise.ca/shops" },
};

// Server wrapper: shared marketing chrome + metadata around the client directory
// (which fetches the live shop listings).
export default function ShopsPage() {
  return (
    <MarketingShell>
      <ShopsDirectory />
    </MarketingShell>
  );
}
