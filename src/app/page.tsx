"use client";
import Link from "next/link";
import { useState } from "react";
import {
  Calendar, CreditCard, BarChart3, MessageSquare, Star, Package,
  Check, X, ChevronDown, ChevronUp, Scissors, Zap, Shield,
  ArrowRight, Menu,
} from "lucide-react";
import { Logo } from "@/components/ui/logo";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const features = [
  { icon: Calendar, title: "Smart Booking", desc: "Online booking with real-time availability. Clients book 24/7 from their phones." },
  { icon: CreditCard, title: "Built-in POS", desc: "Accept card, cash, and online payments. Track every dollar, every tip." },
  { icon: BarChart3, title: "Deep Analytics", desc: "Revenue reports, barber performance, client retention — all at a glance." },
  { icon: MessageSquare, title: "Auto Reminders", desc: "SMS and email reminders slash no-shows by up to 40%." },
  { icon: Star, title: "Loyalty Program", desc: "Reward loyal clients with points and keep them coming back." },
  { icon: Package, title: "Inventory Tracking", desc: "Track products and supplies. Get alerted before you run out." },
];

const plans = [
  {
    name: "Starter", price: 29, highlight: false,
    features: ["1 Barber", "100 appointments/mo", "Online booking", "Basic analytics", "Email reminders"],
    missing: ["Multi-barber", "POS system", "Loyalty program", "Priority support"],
  },
  {
    name: "Pro", price: 49, highlight: true,
    features: ["Up to 3 Barbers", "Unlimited appointments", "Online booking", "Full analytics", "SMS + Email reminders", "POS system", "Loyalty program"],
    missing: ["Unlimited barbers", "Custom branding", "API access"],
  },
  {
    name: "Premium", price: 79, highlight: false,
    features: ["Up to 6 Barbers", "Unlimited appointments", "Online booking", "Full analytics", "SMS + Email reminders", "POS system", "Loyalty program", "Custom branding"],
    missing: ["Unlimited barbers", "API access"],
  },
  {
    name: "Business", price: 99, highlight: false,
    features: ["Unlimited Barbers", "Unlimited appointments", "Online booking", "Full analytics", "SMS + Email reminders", "POS system", "Loyalty program", "Custom branding", "API access", "Priority support", "Dedicated onboarding"],
    missing: [],
  },
];

const competitors = [
  { feature: "Online Booking", clipwise: true, squire: true, booksy: true },
  { feature: "Built-in POS", clipwise: true, squire: true, booksy: false },
  { feature: "Loyalty Program", clipwise: true, squire: false, booksy: true },
  { feature: "Analytics & Reports", clipwise: true, squire: true, booksy: false },
  { feature: "Inventory Management", clipwise: true, squire: false, booksy: false },
  { feature: "SMS Reminders", clipwise: true, squire: true, booksy: true },
  { feature: "No-Show Protection", clipwise: true, squire: false, booksy: false },
  { feature: "Barber Commission Tracking", clipwise: true, squire: false, booksy: false },
  { feature: "Custom Booking Page", clipwise: true, squire: true, booksy: true },
  { feature: "Starting Price", clipwise: "$29/mo", squire: "$49/mo", booksy: "$39/mo" },
];

const testimonials = [
  {
    name: "Marcus J.", shop: "Marcus's Fades – Halifax, NS", rating: 5,
    photo: "https://i.pravatar.cc/80?img=11",
    text: "ClipWise completely transformed how I run my shop. Online booking alone saved me hours on the phone every week. My no-show rate dropped from 25% to under 5%.",
  },
  {
    name: "Darius K.", shop: "King Cutz – Toronto, ON", rating: 5,
    photo: "https://i.pravatar.cc/80?img=14",
    text: "The POS and booking in one app is a game-changer. I used to have Booksy for booking and Square for payments. Now it's all ClipWise. Clean, fast, professional.",
  },
  {
    name: "Trevor M.", shop: "Fresh Fades Barbershop – Moncton, NB", rating: 5,
    photo: "https://i.pravatar.cc/80?img=15",
    text: "My clients love the loyalty points. I've had people come back just to redeem them. Revenue is up 30% since switching. Worth every dollar.",
  },
];

