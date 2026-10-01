import type { Metadata } from "next";
import { MarketingLightShell } from "@/components/marketing/light/MarketingLightShell";
import { ShopsDirectory } from "./shops-directory";
import { MKT_CSS } from "@/lib/marketing-theme";
import lightStyles from "@/components/marketing/light/page.module.css";

const DIRECTORY_LIGHT_THEME = `${MKT_CSS}
.mkt.lightMarketing{--bg:#f4f6f8;--s1:#fff;--s2:#eef2f6;--line:#dfe4ea;--line2:#cbd4de;--t1:#172334;--t2:#586678;--t3:#68778a;--t4:#8591a0;--ok:#234b70;--warn:#80561a;background:var(--bg);color:var(--t1)}
.mkt.lightMarketing .${lightStyles.navCta}{color:#fff;background:#101d2e;border-color:#101d2e}
.mkt.lightMarketing .dir .badge-warn{color:#354255!important;background:#e9eff6!important;border-color:#c9d7e7!important}
.mkt.lightMarketing .dir .search input{background:#fff;border-color:#cbd4de;color:#172334}
.mkt.lightMarketing .dir .search input::placeholder{color:#68778a}
.mkt.lightMarketing .dir .search .ic{color:#68778a}
.mkt.lightMarketing .scard{background:#fff;border-color:#dfe4ea;color:#172334}
.mkt.lightMarketing .scard .nm,.mkt.lightMarketing .scard .srow span[style*='var(--t1)']{color:#172334!important}
.mkt.lightMarketing .scard .meta,.mkt.lightMarketing .scard .desc{color:#586678}
.mkt.lightMarketing .scard .book{color:#234b70}
.mkt.lightMarketing .dir .ctacard{background:#fff;border-color:#dfe4ea}
.mkt.lightMarketing .dir .ctacard .eyebrow{color:#354255!important}
.mkt.lightMarketing .dir .logo-fb{background:#eef2f6}
`;

export const metadata: Metadata = {
  title: "Find a Barber — ClipWise",
  description: "Discover barbershops near you and book online in seconds — no app, no account. Canadian barbershops on ClipWise.",
  alternates: { canonical: "https://clipwise.ca/shops" },
};

// Server wrapper: shared marketing chrome + metadata around the client directory
// (which fetches the live shop listings).
export default function ShopsPage() {
  return (
    <MarketingLightShell>
      <style dangerouslySetInnerHTML={{ __html: DIRECTORY_LIGHT_THEME }} />
      <main id="public-main"><ShopsDirectory /></main>
    </MarketingLightShell>
  );
}
