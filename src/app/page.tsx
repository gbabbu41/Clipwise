"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Logo } from "@/components/ui/logo";
import * as THREE from "three";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import Lenis from "lenis";

// Animated landing page: Lenis momentum scroll + GSAP ScrollTrigger (pinned,
// scrubbed product tour, parallax depth, scrub counters) + a Three.js 3D object
// in the hero. All motion is client-side and guarded so a failure never blanks
// the page; content is visible without JS.

const features = [
  { t: "Smart booking", d: "24/7 online booking with real-time availability. Clients book from their phone — no app needed.", i: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>' },
  { t: "Payments, tips & tax", d: "Card, cash and online payments with configurable sales tax. Every tip tracked to the cent.", i: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/>' },
  { t: "Deep analytics", d: "Revenue, barber performance, payroll and commission — one clean dashboard.", i: '<path d="M3 3v18h18"/><path d="M7 15l4-4 3 3 5-6"/>' },
  { t: "Reminders & marketing", d: "Reminders cut no-shows. Win-back campaigns and review requests keep chairs full.", i: '<path d="M4 4h16v12H5.2L4 17.2z"/>' },
  { t: "Loyalty & gift cards", d: "Reward regulars with points, sell and redeem gift cards, run promos in seconds.", i: '<rect x="2" y="7" width="20" height="14" rx="2"/><path d="M2 12h20M12 7V21"/>' },
  { t: "Inventory, waitlist & kiosk", d: "Track stock, run a live walk-in queue, offer tablet self check-in.", i: '<path d="M21 8V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v2M3 8h18v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM8 12h8"/>' },
];
const plans = [
  { n: "Starter", plan: "starter", p: "Free", per: "forever", forWho: "For a solo barber starting out", pop: false, yes: ["1 barber", "Online booking page", "Appointment management", "Email confirmations & reminders"], no: ["SMS / text alerts", "Reviews & loyalty", "Marketing & analytics", "Walk-in & waitlist", "Customer payments", "POS system"], cta: "Get started free" },
  { n: "Pro", plan: "pro", p: "$23", per: "/mo", forWho: "For solo barbers & small shops — add a shop anytime", pop: true, yes: ["21-day free trial — no card", "Up to 4 barbers", "Online booking + payments", "SMS reminders & alerts", "Reviews, loyalty & marketing", "Walk-in & waitlist", "Tips, tax & analytics", "Stripe payouts"], no: ["Inventory"], cta: "Start free trial" },
  { n: "Premium", plan: "premium", p: "$79", per: "/mo", forWho: "For established shops with a bigger team", pop: false, yes: ["21-day free trial — no card", "Up to 9 barbers", "Everything in Pro", "Full POS terminal", "Inventory", "Staff & payroll", "2 locations — add more $30/mo each (up to 5)"], no: [], cta: "Start free trial" },
];
// Comparison claims cross-checked against Squire's & Booksy's own current
// materials (2026): $0 fees / no marketplace / free plan / Canadian are the
// verifiable differentiators. POS, tips/tax, loyalty & inventory are marked at
// honest parity (competitors have them — Squire gates loyalty/inventory behind
// a higher tier). See the dated disclaimer under the table.
const rows: [string, string | boolean, string | boolean, string | boolean][] = [
  ["Client booking fees", "$0", "$0.99 + fees", "Up to 30% (Boost)"],
  ["No competitor marketplace", true, false, false],
  ["Free forever plan", true, false, false],
  ["Built-in POS", true, true, true],
  ["Tips & sales tax handled", true, true, true],
  ["Loyalty & inventory", true, "Higher tier", true],
  ["Canadian-made", true, false, false],
  ["Starting price", "Free", "From $30/mo", "$29.99/mo + fees"],
];
const faqs = [
  ["Is there really a free plan?", "Yes — Starter is free forever, no credit card. Pro and Premium are billed monthly with no contracts."],
  ["Do my clients need an app?", "No. They book from your link in any browser — no app, no account."],
  ["How do tips and tax work?", "Clients tip at checkout or from a post-visit link — 100% goes to your Stripe account. Set your province’s tax rate once and it applies to bookings and POS automatically."],
  ["Can I import my clients?", "Yes — by CSV, or we’ll help you migrate from Booksy, Squire, or another platform."],
  ["Is my data safe?", "All data is encrypted in transit and at rest, with per-shop access controls. Built PIPEDA-aware for Canadian businesses."],
];
const marquee = ["$0 client booking fees", "0% commission", "100% of tips kept", "Built-in POS", "Tips & tax handled", "No competitor marketplace", "🇨🇦 Canadian-made"];

const Ico = ({ d }: { d: string }) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" width={22} height={22} dangerouslySetInnerHTML={{ __html: d }} />);
const Check = ({ c }: { c: string }) => (<svg viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth={2.4} width={16} height={16}><path d="M20 6 9 17l-5-5" /></svg>);
const Ex = ({ c }: { c: string }) => (<svg viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth={2.4} width={16} height={16}><path d="M18 6 6 18M6 6l12 12" /></svg>);
const cell = (v: string | boolean) => typeof v === "boolean" ? (v ? <Check c="#37d987" /> : <Ex c="#4a4a52" />) : <span>{v}</span>;

export default function LandingPage() {
  const threeRef = useRef<HTMLDivElement | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const closeMenu = () => setMenuOpen(false);

  useEffect(() => {
    const reduce = matchMedia("(prefers-reduced-motion:reduce)").matches;
    // Touch/phone: skip momentum-scroll hijacking entirely. Lenis on mobile
    // fights native scroll and (with scroll-restoration) is what made the page
    // "bounce" to a lower section on load. Native touch scroll is smoother here.
    const isTouch = matchMedia("(pointer:coarse)").matches || innerWidth < 900;
    // Always start at the very top — stop the browser restoring a prior scroll
    // position on refresh (the on-load "jump down" on phones).
    if ("scrollRestoration" in history) history.scrollRestoration = "manual";
    window.scrollTo(0, 0);
    document.documentElement.classList.add("js");
    const cleanups: (() => void)[] = [];

    // Size the hero to one REAL viewport. CSS viewport units (svh/vh) are
    // unreliable in in-app browsers (the Google app's, etc.) — they under-report
    // and leave the hero short, so the dashboard peeks and its scroll-trigger
    // fires on load. Measured innerHeight is reliable everywhere; use it so the
    // hero truly fills the screen and the dashboard stays below the fold.
    const NAV_H = 58;
    const setHeroH = () => document.documentElement.style.setProperty("--hero-h", `${Math.max(480, innerHeight - NAV_H)}px`);
    setHeroH();
    addEventListener("orientationchange", setHeroH);
    cleanups.push(() => removeEventListener("orientationchange", setHeroH));

    // ── Lenis momentum scroll — desktop pointer only, paired with GSAP ────────
    let lenis: Lenis | null = null;
    gsap.registerPlugin(ScrollTrigger);
    if (!reduce && !isTouch) {
      lenis = new Lenis({ duration: 1.1, smoothWheel: true });
      lenis.scrollTo(0, { immediate: true });          // never inherit a restored offset
      lenis.on("scroll", ScrollTrigger.update);
      const raf = (t: number) => lenis!.raf(t * 1000);
      gsap.ticker.add(raf);
      gsap.ticker.lagSmoothing(0);
      cleanups.push(() => { gsap.ticker.remove(raf); lenis!.destroy(); });
    }

    // ── Three.js hero object: slowly rotating wireframe knot, mouse-reactive ──
    if (!reduce && threeRef.current) {
      try {
        const host = threeRef.current;
        const small = innerWidth < 640;
        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(45, host.clientWidth / host.clientHeight, 0.1, 100);
        camera.position.z = small ? 6.4 : 5.2;   // pull back on phones so the knot doesn't crowd the text
        const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
        renderer.setPixelRatio(Math.min(small ? 1.5 : 2, devicePixelRatio));  // lighter on mobile GPUs
        renderer.setSize(host.clientWidth, host.clientHeight);
        host.appendChild(renderer.domElement);

        const geo = new THREE.TorusKnotGeometry(1.35, 0.42, small ? 120 : 180, small ? 18 : 32);
        const mat = new THREE.MeshStandardMaterial({ color: 0x0c0c12, metalness: 0.9, roughness: 0.28, emissive: 0x0a1e44, emissiveIntensity: 0.5 });
        const knot = new THREE.Mesh(geo, mat);
        scene.add(knot);
        const wire = new THREE.LineSegments(new THREE.WireframeGeometry(geo), new THREE.LineBasicMaterial({ color: 0x6ea8fe, transparent: true, opacity: 0.16 }));
        knot.add(wire);
        scene.add(new THREE.AmbientLight(0x404060, 1.1));
        const p1 = new THREE.PointLight(0x6ea8fe, 60, 30); p1.position.set(4, 3, 5); scene.add(p1);
        const p2 = new THREE.PointLight(0xb78bff, 40, 30); p2.position.set(-5, -2, 3); scene.add(p2);

        let mx = 0, my = 0, raf = 0;
        const onMove = (e: PointerEvent) => { mx = e.clientX / innerWidth - 0.5; my = e.clientY / innerHeight - 0.5; };
        addEventListener("pointermove", onMove, { passive: true });
        const clock = new THREE.Clock();
        const loop = () => {
          const t = clock.getElapsedTime();
          knot.rotation.x = t * 0.16 + my * 0.5;
          knot.rotation.y = t * 0.22 + mx * 0.6;
          renderer.render(scene, camera);
          raf = requestAnimationFrame(loop);
        };
        loop();
        const onResize = () => { camera.aspect = host.clientWidth / host.clientHeight; camera.updateProjectionMatrix(); renderer.setSize(host.clientWidth, host.clientHeight); };
        addEventListener("resize", onResize);
        cleanups.push(() => { cancelAnimationFrame(raf); removeEventListener("pointermove", onMove); removeEventListener("resize", onResize); renderer.dispose(); geo.dispose(); mat.dispose(); host.removeChild(renderer.domElement); });
      } catch { /* 3D optional — hero still looks good without it */ }
    }

    // ── GSAP: zoom-in reveals + parallax + scrubbed counters (all screens) ───
    const ctx = gsap.context(() => {
      if (reduce) { gsap.set(".rv, .rv.stagger>*, .rv-zoom", { opacity: 1, scale: 1, y: 0 }); return; }

      // one-by-one reveals with a subtle zoom-in (scale)
      gsap.utils.toArray<HTMLElement>(".rv").forEach((el) => {
        const kids = el.classList.contains("stagger") ? Array.from(el.children) as HTMLElement[] : [el];
        gsap.from(kids, { opacity: 0, y: 28, scale: 0.94, duration: 0.85, ease: "power3.out", stagger: 0.09, scrollTrigger: { trigger: el, start: "top 88%" } });
      });

      // product-tour rows: same gentle rise + zoom
      gsap.utils.toArray<HTMLElement>(".rv-zoom").forEach((el) => {
        gsap.from(el, { opacity: 0, scale: 0.9, y: 44, duration: 1, ease: "power3.out", scrollTrigger: { trigger: el, start: "top 84%" } });
      });

      // dashboard is its own screen below the hero. It's FULLY hidden until you
      // scroll to it (opacity 0 → no sliver peeks at the bottom of the hero, in
      // any browser), then POPS in: rises up + zooms from small to full with a
      // slight overshoot so it snaps toward you. Replays if you scroll back up.
      const small = innerWidth < 640;
      gsap.from(".stage", {
        opacity: 0, scale: small ? 0.92 : 0.86, y: small ? 42 : 56,
        duration: 1.1, ease: "power3.out",
        scrollTrigger: { trigger: ".showcase", start: "top 82%", toggleActions: "play none none reverse" },
      });
      gsap.to(".aurora", { yPercent: 16, ease: "none", scrollTrigger: { trigger: ".hero", start: "top top", end: "bottom top", scrub: true, invalidateOnRefresh: true } });

      // scrubbed stat counters
      gsap.utils.toArray<HTMLElement>("[data-count]").forEach((el) => {
        const to = +(el.dataset.count || 0), dv = +(el.dataset.div || 1), pre = el.dataset.prefix || "", suf = el.dataset.suffix || "";
        const o = { v: 0 };
        gsap.to(o, { v: to, duration: 1.4, ease: "power2.out", scrollTrigger: { trigger: el, start: "top 90%" }, onUpdate: () => { el.textContent = pre + (dv === 1 ? Math.round(o.v) : (o.v / dv).toFixed(1)) + suf; } });
      });
    });
    cleanups.push(() => ctx.revert());

    // Refresh AFTER layout settles — running it synchronously (before fonts,
    // the 3D canvas and hydration finish) computes wrong trigger positions and
    // can shove the scroll down. Two rAFs → post-paint; also re-run on full load.
    let raf1 = 0, raf2 = 0;
    raf1 = requestAnimationFrame(() => { raf2 = requestAnimationFrame(() => { window.scrollTo(0, 0); ScrollTrigger.refresh(); }); });
    const onLoad = () => ScrollTrigger.refresh();
    addEventListener("load", onLoad);
    cleanups.push(() => { cancelAnimationFrame(raf1); cancelAnimationFrame(raf2); removeEventListener("load", onLoad); });

    return () => { cleanups.forEach((f) => { try { f(); } catch { /* noop */ } }); document.documentElement.classList.remove("js"); };
  }, []);

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />

      <nav>
        <div className="wide nav-in">
          <Link href="/" onClick={closeMenu}><Logo size="sm" className="cw-grad" /></Link>
          <div className="nav-links"><a href="#features">Features</a><a href="#tour">Product</a><a href="#pricing">Pricing</a><a href="#compare">Compare</a><Link href="/shops">Find a Barber</Link></div>
          <div className="nav-cta">
            <Link className="btn btn-ghost btn-sm" href="/login">Log in</Link>
            <Link className="btn btn-primary btn-sm mag" href="/signup">Get Started</Link>
            <button className="nav-burger" aria-label={menuOpen ? "Close menu" : "Open menu"} aria-expanded={menuOpen} onClick={() => setMenuOpen(v => !v)}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
                {menuOpen ? <><path d="M6 6l12 12" /><path d="M18 6L6 18" /></> : <><path d="M4 7h16" /><path d="M4 12h16" /><path d="M4 17h16" /></>}
              </svg>
            </button>
          </div>
        </div>
        {menuOpen && (
          <div className="mobmenu">
            <a href="#features" onClick={closeMenu}>Features</a>
            <a href="#tour" onClick={closeMenu}>Product</a>
            <a href="#pricing" onClick={closeMenu}>Pricing</a>
            <a href="#compare" onClick={closeMenu}>Compare</a>
            <Link href="/shops" onClick={closeMenu}>Find a Barber</Link>
            <Link href="/login" onClick={closeMenu} className="mm-login">Log in</Link>
          </div>
        )}
      </nav>

      <header className="hero">
        <div className="aurora"><b className="a1" /><b className="a2" /><b className="a3" /></div>
        <div className="three-host" ref={threeRef} aria-hidden="true" />
        <div className="grain" />
        <div className="wrap">
          <span className="kicker">✦ Canada&rsquo;s <b>barber-first</b> platform</span>
          <h1><span className="ln"><span>Run your barbershop.</span></span><span className="ln"><span className="grad">Beautifully.</span></span></h1>
          <p className="lead">Booking, payments, tips, analytics and loyalty — one calm, powerful platform. Zero client booking fees. Zero commission. Ever.</p>
          <div className="hero-cta">
            <Link className="btn btn-primary mag" href="/signup">Get started free</Link>
            <a className="btn btn-ghost arrow" href="#tour">Take the tour <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M5 12h14M13 6l6 6-6 6" /></svg></a>
          </div>
          <p className="fine">No credit card · 60-second setup · Made in Canada</p>
          <div className="cue" />
        </div>
      </header>

      <section className="showcase">
        <div className="stage">
          <div className="hcard" id="hcard">
            <div className="hbar"><span className="d" style={{ background: "#ff5f57" }} /><span className="d" style={{ background: "#febc2e" }} /><span className="d" style={{ background: "#28c840" }} /><div className="hu">app.clipwise.ca/dashboard</div></div>
            <div className="hbody">
              <div className="hs"><div className="l">Appointments</div><div className="v" data-count="12">12</div></div>
              <div className="hs"><div className="l">Revenue today</div><div className="v g" data-count="485" data-prefix="$">$485</div></div>
              <div className="hs"><div className="l">Tips collected</div><div className="v b" data-count="96" data-prefix="$">$96</div></div>
              <div className="hs"><div className="l">Avg rating</div><div className="v" data-count="49" data-div="10" data-suffix="★">4.9★</div></div>
              <div className="hrow">
                <div className="hp"><h4>Today&rsquo;s schedule</h4>
                  <div className="ap"><span className="av">M</span><div><div className="n">Marcus J.</div><div className="s">Skin fade + beard</div></div><span className="pill" style={{ background: "rgba(55,217,135,.16)", color: "#37d987" }}>Paid</span></div>
                  <div className="ap"><span className="av">D</span><div><div className="n">Darius K.</div><div className="s">Haircut</div></div><span className="t">2:30 PM</span></div>
                  <div className="ap"><span className="av">T</span><div><div className="n">Trevor M.</div><div className="s">Cut + hot towel</div></div><span className="pill" style={{ background: "rgba(110,168,254,.16)", color: "#6ea8fe" }}>Confirmed</span></div>
                </div>
                <div className="hp"><h4>This week</h4>
                  <div className="spark">{[44, 62, 50, 78, 66, 95, 71].map((h, i) => <span key={i} style={{ height: `${h}%`, animationDelay: `${0.05 + i * 0.07}s` }} />)}</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <div className="band"><div className="track">{[...marquee, ...marquee].map((m, i) => <span key={i}>{m}</span>)}</div></div>

      {/* product tour — responsive stacked rows, each zooms in on scroll */}
      <section className="tour" id="tour">
        <div className="wide">
          <div className="center rv" style={{ marginBottom: 60 }}><span className="eyebrow">How it works</span><h2 className="display" style={{ marginTop: 12 }}>From booking to paid, beautifully.</h2></div>

          <div className="tpair rv-zoom">
            <div className="tcopy"><div className="tnum">01 — Booking</div><h3>Clients book you in seconds.</h3><p>A booking page that&rsquo;s yours alone — no app to download, no marketplace showing your rivals. Real-time availability, 24/7.</p></div>
            <div className="tvis">
              <h5>Booking · Fri, Jul 18</h5>
              <div className="slotgrid">{["9:00", "9:30 ✓", "10:00", "10:30", "11:00", "Booked"].map((s, i) => <div key={i} className={`slot ${i === 1 ? "sel" : ""} ${s === "Booked" ? "off" : ""}`}>{s}</div>)}</div>
              <div className="tcard"><div className="row"><span className="mini">M</span><div><div className="tn">Marcus J.</div><div className="tsub">Skin fade + beard · 9:30 AM</div></div><span className="tag" style={{ background: "rgba(55,217,135,.16)", color: "#37d987" }}>Confirmed</span></div></div>
            </div>
          </div>

          <div className="tpair rv-zoom rev">
            <div className="tcopy"><div className="tnum">02 — Payments</div><h3>Get paid, tips and all.</h3><p>Card, cash and online payments with sales tax handled for you. Clients tip at checkout or from a post-visit link — 100% yours.</p></div>
            <div className="tvis">
              <h5>Checkout</h5>
              <div className="tcard"><div className="row"><span>Skin fade + beard</span><b className="mono">$45.00</b></div></div>
              <div className="tcard"><div className="row"><span>HST (15%)</span><b className="mono">$6.75</b></div></div>
              <div className="tiplbl">Add a tip</div>
              <div className="tiprow"><div className="slot">18%</div><div className="slot sel">20% · $9</div><div className="slot">25%</div></div>
              <div className="tcard sel"><div className="row"><b>Total</b><b className="mono">$60.75</b></div></div>
            </div>
          </div>

          <div className="tpair rv-zoom">
            <div className="tcopy"><div className="tnum">03 — Grow</div><h3>See everything, grow faster.</h3><p>Revenue, no-shows, barber performance and loyalty — one clean dashboard, updating live as your day unfolds.</p></div>
            <div className="tvis">
              <h5>This month</h5>
              <div className="kpis"><div className="kpi"><div className="l">Revenue</div><div className="v">$9,840</div></div><div className="kpi"><div className="l">No-show rate</div><div className="v">3.1%</div></div></div>
              <div className="kpi" style={{ marginTop: 10 }}><div className="l">Weekly revenue</div><div className="tbars">{[48, 70, 58, 82, 74, 96, 80].map((h, i) => <span key={i} style={{ height: `${h}%` }} />)}</div></div>
            </div>
          </div>
        </div>
      </section>

      <section>
        <div className="wrap">
          <div className="center rv"><h2 className="display">Built around your business — not ours.</h2></div>
          <div className="three-cards rv stagger">
            <div className="cell"><div className="big">$0</div><h3>Client booking fees</h3><p>Your clients never pay a surcharge to book. Squire adds a per-booking fee; we add nothing.</p></div>
            <div className="cell"><div className="big">0%</div><h3>Commission</h3><p>Every client you bring in stays 100% yours. No 30% cut on your own followers, ever.</p></div>
            <div className="cell"><div className="big">100%</div><h3>Of every tip</h3><p>Tips go straight to your Stripe account — collected online or from a post-visit link.</p></div>
          </div>
        </div>
      </section>

      <section id="features">
        <div className="center rv"><span className="eyebrow">Everything in one place</span><h2 className="display" style={{ marginTop: 12 }}>Six tools. One flat price.</h2><p className="lead">Built for barbers — not a generic booking app.</p></div>
        <div className="wide"><div className="feat rv stagger">{features.map((f) => <div className="fc" key={f.t}><div className="fi"><Ico d={f.i} /></div><h3>{f.t}</h3><p>{f.d}</p></div>)}</div></div>
      </section>

      <section id="pricing">
        <div className="center rv"><span className="eyebrow">Simple, public pricing</span><h2 className="display" style={{ marginTop: 12 }}>Start free. Upgrade when ready.</h2><p className="lead">No contracts. No sales call. Cancel in two clicks.</p></div>
        <div className="price rv stagger">
          {plans.map((p) => (
            <div className={`pc ${p.pop ? "pop" : ""}`} key={p.n}>
              {p.pop && <span className="badge">Most popular</span>}
              <h3>{p.n}</h3>
              <p className="pfor">{p.forWho}</p>
              <div className="pr"><span className="amt">{p.p}</span><span className="per">{p.per}</span></div>
              <div className="pl">
                {p.yes.map((y) => <div key={y}><Check c="#37d987" /><span>{y}</span></div>)}
                {p.no.map((n) => <div className="no" key={n}><Ex c="#74747e" /><span>{n}</span></div>)}
              </div>
              <Link className={`btn ${p.pop ? "btn-primary" : "btn-ghost"} mag`} href={`/signup?plan=${p.plan}`} style={{ width: "100%", justifyContent: "center" }}>{p.cta}</Link>
            </div>
          ))}
        </div>
      </section>

      <section id="compare">
        <div className="center rv"><span className="eyebrow">Head to head</span><h2 className="display" style={{ marginTop: 12 }}>How we compare</h2></div>
        <div className="wrap"><div className="tablewrap rv"><table>
          <thead><tr><th>Feature</th><th className="us">ClipWise</th><th>Squire</th><th>Booksy</th></tr></thead>
          <tbody>{rows.map((r) => <tr key={r[0]}><td>{r[0]}</td><td className="us">{cell(r[1])}</td><td>{cell(r[2])}</td><td>{cell(r[3])}</td></tr>)}</tbody>
        </table></div>
          <p className="disclaimer">Comparison based on publicly available information as of July 2026. Squire™ and Booksy™ are trademarks of their respective owners; ClipWise is not affiliated with or endorsed by them.</p>
        </div>
      </section>

      <section id="faq">
        <div className="center rv"><h2 className="display">Good to know</h2></div>
        <div className="faq rv">{faqs.map((f) => <details key={f[0]}><summary>{f[0]}<span className="p">+</span></summary><div className="ans">{f[1]}</div></details>)}</div>
      </section>

      <section className="final">
        <div className="glow" />
        <div className="wrap"><h2 className="display rv">Ready to level up your shop?</h2><p className="lead rv">Join barbers across Canada keeping 100% of what they earn.</p><div className="rv"><Link className="btn btn-primary mag" href="/signup" style={{ fontSize: 17, padding: "16px 34px" }}>Get started — no card needed</Link></div></div>
      </section>

      <footer>
        <div className="wide">
          <div className="fg">
            <div><Logo size="sm" className="cw-grad" /><p style={{ marginTop: 12, maxWidth: "32ch" }}>The premium barbershop management platform. Made in Canada.</p></div>
            <div><h5>Product</h5><a href="#features">Features</a><a href="#pricing">Pricing</a><Link href="/shops">Find a Barber</Link></div>
            <div><h5>Company</h5><Link href="/why-clipwise">Why ClipWise</Link><Link href="/support">How payments work</Link><a href="mailto:support@clipwise.ca">Contact</a></div>
            <div><h5>Legal</h5><Link href="/privacy">Privacy</Link><Link href="/terms">Terms</Link><Link href="/cookies">Cookies</Link></div>
          </div>
          <div className="fb"><span>© 2026 ClipWise Technologies Inc.</span><span>Privacy-first · PIPEDA-aware · 🇨🇦 Canadian-Made</span></div>
        </div>
      </footer>
    </>
  );
}

const CSS = `
  :root{--bg:#08080a;--bg2:#0e0e12;--panel:#131318;--raised:#17171d;--line:#24242c;--line2:#31313a;--ink:#f6f6f8;--ink2:#a6a6b0;--ink3:#74747e;--accent:#6ea8fe;--good:#37d987;--sans:-apple-system,BlinkMacSystemFont,"SF Pro Display","Segoe UI",Helvetica,Arial,sans-serif;--mono:ui-monospace,"SF Mono",Menlo,monospace}
  html{overflow-x:hidden;scroll-padding-top:70px}
  body{background:var(--bg);color:var(--ink);font-family:var(--sans);line-height:1.5;letter-spacing:-.012em;-webkit-font-smoothing:antialiased;overflow-x:hidden;max-width:100vw}
  body img,body svg,body table{max-width:100%}
  body ::selection{background:var(--ink);color:#000}
  nav :focus-visible,header :focus-visible,section :focus-visible,footer :focus-visible{outline:2px solid var(--accent);outline-offset:3px;border-radius:6px}
  .wrap{max-width:1080px;margin:0 auto;padding:0 max(24px,env(safe-area-inset-right)) 0 max(24px,env(safe-area-inset-left))}
  .wide{max-width:1240px;margin:0 auto;padding:0 max(24px,env(safe-area-inset-right)) 0 max(24px,env(safe-area-inset-left))}
  .display{font-weight:700;letter-spacing:-.035em;line-height:1.05;color:var(--ink)}
  h2.display{font-size:clamp(30px,4.7vw,54px)}
  .eyebrow{font-size:12px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--ink3)}
  .lead{color:var(--ink2);font-size:clamp(17px,2vw,21px);line-height:1.5;font-weight:400}
  .btn{position:relative;display:inline-flex;align-items:center;gap:8px;font-weight:600;font-size:16px;padding:14px 26px;border-radius:980px;cursor:pointer;border:1px solid transparent;transition:transform .25s cubic-bezier(.2,.8,.2,1),background .2s,border-color .2s,box-shadow .3s;text-decoration:none}
  .btn-primary{background:var(--ink);color:#000}.btn-primary:hover{transform:translateY(-2px);box-shadow:0 14px 40px -14px rgba(255,255,255,.5)}
  .btn-ghost{background:rgba(255,255,255,.05);color:var(--ink);border-color:var(--line2);backdrop-filter:blur(6px)}.btn-ghost:hover{border-color:var(--ink);background:rgba(255,255,255,.1)}
  .btn-sm{padding:9px 17px;font-size:14px}
  .arrow svg{width:16px;height:16px;transition:transform .25s}.arrow:hover svg{transform:translateX(4px)}
  nav{position:sticky;top:0;z-index:70;background:rgba(8,8,10,.66);backdrop-filter:saturate(180%) blur(20px);border-bottom:1px solid var(--line);padding-top:env(safe-area-inset-top)}
  .nav-in{height:58px;display:flex;align-items:center;justify-content:space-between}
  .nav-links{display:flex;gap:30px;font-size:13.5px;color:var(--ink2)}.nav-links a{color:var(--ink2);text-decoration:none}.nav-links a:hover{color:var(--ink)}
  .nav-cta{display:flex;gap:10px;align-items:center}
  .nav-burger{display:none;align-items:center;justify-content:center;width:40px;height:40px;flex:none;border:1px solid var(--line2);border-radius:11px;background:rgba(255,255,255,.05);color:var(--ink);cursor:pointer}
  .mobmenu{display:flex;flex-direction:column;padding:6px max(24px,env(safe-area-inset-left)) 16px max(24px,env(safe-area-inset-right));background:rgba(8,8,10,.97);backdrop-filter:saturate(180%) blur(20px);border-bottom:1px solid var(--line)}
  .mobmenu a{padding:14px 4px;color:var(--ink2);text-decoration:none;font-size:15.5px;border-bottom:1px solid var(--line)}
  .mobmenu a:active{color:var(--ink)}.mobmenu a:last-child{border-bottom:0}
  .mobmenu .mm-login{color:var(--ink);font-weight:600}
  @media(max-width:860px){.nav-links{display:none}.nav-burger{display:inline-flex}.nav-cta .btn-ghost{display:none}}
  @media(min-width:861px){.mobmenu{display:none}}
  .hero{position:relative;text-align:center;padding:56px 0 92px;overflow:hidden;isolation:isolate;box-sizing:border-box;min-height:calc(100svh - 58px);min-height:var(--hero-h,calc(100svh - 58px));display:flex;flex-direction:column;justify-content:center}
  .three-host{position:absolute;inset:0;z-index:-1;opacity:.9;pointer-events:none}
  .three-host canvas{width:100%!important;height:100%!important;display:block}
  .aurora{position:absolute;inset:-20% -10% 0;z-index:-2;filter:blur(70px);opacity:.6}
  .aurora b{position:absolute;border-radius:50%;mix-blend-mode:screen}
  .a1{width:52vw;height:52vw;left:8%;top:-6%;background:radial-gradient(circle,rgba(110,168,254,.55),transparent 60%);animation:drift1 16s ease-in-out infinite}
  .a2{width:46vw;height:46vw;right:4%;top:2%;background:radial-gradient(circle,rgba(183,139,255,.45),transparent 60%);animation:drift2 20s ease-in-out infinite}
  .a3{width:40vw;height:40vw;left:34%;top:20%;background:radial-gradient(circle,rgba(55,217,135,.28),transparent 60%);animation:drift3 24s ease-in-out infinite}
  @keyframes drift1{0%,100%{transform:translate(0,0) scale(1)}50%{transform:translate(6%,8%) scale(1.15)}}
  @keyframes drift2{0%,100%{transform:translate(0,0) scale(1.05)}50%{transform:translate(-8%,6%) scale(.9)}}
  @keyframes drift3{0%,100%{transform:translate(0,0)}50%{transform:translate(4%,-8%) scale(1.1)}}
  .hero::after{content:"";position:absolute;inset:0;z-index:-1;background:radial-gradient(120% 70% at 50% 0,transparent 34%,var(--bg) 84%);pointer-events:none}
  .grain{position:absolute;inset:0;z-index:-1;opacity:.3;background-image:radial-gradient(rgba(255,255,255,.05) 1px,transparent 1px);background-size:3px 3px;pointer-events:none}
  .kicker{display:inline-flex;gap:8px;align-items:center;font-size:13px;color:var(--ink2);background:rgba(255,255,255,.05);border:1px solid var(--line2);padding:7px 15px;border-radius:980px;backdrop-filter:blur(8px)}
  .kicker b{color:var(--ink);font-weight:600}
  .hero h1{font-weight:700;letter-spacing:-.05em;line-height:.99;font-size:clamp(40px,8.2vw,98px);margin:26px auto 0;max-width:15ch;overflow-wrap:break-word;color:var(--ink)}
  .hero h1 .ln{display:block}.hero h1 .ln>span{display:inline-block}
  .hero h1 .grad{background:linear-gradient(100deg,#fff,#a9c6ff 55%,#c9b3ff);-webkit-background-clip:text;background-clip:text;color:transparent}
  /* logo gradient — 'accent tail': CLIP stays white, WISE picks up blue→lilac so it reads as a logo first. -webkit-text-fill-color beats the logo's hardcoded white. */
  .cw-grad{background:linear-gradient(90deg,#fff 0%,#fff 46%,#a9c6ff 64%,#c9b3ff 100%);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;color:transparent}
  .hero .lead{color:var(--ink2);max-width:46ch;margin:26px auto 0}
  .hero-cta{display:flex;gap:14px;justify-content:center;flex-wrap:wrap;margin-top:34px}
  .hero .fine{color:var(--ink3);font-size:13px;margin-top:16px}
  .showcase{position:relative;padding:8px 0 96px}
  .stage{position:relative;margin:0 auto;perspective:1600px;will-change:transform,opacity}
  .hcard{width:min(860px,93%);margin:0 auto;border-radius:18px;overflow:hidden;background:linear-gradient(180deg,#15151b,#0b0b0f);border:1px solid var(--line2);box-shadow:0 40px 120px -40px rgba(110,168,254,.3),0 50px 90px -50px #000;transform:rotateX(9deg);transform-origin:center;animation:float 7s ease-in-out infinite}
  @keyframes float{0%,100%{margin-top:0}50%{margin-top:-10px}}
  .hbar{display:flex;align-items:center;gap:7px;padding:12px 15px;border-bottom:1px solid var(--line)}
  .d{width:11px;height:11px;border-radius:50%}
  .hu{flex:1;margin:0 12px;background:#000;border:1px solid var(--line);border-radius:7px;padding:5px 12px;font-family:var(--mono);font-size:11px;color:var(--ink3);text-align:left}
  .hbody{padding:20px;display:grid;grid-template-columns:repeat(4,1fr);gap:12px}
  .hs{background:var(--raised);border:1px solid var(--line);border-radius:13px;padding:15px;text-align:left}
  .hs .l{font-size:11px;color:var(--ink3)}.hs .v{font-family:var(--mono);font-weight:650;font-size:25px;margin-top:7px;font-variant-numeric:tabular-nums;color:var(--ink)}
  .hs .v.g{color:var(--good)}.hs .v.b{color:var(--accent)}
  .hrow{grid-column:1/-1;display:grid;grid-template-columns:1.5fr 1fr;gap:12px}
  .hp{background:var(--raised);border:1px solid var(--line);border-radius:13px;padding:15px;text-align:left}
  .hp h4{font-size:10.5px;text-transform:uppercase;letter-spacing:.05em;color:var(--ink3);margin-bottom:11px;font-weight:600}
  .ap{display:flex;align-items:center;gap:11px;padding:8px 0;border-top:1px solid var(--line)}.ap:first-of-type{border-top:0}
  .av{width:28px;height:28px;border-radius:50%;background:#20202a;border:1px solid var(--line2);display:grid;place-items:center;font-size:11px;font-weight:650}
  .ap .n{font-size:12.5px;font-weight:600}.ap .s{font-size:11px;color:var(--ink3)}
  .ap .t{margin-left:auto;font-family:var(--mono);font-size:11px;color:var(--ink3)}
  .ap .pill{margin-left:auto;font-size:10px;font-weight:650;padding:3px 8px;border-radius:6px}
  .spark{height:88px;display:flex;align-items:flex-end;gap:7px}
  .spark span{flex:1;background:linear-gradient(180deg,var(--accent),rgba(110,168,254,.2));border-radius:4px 4px 0 0;transform-origin:bottom;animation:grow 1s cubic-bezier(.16,1,.3,1) both}
  @keyframes grow{from{transform:scaleY(0)}to{transform:scaleY(1)}}
  @media(max-width:720px){.hbody{grid-template-columns:repeat(2,1fr)}.hrow{grid-template-columns:1fr}}
  .cue{position:absolute;bottom:22px;left:50%;transform:translateX(-50%);width:24px;height:38px;border:1.5px solid var(--line2);border-radius:14px}
  .cue::after{content:"";position:absolute;top:7px;left:50%;transform:translateX(-50%);width:3px;height:7px;border-radius:2px;background:var(--ink2);animation:cue 1.7s ease-in-out infinite}
  @keyframes cue{0%{opacity:0;transform:translate(-50%,0)}40%{opacity:1}100%{opacity:0;transform:translate(-50%,12px)}}
  .band{overflow:hidden;border-top:1px solid var(--line);border-bottom:1px solid var(--line);background:var(--bg2);padding:16px 0;margin-top:64px;-webkit-mask-image:linear-gradient(90deg,transparent,#000 8%,#000 92%,transparent);mask-image:linear-gradient(90deg,transparent,#000 8%,#000 92%,transparent)}
  .track{display:flex;gap:42px;width:max-content;animation:marq 30s linear infinite}
  .track span{display:inline-flex;gap:9px;align-items:center;white-space:nowrap;font-size:14px;color:var(--ink2)}
  @keyframes marq{to{transform:translateX(-50%)}}
  /* ── product tour: responsive stacked rows ── */
  .tpair{display:grid;grid-template-columns:1fr 1.05fr;gap:48px;align-items:center;margin-bottom:56px}
  .tpair:last-child{margin-bottom:0}
  .tpair.rev .tcopy{order:2}
  .tnum{font-family:var(--mono);font-size:13px;color:var(--accent)}
  .tcopy h3{font-size:clamp(26px,3.4vw,40px);font-weight:700;letter-spacing:-.03em;margin:12px 0 14px;line-height:1.08;color:var(--ink)}
  .tcopy p{font-size:17px;color:var(--ink2);max-width:38ch;line-height:1.55}
  .tvis{border-radius:22px;border:1px solid var(--line);background:var(--panel);overflow:hidden;box-shadow:0 40px 90px -50px #000;padding:26px}
  .tvis h5{font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:var(--ink3);margin-bottom:14px;font-weight:600}
  .slotgrid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
  .slot{border:1px solid var(--line);border-radius:11px;padding:13px 6px;text-align:center;font-weight:650;font-size:14px;color:var(--ink)}
  .slot.sel{background:var(--ink);color:#000;border-color:var(--ink)}.slot.off{color:var(--ink3);font-weight:500}
  .tiplbl{font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:var(--ink3);font-weight:600;margin:14px 0 0}
  .tiprow{display:flex;gap:8px;margin:8px 0 0}
  .tcard{background:var(--raised);border:1px solid var(--line);border-radius:13px;padding:14px;margin-top:10px}
  .tcard.sel{background:var(--ink);color:#000;border-color:var(--ink)}
  .row{display:flex;align-items:center;gap:10px}.mono{margin-left:auto;font-family:var(--mono)}
  .mini{width:30px;height:30px;border-radius:50%;background:var(--raised);border:1px solid var(--line2);display:grid;place-items:center;font-size:12px;font-weight:650}
  .tag{margin-left:auto;font-size:11px;font-weight:650;padding:3px 9px;border-radius:7px}
  .tn{font-weight:600;font-size:14px}.tsub{font-size:12px;color:var(--ink3)}
  .kpis{display:grid;grid-template-columns:1fr 1fr;gap:10px}
  .kpi{background:var(--raised);border:1px solid var(--line);border-radius:13px;padding:14px}
  .kpi .l{font-size:11px;color:var(--ink3)}.kpi .v{font-size:24px;font-weight:700;font-family:var(--mono);margin-top:6px;color:var(--ink)}
  .tbars{display:flex;align-items:flex-end;gap:8px;height:120px;margin-top:8px}.tbars span{flex:1;background:var(--accent);border-radius:4px 4px 0 0}
  @media(max-width:860px){.tpair{grid-template-columns:1fr;gap:22px;margin-bottom:40px}.tpair.rev .tcopy{order:0}}
  section{padding:104px 0}
  section>.wrap,section>.wide,section>.center{width:100%}
  .center{text-align:center;max-width:660px;margin:0 auto 56px}.center .lead{margin-top:16px}
  @media(max-width:860px){section{padding:76px 0}}
  .three-cards{display:grid;grid-template-columns:repeat(3,1fr);border:1px solid var(--line);border-radius:22px;overflow:hidden;background:var(--panel)}
  .three-cards .cell{padding:44px 28px}.three-cards .cell:not(:last-child){border-right:1px solid var(--line)}
  .three-cards .big{font-size:clamp(44px,6vw,68px);font-weight:700;letter-spacing:-.05em;background:linear-gradient(120deg,#fff,#a9c6ff);-webkit-background-clip:text;background-clip:text;color:transparent}
  .three-cards h3{font-size:17px;font-weight:650;margin:8px 0 8px;color:var(--ink)}.three-cards p{font-size:14.5px;color:var(--ink2);line-height:1.55}
  @media(max-width:860px){.three-cards{grid-template-columns:1fr}.three-cards .cell:not(:last-child){border-right:0;border-bottom:1px solid var(--line)}}
  .feat{display:grid;grid-template-columns:repeat(3,1fr);gap:1px;background:var(--line);border:1px solid var(--line);border-radius:22px;overflow:hidden}
  .fc{background:var(--panel);padding:32px 28px;transition:background .3s}.fc:hover{background:var(--raised)}
  .fi{width:40px;height:40px;display:grid;place-items:center;color:var(--accent);margin-bottom:18px;background:rgba(110,168,254,.1);border:1px solid rgba(110,168,254,.2);border-radius:11px}
  .fc h3{font-size:17px;font-weight:650;margin-bottom:8px;color:var(--ink)}.fc p{font-size:14px;color:var(--ink2);line-height:1.6}
  @media(max-width:860px){.feat{grid-template-columns:1fr}}
  .price{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;max-width:960px;margin:0 auto}
  .pc{border:1px solid var(--line);border-radius:22px;padding:30px;background:var(--panel);display:flex;flex-direction:column;transition:transform .25s,border-color .25s}
  .pc:hover{transform:translateY(-6px);border-color:var(--line2)}.pc.pop{border-color:var(--accent);background:linear-gradient(180deg,rgba(110,168,254,.08),var(--panel))}
  .badge{align-self:flex-start;font-size:11px;font-weight:650;padding:5px 12px;border-radius:980px;background:var(--accent);color:#00122e;margin-bottom:14px}
  .pc h3{font-size:20px;font-weight:650;color:var(--ink)}.pfor{margin-top:6px;font-size:12.5px;line-height:1.4;color:var(--ink3);min-height:35px}.pr{margin:10px 0 22px;display:flex;align-items:baseline;gap:5px}.pr .amt{font-size:46px;font-weight:700;letter-spacing:-.04em;color:var(--ink)}.pr .per{font-size:14px;color:var(--ink3)}
  .pl{display:flex;flex-direction:column;gap:12px;flex:1;margin-bottom:24px}.pl div{display:flex;gap:10px;align-items:flex-start;font-size:14px;color:var(--ink2)}.pl svg{flex:none;margin-top:2px}.pl .no{color:var(--ink3)}
  @media(max-width:860px){.price{grid-template-columns:1fr;max-width:420px}}
  .tablewrap{overflow-x:auto;-webkit-overflow-scrolling:touch;border:1px solid var(--line);border-radius:18px;background:var(--panel);max-width:100%}
  table{width:100%;border-collapse:collapse}
  th,td{padding:15px 18px;text-align:center;font-size:14px;border-bottom:1px solid var(--line);color:var(--ink2)}
  @media(max-width:620px){th,td{padding:12px 9px;font-size:12px}thead th.us{font-size:13px}}
  th:first-child,td:first-child{text-align:left;color:var(--ink2)}
  thead th{font-weight:600;color:var(--ink3);font-size:12.5px;text-transform:uppercase;letter-spacing:.03em}thead th.us{color:var(--ink);font-size:15px;text-transform:none}
  tbody tr:last-child td{border-bottom:0}tbody tr:nth-child(even){background:rgba(255,255,255,.015)}td.us{color:var(--accent);font-weight:650}
  .disclaimer{max-width:64ch;margin:16px auto 0;text-align:center;font-size:12px;line-height:1.55;color:var(--ink3)}
  .tg{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}
  .tc{border:1px solid var(--line);border-radius:18px;padding:26px;background:var(--panel)}
  .stars{letter-spacing:2px;font-size:14px;margin-bottom:14px;color:#ffd166}.tc p{font-size:15px;line-height:1.6;margin-bottom:20px;color:#d9d9de}
  .who{display:flex;align-items:center;gap:11px}.who .av{width:38px;height:38px}.who .n{font-size:13.5px;font-weight:650;color:var(--ink)}.who .s{font-size:12px;color:var(--ink3)}
  @media(max-width:860px){.tg{grid-template-columns:1fr}}
  .faq{max-width:720px;margin:0 auto;border-top:1px solid var(--line)}
  details{border-bottom:1px solid var(--line)}
  summary{list-style:none;cursor:pointer;padding:22px 4px;font-weight:550;font-size:17px;display:flex;justify-content:space-between;gap:14px;align-items:center;color:var(--ink)}
  summary::-webkit-details-marker{display:none}summary .p{font-size:22px;color:var(--ink3);transition:transform .25s;font-weight:300}
  details[open] .p{transform:rotate(45deg)}.ans{padding:0 4px 22px;font-size:15px;color:var(--ink2);line-height:1.6;max-width:60ch}
  .final{text-align:center;position:relative;overflow:hidden}
  .final .glow{position:absolute;inset:auto 0 -40% 0;height:80%;background:radial-gradient(50% 100% at 50% 100%,rgba(110,168,254,.22),transparent 70%);z-index:-1}
  .final h2{font-size:clamp(32px,5.5vw,60px)}.final .lead{margin:18px auto 30px;max-width:40ch}
  footer{border-top:1px solid var(--line);padding:48px 0 40px;color:var(--ink2);font-size:13px}
  .fg{display:grid;grid-template-columns:1.6fr repeat(3,1fr);gap:28px}
  footer h5{color:var(--ink);font-size:13px;font-weight:650;margin-bottom:12px}
  footer a{display:block;padding:4px 0;color:var(--ink2);text-decoration:none}footer a:hover{color:var(--ink)}
  .fb{display:flex;justify-content:space-between;flex-wrap:wrap;gap:10px;margin-top:34px;padding-top:22px;border-top:1px solid var(--line);font-size:12px;color:var(--ink3)}
  @media(max-width:860px){.fg{grid-template-columns:1fr 1fr}}
  /* ── phone polish (most visitors) ── */
  @media(max-width:640px){
    .wrap,.wide{padding-left:max(18px,env(safe-area-inset-left));padding-right:max(18px,env(safe-area-inset-right))}
    .nav-cta{gap:8px}.nav-cta .btn{padding:10px 15px;font-size:13px}
    section{padding:60px 0}
    .center{margin:0 auto 34px}
    h2.display{font-size:clamp(25px,7.4vw,34px)}
    .lead{font-size:15.5px}
    .hero{padding:40px 0 66px}
    .three-host{opacity:.34}
    .aurora{opacity:.42;filter:blur(56px)}
    .grain{opacity:.18}
    .kicker{font-size:11.5px;padding:6px 12px}
    .hero h1{font-size:clamp(32px,10vw,44px);letter-spacing:-.03em;margin-top:20px;line-height:1.02}
    .hero .lead{margin-top:18px;font-size:16px}
    .hero-cta{margin-top:24px;gap:10px;width:100%}
    .hero-cta .btn{flex:1;min-width:0;justify-content:center;padding:13px 14px;font-size:15px}
    .fine{margin-top:14px}
    .cue{bottom:16px}
    .showcase{padding:4px 0 60px}
    .stage{margin:0 auto}
    .hcard{width:94%;border-radius:14px;transform:rotateX(6deg)}
    .hbar{padding:10px 12px}
    .hbody{padding:13px;gap:9px}
    .hs{padding:12px;border-radius:11px}.hs .l{font-size:10.5px}.hs .v{font-size:21px;margin-top:5px}
    .hp{padding:13px}
    .band{margin-top:44px;padding:13px 0}.track{gap:30px}.track span{font-size:13px}
    .three-cards .cell{padding:28px 22px}.three-cards .big{font-size:clamp(40px,13vw,56px)}
    .fc{padding:24px 22px}
    .price{gap:12px;max-width:none;padding:0 18px}.pc{padding:22px 20px;border-radius:18px}.pc h3{font-size:18px}.badge{margin-bottom:12px}.pr{margin:10px 0 18px}.pr .amt{font-size:36px}.pl{gap:10px;margin-bottom:20px}.pl div{font-size:13.5px}
    .tour .center{margin-bottom:34px}
    .tpair{gap:18px;margin-bottom:34px}
    .tcopy h3{font-size:clamp(23px,7vw,30px)}.tcopy p{font-size:15px}
    .tvis{padding:18px}
    .slot{padding:11px 4px;font-size:13px}
    .tc{padding:22px}.tc p{font-size:14.5px}
    .faq{margin:0 18px}summary{font-size:15px;padding:16px 0;gap:12px;overflow-wrap:anywhere}summary .p{font-size:20px}.ans{font-size:14px;padding:0 0 18px}
    .final .lead{font-size:16px}
    footer{padding:40px 0 34px}.fg{gap:22px}
    .fb{flex-direction:column;gap:6px}
  }
`;
