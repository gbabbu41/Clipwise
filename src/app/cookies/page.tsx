import type { Metadata } from "next";
import { LegalShell, LSection } from "@/components/legal-shell";

export const metadata: Metadata = {
  title: "Cookie Policy — ClipWise",
  description: "How ClipWise uses cookies and local storage.",
};

export default function CookiesPage() {
  return (
    <LegalShell title="Cookie Policy" updated="July 18, 2026">
      <p>
        This policy explains how <strong className="text-white">ClipWise Technologies Inc.</strong> uses
        cookies and similar technologies (like browser local storage). It should be read alongside our{" "}
        <a href="/privacy" className="text-gold hover:underline">Privacy Policy</a>.
      </p>

      <LSection n={1} title="What these technologies are">
        <p>
          Cookies are small files stored by your browser. Local storage is a similar browser mechanism
          for saving small amounts of data on your device. Both let a site remember information between
          pages and visits.
        </p>
      </LSection>

      <LSection n={2} title="What we use">
        <ul className="list-disc pl-5 space-y-1">
          <li><strong className="text-white">Essential / authentication</strong> — to keep you securely signed in to your account (managed by our authentication provider, Supabase). The Service does not work without these.</li>
          <li><strong className="text-white">Preferences</strong> — small local-storage values such as your notification-sound choice, so the app behaves the way you left it.</li>
          <li><strong className="text-white">Security &amp; integrity</strong> — to help detect abuse and keep the platform reliable.</li>
        </ul>
        <p>
          We do <strong className="text-white">not</strong> use third-party advertising or cross-site
          tracking cookies.
        </p>
      </LSection>

      <LSection n={3} title="Managing cookies">
        <p>
          You can clear or block cookies and local storage in your browser settings. Note that blocking
          essential cookies will sign you out and prevent core features (like booking management and the
          dashboard) from working.
        </p>
      </LSection>

      <LSection n={4} title="Changes">
        <p>We may update this policy; the &ldquo;last updated&rdquo; date above reflects the latest
          version.</p>
      </LSection>

      <LSection n={5} title="Contact">
        <p>
          Questions?{" "}
          <a href="mailto:privacy@clipwise.ca" className="text-gold hover:underline">privacy@clipwise.ca</a>.
        </p>
      </LSection>
    </LegalShell>
  );
}
