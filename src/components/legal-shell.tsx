import Link from "next/link";
import { Logo } from "@/components/ui/logo";
import { ArrowLeft } from "lucide-react";

// Shared chrome for the legal pages (Terms / Privacy / Cookies). Server
// component — pure content, no interactivity.
export function LegalShell({
  title, updated, children,
}: { title: string; updated: string; children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border">
        <div className="max-w-3xl mx-auto px-4 py-4 flex items-center justify-between">
          <Link href="/"><Logo size="sm" /></Link>
          <Link href="/" className="text-sm text-[#8f8f8f] hover:text-white flex items-center gap-1.5">
            <ArrowLeft size={14} /> Home
          </Link>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-10">
        <h1 className="text-3xl font-bold text-white">{title}</h1>
        <p className="text-sm text-[#8f8f8f] mt-1">Last updated: {updated}</p>

        <div className="legal-body mt-8 space-y-6 text-sm text-gray-300 leading-relaxed">
          {children}
        </div>

        <div className="mt-12 pt-6 border-t border-border flex flex-wrap gap-4 text-xs text-[#8f8f8f]">
          <Link href="/support" className="hover:text-gold">How Payments Work</Link>
          <Link href="/terms" className="hover:text-gold">Terms of Service</Link>
          <Link href="/privacy" className="hover:text-gold">Privacy Policy</Link>
          <Link href="/cookies" className="hover:text-gold">Cookie Policy</Link>
          <span className="ml-auto">© 2026 ClipWise Technologies Inc.</span>
        </div>
      </main>
    </div>
  );
}

// Small heading + paragraph helpers so the pages read cleanly.
export function LSection({ n, title, children }: { n: string | number; title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-lg font-semibold text-white">{n}. {title}</h2>
      <div className="space-y-2">{children}</div>
    </section>
  );
}
