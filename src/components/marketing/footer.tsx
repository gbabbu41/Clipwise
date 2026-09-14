import Link from "next/link";

// Shared marketing footer, fitted to the theme. Used by every public page via
// MarketingShell. Section links use homepage anchors (/#…) so they resolve from
// any page. The wordmark is a plain white CLIPWISE (matching the nav brand) — the
// app's blue/violet gradient logo would be off-palette on the emerald theme.
export function MarketingFooter() {
  return (
    <footer className="site-footer">
      <div className="wrap">
        <div className="fg">
          <div>
            <Link href="/" className="fm-brand">CLIPWISE</Link>
            <p className="fabout">Barbershop software built for Canadian shops. Moncton, New Brunswick.</p>
          </div>
          <div>
            <h3>Product</h3>
            <Link href="/#app">Features</Link>
            <Link href="/#price">Pricing</Link>
            <Link href="/shops">Find a Barber</Link>
          </div>
          <div>
            <h3>Company</h3>
            <Link href="/why-clipwise">Why ClipWise</Link>
            <Link href="/support">How payments work</Link>
            <a href="mailto:support@clipwise.ca">Contact</a>
          </div>
          <div>
            <h3>Legal</h3>
            <Link href="/privacy">Privacy</Link>
            <Link href="/terms">Terms</Link>
            <Link href="/cookies">Cookies</Link>
          </div>
        </div>
        <div className="fb">
          <span>© 2026 ClipWise</span>
        </div>
      </div>
    </footer>
  );
}
