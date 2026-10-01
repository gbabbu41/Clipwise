import type { Metadata } from "next";
import Link from "next/link";
import { MarketingLightShell } from "@/components/marketing/light/MarketingLightShell";
import { LivePlanCards } from "@/components/marketing/light/LivePlanCards";
import { PublicFAQ } from "@/components/marketing/public-content";
import styles from "@/components/marketing/light/page.module.css";
export const metadata: Metadata = { title: "Simple barbershop software pricing — ClipWise", description: "Start free with Starter. Compare ClipWise Pro and Premium inclusions.", alternates: { canonical: "https://clipwise.ca/pricing" } };
export default function PricingPage() { return <MarketingLightShell><main id="public-main" className={styles.subpage}>
  <header className={styles.subpageIntro}><p className={styles.eyebrow}>Pricing</p><h1>Start small.<br />Room to grow.</h1><p>Choose the tools your shop needs today. Current plan prices and chair limits are shown below.</p></header>
  <section className={styles.fullPricing} aria-label="Current ClipWise plans"><LivePlanCards /><p>Prices are in CAD. Card processing is billed separately by Stripe. Card readers are sold separately. <Link href="/payments">Learn about payments</Link>.</p></section>
  <section className={styles.pricingFaq}><p className={styles.eyebrow}>Good to know</p><h2>Before you choose.</h2><PublicFAQ items={[{ question: "Can I start without a credit card?", answer: "Yes. Starter is free, and Pro and Premium offer a 21-day free trial with no card required." }, { question: "What happens after I sign up?", answer: "Verify your email to create your account. Starter takes you into the shop portal; a Pro or Premium selection continues through the existing plan setup flow." }, { question: "Does the free plan include payments?", answer: "No. Starter includes online booking, appointment management and email reminders for one chair. Customer payments and POS are included in paid plans." }]} /></section>
  <section className={styles.subpageClose}><div><h2>Your next chapter starts here.</h2><p>Start free. Set up your shop at your pace.</p></div><Link href="/signup" className={styles.subpageActionPrimary}>Get started free <span aria-hidden="true">→</span></Link></section>
</main></MarketingLightShell>; }
