import type { Metadata } from "next";
import Link from "next/link";
import { Check, X, Scissors } from "lucide-react";
import { MarketingShell } from "@/components/marketing/shell";

export const metadata: Metadata = {
  title: "Why ClipWise — built for barbers, not a marketplace",
  description:
    "How ClipWise compares to Squire and Booksy: $0 client booking fees, 0% commission, no marketplace, no contracts, public pricing.",
  alternates: { canonical: "https://clipwise.ca/why-clipwise" },
};

const squireProblems = [
  { problem: "Can pass booking fees onto your clients", fix: "ClipWise charges $0 in client-side booking fees. Ever." },
  { problem: "Contracts and sales calls to get started", fix: "No contracts. No sales calls. Cancel from Settings in 2 clicks." },
  { problem: "Features split across higher-priced tiers", fix: "Every ClipWise feature is included at one flat price. No upsells." },
  { problem: "Puts your clients in an app alongside other shops", fix: "Your booking page is yours only. No marketplace. No competitor exposure." },
  { problem: "No public pricing — you have to book a demo", fix: "ClipWise pricing is public, simple, and on the website. No demos required." },
];

const booksyProblems = [
  { problem: "Marketplace commission on clients booked through it", fix: "Zero commissions. Every client you bring in stays yours — 100%." },
  { problem: "Can hold or delay your payouts", fix: "Your money is always yours. ClipWise doesn\'t hold payouts." },
  { problem: "Support can be slow to reach", fix: "Real human support. We respond within 24 hours — or we\'ll say so upfront." },
  { problem: "Pushes your clients to download their app", fix: "Clients book in their browser. No account. No download. No friction." },
  { problem: "Clients become loyal to the marketplace, not you", fix: "Clients book directly through your page. They remember your shop — not ours." },
];

const comparison: { feature: string; clipwise: string | boolean; squire: string | boolean; booksy: string | boolean }[] = [
  { feature: "Client-side booking fees", clipwise: "$0 — none ever", squire: "Can add per-booking fees", booksy: "Marketplace commission" },
  { feature: "No app download for clients", clipwise: true, squire: false, booksy: false },
  { feature: "No competitor marketplace", clipwise: true, squire: false, booksy: false },
  { feature: "Public transparent pricing", clipwise: true, squire: false, booksy: true },
  { feature: "All features at base price", clipwise: true, squire: false, booksy: false },
  { feature: "Cancel anytime, no call", clipwise: true, squire: false, booksy: false },
  { feature: "Client hair profile / memory", clipwise: true, squire: false, booksy: false },
  { feature: "No-show tracking per client", clipwise: true, squire: false, booksy: false },
  { feature: "Starting price", clipwise: "Free", squire: "No public pricing", booksy: "Paid plans + fees" },
];

function Problems({ items }: { items: typeof squireProblems }) {
  return (
    <div className="probs">
      {items.map((item, i) => (
        <div className="prob" key={i}>
          <p className="ph"><X size={16} className="text-red-400" style={{ flex: "none", marginTop: 2 }} />{item.problem}</p>
          <div className="pf"><Check size={14} className="text-white" style={{ flex: "none", marginTop: 2 }} />{item.fix}</div>
        </div>
      ))}
    </div>
  );
}

export default function WhyClipWisePage() {
  return (
    <MarketingShell>
      {/* hero */}
      <section className="blk doc">
        <div className="wrap center" style={{ display: "flex", flexDirection: "column", gap: 20, alignItems: "center" }}>
          <span className="badge-warn">Barbers deserve better software</span>
          <h1 style={{ fontSize: "clamp(32px,5vw,52px)", fontWeight: 700, letterSpacing: "-.035em", lineHeight: 1.08, margin: 0, textWrap: "balance" }}>
            Why barbers are switching to <span style={{ color: "var(--ok)" }}>ClipWise</span>
          </h1>
          <p className="lead" style={{ textAlign: "center" }}>See how ClipWise stacks up against Squire and Booksy — and why barbers are making the switch.</p>
          <Link href="/signup" className="pill w">Get started free — no card needed</Link>
        </div>
      </section>

      {/* Squire */}
      <section className="blk" style={{ paddingTop: 0 }}>
        <div className="wrap" style={{ maxWidth: 820 }}>
          <div className="divider"><span className="ln" /><span className="lb">Problems with Squire</span><span className="ln" /></div>
          <Problems items={squireProblems} />
        </div>
      </section>

      {/* Booksy */}
      <section className="blk" style={{ paddingTop: 0 }}>
        <div className="wrap" style={{ maxWidth: 820 }}>
          <div className="divider"><span className="ln" /><span className="lb">Problems with Booksy</span><span className="ln" /></div>
          <Problems items={booksyProblems} />
        </div>
      </section>

      {/* comparison */}
      <section className="blk" style={{ paddingTop: 0 }}>
        <div className="wrap" style={{ maxWidth: 820 }}>
          <h2 className="center" style={{ marginBottom: 28 }}>Side by side</h2>
          <div className="cmp-wrap">
            <table className="cmp">
              <thead>
                <tr>
                  <th>Feature</th>
                  <th className="cw">ClipWise</th>
                  <th>Squire</th>
                  <th>Booksy</th>
                </tr>
              </thead>
              <tbody>
                {comparison.map((row) => (
                  <tr key={row.feature}>
                    <td>{row.feature}</td>
                    {[row.clipwise, row.squire, row.booksy].map((val, j) => (
                      <td key={j}>
                        {typeof val === "boolean"
                          ? val
                            ? <Check size={17} style={{ margin: "0 auto", color: j === 0 ? "var(--ok)" : "#F5F4F7" }} />
                            : <X size={17} style={{ margin: "0 auto", color: "rgba(255,90,90,.45)" }} />
                          : <span className={j === 0 ? "cw" : "muted"} style={{ fontWeight: 600 }}>{val}</span>}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* CTA + disclaimer */}
      <section className="blk" style={{ paddingTop: 0 }}>
        <div className="wrap">
          <div className="ctacard">
            <Scissors size={34} style={{ color: "var(--ok)" }} />
            <h2>Your page. Your clients. Your data.</h2>
            <p className="lead" style={{ textAlign: "center" }}>Join barbers who are done paying commissions, booking fees, and upsell traps. ClipWise is built for barbers — not for a marketplace.</p>
            <Link href="/signup" className="pill w">Get started free</Link>
            <p className="fine">No credit card · No sales call · Cancel anytime</p>
          </div>
          <p className="fine" style={{ textAlign: "center", maxWidth: "64ch", margin: "28px auto 0", lineHeight: 1.6 }}>
            Comparisons reference publicly available third-party product and pricing information as of 2026 and may change. Squire&trade; and Booksy&trade; are trademarks of their respective owners; ClipWise is not affiliated with, endorsed by, or sponsored by them.
          </p>
        </div>
      </section>
    </MarketingShell>
  );
}
