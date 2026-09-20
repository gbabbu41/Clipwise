import Link from "next/link";
import type { CSSProperties } from "react";
import { PLAN_MARKETING } from "@/lib/plan-marketing";

// `ctaStyle` is an opt-in override for the "Get started" pill — every caller
// that omits it (product pages, why-clipwise, pricing) keeps the shared
// default white button untouched. Only the homepage passes one, to try a
// different accent on just that page without recoloring this button
// everywhere else it's reused.
export function PublicClose({ ctaStyle }: { ctaStyle?: CSSProperties } = {}) {
  return <section className="public-close"><div className="wrap"><div><h2>Your next chapter starts here.</h2><p>Start free. Set up your shop at your pace.</p></div><Link href="/signup" className="pill w" style={ctaStyle}>Get started free ↗</Link></div></section>;
}

export function PricingCards() {
  return <div className="public-prices">{PLAN_MARKETING.map(p => <article className={`public-price${p.pop ? " featured" : ""}`} key={p.plan}>
    <h2 className="eyebrow">{p.n}</h2><p className="amount">{p.p}<span>{p.per}</span></p><p className="audience">{p.forWho}</p>
    <ul>{p.yes.map(item => <li key={item}>{item}</li>)}</ul>
    {p.no.length > 0 && <details><summary>Not included in {p.n}</summary>{p.no.map(item => <p key={item}>{item}</p>)}</details>}
    <Link href={`/signup?plan=${p.plan}`} className={`pill ${p.pop ? "w" : "g"}`}>{p.cta}</Link>
  </article>)}</div>;
}

export function PublicFAQ({ items }: { items: { question: string; answer: string }[] }) {
  return <div className="public-faq">{items.map(item => <details key={item.question}><summary>{item.question}</summary><p>{item.answer}</p></details>)}</div>;
}

export const PRODUCT_PAGES = {
  features: {
    eyebrow: "The product", title: "One place to run the shop.", description: "Bookings, checkout and your team—connected around the way a barbershop works.", image: "app-cal.jpg", imageAlt: "ClipWise appointment calendar", imageTitle: "A clearer view of every chair.", imageText: "See the day, manage appointments and keep walk-ins close to the calendar. Less switching between tools, more focus on the next client.",
    items: [
      { title: "Keep the day moving", text: "Calendar, online booking and walk-in tools for the front of your shop.", href: "/online-booking", link: "Explore booking" },
      { title: "Close out with confidence", text: "Track payments, tips and sales tax without piecing together the day by hand.", href: "/payments", link: "Explore payments" },
      { title: "Give your team clarity", text: "Staff, payroll and inventory tools on the plans built for larger shops.", href: "/pricing", link: "Compare included features" },
    ],
    faq: [{ question: "Is everything included in the free plan?", answer: "Starter covers a single chair, appointment management, online booking and email confirmations and reminders. Pro and Premium add further tools; see Pricing for the exact inclusions." }, { question: "Do I need to change how my whole shop works?", answer: "Start with your shop details, services and booking link. Add other tools when you need them; the existing portal guides your setup." }],
  },
  "online-booking": {
    eyebrow: "Online booking", title: "Your booking link. Their next cut.", description: "Let clients choose a service and a time in their browser. No app download or ClipWise booking surcharge.", image: "book-time.jpg", imageAlt: "Available times on a ClipWise booking page", imageTitle: "From your profile to your chair.", imageText: "Share your shop’s link from your website, social profile or a message. Clients see your services and available times, then confirm their appointment.",
    items: [
      { title: "Choose a service", text: "Your services, duration and prices in one clear menu.", href: "/shops", link: "Find a shop" },
      { title: "Find a time", text: "Availability follows your shop’s schedule and the selected service.", href: "/features", link: "See the calendar tools" },
      { title: "Confirm the details", text: "Payment and card requirements follow your shop’s settings and payment setup.", href: "/payments", link: "Understand payments" },
    ],
    faq: [{ question: "Do clients need an account?", answer: "No. Clients can book through your public shop page without creating a ClipWise account." }, { question: "Does every booking save a card?", answer: "No. Card collection depends on your no-show settings, payment setup and the payment option selected. Bookings without a saved card cannot be charged after the fact." }],
  },
  payments: {
    eyebrow: "Payments", title: "A clean finish. A clear checkout.", description: "Cash, card and online payments, with tips and tax tracked alongside the appointment.", image: "app-pay.jpg", imageAlt: "ClipWise payment totals and transaction breakdown", imageTitle: "Know what came in.", imageText: "See collected revenue, processing fees and net amounts in one place. Card payments run through your shop’s connected Stripe account.",
    items: [
      { title: "In the shop", text: "Record cash and accept supported card payments. Reader and Tap to Pay availability depend on your setup.", href: "/support", link: "How payments work" },
      { title: "At booking", text: "Offer supported online payment options through your booking page.", href: "/online-booking", link: "Explore online booking" },
      { title: "On your terms", text: "ClipWise takes no platform commission. Stripe processing fees and your subscription are separate.", href: "/pricing", link: "See the plans" },
    ],
    faq: [{ question: "Who processes card payments?", answer: "Stripe processes payments through your shop’s connected account. Its processing fees, verification requirements and payout schedule apply." }, { question: "Are payments included in Starter?", answer: "Starter does not include customer payments or POS. Pro and Premium include payment features. Hardware and processing costs are separate; see Pricing for plan details." }],
  },
} as const;