const faqs = [
  { q: "Is there a free trial?", a: "Yes — all plans come with a 14-day free trial. No credit card required." },
  { q: "Can I switch plans at any time?", a: "Absolutely. Upgrade or downgrade anytime from your settings page." },
  { q: "Do my clients need to download an app?", a: "No. Clients book directly from your custom URL in any browser — no app needed." },
  { q: "How does the POS work?", a: "ClipWise connects with Stripe Terminal for card payments, or you can manually log cash and online transactions. Everything syncs to your reports instantly." },
  { q: "Can I import my existing client list?", a: "Yes, you can import via CSV or we can help migrate from Booksy, Squire, or other platforms." },
  { q: "Is my data safe?", a: "All data is encrypted at rest and in transit. We're SOC 2 compliant and PIPEDA-ready for Canadian businesses." },
];

function FAQ({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border border-border rounded-2xl overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-6 py-4 text-left text-white hover:bg-surface-raised transition-colors"
      >
        <span className="font-medium">{q}</span>
        {open ? <ChevronUp size={18} className="text-gold flex-shrink-0" /> : <ChevronDown size={18} className="text-gray-500 flex-shrink-0" />}
      </button>
      {open && <div className="px-6 pb-4 text-sm text-gray-400 leading-relaxed">{a}</div>}
    </div>
  );
}

