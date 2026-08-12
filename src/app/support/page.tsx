import type { Metadata } from "next";
import { LegalShell, LSection } from "@/components/legal-shell";

export const metadata: Metadata = {
  title: "How Payments Work — ClipWise",
  description: "A plain-language guide to how money flows through ClipWise: card payments, Stripe fees, payouts, cash, tips, tax, barber commission, and what your shop keeps.",
};

export default function SupportPage() {
  return (
    <LegalShell title="How Payments Work" updated="August 12, 2026">
      <p>
        Here&rsquo;s the whole thing in plain language — how money moves when a customer pays,
        what comes out along the way, and what your shop actually keeps. If anything below
        doesn&rsquo;t match what you&rsquo;re seeing, email us at{" "}
        <a href="mailto:support@clipwise.ca" className="text-gold hover:underline">support@clipwise.ca</a>.
      </p>

      <LSection n={1} title="The money is yours — it lands in your account">
        <p>
          When a customer pays by card, the money goes <strong className="text-white">straight into your
          shop&rsquo;s own Stripe account</strong>, not ClipWise&rsquo;s. You&rsquo;re the merchant. ClipWise
          takes <strong className="text-white">0% of your booking revenue</strong> — we charge you a flat
          monthly subscription instead (more on that at the bottom).
        </p>
        <p>
          Stripe is the payment processor that actually moves the card money and deposits it to your bank.
        </p>
      </LSection>

      <LSection n={2} title="Card payments and the processing fee">
        <p>
          Every card charge has a small Stripe processing fee (roughly{" "}
          <strong className="text-white">2.9% + 30&cent;</strong>). It comes off the top of each payment.
          So a <strong className="text-white">$35</strong> haircut shows up as:
        </p>
        <ul className="list-disc pl-5 space-y-1">
          <li><strong className="text-white">Gross</strong> — the $35 the customer was charged.</li>
          <li><strong className="text-white">Stripe fee</strong> — about $1.60, taken by Stripe.</li>
          <li><strong className="text-white">Collected</strong> — the ~$33.40 that actually reaches your account.</li>
        </ul>
        <p>
          The shop absorbs that fee — it&rsquo;s a normal cost of doing business, like rent or the chair. It&rsquo;s
          never charged to the barber.
        </p>
      </LSection>

      <LSection n={3} title="Getting paid out">
        <p>
          Stripe deposits your collected money to your bank on its regular payout schedule — usually a
          couple of business days after each sale. Your <strong className="text-white">Payments</strong> page
          shows your current balance and the next payout so you always know what&rsquo;s on the way.
        </p>
      </LSection>

      <LSection n={4} title="Cash, and paying later">
        <p>
          <strong className="text-white">Cash</strong> never touches Stripe — no processing fee, and it&rsquo;s in
          your hand immediately. You just mark the appointment paid so it stays on the books.
        </p>
        <p>
          If a customer books &ldquo;pay in person,&rdquo; you can still collect by card afterward by sending them a
          <strong className="text-white"> payment link</strong> by email or text — the money flows exactly the
          same way as a normal card payment.
        </p>
      </LSection>

      <LSection n={5} title="Tips">
        <p>
          Tips are <strong className="text-white">100% the barber&rsquo;s</strong>, always — they sit on top of the
          service price and are never part of the shop&rsquo;s revenue or subject to commission.
        </p>
      </LSection>

      <LSection n={6} title="Sales tax">
        <p>
          If your shop is tax-registered, tax is calculated on the service and tracked{" "}
          <strong className="text-white">separately</strong> as money you owe the government. It&rsquo;s never yours
          to keep, and a barber never earns commission on it. If you&rsquo;re not registered, no tax is added.
        </p>
      </LSection>

      <LSection n={7} title="Barber commission">
        <p>
          A barber earns their set percentage of the <strong className="text-white">service</strong> they performed
          (for example, 70% of a $35 cut = $24.50). Two important things:
        </p>
        <ul className="list-disc pl-5 space-y-1">
          <li>
            It&rsquo;s a <strong className="text-white">report of what to pay them</strong>, not an automatic
            transfer — ClipWise doesn&rsquo;t move that money. You pay your barber the way you already do (cash,
            e-transfer, payroll).
          </li>
          <li>
            The number is the <strong className="text-white">same on every screen</strong> — what the barber sees
            in their own portal is exactly what you see when you filter your Payments to that barber.
          </li>
        </ul>
        <p>
          If you cut hair yourself, you can set your own commission (it defaults to 0%, so your own services
          simply stay as shop revenue until you decide otherwise).
        </p>
      </LSection>

      <LSection n={8} title="What your shop actually keeps — &ldquo;Net revenue&rdquo;">
        <p>
          After the fee, tax, tips, and barber commission come out, what&rsquo;s left is your{" "}
          <strong className="text-white">Net revenue</strong> — the real bottom line:
        </p>
        <p className="text-white font-medium">
          Collected &minus; sales tax &minus; tips &minus; barber commission = Net revenue.
        </p>
        <p>
          Your Analytics page shows this as a simple top-to-bottom breakdown so you can see exactly where every
          dollar went.
        </p>
      </LSection>

      <LSection n={9} title="Gift cards">
        <p>
          A gift card is counted as revenue when it&rsquo;s <strong className="text-white">sold</strong>. When the
          customer later redeems it on a service, that value isn&rsquo;t counted a second time — so your totals are
          never inflated.
        </p>
      </LSection>

      <LSection n={10} title="Your ClipWise subscription">
        <p>
          This is the one payment that flows the other way — from <strong className="text-white">you to
          ClipWise</strong> — for your monthly plan. It&rsquo;s completely separate from your customers&rsquo; money and
          never touches your booking revenue.
        </p>
      </LSection>

      <p className="pt-2">
        Still have a question about a specific number or payout? Email{" "}
        <a href="mailto:support@clipwise.ca" className="text-gold hover:underline">support@clipwise.ca</a>{" "}
        and we&rsquo;ll walk through it with you.
      </p>
    </LegalShell>
  );
}
