import type { Metadata } from "next";
import { LegalShell, LSection } from "@/components/legal-shell";

export const metadata: Metadata = {
  title: "Privacy Policy — ClipWise",
  description: "How ClipWise collects, uses, and protects your personal information.",
};

export default function PrivacyPage() {
  return (
    <LegalShell title="Privacy Policy" updated="August 12, 2026">
      <p>
        <strong className="text-white">ClipWise Technologies Inc.</strong> (&ldquo;ClipWise,&rdquo;
        &ldquo;we&rdquo;) respects your privacy. This policy explains what personal information we
        collect, how we use and share it, and your rights. We handle personal information in accordance
        with Canada&rsquo;s Personal Information Protection and Electronic Documents Act (PIPEDA) and
        applicable provincial law.
      </p>

      <LSection n={1} title="Information we collect">
        <p>We collect:</p>
        <ul className="list-disc pl-5 space-y-1">
          <li><strong className="text-white">Account information</strong> — name, email, phone, password (hashed), and role (shop owner, barber, or customer).</li>
          <li><strong className="text-white">Shop information</strong> — business name, address, hours, services, pricing, staff, and logo.</li>
          <li><strong className="text-white">Booking information</strong> — appointments, the barber/service chosen, notes, and history.</li>
          <li><strong className="text-white">Payment information</strong> — processed by Stripe. We receive limited details (e.g., amount, status, last-4, a payment reference) but <strong className="text-white">do not store full card numbers</strong>.</li>
          <li><strong className="text-white">Communications</strong> — messages, reviews, and support requests.</li>
          <li><strong className="text-white">Usage &amp; device data</strong> — log data, IP address, and basic analytics needed to run and secure the Service.</li>
        </ul>
      </LSection>

      <LSection n={2} title="How we use your information">
        <p>To provide and operate the Service; process bookings and payments; send transactional
          messages (confirmations, reminders, receipts); provide support; maintain security and prevent
          fraud; comply with legal obligations; and, with consent where required, send marketing.</p>
        <p>
          <strong className="text-white">Automated processing &amp; AI.</strong> Some features use
          automated processing. This includes an optional <strong className="text-white">AI phone
          assistant</strong> that a Shop can enable to answer its calls and book appointments: when it is
          on, call audio may be transcribed and processed by our AI providers to understand the request
          and complete the booking. We do not use this automated processing to make legal or similarly
          significant decisions about you, and you can always reach a Shop by other means instead.
        </p>
      </LSection>

      <LSection n={3} title="Email &amp; SMS communications (consent)">
        <p>
          <strong className="text-white">Transactional messages</strong> (e.g., booking confirmations,
          reminders, receipts, account notices) are sent as part of providing the Service.
        </p>
        <p>
          <strong className="text-white">Marketing messages</strong> from a Shop or from ClipWise are
          sent only with the consent required under Canada&rsquo;s Anti-Spam Legislation (CASL). You can
          withdraw consent at any time — reply <strong className="text-white">STOP</strong> to a text or
          use the <strong className="text-white">unsubscribe</strong> link in an email. Withdrawing
          consent does not affect essential transactional messages about your bookings.
        </p>
      </LSection>

      <LSection n={4} title="How we share information">
        <p>We do not sell your personal information. We share it only:</p>
        <ul className="list-disc pl-5 space-y-1">
          <li><strong className="text-white">With the Shop you book</strong> — your booking details are shared with that barbershop so it can serve you.</li>
          <li><strong className="text-white">With service providers</strong> that operate the platform on our behalf: Stripe (payments), Twilio (SMS and voice/phone calls), Resend (email), Supabase (database, authentication, and file storage), Vercel (application hosting), Cloudflare (bot/spam protection), Google (web fonts and maps), and AI providers that power the optional AI phone assistant (e.g., Anthropic). They may process data outside your province, including in the United States, under appropriate safeguards.</li>
          <li><strong className="text-white">For legal reasons</strong> — to comply with law, enforce our Terms, or protect rights, safety, and security.</li>
          <li><strong className="text-white">In a business transfer</strong> — e.g., a merger or acquisition, subject to this policy.</li>
        </ul>
      </LSection>

      <LSection n={5} title="Cookies and similar technologies">
        <p>
          We use essential cookies and local storage to keep you signed in and remember preferences. We
          do not use third-party advertising trackers. See our{" "}
          <a href="/cookies" className="text-gold hover:underline">Cookie Policy</a> for details.
        </p>
      </LSection>

      <LSection n={6} title="Data retention">
        <p>
          We keep personal information for as long as your account is active and as needed to provide the
          Service, then only as long as required for legitimate business or legal purposes (for example,
          financial records for tax and accounting). You may request deletion as described below.
        </p>
      </LSection>

      <LSection n={7} title="Security">
        <p>
          We use technical and organizational safeguards including encryption in transit, row-level
          access controls, and restricted access. No system is perfectly secure, but we work to protect
          your information and to notify you and regulators of breaches where the law requires.
        </p>
      </LSection>

      <LSection n={8} title="Your rights">
        <p>
          Subject to law, you may access, correct, or delete your personal information, and withdraw
          consent to non-essential processing. To make a request, email us at{" "}
          <a href="mailto:privacy@clipwise.ca" className="text-gold hover:underline">privacy@clipwise.ca</a>.
          If you book with a Shop, some requests may need to be directed to that Shop as the business you
          transacted with. You may also contact the Office of the Privacy Commissioner of Canada.
        </p>
      </LSection>

      <LSection n={9} title="Children">
        <p>The Service is not directed to children under 13, and we do not knowingly collect their
          personal information. Bookings for minors should be made by a parent or guardian.</p>
      </LSection>

      <LSection n={10} title="Changes to this policy">
        <p>We may update this policy; material changes will be posted here with a new
          &ldquo;last updated&rdquo; date and notified where appropriate.</p>
      </LSection>

      <LSection n={11} title="Contact">
        <p>
          Privacy questions or requests:{" "}
          <a href="mailto:privacy@clipwise.ca" className="text-gold hover:underline">privacy@clipwise.ca</a>.
        </p>
      </LSection>
    </LegalShell>
  );
}
