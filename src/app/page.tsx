import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { CalendarDays, CreditCard, UsersRound, Scissors } from "lucide-react";
import { MarketingLightShell } from "@/components/marketing/light/MarketingLightShell";
import { ProductShowcase } from "@/components/marketing/light/ProductShowcase";
import { LivePlanCards } from "@/components/marketing/light/LivePlanCards";
import styles from "@/components/marketing/light/page.module.css";

export const metadata: Metadata = {
  title: "ClipWise — Barbershop software built for Canadian shops",
  description: "Bookings, payments and your team, together. Barbershop software built for Canadian shops with no client booking surcharge and 0% platform commission.",
  alternates: { canonical: "https://clipwise.ca/" },
  openGraph: { title: "ClipWise — More time cutting. Less time managing.", description: "The business behind the chair, in one place.", url: "https://clipwise.ca/", images: [{ url: "https://clipwise.ca/new/poster.jpg" }], type: "website" },
  twitter: { card: "summary_large_image" },
};

const capabilities = [
  { icon: CalendarDays, title: "Online booking", detail: "Let clients book in a browser." },
  { icon: CreditCard, title: "Checkout", detail: "Take payments with ease." },
  { icon: UsersRound, title: "Clients", detail: "Keep client history in one place." },
  { icon: Scissors, title: "Your team", detail: "Schedules, roles and more." },
];

const bookingImages = [
  { src: "/marketing-preview/times-mobile.png", alt: "Fade Mechanic booking flow showing available times and barbers", width: 368, height: 796, className: styles.phoneBack },
  { src: "/marketing-preview/services-mobile.png", alt: "Fade Mechanic booking flow showing service choices", width: 368, height: 796, className: styles.phoneFront },
];

