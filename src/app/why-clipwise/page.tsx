"use client";
import Link from "next/link";
import { Check, X, ArrowRight, Scissors } from "lucide-react";
import { Logo } from "@/components/ui/logo";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const squireProblems = [
  { problem: "Charges your clients $1–5 per booking", quote: '"fees mounted up to nearly $5 per client after booking online" — barber, Capterra', fix: "ClipWise charges $0 in client-side booking fees. Ever." },
  { problem: "Disappears after you sign the contract", quote: '"My Squire rep promised everything to get me into the contract and then disappeared" — Joshua O., Capterra', fix: "No contracts. No sales calls. Cancel from Settings in 2 clicks." },
  { problem: "Key features locked behind $150–$250/mo tiers", quote: '"At $250 a month, I expect to get what I want, not what they want" — Roger D., Capterra', fix: "Every ClipWise feature is included at one flat price. No upsells." },
  { problem: "Shows your clients your competitors", quote: '"The app forces clients to download their app, which allows them to see everyone else in your area you\'re competing with" — barber, Capterra', fix: "Your booking page is yours only. No marketplace. No competitor exposure." },
  { problem: "No public pricing — requires a sales call", quote: '"Getting a quote requires a sales call, which slows down evaluation" — multiple sources', fix: "ClipWise pricing is public, simple, and on the website. No demos required." },
];

const booksyProblems = [
  { problem: "30% commission on your own existing clients", quote: '"These were my followers and my traffic" — Chris F., Trustpilot, charged 30% on clients from his own website', fix: "Zero commissions. Every client you bring in stays yours — 100%." },
  { problem: "Freezes your payouts without explanation", quote: '"Booksy placed a lock on my account and froze my payouts without notifying me" — BBB complaint', fix: "Your money is always yours. ClipWise doesn\'t hold payouts." },
  { problem: "Customer support is non-existent", quote: '"They didn\'t care when I called" — SmartCustomer. 1.4/5 stars from 89 reviews. Only 9% would recommend.', fix: "Real human support. Respond within 24 hours — or we\'ll say so upfront." },
  { problem: "Forces clients to download the Booksy app", quote: '"Mandatory app download requirement deters clients" — Jekairea S., Capterra', fix: "Clients book in their browser. No account. No download. No friction." },
  { problem: "Clients become loyal to Booksy, not to you", quote: '"Clients can end up loyal to Booksy rather than to you specifically" — Goldie comparison', fix: "Clients book directly through your page. They remember your shop — not ours." },
];

const comparison = [
  { feature: "Client-side booking fees", clipwise: "$0 — none ever", squire: "$1–5 per booking", booksy: "30% Boost commission" },
  { feature: "No app download for clients", clipwise: true, squire: false, booksy: false },
  { feature: "No competitor marketplace", clipwise: true, squire: false, booksy: false },
  { feature: "Public transparent pricing", clipwise: true, squire: false, booksy: true },
  { feature: "All features at base price", clipwise: true, squire: false, booksy: false },
  { feature: "Cancel anytime, no call", clipwise: true, squire: false, booksy: false },
  { feature: "Client hair profile / memory", clipwise: true, squire: false, booksy: false },
  { feature: "No-show tracking per client", clipwise: true, squire: false, booksy: false },
  { feature: "Starting price", clipwise: "Free", squire: "No public pricing", booksy: "$29.99/mo + fees" },
];

