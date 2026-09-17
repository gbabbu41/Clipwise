"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Pause, Play } from "lucide-react";

const FEATURES = [
  { label: "Overview", title: "More time cutting.", accent: "Less time managing.",
    description: "Bookings, payments and your team, together in ClipWise. Run the business behind the chair without losing time for the people in it.",
    heading: "Your shop, at a glance", caption: "From the first booking to the last checkout.",
    images: [["app-cal.jpg", "ClipWise calendar showing appointments and payment status"], ["app-home.jpg", "ClipWise dashboard showing shop revenue and performance"]] },
  { label: "Bookings", title: "Fill your chairs.", accent: "Not your inbox.",
    description: "Give clients their own booking link. Bring online appointments and walk-ins into one calendar, so you can focus on the next cut.",
    heading: "A clearer day, chair by chair", caption: "Your booking link. Your calendar. All connected.",
    images: [["app-cal.jpg", "ClipWise calendar with scheduled client appointments"], ["book-time.jpg", "Client booking page with available appointment times"]] },
  { label: "Payments", title: "Finish the cut.", accent: "Simplify checkout.",
    description: "Bring cash, card and online payments together. Keep track of tips, sales tax and what the shop has collected, without the end-of-day guesswork.",
    heading: "From the chair to checkout", caption: "Payments and the numbers behind them, together.",
    images: [["app-pay.jpg", "ClipWise payments screen with collected revenue, tax and processing fees"], ["app-checkout.jpg", "ClipWise appointment checkout screen"]] },
  { label: "Insights", title: "Know your numbers.", accent: "Know your shop.",
    description: "See revenue, average ticket and booking activity in one place. Understand how the shop is doing and make your next decision with a clearer picture.",
    heading: "The business behind the chair", caption: "A clear view of how your shop is performing.",
    images: [["app-home.jpg", "ClipWise dashboard with revenue and average ticket"], ["app-donut.jpg", "ClipWise booking breakdown by appointment status"]] },
] as const;

// The initial overview is server-rendered. All layers share grid cells to reserve
// their largest size, keeping the CTAs and surrounding page still during rotation.
export function HomeHero() {
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(true);
  const [visible, setVisible] = useState(false);
  const [pageVisible, setPageVisible] = useState(true);
  const heroRef = useRef<HTMLElement>(null);
  const running = !paused && !reducedMotion && visible && pageVisible;

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const syncMotion = () => setReducedMotion(media.matches);
    const syncVisibility = () => setPageVisible(!document.hidden);
    syncMotion(); syncVisibility();
    media.addEventListener("change", syncMotion);
    document.addEventListener("visibilitychange", syncVisibility);
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { threshold: 0 });
    if (heroRef.current) observer.observe(heroRef.current);
    return () => {
      media.removeEventListener("change", syncMotion);
      document.removeEventListener("visibilitychange", syncVisibility);
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!running) return;
    const timer = window.setTimeout(() => setActive(index => (index + 1) % FEATURES.length), 4000);
    return () => window.clearTimeout(timer);
  }, [active, running]);

  return (
    <section className="home-hero" aria-labelledby="home-title" ref={heroRef}>
      {/* Trusted static CSS: raw style text must match during hydration. */}
      <style dangerouslySetInnerHTML={{ __html: HERO_CSS }} />
      <div className="wrap hh-grid">
        <div className="hh-copy">
          <p className="eyebrow">Barbershop software · Built in Canada</p>
          <h1 id="home-title" className="hh-stack">
            {FEATURES.map((feature, index) => (
              <span key={feature.label} className={`hh-slide${active === index ? " is-active" : ""}`} aria-hidden={active !== index}>
                {feature.title}<br /><em>{feature.accent}</em>
              </span>
            ))}
          </h1>
          <div className="hh-stack hh-descriptions">
            {FEATURES.map((feature, index) => (
              <p key={feature.label} className={`hh-description hh-slide${active === index ? " is-active" : ""}`} aria-hidden={active !== index}>{feature.description}</p>
            ))}
          </div>
          <div className="cta">
            <Link className="pill w" href="/signup">Get started free <span aria-hidden="true">↗</span></Link>
            <a className="pill g" href="#app">Explore the product <span aria-hidden="true">↓</span></a>
          </div>
          <p className="micro">Start free. No credit card required.</p>
          <div className="hh-controls" role="group" aria-label="Explore ClipWise features">
            <div className="hh-selectors">
              {FEATURES.map((feature, index) => (
                <button key={feature.label} type="button" className={`hh-selector${active === index ? " is-active" : ""}`}
                  aria-pressed={active === index} aria-controls="hh-feature-preview"
                  onClick={() => setActive(index)}>
                  {feature.label}
                  <span className="hh-track" aria-hidden="true"><span style={{ transform: active === index ? "scaleX(1)" : "scaleX(0)" }} /></span>
                </button>
              ))}
            </div>
            <button type="button" className="hh-play" disabled={reducedMotion}
              aria-label={reducedMotion ? "Automatic rotation disabled for reduced motion" : paused ? "Play feature rotation" : "Pause feature rotation"}
              title={reducedMotion ? "Reduced motion: choose a feature manually" : paused ? "Play rotation" : "Pause rotation"}
              onClick={() => setPaused(value => !value)}>
              {paused || reducedMotion ? <Play size={14} aria-hidden="true" /> : <Pause size={14} aria-hidden="true" />}
            </button>
          </div>
          <div className="hh-benefits" aria-label="What you can manage">
            <p><b>Book the day.</b><span>Online bookings &amp; walk-ins</span></p>
            <p><b>Run the shop.</b><span>Checkout, staff &amp; payroll</span></p>
          </div>
        </div>
        <figure className="hh-preview" id="hh-feature-preview" aria-label={`${FEATURES[active].label} product preview`}>
          <div className="hh-preview-heading"><span className="hh-stack">{FEATURES.map((feature, index) => <span key={feature.label} className={`hh-slide${active === index ? " is-active" : ""}`} aria-hidden={active !== index}>{feature.heading}</span>)}</span><span>CLIPWISE</span></div>
          <div className="hh-stack">
            {FEATURES.map((feature, index) => (
              <div key={feature.label} className={`hh-screens hh-slide${active === index ? " is-active" : ""}`} aria-hidden={active !== index}>
                {feature.images.map(([src, alt], imageIndex) => (
                  <div key={src} className={`hh-phone ${imageIndex === 0 ? "hh-calendar" : "hh-dashboard"}`}>
                    <img src={`/new/${src}`} alt={alt} width={640} height={1280} loading="eager" />
                  </div>
                ))}
              </div>
            ))}
          </div>
          <figcaption><div className="hh-stack">{FEATURES.map((feature, index) => <div key={feature.label} className={`hh-slide${active === index ? " is-active" : ""}`} aria-hidden={active !== index}>{feature.caption}</div>)}</div><span>Actual ClipWise screens · example shop data</span></figcaption>
        </figure>
      </div>
    </section>
  );
}

