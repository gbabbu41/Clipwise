import type { Metadata } from "next";
import Link from "next/link";
import { PLAN_MARKETING } from "@/lib/plan-marketing";
import { HeroFilm } from "@/components/marketing/hero-film";
import { MarketingShell } from "@/components/marketing/shell";

// Public marketing homepage. The DESIGN is the "new" black/emerald landing (ditto);
// the SYSTEM + DATA are ours — real routes on every CTA, pricing rendered from the
// PLAN_MARKETING single source of truth, and our real footer. The whole page is a
// server component (indexable, copy in the initial HTML) with one client island
// for the hero film. Theme CSS is scoped under `.mkt`, so the portals are untouched.
//
// Native app never reaches this: middleware redirects `/` → /dashboard for the app,
// so none of the billing/pricing here leaks into the iOS shell (Apple IAP).

export const metadata: Metadata = {
  title: "ClipWise — Barbershop software built for Canadian shops",
  description:
    "Barbershop management built for Canadian shops — booking with no client fees, Interac at 15¢ flat, Tap to Pay, no-show protection and 0% commission.",
  alternates: { canonical: "https://clipwise.ca/" },
  openGraph: {
    title: "ClipWise — Barbershop software built for Canadian shops",
    description: "Booking with no client fees, Interac at 15¢ flat, Tap to Pay, and 0% commission.",
    url: "https://clipwise.ca/",
    images: [{ url: "https://clipwise.ca/new/poster.jpg" }],
    type: "website",
  },
  twitter: { card: "summary_large_image" },
};

