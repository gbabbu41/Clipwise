import type { Metadata } from "next";
import Link from "next/link";
import { HomeHero } from "@/components/marketing/home-hero";
import { HomePageStyles } from "@/components/marketing/home-page-styles";
import { MarketingShell } from "@/components/marketing/shell";
import { PublicClose, PublicFAQ } from "@/components/marketing/public-content";
import { PLAN_MARKETING } from "@/lib/plan-marketing";

export const metadata: Metadata = {
  title: "ClipWise — Barbershop software built for Canadian shops",
  description: "Bookings, payments and your team, together. Barbershop software built for Canadian shops with no client booking surcharge and 0% platform commission.",
  alternates: { canonical: "https://clipwise.ca/" },
  openGraph: { title: "ClipWise — More time cutting. Less time managing.", description: "The business behind the chair, in one place.", url: "https://clipwise.ca/", images: [{ url: "https://clipwise.ca/new/poster.jpg" }], type: "website" },
  twitter: { card: "summary_large_image" },
};

export default function HomePage() {
  return <MarketingShell><HomePageStyles /><main id="public-main" className="home-content">
    <HomeHero />
    <div className="proof"><div className="wrap"><span><b>Built for Canadian barbers</b></span><span><b>$0</b> client booking fees</span><span><b>0%</b> platform commission</span></div></div>
    <section className="public-section" id="app"><div className="wrap"><div className="head"><p className="eyebrow">The essentials, connected</p><h2>Run the shop.<br /><em>Keep your focus.</em></h2></div><div className="public-grid">
      <article className="public-feature"><span className="number">01 / BOOKINGS</span><h3>A fuller calendar.</h3><p>Give clients a booking link. Keep appointments and walk-ins in view.</p><Link className="public-link" href="/online-booking">Explore booking →</Link></article>
      <article className="public-feature"><span className="number">02 / PAYMENTS</span><h3>A simpler checkout.</h3><p>Bring payments, tips and tax together—with the numbers to match.</p><Link className="public-link" href="/payments">Explore payments →</Link></article>
      <article className="public-feature"><span className="number">03 / YOUR TEAM</span><h3>A clearer business.</h3><p>Choose the staff, reporting and inventory tools your shop needs.</p><Link className="public-link" href="/features">See the product →</Link></article>
    </div></div></section>
    <section className="public-section" id="book"><div className="wrap public-split"><div className="copy"><p className="eyebrow">Made for the next appointment</p><h2>Your shop.<br /><em>One booking link.</em></h2><p className="lead">Clients choose a service, find a time and confirm in their browser. Your page stays about your shop.</p><Link className="public-link" href="/online-booking">See how booking works →</Link></div><div className="public-phone"><img src="/new/book-time.jpg" alt="Client choosing an available appointment time" width={520} height={1016} loading="lazy" /></div></div></section>
    <section className="public-section" id="price"><div className="wrap compact-pricing"><div><p className="eyebrow">Simple plans</p><h2 style={{ marginTop: 16 }}>Start free. Grow from there.</h2><p>{PLAN_MARKETING.map(p => p.n + ": " + p.p + (p.per === "/mo" ? "/mo" : "")).join(" · ")}</p><span id="pay" className="fine">Card processing is separate. Explore the plans for included features.</span></div><Link className="pill g" href="/pricing">Compare plans →</Link></div></section>
    <section className="public-section"><div className="wrap"><div className="head"><p className="eyebrow">Before you start</p><h2>Keep it simple.</h2></div><PublicFAQ items={[{ question: "Can I try ClipWise without a card?", answer: "Yes. Start with the free Starter plan, or a 21-day no-card trial on Pro or Premium." }, { question: "Do my clients need an app?", answer: "No. They can book through your shop’s public page in their browser, without a ClipWise account." }, { question: "What happens after I get started?", answer: "Enter your email, finish signup and verify the email code. Starter takes you into your shop portal; paid-plan selections continue through plan setup." }]} /></div></section>
    <PublicClose />
  </main></MarketingShell>;
}
