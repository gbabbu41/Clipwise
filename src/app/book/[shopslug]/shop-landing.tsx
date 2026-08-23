"use client";
import { useEffect, useRef } from "react";
import type { Shop, Service, Barber } from "@/lib/database.types";
import { formatPhone } from "@/lib/validation";

/* ── ShopLanding ──────────────────────────────────────────────────────────────
   A standalone, dark, cinematic "brand moment" for a shop's public page — the
   first thing a customer sees. One job: make the shop look premium and get a tap
   on Book Now, which hands off to the (light, emerald) booking wizard.

   Inspired by the ClipWise marketing homepage (aurora atmosphere, grain, gradient
   display type, pill CTAs, scroll reveals) but recoloured to the shop's emerald
   identity and populated entirely from the shop's own data. Fully self-contained:
   its own scoped CSS (`.sl` prefix) and a lightweight IntersectionObserver for
   reveals — no heavy 3D/scroll libraries, so it stays fast on a phone PWA. */

// Tiny pure formatters (kept local so this component is self-contained).
const displayUrl = (u: string) => u.replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/$/, "");
const ensureHttp = (u: string) => (/^https?:\/\//i.test(u) ? u : `https://${u}`);
const igHandle = (u: string) => {
  const m = u.trim().replace(/\/+$/, "").match(/instagram\.com\/([^/?#]+)/i);
  return (m ? m[1] : u.trim()).replace(/^@/, "");
};
const directionsUrl = (shop: Pick<Shop, "name" | "address" | "city" | "province" | "postal_code" | "google_place_id">) => {
  if (shop.google_place_id) return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(shop.name || "")}&query_place_id=${shop.google_place_id}`;
  const q = [shop.name, shop.address, shop.city, shop.province, shop.postal_code].filter(Boolean).join(", ");
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
};
const shopInitials = (name?: string | null) =>
  (name || "").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase() || "").join("") || "CW";

type Testimonial = { name: string; rating: number; comment: string };

const Stars = ({ n, className }: { n: number; className?: string }) => {
  const full = Math.round(n);
  return (
    <span className={className} aria-label={`${n.toFixed(1)} out of 5`}>
      {"★★★★★".split("").map((_, i) => (
        <span key={i} style={{ opacity: i < full ? 1 : 0.22 }}>★</span>
      ))}
    </span>
  );
};

export default function ShopLanding({
  shop,
  services,
  barbers,
  reviews = [],
  canGiftCard,
  onBookNow,
}: {
  shop: Shop;
  services: Service[];
  barbers: Barber[];
  reviews?: Testimonial[];
  canGiftCard: boolean;
  onBookNow: () => void;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);

  // Lightweight reveal-on-scroll — add `.in` when an `.sl-rv` enters the viewport.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const els = Array.from(root.querySelectorAll<HTMLElement>(".sl-rv"));
    if (!("IntersectionObserver" in window) || matchMedia("(prefers-reduced-motion:reduce)").matches) {
      els.forEach((el) => el.classList.add("in"));
      return;
    }
    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } }),
      { threshold: 0.12, rootMargin: "0px 0px -8% 0px" }
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  // ── Derived content ────────────────────────────────────────────────────────
  const location = [shop.city, shop.province].filter(Boolean).join(", ");
  const priceFrom = services.length ? Math.min(...services.map((s) => s.price)) : 0;

  // Aggregate rating across barbers, weighted by each barber's review count.
  const totalReviews = barbers.reduce((n, b) => n + (b.total_reviews || 0), 0);
  const weighted = barbers.reduce((sum, b) => sum + (b.rating || 0) * (b.total_reviews || 0), 0);
  const avgRating = totalReviews > 0 ? weighted / totalReviews : 0;
  const hasRating = avgRating > 0 && totalReviews > 0;

  // Services grouped by category, preserving first-seen category order.
  const catOrder: string[] = [];
  const byCat = new Map<string, Service[]>();
  services.forEach((s) => {
    const c = (s.category || "Services").trim() || "Services";
    if (!byCat.has(c)) { byCat.set(c, []); catOrder.push(c); }
    byCat.get(c)!.push(s);
  });

  const ig = shop.instagram ? igHandle(shop.instagram) : "";
  const showVisit = !!(shop.address || shop.city || shop.phone || shop.email || ig || shop.website);
  const showDirections = !!(shop.address || shop.city);

  const fmtDur = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ""}` : `${m} min`);
  const money = (n: number) => `$${Number.isInteger(n) ? n : n.toFixed(2)}`;

  const stats: { v: string; l: string }[] = [];
  if (hasRating) stats.push({ v: `${avgRating.toFixed(1)}★`, l: `${totalReviews} review${totalReviews === 1 ? "" : "s"}` });
  if (barbers.length) stats.push({ v: `${barbers.length}`, l: barbers.length === 1 ? "Barber" : "Barbers" });
  if (services.length) stats.push({ v: `${services.length}`, l: services.length === 1 ? "Service" : "Services" });
  if (priceFrom > 0) stats.push({ v: money(priceFrom), l: "From" });

  return (
    <div className="sl" ref={rootRef}>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />

      {/* ── HERO ───────────────────────────────────────────────────────────── */}
      <header className="sl-hero">
        <div className="sl-aurora" aria-hidden="true"><b className="sl-a1" /><b className="sl-a2" /><b className="sl-a3" /></div>
        <div className="sl-grain" aria-hidden="true" />
        <div className="sl-vignette" aria-hidden="true" />

        <div className="sl-hero-in">
          <div className="sl-logo sl-rv">
            {shop.logo
              ? <img src={shop.logo} alt={shop.name} />
              : <span className="sl-logo-fb">{shopInitials(shop.name)}</span>}
          </div>

          <div className="sl-eyebrow sl-rv">
            <span className="sl-dot" />
            {hasRating ? <><Stars n={avgRating} className="sl-eb-stars" /> <b>{avgRating.toFixed(1)}</b> · {location || "Barbershop"}</> : (location || "Barbershop")}
          </div>

          <h1 className="sl-title sl-rv">{shop.name}</h1>

          {shop.description
            ? <p className="sl-tag sl-rv">{shop.description}</p>
            : <p className="sl-tag sl-rv">Precision cuts, sharp fades and a clean finish — book your chair in seconds.</p>}

          <div className="sl-cta sl-rv">
            <button className="sl-btn sl-btn-primary" onClick={onBookNow}>
              Book now
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
            </button>
            {services.length > 0 && <a className="sl-btn sl-btn-ghost" href="#sl-services">View services</a>}
          </div>

          {location && <p className="sl-hero-meta sl-rv">📍 {shop.address ? `${shop.address}, ${location}` : location}</p>}

          <span className="sl-scroll" aria-hidden="true" />
        </div>
      </header>

      {/* ── STAT BAND ──────────────────────────────────────────────────────── */}
      {stats.length > 0 && (
        <div className="sl-stats sl-rv">
          {stats.map((s, i) => (
            <div className="sl-stat" key={i}>
              <div className="sl-stat-v">{s.v}</div>
              <div className="sl-stat-l">{s.l}</div>
            </div>
          ))}
        </div>
      )}

      {/* ── SERVICES ───────────────────────────────────────────────────────── */}
      {services.length > 0 && (
        <section className="sl-sec" id="sl-services">
          <div className="sl-head sl-rv">
            <span className="sl-kick">The menu</span>
            <h2>Services &amp; pricing</h2>
          </div>
          <div className="sl-menu">
            {catOrder.map((cat) => (
              <div className="sl-cat sl-rv" key={cat}>
                {catOrder.length > 1 && <div className="sl-cat-name">{cat}</div>}
                <div className="sl-cat-list">
                  {byCat.get(cat)!.map((s) => (
                    <div className="sl-srv" key={s.id}>
                      <div className="sl-srv-main">
                        <div className="sl-srv-name">{s.name}</div>
                        {s.description && <div className="sl-srv-desc">{s.description}</div>}
                        <div className="sl-srv-dur">{fmtDur(s.duration_minutes)}</div>
                      </div>
                      <div className="sl-srv-price">{money(s.price)}</div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── TEAM ───────────────────────────────────────────────────────────── */}
      {barbers.length > 0 && (
        <section className="sl-sec">
          <div className="sl-head sl-rv">
            <span className="sl-kick">The chair</span>
            <h2>Meet the team</h2>
          </div>
          <div className={`sl-team sl-rv ${barbers.length === 1 ? "one" : ""}`}>
            {barbers.map((b) => (
              <div className="sl-barber" key={b.id}>
                <div className="sl-barber-ph">
                  {b.photo ? <img src={b.photo} alt={b.name} loading="lazy" decoding="async" /> : <span>{(b.name?.[0] || "?").toUpperCase()}</span>}
                </div>
                <div className="sl-barber-name">{b.name}</div>
                {b.rating > 0 && b.total_reviews > 0 && (
                  <div className="sl-barber-rate"><Stars n={b.rating} className="sl-br-stars" /> {b.rating.toFixed(1)} <span>· {b.total_reviews}</span></div>
                )}
                {b.bio && <p className="sl-barber-bio">{b.bio}</p>}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── REVIEWS ────────────────────────────────────────────────────────── */}
      {reviews.length > 0 && (
        <section className="sl-sec">
          <div className="sl-head sl-rv">
            <span className="sl-kick">Word on the street</span>
            <h2>What clients say</h2>
          </div>
          <div className="sl-reviews sl-rv">
            {reviews.slice(0, 6).map((r, i) => (
              <figure className="sl-review" key={i}>
                <Stars n={r.rating} className="sl-rev-stars" />
                <blockquote>“{r.comment}”</blockquote>
                <figcaption>{r.name || "Verified client"}</figcaption>
              </figure>
            ))}
          </div>
        </section>
      )}

      {/* ── VISIT ──────────────────────────────────────────────────────────── */}
      {showVisit && (
        <section className="sl-sec">
          <div className="sl-head sl-rv">
            <span className="sl-kick">Come through</span>
            <h2>Visit us</h2>
          </div>
          <div className="sl-visit sl-rv">
            {(shop.address || location) && (
              <div className="sl-visit-addr">
                <div className="sl-vi-label">Location</div>
                <div className="sl-vi-val">{[shop.address, location].filter(Boolean).join(", ")}</div>
                {showDirections && (
                  <a className="sl-btn sl-btn-ghost sl-btn-sm" href={directionsUrl(shop)} target="_blank" rel="noopener noreferrer">🧭 Get directions</a>
                )}
              </div>
            )}
            <div className="sl-visit-contact">
              <div className="sl-vi-label">Get in touch</div>
              <div className="sl-contacts">
                {shop.phone && <a href={`tel:${shop.phone}`}><ContactIcon type="phone" /> {formatPhone(shop.phone)}</a>}
                {shop.email && <a href={`mailto:${shop.email}`}><ContactIcon type="mail" /> {shop.email}</a>}
                {ig && <a href={`https://instagram.com/${ig}`} target="_blank" rel="noopener noreferrer"><ContactIcon type="ig" /> @{ig}</a>}
                {shop.website && <a href={ensureHttp(shop.website)} target="_blank" rel="noopener noreferrer"><ContactIcon type="web" /> {displayUrl(shop.website)}</a>}
              </div>
              {canGiftCard && <a className="sl-btn sl-btn-ghost sl-btn-sm" href={`/gift/${shop.slug}`}>🎁 Buy a gift card</a>}
            </div>
          </div>
        </section>
      )}

      {/* ── FINAL CTA ──────────────────────────────────────────────────────── */}
      <section className="sl-final">
        <div className="sl-final-glow" aria-hidden="true" />
        <h2 className="sl-rv">Ready for a fresh cut?</h2>
        <p className="sl-rv">Pick your barber, service and time — it takes about a minute.</p>
        <div className="sl-rv">
          <button className="sl-btn sl-btn-primary sl-btn-lg" onClick={onBookNow}>
            Book your chair
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
          </button>
        </div>
        <p className="sl-powered">Powered by <b>ClipWise</b></p>
      </section>

      {/* ── STICKY BOOK BAR (mobile) ───────────────────────────────────────── */}
      <div className="sl-sticky">
        <div className="sl-sticky-in">
          <div className="sl-sticky-meta">
            {priceFrom > 0 ? <><span className="sl-sm-from">From {money(priceFrom)}</span><span className="sl-sm-sub">{shop.name}</span></> : <span className="sl-sm-sub">{shop.name}</span>}
          </div>
          <button className="sl-btn sl-btn-primary" onClick={onBookNow}>Book now</button>
        </div>
      </div>
    </div>
  );
}

function ContactIcon({ type }: { type: "phone" | "mail" | "ig" | "web" }) {
  const p: Record<string, string> = {
    phone: '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.9.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/>',
    mail: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 6L2 7"/>',
    ig: '<rect x="2" y="2" width="20" height="20" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1"/>',
    web: '<circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15 15 0 0 1 0 20 15 15 0 0 1 0-20"/>',
  };
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" width={17} height={17} dangerouslySetInnerHTML={{ __html: p[type] }} />;
}

const CSS = `
.sl{--bg:#08080a;--bg2:#0c0d10;--panel:#121317;--raised:#171a20;--line:#23252c;--line2:#30333c;
  --ink:#f5f6f8;--ink2:#a6acb5;--ink3:#71767f;
  --em:#10b981;--em2:#34d399;--em-deep:#0b6e4f;--em-ink:#03130c;--gold:#d9b25f;
  --sans:-apple-system,BlinkMacSystemFont,"SF Pro Display","Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  background:var(--bg);color:var(--ink);font-family:var(--sans);line-height:1.5;letter-spacing:-.012em;
  -webkit-font-smoothing:antialiased;min-height:100dvh;position:relative;overflow-x:clip}
.sl *{box-sizing:border-box}
.sl img{max-width:100%;display:block}
.sl a{color:inherit;text-decoration:none}
.sl :focus-visible{outline:2px solid var(--em2);outline-offset:3px;border-radius:8px}
.sl-rv{opacity:0;transform:translateY(22px) scale(.985);transition:opacity .7s cubic-bezier(.2,.7,.2,1),transform .7s cubic-bezier(.2,.7,.2,1)}
.sl-rv.in{opacity:1;transform:none}
@media (prefers-reduced-motion:reduce){.sl-rv{opacity:1!important;transform:none!important}}

/* ── Buttons ── */
.sl-btn{position:relative;display:inline-flex;align-items:center;justify-content:center;gap:8px;font-family:inherit;font-weight:650;
  font-size:15.5px;padding:14px 24px;border-radius:980px;cursor:pointer;border:1px solid transparent;text-decoration:none;
  transition:transform .2s cubic-bezier(.2,.8,.2,1),box-shadow .3s,background .2s,border-color .2s;letter-spacing:-.01em}
.sl-btn svg{width:17px;height:17px}
.sl-btn-primary{background:linear-gradient(180deg,var(--em2),var(--em));color:var(--em-ink);box-shadow:0 10px 34px -10px rgba(16,185,129,.6),inset 0 1px 0 rgba(255,255,255,.25)}
.sl-btn-primary:hover{transform:translateY(-2px);box-shadow:0 18px 46px -12px rgba(16,185,129,.7),inset 0 1px 0 rgba(255,255,255,.3)}
.sl-btn-primary:active{transform:translateY(0)}
.sl-btn-ghost{background:rgba(255,255,255,.05);color:var(--ink);border-color:var(--line2);backdrop-filter:blur(6px)}
.sl-btn-ghost:hover{background:rgba(255,255,255,.1);border-color:var(--ink3)}
.sl-btn-lg{font-size:17px;padding:17px 34px}
.sl-btn-sm{font-size:13.5px;padding:10px 16px}

/* ── Hero ── */
.sl-hero{position:relative;min-height:100dvh;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;
  padding:calc(env(safe-area-inset-top) + 40px) 22px 64px;overflow:hidden;isolation:isolate}
.sl-aurora{position:absolute;inset:-15% -10%;z-index:-2;filter:blur(72px);opacity:.55}
.sl-aurora b{position:absolute;border-radius:50%;mix-blend-mode:screen;display:block}
.sl-a1{width:60vw;height:60vw;left:-6%;top:-8%;background:radial-gradient(circle,rgba(16,185,129,.6),transparent 60%);animation:slDrift1 18s ease-in-out infinite}
.sl-a2{width:52vw;height:52vw;right:-8%;top:4%;background:radial-gradient(circle,rgba(20,120,110,.55),transparent 62%);animation:slDrift2 22s ease-in-out infinite}
.sl-a3{width:44vw;height:44vw;left:28%;bottom:-14%;background:radial-gradient(circle,rgba(217,178,95,.28),transparent 62%);animation:slDrift3 26s ease-in-out infinite}
@keyframes slDrift1{0%,100%{transform:translate(0,0) scale(1)}50%{transform:translate(6%,7%) scale(1.14)}}
@keyframes slDrift2{0%,100%{transform:translate(0,0) scale(1.06)}50%{transform:translate(-7%,5%) scale(.9)}}
@keyframes slDrift3{0%,100%{transform:translate(0,0)}50%{transform:translate(5%,-7%) scale(1.12)}}
.sl-grain{position:absolute;inset:0;z-index:-1;opacity:.22;pointer-events:none;background-image:radial-gradient(rgba(255,255,255,.06) 1px,transparent 1px);background-size:3px 3px}
.sl-vignette{position:absolute;inset:0;z-index:-1;pointer-events:none;background:radial-gradient(120% 78% at 50% 26%,transparent 40%,var(--bg) 88%)}
.sl-hero-in{width:100%;max-width:620px;display:flex;flex-direction:column;align-items:center}
.sl-logo{width:104px;height:104px;border-radius:28px;overflow:hidden;border:1px solid var(--line2);
  box-shadow:0 20px 60px -22px rgba(0,0,0,.8),0 0 0 6px rgba(16,185,129,.06);background:var(--panel)}
.sl-logo img{width:100%;height:100%;object-fit:cover}
.sl-logo-fb{width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:38px;font-weight:800;letter-spacing:-.03em;
  background:linear-gradient(150deg,var(--em2),var(--em-deep));color:#fff}
.sl-eyebrow{display:inline-flex;align-items:center;gap:8px;margin-top:22px;font-size:13px;color:var(--ink2);
  background:rgba(255,255,255,.05);border:1px solid var(--line2);padding:7px 15px;border-radius:980px;backdrop-filter:blur(8px)}
.sl-eyebrow b{color:var(--ink);font-weight:700}
.sl-eb-stars{color:var(--gold);font-size:12px;letter-spacing:1px}
.sl-dot{width:7px;height:7px;border-radius:50%;background:var(--em2);box-shadow:0 0 10px 1px var(--em2)}
.sl-title{font-weight:800;letter-spacing:-.045em;line-height:1.0;font-size:clamp(40px,10vw,76px);margin:20px 0 0;max-width:16ch;
  text-transform:uppercase;background:linear-gradient(160deg,#fff 30%,#c7f6e4 70%,var(--em2));-webkit-background-clip:text;background-clip:text;color:transparent}
.sl-tag{color:var(--ink2);font-size:clamp(15px,2.4vw,18px);line-height:1.55;max-width:44ch;margin:20px 0 0}
.sl-cta{display:flex;gap:12px;flex-wrap:wrap;justify-content:center;margin-top:32px}
.sl-hero-meta{margin-top:22px;font-size:13.5px;color:var(--ink3)}
.sl-scroll{width:24px;height:38px;border:1.5px solid var(--line2);border-radius:14px;margin-top:40px;position:relative}
.sl-scroll::after{content:"";position:absolute;top:7px;left:50%;transform:translateX(-50%);width:3px;height:7px;border-radius:2px;background:var(--ink2);animation:slCue 1.7s ease-in-out infinite}
@keyframes slCue{0%{opacity:0;transform:translate(-50%,0)}40%{opacity:1}100%{opacity:0;transform:translate(-50%,12px)}}

/* ── Stat band ── */
.sl-stats{display:flex;flex-wrap:wrap;justify-content:center;gap:14px;padding:6px 20px 8px;max-width:760px;margin:0 auto}
.sl-stat{flex:1;min-width:120px;background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:18px 14px;text-align:center}
.sl-stat-v{font-size:26px;font-weight:750;letter-spacing:-.03em;color:var(--ink);font-variant-numeric:tabular-nums}
.sl-stat-l{font-size:11.5px;text-transform:uppercase;letter-spacing:.06em;color:var(--ink3);margin-top:4px}

/* ── Sections ── */
.sl-sec{max-width:820px;margin:0 auto;padding:64px 22px 0}
.sl-head{margin-bottom:26px}
.sl-kick{font-size:12px;font-weight:650;letter-spacing:.14em;text-transform:uppercase;color:var(--em2)}
.sl-head h2{font-size:clamp(26px,5vw,40px);font-weight:750;letter-spacing:-.035em;line-height:1.06;margin:10px 0 0;color:var(--ink)}

/* Services menu */
.sl-menu{display:flex;flex-direction:column;gap:26px}
.sl-cat-name{font-size:12px;font-weight:650;letter-spacing:.1em;text-transform:uppercase;color:var(--ink3);margin-bottom:10px}
.sl-cat-list{display:flex;flex-direction:column;background:var(--panel);border:1px solid var(--line);border-radius:18px;overflow:hidden}
.sl-srv{display:flex;align-items:flex-start;gap:16px;padding:17px 18px;border-top:1px solid var(--line)}
.sl-srv:first-child{border-top:0}
.sl-srv-main{flex:1;min-width:0}
.sl-srv-name{font-size:16px;font-weight:600;color:var(--ink)}
.sl-srv-desc{font-size:13.5px;color:var(--ink2);line-height:1.5;margin-top:3px}
.sl-srv-dur{font-size:12px;color:var(--ink3);margin-top:6px}
.sl-srv-price{font-size:16px;font-weight:700;color:var(--em2);font-variant-numeric:tabular-nums;white-space:nowrap}

/* Team */
.sl-team{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}
.sl-team.one{grid-template-columns:1fr;max-width:360px}
.sl-barber{background:var(--panel);border:1px solid var(--line);border-radius:18px;padding:18px;text-align:center}
.sl-barber-ph{width:78px;height:78px;border-radius:50%;margin:0 auto 12px;overflow:hidden;border:1px solid var(--line2);
  background:linear-gradient(150deg,var(--em-deep),#0a3b2c);display:flex;align-items:center;justify-content:center}
.sl-barber-ph img{width:100%;height:100%;object-fit:cover}
.sl-barber-ph span{font-size:28px;font-weight:800;color:#dff7ec}
.sl-barber-name{font-size:15.5px;font-weight:650;color:var(--ink)}
.sl-barber-rate{font-size:12.5px;color:var(--ink2);margin-top:5px;font-weight:600}
.sl-br-stars{color:var(--gold);font-size:11px;letter-spacing:.5px;margin-right:3px}
.sl-barber-rate span{color:var(--ink3);font-weight:500}
.sl-barber-bio{font-size:13px;color:var(--ink2);line-height:1.5;margin-top:10px}

/* Reviews */
.sl-reviews{display:grid;grid-template-columns:repeat(2,1fr);gap:14px}
.sl-review{margin:0;background:var(--panel);border:1px solid var(--line);border-radius:18px;padding:20px}
.sl-rev-stars{color:var(--gold);font-size:13px;letter-spacing:1px}
.sl-review blockquote{margin:12px 0 14px;font-size:15px;line-height:1.6;color:#dde0e5}
.sl-review figcaption{font-size:13px;font-weight:600;color:var(--ink3)}

/* Visit */
.sl-visit{display:grid;grid-template-columns:1fr 1fr;gap:14px}
.sl-visit-addr,.sl-visit-contact{background:var(--panel);border:1px solid var(--line);border-radius:18px;padding:22px}
.sl-vi-label{font-size:11.5px;font-weight:650;letter-spacing:.1em;text-transform:uppercase;color:var(--ink3);margin-bottom:10px}
.sl-vi-val{font-size:15px;color:var(--ink);line-height:1.5;margin-bottom:16px}
.sl-contacts{display:flex;flex-direction:column;gap:12px;margin-bottom:16px}
.sl-contacts a{display:flex;align-items:center;gap:10px;font-size:14.5px;color:var(--ink2)}
.sl-contacts a:hover{color:var(--ink)}
.sl-contacts svg{color:var(--em2);flex:none}
.sl-visit-contact .sl-btn,.sl-visit-addr .sl-btn{width:100%}

/* Final */
.sl-final{position:relative;text-align:center;padding:90px 22px 120px;margin-top:64px;overflow:hidden;isolation:isolate}
.sl-final-glow{position:absolute;inset:auto 0 -30% 0;height:80%;z-index:-1;background:radial-gradient(50% 100% at 50% 100%,rgba(16,185,129,.24),transparent 70%)}
.sl-final h2{font-size:clamp(28px,6vw,50px);font-weight:800;letter-spacing:-.04em;line-height:1.05;color:var(--ink)}
.sl-final p{color:var(--ink2);font-size:clamp(15px,2.2vw,18px);margin:16px auto 30px;max-width:40ch}
.sl-powered{margin-top:34px;font-size:12px;color:var(--ink3);letter-spacing:.02em}
.sl-powered b{color:var(--ink2);font-weight:650}

/* Sticky mobile book bar */
.sl-sticky{position:fixed;left:0;right:0;bottom:0;z-index:40;padding:10px 14px calc(10px + env(safe-area-inset-bottom));
  background:linear-gradient(to top,var(--bg) 60%,transparent);pointer-events:none}
.sl-sticky-in{max-width:520px;margin:0 auto;display:flex;align-items:center;gap:12px;pointer-events:auto;
  background:rgba(18,19,23,.92);backdrop-filter:blur(14px);border:1px solid var(--line2);border-radius:980px;padding:8px 8px 8px 20px;
  box-shadow:0 12px 40px -12px rgba(0,0,0,.7)}
.sl-sticky-meta{flex:1;min-width:0;display:flex;flex-direction:column;line-height:1.15}
.sl-sm-from{font-size:14px;font-weight:700;color:var(--ink)}
.sl-sm-sub{font-size:11.5px;color:var(--ink3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sl-sticky .sl-btn{padding:12px 22px;flex:none}

@media(min-width:641px){
  .sl-sticky{display:none}
}
@media(max-width:640px){
  .sl-team{grid-template-columns:repeat(2,1fr)}
  .sl-reviews{grid-template-columns:1fr}
  .sl-visit{grid-template-columns:1fr}
  .sl-sec{padding-top:52px}
  .sl-final{padding:70px 22px 40px;margin-top:48px}
  /* keep content clear of the sticky bar */
  .sl-final{padding-bottom:96px}
}
`;
