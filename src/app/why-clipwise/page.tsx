import type { Metadata } from "next";
import Link from "next/link";
import { MarketingLightShell } from "@/components/marketing/light/MarketingLightShell";
import styles from "@/components/marketing/light/page.module.css";
export const metadata: Metadata = { title: "Why ClipWise — Built around your shop", description: "A direct booking page, transparent plans and connected shop tools for Canadian barbers.", alternates: { canonical: "https://clipwise.ca/why-clipwise" } };
export default function WhyClipWisePage() { return <MarketingLightShell><main id="public-main" className={styles.subpage}>
  <header className={styles.subpageIntro}><p className={styles.eyebrow}>Why ClipWise</p><h1>Built around your shop.<br />Not another distraction.</h1><p>A direct booking experience for your clients. Connected tools for you. Clear plans as your business grows.</p></header>
  <section className={styles.subpageItems} aria-label="Why shops choose ClipWise">{[
    { title: "Your client relationship", text: "Share your own shop page with your own services and prices. Clients book directly in their browser.", href: "/online-booking", link: "See the booking experience" },
    { title: "Your numbers, clearly", text: "No ClipWise platform commission or client booking surcharge. Subscription and card-processing costs are separate.", href: "/pricing", link: "See every plan" },
    { title: "Tools that connect", text: "Bring the calendar, checkout and shop operations into one system, with features matched to your plan.", href: "/features", link: "Explore the product" },
  ].map((item,i) => <article className={styles.subpageItem} key={item.title}><span>0{i+1}</span><h2>{item.title}</h2><p>{item.text}</p><Link href={item.href}>{item.link} <span aria-hidden="true">→</span></Link></article>)}</section>
  <section className={styles.subpageClose}><div><h2>Your next chapter starts here.</h2><p>Start free. Set up your shop at your pace.</p></div><Link href="/signup" className={styles.subpageActionPrimary}>Get started free <span aria-hidden="true">→</span></Link></section>
</main></MarketingLightShell>; }
