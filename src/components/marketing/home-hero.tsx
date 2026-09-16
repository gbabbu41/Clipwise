import Link from "next/link";

// Server-rendered copy on every screen. No autoplay, duplicated mobile markup,
// or video download is needed to understand the product or start signing up.
export function HomeHero() {
  return (
    <section className="home-hero" aria-labelledby="home-title">
      <style>{HERO_CSS}</style>
      <div className="wrap hh-grid">
        <div className="hh-copy">
          <p className="eyebrow">Barbershop software · Built in Canada</p>
          <h1 id="home-title">More time cutting.<br /><span>Less time managing.</span></h1>
          <p className="hh-description">Bookings, payments and your team, together in ClipWise. Run the business behind the chair without losing time for the people in it.</p>
          <div className="cta">
            <Link className="pill w" href="/signup">Get started free <span aria-hidden="true">↗</span></Link>
            <a className="pill g" href="#app">Explore the product <span aria-hidden="true">↓</span></a>
          </div>
          <p className="micro">Start free. No credit card required.</p>
          <div className="hh-benefits" aria-label="What you can manage">
            <p><b>Book the day.</b><span>Online bookings &amp; walk-ins</span></p>
            <p><b>Run the shop.</b><span>Checkout, staff &amp; payroll</span></p>
          </div>
        </div>
        <figure className="hh-preview">
          <div className="hh-preview-heading"><span>YOUR SHOP, AT A GLANCE</span><span>CLIPWISE</span></div>
          <div className="hh-screens">
            <div className="hh-phone hh-calendar">
              <img src="/new/app-cal.jpg" alt="ClipWise calendar showing appointments and payment status" width={640} height={1280} loading="eager" />
            </div>
            <div className="hh-phone hh-dashboard">
              <img src="/new/app-home.jpg" alt="ClipWise dashboard showing shop revenue and performance" width={640} height={1280} loading="eager" />
            </div>
          </div>
          <figcaption>From the first booking to the last checkout.<span>Actual ClipWise screens · example shop data</span></figcaption>
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
.mkt .hh-copy h1 span{color:#b8b8c0}
.mkt .hh-description{font-size:17px;line-height:1.7;color:#b8b8c0;max-width:45ch;margin:24px 0 28px}
.mkt .hh-copy .cta{gap:10px}
.mkt .hh-copy .pill{padding:14px 22px;font-size:14px}
.mkt .hh-copy .pill span{margin-left:8px}
.mkt .hh-copy .micro{margin-top:14px;color:#a5a5ae}
.mkt .hh-benefits{display:grid;grid-template-columns:1fr 1fr;gap:18px;border-top:1px solid #29292f;margin-top:36px;padding-top:22px}
.mkt .hh-benefits p{margin:0;font-size:12px;line-height:1.7;color:#a5a5ae}
.mkt .hh-benefits b{display:block;font-weight:600;font-size:14px;color:#f5f4f7}
.mkt .hh-preview{min-width:0;margin:0;padding:24px 20px 20px;border:1px solid #303036;border-radius:26px;background:linear-gradient(145deg,#222327,#101113 70%);box-shadow:0 24px 64px #0006}
.mkt .hh-preview-heading{display:flex;justify-content:space-between;gap:12px;font-size:9px;font-weight:600;letter-spacing:.14em;color:#b8b8c0;margin-bottom:22px}
.mkt .hh-preview-heading span:last-child{color:#f5f4f7;letter-spacing:-.03em}
.mkt .hh-screens{display:flex;align-items:center;justify-content:center;gap:12px}
.mkt .hh-phone{overflow:hidden;min-width:0;padding:5px;border-radius:23px;border:1px solid #46474e;background:#0c0c0e;box-shadow:0 18px 35px #0007}
.mkt .hh-phone img{width:100%;height:auto;border-radius:18px}
.mkt .hh-calendar{width:56%}
.mkt .hh-dashboard{width:44%;margin-top:36px}
.mkt .hh-preview figcaption{font-size:12px;line-height:1.6;color:#e4e4e9;margin-top:22px}
.mkt .hh-preview figcaption span{display:block;color:#a5a5ae;font-size:10px;margin-top:3px}
@media(max-width:960px){.mkt .hh-grid{gap:28px}.mkt .hh-copy h1{font-size:42px}.mkt .hh-preview{padding:18px 14px}.mkt .hh-preview-heading{font-size:8px;letter-spacing:.08em}.mkt .hh-screens{gap:8px}}
@media(max-width:760px){.mkt .home-hero{padding:116px 0 40px}.mkt .hh-grid{grid-template-columns:1fr;gap:32px}.mkt .hh-copy h1{font-size:clamp(36px,7.8vw,52px);max-width:18ch;text-wrap:initial}.mkt .hh-description{font-size:16px;margin:20px 0 24px}.mkt .hh-copy .eyebrow{margin-bottom:18px}.mkt .hh-benefits{margin-top:26px;padding-top:18px}.mkt .hh-preview{width:100%;max-width:440px;margin:0 auto;padding:20px}.mkt .hh-preview-heading{font-size:9px}.mkt .hh-screens{gap:12px}.mkt .hh-calendar{width:53%}.mkt .hh-dashboard{width:43%}}
@media(max-width:420px){.mkt .home-hero .wrap{padding-inline:22px}.mkt .hh-copy .cta{flex-direction:column}.mkt .hh-copy .pill{width:100%}.mkt .hh-copy .micro{font-size:12px}.mkt .hh-benefits{gap:12px}.mkt .hh-benefits p{font-size:11px}.mkt .hh-preview{padding:18px 14px}.mkt .hh-phone{padding:3px;border-radius:17px}.mkt .hh-phone img{border-radius:13px}}
`;
