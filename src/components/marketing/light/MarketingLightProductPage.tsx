import Image from "next/image";
import Link from "next/link";
import { PRODUCT_PAGES } from "../public-content";
import { MarketingLightShell } from "./MarketingLightShell";
import styles from "./page.module.css";

export function MarketingLightProductPage({ page }: { page: keyof typeof PRODUCT_PAGES }) {
  const data = PRODUCT_PAGES[page];
  const bookingScreenshot = page === "online-booking";
  const imageSrc = bookingScreenshot ? "/marketing-preview/times-mobile.png" : `/new/${data.image}`;
  const imageAlt = bookingScreenshot ? "Fade Mechanic booking page showing available times and barber choices" : data.imageAlt;
  const imageHeight = bookingScreenshot ? 796 : data.image.startsWith("book") ? 1016 : 1280;
  const imageWidth = bookingScreenshot ? 368 : data.image.startsWith("book") ? 520 : 640;

  return (
    <MarketingLightShell>
      <main id="public-main" className={styles.subpage}>
        <header className={styles.subpageIntro}>
          <p className={styles.eyebrow}>{data.eyebrow}</p>
          <h1>{data.title}</h1>
          <p>{data.description}</p>
          <div className={styles.subpageActions}>
            <Link href="/signup" className={styles.subpageActionPrimary}>Get started free <span aria-hidden="true">→</span></Link>
            <Link href="/pricing" className={styles.subpageActionSecondary}>View pricing</Link>
          </div>
        </header>
        <section className={styles.subpageSplit} aria-labelledby="product-detail-title">
          <div><h2 id="product-detail-title">{data.imageTitle}</h2><p>{data.imageText}</p></div>
          <div className={`${styles.subpageImage} ${bookingScreenshot ? styles.subpageBookingImage : ""}`}>
            <Image src={imageSrc} alt={imageAlt} width={imageWidth} height={imageHeight} sizes="(max-width: 700px) 62vw, 280px" />
          </div>
        </section>
        <section className={styles.subpageItems} aria-label={`${data.eyebrow} details`}>
          {data.items.map((item, index) => (
            <article className={styles.subpageItem} key={item.title}>
              <span>0{index + 1}</span><h2>{item.title}</h2><p>{item.text}</p>
              <Link href={item.href}>{item.link} <span aria-hidden="true">→</span></Link>
            </article>
          ))}
        </section>
        <section className={styles.subpageFaq} aria-labelledby="product-faq-title">
          <p className={styles.eyebrow}>Good to know</p><h2 id="product-faq-title">A little more detail.</h2>
          {data.faq.map(item => <details key={item.question}><summary>{item.question}</summary><p>{item.answer}</p></details>)}
        </section>
        <section className={styles.subpageClose}>
          <div><h2>Your next chapter starts here.</h2><p>Start free. Set up your shop at your pace.</p></div>
          <Link href="/signup" className={styles.subpageActionPrimary}>Get started free <span aria-hidden="true">→</span></Link>
        </section>
      </main>
    </MarketingLightShell>
  );
}
