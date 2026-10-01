import type { Metadata } from "next";
import Image from "next/image";
import { CalendarDays, CreditCard, UsersRound, Scissors } from "lucide-react";
import { PLAN_MARKETING } from "@/lib/plan-marketing";
import { ProductShowcase } from "./ProductShowcase";
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
  servicesMobile: { src: "/marketing-preview/services-mobile.png", width: 368, height: 796, alt: "Fade Mechanic booking flow showing service choices" },
  timesMobile: { src: "/marketing-preview/times-mobile.png", width: 368, height: 796, alt: "Fade Mechanic booking flow showing available times and barbers" },
  shopMobile: { src: "/marketing-preview/shop-mobile.png", width: 384, height: 832, alt: "Fade Mechanic’s shop page in the ClipWise booking experience" },
};

export default function MarketingPreviewPage() {
  return (
    <main id="top" className={styles.page}>
      <header className={styles.nav}>
        <a href="#top" className={styles.wordmark} aria-label="Back to top of this preview">CLIPWISE</a>
        <nav aria-label="Main navigation" className={styles.links}>
          <a href="#product">Product</a><a href="#plans">Pricing</a><a href="https://clipwise.ca/login">Log in</a>
        </nav>
        <a href="https://clipwise.ca/signup" className={styles.navCta}>Get started</a>
      </header>

      <section className={styles.hero} aria-labelledby="hero-title">
        <div className={styles.heroCopy}>
          <p className={styles.eyebrow}>Barbershop management software</p>
          <h1 id="hero-title">Your shop.<br />Running smoothly.</h1>
          <p className={styles.heroLead}>Bookings, payments and your team.<br />All in one place.</p>
          <div className={styles.heroActions}>
            <a href="https://clipwise.ca/signup" className={styles.primaryButton}>Start free <span aria-hidden="true">→</span></a>
            <p>Set up at your pace.<br />No card required.</p>
          </div>
          <p className={styles.heroNote}>Less admin.<br />More good cuts.</p>
        </div>
        <div className={styles.heroVisual}>
          <div className={styles.laptop}>
            <div className={styles.laptopScreen}>
              <Image src="/marketing-preview/calendar-demo.svg" alt="ClipWise calendar with ten illustrative demo appointments for two barbers at Fade Mechanic" width={1440} height={896} priority sizes="(max-width: 900px) 100vw, 64vw" />
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
          <p className={styles.visualCaption}>Calendar · Illustrative demo appointments</p>
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

      <ProductShowcase />

      <section className={styles.booking} aria-labelledby="booking-title">
        <div className={styles.bookingCopy}>
          <p className={styles.eyebrow}>Online booking</p>
          <h2 id="booking-title">A booking page that feels like your shop.</h2>
          <p>Show your services, share your story and let clients choose a time in their browser.</p>
          <a href="https://clipwise.ca/online-booking" className={styles.outlineButton}>See how it works <span aria-hidden="true">→</span></a>
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
          <a href="https://clipwise.ca/pricing" className={styles.compareLink}>Compare all plans <span aria-hidden="true">→</span></a>
        </div>
        <div className={styles.planGrid}>
          {PLAN_MARKETING.map(plan => (
            <article className={`${styles.plan} ${plan.pop ? styles.planFeatured : ""}`} key={plan.plan}>
              <h3>{plan.n}</h3>
              <p className={styles.planAudience}>{plan.forWho}</p>
              <p className={styles.price}>{plan.p}<span>{plan.per === "/mo" ? "/ month" : ""}</span></p>
              <p className={styles.planSectionLabel}>Included</p>
              <ul className={styles.planIncluded}>{plan.yes.filter(item => !item.startsWith("21-day free trial")).map(item => <li key={item}>{item}</li>)}</ul>
              {plan.no.length > 0 && <><p className={styles.planSectionLabel}>Not included</p><ul className={styles.planExcluded}>{plan.no.map(item => <li key={item}>{item}</li>)}</ul></>}
              {plan.plan !== "starter" && <p className={styles.trial}>21-day trial · no card required</p>}
              <a href={`https://clipwise.ca/signup?plan=${plan.plan}`} className={styles.planButton}>{plan.cta} <span aria-hidden="true">→</span></a>
            </article>
          ))}
        </div>
        <p className={styles.disclosure}>Prices are in CAD. Card processing is billed separately; card readers are sold separately.</p>
      </section>

      <footer className={styles.footer}>
        <a href="#top" className={styles.wordmark} aria-label="Back to top of this preview">CLIPWISE</a>
        <span>Barbershop software, built for Canadian shops.</span>
        <div className={styles.footerLinks}><a href="https://clipwise.ca/pricing">Pricing</a><a href="https://clipwise.ca/privacy">Privacy</a><a href="https://clipwise.ca/terms">Terms</a></div>
      </footer>
    </main>
  );
}
