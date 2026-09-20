import Link from "next/link";
import { MobileMenu } from "./mobile-menu";

// Shared marketing nav (the floating pill). Used by every public page via
// MarketingShell, so the nav never drifts between pages. Section links point at
// the homepage anchors (/#…) so they work from any page, not just the homepage.
// On phones the section links collapse into <MobileMenu>'s hamburger.
export function MarketingNav() {
  return (
    <nav className="navbar">
      <Link href="/" className="brand" aria-label="ClipWise">
        <img src="/new/logo-watermark.png" alt="ClipWise" className="brand-mark" />
      </Link>
      <ul>
        <li><Link href="/features">Product</Link></li>
        <li><Link href="/online-booking">Booking</Link></li>
        <li><Link href="/payments">Payments</Link></li>
        <li><Link href="/pricing">Pricing</Link></li>
        <li><Link href="/shops">Find a Barber</Link></li>
      </ul>
      <div className="right">
        <Link href="/login" className="login">Log in</Link>
        <Link href="/signup" className="go">Get Started</Link>
        <MobileMenu />
      </div>
    </nav>
  );
}
