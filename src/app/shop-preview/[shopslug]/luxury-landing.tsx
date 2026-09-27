"use client";
import { ArrowUpRight, ArrowDown, Globe, Mail, MapPin } from "lucide-react";
import type { ComponentProps } from "react";
import type ShopLanding from "../../book/[shopslug]/shop-landing";
import { shopDirections, shopSocialLinks, shopEmailLink } from "@/lib/shop-public-links";
import { formatCurrency } from "@/lib/utils";
function SocialIcon({ label }: { label: string }) {
  if (label === "Website") return <Globe size={16} aria-hidden="true" data-contact-icon={label} />;
  return <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" data-contact-icon={label}>
    {label === "Instagram" ? <g fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r=".8" fill="currentColor" stroke="none"/></g>
      : label === "Facebook" ? <path fill="currentColor" d="M14 22v-9h3l.5-4H14V6.5c0-1.1.3-1.5 1.8-1.5H18V1.3A27 27 0 0 0 14.8 1C11.6 1 10 2.9 10 6v3H7v4h3v9h4Z"/>
      : label === "YouTube" ? <><rect x="2" y="5" width="20" height="14" rx="4" fill="none" stroke="currentColor" strokeWidth="1.8"/><path d="m10 9 6 3-6 3Z" fill="currentColor"/></>
      : <path fill="currentColor" d="M14 3h3c.3 2.4 1.6 3.8 4 4v3a9 9 0 0 1-4-1.3V16a6 6 0 1 1-6-6v3a3 3 0 1 0 3 3V3Z"/>}
  </svg>;
}
export default function LuxuryLanding({ shop, services, barbers, reviews = [], canGiftCard, onBookNow }: ComponentProps<typeof ShopLanding>) {
  const words=shop.name.trim().split(/\s+/);const split=Math.max(1,Math.floor(words.length/2));
  const location=[shop.address,shop.city,shop.province,shop.postal_code].filter(Boolean).join(", ");
  const directions = shopDirections(shop);
  const socials = shopSocialLinks(shop);
  const email = shop.email?.trim();
  const emailLink = shopEmailLink(email);
  return <div className="lux-template">
    <a className="skip" href="#main">Skip to content</a>
    <header className="topbar"><div className="wrap"><a className="brand" href="#main">{shop.name.toUpperCase()}<span>BARBER STUDIO</span></a><nav className="links" aria-label="Main navigation"><a href="#services">The services</a><a href="#work">The craft</a><a href="#visit">Visit us</a><button className="solid" onClick={onBookNow}>Book now <ArrowUpRight size={17} aria-hidden="true" /></button></nav></div></header>
    <main id="main" className="wrap">
      <section className="hero" aria-labelledby="shop-name"><div className="hero-top"><span className="eyebrow">Barber studio{shop.city ? ` / ${shop.city}` : ""}</span></div><h1 id="shop-name"><span>{words.slice(0,split).join(" ").toUpperCase()}</span>{words.length>1&&<span className="second">{words.slice(split).join(" ").toUpperCase()}</span>}</h1><div className="hero-bottom">{shop.description?.trim() && <p>{shop.description}</p>}<a href="#services" className="text-link">Find your service <ArrowDown size={17} aria-hidden="true" /></a></div><figure className="hero-photo"><img src="/shopfront-reference/hero-shop.jpg" alt="Editorial image: a barber at work in a brick-lined studio" width="2000" height="1335" fetchPriority="high"/><figcaption className="photo-caption"><span>BARBERING / A PLACE TO RESET</span><span>Editorial photography</span></figcaption></figure></section>
      <section className="section" id="services"><div className="section-head"><div><span className="eyebrow">01 / In the chair</span><h2>The essentials,<br/>done with care.</h2></div><p className="muted">Shop service menu<br/>Prices shown in CAD</p></div><div className="services"><p className="intro">Choose a service to see available appointment times.</p><div>{services.map(s=><button className="service" key={s.id} onClick={onBookNow}><span><strong>{s.name}</strong><small>{s.description ? `${s.description} · ` : ""}{s.duration_minutes} min</small></span><span className="price">{formatCurrency(s.price)}</span><ArrowUpRight className="arrow" size={18} aria-hidden="true" /></button>)}{services.length===0&&<p>Services will appear here when the shop makes them available.</p>}</div></div></section>
      <section className="section" id="work"><div className="section-head"><div><span className="eyebrow">02 / The craft</span><h2>It’s in the details.</h2></div><p className="muted">The art of barbering.<br/>Editorial photography.</p></div><div className="gallery"><figure><img src="/shopfront-reference/atmo-fade.jpg" alt="Editorial image: detailed haircut with a comb and scissors" loading="lazy" width="1000" height="1500"/><figcaption><span>Shape &amp; texture</span><span>01</span></figcaption></figure><figure><img src="/shopfront-reference/atmo-tools.jpg" alt="Editorial image: professional barber tools" loading="lazy" width="1500" height="1000"/><figcaption><span>Tools of the trade</span><span>02</span></figcaption></figure></div></section>
      {barbers.length>0&&<section className="section"><div className="section-head"><div><span className="eyebrow">03 / Your people</span><h2>Find your chair.</h2></div></div><div className="team">{barbers.map(b=><article key={b.id}>{b.photo?<img className="profile-photo" src={b.photo} alt={b.name} width="58" height="66" loading="lazy"/>:<div className="monogram" aria-hidden="true">{b.name.split(/\s+/).slice(0,2).map(n=>n[0]).join("")}</div>}<div><h3>{b.name}</h3>{b.bio&&<p>{b.bio}</p>}{b.total_reviews>0&&<p>{b.rating.toFixed(1)} / 5 · {b.total_reviews} reviews</p>}</div></article>)}</div></section>}
      {reviews.length>0&&<section className="section client-reviews" aria-label="Client reviews">{reviews.slice(0,3).map((r,i)=><blockquote key={i}><p>“{r.comment}”</p><footer>{r.name} · {r.rating}/5</footer></blockquote>)}</section>}
      <section className="section visit" id="visit"><div><span className="eyebrow">04 / Come on in</span><h2>Your next<br/>good hair day.</h2><address>{location}{shop.phone&&<><br/><a href={`tel:${shop.phone}`}>{shop.phone}</a></>}</address><div className="contact-links">{emailLink&&<a href={emailLink}><Mail size={16} aria-hidden="true" />Email <ArrowUpRight size={16} aria-hidden="true" /></a>}{directions&&<a href={directions} target="_blank" rel="noopener noreferrer"><MapPin size={16} aria-hidden="true" />Get directions <ArrowUpRight size={16} aria-hidden="true" /></a>}{socials.map(link=><a key={link.label} href={link.href} target="_blank" rel="noopener noreferrer"><SocialIcon label={link.label} />{link.label} <ArrowUpRight size={16} aria-hidden="true" /></a>)}</div></div><div className="visit-action"><button className="solid" onClick={onBookNow}>Find a time <ArrowUpRight size={17} aria-hidden="true" /></button></div></section>
      {canGiftCard&&<p className="gift-link"><a href={`/gift/${shop.slug}`}>Give a gift card <ArrowUpRight size={17} aria-hidden="true" /></a></p>}
      <footer className="footer"><span>{shop.name.toUpperCase()}</span><span>Powered by ClipWise.</span><span>Book directly with the shop</span></footer>
    </main><div className="mobile-book"><p><strong>Your chair is waiting.</strong>Find your next appointment</p><button className="solid" onClick={onBookNow}>Book now <ArrowUpRight size={17} aria-hidden="true" /></button></div>
  </div>;
}
