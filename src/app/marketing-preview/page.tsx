import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { ArrowRight, CalendarDays, CreditCard, Gift, UsersRound, Scissors } from "lucide-react";
import { PLAN_MARKETING } from "@/lib/plan-marketing";
import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "ClipWise — preview",
  description: "A preview of a simpler ClipWise marketing page for barbershops.",
  robots: { index: false, follow: false },
};

const capabilities = [
  { icon: CalendarDays, title: "Online booking", detail: "Let clients book in a browser." },
  { icon: CreditCard, title: "Checkout", detail: "Take payments with ease." },
  { icon: UsersRound, title: "Clients", detail: "Keep client history in one place." },
  { icon: Scissors, title: "Your team", detail: "Schedules, roles and more." },
];

const ASSETS = {
  checkout: { src: "/marketing-preview/checkout-light.png", width: 1440, height: 896, alt: "Fade Mechanic’s ClipWise checkout with service selection and payment options" },
  servicesMobile: { src: "/marketing-preview/services-mobile.png", width: 368, height: 796, alt: "Fade Mechanic booking flow showing service choices" },
  timesMobile: { src: "/marketing-preview/times-mobile.png", width: 368, height: 796, alt: "Fade Mechanic booking flow showing available times and barbers" },
  shopMobile: { src: "/marketing-preview/shop-mobile.png", width: 384, height: 832, alt: "Fade Mechanic’s shop page in the ClipWise booking experience" },
};

const features = [
  { index: "01", title: "Fill your calendar", copy: "A smooth booking experience that works for you, around the clock.", image: ASSETS.timesMobile, imageClass: "timesCrop" },
  { index: "02", title: "Make checkout simple", copy: "Take payments, add tips and see tax alongside the sale.", image: ASSETS.checkout, imageClass: "checkoutCrop" },
  { index: "03", title: "Keep clients coming back", copy: "Client history, notes and loyalty tools help you remember the details.", image: null, imageClass: "" },
];

function planFeatures(planId: string) {
  const plan = PLAN_MARKETING.find(item => item.plan === planId)!;
  return plan.plan === "starter" ? plan.yes.slice(0, 3) : plan.yes.slice(1, 4);
}