export default function WhyClipWisePage() {
  return (
    <div className="min-h-screen bg-background text-white">
      {/* Nav */}
      <nav className="border-b border-border/50 bg-background/80 backdrop-blur-md px-4 lg:px-8 h-16 flex items-center justify-between max-w-7xl mx-auto">
        <Link href="/"><Logo size="sm" /></Link>
        <div className="flex items-center gap-3">
          <Link href="/login"><Button variant="ghost" size="sm">Log in</Button></Link>
          <Link href="/signup"><Button size="sm">Get Started Free</Button></Link>
        </div>
      </nav>

      {/* Hero */}
      <section className="py-20 px-4 text-center max-w-3xl mx-auto">
        <div className="inline-flex items-center gap-2 bg-red-500/10 border border-red-500/20 rounded-full px-4 py-1.5 text-sm text-red-400 mb-6">
          Barbers deserve better software
        </div>
        <h1 className="text-4xl md:text-5xl font-bold mb-6 leading-tight">
          Why barbers are switching<br />
          <span className="gold-text">to ClipWise</span>
        </h1>
        <p className="text-[#8f8f8f] text-lg mb-8 leading-relaxed">
          Real complaints from real barbers about Squire and Booksy — and exactly how ClipWise fixes every one of them.
        </p>
        <Link href="/signup"><Button size="lg">Get Started Free — No Card Needed <ArrowRight size={18} /></Button></Link>
      </section>

      {/* Squire section */}
      <section className="py-16 px-4 max-w-4xl mx-auto">
        <div className="flex items-center gap-3 mb-8">
          <div className="flex-1 h-px bg-border" />
          <span className="text-sm font-bold text-orange-400 uppercase tracking-widest px-4">Problems with Squire</span>
          <div className="flex-1 h-px bg-border" />
        </div>
        <div className="space-y-4">
          {squireProblems.map((item, i) => (
            <div key={i} className="bg-surface border border-border rounded-2xl p-5">
              <div className="flex items-start gap-3 mb-3">
                <X size={16} className="text-red-400 flex-shrink-0 mt-0.5" />
                <p className="font-semibold text-white">{item.problem}</p>
              </div>
              <p className="text-xs text-[#8f8f8f] italic ml-7 mb-3 border-l border-border pl-3">{item.quote}</p>
              <div className="flex items-start gap-3 ml-7 p-3 bg-gold/5 border border-gold/15 rounded-xl">
                <Check size={14} className="text-gold flex-shrink-0 mt-0.5" />
                <p className="text-sm text-gray-300">{item.fix}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Booksy section */}
      <section className="py-16 px-4 max-w-4xl mx-auto">
        <div className="flex items-center gap-3 mb-8">
          <div className="flex-1 h-px bg-border" />
          <span className="text-sm font-bold text-red-400 uppercase tracking-widest px-4">Problems with Booksy</span>
          <div className="flex-1 h-px bg-border" />
        </div>
        <div className="space-y-4">
          {booksyProblems.map((item, i) => (
            <div key={i} className="bg-surface border border-border rounded-2xl p-5">
              <div className="flex items-start gap-3 mb-3">
                <X size={16} className="text-red-400 flex-shrink-0 mt-0.5" />
                <p className="font-semibold text-white">{item.problem}</p>
              </div>
              <p className="text-xs text-[#8f8f8f] italic ml-7 mb-3 border-l border-border pl-3">{item.quote}</p>
              <div className="flex items-start gap-3 ml-7 p-3 bg-gold/5 border border-gold/15 rounded-xl">
                <Check size={14} className="text-gold flex-shrink-0 mt-0.5" />
                <p className="text-sm text-gray-300">{item.fix}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Comparison table */}
      <section className="py-16 px-4 max-w-4xl mx-auto">
        <h2 className="text-2xl font-bold text-center mb-8">Side by side</h2>
        <div className="overflow-x-auto rounded-2xl border border-border">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-surface-raised">
                <th className="text-left px-6 py-4 text-sm font-medium text-[#8f8f8f]">Feature</th>
                <th className="px-6 py-4 text-center"><span className="text-gold font-bold">ClipWise</span></th>
                <th className="px-6 py-4 text-center text-sm text-[#8f8f8f]">Squire</th>
                <th className="px-6 py-4 text-center text-sm text-[#8f8f8f]">Booksy</th>
              </tr>
            </thead>
            <tbody>
              {comparison.map((row, i) => (
                <tr key={row.feature} className={cn("border-b border-border last:border-0", i % 2 === 0 ? "bg-surface" : "bg-surface/50")}>
                  <td className="px-6 py-3.5 text-sm text-gray-300">{row.feature}</td>
                  {[row.clipwise, row.squire, row.booksy].map((val, j) => (
                    <td key={j} className="px-6 py-3.5 text-center">
                      {typeof val === "boolean"
                        ? val
                          ? <Check size={17} className={cn("mx-auto", j === 0 ? "text-gold" : "text-emerald-400")} />
                          : <X size={17} className="mx-auto text-red-500/50" />
                        : <span className={cn("text-sm font-semibold", j === 0 ? "text-gold" : "text-[#8f8f8f]")}>{val}</span>}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* CTA */}
      <section className="py-20 px-4 text-center">
        <div className="max-w-xl mx-auto bg-surface border border-gold/20 rounded-3xl p-10 gold-glow">
          <Scissors size={36} className="text-gold mx-auto mb-4" />
          <h2 className="text-2xl font-bold mb-3">Your page. Your clients. Your data.</h2>
          <p className="text-[#8f8f8f] mb-6 text-sm">Join barbers who are done paying commissions, booking fees, and upsell traps. ClipWise is built for barbers — not for a marketplace.</p>
          <Link href="/signup">
            <Button size="lg" className="text-base px-8">Get Started Free <ArrowRight size={18} /></Button>
          </Link>
          <p className="text-xs text-[#8f8f8f] mt-4">No credit card · No sales call · Cancel anytime</p>
        </div>
      </section>

      <footer className="border-t border-border py-8 px-4 text-center">
        <Logo size="sm" className="justify-center mb-2" />
        <p className="text-xs text-[#8f8f8f]">© 2026 ClipWise Technologies Inc. · <Link href="/" className="hover:text-gold transition-colors">Back to home</Link></p>
      </footer>
    </div>
  );
}