// Homepage-only selectors: shared marketing pages and app portals are untouched.
const HERO_CSS = `
.mkt .home-hero{padding:142px 0 64px;background:radial-gradient(ellipse at 85% 45%,#1c1d20 0%,#09090b 43%,#000 78%)}
.mkt .hh-grid{display:grid;grid-template-columns:1.08fr 1fr;gap:48px;align-items:center}
.mkt .hh-copy{min-width:0}
.mkt .hh-copy .eyebrow{color:#b8b8c0;font-size:10px;letter-spacing:.15em;margin-bottom:22px}
.mkt .hh-copy h1{font-size:clamp(38px,4.3vw,58px);font-weight:800;line-height:1.08;letter-spacing:-.052em;margin:0;color:#fafafa;text-wrap:balance}
.mkt .hh-copy h1 em{color:#b8b8c0;font-style:normal}
.mkt .hh-description{font-size:17px;line-height:1.7;color:#b8b8c0;max-width:45ch;margin:24px 0 28px}
.mkt .hh-copy .cta{gap:10px}
.mkt .hh-copy .pill{padding:14px 22px;font-size:14px}
.mkt .hh-copy .pill span{margin-left:8px}
.mkt .hh-copy .micro{margin-top:14px;color:#a5a5ae}
.mkt .hh-benefits{display:grid;grid-template-columns:1fr 1fr;gap:18px;border-top:1px solid #29292f;margin-top:24px;padding-top:22px}
.mkt .hh-benefits p{margin:0;font-size:12px;line-height:1.7;color:#a5a5ae}
.mkt .hh-benefits b{display:block;font-weight:600;font-size:14px;color:#f5f4f7}
.mkt .hh-preview{min-width:0;margin:0;padding:24px 20px 20px;border:1px solid #303036;border-radius:26px;background:linear-gradient(145deg,#222327,#101113 70%);box-shadow:0 24px 64px #0006}
.mkt .hh-preview-heading{display:flex;justify-content:space-between;gap:12px;font-size:9px;font-weight:600;letter-spacing:.14em;color:#b8b8c0;margin-bottom:22px}
.mkt .hh-preview-heading{text-transform:uppercase;min-height:15px}
.mkt .hh-preview-heading>span:last-child{color:#f5f4f7;letter-spacing:-.03em}
.mkt .hh-screens{display:flex;align-items:center;justify-content:center;gap:12px}
.mkt .hh-phone{overflow:hidden;min-width:0;padding:5px;border-radius:23px;border:1px solid #46474e;background:#0c0c0e;box-shadow:0 18px 35px #0007}
.mkt .hh-phone img{width:100%;height:auto;aspect-ratio:1/2;object-fit:cover;object-position:top;border-radius:18px}
.mkt .hh-calendar{width:56%}
.mkt .hh-dashboard{width:44%;margin-top:36px}
.mkt .hh-preview figcaption{font-size:12px;line-height:1.6;color:#e4e4e9;margin-top:22px}
.mkt .hh-preview figcaption span{display:block;color:#a5a5ae;font-size:10px;margin-top:3px}
.mkt .hh-stack{display:grid}
.mkt .hh-slide{grid-area:1/1;min-width:0;opacity:0;visibility:hidden;pointer-events:none;transition:opacity .55s ease,visibility 0s .55s}
.mkt .hh-slide.is-active{opacity:1;visibility:visible;pointer-events:auto;transition:opacity .55s ease,visibility 0s}
/* Clear outgoing copy before fading in the next headline; screenshots crossfade. */
.mkt .hh-copy .hh-slide{transition:opacity .18s ease-out,visibility 0s .18s}
.mkt .hh-copy .hh-slide.is-active{transition:opacity .38s cubic-bezier(.22,1,.36,1) .18s,visibility 0s .18s}
.mkt .hh-controls{display:flex;align-items:center;gap:14px;margin-top:28px}
.mkt .hh-selectors{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));flex:1;gap:14px;min-width:0}
.mkt .hh-selector{background:none;border:0;padding:10px 0 0;font-family:inherit;font-size:11px;text-align:left;font-weight:600;color:#a5a5ae;cursor:pointer;min-height:44px}
.mkt .hh-selector:hover,.mkt .hh-selector.is-active{color:#fff}
.mkt .hh-track{display:block;height:2px;background:#35353c;overflow:hidden;margin-top:10px}
.mkt .hh-track>span{display:block;width:100%;height:100%;background:#f5f4f7;transform-origin:left;transition:transform .4s ease}
.mkt .hh-play{display:grid;place-items:center;flex:none;width:36px;height:36px;padding:0;border:1px solid #44444b;border-radius:50%;background:#ffffff06;color:#e4e4e9;cursor:pointer}
.mkt .hh-play:hover{background:#ffffff12}.mkt .hh-play:disabled{opacity:.5;cursor:default}
@media(prefers-reduced-motion:reduce){.mkt .home-hero .hh-slide,.mkt .home-hero .hh-track>span{transition:none!important}}
@media(max-width:960px){.mkt .hh-grid{gap:28px}.mkt .hh-copy h1{font-size:42px}.mkt .hh-preview{padding:18px 14px}.mkt .hh-preview-heading{font-size:8px;letter-spacing:.08em}.mkt .hh-screens{gap:8px}}
@media(max-width:760px){.mkt .home-hero{padding:116px 0 40px}.mkt .hh-grid{grid-template-columns:1fr;gap:32px}.mkt .hh-copy h1{font-size:clamp(36px,7.8vw,52px);max-width:18ch;text-wrap:initial}.mkt .hh-description{font-size:16px;margin:20px 0 24px}.mkt .hh-copy .eyebrow{margin-bottom:18px}.mkt .hh-benefits{margin-top:26px;padding-top:18px}.mkt .hh-preview{width:100%;max-width:440px;margin:0 auto;padding:20px}.mkt .hh-preview-heading{font-size:9px}.mkt .hh-screens{gap:12px}.mkt .hh-calendar{width:53%}.mkt .hh-dashboard{width:43%}}
@media(max-width:420px){.mkt .home-hero .wrap{padding-inline:22px}.mkt .hh-copy .cta{flex-direction:column}.mkt .hh-copy .pill{width:100%}.mkt .hh-copy .micro{font-size:12px}.mkt .hh-benefits{gap:12px}.mkt .hh-benefits p{font-size:11px}.mkt .hh-preview{padding:18px 14px}.mkt .hh-phone{padding:3px;border-radius:17px}.mkt .hh-phone img{border-radius:13px}}
`;
