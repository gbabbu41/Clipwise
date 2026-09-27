"use client";
import type { ComponentProps } from "react";
import type ShopLanding from "../../book/[shopslug]/shop-landing";
import { formatCurrency } from "@/lib/utils";
export default function LuxuryLanding({ shop, services, barbers, reviews = [], canGiftCard, onBookNow }: ComponentProps<typeof ShopLanding>) {
  const location = [shop.address, shop.city, shop.province, shop.postal_code].filter(Boolean).join(", ");
  return <div className="lux-store">
    <a className="lux-skip" href="#lux-main">Skip to content</a>
    <header className="lux-header"><a href="#lux-main" className="lux-brand">{shop.name}</a><nav aria-label="Shop"><a href="#lux-services">Services</a><a href="#lux-team">Team</a><a href="#lux-visit">Visit</a></nav><button onClick={onBookNow} className="lux-button">Book now <span aria-hidden>↗</span></button></header>
    <main id="lux-main">
      <section className="lux-hero"><p className="lux-eyebrow">{[shop.city, shop.province].filter(Boolean).join(" · ") || "Your next appointment"}</p><h1>{shop.name}</h1><div className="lux-hero-bottom"><p>{shop.description || "Your chair. Your time."}</p><button className="lux-text-button" onClick={onBookNow}>Find your next appointment <span aria-hidden>↗</span></button></div></section>
      <section id="lux-services" className="lux-section"><h2>Time well spent.</h2><p className="lux-intro">Choose your service. Make it yours.</p><div className="lux-services">{services.map((s, i) => <button onClick={onBookNow} key={s.id} className="lux-service"><span className="lux-index">{String(i + 1).padStart(2, "0")}</span><span><strong>{s.name}</strong><small>{s.duration_minutes} minutes{s.description ? ` · ${s.description}` : ""}</small></span><span className="lux-price">{formatCurrency(s.price)} <span aria-hidden>↗</span></span></button>)}</div>{services.length === 0 && <p>Services will appear here when the shop makes them available.</p>}</section>
      {barbers.length > 0 && <section id="lux-team" className="lux-section"><h2>Behind the chair.</h2><div className="lux-team">{barbers.map(b => <article key={b.id}>{b.photo && <img src={b.photo} alt={b.name} width="480" height="560" loading="lazy" />}<h3>{b.name}</h3>{b.bio && <p>{b.bio}</p>}{b.total_reviews > 0 && <p>{b.rating.toFixed(1)} / 5 · {b.total_reviews} reviews</p>}</article>)}</div></section>}
      {reviews.length > 0 && <section className="lux-section lux-reviews" aria-label="Client reviews">{reviews.slice(0, 3).map((r, i) => <blockquote key={i}><p>“{r.comment}”</p><footer>{r.name} · {r.rating}/5</footer></blockquote>)}</section>}
      <section id="lux-visit" className="lux-section lux-visit"><div><h2>See you soon.</h2>{location && <address>{location}</address>}{shop.phone && <a href={`tel:${shop.phone}`}>{shop.phone}</a>}<p>Appointment times are shown in the booking calendar.</p></div><button className="lux-button" onClick={onBookNow}>Book now <span aria-hidden>↗</span></button></section>
      {canGiftCard && <p className="lux-gift"><a href={`/gift/${shop.slug}`}>Give a gift card ↗</a></p>}
    </main><footer className="lux-footer"><span>{shop.name}</span><span>Booking powered by ClipWise</span></footer><div className="lux-mobile-book"><span>Your next appointment</span><button onClick={onBookNow} className="lux-button">Book now ↗</button></div>
  </div>;
}