export default function LandingPage() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <div className="min-h-screen bg-background text-white">
      <nav className="fixed top-0 left-0 right-0 z-50 border-b border-border/50 bg-background/80 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-4 lg:px-8 h-16 flex items-center justify-between">
          <Logo size="sm" />
          <div className="hidden md:flex items-center gap-8 text-sm text-gray-400">
            <a href="#features" className="hover:text-white transition-colors">Features</a>
            <a href="#pricing" className="hover:text-white transition-colors">Pricing</a>
            <a href="#compare" className="hover:text-white transition-colors">Compare</a>
            <a href="#faq" className="hover:text-white transition-colors">FAQ</a>
            <Link href="/shops" className="hover:text-gold transition-colors text-gold/80">Find a Barber</Link>
            <Link href="/my-bookings" className="hover:text-white transition-colors">My Bookings</Link>
          </div>
          <div className="hidden md:flex items-center gap-3">
            <Link href="/login"><Button variant="ghost" size="sm">Log in</Button></Link>
            <Link href="/signup"><Button size="sm">Start Free Trial</Button></Link>
          </div>
          <button className="md:hidden text-gray-400" onClick={() => setMobileMenuOpen(!mobileMenuOpen)}>
            <Menu size={24} />
          </button>
        </div>
        {mobileMenuOpen && (
          <div className="md:hidden border-t border-border bg-surface px-4 py-4 space-y-3">
            {["Features", "Pricing", "Compare", "FAQ"].map((item) => (
              <a key={item} href={`#${item.toLowerCase()}`} className="block text-sm text-gray-400 hover:text-white py-1" onClick={() => setMobileMenuOpen(false)}>{item}</a>
            ))}
            <Link href="/shops" className="block text-sm text-gold py-1" onClick={() => setMobileMenuOpen(false)}>Find a Barber</Link>
            <Link href="/my-bookings" className="block text-sm text-gray-400 hover:text-white py-1" onClick={() => setMobileMenuOpen(false)}>My Bookings</Link>
            <div className="pt-2 flex gap-2">
              <Link href="/login" className="flex-1"><Button variant="outline" className="w-full" size="sm">Log in</Button></Link>
              <Link href="/signup" className="flex-1"><Button className="w-full" size="sm">Sign Up</Button></Link>
            </div>
          </div>
        )}
      </nav>

      <section className="pt-32 pb-20 px-4 lg:px-8 text-center max-w-5xl mx-auto">
        <div className="inline-flex items-center gap-2 bg-gold/10 border border-gold/20 rounded-full px-4 py-1.5 text-sm text-gold mb-8">
          <Zap size={14} />
          <span>The #1 Barbershop Management Platform in Canada</span>
        </div>
        <h1 className="text-4xl md:text-6xl lg:text-7xl font-bold leading-tight mb-6">
          The Smartest Way to<br />
          <span className="gold-text">Run Your Barbershop</span>
        </h1>
        <p className="text-lg md:text-xl text-gray-400 max-w-2xl mx-auto mb-10 leading-relaxed">
          Online booking, built-in POS, analytics, SMS reminders, loyalty programs — everything your shop needs in one premium platform.
        </p>
        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          <Link href="/signup">
            <Button size="lg" className="w-full sm:w-auto text-base px-8">
              Start Free 14-Day Trial <ArrowRight size={18} />
            </Button>
          </Link>
          <Link href="/shops">
            <Button variant="outline" size="lg" className="w-full sm:w-auto text-base px-8">
              Find a Barbershop
            </Button>
          </Link>
        </div>
        <p className="text-xs text-gray-600 mt-4">No credit card required · Cancel anytime · Canadian-made</p>

        <div className="mt-16 relative">
          <div className="rounded-2xl border border-border/50 bg-surface overflow-hidden shadow-2xl shadow-black/50 gold-glow">
            <div className="flex items-center gap-2 px-4 py-3 border-b border-border bg-surface-raised">
              <div className="w-3 h-3 rounded-full bg-red-500/50" />
              <div className="w-3 h-3 rounded-full bg-yellow-500/50" />
              <div className="w-3 h-3 rounded-full bg-emerald-500/50" />
              <div className="flex-1 mx-4 bg-surface rounded-lg px-3 py-1 text-xs text-gray-600">app.clipwise.ca/dashboard</div>
            </div>
            <div className="p-6 grid grid-cols-2 md:grid-cols-4 gap-4">
              {[
                { label: "Today's Appointments", value: "12", color: "text-gold" },
                { label: "Revenue Today", value: "$485", color: "text-emerald-400" },
                { label: "New Clients", value: "3", color: "text-blue-400" },
                { label: "Avg Rating", value: "4.9★", color: "text-purple-400" },
              ].map((s) => (
                <div key={s.label} className="bg-surface-raised rounded-xl p-4 border border-border">
                  <p className="text-xs text-gray-500 mb-1">{s.label}</p>
                  <p className={cn("text-2xl font-bold", s.color)}>{s.value}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section id="features" className="py-20 px-4 lg:px-8 max-w-7xl mx-auto">
        <div className="text-center mb-12">
          <h2 className="text-3xl md:text-4xl font-bold mb-4">Everything your shop needs</h2>
          <p className="text-gray-400 max-w-xl mx-auto">Built specifically for barbers — not a generic booking tool.</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {features.map((f) => (
            <div key={f.title} className="bg-surface border border-border rounded-2xl p-6 hover:border-gold/30 hover:bg-gold/5 transition-all duration-300 group">
              <div className="w-12 h-12 rounded-xl bg-gold/15 flex items-center justify-center mb-4 group-hover:bg-gold/25 transition-colors">
                <f.icon size={22} className="text-gold" />
              </div>
              <h3 className="font-semibold text-white mb-2">{f.title}</h3>
              <p className="text-sm text-gray-400 leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="pricing" className="py-20 px-4 lg:px-8 max-w-7xl mx-auto">
        <div className="text-center mb-12">
          <h2 className="text-3xl md:text-4xl font-bold mb-4">Simple, transparent pricing</h2>
          <p className="text-gray-400">Start free for 14 days. No contracts. Cancel anytime.</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {plans.map((plan) => (
            <div key={plan.name} className={cn(
              "rounded-2xl border p-6 flex flex-col relative",
              plan.highlight ? "border-gold bg-gold/5 gold-glow" : "border-border bg-surface"
            )}>
              {plan.highlight && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-gold text-black text-xs font-bold px-3 py-1 rounded-full">
                  MOST POPULAR
                </div>
              )}
              <h3 className="font-bold text-xl text-white mb-1">{plan.name}</h3>
              <div className="mb-6">
                <span className="text-4xl font-bold text-gold">${plan.price}</span>
                <span className="text-gray-500 text-sm">/mo</span>
              </div>
              <div className="space-y-2.5 flex-1 mb-6">
                {plan.features.map((f) => (
                  <div key={f} className="flex items-start gap-2 text-sm">
                    <Check size={15} className="text-emerald-400 flex-shrink-0 mt-0.5" />
                    <span className="text-gray-300">{f}</span>
                  </div>
                ))}
                {plan.missing.map((f) => (
                  <div key={f} className="flex items-start gap-2 text-sm">
                    <X size={15} className="text-gray-700 flex-shrink-0 mt-0.5" />
                    <span className="text-gray-600">{f}</span>
                  </div>
                ))}
              </div>
              <Link href="/signup">
                <Button variant={plan.highlight ? "gold" : "outline"} className="w-full">
                  Start Free Trial
                </Button>
              </Link>
            </div>
          ))}
        </div>
      </section>

      <section id="compare" className="py-20 px-4 lg:px-8 max-w-5xl mx-auto">
        <div className="text-center mb-12">
          <h2 className="text-3xl md:text-4xl font-bold mb-4">How we stack up</h2>
          <p className="text-gray-400">ClipWise vs the competition.</p>
        </div>
        <div className="overflow-x-auto rounded-2xl border border-border">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-surface-raised">
                <th className="text-left px-6 py-4 text-sm font-medium text-gray-400">Feature</th>
                <th className="px-6 py-4 text-center"><span className="text-gold font-bold">ClipWise</span></th>
                <th className="px-6 py-4 text-center text-sm text-gray-400">Squire</th>
                <th className="px-6 py-4 text-center text-sm text-gray-400">Booksy</th>
              </tr>
            </thead>
            <tbody>
              {competitors.map((row, i) => (
                <tr key={row.feature} className={cn("border-b border-border last:border-0", i % 2 === 0 ? "bg-surface" : "bg-surface/50")}>
                  <td className="px-6 py-3.5 text-sm text-gray-300">{row.feature}</td>
                  {[row.clipwise, row.squire, row.booksy].map((val, j) => (
                    <td key={j} className="px-6 py-3.5 text-center">
                      {typeof val === "boolean" ? (
                        val
                          ? <Check size={18} className={cn("mx-auto", j === 0 ? "text-gold" : "text-emerald-400")} />
                          : <X size={18} className="mx-auto text-red-500/50" />
                      ) : (
                        <span className={cn("text-sm font-semibold", j === 0 ? "text-gold" : "text-gray-400")}>{val}</span>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="py-20 px-4 lg:px-8 max-w-7xl mx-auto">
        <div className="text-center mb-12">
          <h2 className="text-3xl md:text-4xl font-bold mb-4">Loved by barbers across Canada</h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {testimonials.map((t) => (
            <div key={t.name} className="bg-surface border border-border rounded-2xl p-6 hover:border-gold/30 transition-all">
              <div className="flex gap-1 mb-4">
                {Array.from({ length: t.rating }).map((_, i) => (
                  <Star key={i} size={16} className="text-gold fill-gold" />
                ))}
              </div>
              <p className="text-gray-300 text-sm leading-relaxed mb-6 italic">&ldquo;{t.text}&rdquo;</p>
              <div className="flex items-center gap-3">
                <img src={t.photo} alt={t.name} className="w-10 h-10 rounded-full border border-gold/20 object-cover" />
                <div>
                  <p className="text-white font-semibold text-sm">{t.name}</p>
                  <p className="text-gray-500 text-xs">{t.shop}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section id="faq" className="py-20 px-4 lg:px-8 max-w-3xl mx-auto">
        <div className="text-center mb-12">
          <h2 className="text-3xl md:text-4xl font-bold mb-4">Frequently asked questions</h2>
        </div>
        <div className="space-y-3">
          {faqs.map((faq) => <FAQ key={faq.q} {...faq} />)}
        </div>
      </section>

      <section className="py-20 px-4 text-center">
        <div className="max-w-2xl mx-auto bg-surface border border-gold/20 rounded-3xl p-10 gold-glow">
          <Scissors size={40} className="text-gold mx-auto mb-4" />
          <h2 className="text-3xl font-bold mb-3">Ready to level up your shop?</h2>
          <p className="text-gray-400 mb-8">Join hundreds of barbers already using ClipWise to grow their business.</p>
          <Link href="/signup">
            <Button size="lg" className="text-base px-10">
              Start Free Trial — No Card Needed <ArrowRight size={18} />
            </Button>
          </Link>
        </div>
      </section>

      <footer className="border-t border-border py-12 px-4 lg:px-8">
        <div className="max-w-7xl mx-auto grid grid-cols-2 md:grid-cols-4 gap-8">
          <div className="col-span-2 md:col-span-1">
            <Logo size="sm" />
            <p className="text-xs text-gray-600 mt-3 leading-relaxed">The premium barbershop management platform. Made in Canada.</p>
          </div>
          {[
            { title: "Product", links: ["Features", "Pricing", "Changelog", "Roadmap"] },
            { title: "Company", links: ["About", "Blog", "Careers", "Contact"] },
            { title: "Legal", links: ["Privacy Policy", "Terms of Service", "Cookie Policy"] },
          ].map((col) => (
            <div key={col.title}>
              <h4 className="text-white font-semibold text-sm mb-3">{col.title}</h4>
              <ul className="space-y-2">
                {col.links.map((link) => (
                  <li key={link}><a href="#" className="text-xs text-gray-500 hover:text-gold transition-colors">{link}</a></li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="max-w-7xl mx-auto mt-8 pt-6 border-t border-border flex flex-col md:flex-row items-center justify-between gap-2">
          <p className="text-xs text-gray-600">© 2026 ClipWise Technologies Inc. All rights reserved.</p>
          <p className="text-xs text-gray-600 flex items-center gap-1">
            <Shield size={12} className="text-gold" /> SOC 2 Compliant · PIPEDA Ready · 🇨🇦 Canadian-Made
          </p>
        </div>
      </footer>
    </div>
  );
}