export default function MarketingPreviewPage() {
  return (
    <main className={styles.page}>
      <header className={styles.nav}>
        <Link href="/" className={styles.wordmark} aria-label="ClipWise home">CLIPWISE</Link>
        <nav aria-label="Main navigation" className={styles.links}>
          <a href="#product">Product</a><a href="#plans">Pricing</a><Link href="/login">Log in</Link>
        </nav>
        <Link href="/signup" className={styles.navCta}>Get started</Link>
      </header>

      <section className={styles.hero} aria-labelledby="hero-title">
        <div className={styles.heroCopy}>
          <p className={styles.eyebrow}>Barbershop management software</p>
          <h1 id="hero-title">Your shop.<br />Running smoothly.</h1>
          <p className={styles.heroLead}>Bookings, payments and your team.<br />All in one place.</p>
          <div className={styles.heroActions}>
            <Link href="/signup" className={styles.primaryButton}>Start free <span aria-hidden="true">→</span></Link>
            <p>Set up at your pace.<br />No card required.</p>
          </div>
          <p className={styles.heroNote}>Less admin.<br />More good cuts.</p>
        </div>
        <div className={styles.heroVisual} aria-label="ClipWise in-shop checkout preview">
          <div className={styles.laptop}>
            <div className={styles.laptopScreen}>
              <Image src={ASSETS.checkout.src} alt={ASSETS.checkout.alt} width={ASSETS.checkout.width} height={ASSETS.checkout.height} priority sizes="(max-width: 900px) 100vw, 64vw" />
            </div>
            <div className={styles.laptopBase} aria-hidden="true" />
          </div>
          <div className={styles.phonePair}>
            <figure className={`${styles.phone} ${styles.phoneBack}`}>
              <div className={styles.phoneScreen}>
                <Image src={ASSETS.timesMobile.src} alt={ASSETS.timesMobile.alt} width={ASSETS.timesMobile.width} height={ASSETS.timesMobile.height} sizes="(max-width: 900px) 30vw, 16vw" />
              </div>
            </figure>
            <figure className={`${styles.phone} ${styles.phoneFront}`}>
              <div className={styles.phoneScreen}>
                <Image src={ASSETS.servicesMobile.src} alt={ASSETS.servicesMobile.alt} width={ASSETS.servicesMobile.width} height={ASSETS.servicesMobile.height} sizes="(max-width: 900px) 30vw, 16vw" />
              </div>
            </figure>
          </div>
          <p className={styles.visualCaption}>In-shop checkout · Fade Mechanic</p>
        </div>
      </section>

      <section className={styles.capabilityStrip} aria-label="ClipWise capabilities">
        {capabilities.map(({ icon: Icon, title, detail }) => (
          <div className={styles.capability} key={title}>
            <Icon size={24} strokeWidth={1.7} aria-hidden="true" />
            <div><h2>{title}</h2><p>{detail}</p></div>
          </div>
        ))}
      </section>

      <section id="product" className={styles.product} aria-labelledby="product-title">
        <div className={styles.sectionHead}>
          <p className={styles.eyebrow}>Built for modern barbershops</p>
          <h2 id="product-title">From the first booking<br className={styles.desktopBreak} /> to the next visit.</h2>
          <p className={styles.sectionIntro}>The tools to run a more organized shop, in one simple platform.</p>
        </div>
        <div className={styles.featureGrid}>
          {features.map(feature => (
            <article className={styles.feature} key={feature.index}>
              <p className={styles.featureIndex}>{feature.index}</p>
              <h3>{feature.title}</h3>
              <p className={styles.featureCopy}>{feature.copy}</p>
              {feature.image ? (
                <div className={`${styles.featureImage} ${styles[feature.imageClass as keyof typeof styles]}`}>
                  <Image src={feature.image.src} alt={feature.image.alt} width={feature.image.width} height={feature.image.height} sizes="(max-width: 760px) 100vw, 31vw" />
                </div>
              ) : (
                <div className={styles.featureCallout} aria-label="Loyalty program: visits earn points, which clients redeem for rewards">
                  <div className={styles.loyaltySteps}>
                    <span><UsersRound size={21} strokeWidth={1.7} aria-hidden="true" /><b>Visit</b></span>
                    <ArrowRight size={17} strokeWidth={1.7} aria-hidden="true" />
                    <span><Scissors size={21} strokeWidth={1.7} aria-hidden="true" /><b>Earn points</b></span>
                    <ArrowRight size={17} strokeWidth={1.7} aria-hidden="true" />
                    <span><Gift size={21} strokeWidth={1.7} aria-hidden="true" /><b>Redeem</b></span>
                  </div>
                  <p>Set your own earning rules and rewards.</p>
                </div>
              )}
            </article>
          ))}
        </div>
      </section>

      <section className={styles.booking} aria-labelledby="booking-title">
        <div className={styles.bookingCopy}>
          <p className={styles.eyebrow}>Online booking</p>
          <h2 id="booking-title">A booking page that feels like your shop.</h2>
          <p>Show your services, share your story and let clients choose a time in their browser.</p>
          <Link href="/online-booking" className={styles.outlineButton}>See how it works <span aria-hidden="true">→</span></Link>
        </div>
        <figure className={styles.bookingFigure}>
          <div className={styles.shopPhone}>
            <div className={`${styles.phoneScreen} ${styles.shopPhoneScreen}`}>
              <Image src={ASSETS.shopMobile.src} alt={ASSETS.shopMobile.alt} width={ASSETS.shopMobile.width} height={ASSETS.shopMobile.height} sizes="(max-width: 760px) 60vw, 18vw" />
            </div>
          </div>
          <figcaption>Fade Mechanic · Public shop page</figcaption>
        </figure>
        <ul className={styles.bookingBenefits}>
          <li><span aria-hidden="true">01</span><div><strong>Make it yours</strong><p>Set up your services and shop details.</p></div></li>
          <li><span aria-hidden="true">02</span><div><strong>Works in a browser</strong><p>Clients can book without downloading an app.</p></div></li>
          <li><span aria-hidden="true">03</span><div><strong>Share your link</strong><p>Put your booking page on your site or social profile.</p></div></li>
        </ul>
      </section>

      <section id="plans" className={styles.plans} aria-labelledby="plans-title">
        <div className={styles.plansIntro}>
          <div><p className={styles.eyebrow}>Simple pricing</p><h2 id="plans-title">A plan for every stage.</h2><p>Powerful tools, without unnecessary complexity.</p></div>
          <Link href="/pricing" className={styles.compareLink}>Compare all plans <span aria-hidden="true">→</span></Link>
        </div>
        <div className={styles.planGrid}>
          {PLAN_MARKETING.map(plan => (
            <article className={`${styles.plan} ${plan.pop ? styles.planFeatured : ""}`} key={plan.plan}>
              <h3>{plan.n}</h3>
              <p className={styles.planAudience}>{plan.forWho}</p>
              <p className={styles.price}>{plan.p}<span>{plan.per === "/mo" ? "/ month" : ""}</span></p>
              <ul>{planFeatures(plan.plan).map(item => <li key={item}>{item}</li>)}</ul>
              {plan.plan !== "starter" && <p className={styles.trial}>21-day trial · no card required</p>}
              <Link href={`/signup?plan=${plan.plan}`} className={styles.planButton}>{plan.cta} <span aria-hidden="true">→</span></Link>
            </article>
          ))}
        </div>
        <p className={styles.disclosure}>Prices are in CAD. Card processing is billed separately; card readers are sold separately.</p>
      </section>

      <footer className={styles.footer}>
        <Link href="/" className={styles.wordmark} aria-label="ClipWise home">CLIPWISE</Link>
        <span>Barbershop software, built for Canadian shops.</span>
        <div className={styles.footerLinks}><Link href="/pricing">Pricing</Link><Link href="/privacy">Privacy</Link><Link href="/terms">Terms</Link></div>
      </footer>
    </main>
  );
}
