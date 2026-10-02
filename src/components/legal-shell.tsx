import { Children, isValidElement } from "react";
import { MarketingLightShell } from "@/components/marketing/light/MarketingLightShell";

const LEGAL_LIGHT_CSS = `
.mkt.lightMarketing .legal-light{padding:40px clamp(20px,4vw,64px) 76px}
.mkt.lightMarketing .legal-light-wrap{max-width:850px;margin:0 auto}
.mkt.lightMarketing .legal-light .prose{display:flex;flex-direction:column;gap:30px}
.mkt.lightMarketing .legal-light .prose h1{margin:0;color:#101d2e;font-size:clamp(36px,5vw,52px);font-weight:760;letter-spacing:-.045em;line-height:1.08}
.mkt.lightMarketing .legal-light .prose h2{margin:0 0 12px;color:#172334;font-size:21px;font-weight:700;letter-spacing:-.025em;line-height:1.25}
.mkt.lightMarketing .legal-light .prose p,.mkt.lightMarketing .legal-light .prose li{color:#354255;font-size:14px;line-height:1.75}
.mkt.lightMarketing .legal-light .prose p{margin:0}
.mkt.lightMarketing .legal-light .prose section{padding-top:24px;border-top:1px solid #d7dee7}
.mkt.lightMarketing .legal-light .prose section > div{display:flex;flex-direction:column;gap:12px}
.mkt.lightMarketing .legal-light .prose ul{padding-left:22px}
.mkt.lightMarketing .legal-light .prose strong.text-white,.mkt.lightMarketing .legal-light .prose .text-white{color:#172334!important}
.mkt.lightMarketing .legal-light .prose .text-gold{color:#1768cb!important}
.mkt.lightMarketing .legal-light .prose a:hover{text-decoration:underline;text-underline-offset:3px}
.mkt.lightMarketing .legal-light .updated{margin:10px 0 0;color:#657386;font-size:12px}
.mkt.lightMarketing .legal-light .legal-index{padding:16px 0;margin:0;border-block:1px solid #d7dee7;font-size:13px}
.mkt.lightMarketing .legal-light .legal-index summary{min-height:36px;color:#172334;font-weight:700;cursor:pointer}
.mkt.lightMarketing .legal-light .legal-index ul{display:grid;gap:4px;padding:12px 0 0;list-style:none}
.mkt.lightMarketing .legal-light .legal-index a{display:inline-flex;min-height:36px;align-items:center;color:#1768cb}
@media(max-width:700px){.mkt.lightMarketing .legal-light{padding-top:24px}.mkt.lightMarketing .legal-light .prose{gap:24px}.mkt.lightMarketing .legal-light .prose p,.mkt.lightMarketing .legal-light .prose li{font-size:13px}}
`;

// Shared light public chrome for Terms / Privacy / Cookies / How Payments Work.
// Legal page copy and links remain in their page components.
export function LegalShell({
  title, updated, children,
}: { title: string; updated: string; children: React.ReactNode }) {
  return (
    <MarketingLightShell>
      <style dangerouslySetInnerHTML={{ __html: LEGAL_LIGHT_CSS }} />
      <main id="public-main" className="legal-light">
        <div className="legal-light-wrap">
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
    </MarketingLightShell>
  );
}

// Small numbered section — headings and body styled by the shared legal shell.
export function LSection({ n, title, children }: { n: string | number; title: string; children: React.ReactNode }) {
  return (
    <section id={`section-${n}`}>
      <h2>{n}. {title}</h2>
      <div>{children}</div>
    </section>
  );
}
