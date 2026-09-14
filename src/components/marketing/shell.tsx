import { MKT_CSS } from "@/lib/marketing-theme";
import { MarketingNav } from "./nav";
import { MarketingFooter } from "./footer";

// Wraps a public marketing page in the scoped theme (`.mkt` + MKT_CSS) with the
// shared nav and footer. Every public page renders <MarketingShell>…</MarketingShell>
// so the whole marketing site is one consistent, portal-safe system.
//
// The homepage passes its full-bleed hero as the first child; content pages pass
// a <section className="blk doc"> (the `.doc` class adds top padding to clear the
// fixed nav).
export function MarketingShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mkt">
      <style dangerouslySetInnerHTML={{ __html: MKT_CSS }} />
      <MarketingNav />
      {children}
      <MarketingFooter />
    </div>
  );
}
