import type { Metadata } from "next";
import Link from "next/link";
import { MarketingShell } from "@/components/marketing/shell";
import { PublicClose } from "@/components/marketing/public-content";
export const metadata: Metadata = { title: "Why ClipWise — Built around your shop", description: "A direct booking page, transparent plans and connected shop tools for Canadian barbers.", alternates: { canonical: "https://clipwise.ca/why-clipwise" } };
export default function WhyClipWisePage() { return <MarketingShell><main id="public-main"><div className="wrap"><header className="public-intro"><p className="eyebrow">Why ClipWise</p><h1>Built around your shop.<br />Not another distraction.</h1><p className="lead">A direct booking experience for your clients. Connected tools for you. Clear plans as your business grows.</p></header></div><section className="public-section"><div className="wrap public-grid">{[
  { title: "Your client relationship", text: "Share your own shop page with your own services and prices. Clients book directly in their browser.", href: "/online-booking", link: "See the booking experience" },
  { title: "Your numbers, clearly", text: "No ClipWise platform commission or client booking surcharge. Subscription and card-processing costs are separate.", href: "/pricing", link: "See every plan" },
  { title: "Tools that connect", text: "Bring the calendar, checkout and shop operations into one system, with features matched to your plan.", href: "/features", link: "Explore the product" },
].map((item,i) => <article className="public-feature" key={item.title}><span className="number">0{i+1}</span><h2 style={{ fontSize: 24 }}>{item.title}</h2><p>{item.text}</p><Link className="public-link" href={item.href}>{item.link} →</Link></article>)}</div></section><PublicClose /></main></MarketingShell>; }
