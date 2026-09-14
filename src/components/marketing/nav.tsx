import Link from "next/link";

// Shared marketing nav (the floating pill). Used by every public page via
// MarketingShell, so the nav never drifts between pages. Section links point at
// the homepage anchors (/#…) so they work from any page, not just the homepage.
export function MarketingNav() {
  return (
    <nav className="navbar">
      <Link href="/" className="brand">CLIPWISE</Link>
      <ul>
        <li><Link href="/#app">Product</Link></li>
        <li><Link href="/#book">Booking</Link></li>
        <li><Link href="/#pay">Payments</Link></li>
        <li><Link href="/#price">Pricing</Link></li>
        <li><Link href="/shops">Find a Barber</Link></li>
      </ul>
      <div className="right">
        <Link href="/login" className="login">Log in</Link>
        <Link href="/signup" className="go">Get Started</Link>
      </div>
    </nav>
  );
}
