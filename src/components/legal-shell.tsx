import { MarketingShell } from "@/components/marketing/shell";
import { Children, isValidElement } from "react";

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
      <main id="public-main" className="blk doc">
        <div className="wrap">
          <div className="prose">
            <div>
              <h1>{title}</h1>
              <p className="updated">Last updated: {updated}</p>
            </div>
            <details className="legal-index"><summary>On this page</summary><ul>{Children.toArray(children).filter(isValidElement).map(child => {
              const props = child.props as { n?: string | number; title?: string };
              return props.n && props.title ? <li key={props.n}><a href={`#section-${props.n}`}>{props.title}</a></li> : null;
            })}</ul></details>
            {children}
          </div>
        </div>
      </main>
    </MarketingShell>
  );
}

// Small numbered section — headings + body, themed by `.mkt .prose`.
export function LSection({ n, title, children }: { n: string | number; title: string; children: React.ReactNode }) {
  return (
    <section id={`section-${n}`}>
      <h2>{n}. {title}</h2>
      <div>{children}</div>
    </section>
  );
}
