import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { PLAN_MARKETING } from "@/lib/plan-marketing";
import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "ClipWise — preview",
  description: "A preview of a warmer, simpler ClipWise marketing page.",
  robots: { index: false, follow: false },
};

export default function MarketingPreviewPage() {
  return (
    <main className={styles.page}>
      <header className={styles.nav}>
        <Link href="/" className={styles.wordmark} aria-label="ClipWise home">CLIPWISE</Link>
        <nav aria-label="Main navigation" className={styles.links}>
          <a href="#product">Product</a>
          <a href="#plans">Plans</a>
          <Link href="/login">Log in</Link>
        </nav>
        <Link href="/signup" className={styles.navCta}>Get started <span aria-hidden="true">↗</span></Link>
      </header>

      <section className={styles.hero} aria-labelledby="hero-title">
        <p className={styles.eyebrow}>Barbershop software · built in Canada</p>
        <h1 id="hero-title">More time<br />behind the chair.</h1>
        <div className={styles.heroBottom}>
          <p>Bookings, checkout and the day-to-day of your shop, together in one clear place.</p>
          <div className={styles.heroActions}>
            <Link href="/signup" className={styles.primaryButton}>Start free <span aria-hidden="true">↗</span></Link>
            <a href="#product" className={styles.textLink}>See how it works <span aria-hidden="true">↓</span></a>
          </div>
        </div>
        <figure className={styles.bookingFigure}>
          <div className={styles.bookingImage}>
            <Image
              src="/marketing-preview/booking-desktop.png"
              alt="Fade Mechanic’s ClipWise booking page, with its shop story and booking link"
              width={1434}
              height={996}
              priority
              sizes="(max-width: 720px) 100vw, 92vw"
            />
          </div>
          <figcaption><span>Fade Mechanic</span><span>Booking page on ClipWise</span></figcaption>
        </figure>
      </section>

      <section id="product" className={styles.product} aria-labelledby="product-title">
        <div className={styles.productCopy}>
          <p className={styles.eyebrow}>Made for the pace of the shop</p>
          <h2 id="product-title">From booking to checkout.</h2>
          <p className={styles.bodyCopy}>Give clients a clear way to book, and keep the in-shop checkout simple for your team.</p>
          <ul className={styles.featureList}>
            <li><span>01</span><div><strong>Bookings</strong><p>A public booking page and appointment calendar for the shop.</p></div></li>
            <li><span>02</span><div><strong>Checkout</strong><p>Track card and cash sales, tips and tax in the same workflow.</p></div></li>
            <li><span>03</span><div><strong>Room to grow</strong><p>Add staff, payroll and inventory tools on the plans that include them.</p></div></li>
          </ul>
          <Link href="/features" className={styles.textLink}>Explore ClipWise <span aria-hidden="true">↗</span></Link>
        </div>
        <figure className={styles.checkoutFigure}>
          <div className={styles.checkoutImage}>
            <Image
              src="/marketing-preview/checkout-light.png"
              alt="Fade Mechanic’s ClipWise checkout with a Skin Fade selected and payment options ready"
              width={1440}
              height={896}
              sizes="(max-width: 900px) 100vw, 58vw"
            />
          </div>
          <figcaption>Fade Mechanic · Service checkout</figcaption>
        </figure>
      </section>

      <section id="plans" className={styles.plans} aria-labelledby="plans-title">
        <div className={styles.plansIntro}>
          <div><p className={styles.eyebrow}>Straightforward plans</p><h2 id="plans-title">Start where you are.</h2></div>
          <p>Choose a plan for today. Compare every inclusion before you decide.</p>
        </div>
        <div className={styles.planGrid}>
          {PLAN_MARKETING.map((plan) => (
            <article className={styles.plan} key={plan.plan}>
              <div className={styles.planHead}><h3>{plan.n}</h3><p>{plan.forWho}</p></div>
              <p className={styles.price}>{plan.p}<span>{plan.per === "/mo" ? "/ month" : ""}</span></p>
              {plan.plan !== "starter" && <p className={styles.trial}>21-day free trial · no card required</p>}
              <Link href={`/signup?plan=${plan.plan}`} className={styles.planLink}>{plan.cta} <span aria-hidden="true">↗</span></Link>
            </article>
          ))}
        </div>
        <p className={styles.disclosure}>Prices are in CAD. Card processing is billed separately; card readers are sold separately.</p>
        <Link href="/pricing" className={styles.textLink}>Compare plans and features <span aria-hidden="true">↗</span></Link>
      </section>

      <section className={styles.close} aria-labelledby="close-title">
        <p className={styles.eyebrow}>A clearer way to run the shop</p>
        <div className={styles.closeRow}>
          <h2 id="close-title">Make room for<br />the next good cut.</h2>
          <div><p>Set up your shop at your own pace. Start with the free plan.</p><Link href="/signup" className={styles.primaryButton}>Get started free <span aria-hidden="true">↗</span></Link></div>
        </div>
      </section>

      <footer className={styles.footer}>
        <Link href="/" className={styles.wordmark} aria-label="ClipWise home">CLIPWISE</Link>
        <span>Barbershop software, built for Canadian shops.</span>
        <div className={styles.footerLinks}><Link href="/pricing">Pricing</Link><Link href="/privacy">Privacy</Link><Link href="/terms">Terms</Link></div>
      </footer>
    </main>
  );
}
