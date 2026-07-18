import type { Metadata } from "next";
import { LegalShell, LSection } from "@/components/legal-shell";

export const metadata: Metadata = {
  title: "Terms of Service — ClipWise",
  description: "The terms governing your use of the ClipWise barbershop booking platform.",
};

export default function TermsPage() {
  return (
    <LegalShell title="Terms of Service" updated="July 18, 2026">
      <p>
        These Terms of Service (&ldquo;Terms&rdquo;) govern your access to and use of the ClipWise
        platform, websites, and apps (the &ldquo;Service&rdquo;) operated by{" "}
        <strong className="text-white">ClipWise Technologies Inc.</strong> (&ldquo;ClipWise,&rdquo;
        &ldquo;we,&rdquo; &ldquo;us&rdquo;). By creating an account or using the Service, you agree to
        these Terms. If you do not agree, do not use the Service.
      </p>

      <LSection n={1} title="What ClipWise is">
        <p>
          ClipWise is a software platform that lets barbershops (&ldquo;Shops&rdquo;) manage bookings,
          schedules, staff, and payments, and lets clients (&ldquo;Customers&rdquo;) book appointments
          with those Shops. Shops are independent businesses. ClipWise is not a barbershop, does not
          provide grooming services, and is not a party to the appointment agreement between a Customer
          and a Shop.
        </p>
      </LSection>

      <LSection n={2} title="Accounts and eligibility">
        <p>
          You must be at least the age of majority in your province or territory to create an account,
          and provide accurate information. You are responsible for activity under your account and for
          keeping your password secure. Notify us promptly of any unauthorized use. We may suspend or
          terminate accounts that violate these Terms.
        </p>
      </LSection>

      <LSection n={3} title="Roles: Shops, staff, and Customers">
        <p>
          <strong className="text-white">Shop owners</strong> are responsible for their business,
          staff, services, pricing, tax collection, and their conduct toward Customers.{" "}
          <strong className="text-white">Barbers/staff</strong> access only the permissions granted by
          their Shop. <strong className="text-white">Customers</strong> are responsible for accurate
          booking details and for showing up to or cancelling appointments per the Shop&rsquo;s policy.
        </p>
      </LSection>

      <LSection n={4} title="Bookings and appointments">
        <p>
          When a Customer books, they enter into an agreement directly with the Shop. ClipWise simply
          facilitates scheduling and, where enabled, payment. Availability, service details, and the
          conduct of the appointment are the Shop&rsquo;s responsibility. We do not guarantee that any
          appointment will be honoured.
        </p>
      </LSection>

      <LSection n={5} title="Payments and fees">
        <p>
          <strong className="text-white">Shop subscriptions.</strong> Paid plans are billed in advance
          on a recurring basis through our payment processor (Stripe) at the price shown at checkout.
          Subscriptions renew automatically until cancelled. You can cancel anytime from Settings;
          cancellation takes effect at the end of the current billing period, and fees already paid are
          non-refundable except where required by law.
        </p>
        <p>
          <strong className="text-white">Customer payments.</strong> Where a Shop enables online
          payment, payments are processed by Stripe and settled to the{" "}
          <strong className="text-white">Shop&rsquo;s own connected Stripe account</strong>. The Shop is
          the merchant of record for those transactions. ClipWise does not hold, control, or take a
          commission on Customer payments, and charges Customers <strong className="text-white">no
          per-booking fee</strong>.
        </p>
        <p>
          <strong className="text-white">Taxes.</strong> Shops are solely responsible for determining,
          collecting, and remitting any taxes on their services and products.
        </p>
      </LSection>

      <LSection n={6} title="Cancellations, no-shows, and refunds">
        <p>
          Each Shop sets its own cancellation, no-show, and refund policy, including any no-show or
          late-cancellation fee, which is disclosed at booking. ClipWise provides tools for Shops to
          apply those policies (for example, holding or charging a card for a no-show), but any charge,
          refund, or dispute for a Customer payment is between the Customer and the Shop. Subscription
          fees paid to ClipWise are governed by Section 5.
        </p>
      </LSection>

      <LSection n={7} title="Acceptable use">
        <p>You agree not to: use the Service for unlawful purposes; harass or harm others; upload false,
          infringing, or harmful content; attempt to access data you are not authorized to see; scrape,
          reverse-engineer, or overload the Service; or circumvent security or usage limits.</p>
      </LSection>

      <LSection n={8} title="Intellectual property">
        <p>
          The Service, including its software, design, and branding, is owned by ClipWise and protected
          by law. We grant you a limited, non-exclusive, non-transferable licence to use it per these
          Terms. Content you upload (e.g., your shop profile, logo) remains yours; you grant us the
          licence needed to host and display it to operate the Service.
        </p>
      </LSection>

      <LSection n={9} title="Third-party services">
        <p>
          The Service relies on third parties including Stripe (payments), Twilio (SMS), Resend (email),
          Supabase (data hosting), and Vercel (application hosting). Your use may be subject to their
          terms, and we are not responsible for their acts or omissions.
        </p>
      </LSection>

      <LSection n={10} title="Disclaimers">
        <p>
          The Service is provided &ldquo;as is&rdquo; and &ldquo;as available,&rdquo; without warranties
          of any kind, whether express or implied, to the fullest extent permitted by law. We do not
          warrant that the Service will be uninterrupted, error-free, or secure, or that appointments,
          reminders, or payments will always be delivered on time.
        </p>
      </LSection>

      <LSection n={11} title="Limitation of liability">
        <p>
          To the maximum extent permitted by law, ClipWise and its directors, employees, and suppliers
          will not be liable for any indirect, incidental, special, consequential, or punitive damages,
          or for lost profits, revenue, data, or goodwill. Our total liability for any claim relating to
          the Service will not exceed the greater of the amounts you paid us in the twelve months before
          the claim, or CAD $100.
        </p>
      </LSection>

      <LSection n={12} title="Indemnification">
        <p>
          You agree to indemnify and hold ClipWise harmless from claims, damages, and expenses
          (including reasonable legal fees) arising from your use of the Service, your content, your
          business, or your violation of these Terms or of any law or third-party right.
        </p>
      </LSection>

      <LSection n={13} title="Termination">
        <p>
          You may stop using the Service at any time. We may suspend or terminate access if you breach
          these Terms or to protect the Service or its users. On termination, your right to use the
          Service ends; sections that by their nature should survive (e.g., payments owed, disclaimers,
          liability limits) will survive.
        </p>
      </LSection>

      <LSection n={14} title="Changes to these Terms">
        <p>
          We may update these Terms from time to time. Material changes will be posted here with a new
          &ldquo;last updated&rdquo; date and, where appropriate, notified to you. Continued use after
          changes take effect means you accept the updated Terms.
        </p>
      </LSection>

      <LSection n={15} title="Governing law">
        <p>
          These Terms are governed by the laws of the Province of New Brunswick and the federal laws of
          Canada applicable there, without regard to conflict-of-laws rules. The courts located in New
          Brunswick will have jurisdiction, subject to any non-waivable rights you have under local
          consumer law.
        </p>
      </LSection>

      <LSection n={16} title="Contact">
        <p>
          Questions about these Terms? Contact us at{" "}
          <a href="mailto:support@clipwise.ca" className="text-gold hover:underline">support@clipwise.ca</a>.
        </p>
      </LSection>
    </LegalShell>
  );
}