export default function HomePage() {
  return (
    <MarketingShell>
      {/* Visually-hidden page title — the visible "headline" is baked into the hero
          film, so this gives crawlers and screen readers a real h1 with no visual
          change. */}
      <h1 className="sr-only">ClipWise — barbershop management built for Canadian shops</h1>

      {/* hero film (client island) */}
      <HeroFilm />

      {/* proof strip */}
      <div className="proof">
        <div className="wrap">
          <span><b>Interac</b> at 15¢ flat</span>
          <span><b>Tap to Pay</b> on iPhone</span>
          <span><b>0%</b> commission</span>
          <span><b>$0</b> client booking fees</span>
          <span><b>Built for Canadian barbers</b></span>
        </div>
      </div>

      {/* inside the app */}
      <section className="blk" id="app" style={{ borderBottom: "1px solid var(--line)" }}>
        <div className="wrap">
          <div className="head">
            <p className="eyebrow">Inside the app</p>
            <h2>The whole shop,<br /><em>in one app.</em></h2>
            <p className="lead">Calendar, walk-ins, payroll, loyalty, reviews and stock — the parts of a barbershop that usually live in five different places, running in one.</p>
          </div>
          <div className="two" style={{ alignItems: "center" }}>
            <div className="devs">
              <div className="dev a"><img src="/new/app-cal.jpg" alt="Calendar" loading="lazy" /></div>
              <div className="dev b"><img src="/new/app-week.jpg" alt="The week view with walk-in, POS and analytics shortcuts" loading="lazy" /></div>
              <div className="dev c"><img src="/new/app-donut.jpg" alt="Booking status — completed, cancelled, confirmed and no-shows" loading="lazy" /></div>
            </div>
            <ul className="bul" style={{ gap: 18 }}>
              <li><b>Calendar &amp; waitlist.</b>Drag to reschedule, fill gaps from the waitlist, let walk-ins check themselves in.</li>
              <li><b>Payroll &amp; commission.</b>Per-barber splits calculated from real takings, not a spreadsheet.</li>
              <li><b>Loyalty &amp; gift cards.</b>Points for regulars, gift cards sold and redeemed at checkout.</li>
              <li><b>Reviews &amp; marketing.</b>Reminders cut no-shows; win-back campaigns refill quiet weeks.</li>
              <li><b>Inventory.</b>Track product down to the bottle.</li>
            </ul>
          </div>
        </div>
      </section>

      {/* the problem */}
      <section className="blk band">
        <img className="bg" src="/new/atmo-tools.jpg" alt="" loading="lazy" />
        <div className="veil" /><div className="grain" />
        <div className="wrap">
          <div className="head" style={{ marginBottom: 0 }}>
            <p className="eyebrow">The old way</p>
            <h2>A paper book works right up until<br /><em>it doesn’t.</em></h2>
            <p className="lead">Until someone doesn’t show and there’s nothing you can do. Until a barber asks what they earned last month and the answer is three hours of counting. Until the phone rings during a fade.</p>
          </div>
        </div>
      </section>

      {/* the day */}
      <section className="blk" id="day">
        <div className="wrap two">
          <div className="copy">
            <p className="eyebrow">Your whole day</p>
            <h2>Every chair,<br /><em>one screen.</em></h2>
            <p className="lead">Open the app and the day is already there — who’s booked, who’s paid, what the shop has taken, and which chair is sitting empty at 1:45.</p>
            <ul className="bul">
              <li><b>Live revenue.</b>Gross, fees and net, updating as the chairs turn over.</li>
              <li><b>Per-barber numbers.</b>Performance, payroll and commission in one place.</li>
              <li><b>No-show rate.</b>Tracked automatically, so you know what it’s costing you.</li>
            </ul>
          </div>
          <div className="dev"><img src="/new/app-home.jpg" alt="The ClipWise dashboard showing revenue, average ticket and no-show rate" loading="lazy" /></div>
        </div>
      </section>

      {/* booking */}
      <section className="blk" id="book" style={{ background: "var(--s1)", borderBlock: "1px solid var(--line)" }}>
        <div className="wrap">
          <div className="head">
            <p className="eyebrow">Client booking</p>
            <h2>Four taps. No app.<br /><em>No fee.</em></h2>
            <p className="lead">Your own booking page — from an Instagram bio to a confirmed appointment with a card on file, without your client ever paying a surcharge.</p>
          </div>
          <div className="rail">
            <div className="step"><p className="sn">01 / SHOP</p><div className="fr"><img src="/new/book-shop.jpg" alt="Shop page" loading="lazy" /></div><p>Your shop, your services, your prices.</p></div>
            <div className="step"><p className="sn">02 / SERVICE</p><div className="fr"><img src="/new/book-service.jpg" alt="Choose services" loading="lazy" /></div><p>Pick one, or combine several in a visit.</p></div>
            <div className="step"><p className="sn">03 / TIME</p><div className="fr"><img src="/new/book-time.jpg" alt="Choose a time" loading="lazy" /></div><p>Real availability, by barber or anyone.</p></div>
            <div className="step"><p className="sn">04 / CONFIRM</p><div className="fr"><img src="/new/book-confirm.jpg" alt="Confirm and pay" loading="lazy" /></div><p>Pay now or reserve — tax shown, total confirmed.</p></div>
          </div>
        </div>
      </section>

      {/* payments */}
      <section className="blk" id="pay">
        <div className="wrap two flip">
          <div className="copy">
            <p className="eyebrow">Payments</p>
            <h2>The cards Canadians<br /><em>actually carry.</em></h2>
            <p className="lead">Interac, credit, cash and online — into your own Stripe account, with sales tax calculated at checkout and every tip tracked to the cent.</p>
            <div className="rates">
              <div className="rate"><span className="l">Interac, tapped or inserted<em>WisePad 3 reader</em></span><span className="v">15¢</span></div>
              <div className="rate"><span className="l">Credit, in person<em>2.7% + 5¢</em></span><span className="v">97¢</span></div>
              <div className="rate"><span className="l">Online booking<em>2.9% + 30¢</em></span><span className="v">$1.29</span></div>
              <div className="rate"><span className="l">Our cut of any of it<em>Not a percentage. Nothing.</em></span><span className="v">$0.00</span></div>
            </div>
            <p className="fine">Shown on a $34 cut. Processing is billed by Stripe at their standard Canadian rates, directly to your own account.</p>
          </div>
          <div className="dev"><img src="/new/app-pay.jpg" alt="The ClipWise payments screen" loading="lazy" /></div>
        </div>
      </section>

      {/* no-shows */}
      <section className="blk band">
        <img className="bg" src="/new/atmo-fade.jpg" alt="" loading="lazy" />
        <div className="veil" /><div className="grain" />
        <div className="wrap two">
          <div className="copy">
            <p className="eyebrow">No-shows</p>
            <h2>The empty chair,<br /><em>covered.</em></h2>
            <p className="lead">Every booking keeps a card on file. Nothing’s charged when they show — but a no-show is one tap, not a phone call you never make.</p>
            <ul className="bul">
              <li><b>Card on file.</b>Saved at booking, charged only if they don’t show.</li>
              <li><b>One tap to charge.</b>Straight from the booking itself.</li>
              <li><b>Your rules.</b>You set the fee and the window.</li>
            </ul>
          </div>
          <div className="dev"><img src="/new/app-checkout.jpg" alt="Charging a no-show from the checkout screen" loading="lazy" /></div>
        </div>
      </section>

      {/* compare */}
      <section className="blk">
        <div className="wrap">
          <div className="head">
            <p className="eyebrow">Compare</p>
            <h2>Built around your business —<br /><em>not ours.</em></h2>
          </div>
          <div className="figs">
            <div className="fig"><p className="n">$0</p><h3>Client booking fees</h3><p>Your clients never pay a surcharge to book. Other platforms add a per-booking fee; we add nothing.</p></div>
            <div className="fig"><p className="n">0%</p><h3>Commission</h3><p>Every client you bring in stays 100% yours. No cut taken on your own followers, ever.</p></div>
            <div className="fig"><p className="n">100%</p><h3>Of every tip</h3><p>Tips go straight to your Stripe account — collected online or from a post-visit link.</p></div>
          </div>
        </div>
      </section>

      {/* pricing — rendered from PLAN_MARKETING (our single source of truth) */}
      <section className="blk" id="price" style={{ background: "var(--s1)", borderBlock: "1px solid var(--line)" }}>
        <div className="wrap">
          <div className="head">
            <p className="eyebrow">Pricing</p>
            <h2>Start free.<br /><em>Upgrade when ready.</em></h2>
          </div>
          <div className="tiers">
            {PLAN_MARKETING.map((p) => (
              <div key={p.plan} className={`tier${p.pop ? " hi" : ""}`}>
                <p className="tn">{p.n}</p>
                <div className="pr"><span className="p">{p.p}</span><span className="u">{p.per}</span></div>
                <ul>{p.yes.map((y, i) => <li key={i}>{y}</li>)}</ul>
                <Link className={`pill ${p.pop ? "w" : "g"}`} href={`/signup?plan=${p.plan}`}>{p.cta}</Link>
              </div>
            ))}
          </div>
          <p className="fine" style={{ marginTop: 26 }}>Card processing is billed by Stripe at their standard Canadian rates, directly to your own account.</p>
        </div>
      </section>

      {/* close */}
      <section className="close">
        <img className="bg" src="/new/atmo-shop.jpg" alt="" loading="lazy" />
        <div className="veil" /><div className="grain" />
        <div className="wrap">
          <p className="eyebrow">Get started</p>
          <h2>Put the notebook down.</h2>
          <p className="lead">Set up your shop, your services and your booking link in an afternoon. No credit card, no contract.</p>
          <div className="cta" style={{ marginTop: 8 }}>
            <Link className="pill w" href="/signup">Get started free</Link>
            <a className="pill g" href="mailto:support@clipwise.ca">Talk to us</a>
          </div>
        </div>
      </section>

    </MarketingShell>
  );
}
