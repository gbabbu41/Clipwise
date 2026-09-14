import { MarketingShell } from "@/components/marketing/shell";

// Shared chrome for the content pages (Terms / Privacy / Cookies / How Payments
// Work). Now wrapped in the marketing theme (shared nav + footer, scoped `.mkt`)
// so these pages match the rest of the public site. Server component — pure
// content, no interactivity. The pages themselves are unchanged; they render
// their copy through LSection.
export function LegalShell({
  title, updated, children,
}: { title: string; updated: string; children: React.ReactNode }) {
  return (
    <MarketingShell>
      <section className="blk doc">
        <div className="wrap">
          <div className="prose">
            <div>
              <h1>{title}</h1>
              <p className="updated">Last updated: {updated}</p>
            </div>
            {children}
          </div>
        </div>
      </section>
    </MarketingShell>
  );
}

// Small numbered section — headings + body, themed by `.mkt .prose`.
export function LSection({ n, title, children }: { n: string | number; title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2>{n}. {title}</h2>
      <div>{children}</div>
    </section>
  );
}