export default function HomePage() {
  return <MarketingLightShell><main id="public-main">
    <section className={styles.hero} aria-labelledby="hero-title">
      <div className={styles.heroCopy}>
        <p className={styles.eyebrow}>Barbershop management software</p>
        <h1 id="hero-title"><span>YOUR BARBERSHOP.</span><br /><span>OUR SOFTWARE.</span></h1>
        <p className={styles.heroLead}>Bookings, payments and your team.<br />All in one place.</p>
        <div className={styles.heroActions}><Link href="/signup" className={styles.primaryButton}>Start free <span aria-hidden="true">→</span></Link><p>Set up at your pace.<br />No card required.</p></div>
        <p className={styles.heroNote}>Less admin.<br />More good cuts.</p>
      </div>
      <div className={styles.heroVisual}>
        <div className={styles.laptop}><div className={styles.laptopScreen}><Image src="/marketing-preview/calendar-demo-approved.png" alt="ClipWise calendar for Fade Mechanic with twelve fictional demo appointments across three days" width={1586} height={992} priority sizes="(max-width: 900px) 100vw, 64vw" /></div><div className={styles.laptopBase} aria-hidden="true" /></div>
        <div className={styles.phonePair}>{bookingImages.map(image => <figure key={image.src} className={`${styles.phone} ${image.className}`}><div className={styles.phoneScreen}><Image src={image.src} alt={image.alt} width={image.width} height={image.height} sizes="(max-width: 900px) 30vw, 16vw" /></div></figure>)}</div>
        <p className={styles.visualCaption}>Calendar · Illustrative demo appointments</p>
      </div>
    </section>
    <section className={styles.capabilityStrip} aria-label="ClipWise capabilities">{capabilities.map(({ icon: Icon, title, detail }) => <div className={styles.capability} key={title}><Icon size={24} strokeWidth={1.7} aria-hidden="true" /><div><h2>{title}</h2><p>{detail}</p></div></div>)}</section>
    <ProductShowcase />
    <section className={styles.booking} aria-labelledby="booking-title">
      <div className={styles.bookingCopy}><p className={styles.eyebrow}>Online booking</p><h2 id="booking-title">A booking page that feels like your shop.</h2><p>Show your services, share your story and let clients choose a time in their browser.</p><Link href="/online-booking" className={styles.outlineButton}>See how it works <span aria-hidden="true">→</span></Link></div>
      <figure className={styles.bookingFigure}><div className={styles.shopPhone}><div className={`${styles.phoneScreen} ${styles.shopPhoneScreen}`}><Image src="/marketing-preview/shop-mobile.png" alt="Fade Mechanic’s public shop page in the ClipWise booking experience" width={384} height={832} sizes="(max-width: 760px) 60vw, 18vw" /></div></div><figcaption>Fade Mechanic · Public shop page</figcaption></figure>
      <ul className={styles.bookingBenefits}><li><span aria-hidden="true">01</span><div><strong>Make it yours</strong><p>Set up your services and shop details.</p></div></li><li><span aria-hidden="true">02</span><div><strong>Works in a browser</strong><p>Clients can book without downloading an app.</p></div></li><li><span aria-hidden="true">03</span><div><strong>Share your link</strong><p>Put your booking page on your site or social profile.</p></div></li></ul>
    </section>
    <section className={styles.featureStory} aria-labelledby="counter-title">
      <div><p className={styles.eyebrow}>At the counter</p><h2 id="counter-title">From the chair<br />to checkout.</h2><p>Bring services and retail products into the same checkout, with the customer and barber attached.</p><ul><li>Take cash or card payments</li><li>Apply gift cards and loyalty rewards</li><li>Manage retail products and stock quantities</li></ul><Link href="/payments" className={styles.compareLink}>Explore checkout and payments <span aria-hidden="true">→</span></Link></div>
      <div className={styles.counterPreview} aria-label="Illustrative checkout example"><div className={styles.counterTop}><span>CHECKOUT EXAMPLE</span><span>Demo customer</span></div><h3>Alex Morgan</h3><p>With Maya</p><div className={styles.counterItem}><span>Skin Fade<small>Service</small></span><b>$35.00</b></div><div className={styles.counterItem}><span>Styling clay<small>Retail product</small></span><b>$20.00</b></div><div className={styles.counterFooter}><span>Services + retail</span><strong>One checkout.</strong></div><p className={styles.reportDisclaimer}>Illustrative items and prices · Tax calculated at checkout</p></div>
    </section>
    <section className={`${styles.featureStory} ${styles.returnStory}`} aria-labelledby="return-title">
      <div><p className={styles.eyebrow}>Between appointments</p><h2 id="return-title">Give the next visit<br />a place to start.</h2><p>Keep rewards and requests organised alongside the everyday running of your shop.</p><Link href="/features" className={styles.compareLink}>Explore more features <span aria-hidden="true">→</span></Link></div>
      <div className={styles.featureDetails}><article><span>01</span><div><h3>Loyalty, without a separate spreadsheet.</h3><p>Manage your points programme and let clients redeem rewards at checkout.</p></div></article><article><span>02</span><div><h3>A place for waitlist requests.</h3><p>Review requests, track their status, and assign them when you have an opening.</p></div></article><article><span>03</span><div><h3>Know what’s on your shelf.</h3><p>Add products, update stock quantities, and keep retail inventory organised.</p></div></article><p className={styles.reportDisclaimer}>Feature availability depends on your plan. <Link href="/pricing">Compare plans</Link></p></div>
    </section>
    <section id="plans" className={styles.plans} aria-labelledby="plans-title">
      <div className={styles.plansIntro}><div><p className={styles.eyebrow}>Simple pricing</p><h2 id="plans-title">A plan for every stage.</h2><p>Current prices and chair limits, with a clear look at what each plan includes.</p></div><Link href="/pricing" className={styles.compareLink}>Compare all plans <span aria-hidden="true">→</span></Link></div>
      <LivePlanCards />
      <p className={styles.disclosure}>Prices are in CAD. Card processing is billed separately; card readers are sold separately.</p>
    </section>
  </main></MarketingLightShell>;
}
